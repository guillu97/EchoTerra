package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"echoterra/internal/game"
)

// --- Rattrapage DEMANDÉ -----------------------------------------------------
//
// `POST /api/games/{id}/catchup` fait avancer UNE partie et ne rend qu'un RÉSUMÉ.
//
// Pourquoi une route à part alors que toute requête de jeu rattrape déjà ? À cause
// des deux choses qu'une requête de jeu ne peut pas faire quand le retard est gros :
//
//   - le BUDGET. Une requête ordinaire ne rejoue qu'une poignée de vagues
//     (game.RequestBudget) parce qu'un joueur attend son écran. Ici il attend le
//     monde, explicitement : on triple la dose (game.CatchUpBudget).
//   - le POIDS. L'état complet d'une partie explorée pèse des centaines de kilo-
//     octets (tuiles, monstres, héros) ; le retéléchargerait-on à chaque tour de
//     boucle qu'un retour de douze heures coûterait plusieurs mégaoctets sur un
//     téléphone, pour n'afficher qu'UN rapport à la fin. Le résumé fait quelques
//     octets, et le client ne recharge l'état complet qu'une fois, à l'arrivée.
//
// Sans effet propre et idempotente comme le battement : elle n'applique que le temps
// écoulé (game.AdvanceTo). L'appeler sur une partie à jour ne fait rien et répond
// `done:true`.

// catchUpResult est le compte rendu d'un tour de rattrapage. Volontairement maigre :
// tout ce dont le client a besoin, c'est de savoir s'il doit redemander, et de quoi
// tenir son compteur en attendant l'état complet.
type catchUpResult struct {
	Done       bool   `json:"done"`               // plus rien à rattraper
	Waves      int    `json:"waves"`              // vagues rejouées PAR CET APPEL
	Skipped    int    `json:"skipped,omitempty"`  // vagues sautées (plafond de retard)
	WaveNumber int    `json:"waveNumber"`         // là où en est la ville
	TownHP     int    `json:"townHp"`             // ses PV, pour suivre la casse
	Status     string `json:"status"`             // "active" | "gameover"
	NextWaveAt string `json:"nextWaveAt,omitzero"`
}

func (s *Server) catchUpGame(w http.ResponseWriter, r *http.Request) {
	// ⚠ PAS mustGame : il lance déjà un tick() au budget de requête, donc on paierait
	// deux rattrapages pour un seul appel — et le premier au mauvais budget.
	gs, err := s.load(chi.URLParam(r, "gameID"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if gs == nil {
		writeErr(w, http.StatusNotFound, "partie introuvable")
		return
	}
	res := gs.AdvanceTo(time.Now(), game.CatchUpBudget)
	if res.Changed {
		s.persist(gs)
	} else {
		gs.Recompute()
	}
	out := catchUpResult{
		// `Done` du rattrapage ET plus aucune vague due : le budget peut s'épuiser
		// pile sur la dernière vague, auquel cas res.Done est vrai alors qu'il reste
		// à jouer. On répond au client la MÊME question que celle qu'il posait au
		// payload de jeu (`catchUp`), sinon les deux se contrediraient.
		Done:       !gs.CatchUpPending(time.Now()),
		Waves:      res.Waves,
		Skipped:    res.SkippedWaves,
		WaveNumber: gs.WaveNumber,
		TownHP:     gs.Town.HP,
		Status:     gs.Status,
	}
	if !gs.NextWaveAt.IsZero() {
		out.NextWaveAt = gs.NextWaveAt.Format(time.RFC3339Nano)
	}
	writeJSON(w, http.StatusOK, out)
}
