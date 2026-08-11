package api

import (
	"encoding/json"
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

// LA ROUTE DE RATTRAPAGE fait avancer le monde et ne rend qu'un résumé.
//
// Ce qu'elle défend : au retour d'une absence, le client la boucle au lieu de
// recharger l'état complet (des centaines de ko sur une carte explorée) à chaque
// tour. Elle doit donc CONVERGER, avancer plus vite qu'une requête de jeu, et ne
// jamais contredire le drapeau `catchUp` du payload — sinon le client bouclerait
// contre lui-même.
func TestCatchUpRouteAdvancesAndConverges(t *testing.T) {
	s := newTestServer(t)

	backlog := time.Duration(game.RequestBudget.Waves+3) * game.WaveInterval
	start := time.Now().Add(-backlog)
	gs := worldgen.NewLobby(0, 0, 11, "Expédition en retard", 1, 8)
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

	before := gs.WaveNumber
	var first catchUpResult
	rec := postJSON(t, s, "/api/games/"+gs.ID+"/catchup", map[string]any{})
	if rec.Code != http.StatusOK {
		t.Fatalf("catchup: %d %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	// Un tour doit rejouer PLUS qu'une requête de jeu ordinaire : c'est toute la
	// raison d'être de la route (moins d'allers-retours pour revenir dans sa ville).
	if first.Waves <= game.RequestBudget.Waves {
		t.Fatalf("un tour de rattrapage doit dépasser le budget d'une requête : %d vagues", first.Waves)
	}
	// ⚠ le RÉSUMÉ est maigre : c'est ce qui justifie la route. Un état complet de
	// partie (tuiles + monstres) pèse deux ordres de grandeur de plus.
	if n := rec.Body.Len(); n > 512 {
		t.Fatalf("le résumé doit rester maigre : %d octets — %s", n, rec.Body.String())
	}

	var last catchUpResult
	for i := 0; i < 40 && !last.Done; i++ {
		var cur catchUpResult
		rec = postJSON(t, s, "/api/games/"+gs.ID+"/catchup", map[string]any{})
		if rec.Code != http.StatusOK {
			t.Fatalf("catchup: %d %s", rec.Code, rec.Body.String())
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &cur); err != nil {
			t.Fatal(err)
		}
		last = cur
	}
	if !last.Done {
		t.Fatalf("le rattrapage ne converge pas: %+v", last)
	}
	if last.WaveNumber <= before {
		t.Fatalf("aucune vague rejouée (%d -> %d)", before, last.WaveNumber)
	}

	// Les deux réponses disent la MÊME chose : `done` de la route et `catchUp` du
	// payload répondent à la question « reste-t-il des vagues dues ? ».
	var view game.GameState
	if rec := getJSON(t, s, "/api/games/"+gs.ID, &view); rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if view.CatchUp == last.Done {
		t.Fatalf("la route et le payload se contredisent: done=%v catchUp=%v", last.Done, view.CatchUp)
	}
	// Un appel de plus sur une partie à jour ne fait rien (idempotence).
	var again catchUpResult
	rec = postJSON(t, s, "/api/games/"+gs.ID+"/catchup", map[string]any{})
	if err := json.Unmarshal(rec.Body.Bytes(), &again); err != nil {
		t.Fatal(err)
	}
	if again.Waves != 0 || !again.Done {
		t.Fatalf("appel de trop sur une partie à jour: %+v", again)
	}
}
