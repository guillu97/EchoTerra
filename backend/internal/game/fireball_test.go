package game

import "testing"

// newFireballTestGame builds a 5x5 world with one hero and a single pack placed by the
// caller, ready for Fire ball tests.
func newFireballTestGame() (*GameState, *Hero) {
	g := &GameState{Width: 5, Height: 5, Day: 1, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 25)
	g.Town.X, g.Town.Y = 0, 0
	h := &Hero{
		ID: "h1", Name: "Alice", X: 2, Y: 2, HP: 10, MaxHP: 10, PA: 6,
		Stats:  Stats{Precision: 3, Dexterite: 2},
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

func TestFireballDamagesPackOnTile(t *testing.T) {
	g, h := newFireballTestGame()
	m := g.placePack("m1", 2, 2, 100, 3) // tough pack so one cast can't wipe it
	hpBefore, paBefore := m.HP, h.PA

	rep, err := g.FireballHero("h1")
	if err != nil {
		t.Fatalf("fireball failed: %v", err)
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
	if h.PA != paBefore-FireballPACost {
		t.Fatalf("fireball should cost %d PA: %d -> %d", FireballPACost, paBefore, h.PA)
	}
}

func TestFireballKillsPackAndClearsTile(t *testing.T) {
	g, _ := newFireballTestGame()
	g.placePack("m1", 2, 2, 1, 1) // 1 HP, 1 creature -> destroyed by any cast

	rep, err := g.FireballHero("h1")
	if err != nil {
		t.Fatalf("fireball failed: %v", err)
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

func TestFireballHitsAdjacentTile(t *testing.T) {
	g, _ := newFireballTestGame()
	g.placePack("m1", 3, 2, 100, 2) // one tile east of the hero at (2,2)

	rep, err := g.FireballHero("h1")
	if err != nil {
		t.Fatalf("fireball should reach an adjacent pack: %v", err)
	}
	if rep.MonsterID != "m1" {
		t.Fatalf("expected to hit the adjacent pack, got %q", rep.MonsterID)
	}
}

func TestFireballNoTargetInRange(t *testing.T) {
	g, _ := newFireballTestGame()
	g.placePack("m1", 4, 4, 100, 2) // two+ tiles away, out of range

	if _, err := g.FireballHero("h1"); err == nil {
		t.Fatal("expected a rejection when no pack is in range")
	}
}

func TestFireballRequiresPA(t *testing.T) {
	g, h := newFireballTestGame()
	g.placePack("m1", 2, 2, 100, 2)
	h.PA = FireballPACost - 1

	if _, err := g.FireballHero("h1"); err == nil {
		t.Fatal("expected a rejection when the hero lacks PA")
	}
}
