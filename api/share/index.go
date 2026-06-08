package share

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

const (
	maxPayloadBytes  = 256 * 1024
	sharesTable      = "helm_playground_shares"
	idAlphabet       = "23456789abcdefghjkmnpqrstuvwxyz"
	idLength         = 8
	upstreamTimeout  = 8 * time.Second
)

var idPattern = regexp.MustCompile(`^[a-z0-9]{6,16}$`)

type shareRow struct {
	ID      string          `json:"id"`
	Payload json.RawMessage `json:"payload"`
}

// Handler implements GET ?id=<short-id> and POST {payload} against Supabase.
// Returns 503 when Supabase env vars are absent so the SPA falls back to
// hash-encoded URLs.
func Handler(w http.ResponseWriter, r *http.Request) {
	supabaseURL := strings.TrimRight(os.Getenv("SUPABASE_URL"), "/")
	supabaseKey := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	if supabaseURL == "" || supabaseKey == "" {
		sendJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "sharing not configured: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), upstreamTimeout)
	defer cancel()

	switch r.Method {
	case http.MethodGet:
		handleGet(ctx, w, r, supabaseURL, supabaseKey)
	case http.MethodPost:
		handlePost(ctx, w, r, supabaseURL, supabaseKey)
	default:
		w.Header().Set("allow", "GET, POST")
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func handleGet(ctx context.Context, w http.ResponseWriter, r *http.Request, sbURL, sbKey string) {
	id := r.URL.Query().Get("id")
	if !idPattern.MatchString(id) {
		sendJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}

	endpoint := fmt.Sprintf("%s/rest/v1/%s?id=eq.%s&select=payload&limit=1",
		sbURL, sharesTable, url.QueryEscape(id))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	req.Header.Set("apikey", sbKey)
	req.Header.Set("Authorization", "Bearer "+sbKey)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		sendJSON(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("supabase unreachable: %s", err.Error())})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		sendJSON(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("supabase %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))})
		return
	}

	var rows []shareRow
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		sendJSON(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("decode: %s", err.Error())})
		return
	}
	if len(rows) == 0 {
		sendJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
		return
	}

	sendJSON(w, http.StatusOK, map[string]any{
		"id":      id,
		"payload": rows[0].Payload,
	})
}

func handlePost(ctx context.Context, w http.ResponseWriter, r *http.Request, sbURL, sbKey string) {
	body := http.MaxBytesReader(w, r.Body, maxPayloadBytes)
	var parsed struct {
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.NewDecoder(body).Decode(&parsed); err != nil {
		sendJSON(w, http.StatusBadRequest, map[string]any{"error": fmt.Sprintf("bad request: %s", err.Error())})
		return
	}
	if len(parsed.Payload) == 0 || !looksLikeJSONObject(parsed.Payload) {
		sendJSON(w, http.StatusBadRequest, map[string]any{"error": "payload required"})
		return
	}

	id, err := newID()
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	row, err := json.Marshal(struct {
		ID      string          `json:"id"`
		Payload json.RawMessage `json:"payload"`
	}{ID: id, Payload: parsed.Payload})
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	endpoint := fmt.Sprintf("%s/rest/v1/%s", sbURL, sharesTable)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(row))
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	req.Header.Set("apikey", sbKey)
	req.Header.Set("Authorization", "Bearer "+sbKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		sendJSON(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("supabase unreachable: %s", err.Error())})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		sendJSON(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("supabase %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))})
		return
	}

	sendJSON(w, http.StatusOK, map[string]any{"id": id})
}

func looksLikeJSONObject(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) > 0 && trimmed[0] == '{'
}

func newID() (string, error) {
	buf := make([]byte, idLength)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	out := make([]byte, idLength)
	for i, b := range buf {
		out[i] = idAlphabet[int(b)%len(idAlphabet)]
	}
	return string(out), nil
}

func sendJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
