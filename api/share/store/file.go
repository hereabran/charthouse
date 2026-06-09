package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const defaultShareDir = "./data/shares"

// fileStore persists one JSON file per share under a directory. Durable across
// restarts; good for single-node self-hosting with a mounted volume.
type fileStore struct {
	dir string
}

type fileRecord struct {
	ID      string          `json:"id"`
	Payload json.RawMessage `json:"payload"`
}

func newFileStore(dir string) (*fileStore, error) {
	if dir == "" {
		dir = defaultShareDir
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("share dir %q: %w", dir, err)
	}
	return &fileStore{dir: dir}, nil
}

func (s *fileStore) path(id string) string {
	return filepath.Join(s.dir, id+".json")
}

func (s *fileStore) Put(_ context.Context, payload json.RawMessage) (string, error) {
	for range 8 {
		id, err := NewID()
		if err != nil {
			return "", err
		}
		dest := s.path(id)
		if _, err := os.Stat(dest); err == nil {
			continue // id collision, retry
		}
		rec, err := json.Marshal(fileRecord{ID: id, Payload: payload})
		if err != nil {
			return "", err
		}
		// Atomic publish: write to a temp file in the same dir, then rename.
		tmp, err := os.CreateTemp(s.dir, ".tmp-*")
		if err != nil {
			return "", err
		}
		tmpName := tmp.Name()
		if _, err := tmp.Write(rec); err != nil {
			tmp.Close()
			os.Remove(tmpName)
			return "", err
		}
		if err := tmp.Close(); err != nil {
			os.Remove(tmpName)
			return "", err
		}
		if err := os.Rename(tmpName, dest); err != nil {
			os.Remove(tmpName)
			return "", err
		}
		return id, nil
	}
	return "", errors.New("could not allocate a unique share id")
}

func (s *fileStore) Get(_ context.Context, id string) (json.RawMessage, error) {
	// Defense in depth: never let an unvalidated id touch the filesystem path.
	if !IDPattern.MatchString(id) {
		return nil, ErrNotFound
	}
	data, err := os.ReadFile(s.path(id))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	var rec fileRecord
	if err := json.Unmarshal(data, &rec); err != nil {
		return nil, err
	}
	return rec.Payload, nil
}
