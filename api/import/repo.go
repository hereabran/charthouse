package importchart

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

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
//   - repo base URL (https://charts.signoz.io) → fetched /index.yaml; auto-picks
//     when the repo has a single chart, otherwise returns an error listing
//     available charts
//   - repo + chart (https://charts.signoz.io/signoz) → strips the last segment
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
	req.Header.Set("user-agent", "helm-playground/1")

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

