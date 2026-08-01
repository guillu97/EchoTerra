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
	"errors"
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
	if err := s.migrateAuth(); err != nil {
		return nil, err
	}
	if err := s.migrateGameColumns(); err != nil {
		return nil, err
	}
	return s, nil
}

// migrateGameColumns adds the columns the heartbeat needs (see ActiveGames): the
// game's status and next-wave time, mirrored OUT of the JSON blob so a sweep can
// pick the games to advance without decoding every row, plus a revision counter for
// the conditional save (SaveIfUnchanged). ALTER TABLE ADD COLUMN is idempotent-by-
// error here: both drivers report an "already exists" error we can ignore, which is
// simpler and more portable than probing the schema.
func (s *Store) migrateGameColumns() error {
	for _, stmt := range []string{
		`ALTER TABLE games ADD COLUMN status TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE games ADD COLUMN next_wave_at BIGINT NOT NULL DEFAULT 0`,
		`ALTER TABLE games ADD COLUMN rev BIGINT NOT NULL DEFAULT 0`,
	} {
		if _, err := s.db.Exec(stmt); err != nil && !alreadyExists(err) {
			return fmt.Errorf("migrate games: %w", err)
		}
	}
	return s.backfillGameColumns()
}

// backfillGameColumns fills status/next_wave_at for rows written before the columns
// existed (a no-op query once done).
func (s *Store) backfillGameColumns() error {
	rows, err := s.db.Query(`SELECT id, state FROM games WHERE status = ''`)
	if err != nil {
		return nil // pre-migration databases only; never block startup on the backfill
	}
	type row struct {
		id, blob string
	}
	var pending []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.blob); err == nil {
			pending = append(pending, r)
		}
	}
	rows.Close()
	for _, r := range pending {
		var gs game.GameState
		if err := json.Unmarshal([]byte(r.blob), &gs); err != nil {
			continue
		}
		_, _ = s.db.Exec(s.rebind(`UPDATE games SET status = ?, next_wave_at = ? WHERE id = ?`),
			gs.Status, unixOrZero(gs.NextWaveAt), r.id)
	}
	return nil
}

func unixOrZero(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.Unix()
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

// alreadyExists reports whether err is a "column/table already exists" migration
// error (SQLite says "duplicate column name", Postgres "already exists").
func alreadyExists(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "exists") || strings.Contains(msg, "duplicate")
}

// ErrConflict is returned by SaveIfUnchanged when the row was written by someone else
// since it was loaded.
var ErrConflict = errors.New("game modified concurrently")

// Save inserts or updates a game state, unconditionally (last writer wins).
func (s *Store) Save(gs *game.GameState) error {
	blob, err := json.Marshal(gs)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(s.rebind(`INSERT INTO games (id, state, updated_at, status, next_wave_at, rev)
		VALUES (?, ?, ?, ?, ?, 1)
		ON CONFLICT(id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at,
			status=excluded.status, next_wave_at=excluded.next_wave_at, rev=games.rev+1`),
		gs.ID, string(blob), time.Now().Unix(), gs.Status, unixOrZero(gs.NextWaveAt))
	return err
}

// SaveIfUnchanged writes the state only if the row is still at the revision the state
// was loaded at, and returns ErrConflict otherwise. C'est la sauvegarde du BATTEMENT :
// il tourne en fond, éventuellement sur une autre instance qu'un joueur en train
// d'agir, et ne doit JAMAIS écraser une action de joueur — en cas de conflit il
// abandonne simplement son rattrapage (la requête du joueur l'aura fait de son côté).
func (s *Store) SaveIfUnchanged(gs *game.GameState) error {
	blob, err := json.Marshal(gs)
	if err != nil {
		return err
	}
	res, err := s.db.Exec(s.rebind(`UPDATE games SET state=?, updated_at=?, status=?, next_wave_at=?, rev=rev+1
		WHERE id=? AND rev=?`),
		string(blob), time.Now().Unix(), gs.Status, unixOrZero(gs.NextWaveAt), gs.ID, gs.Rev)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return ErrConflict
	}
	return nil
}

// ActiveGames returns running games ordered by the OLDEST next wave first, so a
// heartbeat that can only handle a few per sweep always serves the most overdue ones
// (a game left behind keeps its old next_wave_at, so it stays at the head until it is
// caught up). States carry their Rev for SaveIfUnchanged.
func (s *Store) ActiveGames(limit int) ([]*game.GameState, error) {
	if limit <= 0 {
		limit = 25
	}
	rows, err := s.db.Query(s.rebind(
		`SELECT state, rev FROM games WHERE status = ? ORDER BY next_wave_at ASC LIMIT ?`),
		game.StatusActive, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*game.GameState
	for rows.Next() {
		var blob string
		var rev int64
		if err := rows.Scan(&blob, &rev); err != nil {
			return nil, err
		}
		var gs game.GameState
		if err := json.Unmarshal([]byte(blob), &gs); err != nil {
			continue // skip unreadable/legacy rows rather than failing the whole sweep
		}
		gs.Rev = rev
		out = append(out, &gs)
	}
	return out, rows.Err()
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
	var rev int64
	err := s.db.QueryRow(s.rebind(`SELECT state, rev FROM games WHERE id = ?`), id).Scan(&blob, &rev)
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
	gs.Rev = rev // révision chargée : base de la sauvegarde conditionnelle du battement
	return &gs, nil
}
