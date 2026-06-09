package share

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"sync"

	"charthouse/api/share/store"
)

var (
	sharedStore     store.Store
	sharedStoreErr  error
	sharedStoreOnce sync.Once
)

func getStore() (store.Store, error) {
	sharedStoreOnce.Do(func() {
		sharedStore, sharedStoreErr = store.New()
	})
	return sharedStore, sharedStoreErr
}

// Handler implements GET ?id=<short-id> and POST {payload}. The backing store
// is selected by SHARE_STORE (memory default; file; supabase) — see api/share/store.
//
// With the default in-memory store, sharing works out of the box, so 503 is
// returned only when an explicitly configured store fails to initialize (e.g.
// SHARE_STORE=supabase with missing credentials). The SPA treats that 503 as a
// signal to fall back to self-contained hash URLs.
func Handler(w http.ResponseWriter, r *http.Request) {
	s, err := getStore()
	if err != nil {
		sendJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "sharing not configured: " + err.Error(),
		})
		return
	}

	switch r.Method {
	case http.MethodGet:
		handleGet(w, r, s)
	case http.MethodPost:
		handlePost(w, r, s)
	default:
		w.Header().Set("allow", "GET, POST")
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func handleGet(w http.ResponseWriter, r *http.Request, s store.Store) {
	id := r.URL.Query().Get("id")
	if !store.IDPattern.MatchString(id) {
		sendJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}

	payload, err := s.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			sendJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
			return
		}
		sendJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	sendJSON(w, http.StatusOK, map[string]any{"id": id, "payload": payload})
}

func handlePost(w http.ResponseWriter, r *http.Request, s store.Store) {
	body := http.MaxBytesReader(w, r.Body, store.MaxPayloadBytes)
	var parsed struct {
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.NewDecoder(body).Decode(&parsed); err != nil {
		sendJSON(w, http.StatusBadRequest, map[string]any{"error": "bad request: " + err.Error()})
		return
	}
	if len(parsed.Payload) == 0 || !looksLikeJSONObject(parsed.Payload) {
		sendJSON(w, http.StatusBadRequest, map[string]any{"error": "payload required"})
		return
	}

	id, err := s.Put(r.Context(), parsed.Payload)
	if err != nil {
		sendJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	sendJSON(w, http.StatusOK, map[string]any{"id": id})
}

func looksLikeJSONObject(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) > 0 && trimmed[0] == '{'
}

func sendJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
