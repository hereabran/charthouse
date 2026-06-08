package render

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime/debug"
	"strings"
	"time"

	"helm.sh/helm/v4/pkg/action"
	"helm.sh/helm/v4/pkg/chart/v2/loader"
	"helm.sh/helm/v4/pkg/cli"
	"helm.sh/helm/v4/pkg/release"
)

type renderInput struct {
	Files       map[string]string `json:"files"`
	ReleaseName string            `json:"releaseName"`
	Namespace   string            `json:"namespace"`
	IncludeCRDs bool              `json:"includeCRDs,omitempty"`
}

type renderResponse struct {
	Ok          bool   `json:"ok"`
	Stdout      string `json:"stdout"`
	Stderr      string `json:"stderr"`
	DurationMs  int64  `json:"durationMs"`
	HelmVersion string `json:"helmVersion,omitempty"`
}

type inputError struct {
	message string
}

func (e inputError) Error() string {
	return e.message
}

const (
	maxRequestBytes = 5 * 1024 * 1024
	maxFiles        = 500
	maxFileBytes    = 256 * 1024
	maxTotalBytes   = 4 * 1024 * 1024
	renderTimeout   = 10 * time.Second
)

// Handler renders an in-memory chart using the Helm Go SDK.
func Handler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var input renderInput
	body := http.MaxBytesReader(w, r.Body, maxRequestBytes)
	if err := json.NewDecoder(body).Decode(&input); err != nil {
		sendJSON(w, http.StatusBadRequest, renderResponse{
			Ok:         false,
			Stderr:     fmt.Sprintf("bad request: %s", err.Error()),
			DurationMs: 0,
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), renderTimeout)
	defer cancel()

	result, status := runRender(ctx, input)
	sendJSON(w, status, result)
}

func runRender(ctx context.Context, input renderInput) (renderResponse, int) {
	started := time.Now()
	version := helmSDKVersion()

	releaseName := sanitizeName(input.ReleaseName, "demo", 53)
	namespace := sanitizeName(input.Namespace, "default", 63)

	root, chartDir, err := writeChart(input.Files)
	if err != nil {
		if _, ok := errors.AsType[inputError](err); ok {
			return renderResponse{Ok: false, Stderr: err.Error(), DurationMs: 0}, http.StatusBadRequest
		}
		return renderResponse{Ok: false, Stderr: fmt.Sprintf("server error: %s", err.Error()), DurationMs: 0}, http.StatusInternalServerError
	}
	defer func() {
		_ = os.RemoveAll(root)
	}()

	values := map[string]any{}
	if raw, ok := input.Files["values.override.yaml"]; ok && strings.TrimSpace(raw) != "" {
		loaded, err := loader.LoadValues(strings.NewReader(raw))
		if err != nil {
			return renderResponse{
				Ok:          false,
				Stderr:      fmt.Sprintf("Error: %s", err.Error()),
				DurationMs:  time.Since(started).Milliseconds(),
				HelmVersion: version,
			}, http.StatusUnprocessableEntity
		}
		values = loaded
	}

	settings := cli.New()
	settings.SetNamespace(namespace)
	settings.RegistryConfig = filepath.Join(root, "registry.json")
	settings.RepositoryConfig = filepath.Join(root, "repositories.yaml")
	settings.RepositoryCache = filepath.Join(root, "repository-cache")
	settings.PluginsDirectory = filepath.Join(root, "plugins")
	settings.ContentCache = filepath.Join(root, "content-cache")

	actionConfig := action.NewConfiguration()
	if err := actionConfig.Init(settings.RESTClientGetter(), namespace, "memory"); err != nil {
		return renderResponse{
			Ok:          false,
			Stderr:      fmt.Sprintf("server error: %s", err.Error()),
			DurationMs:  time.Since(started).Milliseconds(),
			HelmVersion: version,
		}, http.StatusInternalServerError
	}

	ch, err := loader.Load(chartDir)
	if err != nil {
		return renderResponse{
			Ok:          false,
			Stderr:      fmt.Sprintf("Error: %s", err.Error()),
			DurationMs:  time.Since(started).Milliseconds(),
			HelmVersion: version,
		}, http.StatusUnprocessableEntity
	}

	client := action.NewInstall(actionConfig)
	client.DryRunStrategy = action.DryRunClient
	client.ReleaseName = releaseName
	client.Namespace = namespace
	client.IncludeCRDs = input.IncludeCRDs
	client.Timeout = renderTimeout

	rel, err := client.RunWithContext(ctx, ch, values)
	if err != nil {
		if ctx.Err() != nil {
			return renderResponse{
				Ok:          false,
				Stderr:      fmt.Sprintf("render timed out after %dms", renderTimeout.Milliseconds()),
				DurationMs:  time.Since(started).Milliseconds(),
				HelmVersion: version,
			}, http.StatusUnprocessableEntity
		}
		return renderResponse{
			Ok:          false,
			Stderr:      fmt.Sprintf("Error: %s", err.Error()),
			DurationMs:  time.Since(started).Milliseconds(),
			HelmVersion: version,
		}, http.StatusUnprocessableEntity
	}

	accessor, err := release.NewAccessor(rel)
	if err != nil {
		return renderResponse{
			Ok:          false,
			Stderr:      fmt.Sprintf("server error: %s", err.Error()),
			DurationMs:  time.Since(started).Milliseconds(),
			HelmVersion: version,
		}, http.StatusInternalServerError
	}

	return renderResponse{
		Ok:          true,
		Stdout:      accessor.Manifest(),
		Stderr:      "",
		DurationMs:  time.Since(started).Milliseconds(),
		HelmVersion: version,
	}, http.StatusOK
}

func writeChart(files map[string]string) (string, string, error) {
	paths := make([]string, 0, len(files))
	for p := range files {
		paths = append(paths, p)
	}

	if len(paths) == 0 {
		return "", "", inputError{"no chart files supplied"}
	}
	if len(paths) > maxFiles {
		return "", "", inputError{fmt.Sprintf("too many files (%d > %d)", len(paths), maxFiles)}
	}
	if _, ok := files["Chart.yaml"]; !ok {
		return "", "", inputError{"Chart.yaml is required"}
	}

	total := 0
	for _, p := range paths {
		if !isSafeRelPath(p) {
			return "", "", inputError{fmt.Sprintf("unsafe path: %s", p)}
		}
		size := len([]byte(files[p]))
		if size > maxFileBytes {
			return "", "", inputError{fmt.Sprintf("file too large: %s", p)}
		}
		total += size
	}
	if total > maxTotalBytes {
		return "", "", inputError{fmt.Sprintf("total chart too large: %d bytes", total)}
	}

	root, err := os.MkdirTemp("", "helm-pg-")
	if err != nil {
		return "", "", err
	}
	chartDir := filepath.Join(root, "chart")
	if err := os.MkdirAll(chartDir, 0o755); err != nil {
		_ = os.RemoveAll(root)
		return "", "", err
	}

	for _, rel := range paths {
		abs := filepath.Join(chartDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			_ = os.RemoveAll(root)
			return "", "", err
		}
		if err := os.WriteFile(abs, []byte(files[rel]), 0o644); err != nil {
			_ = os.RemoveAll(root)
			return "", "", err
		}
	}

	return root, chartDir, nil
}

func isSafeRelPath(p string) bool {
	if p == "" || strings.HasPrefix(p, "/") || strings.Contains(p, "\x00") || strings.Contains(p, "\\") {
		return false
	}
	norm := path.Clean(p)
	if norm == "." || strings.HasPrefix(norm, "..") || strings.Contains(norm, "/../") {
		return false
	}
	return norm == p
}

func sanitizeName(value string, fallback string, maxLen int) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			b.WriteRune(r)
		} else {
			b.WriteByte('-')
		}
	}
	out := b.String()
	if len(out) > maxLen {
		out = out[:maxLen]
	}
	if out == "" {
		return fallback
	}
	return out
}

func helmSDKVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return ""
	}
	for _, dep := range info.Deps {
		if dep.Path != "helm.sh/helm/v4" {
			continue
		}
		if dep.Replace != nil && dep.Replace.Version != "" {
			return dep.Replace.Version + " sdk"
		}
		if dep.Version != "" {
			return dep.Version + " sdk"
		}
	}
	return ""
}

func sendJSON(w http.ResponseWriter, status int, body renderResponse) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
