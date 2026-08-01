package store

import (
	"path/filepath"
	"testing"
	"time"

	"echoterra/internal/game"
)

func TestSaveLoadListRoundTrip(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	lobby := &game.GameState{ID: "g1", Status: game.StatusLobby, JoinCode: "ABCDE", MinPlayers: 2, MaxPlayers: 4, CreatedAt: time.Now()}
	if _, err := lobby.AddPlayer("Hôte", time.Now()); err == nil {
		// AddPlayer succeeds on a lobby without town data (hero spawns at 0,0) — fine for storage tests.
	}
	active := &game.GameState{ID: "g2", Status: game.StatusActive}
	for _, g := range []*game.GameState{lobby, active} {
		if err := st.Save(g); err != nil {
			t.Fatalf("save %s: %v", g.ID, err)
		}
	}

	got, err := st.Load("g1")
	if err != nil || got == nil {
		t.Fatalf("load g1: %v %v", got, err)
	}
	if got.JoinCode != "ABCDE" || got.Status != game.StatusLobby || len(got.Players) != len(lobby.Players) {
		t.Fatalf("lobby fields lost in round-trip: %+v", got)
	}

	all, err := st.List(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Fatalf("List returned %d games, want 2", len(all))
	}
}

// SaveIfUnchanged est le garde-fou du battement : il tourne en fond, éventuellement
// sur une autre instance qu'un joueur en train d'agir, et ne doit jamais écraser une
// écriture survenue depuis son chargement.
func TestSaveIfUnchangedDetectsConcurrentWrite(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "cas.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	if err := st.Save(&game.GameState{ID: "g1", Status: game.StatusActive, Name: "origine"}); err != nil {
		t.Fatal(err)
	}
	mine, err := st.Load("g1") // ce que le battement a chargé
	if err != nil || mine == nil {
		t.Fatalf("load: %v", err)
	}

	theirs, _ := st.Load("g1") // le joueur, depuis une autre instance
	theirs.Name = "action du joueur"
	if err := st.Save(theirs); err != nil {
		t.Fatal(err)
	}

	mine.Name = "rattrapage du battement"
	if err := st.SaveIfUnchanged(mine); err != ErrConflict {
		t.Fatalf("SaveIfUnchanged = %v, attendu ErrConflict", err)
	}
	got, _ := st.Load("g1")
	if got.Name != "action du joueur" {
		t.Fatalf("l'écriture du joueur a été écrasée: %q", got.Name)
	}
	// Rechargé, le battement peut écrire sans conflit.
	got.Name = "rattrapage du battement"
	if err := st.SaveIfUnchanged(got); err != nil {
		t.Fatalf("après rechargement: %v", err)
	}
}

// Le battement doit pouvoir cibler les parties à faire avancer sans décoder toute la
// base, et servir les plus en retard d'abord.
func TestActiveGamesOrdersByOldestWave(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "active.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	now := time.Now()
	for _, g := range []*game.GameState{
		{ID: "recent", Status: game.StatusActive, NextWaveAt: now.Add(10 * time.Minute)},
		{ID: "enretard", Status: game.StatusActive, NextWaveAt: now.Add(-2 * time.Hour)},
		{ID: "salon", Status: game.StatusLobby, CreatedAt: now},
		{ID: "fini", Status: game.StatusGameOver},
	} {
		if err := st.Save(g); err != nil {
			t.Fatal(err)
		}
	}

	got, err := st.ActiveGames(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("%d parties actives (attendu 2: ni le salon ni la partie finie)", len(got))
	}
	if got[0].ID != "enretard" {
		t.Fatalf("la plus en retard doit passer en premier, got %q", got[0].ID)
	}
	if got[0].Rev == 0 {
		t.Fatal("la révision doit être chargée (base de la sauvegarde conditionnelle)")
	}
}
