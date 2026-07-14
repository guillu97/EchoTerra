package game

import (
	"math/rand"

	"github.com/google/uuid"
)

// NewMonster instantiates a pack of the given species at (x,y): stats/HP from the
// design catalog (design.go), pack size drawn in the species' [PackMin, PackMax].
func NewMonster(species string, x, y int) *Monster {
	sp := SpeciesByName(species)
	if sp == nil {
		sp = &Species[0]
	}
	return &Monster{
		ID:         uuid.NewString(),
		Species:    sp.Name,
		Appearance: sp.Appearance,
		X:          x,
		Y:          y,
		HP:         sp.HP,
		MaxHP:      sp.HP,
		Stats:      sp.Stats,
		Count:      packSize(sp),
	}
}

// packSize draws a pack size within the species' design range.
func packSize(sp *SpeciesDef) int {
	span := sp.PackMax - sp.PackMin
	if span <= 0 {
		return sp.PackMin
	}
	return sp.PackMin + rand.Intn(span+1)
}

// spawnableSpeciesAt returns a species allowed on the tile's biome (bosses only
// when includeBosses), or nil when the biome hosts nothing.
func (g *GameState) spawnableSpeciesAt(x, y int, includeBosses bool) *SpeciesDef {
	t := g.TileAt(x, y)
	if t == nil {
		return nil
	}
	pool := speciesForBiome(t.Biome, includeBosses)
	if len(pool) == 0 {
		return nil
	}
	return pool[rand.Intn(len(pool))]
}

// SeedStartingMonsters places the initial monster packs on walkable tiles around the
// town, scaled by the number of players: the design's 6 baseline packs, +2 per extra
// player, each of a species allowed on its spawn biome (no bosses at game start —
// they come with the later waves). Bigger crowds attract bigger packs, capped at the
// species' PackMax. Returns how many packs were placed.
func (g *GameState) SeedStartingMonsters(players int) int {
	if players < 1 {
		players = 1
	}
	target := 6 + 2*(players-1)
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
				sp := g.spawnableSpeciesAt(x, y, false)
				if sp == nil {
					continue
				}
				m := NewMonster(sp.Name, x, y)
				if players > 1 {
					m.Count += rand.Intn(players)
					if m.Count > sp.PackMax {
						m.Count = sp.PackMax
					}
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
