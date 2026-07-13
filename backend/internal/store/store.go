// Package store persists game state. For the prototype it serializes the whole
// GameState to JSON and keeps one row per game. Two backends share the same schema:
// SQLite (local dev, pure-Go driver, no CGo) and PostgreSQL (serverless deploys —
// e.g. Neon behind Vercel — where the filesystem is ephemeral). The DSN picks the
// backend: a "postgres://" / "postgresql://" URL means Postgres, anything else is
// treated as a SQLite file path.
package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	_ "github.com/lib/pq"
	_ "modernc.org/sqlite"

	"echoterra/internal/game"
)

// Store is a thread-safe-ish persistence layer (the database handles its own locking).
type Store struct {
	db       *sql.DB
	postgres bool
}

// Open opens the database named by dsn (SQLite path or Postgres URL) and ensures
// the schema.
func Open(dsn string) (*Store, error) {
	driver := "sqlite"
	postgres := strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://")
	if postgres {
		driver = "postgres"
	}
	db, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	s := &Store{db: db, postgres: postgres}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS games (
		id         TEXT PRIMARY KEY,
		state      TEXT NOT NULL,
		updated_at BIGINT NOT NULL
	)`); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	// Leaderboard: one row per started game, kept up to date on every save and
	// surviving game deletion — the title-screen ranking reads from here.
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS leaderboard (
		game_id         TEXT PRIMARY KEY,
		town_name       TEXT NOT NULL,
		game_name       TEXT NOT NULL,
		players         TEXT NOT NULL,
		days            INTEGER NOT NULL,
		waves           INTEGER NOT NULL,
		monsters_killed INTEGER NOT NULL,
		game_over       INTEGER NOT NULL,
		updated_at      BIGINT NOT NULL
	)`); err != nil {
		return nil, fmt.Errorf("migrate leaderboard: %w", err)
	}
	if err := s.migrateAuth(); err != nil {
		return nil, err
	}
	return s, nil
}

// ScoreEntry is one town's achievements on the leaderboard: how long it survived
// (days/waves) and how many monsters its players slew.
type ScoreEntry struct {
	GameID         string    `json:"gameId"`
	TownName       string    `json:"townName"`
	GameName       string    `json:"gameName"`
	Players        []string  `json:"players"`
	Days           int       `json:"days"`
	Waves          int       `json:"waves"`
	MonstersKilled int       `json:"monstersKilled"`
	GameOver       bool      `json:"gameOver"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// saveScore upserts the game's leaderboard row. Lobbies haven't played yet and are
// skipped; everything else (active or fallen towns) keeps its row forever, even
// after the game row itself is purged.
func (s *Store) saveScore(gs *game.GameState) error {
	if gs.Status == game.StatusLobby {
		return nil
	}
	names := make([]string, 0, len(gs.Players))
	for _, p := range gs.Players {
		names = append(names, p.Name)
	}
	blob, err := json.Marshal(names)
	if err != nil {
		return err
	}
	gameOver := 0
	if gs.Status == game.StatusGameOver {
		gameOver = 1
	}
	_, err = s.db.Exec(s.rebind(`INSERT INTO leaderboard
		(game_id, town_name, game_name, players, days, waves, monsters_killed, game_over, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(game_id) DO UPDATE SET
			town_name=excluded.town_name, game_name=excluded.game_name,
			players=excluded.players, days=excluded.days, waves=excluded.waves,
			monsters_killed=excluded.monsters_killed, game_over=excluded.game_over,
			updated_at=excluded.updated_at`),
		gs.ID, gs.Town.Name, gs.Name, string(blob),
		gs.Day, gs.WaveNumber, gs.MonstersKilled, gameOver, time.Now().Unix())
	return err
}

// Leaderboard returns the best towns: longest survival first (waves, the finest
// clock), monsters slain as the tie-breaker.
func (s *Store) Leaderboard(limit int) ([]ScoreEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(s.rebind(`SELECT game_id, town_name, game_name, players,
		days, waves, monsters_killed, game_over, updated_at
		FROM leaderboard ORDER BY waves DESC, monsters_killed DESC, updated_at DESC LIMIT ?`), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ScoreEntry{}
	for rows.Next() {
		var e ScoreEntry
		var players string
		var gameOver int
		var updated int64
		if err := rows.Scan(&e.GameID, &e.TownName, &e.GameName, &players,
			&e.Days, &e.Waves, &e.MonstersKilled, &gameOver, &updated); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(players), &e.Players); err != nil || e.Players == nil {
			e.Players = []string{}
		}
		e.GameOver = gameOver != 0
		e.UpdatedAt = time.Unix(updated, 0)
		out = append(out, e)
	}
	return out, rows.Err()
}

// rebind converts ?-style placeholders to $1..$n for Postgres.
func (s *Store) rebind(query string) string {
	if !s.postgres {
		return query
	}
	var b strings.Builder
	n := 0
	for _, c := range query {
		if c == '?' {
			n++
			b.WriteByte('$')
			b.WriteString(strconv.Itoa(n))
			continue
		}
		b.WriteRune(c)
	}
	return b.String()
}

// Close releases the database handle.
func (s *Store) Close() error { return s.db.Close() }

// Save inserts or updates a game state.
func (s *Store) Save(gs *game.GameState) error {
	blob, err := json.Marshal(gs)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(s.rebind(`INSERT INTO games (id, state, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at`),
		gs.ID, string(blob), time.Now().Unix())
	if err == nil {
		// Best-effort achievements snapshot; the game save stays the source of truth.
		_ = s.saveScore(gs)
	}
	return err
}

// Delete removes a game row (used to purge empty/abandoned lobbies).
func (s *Store) Delete(id string) error {
	_, err := s.db.Exec(s.rebind(`DELETE FROM games WHERE id = ?`), id)
	return err
}

// List returns the most recently updated games (newest first), up to limit.
// The prototype stores state as a JSON blob, so listing decodes each row; fine at
// prototype scale (add real columns/indexes before any public deployment).
func (s *Store) List(limit int) ([]*game.GameState, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(s.rebind(`SELECT state FROM games ORDER BY updated_at DESC LIMIT ?`), limit)
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
	err := s.db.QueryRow(s.rebind(`SELECT state FROM games WHERE id = ?`), id).Scan(&blob)
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
