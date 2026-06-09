package importchart

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	fetchTimeout     = 10 * time.Second
	maxDownloadBytes = 32 * 1024 * 1024 // 32 MiB upstream cap
	maxFiles         = 1000
	maxFileBytes     = 2 * 1024 * 1024  // 2 MiB per file (real charts have huge values.schema.json)
	maxTotalBytes    = 16 * 1024 * 1024 // 16 MiB total — matches /api/render
	maxRedirects     = 5
)

type importRequest struct {
	URL string `json:"url"`
}

type importResponse struct {
	Ok     bool              `json:"ok"`
	Files  map[string]string `json:"files,omitempty"`
	Source *sourceInfo       `json:"source,omitempty"`
	Error  string            `json:"error,omitempty"`
}

type sourceInfo struct {
	URL         string `json:"url"`
	ContentType string `json:"contentType,omitempty"`
	Format      string `json:"format"`
	SizeBytes   int    `json:"sizeBytes"`
}

// Binary-ish suffixes mirrored from src/lib/chart-archive.ts so we don't
// corrupt non-text payloads when forcing UTF-8 decode.
var skipBinaryExt = regexp.MustCompile(`(?i)\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|tgz|tar\.gz|bin|wasm)$`)

func Handler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	body := http.MaxBytesReader(w, r.Body, 8*1024)
	var req importRequest
	if err := json.NewDecoder(body).Decode(&req); err != nil {
		sendJSON(w, http.StatusBadRequest, importResponse{Error: fmt.Sprintf("bad request: %s", err.Error())})
		return
	}

	parsed, err := validateURL(req.URL)
	if err != nil {
		sendJSON(w, http.StatusBadRequest, importResponse{Error: err.Error()})
		return
	}

	// Generous overall deadline: resolve (maybe a repo index fetch) + the archive fetch.
	ctx, cancel := context.WithTimeout(r.Context(), 2*fetchTimeout)
	defer cancel()

	resolved, err := resolveURL(ctx, parsed)
	if err != nil {
		sendJSON(w, statusForFetchError(err), importResponse{Error: err.Error()})
		return
	}

	data, contentType, err := fetch(ctx, resolved)
	if err != nil {
		sendJSON(w, statusForFetchError(err), importResponse{Error: err.Error()})
		return
	}

	files, format, err := extract(data, resolved.Path, contentType)
	if err != nil {
		sendJSON(w, http.StatusUnprocessableEntity, importResponse{Error: err.Error()})
		return
	}

	sendJSON(w, http.StatusOK, importResponse{
		Ok:    true,
		Files: files,
		Source: &sourceInfo{
			URL:         resolved.String(),
			ContentType: contentType,
			Format:      format,
			SizeBytes:   len(data),
		},
	})
}

func validateURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("url required")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid url: %s", err.Error())
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("unsupported scheme %q (use http or https)", u.Scheme)
	}
	if u.Host == "" {
		return nil, errors.New("url missing host")
	}
	return u, nil
}

func fetch(ctx context.Context, target *url.URL) ([]byte, string, error) {
	client := &http.Client{
		Timeout: fetchTimeout,
		Transport: &http.Transport{
			DialContext: safeDialContext,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return fmt.Errorf("too many redirects (%d)", maxRedirects)
			}
			// Re-validate redirect target so we don't follow http→file:// or to a private host.
			if _, err := validateURL(req.URL.String()); err != nil {
				return fmt.Errorf("refusing redirect to %s: %s", req.URL.Redacted(), err.Error())
			}
			return nil
		},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("accept", "application/octet-stream, application/gzip, application/zip, */*")
	req.Header.Set("user-agent", "charthouse/1 (+https://github.com/)")

	resp, err := client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("fetch failed: %s", err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, "", fmt.Errorf("upstream HTTP %d", resp.StatusCode)
	}

	// Hard cap: stop reading at maxDownloadBytes + 1 so we can detect overruns.
	buf, err := io.ReadAll(io.LimitReader(resp.Body, maxDownloadBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("read failed: %s", err.Error())
	}
	if len(buf) > maxDownloadBytes {
		return nil, "", fmt.Errorf("download exceeds limit (%d bytes)", maxDownloadBytes)
	}
	return buf, resp.Header.Get("content-type"), nil
}

// safeDialContext refuses to connect to loopback/private/link-local addresses
// so /api/import can't be used to probe internal services (SSRF). We resolve
// the host ourselves and dial the validated IP directly to close the
// resolve-vs-dial race.
func safeDialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("no addresses for %s", host)
	}
	for _, ip := range ips {
		if isBlockedIP(ip.IP) {
			return nil, fmt.Errorf("refusing to connect to %s (private/loopback/link-local)", ip.IP)
		}
	}
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
}

func isBlockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	// Standard SSRF guard: refuse loopback, RFC 1918 private, link-local,
	// multicast, and unspecified addresses. We intentionally don't block
	// RFC 6598 (100.64.0.0/10) — overlay networks like Tailscale resolve
	// public hostnames into that range, so blocking it breaks valid clients.
	return ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsPrivate()
}

func statusForFetchError(err error) int {
	msg := err.Error()
	if strings.Contains(msg, "refusing to connect") || strings.Contains(msg, "refusing redirect") {
		return http.StatusBadRequest
	}
	if strings.Contains(msg, "exceeds limit") {
		return http.StatusRequestEntityTooLarge
	}
	if strings.Contains(msg, "not in repo") || strings.Contains(msg, "specify one") || strings.Contains(msg, "no index.yaml") {
		return http.StatusUnprocessableEntity
	}
	if strings.Contains(msg, "upstream HTTP") {
		return http.StatusBadGateway
	}
	return http.StatusBadGateway
}

func extract(data []byte, urlPath string, contentType string) (map[string]string, string, error) {
	format := detectFormat(data, urlPath, contentType)
	switch format {
	case "tgz":
		files, err := extractTgz(data)
		return files, "tgz", err
	case "zip":
		files, err := extractZip(data)
		return files, "zip", err
	default:
		return nil, "", fmt.Errorf("unsupported archive format (need .tgz, .tar.gz, or .zip)")
	}
}

func detectFormat(data []byte, urlPath, contentType string) string {
	// Magic bytes are authoritative when present.
	if len(data) >= 2 && data[0] == 0x1f && data[1] == 0x8b {
		return "tgz"
	}
	if len(data) >= 4 && bytes.Equal(data[:4], []byte{'P', 'K', 0x03, 0x04}) {
		return "zip"
	}
	lowerCT := strings.ToLower(contentType)
	if strings.Contains(lowerCT, "gzip") || strings.Contains(lowerCT, "x-tar") {
		return "tgz"
	}
	if strings.Contains(lowerCT, "zip") {
		return "zip"
	}
	lowerPath := strings.ToLower(urlPath)
	switch {
	case strings.HasSuffix(lowerPath, ".tgz"), strings.HasSuffix(lowerPath, ".tar.gz"):
		return "tgz"
	case strings.HasSuffix(lowerPath, ".zip"):
		return "zip"
	}
	return ""
}

func extractTgz(data []byte) (map[string]string, error) {
	gz, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("gzip: %s", err.Error())
	}
	defer gz.Close()
	return extractTar(gz)
}

func extractTar(r io.Reader) (map[string]string, error) {
	type entry struct {
		name string
		body []byte
	}
	var entries []entry
	tr := tar.NewReader(r)
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("tar: %s", err.Error())
		}
		if hdr.Typeflag != tar.TypeReg {
			continue
		}
		if hdr.Size > maxFileBytes {
			return nil, fmt.Errorf("file too large: %s", hdr.Name)
		}
		body, err := io.ReadAll(io.LimitReader(tr, maxFileBytes+1))
		if err != nil {
			return nil, fmt.Errorf("tar read: %s", err.Error())
		}
		if len(body) > maxFileBytes {
			return nil, fmt.Errorf("file too large: %s", hdr.Name)
		}
		entries = append(entries, entry{name: hdr.Name, body: body})
		if len(entries) > maxFiles {
			return nil, fmt.Errorf("too many files (> %d)", maxFiles)
		}
	}

	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.name)
	}
	strip := stripChartRoot(names)

	out := make(map[string]string, len(entries))
	total := 0
	for _, e := range entries {
		if skipBinaryExt.MatchString(e.name) {
			continue
		}
		rel := strip(e.name)
		if rel == "" || !isSafePath(rel) {
			continue
		}
		total += len(e.body)
		if total > maxTotalBytes {
			return nil, fmt.Errorf("total chart too large (> %d bytes)", maxTotalBytes)
		}
		out[rel] = string(e.body)
	}
	if _, ok := out["Chart.yaml"]; !ok {
		return nil, errors.New("archive missing Chart.yaml")
	}
	return out, nil
}

func extractZip(data []byte) (map[string]string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("zip: %s", err.Error())
	}
	if len(zr.File) > maxFiles {
		return nil, fmt.Errorf("too many files (> %d)", maxFiles)
	}

	names := make([]string, 0, len(zr.File))
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		names = append(names, f.Name)
	}
	strip := stripChartRoot(names)

	out := make(map[string]string, len(zr.File))
	total := 0
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		if skipBinaryExt.MatchString(f.Name) {
			continue
		}
		rel := strip(f.Name)
		if rel == "" || !isSafePath(rel) {
			continue
		}
		if f.UncompressedSize64 > uint64(maxFileBytes) {
			return nil, fmt.Errorf("file too large: %s", f.Name)
		}
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("zip read %s: %s", f.Name, err.Error())
		}
		body, err := io.ReadAll(io.LimitReader(rc, maxFileBytes+1))
		rc.Close()
		if err != nil {
			return nil, fmt.Errorf("zip read %s: %s", f.Name, err.Error())
		}
		if len(body) > maxFileBytes {
			return nil, fmt.Errorf("file too large: %s", f.Name)
		}
		total += len(body)
		if total > maxTotalBytes {
			return nil, fmt.Errorf("total chart too large (> %d bytes)", maxTotalBytes)
		}
		out[rel] = string(body)
	}
	if _, ok := out["Chart.yaml"]; !ok {
		return nil, errors.New("archive missing Chart.yaml")
	}
	return out, nil
}

// stripChartRoot mirrors src/lib/chart-archive.ts stripChartRoot: if every
// non-dir entry shares the same top-level segment, drop it.
func stripChartRoot(names []string) func(string) string {
	if len(names) == 0 {
		return func(s string) string { return s }
	}
	first, _, _ := strings.Cut(names[0], "/")
	for _, n := range names {
		seg, _, _ := strings.Cut(n, "/")
		if seg != first {
			return func(s string) string { return s }
		}
	}
	prefix := first + "/"
	return func(s string) string {
		if strings.HasPrefix(s, prefix) {
			return s[len(prefix):]
		}
		return s
	}
}

func isSafePath(p string) bool {
	if p == "" || strings.HasPrefix(p, "/") || strings.Contains(p, "\\") || strings.Contains(p, "\x00") {
		return false
	}
	norm := path.Clean(p)
	if norm == "." || strings.HasPrefix(norm, "..") || strings.Contains(norm, "/../") {
		return false
	}
	return norm == p
}

func sendJSON(w http.ResponseWriter, status int, body importResponse) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

const (
	maxIndexBytes = 32 * 1024 * 1024 // some real-world index.yaml files are huge
)

type helmIndex struct {
	APIVersion string                  `yaml:"apiVersion"`
	Entries    map[string][]helmChartV `yaml:"entries"`
}

type helmChartV struct {
	Name    string   `yaml:"name"`
	Version string   `yaml:"version"`
	URLs    []string `yaml:"urls"`
}

// resolveURL turns whatever URL the user pasted into a direct tgz/zip URL.
// Supported shapes:
//   - direct archive (…/foo-1.2.3.tgz, …/chart.zip) → returned as-is
//   - repo base URL (https://charts.example.io) → fetched /index.yaml; auto-picks
//     when the repo has a single chart, otherwise returns an error listing
//     available charts
//   - repo + chart (https://charts.example.io/chart) → strips the last segment
//     as the chart name and resolves to the latest version's tgz url
func resolveURL(ctx context.Context, in *url.URL) (*url.URL, error) {
	if hasArchiveExt(in.Path) {
		return in, nil
	}

	// First attempt: assume the user pasted the repo base.
	indexAtBase := withPath(in, joinPath(in.Path, "index.yaml"))
	idx, indexErr := fetchIndex(ctx, indexAtBase)
	chartName := ""
	repoBase := stripSuffix(indexAtBase, "/index.yaml")

	if indexErr != nil {
		// Fallback: treat the last path segment as the chart name, parent as the repo base.
		trimmed := strings.Trim(in.Path, "/")
		if trimmed == "" {
			return nil, fmt.Errorf("no index.yaml at %s: %s", indexAtBase.Redacted(), indexErr.Error())
		}
		parts := strings.Split(trimmed, "/")
		chartName = parts[len(parts)-1]
		basePath := "/" + strings.Join(parts[:len(parts)-1], "/")
		repoBase = withPath(in, basePath)
		indexAtParent := withPath(in, joinPath(basePath, "index.yaml"))
		idx, indexErr = fetchIndex(ctx, indexAtParent)
		if indexErr != nil {
			return nil, fmt.Errorf("no index.yaml at %s or %s: %s",
				indexAtBase.Redacted(), indexAtParent.Redacted(), indexErr.Error())
		}
	}

	if chartName == "" {
		switch len(idx.Entries) {
		case 0:
			return nil, errors.New("repo index has no chart entries")
		case 1:
			for n := range idx.Entries {
				chartName = n
			}
		default:
			names := sortedNames(idx.Entries)
			example := strings.TrimRight(repoBase.String(), "/") + "/" + names[0]
			return nil, fmt.Errorf("repo has %d charts; specify one (e.g. %s). Available: %s",
				len(names), example, strings.Join(names, ", "))
		}
	}

	versions, ok := idx.Entries[chartName]
	if !ok || len(versions) == 0 {
		names := sortedNames(idx.Entries)
		return nil, fmt.Errorf("chart %q not in repo. Available: %s", chartName, strings.Join(names, ", "))
	}
	pick := versions[0] // index.yaml convention: first is latest
	if len(pick.URLs) == 0 {
		return nil, fmt.Errorf("chart %s@%s has no download urls in index.yaml", chartName, pick.Version)
	}

	target, err := url.Parse(pick.URLs[0])
	if err != nil {
		return nil, fmt.Errorf("invalid chart url %q: %s", pick.URLs[0], err.Error())
	}
	if !target.IsAbs() {
		target = repoBase.ResolveReference(target)
	}
	if _, err := validateURL(target.String()); err != nil {
		return nil, fmt.Errorf("invalid chart url %s: %s", target.String(), err.Error())
	}
	return target, nil
}

func fetchIndex(ctx context.Context, indexURL *url.URL) (*helmIndex, error) {
	client := &http.Client{
		Timeout:   fetchTimeout,
		Transport: &http.Transport{DialContext: safeDialContext},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return fmt.Errorf("too many redirects")
			}
			if _, err := validateURL(req.URL.String()); err != nil {
				return fmt.Errorf("refusing redirect to %s: %s", req.URL.Redacted(), err.Error())
			}
			return nil
		},
	}

	subCtx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(subCtx, http.MethodGet, indexURL.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("accept", "text/yaml, application/yaml, */*")
	req.Header.Set("user-agent", "charthouse/1")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("HTTP 404")
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxIndexBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxIndexBytes {
		return nil, fmt.Errorf("index.yaml exceeds %d bytes", maxIndexBytes)
	}

	var idx helmIndex
	if err := yaml.Unmarshal(body, &idx); err != nil {
		return nil, fmt.Errorf("parse: %s", err.Error())
	}
	if idx.APIVersion == "" && len(idx.Entries) == 0 {
		return nil, errors.New("not a helm repo index")
	}
	return &idx, nil
}

func hasArchiveExt(p string) bool {
	lower := strings.ToLower(p)
	return strings.HasSuffix(lower, ".tgz") ||
		strings.HasSuffix(lower, ".tar.gz") ||
		strings.HasSuffix(lower, ".zip")
}

func withPath(base *url.URL, newPath string) *url.URL {
	out := *base
	out.Path = newPath
	out.RawPath = ""
	out.RawQuery = ""
	out.Fragment = ""
	return &out
}

func joinPath(base, extra string) string {
	if base == "" || base == "/" {
		return "/" + strings.TrimLeft(extra, "/")
	}
	return strings.TrimRight(base, "/") + "/" + strings.TrimLeft(extra, "/")
}

func stripSuffix(u *url.URL, suffix string) *url.URL {
	out := *u
	if strings.HasSuffix(out.Path, suffix) {
		out.Path = strings.TrimSuffix(out.Path, suffix)
		if out.Path == "" {
			out.Path = "/"
		}
	}
	return &out
}

func sortedNames(entries map[string][]helmChartV) []string {
	names := make([]string, 0, len(entries))
	for n := range entries {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}
