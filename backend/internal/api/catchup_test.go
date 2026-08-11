package api

import (
	"net/http"
	"testing"
	"time"

	"echoterra/internal/game"
	"echoterra/internal/worldgen"
)

// LE RETARD DOIT ARRIVER JUSQU'AU CLIENT.
//
// Une requête de joueur ne rejoue qu'une poignée de vagues (game.RequestBudget :
// quelqu'un attend la réponse), donc au retour d'une absence le serveur en garde en
// réserve. Le client n'avait aucun moyen de le savoir : il sondait toutes les 20 s et
// voyait la ville frappée UNE VAGUE TOUTES LES 20 SECONDES, minuteur à 0. Le payload
// porte désormais `catchUp` — le client redemande aussitôt, et n'affiche qu'un seul
// rapport à l'arrivée.
func TestGamePayloadAnnouncesCatchUp(t *testing.T) {
	s := newTestServer(t)

	// Une partie lancée il y a longtemps : beaucoup plus de vagues dues que le
	// budget d'une requête.
	backlog := time.Duration(game.RequestBudget.Waves+3) * game.WaveInterval
	start := time.Now().Add(-backlog)
	gs := worldgen.NewLobby(0, 0, 7, "Expédition en retard", 1, 8)
	host, err := gs.AddPlayer("Ana", start)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := gs.AddBot(host.ID, start); err != nil {
		t.Fatal(err)
	}
	if err := gs.StartGame(host.ID, start); err != nil {
		t.Fatal(err)
	}
	s.persist(gs)

	var first game.GameState
	if rec := getJSON(t, s, "/api/games/"+gs.ID, &first); rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if first.Status == game.StatusActive && !first.CatchUp {
		t.Fatalf("le payload doit annoncer le retard restant (nextWaveAt=%v)", first.NextWaveAt)
	}

	// En redemandant — ce que fait la boucle de rattrapage du client — on doit
	// CONVERGER : le drapeau retombe, et il retombe en un nombre borné d'appels.
	// ⚠ un état DÉCODÉ À NEUF à chaque tour : `catchUp` est `omitempty`, donc absent
	// du JSON quand il est faux — réutiliser la même variable garderait le `true`
	// du tour précédent et le test ne verrait jamais la convergence.
	var last game.GameState
	done := false
	for i := 0; i < 40 && !done; i++ {
		var cur game.GameState
		if rec := getJSON(t, s, "/api/games/"+gs.ID, &cur); rec.Code != http.StatusOK {
			t.Fatalf("status %d", rec.Code)
		}
		last = cur
		done = !cur.CatchUp
	}
	if !done {
		t.Fatalf("le rattrapage ne converge pas: nextWaveAt=%v status=%s", last.NextWaveAt, last.Status)
	}
	// Convergé = le monde est vraiment à l'heure (ou la ville est tombée), pas
	// seulement un drapeau baissé.
	if last.Status == game.StatusActive && last.NextWaveAt.Before(time.Now()) {
		t.Fatalf("catchUp retombé alors qu'une vague reste due: %v", last.NextWaveAt)
	}
	if last.WaveNumber <= first.WaveNumber {
		t.Fatalf("aucune vague rejouée entre les deux appels (%d -> %d)", first.WaveNumber, last.WaveNumber)
	}
}
