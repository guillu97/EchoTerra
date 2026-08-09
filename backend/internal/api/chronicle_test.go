package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"echoterra/internal/game"
	"echoterra/internal/store"
)

func TestChronicleTotalsAddUpAcrossExpeditions(t *testing.T) {
	runs := []store.ChronicleEntry{
		{Waves: 12, Days: 6, BuildPA: 30, Deposited: 100, Slain: 20, Filled: 3},
		{Waves: 21, Days: 11, BuildPA: 80, Deposited: 150, Slain: 90, Filled: 8},
	}
	got := chronicleTotals(runs)
	if got.Runs != 2 || got.BestWave != 21 || got.Days != 17 || got.BuildPA != 110 ||
		got.Deposited != 250 || got.Slain != 110 || got.Filled != 11 {
		t.Fatalf("totaux faux : %+v", got)
	}
	// BestWave est un MAXIMUM, pas une somme : « la plus longue survie » ne s'additionne pas.
	if got.BestWave != 21 {
		t.Fatalf("meilleure vague = maximum, obtenu %d", got.BestWave)
	}
}

// Les titres sont DÉRIVÉS et complets : ceux qu'on a, et ceux qu'on peut viser. Un
// palier invisible ne donne envie de rien.
func TestTitlesShowWhatIsWonAndWhatIsNext(t *testing.T) {
	titles := titlesFor(chronicleTotals([]store.ChronicleEntry{
		{Waves: 22, BuildPA: 120, Deposited: 10, Slain: 5},
	}))
	if len(titles) != len(titleDefs) {
		t.Fatalf("tous les titres doivent être servis : %d/%d", len(titles), len(titleDefs))
	}
	byID := map[string]Title{}
	for _, ti := range titles {
		byID[ti.ID] = ti
	}
	if !byID["batisseur"].Got { // 120 PA ≥ 100
		t.Fatal("Bâtisseur devait être décroché")
	}
	if byID["maitre-oeuvre"].Got { // 120 PA < 500
		t.Fatal("Maître d'œuvre ne devait pas l'être")
	}
	if !byID["survivant"].Got || byID["veteran"].Got { // 22 vagues : entre les deux paliers
		t.Fatal("les paliers de survie sont mal évalués")
	}
	// Les gagnés d'abord — c'est ce qu'on montre en premier.
	seenPending := false
	for _, ti := range titles {
		if !ti.Got {
			seenPending = true
		} else if seenPending {
			t.Fatal("les titres gagnés doivent précéder ceux qui restent à gagner")
		}
	}
}

// ⚠ COSMÉTIQUE, JAMAIS DE LA PUISSANCE. Un compte de vétéran et un compte neuf doivent
// arriver STRICTEMENT ÉGAUX dans une expédition : c'est cette égalité qui fait tenir une
// survie de groupe, et c'est la même règle que pour les mémoriaux (aucun transfert de
// puissance entre parties). Ce test garde la frontière : un titre n'expose qu'un
// libellé, un compteur et un seuil — rien qu'un moteur de jeu puisse lire comme un bonus.
func TestATitleCarriesNoPower(t *testing.T) {
	for _, ti := range titlesFor(ChronicleTotals{Runs: 99, BestWave: 99, BuildPA: 9999,
		Deposited: 9999, Slain: 9999, Repaired: 9999, Crafted: 9999, Filled: 9999}) {
		if !ti.Got {
			t.Fatalf("staging: %s devait être décroché", ti.ID)
		}
		if ti.Name == "" || ti.Icon == "" || ti.Desc == "" {
			t.Fatalf("un titre doit être lisible : %+v", ti)
		}
	}
}

// LA ROUTE, DE BOUT EN BOUT : un compte, une expédition vécue, et la chronique qui la
// raconte. Réservée au titulaire — il n'y a pas de chronique publique, et c'est voulu :
// exposer celle des autres transformerait un souvenir en palmarès.
func TestMyChronicleRouteServesTheAccountsRuns(t *testing.T) {
	s := newTestServer(t)

	rec := postJSON(t, s, "/api/auth/register", map[string]any{
		"email": "gui@example.com", "name": "Gui", "password": "motdepasse",
	})
	if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
		t.Fatalf("register: %d %s", rec.Code, rec.Body.String())
	}
	var reg struct {
		User  struct{ ID string } `json:"user"`
		Token string              `json:"token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &reg); err != nil {
		t.Fatal(err)
	}

	get := func(token string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/auth/me/chronicle", nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		out := httptest.NewRecorder()
		s.Router().ServeHTTP(out, req)
		return out
	}

	// Sans jeton : rien. Une chronique appartient à son titulaire.
	if r := get(""); r.Code != http.StatusUnauthorized {
		t.Fatalf("sans connexion la chronique doit être refusée, got %d", r.Code)
	}

	// Une expédition vécue par ce compte.
	g := &game.GameState{ID: "g1", Status: game.StatusGameOver, Day: 5, WaveNumber: 17}
	g.Town.Name = "Braisemont"
	g.Players = []*game.Player{{ID: "p1", Name: "Gui", UserID: reg.User.ID}}
	g.Contributions = map[string]*game.Contribution{"p1": {PlayerID: "p1", BuildPA: 140}}
	if err := s.store.Save(g); err != nil {
		t.Fatal(err)
	}

	r := get(reg.Token)
	if r.Code != http.StatusOK {
		t.Fatalf("chronique: %d %s", r.Code, r.Body.String())
	}
	var body struct {
		Runs   []store.ChronicleEntry `json:"runs"`
		Totals ChronicleTotals        `json:"totals"`
		Titles []Title                `json:"titles"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Runs) != 1 || body.Runs[0].TownName != "Braisemont" {
		t.Fatalf("expédition manquante : %+v", body.Runs)
	}
	if body.Totals.BestWave != 17 || body.Totals.BuildPA != 140 {
		t.Fatalf("totaux faux : %+v", body.Totals)
	}
	// 140 PA de chantier : Bâtisseur décroché, Maître d'œuvre non.
	got := map[string]bool{}
	for _, ti := range body.Titles {
		got[ti.ID] = ti.Got
	}
	if !got["batisseur"] || got["maitre-oeuvre"] {
		t.Fatalf("titres mal dérivés : %+v", body.Titles)
	}
}
