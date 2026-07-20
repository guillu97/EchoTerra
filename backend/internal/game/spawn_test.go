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
