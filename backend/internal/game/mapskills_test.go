package game

import "testing"

// newSkillTestGame builds a 5x5 world with one hero and a single pack placed by the
// caller, ready for map-skill tests. The hero starts classless (base "Jet de pierre").
func newSkillTestGame() (*GameState, *Hero) {
	g := &GameState{Width: 5, Height: 5, Day: 1, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 25)
	g.Town.X, g.Town.Y = 0, 0
	h := &Hero{
		ID: "h1", Name: "Alice", X: 2, Y: 2, HP: 10, MaxHP: 10, PA: 6,
		Stats:  Stats{Precision: 3, Dexterite: 2, Force: 4},
		States: []string{}, Bars: map[string]int{}, Inventory: []Item{},
	}
	g.Heroes = []*Hero{h}
	return g, h
}

func (g *GameState) placePack(id string, x, y, hp, count int) *Monster {
	m := &Monster{ID: id, Species: "Slime Vorace", X: x, Y: y, HP: hp, MaxHP: hp, Count: count}
	g.Monsters[id] = m
	g.TileAt(x, y).MonsterID = id
	return m
}

func TestMapSkillsForClass(t *testing.T) {
	// classless → the base skill; a class → its own skills only.
	base := MapSkillsForClass("")
	if len(base) != 1 || base[0].ID != "stone-throw" {
		t.Fatalf("classless hero should have only the base skill: %+v", base)
	}
	ch := MapSkillsForClass("chasseur")
	if len(ch) != 2 {
		t.Fatalf("chasseur should have 2 map skills, got %d", len(ch))
	}
	seen := map[string]bool{}
	for _, s := range ch {
		seen[s.ID] = true
	}
	if !seen["precise-shot"] || !seen["arrow-volley"] {
		t.Fatalf("chasseur skills missing: %+v", ch)
	}
}

func TestBlastDamagesPackOnTile(t *testing.T) {
	g, h := newSkillTestGame()
	m := g.placePack("m1", 2, 2, 100, 3) // tough pack so one cast can't wipe it
	hpBefore, paBefore := m.HP, h.PA

	rep, err := g.CastMapSkill("h1", "stone-throw")
	if err != nil {
		t.Fatalf("cast failed: %v", err)
	}
	if rep.Damage <= 0 {
		t.Fatalf("expected positive damage, got %d", rep.Damage)
	}
	if m.HP != hpBefore-rep.Damage {
		t.Fatalf("monster HP should drop by the reported damage: %d -> %d (dmg %d)", hpBefore, m.HP, rep.Damage)
	}
	if rep.Killed || rep.Slain != 0 {
		t.Fatalf("a glancing hit should not kill: killed=%v slain=%d", rep.Killed, rep.Slain)
	}
	if h.PA != paBefore-1 {
		t.Fatalf("stone-throw should cost 1 PA: %d -> %d", paBefore, h.PA)
	}
}

func TestBlastKillsPackAndClearsTile(t *testing.T) {
	g, _ := newSkillTestGame()
	g.placePack("m1", 2, 2, 1, 1) // 1 HP, 1 creature -> destroyed by any cast

	rep, err := g.CastMapSkill("h1", "stone-throw")
	if err != nil {
		t.Fatalf("cast failed: %v", err)
	}
	if !rep.Killed || rep.Slain != 1 {
		t.Fatalf("expected the pack destroyed: killed=%v slain=%d", rep.Killed, rep.Slain)
	}
	if _, ok := g.Monsters["m1"]; ok {
		t.Fatal("destroyed monster should be removed from the map")
	}
	if g.TileAt(2, 2).MonsterID != "" {
		t.Fatal("tile should no longer reference the destroyed monster")
	}
}

func TestBlastHitsAdjacentTile(t *testing.T) {
	g, _ := newSkillTestGame()
	g.placePack("m1", 3, 2, 100, 2) // one tile east of the hero at (2,2)

	rep, err := g.CastMapSkill("h1", "stone-throw")
	if err != nil {
		t.Fatalf("skill should reach an adjacent pack: %v", err)
	}
	if rep.MonsterID != "m1" {
		t.Fatalf("expected to hit the adjacent pack, got %q", rep.MonsterID)
	}
}

func TestBlastNoTargetInRange(t *testing.T) {
	g, _ := newSkillTestGame()
	g.placePack("m1", 4, 4, 100, 2) // two+ tiles away, out of range

	if _, err := g.CastMapSkill("h1", "stone-throw"); err == nil {
		t.Fatal("expected a rejection when no pack is in range")
	}
}

func TestSkillRequiresPA(t *testing.T) {
	g, h := newSkillTestGame()
	g.placePack("m1", 2, 2, 100, 2)
	h.PA = 0

	if _, err := g.CastMapSkill("h1", "stone-throw"); err == nil {
		t.Fatal("expected a rejection when the hero lacks PA")
	}
}

func TestSkillGatedToClass(t *testing.T) {
	g, h := newSkillTestGame()
	g.placePack("m1", 2, 2, 100, 3)
	// a classless hero cannot cast a class-specific skill…
	if _, err := g.CastMapSkill("h1", "heroic-charge"); err == nil {
		t.Fatal("classless hero must not cast the pionnier's Charge héroïque")
	}
	// …but a Pionnier can, and it hits harder (base 7 + force).
	h.ClassID = "pionnier"
	rep, err := g.CastMapSkill("h1", "heroic-charge")
	if err != nil {
		t.Fatalf("pionnier charge: %v", err)
	}
	if rep.Damage < 7 {
		t.Fatalf("heroic-charge should deal at least its base 7, got %d", rep.Damage)
	}
}

func TestLootingShotGrantsTrophy(t *testing.T) {
	g, h := newSkillTestGame()
	h.ClassID = "recuperateur"
	g.placePack("m1", 2, 2, 1, 1) // dies in one cast → loot granted
	rep, err := g.CastMapSkill("h1", "looting-shot")
	if err != nil {
		t.Fatalf("looting-shot: %v", err)
	}
	if rep.Loot == "" {
		t.Fatalf("looting-shot should report a trophy on a kill")
	}
	if len(h.Inventory) == 0 {
		t.Fatalf("the hero's bag should hold the looted trophy")
	}
}

func TestDrinkRationRestoresPA(t *testing.T) {
	g, h := newSkillTestGame()
	h.MaxPA = 6
	h.PA = 1
	h.AddState(StateFatigue)
	h.AddState(StateSoif)
	h.AddLoot(Item{Type: "eau", Name: "Ration d'eau", Qty: 2})

	if _, err := g.DrinkRation("h1"); err != nil {
		t.Fatalf("drink: %v", err)
	}
	if h.PA != 6 { // 1 + 6 capped at MaxPA 6
		t.Fatalf("ration should restore up to MaxPA, got %d", h.PA)
	}
	if h.HasState(StateFatigue) || h.HasState(StateSoif) {
		t.Fatalf("drinking should clear Fatigue and Soif")
	}
	if heroItemQty(h, "Ration d'eau") != 1 {
		t.Fatalf("one ration should be consumed, got %d", heroItemQty(h, "Ration d'eau"))
	}
	// no ration → refused
	removeHeroItem(h, "Ration d'eau", 1)
	if _, err := g.DrinkRation("h1"); err == nil {
		t.Fatalf("drinking without a ration must be refused")
	}
	// full PA → refused (don't waste a ration)
	h.AddLoot(Item{Type: "eau", Name: "Ration d'eau", Qty: 1})
	if _, err := g.DrinkRation("h1"); err == nil {
		t.Fatalf("drinking at full PA must be refused")
	}
}
