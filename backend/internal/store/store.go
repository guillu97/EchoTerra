// Package store persists game state. For the prototype it serializes the whole
// GameState to JSON and keeps one row per game in SQLite (pure-Go driver, no CGo).
// Swapping to PostgreSQL later only changes the DSN and driver import.
package store

import (
	"database/sql"
	"encoding/json"
	"fmt"

	_ "modernc.org/sqlite"

	"echoterra/internal/game"
)

// Store is a thread-safe-ish persistence layer (SQLite handles its own locking).
type Store struct {
	db *sql.DB
}

// Open opens (or creates) the SQLite database at path and ensures the schema.
func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS games (
		id         TEXT PRIMARY KEY,
		state      TEXT NOT NULL,
		updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
	)`); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &Store{db: db}, nil
}

// Close releases the database handle.
func (s *Store) Close() error { return s.db.Close() }

// Save inserts or updates a game state.
func (s *Store) Save(gs *game.GameState) error {
	blob, err := json.Marshal(gs)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO games (id, state, updated_at) VALUES (?, ?, strftime('%s','now'))
		ON CONFLICT(id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at`,
		gs.ID, string(blob))
	return err
}

// Delete removes a game row (used to purge empty/abandoned lobbies).
func (s *Store) Delete(id string) error {
	_, err := s.db.Exec(`DELETE FROM games WHERE id = ?`, id)
	return err
}

// List returns the most recently updated games (newest first), up to limit.
// The prototype stores state as a JSON blob, so listing decodes each row; fine at
// prototype scale (add real columns/indexes before any public deployment).
func (s *Store) List(limit int) ([]*game.GameState, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`SELECT state FROM games ORDER BY updated_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*game.GameState
	for rows.Next() {
		var blob string
		if err := rows.Scan(&blob); err != nil {
			return nil, err
		}
		var gs game.GameState
		if err := json.Unmarshal([]byte(blob), &gs); err != nil {
			continue // skip unreadable/legacy rows rather than failing the whole list
		}
		out = append(out, &gs)
	}
	return out, rows.Err()
}

// Load fetches a game state by id. Returns (nil, nil) if not found.
func (s *Store) Load(id string) (*game.GameState, error) {
	var blob string
	err := s.db.QueryRow(`SELECT state FROM games WHERE id = ?`, id).Scan(&blob)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var gs game.GameState
	if err := json.Unmarshal([]byte(blob), &gs); err != nil {
		return nil, err
	}
	return &gs, nil
}
