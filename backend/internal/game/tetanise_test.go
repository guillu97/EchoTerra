package game

import "testing"

// newTetaniseGame stages a small grass world with the town at (2,2) and one hero
// standing on (4,4) with a pack of `count` monsters on the same tile.
func newTetaniseGame(count int) (*GameState, *Hero, *Monster) {
	g := &GameState{Width: 9, Height: 9, Monsters: map[string]*Monster{}, Day: 1}
	g.Tiles = make([]Tile, 81)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: BiomeGrass, Resources: 5}
	}
	g.Town.X, g.Town.Y = 2, 2
	g.Town.HP, g.Town.MaxHP = 100, 100
	g.Town.Buildings = DefaultBuildings()
	h := &Hero{ID: "h1", Name: "A", X: 4, Y: 4, HP: 10, MaxHP: 10, PA: 6, MaxPA: 6, States: []string{}, Bars: map[string]int{}, Inventory: []Item{}}
	g.Heroes = []*Hero{h}
	m := NewMonster("Slime Vorace", 4, 4)
	m.Count = count
	g.Monsters[m.ID] = m
	g.TileAt(4, 4).MonsterID = m.ID
	g.Recompute()
	return g, h, m
}

func addHeroAt(g *GameState, id string, x, y int) *Hero {
	h := &Hero{ID: id, Name: id, X: x, Y: y, HP: 10, MaxHP: 10, PA: 6, MaxPA: 6, States: []string{}, Bars: map[string]int{}, Inventory: []Item{}}
	g.Heroes = append(g.Heroes, h)
	return h
}

// The GDD rule: a hero is pinned when playersOnTile < ceil(monsters / 4), monsters ≥ 2.
// One hero holds up to 4 creatures; the 5th overwhelms them.
func TestTetaniseThreshold(t *testing.T) {
	for _, tc := range []struct {
		count  int
		heroes int
		stuck  bool
	}{
		{1, 1, false}, // a single creature never pins
		{2, 1, false}, // 1 hero holds up to 4
		{4, 1, false},
		{5, 1, true}, // 5+ overwhelm a lone hero
		{8, 1, true},
		{8, 2, false}, // two heroes hold 8
		{9, 2, true},  // ...but not 9
	} {
		g, h, _ := newTetaniseGame(tc.count)
		for i := 1; i < tc.heroes; i++ {
			addHeroAt(g, "extra", 4, 4)
		}
		g.Recompute()
		if got := h.HasState(StateTetanise); got != tc.stuck {
			t.Errorf("count=%d heroes=%d: stuck=%v, want %v", tc.count, tc.heroes, got, tc.stuck)
		}
	}
}

// Dead teammates don't hold the line; heroes on OTHER tiles don't count either.
func TestTetaniseIgnoresDeadAndDistantHeroes(t *testing.T) {
	g, h, _ := newTetaniseGame(5)
	dead := addHeroAt(g, "dead", 4, 4)
	dead.HP = 0
	addHeroAt(g, "far", 5, 4) // adjacent tile — irrelevant
	g.Recompute()
	if !h.HasState(StateTetanise) {
		t.Fatal("a dead teammate and a neighbour must not lift Tétanisé")
	}
}

// A pinned hero cannot move, search, or hide — but CAN cast Fire ball, use Escape,
// and open the combat that might free them.
func TestTetaniseBlocksAndAllowsTheRightActions(t *testing.T) {
	g, h, _ := newTetaniseGame(6)
	if !h.HasState(StateTetanise) {
		t.Fatal("staging: hero should be pinned")
	}
	if err := g.MoveHero("h1", 1, 0); err == nil {
		t.Fatal("a pinned hero must not move")
	}
	if _, err := g.SearchTile("h1"); err == nil {
		t.Fatal("a pinned hero must not search")
	}
	if err := g.HideHero("h1"); err == nil {
		t.Fatal("a pinned hero must not hide")
	}
	if h.PA != 6 {
		t.Fatalf("refused actions must not spend PA, hero has %d", h.PA)
	}
	if _, err := g.CastMapSkill("h1", "stone-throw"); err != nil {
		t.Fatalf("a pinned hero may cast a map skill to thin the pack: %v", err)
	}
	if err := g.EscapeHero("h1"); err != nil {
		t.Fatalf("a pinned hero may attempt an Escape: %v", err)
	}
}

// Thinning the pack below the threshold releases the hero (Recompute-driven).
func TestTetaniseReleasedWhenPackThins(t *testing.T) {
	g, h, m := newTetaniseGame(5)
	if !h.HasState(StateTetanise) {
		t.Fatal("staging: hero should be pinned by 5 creatures")
	}
	m.Count = 4 // one creature down (fireball/snipe/combat)
	g.Recompute()
	if h.HasState(StateTetanise) {
		t.Fatal("4 creatures no longer pin a lone hero")
	}
	// And killing the pack entirely obviously frees the tile.
	m.Count = 9
	g.Recompute()
	if !h.HasState(StateTetanise) {
		t.Fatal("staging: re-pinned")
	}
	delete(g.Monsters, m.ID)
	g.TileAt(4, 4).MonsterID = ""
	g.Recompute()
	if h.HasState(StateTetanise) {
		t.Fatal("no pack, no Tétanisé")
	}
}

// A teammate WALKING ONTO the tile lifts the state for everyone (rescue).
func TestTetaniseLiftedByArrivingReinforcement(t *testing.T) {
	g, h, _ := newTetaniseGame(5)
	rescuer := addHeroAt(g, "rescue", 5, 4)
	g.Recompute()
	if !h.HasState(StateTetanise) {
		t.Fatal("staging: pinned before the rescue")
	}
	if err := g.MoveHero(rescuer.ID, -1, 0); err != nil {
		t.Fatalf("rescuer move: %v", err)
	}
	g.Recompute()
	if h.HasState(StateTetanise) {
		t.Fatal("two heroes hold 5 creatures — the rescue must free the pinned hero")
	}
}

// The Gardien's weight-3 keeps a big pack at bay (complements evolve_test).
func TestTetaniseGardienHoldsTwelve(t *testing.T) {
	g, h, m := newTetaniseGame(12)
	h.ClassID = "gardien"
	g.Recompute()
	if h.HasState(StateTetanise) {
		t.Fatal("a Gardien counts as 3 heroes: 12 creatures must not pin him")
	}
	m.Count = 13
	g.Recompute()
	if !h.HasState(StateTetanise) {
		t.Fatal("13 creatures overwhelm even a Gardien (ceil(13/4)=4 > 3)")
	}
}
