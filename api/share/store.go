// Package share provides pluggable persistence for share payloads, selected at
// runtime via the SHARE_STORE environment variable. It keeps Charthouse
// vendor-neutral: the default works with zero configuration and no external
// service, while file and Supabase backends are opt-in.
package share

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
)

const (
	// MaxPayloadBytes caps an accepted share payload.
	MaxPayloadBytes = 256 * 1024

	// idAlphabet excludes ambiguous characters (0/1/i/l/o) so ids are safe to
	// read aloud or transcribe. 31 symbols ^ 8 chars ≈ 8.5e11 keyspace.
	idAlphabet = "23456789abcdefghjkmnpqrstuvwxyz"
	idLength   = 8
)

// ErrNotFound is returned by Get when no share exists for the id.
var ErrNotFound = errors.New("share not found")

// IDPattern validates ids accepted from clients (also covers legacy 6–16 char ids).
var IDPattern = regexp.MustCompile(`^[a-z0-9]{6,16}$`)

// Store persists an opaque JSON share payload keyed by a short id.
type Store interface {
	Put(ctx context.Context, payload json.RawMessage) (id string, err error)
	Get(ctx context.Context, id string) (payload json.RawMessage, err error)
}

// newStore selects a Store from the environment:
//
//	SHARE_STORE=memory   (default) ephemeral in-process map — links die on restart
//	SHARE_STORE=file     JSON files under SHARE_DIR (default ./data/shares)
//	SHARE_STORE=supabase Supabase PostgREST (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
//
// An error here is surfaced by the handler as 503 so the SPA falls back to
// self-contained hash URLs.
func newStore() (Store, error) {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("SHARE_STORE"))) {
	case "", "memory":
		return newMemoryStore(), nil
	case "file":
		return newFileStore(os.Getenv("SHARE_DIR"))
	case "supabase":
		return newSupabaseStore()
	default:
		return nil, fmt.Errorf("unknown SHARE_STORE %q (want memory|file|supabase)", os.Getenv("SHARE_STORE"))
	}
}

// NewID returns a random short id from the unambiguous alphabet.
func NewID() (string, error) {
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
