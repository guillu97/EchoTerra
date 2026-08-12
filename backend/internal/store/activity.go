package store

// L'ACTIVITÉ — le seul fait mesuré du jeu (R3 de RETENTION-PLAN.md).
//
// Le plan le dit depuis sa première version : « tant que la rétention J3/J7 n'est pas
// suivie, tout le reste est une opinion ». Neuf propositions ont été livrées depuis, et
// aucune n'a jamais été confrontée à un chiffre — on a raisonné sur des mécaniques, ce
// qui est nécessaire mais jamais suffisant.
//
// Ce fichier tient la donnée MINIMALE qui permet de répondre : **qui a joué, à quelle
// expédition, quel jour**. Une ligne par (compte, partie, jour civil), un compteur
// d'actions, et rien d'autre.
//
// ⚠ TROIS CADRAGES, tous délibérés.
//
//  1. **UN JOUR CIVIL UTC, pas un horodatage.** On ne cherche pas à savoir à quelle
//     heure quelqu'un joue — on cherche à savoir s'il REVIENT. Le jour est la maille
//     naturelle de cette question, et c'est aussi la maille la moins indiscrète.
//  2. **RIEN SUR LES ANONYMES.** La rétention se mesure sur des COMPTES : un joueur sans
//     compte n'a pas d'identité qui traverse les parties, donc « est-il revenu ? » n'a
//     pas de réponse le concernant. Le chiffre publié doit donc se lire « rétention des
//     comptes », et sous-estime l'activité réelle. Mieux vaut un chiffre dont on connaît
//     le biais qu'un chiffre qu'on croit total.
//  3. **AUCUNE DONNÉE PERSONNELLE NOUVELLE.** Ni adresse IP, ni agent, ni action
//     détaillée : un identifiant de compte qu'on possède déjà, un identifiant de partie,
//     une date, un compteur. Les vues servies (metrics.go) sont AGRÉGÉES.

import (
	"time"
)

// ActivityDayFormat : le jour civil UTC, tel qu'il est stocké et rendu.
const ActivityDayFormat = "2006-01-02"

// ActivityRow est une ligne brute : ce compte a agi sur cette partie ce jour-là.
type ActivityRow struct {
	UserID  string `json:"userId"`
	GameID  string `json:"gameId"`
	Day     string `json:"day"`
	Actions int    `json:"actions"`
}

func (s *Store) migrateActivity() error {
	_, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS activity (
		user_id TEXT NOT NULL,
		game_id TEXT NOT NULL,
		day     TEXT NOT NULL,
		actions INTEGER NOT NULL,
		PRIMARY KEY (user_id, game_id, day)
	)`)
	return err
}

// RecordActivity note qu'un compte a agi sur une partie. Idempotent par jour : la
// centième action d'une soirée n'ajoute qu'un incrément, pas une ligne.
//
// Silencieux sur un compte vide (anonyme) — voir le cadrage 2 en tête de fichier.
func (s *Store) RecordActivity(userID, gameID string, at time.Time) error {
	if userID == "" || gameID == "" {
		return nil
	}
	day := at.UTC().Format(ActivityDayFormat)
	_, err := s.db.Exec(s.rebind(`INSERT INTO activity (user_id, game_id, day, actions)
		VALUES (?, ?, ?, 1)
		ON CONFLICT(user_id, game_id, day) DO UPDATE SET actions = activity.actions + 1`),
		userID, gameID, day)
	return err
}

// Activity rend les lignes brutes depuis ce jour (inclus), triées par jour.
//
// ⚠ ON REND DU BRUT ET ON AGRÈGE EN GO (metrics.go). Le calcul de cohortes demande de
// l'arithmétique de dates, et elle ne s'écrit pas pareil en SQLite et en Postgres — les
// deux moteurs que ce store sert. Le volume est celui d'un prototype : quelques milliers
// de lignes au plus, lues une fois quand on regarde les chiffres.
func (s *Store) Activity(since string) ([]ActivityRow, error) {
	rows, err := s.db.Query(s.rebind(
		`SELECT user_id, game_id, day, actions FROM activity WHERE day >= ? ORDER BY day, user_id`), since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ActivityRow{}
	for rows.Next() {
		var a ActivityRow
		if err := rows.Scan(&a.UserID, &a.GameID, &a.Day, &a.Actions); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
