package game

import "testing"

// grassWorld builds a plain walkable world with the town at its centre.
func grassWorld(w, h int) *GameState {
	g := &GameState{Width: w, Height: h, Monsters: map[string]*Monster{}, Combats: map[string]*Combat{}}
	g.Tiles = make([]Tile, w*h)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: BiomeGrass, Resources: 3}
	}
	g.Town.X, g.Town.Y = w/2, h/2
	g.Town.HP, g.Town.MaxHP = 100, 100
	return g
}

func TestSpawnChanceRisesWithDistanceAndRuins(t *testing.T) {
	g := grassWorld(40, 40)
	// Loin de la ville > près de la ville.
	near := g.spawnChance(g.Town.X+4, g.Town.Y, 0)
	far := g.spawnChance(0, 0, 0)
	if far <= near {
		t.Fatalf("spawn chance must rise with distance: near=%.3f far=%.3f", near, far)
	}
	// Dans l'anneau de sécurité : zéro.
	if c := g.spawnChance(g.Town.X+1, g.Town.Y, 0); c != 0 {
		t.Fatalf("no spawn chance inside the town safe radius, got %.3f", c)
	}
	// Une ruine gonfle la probabilité de sa case par rapport au même rayon sans ruine.
	baseline := g.spawnChance(g.Town.X+6, g.Town.Y, 0)
	g.Ruins = map[string]*Ruin{"r": {ID: "r", X: g.Town.X - 6, Y: g.Town.Y, Charges: ruinCharges}}
	withRuin := g.spawnChance(g.Town.X-6, g.Town.Y, 0)
	if withRuin <= baseline {
		t.Fatalf("a ruin must raise its tile's spawn chance: baseline=%.3f ruin=%.3f", baseline, withRuin)
	}
}

func TestSpawnChanceRisesEachWave(t *testing.T) {
	g := grassWorld(40, 40)
	x, y := g.Town.X+8, g.Town.Y
	w0 := g.spawnChance(x, y, 0)
	w6 := g.spawnChance(x, y, 6)
	if w6 <= w0 {
		t.Fatalf("spawn chance must grow with the wave number: wave0=%.3f wave6=%.3f", w0, w6)
	}
}

func TestMigrationMovesMonstersTowardTown(t *testing.T) {
	g := grassWorld(21, 21)
	m := NewMonster("Slime Vorace", 2, 2) // loin, en haut-gauche de la ville (10,10)
	g.Monsters[m.ID] = m
	g.TileAt(2, 2).MonsterID = m.ID
	before := cheb(m.X-g.Town.X, m.Y-g.Town.Y)
	g.migrateMonstersTowardTown()
	after := cheb(m.X-g.Town.X, m.Y-g.Town.Y)
	if after >= before {
		t.Fatalf("migration must close the distance to town: before=%d after=%d", before, after)
	}
	// La tuile d'origine est libérée, la nouvelle porte le monstre.
	if g.TileAt(2, 2).MonsterID == m.ID {
		t.Fatal("old tile should be vacated after migration")
	}
	if g.TileAt(m.X, m.Y).MonsterID != m.ID {
		t.Fatal("new tile should reference the migrated monster")
	}
}

func TestMigrationNeverEntersTownTile(t *testing.T) {
	g := grassWorld(11, 11) // ville (5,5)
	m := NewMonster("Slime Vorace", 6, 5) // juste à l'est de la ville
	g.Monsters[m.ID] = m
	g.TileAt(6, 5).MonsterID = m.ID
	g.migrateMonstersTowardTown()
	if m.X == g.Town.X && m.Y == g.Town.Y {
		t.Fatal("a monster must never stand on the town tile")
	}
}

// When an advancing pack's only step toward town is blocked by another pack, the two
// MERGE: effectives are summed and the bigger group imposes its species.
func TestMigrationMergesBlockedPacks(t *testing.T) {
	g := grassWorld(5, 5) // town (2,2)
	// The stationary pack B sits right beside town (1,2): its only step toward town is
	// the town tile itself, so it never moves — A must merge into it.
	b := NewMonster("Goblin Pillard", 1, 2)
	b.Count = 5
	g.Monsters[b.ID] = b
	g.TileAt(1, 2).MonsterID = b.ID
	// A advances from (0,2): its lone step toward town lands on B (dy=0 → no side-step).
	a := NewMonster("Slime Vorace", 0, 2)
	a.Count = 2
	g.Monsters[a.ID] = a
	g.TileAt(0, 2).MonsterID = a.ID

	g.migrateMonstersTowardTown()

	if _, ok := g.Monsters[a.ID]; ok {
		t.Fatal("the advancing pack should have merged away")
	}
	if g.Monsters[b.ID] == nil {
		t.Fatal("the stationary pack should remain")
	}
	if b.Count != 7 {
		t.Fatalf("merged pack must sum effectives (2+5=7), got %d", b.Count)
	}
	if b.Species != "Goblin Pillard" {
		t.Fatalf("the bigger group's species must win, got %q", b.Species)
	}
	if g.TileAt(0, 2).MonsterID != "" {
		t.Fatal("the advancing pack's old tile must be vacated")
	}
	if g.TileAt(1, 2).MonsterID != b.ID {
		t.Fatal("the surviving pack must still occupy its tile")
	}
}

// The smaller group merging into a bigger advancing one: the mover's species wins when
// it is more numerous than the pack it lands on.
func TestMergeBiggerGroupImposesSpecies(t *testing.T) {
	g := grassWorld(5, 5)
	b := NewMonster("Goblin Pillard", 1, 2) // stationary beside town, count small
	b.Count = 2
	g.Monsters[b.ID] = b
	g.TileAt(1, 2).MonsterID = b.ID
	a := NewMonster("Slime Vorace", 0, 2) // advancing, count big
	a.Count = 9
	g.Monsters[a.ID] = a
	g.TileAt(0, 2).MonsterID = a.ID

	g.migrateMonstersTowardTown()

	if b.Count != 11 {
		t.Fatalf("merged pack must sum effectives (9+2=11), got %d", b.Count)
	}
	if b.Species != "Slime Vorace" {
		t.Fatalf("the bigger (advancing) group's species must win, got %q", b.Species)
	}
}

// The horde scales without ceiling: pack sizes keep growing past the design PackMax
// as waves climb (no more clamp).
func TestPackGrowthUnbounded(t *testing.T) {
	g := grassWorld(9, 9)
	sp := SpeciesByName("Slime Vorace")
	if sp == nil {
		t.Fatal("slime species missing")
	}
	// A high wave must be able to produce a pack larger than the species' PackMax.
	big := false
	for i := 0; i < 200 && !big; i++ {
		g.Monsters = map[string]*Monster{}
		for j := range g.Tiles {
			g.Tiles[j].MonsterID = ""
		}
		g.spawnWaveMonsters(40) // grow = 20 → counts land well over any PackMax
		for _, m := range g.Monsters {
			if m.Count > sp.PackMax {
				big = true
				break
			}
		}
	}
	if !big {
		t.Fatalf("late-wave packs must exceed the design PackMax (%d) — growth is uncapped", sp.PackMax)
	}
}

func TestMigrationSkipsMonstersInCombat(t *testing.T) {
	g := grassWorld(21, 21)
	m := NewMonster("Slime Vorace", 3, 3)
	g.Monsters[m.ID] = m
	g.TileAt(3, 3).MonsterID = m.ID
	g.Combats["c"] = &Combat{ID: "c", TileX: 3, TileY: 3, Status: "active"}
	g.migrateMonstersTowardTown()
	if m.X != 3 || m.Y != 3 {
		t.Fatalf("a monster locked in combat must not migrate, moved to (%d,%d)", m.X, m.Y)
	}
}
