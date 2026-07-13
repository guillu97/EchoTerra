package game

import "testing"

func TestFireballAddsToMonstersKilled(t *testing.T) {
	g, _ := newFireballTestGame()
	g.placePack("m1", 2, 2, 1, 3) // 1 HP each: the blast burns through the whole pack

	rep, err := g.FireballHero("h1")
	if err != nil {
		t.Fatalf("fireball failed: %v", err)
	}
	if rep.Slain == 0 {
		t.Fatal("expected the blast to slay at least one creature")
	}
	if g.MonstersKilled != rep.Slain {
		t.Fatalf("MonstersKilled = %d, want the report's slain count %d", g.MonstersKilled, rep.Slain)
	}
}

func TestCombatWonAddsPackToMonstersKilled(t *testing.T) {
	gs := &GameState{ID: "g1", Width: 8, Height: 8, Monsters: map[string]*Monster{}, Combats: map[string]*Combat{}}
	gs.Tiles = make([]Tile, 64)
	m := testMonster()
	m.Count = 5
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

	if gs.MonstersKilled != 5 {
		t.Fatalf("MonstersKilled = %d, want the whole pack (5)", gs.MonstersKilled)
	}
}

func TestCombatLostAddsNothing(t *testing.T) {
	gs := &GameState{ID: "g1", Width: 8, Height: 8, Monsters: map[string]*Monster{}, Combats: map[string]*Combat{}}
	gs.Tiles = make([]Tile, 64)
	m := testMonster()
	gs.Monsters[m.ID] = m
	gs.TileAt(m.X, m.Y).MonsterID = m.ID
	hero := testHero("Aldric", 5)
	hero.X, hero.Y = m.X, m.Y
	gs.Heroes = []*Hero{hero}

	c := &Combat{ID: "c1", GameID: gs.ID, TileX: m.X, TileY: m.Y, Status: "lost",
		Units: []*CombatUnit{{ID: "u1", Side: "hero", RefID: hero.ID, HP: 0, MaxHP: 20}}}
	gs.Combats[c.ID] = c
	gs.ActiveCombat = c.ID

	gs.FinishCombat(c)

	if gs.MonstersKilled != 0 {
		t.Fatalf("a lost combat must not count kills, got %d", gs.MonstersKilled)
	}
}

func TestNewTownNameNotEmpty(t *testing.T) {
	for i := 0; i < 50; i++ {
		if n := NewTownName(); n == "" {
			t.Fatal("NewTownName returned an empty name")
		}
	}
}
