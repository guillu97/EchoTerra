package game

import (
	"testing"
	"time"
)

// newSafeWaveTestGame builds a tiny active game with almost no defense so a
// normal wave WOULD hurt the town.
func newSafeWaveTestGame() *GameState {
	g := &GameState{Width: 5, Height: 5, Monsters: map[string]*Monster{}, Status: "active"}
	g.Tiles = make([]Tile, 25)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: BiomeGrass, Resources: 3}
	}
	g.Town.X, g.Town.Y = 2, 2
	g.Town.HP, g.Town.MaxHP = 100, 100
	g.Town.Buildings = DefaultBuildings()
	// Open the gate so the town has little defense — a normal wave lands hard.
	for _, b := range g.Town.Buildings {
		if b.ID == "gate" {
			b.Open = true
		}
	}
	g.Recompute()
	return g
}

// ForceWaveSafe advances the wave but must leave town HP and building
// durability untouched, while still bumping the wave counter and spawning.
func TestForceWaveSafeSparesTown(t *testing.T) {
	g := newSafeWaveTestGame()
	hpBefore := g.Town.HP
	waveBefore := g.WaveNumber
	durBefore := map[string]int{}
	for _, b := range g.Town.Buildings {
		durBefore[b.ID] = b.Durability
	}

	g.ForceWaveSafe(time.Now())

	if g.Town.HP != hpBefore {
		t.Fatalf("safe wave must not damage the town: HP %d -> %d", hpBefore, g.Town.HP)
	}
	if g.WaveNumber != waveBefore+1 {
		t.Fatalf("safe wave must still advance the wave counter: %d -> %d", waveBefore, g.WaveNumber)
	}
	if g.LastWave == nil || g.LastWave.TownDamage != 0 {
		t.Fatalf("safe wave report must show 0 town damage, got %+v", g.LastWave)
	}
	for _, b := range g.Town.Buildings {
		if b.Durability != durBefore[b.ID] {
			t.Fatalf("safe wave must not wear building %q: %d -> %d", b.ID, durBefore[b.ID], b.Durability)
		}
	}
}

// A NORMAL forced wave on the same weakly-defended town DOES take HP, proving
// the safe variant is doing something.
func TestForceWaveNormalDamagesTown(t *testing.T) {
	g := newSafeWaveTestGame()
	hpBefore := g.Town.HP
	// Push a few waves so the horde outgrows whatever defense remains.
	for i := 0; i < 3; i++ {
		g.ForceWave(time.Now())
	}
	if g.Town.HP >= hpBefore {
		t.Fatalf("a normal wave on an open-gate town should hurt it: HP stayed %d", g.Town.HP)
	}
}
