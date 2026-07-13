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

func TestLeaderboardSavesAndRanks(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	// A lobby never reaches the leaderboard.
	lobby := &game.GameState{ID: "lob", Status: game.StatusLobby}
	// Two started games with different survival records.
	young := &game.GameState{ID: "young", Status: game.StatusActive, Day: 1, WaveNumber: 1, MonstersKilled: 2}
	young.Town.Name = "Clairmont"
	old := &game.GameState{ID: "old", Status: game.StatusGameOver, Day: 4, WaveNumber: 7, MonstersKilled: 12}
	old.Town.Name = "Valbourg"
	old.Players = []*game.Player{{ID: "p1", Name: "Guillaume"}}
	for _, g := range []*game.GameState{lobby, young, old} {
		if err := st.Save(g); err != nil {
			t.Fatalf("save %s: %v", g.ID, err)
		}
	}

	entries, err := st.Leaderboard(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("leaderboard has %d entries, want 2 (lobby excluded)", len(entries))
	}
	if entries[0].GameID != "old" || entries[1].GameID != "young" {
		t.Fatalf("longest survival should rank first: %+v", entries)
	}
	e := entries[0]
	if e.TownName != "Valbourg" || e.Days != 4 || e.Waves != 7 || e.MonstersKilled != 12 || !e.GameOver {
		t.Fatalf("achievements lost in round-trip: %+v", e)
	}
	if len(e.Players) != 1 || e.Players[0] != "Guillaume" {
		t.Fatalf("player names lost: %+v", e.Players)
	}

	// Re-saving updates the row in place (no duplicate).
	young.WaveNumber, young.MonstersKilled = 9, 20
	if err := st.Save(young); err != nil {
		t.Fatal(err)
	}
	entries, err = st.Leaderboard(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].GameID != "young" || entries[0].MonstersKilled != 20 {
		t.Fatalf("upsert should update the existing row and re-rank: %+v", entries)
	}

	// The score outlives the game row itself.
	if err := st.Delete("old"); err != nil {
		t.Fatal(err)
	}
	entries, _ = st.Leaderboard(10)
	if len(entries) != 2 {
		t.Fatalf("deleting a game must keep its leaderboard row, got %d entries", len(entries))
	}
}
