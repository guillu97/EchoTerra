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
