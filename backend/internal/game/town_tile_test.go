package game

import "testing"

// The town tile is neither searchable nor a hiding spot: the town's loot lives in
// the Bank, and the wave already spares in-town heroes. One step outside, both
// actions work again.
func TestNoSearchNorHideOnTownTile(t *testing.T) {
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

	if _, err := g.SearchTile("h1"); err == nil {
		t.Fatal("searching the town tile must be rejected")
	}
	if err := g.HideHero("h1"); err == nil {
		t.Fatal("hiding on the town tile must be rejected")
	}
	if h.PA != 6 {
		t.Fatalf("rejected actions must not cost PA, got %d", h.PA)
	}

	// One tile away, both are allowed again.
	h.X = 3
	if _, err := g.SearchTile("h1"); err != nil {
		t.Fatalf("search outside town should work: %v", err)
	}
	if err := g.HideHero("h1"); err != nil {
		t.Fatalf("hide outside town should work: %v", err)
	}
}
