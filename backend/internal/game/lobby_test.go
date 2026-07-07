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
	if h := g.HeroByID(host.HeroID); h == nil || h.Name != "Guillaume" || h.X != g.Town.X || h.Y != g.Town.Y {
		t.Fatalf("host hero not spawned in town with the player's name: %+v", g.Heroes)
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
	if len(g.Heroes) != 2 || len(g.Players) != 2 {
		t.Fatalf("expected 2 players/2 heroes, got %d/%d", len(g.Players), len(g.Heroes))
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

	if err := g.CheckHeroOwnership(a.ID, a.HeroID); err != nil {
		t.Fatalf("owner must control their hero: %v", err)
	}
	if err := g.CheckHeroOwnership(a.ID, b.HeroID); err == nil {
		t.Fatal("controlling another player's hero must be rejected")
	}
	if err := g.CheckHeroOwnership("ghost", a.HeroID); err == nil {
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
	if g.PlayerByID(third.ID) != nil || g.HeroByID(third.HeroID) != nil {
		t.Fatal("kicked player/hero must be removed")
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
