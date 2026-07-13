package game

import "testing"

// The client view must not leak anything about undiscovered tiles: not their
// terrain, not their resources, not the monsters standing on them, and not the
// worldgen seed (seed + generator = the whole map).
func TestClientViewRedactsUndiscovered(t *testing.T) {
	g := &GameState{Width: 4, Height: 4, Seed: 1234, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 16)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: Biome(3), Height: 5, Resources: 2}
	}
	g.TileAt(0, 0).Discovered = true
	g.TileAt(1, 0).Discovered = true
	g.Monsters["seen"] = &Monster{ID: "seen", X: 1, Y: 0, Count: 2}
	g.TileAt(1, 0).MonsterID = "seen"
	g.Monsters["hidden"] = &Monster{ID: "hidden", X: 3, Y: 3, Count: 4}
	g.TileAt(3, 3).MonsterID = "hidden"

	cv := g.ClientView()

	if cv.Seed != 0 {
		t.Fatalf("seed must be hidden from clients, got %d", cv.Seed)
	}
	if got := cv.TileAt(1, 0); !got.Discovered || got.Biome != Biome(3) || got.Height != 5 ||
		got.Resources != 2 || got.MonsterID != "seen" {
		t.Fatalf("discovered tile must pass through unchanged, got %+v", got)
	}
	if got := cv.TileAt(3, 3); got.Discovered || got.Biome != 0 || got.Height != 0 ||
		got.Resources != 0 || got.MonsterID != "" {
		t.Fatalf("undiscovered tile must be blank, got %+v", got)
	}
	if _, ok := cv.Monsters["hidden"]; ok {
		t.Fatalf("monster on an undiscovered tile must not be sent")
	}
	if _, ok := cv.Monsters["seen"]; !ok {
		t.Fatalf("monster on a discovered tile must be sent")
	}

	// The receiver must be untouched (persistence and game logic use the full state).
	if g.Seed != 1234 || g.TileAt(3, 3).Biome != Biome(3) || g.TileAt(3, 3).MonsterID != "hidden" ||
		len(g.Monsters) != 2 {
		t.Fatalf("ClientView must not mutate the original state")
	}
}
