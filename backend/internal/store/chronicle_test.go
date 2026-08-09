package store

import (
	"path/filepath"
	"testing"

	"echoterra/internal/game"
)

func chronicleStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

// CE QUI TRAVERSE, C'EST LE SOUVENIR — et il doit survivre à la ville.
//
// Toute l'utilité de la chronique est là : une expédition finit toujours par tomber, et
// sa partie finit par être purgée. Si le souvenir mourait avec elle, on n'aurait rien
// résolu du tout.
func TestChronicleOutlivesTheGameItRecords(t *testing.T) {
	st := chronicleStore(t)

	g := &game.GameState{ID: "g1", Status: game.StatusGameOver, Day: 6, WaveNumber: 14, MonstersKilled: 120}
	g.Town.Name = "Valbourg"
	g.Players = []*game.Player{
		{ID: "p1", Name: "Guillaume", UserID: "u1"},
		{ID: "p2", Name: "Anonyme"},                      // pas de compte : rien à écrire
		{ID: "b1", Name: "Bot", Bot: true, UserID: "u9"}, // un bot n'a rien vécu
	}
	g.Contributions = map[string]*game.Contribution{
		"p1": {PlayerID: "p1", Name: "Guillaume", BuildPA: 40, Deposited: 210, Slain: 33, Repaired: 15, Crafted: 6, Filled: 2},
	}
	if err := st.Save(g); err != nil {
		t.Fatal(err)
	}

	runs, err := st.Chronicle("u1", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 {
		t.Fatalf("une expédition attendue, %d obtenues", len(runs))
	}
	if runs[0].TownName != "Valbourg" || runs[0].Waves != 14 || runs[0].BuildPA != 40 || runs[0].Deposited != 210 {
		t.Fatalf("contribution mal enregistrée : %+v", runs[0])
	}
	if !runs[0].GameOver {
		t.Fatal("la ville est tombée : la chronique doit le dire")
	}

	// Ni l'anonyme ni le bot n'ont de chronique.
	if r, _ := st.Chronicle("u9", 10); len(r) != 0 {
		t.Fatalf("un joueur-IA n'a rien vécu : %d lignes", len(r))
	}

	// LA VILLE DISPARAÎT — le souvenir reste.
	if err := st.Delete(g.ID); err != nil {
		t.Fatal(err)
	}
	runs, err = st.Chronicle("u1", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].TownName != "Valbourg" {
		t.Fatalf("la chronique doit survivre à la purge de la partie : %+v", runs)
	}
}

// Une même partie sauvegardée cent fois reste UNE expédition, avec ses contributions à
// jour — sinon la carrière d'un joueur enflerait au rythme du battement.
func TestChronicleKeepsOneRowPerExpedition(t *testing.T) {
	st := chronicleStore(t)
	g := &game.GameState{ID: "g1", Status: game.StatusActive, Day: 1, WaveNumber: 1}
	g.Town.Name = "Clairmont"
	g.Players = []*game.Player{{ID: "p1", Name: "Gui", UserID: "u1"}}
	g.Contributions = map[string]*game.Contribution{"p1": {PlayerID: "p1", BuildPA: 5}}
	if err := st.Save(g); err != nil {
		t.Fatal(err)
	}
	g.WaveNumber = 9
	g.Contributions["p1"].BuildPA = 60
	if err := st.Save(g); err != nil {
		t.Fatal(err)
	}
	runs, err := st.Chronicle("u1", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 {
		t.Fatalf("une seule ligne par expédition, %d obtenues", len(runs))
	}
	if runs[0].Waves != 9 || runs[0].BuildPA != 60 {
		t.Fatalf("la ligne doit suivre la partie : %+v", runs[0])
	}
}

// Un salon jamais lancé n'est pas une expédition vécue.
func TestALobbyIsNotAnExpedition(t *testing.T) {
	st := chronicleStore(t)
	g := &game.GameState{ID: "lob", Status: game.StatusLobby}
	g.Players = []*game.Player{{ID: "p1", Name: "Gui", UserID: "u1"}}
	if err := st.Save(g); err != nil {
		t.Fatal(err)
	}
	if runs, _ := st.Chronicle("u1", 10); len(runs) != 0 {
		t.Fatalf("un salon n'a rien à raconter : %d lignes", len(runs))
	}
}
