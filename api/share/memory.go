package share

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
)

// memoryStore is the default backend: ephemeral, process-local, zero-config.
// Short links survive only until the process restarts; use file or supabase for
// durability.
type memoryStore struct {
	mu sync.RWMutex
	m  map[string]json.RawMessage
}

func newMemoryStore() *memoryStore {
	return &memoryStore{m: make(map[string]json.RawMessage)}
}

func (s *memoryStore) Put(_ context.Context, payload json.RawMessage) (string, error) {
	cp := append(json.RawMessage(nil), payload...)
	s.mu.Lock()
	defer s.mu.Unlock()
	for range 8 {
		id, err := NewID()
		if err != nil {
			return "", err
		}
		if _, exists := s.m[id]; exists {
			continue
		}
		s.m[id] = cp
		return id, nil
	}
	return "", errors.New("could not allocate a unique share id")
}

func (s *memoryStore) Get(_ context.Context, id string) (json.RawMessage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.m[id]
	if !ok {
		return nil, ErrNotFound
	}
	return append(json.RawMessage(nil), v...), nil
}
