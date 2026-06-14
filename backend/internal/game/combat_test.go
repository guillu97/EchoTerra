package game

import "testing"

func testHero(name string, force int) *Hero {
	return &Hero{
		ID: "h-" + name, Name: name, HP: 20, MaxHP: 20,
		Stats: Stats{Force: force, Agilite: 5, Endurance: 2}, Class: "Pionnier",
		States: []string{}, Bars: map[string]int{},
	}
}

func testMonster() *Monster {
	return &Monster{
		ID: "m1", Species: "Slime Vorace", X: 3, Y: 3, HP: 6, MaxHP: 6,
		Stats: Stats{Force: 2, Agilite: 1, Endurance: 1}, Count: 1,
	}
}

func TestCombatHeroCanWin(t *testing.T) {
	gs := &GameState{ID: "g1", Width: 8, Height: 8, Monsters: map[string]*Monster{}, Combats: map[string]*Combat{}}
	gs.Tiles = make([]Tile, 64)
	m := testMonster()
	gs.Monsters[m.ID] = m
	gs.TileAt(m.X, m.Y).MonsterID = m.ID
	hero := testHero("Aldric", 50) // overwhelming force so the fight resolves fast
	gs.Heroes = []*Hero{hero}
	hero.X, hero.Y = m.X, m.Y

	c := NewCombat(gs, []*Hero{hero}, m)

	// Drive hero turns until the combat ends; move adjacent then attack.
	for i := 0; i < 100 && c.Status == "active"; i++ {
		cur := c.CurrentUnit()
		if cur == nil || cur.Side != "hero" {
			t.Fatalf("expected a hero turn, got %+v", cur)
		}
		targets := c.Targets(cur, baseRange(cur))
		if len(targets) > 0 {
			if err := c.PlayerAction(cur.ID, "attack", 0, 0, targets[0].ID); err != nil {
				t.Fatalf("attack: %v", err)
			}
			continue
		}
		// Move one step toward the first living enemy.
		var enemy *CombatUnit
		for _, u := range c.Units {
			if u.Alive() && u.Side == "monster" {
				enemy = u
				break
			}
		}
		moved := false
		if !cur.Moved {
			// Pick the reachable tile that gets closest to the enemy.
			bestD := manhattan(cur.X, cur.Y, enemy.X, enemy.Y)
			var best [2]int
			for _, tl := range c.Reachable(cur) {
				if d := manhattan(tl[0], tl[1], enemy.X, enemy.Y); d < bestD {
					bestD, best, moved = d, tl, true
				}
			}
			if moved {
				if err := c.PlayerAction(cur.ID, "move", best[0], best[1], ""); err != nil {
					t.Fatalf("move: %v", err)
				}
			}
		}
		if !moved {
			if err := c.PlayerAction(cur.ID, "end", 0, 0, ""); err != nil {
				t.Fatalf("end: %v", err)
			}
		}
	}

	if c.Status != "won" {
		t.Fatalf("expected hero to win, status=%s log=%v", c.Status, c.Log)
	}
}

func baseRange(u *CombatUnit) int {
	if u.Kind == "Elementaire de Vent" {
		return 2
	}
	return 1
}

func TestFinishCombatRemovesMonster(t *testing.T) {
	gs := &GameState{ID: "g1", Width: 8, Height: 8, Monsters: map[string]*Monster{}, Combats: map[string]*Combat{}}
	gs.Tiles = make([]Tile, 64)
	m := testMonster()
	gs.Monsters[m.ID] = m
	gs.TileAt(m.X, m.Y).MonsterID = m.ID
	hero := testHero("Aldric", 5)
	hero.X, hero.Y = m.X, m.Y
	gs.Heroes = []*Hero{hero}

	c := &Combat{ID: "c1", GameID: gs.ID, TileX: m.X, TileY: m.Y, Status: "won",
		Units: []*CombatUnit{{ID: "u1", Side: "hero", RefID: hero.ID, HP: 12, MaxHP: 20}}}
	gs.Combats[c.ID] = c
	gs.ActiveCombat = c.ID

	gs.FinishCombat(c)

	if gs.TileAt(m.X, m.Y).MonsterID != "" {
		t.Fatalf("monster id should be cleared from tile")
	}
	if _, ok := gs.Monsters[m.ID]; ok {
		t.Fatalf("monster should be deleted from map")
	}
	if hero.HP != 12 {
		t.Fatalf("hero HP should be written back from combat unit, got %d", hero.HP)
	}
	if gs.ActiveCombat != "" {
		t.Fatalf("active combat should be cleared")
	}
}
