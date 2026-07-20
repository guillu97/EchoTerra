package game

import (
	"testing"
)

func arenaGame(biome Biome) (*GameState, *Monster) {
	g := &GameState{ID: "t", Width: 5, Height: 5, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 25)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: biome, Discovered: true}
	}
	m := &Monster{ID: "m1", Species: "Slime des cavernes", X: 2, Y: 2, HP: 6, MaxHP: 6, Count: 2}
	g.Monsters["m1"] = m
	g.Tiles[2*5+2].MonsterID = "m1"
	h := NewStarterHero(0, "Testeur", 2, 2)
	g.Heroes = []*Hero{h}
	return g, m
}

func TestArenaPerBiome(t *testing.T) {
	for _, biome := range []Biome{1, 2, 3, 4, 5} {
		g, m := arenaGame(biome)
		c := NewCombat(g, g.Heroes, m, "")
		if c.Biome != biome {
			t.Fatalf("biome %d attendu, obtenu %d", biome, c.Biome)
		}
		if len(c.Cells) != c.GridW*c.GridH {
			t.Fatalf("cells manquantes")
		}
		// Heights = miroir des hauteurs des cells
		for i, cell := range c.Cells {
			if c.Heights[i] != cell.Height {
				t.Fatalf("Heights désynchronisé de Cells à l'index %d", i)
			}
		}
		// rangées de spawn dégagées
		for x := 0; x < c.GridW; x++ {
			for _, y := range []int{0, c.GridH - 1} {
				cell := c.Cells[y*c.GridW+x]
				if cell.Blocked || cell.Hazard != "" {
					t.Fatalf("biome %d : rangée de spawn y=%d encombrée en x=%d (%+v)", biome, y, x, cell)
				}
			}
		}
	}
}

func TestArenaBlockedImpassable(t *testing.T) {
	g, m := arenaGame(3) // forêt : 4 obstacles
	c := NewCombat(g, g.Heroes, m, "")
	var bx, by int
	found := false
	for y := 0; y < c.GridH && !found; y++ {
		for x := 0; x < c.GridW && !found; x++ {
			if c.Cells[y*c.GridW+x].Blocked {
				bx, by, found = x, y, true
			}
		}
	}
	if !found {
		t.Fatal("la forêt doit avoir des obstacles")
	}
	u := c.Units[0]
	if c.passable(bx, by, u) {
		t.Fatal("une case bloquée doit être infranchissable")
	}
	for _, r := range c.Reachable(u) {
		if r[0] == bx && r[1] == by {
			t.Fatal("Reachable ne doit jamais proposer une case bloquée")
		}
	}
}

func TestIceSlideAndBrambles(t *testing.T) {
	g, m := arenaGame(2)
	c := NewCombat(g, g.Heroes, m, "")
	// arène artificielle contrôlée
	for i := range c.Cells {
		c.Cells[i] = CombatCell{}
		c.Heights[i] = 0
	}
	u := c.Units[0]
	u.X, u.Y = 1, 3
	c.Cells[3*c.GridW+2].Hazard = "ice" // (2,3) glace
	c.enterCell(u, 2, 3)                // entre par l'ouest → glisse vers l'est
	if u.X != 3 || u.Y != 3 {
		t.Fatalf("glissade attendue en (3,3), unité en (%d,%d)", u.X, u.Y)
	}
	// glace enchaînée : 3 glissades max
	u.X, u.Y = 1, 5
	for x := 2; x <= 6; x++ {
		c.Cells[5*c.GridW+x].Hazard = "ice"
	}
	c.enterCell(u, 2, 5)
	if u.X != 5 {
		t.Fatalf("3 glissades max attendues (x=5), unité en x=%d", u.X)
	}
	// ronces : -1 PV, ne tue jamais
	u.X, u.Y = 1, 1
	c.Cells[1*c.GridW+2].Hazard = "brambles"
	hp := u.HP
	c.enterCell(u, 2, 1)
	if u.HP != hp-1 {
		t.Fatalf("les ronces doivent coûter 1 PV (%d → %d)", hp, u.HP)
	}
	u.HP = 1
	u.X, u.Y = 1, 1
	c.enterCell(u, 2, 1)
	if u.HP != 1 {
		t.Fatal("les ronces ne doivent jamais tuer")
	}
}

func TestWaterImpassable(t *testing.T) {
	g, m := arenaGame(2)
	c := NewCombat(g, g.Heroes, m, "")
	for i := range c.Cells {
		c.Cells[i] = CombatCell{}
	}
	c.Cells[3*c.GridW+3].Hazard = "water"
	if c.passable(3, 3, c.Units[0]) {
		t.Fatal("l'eau doit être infranchissable")
	}
}
