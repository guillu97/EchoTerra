package api

import (
	"net/http"
	"testing"

	"echoterra/internal/game"
)

// mythicTown : une expédition active avec un Temple debout et un joueur.
func mythicTown(t *testing.T, s *Server) *game.GameState {
	t.Helper()
	g := &game.GameState{ID: "g1", Status: game.StatusActive, Width: 3, Height: 3}
	g.Tiles = make([]game.Tile, 9)
	g.Monsters = map[string]*game.Monster{}
	g.Town.X, g.Town.Y = 1, 1
	g.Town.HP, g.Town.MaxHP = 100, 100
	g.Town.Buildings = game.DefaultBuildings()
	for _, b := range g.Town.Buildings {
		if b.ID == "temple" {
			b.Built, b.Level, b.Durability, b.MaxDurability = true, 1, 90, 90
		}
	}
	g.Heroes = []*game.Hero{{ID: "h1", Name: "Gui", X: 1, Y: 1, HP: 10, MaxHP: 10, PA: 6, MaxPA: 6}}
	g.Players = []*game.Player{{ID: "p1", Name: "Gui", HeroIDs: []string{"h1"}}}
	g.Town.Favor = game.BlessingCost
	g.Recompute()
	if err := s.store.Save(g); err != nil {
		t.Fatal(err)
	}
	return g
}

// LE VOTE PASSE PAR LA ROUTE, et il est GRATUIT : pas de héros à désigner, pas de PA à
// payer. C'est la seule action de ville qui n'en demande aucun — un joueur parti en
// expédition a son mot à dire sur le dieu qui protégera la ville où dorment les autres.
func TestBlessingVoteRoute(t *testing.T) {
	s := newTestServer(t)
	mythicTown(t, s)

	rec := postJSON(t, s, "/api/games/g1/town/blessing", map[string]any{"playerId": "p1", "godId": "zeus"})
	if rec.Code != http.StatusOK {
		t.Fatalf("vote refusé : %d %s", rec.Code, rec.Body.String())
	}
	g, err := s.store.Load("g1")
	if err != nil {
		t.Fatal(err)
	}
	if g.Town.Votes["p1"] != "zeus" {
		t.Fatalf("la voix n'a pas été enregistrée : %v", g.Town.Votes)
	}
	// Le retrait : une voix posée peut être reprise tant que le scrutin n'est pas clos.
	if rec := postJSON(t, s, "/api/games/g1/town/blessing", map[string]any{"playerId": "p1"}); rec.Code != http.StatusOK {
		t.Fatalf("retrait refusé : %d %s", rec.Code, rec.Body.String())
	}
	if g, _ := s.store.Load("g1"); len(g.Town.Votes) != 0 {
		t.Fatalf("la voix n'a pas été retirée : %v", g.Town.Votes)
	}
}

// Un dieu inconnu (ou d'un autre panthéon) est refusé proprement, pas encaissé en silence.
func TestBlessingVoteRejectsUnknownGod(t *testing.T) {
	s := newTestServer(t)
	mythicTown(t, s)
	rec := postJSON(t, s, "/api/games/g1/town/blessing", map[string]any{"playerId": "p1", "godId": "cthulhu"})
	if rec.Code == http.StatusOK {
		t.Fatalf("un dieu hors panthéon a été accepté")
	}
}

// LE PAYLOAD PORTE LE PANTHÉON ET LE COMPTEUR. Sans ça le client devrait tenir sa propre
// copie du catalogue, qui divergerait au premier ajout — même règle que ThemeInfo.
func TestGamePayloadCarriesFavorAndPantheon(t *testing.T) {
	s := newTestServer(t)
	mythicTown(t, s)
	var out struct {
		Theme struct {
			Pantheon struct {
				ID    string `json:"id"`
				Favor string `json:"favor"`
				Gods  []struct {
					ID     string `json:"id"`
					Domain string `json:"domain"`
				} `json:"gods"`
			} `json:"pantheon"`
		} `json:"theme"`
		Town struct {
			Favor         int `json:"favor"`
			FavorGoal     int `json:"favorGoal"`
			BlessingSlots int `json:"blessingSlots"`
		} `json:"town"`
	}
	if rec := getJSON(t, s, "/api/games/g1", &out); rec.Code != http.StatusOK {
		t.Fatalf("get: %d %s", rec.Code, rec.Body.String())
	}
	if out.Theme.Pantheon.ID != "olympe" || len(out.Theme.Pantheon.Gods) != 3 {
		t.Fatalf("panthéon absent du payload : %+v", out.Theme.Pantheon)
	}
	if out.Town.Favor != game.BlessingCost || out.Town.FavorGoal != game.BlessingCost {
		t.Fatalf("compteur de faveur absent : %+v", out.Town)
	}
	if out.Town.BlessingSlots != 1 {
		t.Fatalf("places de bénédiction : %d, attendu 1", out.Town.BlessingSlots)
	}
}
