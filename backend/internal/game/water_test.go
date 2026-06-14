package game

import "testing"

// newWaterTestGame builds a minimal town with two heroes standing in it and a Well
// that has water capacity, ready for water-ration tests.
func newWaterTestGame() (*GameState, *Hero, *Hero) {
	g := &GameState{Width: 5, Height: 5, Day: 1, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 25)
	g.Town.X, g.Town.Y = 2, 2
	g.Town.HP, g.Town.MaxHP = 100, 100
	g.Town.Buildings = DefaultBuildings()
	h1 := &Hero{ID: "h1", Name: "Alice", X: 2, Y: 2, HP: 10, PA: 6, States: []string{}, Bars: map[string]int{}, Inventory: []Item{}}
	h2 := &Hero{ID: "h2", Name: "Bob", X: 2, Y: 2, HP: 10, PA: 6, States: []string{}, Bars: map[string]int{}, Inventory: []Item{}}
	g.Heroes = []*Hero{h1, h2}
	g.Recompute()
	return g, h1, h2
}

func bagQty(h *Hero, name string) int {
	for _, it := range h.Inventory {
		if it.Name == name {
			return it.Qty
		}
	}
	return 0
}

func TestWaterRationOncePerHeroPerDay(t *testing.T) {
	g, h1, h2 := newWaterTestGame()
	well := g.buildingByID("well")
	capBefore := well.Capacity

	// First draw for Alice: ration lands in her bag, not the Bank.
	if err := g.TownAction("well", "water", 1, "h1"); err != nil {
		t.Fatalf("first water draw failed: %v", err)
	}
	if got := bagQty(h1, "Ration d'eau"); got != 1 {
		t.Fatalf("Alice should hold 1 water ration, got %d", got)
	}
	if g.storageQty("Ration d'eau") != 0 {
		t.Fatal("water ration should go to the hero's bag, not the Bank")
	}
	if well.Capacity != capBefore-1 {
		t.Fatalf("well capacity should drop by 1: %d -> %d", capBefore, well.Capacity)
	}

	// Second draw same day for Alice: rejected, nothing consumed.
	if err := g.TownAction("well", "water", 1, "h1"); err == nil {
		t.Fatal("expected a once-per-day rejection on the second draw")
	}
	if got := bagQty(h1, "Ration d'eau"); got != 1 {
		t.Fatalf("Alice should still hold exactly 1 ration, got %d", got)
	}
	if well.Capacity != capBefore-1 {
		t.Fatal("a rejected draw must not consume well capacity")
	}

	// Bob can still draw today.
	if err := g.TownAction("well", "water", 1, "h2"); err != nil {
		t.Fatalf("Bob's draw failed: %v", err)
	}
	if got := bagQty(h2, "Ration d'eau"); got != 1 {
		t.Fatalf("Bob should hold 1 water ration, got %d", got)
	}
}

func TestWaterRationResetsNextDay(t *testing.T) {
	g, h1, _ := newWaterTestGame()
	if err := g.TownAction("well", "water", 1, "h1"); err != nil {
		t.Fatalf("day 1 draw failed: %v", err)
	}
	// New day -> Alice may draw again.
	g.Day = 2
	if err := g.TownAction("well", "water", 1, "h1"); err != nil {
		t.Fatalf("day 2 draw should be allowed: %v", err)
	}
	if got := bagQty(h1, "Ration d'eau"); got != 2 {
		t.Fatalf("Alice should hold 2 rations across two days, got %d", got)
	}
}

func TestWaterRationClearsThirst(t *testing.T) {
	g, h1, _ := newWaterTestGame()
	h1.AddState(StateSoif)
	if err := g.TownAction("well", "water", 1, "h1"); err != nil {
		t.Fatalf("water draw failed: %v", err)
	}
	if h1.HasState(StateSoif) {
		t.Fatal("drinking water should clear the Soif state")
	}
}

func TestWaterRationRequiresInTownHero(t *testing.T) {
	g, h1, _ := newWaterTestGame()
	h1.X, h1.Y = 0, 0 // move Alice out of town
	g.Recompute()
	if err := g.TownAction("well", "water", 1, "h1"); err == nil {
		t.Fatal("expected rejection: hero is not in town")
	}
}

func TestWaterDrawnTodayDerivedField(t *testing.T) {
	g, _, _ := newWaterTestGame()
	if len(g.Town.WaterDrawnToday) != 0 {
		t.Fatal("no hero should have drawn water yet")
	}
	if err := g.TownAction("well", "water", 1, "h1"); err != nil {
		t.Fatalf("draw failed: %v", err)
	}
	g.Recompute()
	if len(g.Town.WaterDrawnToday) != 1 || g.Town.WaterDrawnToday[0] != "h1" {
		t.Fatalf("WaterDrawnToday should list h1, got %v", g.Town.WaterDrawnToday)
	}
}
