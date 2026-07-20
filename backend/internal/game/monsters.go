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

// Réglages de l'apparition pondérée (2026-07-20).
const (
	spawnSafeRadius  = 2   // anneau autour de la ville où RIEN n'apparaît (Chebyshev)
	ruinDangerRadius = 3   // rayon autour d'une ruine qui gonfle l'apparition
	waveSpawnGrowth  = 0.2 // chaque vague soulève tout le champ de probabilité
)

// spawnChance renvoie 0..1 : la probabilité qu'une tuile praticable fasse
// apparaître un pack. Elle CROÎT avec la distance à la ville (près de la ville =
// quasi nul, d'où « presque pas de monstres autour de la ville » au début),
// AUTOUR des ruines, et à chaque vague passée.
func (g *GameState) spawnChance(x, y, waveNumber int) float64 {
	dTown := g.chebyshevToTown(x, y)
	if dTown <= spawnSafeRadius {
		return 0
	}
	maxD := g.Width
	if g.Height > maxD {
		maxD = g.Height
	}
	maxD /= 2
	if maxD < 1 {
		maxD = 1
	}
	dist := float64(dTown) / float64(maxD)
	if dist > 1 {
		dist = 1
	}
	w := dist * dist // quadratique : la bande proche de la ville reste très pauvre
	// les ruines rayonnent le danger : les tuiles à quelques pas apparaissent bien plus.
	for _, ru := range g.Ruins {
		if d := cheb(x-ru.X, y-ru.Y); d <= ruinDangerRadius {
			w += 0.6 * (1 - float64(d)/float64(ruinDangerRadius+1))
		}
	}
	// la horde s'intensifie à chaque vague : tout le champ se soulève.
	w *= 1 + float64(waveNumber)*waveSpawnGrowth
	if w > 1 {
		w = 1
	}
	return w
}

// spawnWeightedPack tente de poser UN pack sur une tuile praticable libre, tirée
// avec une probabilité proportionnelle à spawnChance (échantillonnage par rejet).
// Renvoie true si un pack a été posé.
func (g *GameState) spawnWeightedPack(waveNumber int, includeBosses bool) bool {
	for tries := 0; tries < 80; tries++ {
		x, y := rand.Intn(g.Width), rand.Intn(g.Height)
		t := g.TileAt(x, y)
		if t == nil || !t.Biome.Walkable() || t.MonsterID != "" {
			continue
		}
		if rand.Float64() >= g.spawnChance(x, y, waveNumber) {
			continue
		}
		sp := g.spawnableSpeciesAt(x, y, includeBosses)
		if sp == nil {
			continue
		}
		m := NewMonster(sp.Name, x, y)
		// les packs de la horde grossissent au fil des vagues, dans la plage de l'espèce.
		if grow := waveNumber / 2; grow > 0 && !sp.Boss {
			m.Count += grow
			if m.Count > sp.PackMax {
				m.Count = sp.PackMax
			}
		}
		g.Monsters[m.ID] = m
		t.MonsterID = m.ID
		return true
	}
	return false
}

// SeedStartingMonsters place PEU de packs au lancement, et la pondération par
// distance les repousse LOIN de la ville (règle : au début, autour de la ville
// est presque vide). +1 pack par joueur supplémentaire. Renvoie le nombre posé.
func (g *GameState) SeedStartingMonsters(players int) int {
	if players < 1 {
		players = 1
	}
	target := 3 + (players - 1)
	placed := 0
	for i := 0; i < target; i++ {
		if g.spawnWeightedPack(0, false) {
			placed++
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

// cheb = distance de Chebyshev (roi d'échecs) d'un vecteur.
func cheb(dx, dy int) int {
	dx, dy = absInt(dx), absInt(dy)
	if dx > dy {
		return dx
	}
	return dy
}

func (g *GameState) chebyshevToTown(x, y int) int { return cheb(x-g.Town.X, y-g.Town.Y) }
