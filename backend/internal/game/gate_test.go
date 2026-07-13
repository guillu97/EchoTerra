package game

import "testing"

func newGateTestGame() (*GameState, *Hero) {
	g := &GameState{Width: 5, Height: 5, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 25)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: BiomeGrass, Resources: 3}
	}
	g.Town.X, g.Town.Y = 2, 2
	g.Town.HP, g.Town.MaxHP = 100, 100
	g.Town.Buildings = DefaultBuildings()
	h := &Hero{ID: "h1", Name: "A", X: 2, Y: 2, HP: 10, PA: 6, States: []string{}, Bars: map[string]int{}, Inventory: []Item{}}
	g.Heroes = []*Hero{h}
	g.Recompute()
	return g, h
}

func (g *GameState) setGateOpen(open bool) {
	for _, b := range g.Town.Buildings {
		if b.ID == "gate" {
			b.Open = open
		}
	}
}

// A built, closed gate seals the town: nobody walks out of — or into — the town
// tile. The gate starts open (fresh heroes must be able to leave).
func TestClosedGateSealsTown(t *testing.T) {
	g, h := newGateTestGame()

	if g.GateClosed() {
		t.Fatal("the gate must START open (spawned heroes must be able to leave)")
	}
	// Open gate: walking out works.
	if err := g.MoveHero("h1", 1, 0); err != nil {
		t.Fatalf("walking out through an open gate should work: %v", err)
	}

	// Close the gate: the hero (now outside, at 3,2) cannot come back in...
	g.setGateOpen(false)
	if err := g.MoveHero("h1", -1, 0); err == nil {
		t.Fatal("entering town through a closed gate must be rejected")
	}
	if h.X != 3 || h.Y != 2 {
		t.Fatalf("rejected move must not displace the hero (at %d,%d)", h.X, h.Y)
	}

	// ...and a hero standing in town cannot walk out.
	h.X, h.Y = 2, 2
	if err := g.MoveHero("h1", 0, 1); err == nil {
		t.Fatal("leaving town through a closed gate must be rejected")
	}

	// Reopen: passage restored.
	g.setGateOpen(true)
	if err := g.MoveHero("h1", 0, 1); err != nil {
		t.Fatalf("walking out after reopening should work: %v", err)
	}
}

// EscapeHero's retreat step may not END on the town tile while the gate is closed —
// the hero retreats along the other axis (or stays put) instead of phasing through.
func TestEscapeCannotEnterClosedGate(t *testing.T) {
	g, h := newGateTestGame()
	g.setGateOpen(false)
	h.X, h.Y = 3, 2 // right next to town, escape direction = (-1, 0) onto the gate

	for i := 0; i < 20; i++ { // 25% stumble chance: try enough times to see movement
		h.PA = 6
		if err := g.EscapeHero("h1"); err != nil {
			t.Fatalf("escape itself should not error: %v", err)
		}
		if h.X == g.Town.X && h.Y == g.Town.Y {
			t.Fatal("escape must not enter town through a closed gate")
		}
	}
}
