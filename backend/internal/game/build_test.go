package game

import "testing"

func newBuildTestGame(heroPA int) (*GameState, *Hero) {
	g := &GameState{Width: 5, Height: 5, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 25)
	g.Town.X, g.Town.Y = 2, 2
	g.Town.HP, g.Town.MaxHP = 100, 100
	g.Town.Buildings = DefaultBuildings()
	h := &Hero{ID: "h1", Name: "A", X: 2, Y: 2, HP: 10, PA: heroPA, MaxPA: heroPA, States: []string{}, Bars: map[string]int{}, Inventory: []Item{}}
	g.Heroes = []*Hero{h}
	g.Recompute()
	return g, h
}

// The chantier flow: plan first (1 PA, no materials), then PA are invested only
// while the Bank holds every required material; invested PA survive a material
// shortage; materials are consumed at completion only.
func TestChantierPlanThenInvestGatedByMaterials(t *testing.T) {
	g, h := newBuildTestGame(40)
	tower := g.buildingByID("tower")
	if tower.Built {
		t.Fatal("tower should start as a construction site")
	}
	total := g.buildingCost(tower).PA // tower: 15 PA
	if total != 15 {
		t.Fatalf("expected tower chantier to require 15 PA, got %d", total)
	}
	defBefore := g.TownDefense()

	// Phase 1 — the PLAN opens even with an EMPTY Bank (1 PA, no materials).
	if err := g.TownAction("tower", "build", 1, "h1"); err != nil {
		t.Fatalf("laying the plan must not need materials: %v", err)
	}
	if !tower.UnderConstruction || tower.Built || tower.PaInvested != 0 {
		t.Fatalf("after plan: uc=%v built=%v invested=%d", tower.UnderConstruction, tower.Built, tower.PaInvested)
	}
	if h.PA != 39 {
		t.Fatalf("plan should cost 1 PA, hero has %d", h.PA)
	}

	// Empty Bank -> investing is refused, nothing spent.
	if err := g.TownAction("tower", "build", 5, "h1"); err == nil {
		t.Fatal("investing PA must be refused while materials are missing")
	}
	if tower.PaInvested != 0 || h.PA != 39 {
		t.Fatalf("refused invest must not change state: invested=%d pa=%d", tower.PaInvested, h.PA)
	}

	// Stock the materials (tower: Bois x2, Pierre x3) -> investing works, and the
	// materials are NOT consumed while the chantier is in progress.
	g.Town.Storage = []Item{{Type: "objet", Name: "Bois", Qty: 2}, {Type: "minerai", Name: "Pierre", Qty: 3}}
	if err := g.TownAction("tower", "build", 6, "h1"); err != nil {
		t.Fatalf("invest failed: %v", err)
	}
	if tower.PaInvested != 6 || h.PA != 33 {
		t.Fatalf("expected 6 PA invested (hero 33 left), got invested=%d pa=%d", tower.PaInvested, h.PA)
	}
	if g.storageQty("Bois") != 2 || g.storageQty("Pierre") != 3 {
		t.Fatal("materials must not be consumed while the chantier is in progress")
	}

	// Materials vanish mid-build -> invested PA REMAIN, investing just pauses.
	g.removeStorage("Pierre", 3)
	if err := g.TownAction("tower", "build", 5, "h1"); err == nil {
		t.Fatal("investing must pause while a material is missing")
	}
	if tower.PaInvested != 6 {
		t.Fatalf("invested PA must survive the shortage, got %d", tower.PaInvested)
	}

	// Restock -> finish the remaining 9 PA (asking for more clamps to the remainder);
	// completion consumes the materials and the tower finally defends.
	g.addStorage(Item{Type: "minerai", Name: "Pierre", Qty: 3})
	if err := g.TownAction("tower", "build", 99, "h1"); err != nil {
		t.Fatalf("final invest failed: %v", err)
	}
	if !tower.Built || tower.UnderConstruction || tower.Level != 1 || tower.PaInvested != 0 {
		t.Fatalf("tower should be built lvl1: built=%v uc=%v lvl=%d invested=%d", tower.Built, tower.UnderConstruction, tower.Level, tower.PaInvested)
	}
	if h.PA != 33-9 {
		t.Fatalf("clamp: only the remaining 9 PA must be spent, hero has %d", h.PA)
	}
	if g.storageQty("Bois") != 0 || g.storageQty("Pierre") != 0 {
		t.Fatalf("completion must consume the materials: Bois=%d Pierre=%d", g.storageQty("Bois"), g.storageQty("Pierre"))
	}
	g.Recompute()
	if g.TownDefense() <= defBefore {
		t.Fatalf("defense should rise once the tower is built: %d -> %d", defBefore, g.TownDefense())
	}
}

// Several heroes pour PA into the same chantier across separate actions.
func TestChantierAccumulatesAcrossHeroes(t *testing.T) {
	g, h1 := newBuildTestGame(10)
	h2 := &Hero{ID: "h2", Name: "B", X: 2, Y: 2, HP: 10, PA: 10, MaxPA: 10, States: []string{}, Bars: map[string]int{}, Inventory: []Item{}}
	g.Heroes = append(g.Heroes, h2)
	g.Town.Storage = []Item{{Type: "objet", Name: "Bois", Qty: 3}}
	kitchen := g.buildingByID("kitchen") // 12 PA, Bois x3

	if err := g.TownAction("kitchen", "build", 1, "h1"); err != nil { // plan
		t.Fatalf("plan: %v", err)
	}
	if err := g.TownAction("kitchen", "build", 7, "h1"); err != nil {
		t.Fatalf("h1 invest: %v", err)
	}
	if err := g.TownAction("kitchen", "build", 5, "h2"); err != nil {
		t.Fatalf("h2 invest: %v", err)
	}
	if !kitchen.Built || kitchen.Level != 1 {
		t.Fatalf("kitchen should complete at 7+5=12 PA, built=%v lvl=%d", kitchen.Built, kitchen.Level)
	}
	if h1.PA != 2 || h2.PA != 5 {
		t.Fatalf("expected h1=2 h2=5 PA left, got %d/%d", h1.PA, h2.PA)
	}
}

// Upgrading a built building uses the same plan+invest flow, scaled by level.
func TestUpgradeUsesChantierFlow(t *testing.T) {
	g, h := newBuildTestGame(30)
	panel := g.buildingByID("panel") // built lvl1; upgrade lvl2 = 6×2 = 12 PA, Bois x2
	g.Town.Storage = []Item{{Type: "objet", Name: "Bois", Qty: 2}}

	if err := g.TownAction("panel", "build", 1, "h1"); err != nil { // upgrade plan
		t.Fatalf("upgrade plan: %v", err)
	}
	if !panel.UnderConstruction || !panel.Built {
		t.Fatal("an upgrade chantier keeps the building built (it still works and defends)")
	}
	if cost := g.buildingCost(panel); cost.PA != 12 {
		t.Fatalf("upgrade to lvl2 should require 12 PA, got %d", cost.PA)
	}
	if err := g.TownAction("panel", "build", 12, "h1"); err != nil {
		t.Fatalf("upgrade invest: %v", err)
	}
	if panel.Level != 2 || panel.UnderConstruction {
		t.Fatalf("panel should be lvl2, got lvl=%d uc=%v", panel.Level, panel.UnderConstruction)
	}
	if g.storageQty("Bois") != 0 {
		t.Fatal("upgrade completion must consume the materials")
	}
	if h.PA != 30-1-12 {
		t.Fatalf("expected 17 PA left, got %d", h.PA)
	}
}
