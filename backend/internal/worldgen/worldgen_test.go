package worldgen

import (
	"testing"

	"echoterra/internal/game"
)

func TestGenerateTilesDeterministic(t *testing.T) {
	a, _ := GenerateTiles(20, 20, 42)
	b, _ := GenerateTiles(20, 20, 42)
	if len(a) != 400 || len(b) != 400 {
		t.Fatalf("expected 400 tiles, got %d/%d", len(a), len(b))
	}
	for i := range a {
		if a[i].Biome != b[i].Biome {
			t.Fatalf("non-deterministic biome at %d: %v vs %v", i, a[i].Biome, b[i].Biome)
		}
	}
}

func TestNewGameHasTownAndHeroes(t *testing.T) {
	gs := NewGame(24, 24, 7)
	if len(gs.Heroes) != 3 {
		t.Fatalf("expected 3 heroes, got %d", len(gs.Heroes))
	}
	town := gs.TileAt(gs.Town.X, gs.Town.Y)
	if town == nil || !town.Biome.Walkable() {
		t.Fatalf("town must be on a walkable tile")
	}
	for _, h := range gs.Heroes {
		if h.X != gs.Town.X || h.Y != gs.Town.Y {
			t.Fatalf("heroes must spawn on the town")
		}
	}
	if len(gs.Monsters) == 0 {
		t.Fatalf("expected at least one monster seeded")
	}
}

func TestBiomeThresholds(t *testing.T) {
	cases := []struct {
		v    float64
		want game.Biome
	}{
		{0.1, game.BiomeWater},
		{0.32, game.BiomeSand},
		{0.5, game.BiomeGrass},
		{0.7, game.BiomeForest},
		{0.8, game.BiomeMountain},
		{0.95, game.BiomeSnow},
	}
	for _, c := range cases {
		if got := biomeFromHeight(c.v); got != c.want {
			t.Errorf("biomeFromHeight(%v)=%v want %v", c.v, got, c.want)
		}
	}
}

func TestNewLobbyStartsEmptyAndUnscheduled(t *testing.T) {
	gs := NewLobby(22, 22, 42, "Partie test", 2, 4)
	if gs.Status != game.StatusLobby {
		t.Fatalf("status = %q, want lobby", gs.Status)
	}
	if len(gs.Heroes) != 0 || len(gs.Players) != 0 {
		t.Fatalf("a fresh lobby must have no heroes/players, got %d/%d", len(gs.Heroes), len(gs.Players))
	}
	if gs.JoinCode == "" || len(gs.JoinCode) != 5 {
		t.Fatalf("join code missing/malformed: %q", gs.JoinCode)
	}
	if !gs.NextWaveAt.IsZero() {
		t.Fatal("no wave must be scheduled before launch")
	}
	if gs.MinPlayers != 2 || gs.MaxPlayers != 4 {
		t.Fatalf("min/max players = %d/%d, want 2/4", gs.MinPlayers, gs.MaxPlayers)
	}
}

func TestNewLobbyClampsPlayerBounds(t *testing.T) {
	gs := NewLobby(10, 10, 1, "x", 9, 0) // min > default max, max unset
	if gs.MaxPlayers != 4 || gs.MinPlayers != 4 {
		t.Fatalf("bounds not clamped: min=%d max=%d", gs.MinPlayers, gs.MaxPlayers)
	}
}
