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

// Réglages de l'apparition pondérée (2026-07-20, densité relevée 2026-07-21).
const (
	// RIEN n'apparaît dans l'anneau d'assaut : depuis que la puissance de la horde
	// compte les créatures massées là (wave.go), un pack qui s'y matérialise est un
	// pack que personne n'a laissé passer — et c'est injouable. Le siège doit ARRIVER
	// (migration), pour que les joueurs puissent l'intercepter. Mesuré avant : à vingt
	// joueurs, neuf packs naissaient au pied des murs au lancement et la ville tombait
	// vague 8, alors qu'à huit joueurs elle tenait vingt vagues.
	spawnSafeRadius  = assaultRadius
	spawnBaseChance  = 0.45 // densité de FOND partout au-delà de l'anneau (carte peuplée)
	ruinDangerRadius = 3    // rayon autour d'une ruine qui gonfle l'apparition
	waveSpawnGrowth  = 0.2  // chaque vague soulève tout le champ de probabilité
)

// spawnChance renvoie 0..1 : la probabilité qu'une tuile praticable fasse
// apparaître un pack. Densité de fond partout au-delà de l'anneau de la ville, qui
// CROÎT avec la distance (plus dense au loin), AUTOUR des ruines, et à chaque vague.
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
	// fond peuplé + bonus de distance : la carte a des monstres partout, plus au loin.
	w := spawnBaseChance + (1-spawnBaseChance)*dist
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
		// les packs de la horde grossissent au fil des vagues — SANS PLAFOND (retour :
		// scaling infini par vague). Le PackMax du design ne borne plus que la taille de
		// DÉPART ; la croissance de vague s'empile par-dessus indéfiniment.
		if grow := waveNumber / 2; grow > 0 && !sp.Boss {
			m.Count += grow
		}
		g.Monsters[m.ID] = m
		t.MonsterID = m.ID
		return true
	}
	return false
}

// spawnPackInBand pose UN pack sur une tuile praticable libre à distance Chebyshev
// [lo,hi] de la ville (sert à garantir des monstres VISIBLES dans l'anneau déjà
// découvert autour de la ville dès le lancement — le fog cache le reste).
func (g *GameState) spawnPackInBand(lo, hi int, includeBosses bool) bool {
	for tries := 0; tries < 120; tries++ {
		r := lo + rand.Intn(hi-lo+1)
		x, y := g.Town.X, g.Town.Y
		if rand.Intn(2) == 0 { // bord haut/bas de l'anneau
			x += rand.Intn(2*r+1) - r
			y += r * (2*rand.Intn(2) - 1)
		} else { // bord gauche/droite
			x += r * (2*rand.Intn(2) - 1)
			y += rand.Intn(2*r+1) - r
		}
		t := g.TileAt(x, y)
		if t == nil || !t.Biome.Walkable() || t.MonsterID != "" || (x == g.Town.X && y == g.Town.Y) {
			continue
		}
		sp := g.spawnableSpeciesAt(x, y, includeBosses)
		if sp == nil {
			continue
		}
		m := NewMonster(sp.Name, x, y)
		g.Monsters[m.ID] = m
		t.MonsterID = m.ID
		return true
	}
	return false
}

// SeedStartingMonsters peuple la carte dès le lancement : un nombre de packs
// PROPORTIONNEL À LA SURFACE (densité constante quelle que soit la taille), + par
// joueur (retour : « trop peu de monstres vs l'attaque de vague »). Quelques packs
// sont posés dans l'anneau DÉCOUVERT autour de la ville pour être visibles tout de
// suite ; le reste est réparti au loin (pondéré). Renvoie le nombre posé.
func (g *GameState) SeedStartingMonsters(players int) int {
	if players < 1 {
		players = 1
	}
	// La croissance par joueur est VOLONTAIREMENT plate (les packs sont surtout fonction
	// de la taille de carte). Elle valait 2 packs par joueur en plus, et près de la ville
	// un de plus par joueur : une table de six ouvrait donc sur 3,5× plus de packs qu'un
	// solo, pour EXACTEMENT le même plafond de défense (muraille + portail + tour). Comme
	// hordePower pondère déjà la horde par l'effectif (hordeScale), l'effet se cumulait et
	// s'inversait — mesuré : les grandes expéditions tombaient à la vague 11 quand les
	// solos tenaient jusqu'à 17.
	target := 6 + (g.Width*g.Height)/280 + (players-1)/2
	near := 3 + (players-1)/3 // visibles dès le départ (dans le rayon de vision de la ville)
	placed := 0
	for i := 0; i < near; i++ {
		if g.spawnPackInBand(spawnSafeRadius+1, townSightRadius+1, false) {
			placed++
		}
	}
	for i := near; i < target; i++ {
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
