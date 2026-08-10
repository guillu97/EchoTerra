package store

// LA CHRONIQUE DE COMPTE — l'identité qui traverse les parties (P7 de RETENTION-PLAN.md).
//
// Le problème qu'elle règle : une expédition finit toujours par tomber, et jusqu'ici
// tout mourait avec elle. Un joueur qui a tenu vingt vagues, bâti une tour et rapporté
// six cents objets n'en gardait RIEN — la partie suivante repartait de zéro sur tous les
// plans, y compris celui de la mémoire. Or c'est la seule chose qu'on peut faire
// traverser sans casser le jeu.
//
// ⚠ COSMÉTIQUE, JAMAIS DE LA PUISSANCE. Même règle que les mémoriaux (game/ruins.go) :
// aucun bonus, aucun objet, aucun plan ne passe d'une partie à l'autre. Un vétéran et un
// débutant qui rejoignent la même ville y arrivent strictement égaux — c'est cette
// égalité qui fait tenir une survie de groupe. Ce qui traverse, c'est le SOUVENIR.
//
// Une ligne par (compte, partie), écrite en même temps que la ligne de classement et
// SURVIVANT à la suppression de la partie — comme le classement, et pour la même raison :
// c'est justement quand la ville n'est plus là qu'on veut se souvenir d'elle.

import (
	"fmt"
	"time"

	"echoterra/internal/game"
)

// ChronicleEntry est UNE expédition vécue par un compte, et ce que ce compte y a apporté.
type ChronicleEntry struct {
	GameID         string `json:"gameId"`
	TownName       string `json:"townName"`
	Mode           string `json:"mode"` // "solo" | "public" | "private"
	PlayerName     string `json:"playerName"`
	Days           int    `json:"days"`
	Waves          int    `json:"waves"`
	MonstersKilled int    `json:"monstersKilled"` // de la VILLE (score partagé)
	GameOver       bool   `json:"gameOver"`
	// Ce que CE joueur a apporté (miroir de game.Contribution).
	BuildPA   int       `json:"buildPa"`
	Deposited int       `json:"deposited"`
	Slain     int       `json:"slain"`
	Repaired  int       `json:"repaired"`
	Crafted   int       `json:"crafted"`
	Filled    int       `json:"filled"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (s *Store) migrateChronicle() error {
	_, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS chronicle (
		user_id         TEXT NOT NULL,
		game_id         TEXT NOT NULL,
		town_name       TEXT NOT NULL,
		mode            TEXT NOT NULL,
		player_name     TEXT NOT NULL,
		days            INTEGER NOT NULL,
		waves           INTEGER NOT NULL,
		monsters_killed INTEGER NOT NULL,
		game_over       INTEGER NOT NULL,
		build_pa        INTEGER NOT NULL,
		deposited       INTEGER NOT NULL,
		slain           INTEGER NOT NULL,
		repaired        INTEGER NOT NULL,
		crafted         INTEGER NOT NULL,
		filled          INTEGER NOT NULL,
		updated_at      BIGINT NOT NULL,
		PRIMARY KEY (user_id, game_id)
	)`)
	if err != nil {
		return fmt.Errorf("migrate chronicle: %w", err)
	}
	return nil
}

// saveChronicle upserte une ligne par joueur CONNECTÉ de la partie. Les anonymes n'ont
// pas de compte où l'écrire (Player.UserID vide) et les joueurs-IA n'ont rien vécu.
func (s *Store) saveChronicle(gs *game.GameState) error {
	if gs.Status == game.StatusLobby {
		return nil // rien de vécu tant que l'expédition n'est pas partie
	}
	now := time.Now().Unix()
	gameOver := 0
	if gs.Status == game.StatusGameOver {
		gameOver = 1
	}
	for _, p := range gs.Players {
		if p.Bot || p.UserID == "" {
			continue
		}
		c := gs.Contributions[p.ID]
		if c == nil {
			c = &game.Contribution{}
		}
		if _, err := s.db.Exec(s.rebind(`INSERT INTO chronicle
			(user_id, game_id, town_name, mode, player_name, days, waves, monsters_killed,
			 game_over, build_pa, deposited, slain, repaired, crafted, filled, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(user_id, game_id) DO UPDATE SET
				town_name=excluded.town_name, mode=excluded.mode, player_name=excluded.player_name,
				days=excluded.days, waves=excluded.waves, monsters_killed=excluded.monsters_killed,
				game_over=excluded.game_over, build_pa=excluded.build_pa,
				deposited=excluded.deposited, slain=excluded.slain, repaired=excluded.repaired,
				crafted=excluded.crafted, filled=excluded.filled, updated_at=excluded.updated_at`),
			p.UserID, gs.ID, gs.Town.Name, gs.LeaderboardMode(), p.Name,
			gs.Day, gs.WaveNumber, gs.MonstersKilled, gameOver,
			c.BuildPA, c.Deposited, c.Slain, c.Repaired, c.Crafted, c.Filled, now); err != nil {
			return err
		}
	}
	return nil
}

// Chronicle rend les expéditions d'un compte, la plus récente d'abord.
func (s *Store) Chronicle(userID string, limit int) ([]ChronicleEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(s.rebind(`SELECT game_id, town_name, mode, player_name, days, waves,
		monsters_killed, game_over, build_pa, deposited, slain, repaired, crafted, filled, updated_at
		FROM chronicle WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`), userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChronicleEntry{}
	for rows.Next() {
		var e ChronicleEntry
		var over int
		var ts int64
		if err := rows.Scan(&e.GameID, &e.TownName, &e.Mode, &e.PlayerName, &e.Days, &e.Waves,
			&e.MonstersKilled, &over, &e.BuildPA, &e.Deposited, &e.Slain, &e.Repaired,
			&e.Crafted, &e.Filled, &ts); err != nil {
			return nil, err
		}
		e.GameOver = over == 1
		e.UpdatedAt = time.Unix(ts, 0).UTC()
		out = append(out, e)
	}
	return out, rows.Err()
}
