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

// Exploration au contact (2026-07-19) : un héros normal ne révèle que SA case ;
// seul l'Éclaireur voit une case à l'avance.
func TestContactExplorationVision(t *testing.T) {
	g := &GameState{Width: 7, Height: 7, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 49)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: 2}
	}
	g.Town.X, g.Town.Y = 0, 0
	h := NewStarterHero(0, "Base", 5, 5)
	g.Heroes = []*Hero{h}
	g.RevealVision()
	if !g.TileAt(5, 5).Discovered {
		t.Fatal("la case du héros doit être révélée")
	}
	if g.TileAt(6, 5).Discovered || g.TileAt(5, 6).Discovered || g.TileAt(6, 6).Discovered {
		t.Fatal("un héros normal ne doit PAS voir les cases voisines")
	}
	h.ClassID = "eclaireur"
	g.RevealVision()
	if !g.TileAt(6, 5).Discovered || !g.TileAt(6, 6).Discovered {
		t.Fatal("l'Éclaireur doit voir une case à l'avance (rayon 1)")
	}
	if g.TileAt(3, 5).Discovered {
		t.Fatal("l'Éclaireur ne voit pas à 2 cases")
	}
}

// Marcher vers une case d'eau ENCORE SOUS LE BROUILLARD : le héros perd son PA,
// découvre l'eau, mais n'est PAS déplacé. Une fois l'eau connue, le refus est gratuit.
func TestMoveIntoHiddenWaterRevealsWithoutMoving(t *testing.T) {
	g := &GameState{Width: 5, Height: 5, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 25)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: 2, Discovered: true}
	}
	water := g.TileAt(3, 2)
	water.Biome = 0
	water.Discovered = false
	g.Town.X, g.Town.Y = 0, 0
	h := NewStarterHero(0, "Sondeur", 2, 2)
	h.AddState(StateCache)
	g.Heroes = []*Hero{h}

	if err := g.MoveHero(h.ID, 1, 0); err != nil {
		t.Fatalf("la sonde d'eau cachée ne doit pas être une erreur : %v", err)
	}
	if h.X != 2 || h.Y != 2 {
		t.Fatalf("le héros ne doit pas être déplacé sur l'eau, il est en %d,%d", h.X, h.Y)
	}
	if h.PA != 5 {
		t.Fatalf("la sonde coûte 1 PA, PA=%d", h.PA)
	}
	if !water.Discovered {
		t.Fatal("l'eau doit être découverte")
	}
	if h.HasState(StateCache) {
		t.Fatal("la sonde brise la cachette")
	}
	// eau désormais CONNUE : refus sans coût
	pa := h.PA
	if err := g.MoveHero(h.ID, 1, 0); err == nil {
		t.Fatal("marcher vers une eau connue doit être refusé")
	}
	if h.PA != pa {
		t.Fatal("le refus d'une eau connue ne doit rien coûter")
	}
}
