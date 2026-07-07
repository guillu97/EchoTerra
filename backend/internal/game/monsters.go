package game

import (
	"math/rand"

	"github.com/google/uuid"
)

// MonsterSpecies is the catalog used for seeding and wave spawns.
var MonsterSpecies = []string{"Slime Vorace", "Goblin Pillard", "Elementaire de Vent"}

// NewMonster builds a monster of the given species at (x,y), mirroring the GDD stats.
func NewMonster(species string, x, y int) *Monster {
	var st Stats
	var hp int
	switch species {
	case "Goblin Pillard":
		st = Stats{Force: 4, Agilite: 4, Endurance: 1, Precision: 2}
		hp = 6
	case "Elementaire de Vent":
		st = Stats{Dexterite: 2, Agilite: 3, Endurance: 5, Precision: 2}
		hp = 10
	default: // Slime Vorace
		st = Stats{Force: 2, Agilite: 1, Endurance: 4, Precision: 2}
		hp = 9
	}
	return &Monster{
		ID:      uuid.NewString(),
		Species: species,
		X:       x,
		Y:       y,
		HP:      hp,
		MaxHP:   hp,
		Stats:   st,
		Count:   1 + rand.Intn(2),
	}
}

// SeedStartingMonsters places the initial monster packs on walkable tiles around the
// town, scaled by the number of players: more players means more packs (4 for solo,
// +2 per extra player) and slightly bigger packs. Called at game launch, when the
// final player count is known. Returns how many packs were placed.
func (g *GameState) SeedStartingMonsters(players int) int {
	if players < 1 {
		players = 1
	}
	target := 4 + 2*(players-1)
	placed := 0
	for radius := 2; radius <= g.Width && placed < target; radius++ {
		for dy := -radius; dy <= radius && placed < target; dy++ {
			for dx := -radius; dx <= radius && placed < target; dx++ {
				if absInt(dx)+absInt(dy) != radius {
					continue
				}
				x, y := g.Town.X+dx, g.Town.Y+dy
				t := g.TileAt(x, y)
				if t == nil || !t.Biome.Walkable() || t.MonsterID != "" {
					continue
				}
				m := NewMonster(MonsterSpecies[placed%len(MonsterSpecies)], x, y)
				if players > 1 {
					m.Count += rand.Intn(players) // bigger crowds attract bigger packs
				}
				g.Monsters[m.ID] = m
				t.MonsterID = m.ID
				placed++
			}
		}
	}
	return placed
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
