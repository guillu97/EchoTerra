package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"time"

	"echoterra/internal/game"
	"echoterra/internal/worldgen"
)

// getJSON runs a GET through the router and decodes the body into out.
func getJSON(t *testing.T, s *Server, path string, out any) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	s.Router().ServeHTTP(rec, req)
	if out != nil && rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			t.Fatalf("decode %s: %v (body %s)", path, err, rec.Body.String())
		}
	}
	return rec
}

// Une expédition publique LANCÉE reste listée et rejoignable pendant sa fenêtre
// d'accueil — c'est tout l'intérêt de la fenêtre. `status=open` est la question que
// pose vraiment le joueur : « qu'est-ce que je peux rejoindre ? », et la réponse n'est
// plus « les salons ».
func TestOpenListingIncludesLaunchedPublicExpedition(t *testing.T) {
	s := newTestServer(t)

	gs := worldgen.NewLobby(0, 0, 42, "Expédition test", 2, 20)
	gs.Visibility = game.VisibilityPublic
	now := time.Now()
	if _, err := gs.AddPlayer("Ana", now); err != nil {
		t.Fatal(err)
	}
	if _, err := gs.AddPlayer("Bo", now); err != nil {
		t.Fatal(err)
	}
	if !gs.MaybeAutoStart(now) {
		t.Fatal("staging: the public lobby should auto-start at MinPlayers")
	}
	s.persist(gs)

	var open []gameSummary
	if rec := getJSON(t, s, "/api/games?status=open", &open); rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var found *gameSummary
	for i := range open {
		if open[i].ID == gs.ID {
			found = &open[i]
		}
	}
	if found == nil {
		t.Fatalf("l'expédition lancée doit rester listée comme rejoignable, got %+v", open)
	}
	if found.Status != game.StatusActive || !found.JoinOpen {
		t.Fatalf("elle doit être annoncée EN COURS et ouverte, got %+v", found)
	}
	if found.JoinWavesLeft != game.PublicJoinGraceWaves {
		t.Fatalf("vagues restantes = %d, want %d", found.JoinWavesLeft, game.PublicJoinGraceWaves)
	}

	// …et le serveur n'ouvre PAS un second salon public à côté : ce serait séparer les
	// joueurs entre deux parties, exactement ce que la fenêtre veut éviter.
	s.ensurePublicLobby()
	var again []gameSummary
	getJSON(t, s, "/api/games?status=open", &again)
	publics := 0
	for _, g := range again {
		if g.Visibility == game.VisibilityPublic {
			publics++
		}
	}
	if publics != 1 {
		t.Fatalf("une seule expédition publique doit accueillir à la fois, got %d: %+v", publics, again)
	}
}

// Une fois la fenêtre passée, l'expédition disparaît des parties rejoignables et un
// salon neuf prend le relais.
func TestClosedExpeditionMakesRoomForANewLobby(t *testing.T) {
	s := newTestServer(t)

	gs := worldgen.NewLobby(0, 0, 7, "Vieille expédition", 1, 20)
	gs.Visibility = game.VisibilityPublic
	now := time.Now()
	if _, err := gs.AddPlayer("Ana", now); err != nil {
		t.Fatal(err)
	}
	gs.MaybeAutoStart(now)
	gs.WaveNumber = game.PublicJoinGraceWaves // les portes se referment
	s.persist(gs)

	if gs.JoinOpen() {
		t.Fatal("staging: the window should be over")
	}
	s.ensurePublicLobby()

	var open []gameSummary
	getJSON(t, s, "/api/games?status=open", &open)
	for _, g := range open {
		if g.ID == gs.ID {
			t.Fatal("une expédition dont l'accueil est terminé ne doit plus être proposée")
		}
	}
	fresh := 0
	for _, g := range open {
		if g.Visibility == game.VisibilityPublic && g.Status == game.StatusLobby {
			fresh++
		}
	}
	if fresh != 1 {
		t.Fatalf("un salon public neuf doit prendre le relais, got %d: %+v", fresh, open)
	}
}

// LE MÉTA-JEU SE REFERME : une expédition qui meurt devient un lieu sur la carte de
// quelqu'un d'autre. C'est la réponse au trou de rétention principal — une partie dure
// sept à neuf jours réels et se termine par une défaite ; jusqu'ici elle ne laissait
// qu'une ligne de classement.
func TestAFallenTownReappearsAsARuinInTheNextWorld(t *testing.T) {
	s := newTestServer(t)

	// Une ville vit, puis tombe. Le classement en garde la trace (il survit même à la
	// suppression de la partie), et c'est de là que vient le souvenir.
	fallen := worldgen.NewLobby(0, 0, 5, "Partie finie", 1, 4)
	fallen.Town.Name = "Clairmont"
	now := time.Now()
	if _, err := fallen.AddPlayer("Ana", now); err != nil {
		t.Fatal(err)
	}
	fallen.MaybeAutoStart(now)
	fallen.Status = game.StatusGameOver
	fallen.WaveNumber = 19
	s.persist(fallen)

	// Un monde neuf, créé après.
	fresh := worldgen.NewLobby(0, 0, 99, "Monde neuf", 1, 4)
	s.seedMemorials(fresh)

	var memorial *game.Ruin
	for _, r := range fresh.Ruins {
		if r.Type == "memorial" {
			memorial = r
		}
	}
	if memorial == nil {
		t.Fatal("la carte neuve doit porter les ruines de la ville tombée")
	}
	if memorial.Name != "Ruines de Clairmont" {
		t.Fatalf("le mémorial doit porter le nom de la ville morte, got %q", memorial.Name)
	}
	if memorial.FellAtWave != 19 {
		t.Fatalf("il doit retenir la vague qui l'a emportée : %d", memorial.FellAtWave)
	}
	if len(memorial.Defenders) == 0 || memorial.Defenders[0] != "Ana" {
		t.Fatalf("il doit nommer ceux qui l'ont défendue, got %v", memorial.Defenders)
	}
	t.Logf("épitaphe : %s — %s", memorial.Name, memorial.Epitaph())
}
