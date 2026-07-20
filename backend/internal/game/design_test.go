package game

import "testing"

// newDesignTestGame: a small all-grass world with the town at (2,2) and one hero.
func newDesignTestGame(heroPA int) (*GameState, *Hero) {
	g := &GameState{Width: 7, Height: 7, Monsters: map[string]*Monster{}, Day: 1}
	g.Tiles = make([]Tile, 49)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: BiomeGrass, Resources: 5}
	}
	g.Town.X, g.Town.Y = 2, 2
	g.Town.HP, g.Town.MaxHP = 100, 100
	g.Town.Buildings = DefaultBuildings()
	h := &Hero{ID: "h1", Name: "A", X: 3, Y: 3, HP: 10, MaxHP: 10, PA: heroPA, MaxPA: heroPA, States: []string{}, Bars: map[string]int{}, Inventory: []Item{}}
	g.Heroes = []*Hero{h}
	g.Recompute()
	return g, h
}

// Searching draws from the biome's weighted drop table (⛰️ Terrains).
func TestSearchDrawsFromTerrainTable(t *testing.T) {
	g, h := newDesignTestGame(30)
	valid := map[string]bool{}
	for _, d := range Terrains[BiomeGrass].Drops {
		valid[d.Name] = true
	}
	for i := 0; i < 5; i++ {
		it, err := g.SearchTile("h1")
		if err != nil {
			t.Fatalf("search %d: %v", i, err)
		}
		if !valid[it.Name] {
			t.Fatalf("drop %q not in the grass table", it.Name)
		}
	}
	if h.PA != 25 {
		t.Fatalf("5 searches must cost 5 PA, hero has %d", h.PA)
	}
}

// Herboriste guarantees +1 on plants/ores; Récupérateur +1 on everything.
func TestHarvestClassPassives(t *testing.T) {
	g, h := newDesignTestGame(30)
	h.ClassID = "herboriste"
	for i := 0; i < 4; i++ {
		it, err := g.SearchTile("h1")
		if err != nil {
			t.Fatal(err)
		}
		if it.Type == "plante" && it.Qty != 2 {
			t.Fatalf("herboriste must harvest 2 plants, got %d", it.Qty)
		}
	}
	h.ClassID = "recuperateur"
	it, err := g.SearchTile("h1")
	if err != nil {
		t.Fatal(err)
	}
	if it.Qty < 2 {
		t.Fatalf("récupérateur must carry +1 per search, got qty %d", it.Qty)
	}
}

// The tech tree gates the plan: Tower requires a BUILT Wall level 1.
func TestBuildingPrerequisites(t *testing.T) {
	g, _ := newDesignTestGame(30)
	g.Heroes[0].X, g.Heroes[0].Y = 2, 2 // in town
	wall := g.buildingByID("wall")
	wall.Built = false // knock the prerequisite down
	if err := g.TownAction("tower", "build", 1, "h1"); err == nil {
		t.Fatal("tower plan must be refused while the wall is unbuilt")
	}
	wall.Built = true
	if err := g.TownAction("tower", "build", 1, "h1"); err != nil {
		t.Fatalf("tower plan should pass with the wall built: %v", err)
	}
}

// Per-level defense values come from the design: wall 10/15/20, gate 8/12/16, tower 6/9/12.
func TestBuildingDefenseFromDesign(t *testing.T) {
	g, _ := newDesignTestGame(6)
	wall := g.buildingByID("wall")
	wall.Durability = wall.MaxDurability
	if d := buildingDefense(wall); d != 10 {
		t.Fatalf("wall lvl1 full = 10, got %d", d)
	}
	wall.Level = 3
	if d := buildingDefense(wall); d != 20 {
		t.Fatalf("wall lvl3 full = 20, got %d", d)
	}
	gate := g.buildingByID("gate") // starts lvl 2, OPEN
	gate.Durability = gate.MaxDurability
	if d := buildingDefense(gate); d != 0 {
		t.Fatalf("open gate must defend 0, got %d", d)
	}
	gate.Open = false
	if d := buildingDefense(gate); d != 12 {
		t.Fatalf("closed gate lvl2 full = 12, got %d", d)
	}
}

// Workshop level 2 shaves 1 PA off every chantier ("coût PA chantiers -1").
func TestWorkshopReducesChantierPA(t *testing.T) {
	g, _ := newDesignTestGame(6)
	tower := g.buildingByID("tower")
	if pa := g.buildingCost(tower).PA; pa != 15 {
		t.Fatalf("tower chantier = 15 PA at workshop lvl1, got %d", pa)
	}
	g.buildingByID("workshop").Level = 2
	if pa := g.buildingCost(tower).PA; pa != 14 {
		t.Fatalf("tower chantier = 14 PA with workshop lvl2, got %d", pa)
	}
}

// Townhall revive: daily allowance = level, free at level 3.
func TestTownhallRevive(t *testing.T) {
	g, h := newDesignTestGame(10)
	h.X, h.Y = 2, 2
	dead := &Hero{ID: "h2", Name: "B", X: 5, Y: 5, HP: 0, MaxHP: 12, States: []string{"Blessé"}, Bars: map[string]int{}, Inventory: []Item{}}
	g.Heroes = append(g.Heroes, dead)
	th := g.buildingByID("townhall")

	if err := g.TownAction("townhall", "revive", 1, "h1"); err == nil {
		t.Fatal("revive must be refused while the Townhall is unbuilt")
	}
	th.Built, th.Level, th.Durability = true, 1, 100

	if err := g.TownAction("townhall", "revive", 1, "h1"); err != nil {
		t.Fatalf("revive: %v", err)
	}
	if dead.HP != 6 || dead.X != 2 || dead.Y != 2 || len(dead.States) != 0 {
		t.Fatalf("revived hero should stand in town at half HP: hp=%d (%d,%d) states=%v", dead.HP, dead.X, dead.Y, dead.States)
	}
	if h.PA != 8 {
		t.Fatalf("revive costs 2 PA at lvl1, hero has %d", h.PA)
	}

	dead.HP = 0
	if err := g.TownAction("townhall", "revive", 1, "h1"); err == nil {
		t.Fatal("second revive the same day must be refused at lvl1")
	}
	th.Level = 3 // revive gratuit + illimité
	if err := g.TownAction("townhall", "revive", 1, "h1"); err != nil {
		t.Fatalf("lvl3 revive: %v", err)
	}
	if h.PA != 8 {
		t.Fatalf("lvl3 revive is free, hero has %d PA", h.PA)
	}
}

// Town crafting requires the recipe's building at its design level; Planche outputs ×2.
func TestCraftBuildingLevelGating(t *testing.T) {
	g, h := newDesignTestGame(10)
	h.X, h.Y = 2, 2
	g.Town.Storage = []Item{{"plante", "Champignon", 2}, {"animal", "Viande", 2}, {"objet", "Bois", 4}}

	kitchen := g.buildingByID("kitchen")
	if _, err := g.Craft("forest_stew", "h1"); err == nil {
		t.Fatal("Ragoût forestier must be refused without a Kitchen")
	}
	kitchen.Built, kitchen.Level = true, 1
	if _, err := g.Craft("forest_stew", "h1"); err == nil {
		t.Fatal("Ragoût forestier needs Kitchen level 2")
	}
	kitchen.Level = 2
	if _, err := g.Craft("forest_stew", "h1"); err != nil {
		t.Fatalf("forest_stew at kitchen lvl2: %v", err)
	}

	out, err := g.Craft("plank", "h1") // workshop lvl1, 2 Bois -> 2 Planche
	if err != nil {
		t.Fatalf("plank: %v", err)
	}
	if out.Name != "Planche" || out.Qty != 2 {
		t.Fatalf("plank must output 2 Planche, got %d %s", out.Qty, out.Name)
	}
	if g.storageQty("Planche") != 2 {
		t.Fatalf("bank should hold 2 Planche, has %d", g.storageQty("Planche"))
	}
}

// Advanced classes require their parent class (Gardien ← Pionnier only).
func TestEvolveRequiresParentClass(t *testing.T) {
	g, _ := newDesignTestGame(6)
	g.Day = 4
	if err := g.EvolveHero("h1", "chasseur"); err != nil {
		t.Fatalf("chasseur: %v", err)
	}
	if err := g.EvolveHero("h1", "gardien"); err == nil {
		t.Fatal("a Chasseur must NOT become Gardien (requires Pionnier)")
	}
	if err := g.EvolveHero("h1", "recuperateur"); err != nil {
		t.Fatalf("chasseur -> récupérateur should pass: %v", err)
	}
}

// Species spawn pools follow the design biomes, with bosses gated out.
func TestSpeciesSpawnPools(t *testing.T) {
	pool := speciesForBiome(BiomeForest, false)
	for _, sp := range pool {
		if sp.Boss {
			t.Fatalf("boss %s must not spawn before the threshold", sp.Name)
		}
	}
	withBosses := speciesForBiome(BiomeForest, true)
	found := false
	for _, sp := range withBosses {
		if sp.ID == "arbre-ancien" {
			found = true
		}
	}
	if !found {
		t.Fatal("Arbre Vivant Ancien must be in the forest pool once bosses unlock")
	}
	for _, sp := range speciesForBiome(BiomeSnow, true) {
		if sp.ID == "harpie-prairie" {
			t.Fatal("Harpie de Prairie must not spawn on snow")
		}
	}
}

// Monster loot: defeating a pack draws from the species' weighted table.
func TestCombatVictoryLootFromSpecies(t *testing.T) {
	g, h := newDesignTestGame(6)
	m := NewMonster("Dryade Corrompue", h.X, h.Y)
	m.Count = 1
	g.Monsters[m.ID] = m
	g.TileAt(h.X, h.Y).MonsterID = m.ID

	c, err := g.StartCombat("h1", "")
	if err != nil {
		t.Fatal(err)
	}
	c.Status = "won"
	g.FinishCombat(c)

	valid := map[string]bool{}
	for _, d := range SpeciesByName("Dryade Corrompue").Drops {
		valid[d.Name] = true
	}
	if len(h.Inventory) == 0 {
		t.Fatal("victory must award loot")
	}
	if !valid[h.Inventory[0].Name] {
		t.Fatalf("loot %q not in the dryade table", h.Inventory[0].Name)
	}
}

// Attack grids in combat: a dryade's Fouet de Racines hits the cross around the
// struck cell; Root skips the victim's next move; the Bouclier halves damage.
func TestCombatGridEffects(t *testing.T) {
	c := &Combat{GridW: 7, GridH: 7, Heights: make([]int, 49), Status: "active", Log: []string{}}
	att := &CombatUnit{ID: "m1", Name: "Dryade", Side: "monster", Kind: "Dryade Corrompue", X: 3, Y: 3, HP: 9, MaxHP: 9, Stats: Stats{Force: 3}, States: []string{}}
	h1 := &CombatUnit{ID: "u1", Name: "A", Side: "hero", X: 3, Y: 2, HP: 20, MaxHP: 20, States: []string{}}
	h2 := &CombatUnit{ID: "u2", Name: "B", Side: "hero", X: 3, Y: 1, HP: 20, MaxHP: 20, States: []string{}}
	c.Units = []*CombatUnit{att, h1, h2}

	fouet := monsterAttacks("Dryade Corrompue")[0]
	if fouet.Name != "Fouet de Racines" {
		t.Fatalf("base attack should be Fouet de Racines, got %s", fouet.Name)
	}
	// Strike h1 (3,2): the cross zone around it includes h2 (3,1).
	c.performAttack(att, &fouet, h1.X, h1.Y)
	if h1.HP == 20 || h2.HP == 20 {
		t.Fatalf("the cross zone must hit BOTH heroes: h1=%d h2=%d", h1.HP, h2.HP)
	}

	// Lianes Étreignantes roots without damage.
	lianes := monsterAttacks("Dryade Corrompue")[1]
	before := h1.HP
	c.performAttack(att, &lianes, h1.X, h1.Y)
	if h1.HP != before {
		t.Fatal("Lianes deal no damage")
	}
	if !h1.hasState("Root") {
		t.Fatal("Lianes must apply Root")
	}

	// Bouclier halves incoming damage.
	shield := heroSkillFor("gardien")
	c.performAttack(h1, &shield, h1.X, h1.Y)
	if !h1.hasState("Bouclier") {
		t.Fatal("Posture défensive must shield the gardien")
	}
	full := c.damageWith(att, h2, &fouet)
	_ = full
	h1.Stats.Endurance = 0
	d1 := 0
	for i := 0; i < 20; i++ {
		if d := c.damageWith(att, h1, &fouet); d > d1 {
			d1 = d
		}
	}
	if d1 > (3+2+1)/2+1 { // (force+bonus+maxrand)/2 rounded — shielded max
		t.Fatalf("shielded damage should be halved, saw max %d", d1)
	}
}

// The Well opens with 2 in-game days of water for the whole roster.
func TestWellInitialRations(t *testing.T) {
	g, _ := newDesignTestGame(6)
	g.Heroes = append(g.Heroes, &Hero{ID: "h2", Name: "B", HP: 5, States: []string{}, Bars: map[string]int{}, Inventory: []Item{}})
	g.InitWellRations()
	if w := g.buildingByID("well"); w.Capacity != 4 { // 2 × 2 héros
		t.Fatalf("well should open with 4 rations for 2 heroes, got %d", w.Capacity)
	}
}

// The chasseur's Tir précis finishes off a weakened pack creature for 1 PA.
func TestPreciseShot(t *testing.T) {
	g, h := newDesignTestGame(6)
	m := NewMonster("Goblin Pillard", h.X, h.Y)
	m.Count, m.HP = 2, 4
	g.Monsters[m.ID] = m
	g.TileAt(h.X, h.Y).MonsterID = m.ID

	if _, err := g.CastMapSkill("h1", "precise-shot"); err == nil {
		t.Fatal("Tir précis is Chasseur-only")
	}
	h.ClassID = "chasseur"
	rep, err := g.CastMapSkill("h1", "precise-shot")
	if err != nil {
		t.Fatalf("tir précis: %v", err)
	}
	if rep.Slain != 1 || m.Count != 1 || m.HP != m.MaxHP {
		t.Fatalf("one creature should fall (next steps up at full HP): slain=%d count=%d hp=%d", rep.Slain, m.Count, m.HP)
	}
	m.HP = 9
	if _, err := g.CastMapSkill("h1", "precise-shot"); err == nil {
		t.Fatal("Tir précis must be refused above 5 HP")
	}
}
