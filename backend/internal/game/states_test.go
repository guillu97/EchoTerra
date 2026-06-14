package game

import "testing"

func TestTetanise(t *testing.T) {
	g := &GameState{Width: 5, Height: 5, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 25)
	m := &Monster{ID: "m1", X: 2, Y: 2, Count: 6, HP: 5, MaxHP: 5}
	g.Monsters["m1"] = m
	g.TileAt(2, 2).MonsterID = "m1"
	h := &Hero{ID: "h1", Name: "A", X: 2, Y: 2, HP: 10, States: []string{}, Bars: map[string]int{}}
	g.Heroes = []*Hero{h}

	g.Recompute()
	if !h.HasState(StateTetanise) {
		t.Fatalf("a lone hero on a pack of 6 should be Tétanisé")
	}

	// A second hero on the tile is enough to hold a pack of 6 (required = ceil(6/4) = 2).
	h2 := &Hero{ID: "h2", Name: "B", X: 2, Y: 2, HP: 10, States: []string{}, Bars: map[string]int{}}
	g.Heroes = append(g.Heroes, h2)
	g.Recompute()
	if h.HasState(StateTetanise) {
		t.Fatalf("two heroes should hold the pack -> not Tétanisé")
	}

	// Fewer than 2 monsters never stuns.
	m.Count = 1
	g.Heroes = []*Hero{h}
	g.Recompute()
	if h.HasState(StateTetanise) {
		t.Fatalf("a single monster should not stun")
	}

	// Leaving the tile clears it.
	m.Count = 6
	g.Recompute()
	if !h.HasState(StateTetanise) {
		t.Fatalf("should be Tétanisé again")
	}
	h.X, h.Y = 0, 0
	g.Recompute()
	if h.HasState(StateTetanise) {
		t.Fatalf("moving away should clear Tétanisé")
	}
}
