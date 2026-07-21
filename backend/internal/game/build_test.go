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

// A fresh site is gated by THREE things: a FOUND blueprint (consumed at plan-laying),
// the level-1 materials (present while investing, consumed at completion) and the PA.
func TestChantierPlanThenInvestGatedByBlueprintAndMaterials(t *testing.T) {
	g, h := newBuildTestGame(40)
	tower := g.buildingByID("tower")
	if tower.Built {
		t.Fatal("tower should start as a construction site")
	}
	cost := g.buildingCost(tower)
	if cost.PA != 15 {
		t.Fatalf("expected tower chantier to require 15 PA, got %d", cost.PA)
	}
	if cost.Plan != "Plan de la Tour" || len(cost.Materials) == 0 {
		t.Fatalf("a fresh site must ask for a blueprint AND its materials: plan=%q mats=%v", cost.Plan, cost.Materials)
	}
	defBefore := g.TownDefense()

	// No blueprint in the Bank -> laying the plan is refused, nothing spent.
	if err := g.TownAction("tower", "build", 1, "h1"); err == nil {
		t.Fatal("laying the plan must be refused without the blueprint in the Bank")
	}
	if tower.UnderConstruction || h.PA != 40 {
		t.Fatalf("refused plan must not change state: uc=%v pa=%d", tower.UnderConstruction, h.PA)
	}

	// Deposit the found blueprint -> laying the plan works (1 PA) and consumes it.
	g.addStorage(Item{Type: "objet", Name: "Plan de la Tour", Qty: 1})
	if err := g.TownAction("tower", "build", 1, "h1"); err != nil {
		t.Fatalf("laying the plan with the blueprint in bank should work: %v", err)
	}
	if !tower.UnderConstruction || tower.Built || tower.PaInvested != 0 {
		t.Fatalf("after plan: uc=%v built=%v invested=%d", tower.UnderConstruction, tower.Built, tower.PaInvested)
	}
	if h.PA != 39 {
		t.Fatalf("plan should cost 1 PA, hero has %d", h.PA)
	}
	if g.storageQty("Plan de la Tour") != 0 {
		t.Fatalf("laying the plan must consume the blueprint, still have %d", g.storageQty("Plan de la Tour"))
	}

	// Empty Bank of materials -> investing PA is refused (materials gate the labour).
	if err := g.TownAction("tower", "build", 5, "h1"); err == nil {
		t.Fatal("investing PA must be refused while the level-1 materials are missing")
	}
	if tower.PaInvested != 0 {
		t.Fatalf("refused invest must not change progress, got %d", tower.PaInvested)
	}

	// Stock tower materials (Bois x2, Pierre x3) -> investing pours to completion; the
	// materials are consumed only at completion.
	g.Town.Storage = []Item{{Type: "objet", Name: "Bois", Qty: 2}, {Type: "minerai", Name: "Pierre", Qty: 3}}
	if err := g.TownAction("tower", "build", 99, "h1"); err != nil {
		t.Fatalf("invest failed: %v", err)
	}
	if !tower.Built || tower.UnderConstruction || tower.Level != 1 || tower.PaInvested != 0 {
		t.Fatalf("tower should be built lvl1: built=%v uc=%v lvl=%d invested=%d", tower.Built, tower.UnderConstruction, tower.Level, tower.PaInvested)
	}
	if g.storageQty("Bois") != 0 || g.storageQty("Pierre") != 0 {
		t.Fatalf("completion must consume the materials: Bois=%d Pierre=%d", g.storageQty("Bois"), g.storageQty("Pierre"))
	}
	if h.PA != 39-15 {
		t.Fatalf("clamp: only the 15 PA of labour must be spent, hero has %d", h.PA)
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
	// Kitchen needs its blueprint (consumed at plan-laying) AND its level-1 materials.
	g.Town.Storage = []Item{{Type: "objet", Name: "Plan de la Cuisine", Qty: 1}, {Type: "objet", Name: "Bois", Qty: 3}}
	kitchen := g.buildingByID("kitchen") // 12 PA, blueprint "Plan de la Cuisine" + Bois x3

	if err := g.TownAction("kitchen", "build", 1, "h1"); err != nil { // plan (consumes blueprint)
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

// The Recyclerie build (user design): it needs its found blueprint AND its level-1
// materials AND the PA (the plan is an extra gate, not a replacement).
func TestRecyclerieNeedsBlueprintAndMaterials(t *testing.T) {
	g, _ := newBuildTestGame(30)
	rec := g.buildingByID("recyclerie")
	cost := g.buildingCost(rec)
	if cost.Plan != "Plan de la Recyclerie" || len(cost.Materials) == 0 {
		t.Fatalf("recyclerie fresh build must ask for its blueprint AND materials: plan=%q mats=%v", cost.Plan, cost.Materials)
	}
	// Blueprint lets us lay the plan; materials then gate the labour.
	g.addStorage(Item{Type: "objet", Name: "Plan de la Recyclerie", Qty: 1})
	if err := g.TownAction("recyclerie", "build", 1, "h1"); err != nil {
		t.Fatalf("lay plan: %v", err)
	}
	if err := g.TownAction("recyclerie", "build", 99, "h1"); err == nil {
		t.Fatal("investing must be refused with no materials in the Bank")
	}
	// Provide the materials -> completes.
	for _, m := range cost.Materials {
		g.addStorage(Item{Type: m.Type, Name: m.Name, Qty: m.Qty})
	}
	if err := g.TownAction("recyclerie", "build", 99, "h1"); err != nil {
		t.Fatalf("invest: %v", err)
	}
	if !rec.Built || rec.Level != 1 {
		t.Fatalf("recyclerie should be built lvl1, got built=%v lvl=%d", rec.Built, rec.Level)
	}
}

// Every constructible site's blueprint must be findable somewhere (ruin or terrain),
// or the building could never be started. SIMPLE buildings (recyclerie, kitchen) must
// have COMMON plans in the near-town biomes (sand/grass) so the early game isn't stalled.
func TestBuildingPlansAreLootable(t *testing.T) {
	found := map[string]bool{}
	for _, td := range Terrains {
		for _, d := range td.Drops {
			found[d.Name] = true
		}
	}
	for _, rd := range ruinDefs {
		for _, d := range rd.Loot {
			found[d.Name] = true
		}
	}
	for _, id := range []string{"townhall", "tower", "kitchen", "recyclerie"} {
		plan := buildingPlanItem(id)
		if plan == "" {
			t.Fatalf("%s should have a blueprint", id)
		}
		if !found[plan] {
			t.Fatalf("blueprint %q is not lootable anywhere (ruin/terrain)", plan)
		}
	}
	// Simple buildings' plans must weigh at least as much as a common near-town drop.
	weightIn := func(b Biome, name string) int {
		for _, d := range Terrains[b].Drops {
			if d.Name == name {
				return d.Weight
			}
		}
		return 0
	}
	if weightIn(BiomeSand, "Plan de la Recyclerie") < 2 {
		t.Fatal("the Recyclerie plan (simple building) must be common on sand")
	}
	if weightIn(BiomeGrass, "Plan de la Cuisine") < 2 {
		t.Fatal("the Kitchen plan (simple building) must be common on grass")
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
