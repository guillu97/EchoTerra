package game

import "testing"

func TestBuildConsumesBankMaterials(t *testing.T) {
	g := &GameState{Width: 5, Height: 5, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 25)
	g.Town.X, g.Town.Y = 2, 2
	g.Town.HP, g.Town.MaxHP = 100, 100
	g.Town.Buildings = DefaultBuildings()
	h := &Hero{ID: "h1", Name: "A", X: 2, Y: 2, HP: 10, PA: 6, States: []string{}, Bars: map[string]int{}, Inventory: []Item{}}
	g.Heroes = []*Hero{h}
	g.Recompute()

	tower := g.buildingByID("tower")
	if tower.Built {
		t.Fatal("tower should start as a construction site")
	}
	defBefore := g.TownDefense()

	// Empty bank -> build rejected.
	if err := g.TownAction("tower", "build", 1, "h1"); err == nil {
		t.Fatal("expected a missing-material error with an empty bank")
	}

	// Stock the required materials (tower: Bois x2, Pierre x3 at level 0).
	g.Town.Storage = []Item{{Type: "objet", Name: "Bois", Qty: 5}, {Type: "minerai", Name: "Pierre", Qty: 5}}
	if err := g.TownAction("tower", "build", 1, "h1"); err != nil {
		t.Fatalf("build failed: %v", err)
	}
	if !tower.Built || tower.Level != 1 {
		t.Fatalf("tower should be built at level 1, got built=%v level=%d", tower.Built, tower.Level)
	}
	if g.storageQty("Bois") != 3 || g.storageQty("Pierre") != 2 {
		t.Fatalf("materials not consumed correctly: Bois=%d Pierre=%d", g.storageQty("Bois"), g.storageQty("Pierre"))
	}
	if h.PA != 4 { // cost.pa at level 0 = 2
		t.Fatalf("expected hero PA 6-2=4, got %d", h.PA)
	}
	g.Recompute()
	if g.TownDefense() <= defBefore {
		t.Fatalf("defense should rise once the tower is built: %d -> %d", defBefore, g.TownDefense())
	}
}
