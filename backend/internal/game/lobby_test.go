package game

import (
	"testing"
	"time"
)

func newTestLobby(minPlayers, maxPlayers int) *GameState {
	g := &GameState{Width: 5, Height: 5, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 25)
	g.Town.X, g.Town.Y = 2, 2
	g.Town.HP, g.Town.MaxHP = 100, 100
	g.Town.Buildings = DefaultBuildings()
	g.Status = StatusLobby
	g.JoinCode = "TEST2"
	g.MinPlayers, g.MaxPlayers = minPlayers, maxPlayers
	g.Day = 1
	return g
}

func TestLobbyJoinAndStart(t *testing.T) {
	g := newTestLobby(2, 3)
	now := time.Now()

	host, err := g.AddPlayer("Guillaume", now)
	if err != nil {
		t.Fatalf("host join failed: %v", err)
	}
	if !host.Host {
		t.Fatal("first player should be the host")
	}
	if len(host.HeroIDs) != HeroesPerPlayer || len(g.Heroes) != HeroesPerPlayer {
		t.Fatalf("a player must own a team of %d heroes, got %d/%d", HeroesPerPlayer, len(host.HeroIDs), len(g.Heroes))
	}
	if h := g.HeroByID(host.HeroIDs[0]); h == nil || h.Name != "Guillaume" || h.X != g.Town.X || h.Y != g.Town.Y {
		t.Fatalf("host's first hero not spawned in town with the player's name: %+v", g.Heroes)
	}
	for _, id := range host.HeroIDs[1:] {
		if h := g.HeroByID(id); h == nil || h.Name == "Guillaume" || h.Name == "" {
			t.Fatalf("companion heroes must exist with distinct names: %+v", g.Heroes)
		}
	}

	// Below MinPlayers: the host cannot launch yet.
	if err := g.StartGame(host.ID, now); err == nil {
		t.Fatal("start should be rejected while below MinPlayers")
	}
	if g.Status != StatusLobby {
		t.Fatalf("status should still be lobby, got %q", g.Status)
	}

	guest, err := g.AddPlayer("", now)
	if err != nil {
		t.Fatalf("guest join failed: %v", err)
	}
	if guest.Host {
		t.Fatal("second player must not be host")
	}
	if guest.Name == "" {
		t.Fatal("guest should get a default name")
	}
	if len(g.Players) != 2 || len(g.Heroes) != 2*HeroesPerPlayer {
		t.Fatalf("expected 2 players/%d heroes, got %d/%d", 2*HeroesPerPlayer, len(g.Players), len(g.Heroes))
	}

	// Only the host can launch.
	if err := g.StartGame(guest.ID, now); err == nil {
		t.Fatal("non-host start should be rejected")
	}

	if err := g.StartGame(host.ID, now); err != nil {
		t.Fatalf("host start failed: %v", err)
	}
	if g.Status != StatusActive {
		t.Fatalf("status should be active after start, got %q", g.Status)
	}
	if g.StartedAt.IsZero() {
		t.Fatal("StartedAt should be set on launch")
	}
	if !g.NextWaveAt.After(now) {
		t.Fatal("first wave must be scheduled after the launch instant")
	}

	// No joining a started game.
	if _, err := g.AddPlayer("Retardataire", now); err == nil {
		t.Fatal("joining after start should be rejected")
	}
}

func TestLobbyFullRejectsJoin(t *testing.T) {
	g := newTestLobby(1, 2)
	now := time.Now()
	if _, err := g.AddPlayer("A", now); err != nil {
		t.Fatal(err)
	}
	if _, err := g.AddPlayer("B", now); err != nil {
		t.Fatal(err)
	}
	if _, err := g.AddPlayer("C", now); err == nil {
		t.Fatal("third join should be rejected in a 2-player lobby")
	}
}

func TestLobbyWavesDoNotRunBeforeStart(t *testing.T) {
	g := newTestLobby(1, 2)
	now := time.Now()
	if _, err := g.AddPlayer("Solo", now); err != nil {
		t.Fatal(err)
	}
	// Even with a stale NextWaveAt, a lobby must never process waves.
	g.NextWaveAt = now.Add(-time.Hour)
	if changed := g.CatchUpWaves(now); changed {
		t.Fatal("CatchUpWaves must be a no-op while in lobby")
	}
	if g.WaveNumber != 0 || g.Town.HP != 100 {
		t.Fatalf("lobby town must be untouched, wave=%d hp=%d", g.WaveNumber, g.Town.HP)
	}
}

func TestHeroOwnership(t *testing.T) {
	g := newTestLobby(1, 3)
	now := time.Now()
	a, _ := g.AddPlayer("A", now)
	b, _ := g.AddPlayer("B", now)
	if err := g.StartGame(a.ID, now); err != nil {
		t.Fatal(err)
	}

	for _, id := range a.HeroIDs {
		if err := g.CheckHeroOwnership(a.ID, id); err != nil {
			t.Fatalf("owner must control every hero of their team: %v", err)
		}
	}
	if err := g.CheckHeroOwnership(a.ID, b.HeroIDs[0]); err == nil {
		t.Fatal("controlling another player's hero must be rejected")
	}
	if err := g.CheckHeroOwnership("ghost", a.HeroIDs[0]); err == nil {
		t.Fatal("unknown player must be rejected")
	}

	// Legacy solo games (no players) stay unrestricted.
	solo := newTestLobby(1, 3)
	solo.Status = StatusActive
	solo.Heroes = []*Hero{NewStarterHero(0, "Solo", 2, 2)}
	if err := solo.CheckHeroOwnership("", solo.Heroes[0].ID); err != nil {
		t.Fatalf("legacy games must be unrestricted: %v", err)
	}
}

func TestRemoveAndKickPlayer(t *testing.T) {
	g := newTestLobby(2, 4)
	now := time.Now()
	host, _ := g.AddPlayer("Hôte", now)
	guest, _ := g.AddPlayer("Invité", now)
	third, _ := g.AddPlayer("Tiers", now)

	// A guest cannot kick.
	if _, err := g.KickPlayer(guest.ID, third.ID); err == nil {
		t.Fatal("non-host kick must be rejected")
	}
	// The host kicks the third player: player AND hero removed.
	if _, err := g.KickPlayer(host.ID, third.ID); err != nil {
		t.Fatal(err)
	}
	if g.PlayerByID(third.ID) != nil {
		t.Fatal("kicked player must be removed")
	}
	for _, id := range third.HeroIDs {
		if g.HeroByID(id) != nil {
			t.Fatal("every hero of the kicked player's team must be removed")
		}
	}
	if len(g.Heroes) != 2*HeroesPerPlayer {
		t.Fatalf("remaining heroes = %d, want %d", len(g.Heroes), 2*HeroesPerPlayer)
	}

	// The host leaves: the remaining guest inherits the host role.
	remaining, err := g.RemovePlayer(host.ID)
	if err != nil || remaining != 1 {
		t.Fatalf("host leave failed: %v (remaining=%d)", err, remaining)
	}
	if !g.Players[0].Host || g.Players[0].ID != guest.ID {
		t.Fatal("host role must transfer to the remaining player")
	}

	// Last player leaves -> empty lobby.
	if remaining, _ := g.RemovePlayer(guest.ID); remaining != 0 {
		t.Fatalf("lobby should be empty, remaining=%d", remaining)
	}

	// Leaving a started game is rejected.
	g2 := newTestLobby(1, 2)
	p, _ := g2.AddPlayer("Seul", now)
	_ = g2.StartGame(p.ID, now)
	if _, err := g2.RemovePlayer(p.ID); err == nil {
		t.Fatal("leaving an active game must be rejected")
	}
}

// grassLobby builds a lobby on an all-grass world big enough to seed many packs.
func grassLobby(minPlayers, maxPlayers int) *GameState {
	g := &GameState{Width: 15, Height: 15, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 15*15)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: BiomeGrass, Resources: 3}
	}
	g.Town.X, g.Town.Y = 7, 7
	g.Town.HP, g.Town.MaxHP = 100, 100
	g.Town.Buildings = DefaultBuildings()
	g.Status = StatusLobby
	g.MinPlayers, g.MaxPlayers = minPlayers, maxPlayers
	g.Day = 1
	return g
}

func TestStartingMonstersScaleWithPlayers(t *testing.T) {
	now := time.Now()

	solo := grassLobby(1, 1)
	p, _ := solo.AddPlayer("Solo", now)
	if err := solo.StartGame(p.ID, now); err != nil {
		t.Fatal(err)
	}
	if len(solo.Monsters) != 4 {
		t.Fatalf("solo launch should seed 4 packs, got %d", len(solo.Monsters))
	}

	quad := grassLobby(1, 4)
	host, _ := quad.AddPlayer("A", now)
	for _, n := range []string{"B", "C", "D"} {
		if _, err := quad.AddPlayer(n, now); err != nil {
			t.Fatal(err)
		}
	}
	if err := quad.StartGame(host.ID, now); err != nil {
		t.Fatal(err)
	}
	if len(quad.Monsters) != 10 { // 4 + 2*(4-1)
		t.Fatalf("4-player launch should seed 10 packs, got %d", len(quad.Monsters))
	}
	if len(quad.Heroes) != 4*HeroesPerPlayer {
		t.Fatalf("4 players must field %d heroes, got %d", 4*HeroesPerPlayer, len(quad.Heroes))
	}
}
