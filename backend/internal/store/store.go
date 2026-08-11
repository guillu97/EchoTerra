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
	// Leaderboard: one row per STARTED game, refreshed on every save and surviving
	// the game row itself — the ranking screen reads from here, so a town's record
	// outlives the purge of its game.
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS leaderboard (
		game_id         TEXT PRIMARY KEY,
		town_name       TEXT NOT NULL,
		game_name       TEXT NOT NULL,
		mode            TEXT NOT NULL,
		players         TEXT NOT NULL,
		days            INTEGER NOT NULL,
		waves           INTEGER NOT NULL,
		monsters_killed INTEGER NOT NULL,
		game_over       INTEGER NOT NULL,
		updated_at      BIGINT NOT NULL
	)`); err != nil {
		return nil, fmt.Errorf("migrate leaderboard: %w", err)
	}
	// Databases written before the leaderboard was split by mode lack the column.
	if _, err := db.Exec(`ALTER TABLE leaderboard ADD COLUMN mode TEXT NOT NULL DEFAULT 'private'`); err != nil && !alreadyExists(err) {
		return nil, fmt.Errorf("migrate leaderboard mode: %w", err)
	}
	// Saisons (P8) : un classement cumulatif se fige, découpé en saisons il redevient
	// atteignable. Les lignes écrites avant la colonne restent « hors saison » ('') —
	// elles ne figurent que dans la vue « toutes saisons ».
	if _, err := db.Exec(`ALTER TABLE leaderboard ADD COLUMN season TEXT NOT NULL DEFAULT ''`); err != nil && !alreadyExists(err) {
		return nil, fmt.Errorf("migrate leaderboard season: %w", err)
	}
	// Thème d'expédition (theme.go) : deux villes de natures différentes ne se lisent
	// pas de la même façon, donc le tableau doit dire laquelle est laquelle. Les
	// lignes d'avant portent '' — elles sont tempérées par construction, mais on ne le
	// DEVINE pas : on les laisse sans thème.
	if _, err := db.Exec(`ALTER TABLE leaderboard ADD COLUMN theme TEXT NOT NULL DEFAULT ''`); err != nil && !alreadyExists(err) {
		return nil, fmt.Errorf("migrate leaderboard theme: %w", err)
	}
	if err := s.migrateAuth(); err != nil {
		return nil, err
	}
	if err := s.migrateChronicle(); err != nil {
		return nil, err
	}
	if err := s.migrateGameColumns(); err != nil {
		return nil, err
	}
	return s, nil
}

// ScoreEntry is one town's record on the leaderboard: which kind of run it was
// (solo / public / private), how long it survived and how many monsters it slew.
type ScoreEntry struct {
	GameID         string    `json:"gameId"`
	TownName       string    `json:"townName"`
	GameName       string    `json:"gameName"`
	Mode           string    `json:"mode"`   // "solo" | "public" | "private"
	Season         string    `json:"season"` // "2026-08" ; "" = ligne d'avant les saisons
	Theme          string    `json:"theme"`  // nature de l'expédition ; "" = ligne d'avant les thèmes
	Players        []string  `json:"players"`
	Days           int       `json:"days"`
	Waves          int       `json:"waves"`
	MonstersKilled int       `json:"monstersKilled"`
	GameOver       bool      `json:"gameOver"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// saveScore upserts the game's leaderboard row. Lobbies haven't played yet and are
// skipped; every started game (active or fallen) keeps its row forever.
func (s *Store) saveScore(gs *game.GameState) error {
	if gs.Status == game.StatusLobby {
		return nil
	}
	names := make([]string, 0, len(gs.Players))
	for _, p := range gs.Players {
		if p.Bot {
			continue // les joueurs-IA ne figurent pas au tableau d'honneur
		}
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
		(game_id, town_name, game_name, mode, season, theme, players, days, waves, monsters_killed, game_over, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(game_id) DO UPDATE SET
			town_name=excluded.town_name, game_name=excluded.game_name, mode=excluded.mode,
			season=excluded.season, theme=excluded.theme, players=excluded.players, days=excluded.days,
			waves=excluded.waves, monsters_killed=excluded.monsters_killed,
			game_over=excluded.game_over, updated_at=excluded.updated_at`),
		gs.ID, gs.Town.Name, gs.Name, gs.LeaderboardMode(), gs.Season(), gs.ThemeID, string(blob),
		gs.Day, gs.WaveNumber, gs.MonstersKilled, gameOver, time.Now().Unix())
	return err
}

// FallenTowns returns the towns that FELL, most recent first. Elles servent de
// mémoire du monde : chaque carte neuve sème les ruines de quelques-unes d'entre elles
// (game.SeedMemorialRuins). Aucune table de plus n'est nécessaire — le classement
// conserve déjà le nom de la ville, ses défenseurs et la vague qui l'a emportée, et il
// survit à la suppression de la partie.
func (s *Store) FallenTowns(limit int) ([]ScoreEntry, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := s.db.Query(s.rebind(`SELECT game_id, town_name, game_name, mode, season, theme, players,
		days, waves, monsters_killed, game_over, updated_at
		FROM leaderboard WHERE game_over = 1 ORDER BY updated_at DESC LIMIT ?`), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanScores(rows)
}

// Leaderboard returns the best towns: longest survival first (waves, the finest
// clock), monsters slain as the tie-breaker. An empty mode ranks every run together;
// "solo" / "public" / "private" restrict it to one kind of game, which is how the
// ranking screen's tabs read it — the three are not comparable.
//
// `season` vide = toutes saisons confondues ; sinon un identifiant de saison
// (game.SeasonFor). Les lignes écrites avant l'existence des saisons portent ” et ne
// figurent donc que dans la vue « toutes saisons » — c'est voulu : on ne sait pas à
// quelle saison les rattacher, et deviner serait pire que les laisser hors concours.
func (s *Store) Leaderboard(mode, season string, limit int) ([]ScoreEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `SELECT game_id, town_name, game_name, mode, season, theme, players,
		days, waves, monsters_killed, game_over, updated_at
		FROM leaderboard`
	where, args := []string{}, []any{}
	if mode != "" {
		where = append(where, `mode = ?`)
		args = append(args, mode)
	}
	// season vide = la vue « toutes saisons » ; SeasonAll est traité par l'appelant.
	if season != "" {
		where = append(where, `season = ?`)
		args = append(args, season)
	}
	for i, w := range where {
		if i == 0 {
			query += ` WHERE ` + w
		} else {
			query += ` AND ` + w
		}
	}
	query += ` ORDER BY waves DESC, monsters_killed DESC, updated_at DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.Query(s.rebind(query), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanScores(rows)
}

// scanScores decodes a leaderboard result set (same column order everywhere).
func scanScores(rows *sql.Rows) ([]ScoreEntry, error) {
	out := []ScoreEntry{}
	for rows.Next() {
		var e ScoreEntry
		var players string
		var gameOver int
		var updated int64
		if err := rows.Scan(&e.GameID, &e.TownName, &e.GameName, &e.Mode, &e.Season, &e.Theme, &players,
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
		// join_open : « on peut encore embarquer ». Une colonne MIROIR de plus, pour la
		// même raison que status — une expédition publique reste ouverte quelques vagues
		// APRÈS son lancement (game.PublicJoinGraceWaves), donc « les parties qu'on peut
		// rejoindre » n'est plus « les parties en statut lobby » et ne peut pas être
		// filtrée après un LIMIT sans rater celles qui comptent.
		`ALTER TABLE games ADD COLUMN join_open INTEGER NOT NULL DEFAULT 0`,
	} {
		if _, err := s.db.Exec(stmt); err != nil && !alreadyExists(err) {
			return fmt.Errorf("migrate games: %w", err)
		}
	}
	return s.backfillGameColumns()
}

// backfillGameColumns fills the mirror columns for rows written before they existed
// (a no-op query once done). The join_open condition matters as much as status: an
// open lobby saved before the column existed would default to 0 and become invisible
// to OpenForJoin — i.e. unjoinable — until someone happened to write it again.
func (s *Store) backfillGameColumns() error {
	rows, err := s.db.Query(`SELECT id, state FROM games WHERE status = '' OR (join_open = 0 AND status = 'lobby')`)
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
		_, _ = s.db.Exec(s.rebind(`UPDATE games SET status = ?, next_wave_at = ?, join_open = ? WHERE id = ?`),
			gs.Status, unixOrZero(gs.NextWaveAt), boolToInt(gs.JoinOpen()), r.id)
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
	_, err = s.db.Exec(s.rebind(`INSERT INTO games (id, state, updated_at, status, next_wave_at, rev, join_open)
		VALUES (?, ?, ?, ?, ?, 1, ?)
		ON CONFLICT(id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at,
			status=excluded.status, next_wave_at=excluded.next_wave_at, rev=games.rev+1,
			join_open=excluded.join_open`),
		gs.ID, string(blob), time.Now().Unix(), gs.Status, unixOrZero(gs.NextWaveAt), boolToInt(gs.JoinOpen()))
	if err == nil {
		_ = s.saveScore(gs)     // instantané best-effort : la partie reste la source de vérité
		_ = s.saveChronicle(gs) // …et la mémoire des comptes qui l'ont vécue (P7)
	}
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
	// Le battement fait avancer les vagues sans joueur connecté : sans ça, une ville
	// qui survit toute seule ne monterait jamais au classement — ni dans la chronique
	// des comptes qui l'ont fondée.
	_ = s.saveScore(gs)
	_ = s.saveChronicle(gs)
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
func (s *Store) List(limit int) ([]*game.GameState, error) { return s.list("", limit) }

// OpenForJoin returns the games a newcomer can still enter — open lobbies AND public
// expeditions still inside their welcome window (game.JoinOpen). Newest first, because
// what a player wants is the freshest expedition, not the most overdue one.
func (s *Store) OpenForJoin(limit int) ([]*game.GameState, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(s.rebind(
		`SELECT state FROM games WHERE join_open = 1 ORDER BY updated_at DESC LIMIT ?`), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanGames(rows)
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ListByStatus returns the most recently updated games IN THAT STATUS. Filtrer dans
// le SQL (sur la colonne miroir `status`) et non après le LIMIT est ce qui garde un
// salon tranquille VISIBLE : un salon public est écrit une fois puis plus jamais,
// tandis que chaque partie active est réécrite à chaque vague ET par le battement
// (toutes les 15 min). Passé ~50 parties, le salon sortait de la fenêtre de
// `List(50)` et la recherche de partie publique ne trouvait plus rien.
func (s *Store) ListByStatus(status string, limit int) ([]*game.GameState, error) {
	return s.list(status, limit)
}

func (s *Store) list(status string, limit int) ([]*game.GameState, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `SELECT state FROM games`
	args := []any{}
	if status != "" {
		query += ` WHERE status = ?`
		args = append(args, status)
	}
	query += ` ORDER BY updated_at DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(s.rebind(query), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanGames(rows)
}

// scanGames decodes a `SELECT state FROM games` result set.
func scanGames(rows *sql.Rows) ([]*game.GameState, error) {
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

// Seasons rend les saisons qui comptent au moins une ville, la plus récente d'abord.
// C'est ce qui alimente le sélecteur du classement : on ne propose pas une saison vide,
// et on n'invente pas de calendrier — seules les saisons RÉELLEMENT jouées existent.
func (s *Store) Seasons(limit int) ([]string, error) {
	if limit <= 0 {
		limit = 24
	}
	rows, err := s.db.Query(s.rebind(
		`SELECT DISTINCT season FROM leaderboard WHERE season <> '' ORDER BY season DESC LIMIT ?`), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
