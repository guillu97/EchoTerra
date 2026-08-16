package store

// LES PRÉFÉRENCES D'UN COMPTE — ce qu'un joueur règle une fois et retrouve partout.
//
// Une ligne par compte, la valeur en blob JSON : c'est la convention de ce dépôt
// (l'état d'une partie entière tient dans une colonne `state`) et ça évite une
// migration à chaque préférence ajoutée.
//
// ⚠ CE QUI ENTRE ICI, ET CE QUI N'Y ENTRE PAS. La LANGUE suit la personne : elle est
// la même sur son téléphone et sur son poste, et c'est exactement ce qu'on veut voir
// traverser les appareils. La qualité graphique, la cadence d'animation ou les effets
// de météo, non : ils décrivent la MACHINE devant laquelle on est assis, et les
// synchroniser imposerait au téléphone les réglages du PC de bureau — ils restent donc
// dans le localStorage, où ils ont toujours été. Ce n'est pas un raccourci : c'est la
// bonne frontière, et il faut la tenir en ajoutant une préférence ici.
//
// Les anonymes n'ont pas de compte, donc pas de ligne : leur langue vit dans le
// localStorage, et le jeu reste entièrement jouable sans s'inscrire — c'est une règle
// de ce projet, pas un oubli.

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// Prefs sont les préférences d'un compte. Tous les champs sont optionnels : une valeur
// absente veut dire « ce joueur n'a rien choisi », et c'est au client de retomber sur
// son défaut (pour la langue : celle du navigateur).
type Prefs struct {
	// Language est le code de langue choisi ("fr", "en"). Vide = jamais choisi.
	Language string `json:"language,omitempty"`
}

func (s *Store) migratePrefs() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS user_prefs (
		user_id    TEXT PRIMARY KEY,
		prefs      TEXT NOT NULL,
		updated_at BIGINT NOT NULL
	)`); err != nil {
		return fmt.Errorf("migrate user_prefs: %w", err)
	}
	return nil
}

// PrefsFor rend les préférences d'un compte. Un compte sans ligne rend des préférences
// VIDES et aucune erreur : « rien de réglé » est un état normal, pas un échec.
func (s *Store) PrefsFor(userID string) (Prefs, error) {
	var raw string
	err := s.db.QueryRow(s.rebind(`SELECT prefs FROM user_prefs WHERE user_id = ?`), userID).Scan(&raw)
	if err == sql.ErrNoRows {
		return Prefs{}, nil
	}
	if err != nil {
		return Prefs{}, err
	}
	var p Prefs
	// Un blob illisible (écrit par une version future, tronqué) ne doit pas empêcher
	// quelqu'un de jouer : on repart des défauts plutôt que de refuser la connexion.
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return Prefs{}, nil
	}
	return p, nil
}

// SavePrefs écrit (ou remplace) les préférences d'un compte.
func (s *Store) SavePrefs(userID string, p Prefs) error {
	raw, err := json.Marshal(p)
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	q := `INSERT INTO user_prefs (user_id, prefs, updated_at) VALUES (?, ?, ?)
	      ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = EXCLUDED.updated_at`
	_, err = s.db.Exec(s.rebind(q), userID, string(raw), now)
	return err
}
