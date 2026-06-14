package game

import "testing"

// newEvolveTestGame builds a minimal one-hero game on the given day, ready for
// class-evolution tests.
func newEvolveTestGame(day int) (*GameState, *Hero) {
	g := &GameState{Width: 5, Height: 5, Day: day, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 25)
	h := &Hero{
		ID: "h1", Name: "Alice", PA: 6, MaxPA: 6, HP: 10, MaxHP: 10,
		Stats: Stats{Force: 2, Endurance: 2}, Class: "Sans classe",
		States: []string{}, Bars: map[string]int{}, Inventory: []Item{},
	}
	g.Heroes = []*Hero{h}
	return g, h
}

func TestEvolveBlockedBeforeDay2(t *testing.T) {
	g, _ := newEvolveTestGame(1)
	if err := g.EvolveHero("h1", "pionnier"); err == nil {
		t.Fatal("expected evolution to intermediate to be blocked before day 2")
	}
}

func TestEvolveToIntermediateAppliesBonuses(t *testing.T) {
	g, h := newEvolveTestGame(EvolveDayIntermediate)
	forceBefore, paBefore := h.Stats.Force, h.MaxPA

	if err := g.EvolveHero("h1", "pionnier"); err != nil {
		t.Fatalf("evolve failed: %v", err)
	}
	if h.ClassTier != ClassTierIntermediate || h.ClassID != "pionnier" || h.Class != "Pionnier" {
		t.Fatalf("hero should be Pionnier (tier 1), got tier=%d id=%q class=%q", h.ClassTier, h.ClassID, h.Class)
	}
	if h.Stats.Force != forceBefore+5 {
		t.Fatalf("Force bonus not applied: %d -> %d", forceBefore, h.Stats.Force)
	}
	if h.ClassBonuses.Force != 5 || h.ClassBonuses.Endurance != 3 {
		t.Fatalf("ClassBonuses not recorded: %+v", h.ClassBonuses)
	}
	if h.MaxPA != paBefore+1 || h.PA != 7 {
		t.Fatalf("PA bonus not applied: maxPa %d -> %d, pa=%d", paBefore, h.MaxPA, h.PA)
	}
}

func TestEvolveRejectsWrongTierClass(t *testing.T) {
	g, _ := newEvolveTestGame(EvolveDayAdvanced) // even on a late day, tier 0 -> tier 2 is invalid
	if err := g.EvolveHero("h1", "gardien"); err == nil {
		t.Fatal("expected rejection: gardien is an advanced (tier 2) class, hero is tier 0")
	}
}

func TestEvolveToAdvancedRequiresDay4(t *testing.T) {
	g, h := newEvolveTestGame(EvolveDayIntermediate)
	if err := g.EvolveHero("h1", "pionnier"); err != nil {
		t.Fatalf("first evolve failed: %v", err)
	}
	if err := g.EvolveHero("h1", "gardien"); err == nil {
		t.Fatal("expected advanced evolution to be blocked before day 4")
	}
	g.Day = EvolveDayAdvanced
	if err := g.EvolveHero("h1", "gardien"); err != nil {
		t.Fatalf("advanced evolve failed: %v", err)
	}
	if h.ClassTier != ClassTierAdvanced || h.ClassID != "gardien" {
		t.Fatalf("hero should be Gardien (tier 2), got tier=%d id=%q", h.ClassTier, h.ClassID)
	}
}

func TestEvolveMaxTierRejected(t *testing.T) {
	g, _ := newEvolveTestGame(EvolveDayAdvanced)
	if err := g.EvolveHero("h1", "pionnier"); err != nil {
		t.Fatalf("intermediate evolve failed: %v", err)
	}
	if err := g.EvolveHero("h1", "gardien"); err != nil {
		t.Fatalf("advanced evolve failed: %v", err)
	}
	if err := g.EvolveHero("h1", "recuperateur"); err == nil {
		t.Fatal("expected rejection: hero already at the advanced (max) tier")
	}
}

func TestGardienCountsAsThreeForTetanise(t *testing.T) {
	g, h := newEvolveTestGame(EvolveDayAdvanced)
	if err := g.EvolveHero("h1", "pionnier"); err != nil {
		t.Fatalf("intermediate evolve failed: %v", err)
	}
	if err := g.EvolveHero("h1", "gardien"); err != nil {
		t.Fatalf("advanced evolve failed: %v", err)
	}
	h.X, h.Y = 2, 2
	g.Monsters["m1"] = &Monster{ID: "m1", Species: "Slime Vorace", X: 2, Y: 2, HP: 9, MaxHP: 9, Count: 8}
	g.TileAt(2, 2).MonsterID = "m1"

	g.recomputeTetanise()
	if h.HasState(StateTetanise) {
		t.Fatal("a lone Gardien (counts as 3) should hold back a pack requiring ceil(8/4)=2 heroes")
	}
}

func TestNonGardienGetsStuckOnLargePack(t *testing.T) {
	g, h := newEvolveTestGame(EvolveDayIntermediate)
	if err := g.EvolveHero("h1", "pionnier"); err != nil {
		t.Fatalf("evolve failed: %v", err)
	}
	h.X, h.Y = 2, 2
	g.Monsters["m1"] = &Monster{ID: "m1", Species: "Slime Vorace", X: 2, Y: 2, HP: 9, MaxHP: 9, Count: 8}
	g.TileAt(2, 2).MonsterID = "m1"

	g.recomputeTetanise()
	if !h.HasState(StateTetanise) {
		t.Fatal("a lone non-Gardien hero should be Tétanisé by a pack requiring ceil(8/4)=2 heroes")
	}
}
