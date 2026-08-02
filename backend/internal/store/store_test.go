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
	old.Players = []*game.Player{{ID: "p1", Name: "Guillaume"}, {ID: "b1", Name: "Bot", Bot: true}}
	for _, g := range []*game.GameState{lobby, young, old} {
		if err := st.Save(g); err != nil {
			t.Fatalf("save %s: %v", g.ID, err)
		}
	}

	entries, err := st.Leaderboard("", 10)
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
		t.Fatalf("only human players belong on the board: %+v", e.Players)
	}

	// Re-saving updates the row in place (no duplicate).
	young.WaveNumber, young.MonstersKilled = 9, 20
	if err := st.Save(young); err != nil {
		t.Fatal(err)
	}
	entries, err = st.Leaderboard("", 10)
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
	entries, _ = st.Leaderboard("", 10)
	if len(entries) != 2 {
		t.Fatalf("deleting a game must keep its leaderboard row, got %d entries", len(entries))
	}
}

// Le classement se lit par nature de partie : une ville solo ne concourt pas avec
// une expédition publique.
func TestLeaderboardFiltersByMode(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	solo := &game.GameState{ID: "solo", Status: game.StatusActive, Solo: true,
		Visibility: game.VisibilityPrivate, Day: 2, WaveNumber: 3}
	solo.Town.Name = "Clairmont"
	pub := &game.GameState{ID: "pub", Status: game.StatusActive,
		Visibility: game.VisibilityPublic, Day: 6, WaveNumber: 11}
	pub.Town.Name = "Valbourg"
	priv := &game.GameState{ID: "priv", Status: game.StatusActive,
		Visibility: game.VisibilityPrivate, Day: 3, WaveNumber: 5,
		Players: []*game.Player{{ID: "p1", Name: "Guillaume"}, {ID: "p2", Name: "Neko"}}}
	priv.Town.Name = "Boisfort"
	for _, g := range []*game.GameState{solo, pub, priv} {
		if err := st.Save(g); err != nil {
			t.Fatalf("save %s: %v", g.ID, err)
		}
	}

	for _, tc := range []struct{ mode, wantID string }{
		{game.ModeSolo, "solo"},
		{game.ModePublic, "pub"},
		{game.ModePrivate, "priv"},
	} {
		entries, err := st.Leaderboard(tc.mode, 10)
		if err != nil {
			t.Fatal(err)
		}
		if len(entries) != 1 || entries[0].GameID != tc.wantID {
			t.Fatalf("mode %q returned %+v, want only %s", tc.mode, entries, tc.wantID)
		}
		if entries[0].Mode != tc.mode {
			t.Fatalf("entry mode = %q, want %q", entries[0].Mode, tc.mode)
		}
	}

	all, err := st.Leaderboard("", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 || all[0].GameID != "pub" {
		t.Fatalf("unfiltered board should hold all three, best first: %+v", all)
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
