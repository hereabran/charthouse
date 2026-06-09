package share

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	sharesTable     = "charthouse_shares"
	upstreamTimeout = 8 * time.Second
)

// supabaseStore persists shares in a Supabase (PostgREST) table using the
// service-role key. Opt-in via SHARE_STORE=supabase; the key is server-only.
type supabaseStore struct {
	baseURL string
	key     string
}

type supabaseRow struct {
	ID      string          `json:"id"`
	Payload json.RawMessage `json:"payload"`
}

func newSupabaseStore() (*supabaseStore, error) {
	base := strings.TrimRight(os.Getenv("SUPABASE_URL"), "/")
	key := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	if base == "" || key == "" {
		return nil, fmt.Errorf("SHARE_STORE=supabase requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY")
	}
	return &supabaseStore{baseURL: base, key: key}, nil
}

func (s *supabaseStore) auth(req *http.Request) {
	req.Header.Set("apikey", s.key)
	req.Header.Set("Authorization", "Bearer "+s.key)
}

func (s *supabaseStore) Get(ctx context.Context, id string) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(ctx, upstreamTimeout)
	defer cancel()

	endpoint := fmt.Sprintf("%s/rest/v1/%s?id=eq.%s&select=payload&limit=1",
		s.baseURL, sharesTable, url.QueryEscape(id))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	s.auth(req)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("supabase unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("supabase %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var rows []supabaseRow
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0].Payload, nil
}

func (s *supabaseStore) Put(ctx context.Context, payload json.RawMessage) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, upstreamTimeout)
	defer cancel()

	id, err := NewID()
	if err != nil {
		return "", err
	}
	row, err := json.Marshal(supabaseRow{ID: id, Payload: payload})
	if err != nil {
		return "", err
	}

	endpoint := fmt.Sprintf("%s/rest/v1/%s", s.baseURL, sharesTable)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(row))
	if err != nil {
		return "", err
	}
	s.auth(req)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("supabase unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("supabase %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return id, nil
}
