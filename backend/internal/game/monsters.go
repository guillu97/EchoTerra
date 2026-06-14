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
