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
