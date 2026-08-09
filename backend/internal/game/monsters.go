package game

import (
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
	return sp.PackMin + randIntn(span+1)
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
	return pool[randIntn(len(pool))]
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

// hordeFrontRadius borne la distance à laquelle NAISSENT les renforts de chaque vague.
//
// Les packs migrent d'une case par vague vers la ville : sur une carte de 134² (vingt
// joueurs), un pack né dans un coin met soixante-dix vagues à arriver. Tirer les
// renforts uniformément sur la carte rendait donc une grande carte intrinsèquement plus
// facile — mesuré, deux joueurs dans un salon prévu pour vingt tenaient TRENTE vagues
// quand deux joueurs sur leur propre carte tombaient à la seizième, uniquement parce
// que la horde n'arrivait jamais.
//
// Le FRONT a donc un rayon fixe : la horde qui assiège cette ville vient de ses
// environs, pas des antipodes. Le délai d'arrivée devient le même à toutes les tailles,
// et la difficulté ne dépend plus que de qui défend. Le semis INITIAL, lui, reste
// réparti sur toute la carte — c'est du peuplement de monde, pas de la pression.
const hordeFrontRadius = 14

// spawnWeightedPack tente de poser UN pack sur une tuile praticable libre, tirée
// avec une probabilité proportionnelle à spawnChance (échantillonnage par rejet).
// `radius` borne le tirage autour de la ville (0 = toute la carte).
func (g *GameState) spawnWeightedPack(waveNumber int, includeBosses bool) bool {
	return g.spawnWeightedPackWithin(waveNumber, includeBosses, 0)
}

func (g *GameState) spawnWeightedPackWithin(waveNumber int, includeBosses bool, radius int) bool {
	for tries := 0; tries < 80; tries++ {
		var x, y int
		if radius > 0 {
			x = g.Town.X + randIntn(2*radius+1) - radius
			y = g.Town.Y + randIntn(2*radius+1) - radius
			if x < 0 || y < 0 || x >= g.Width || y >= g.Height {
				continue
			}
		} else {
			x, y = randIntn(g.Width), randIntn(g.Height)
		}
		t := g.TileAt(x, y)
		if t == nil || !t.Biome.Walkable() || t.MonsterID != "" {
			continue
		}
		if randFloat64() >= g.spawnChance(x, y, waveNumber) {
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
		r := lo + randIntn(hi-lo+1)
		x, y := g.Town.X, g.Town.Y
		if randIntn(2) == 0 { // bord haut/bas de l'anneau
			x += randIntn(2*r+1) - r
			y += r * (2*randIntn(2) - 1)
		} else { // bord gauche/droite
			x += r * (2*randIntn(2) - 1)
			y += randIntn(2*r+1) - r
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
	// LA HORDE SUIT L'EXPÉDITION, PAS LA SURFACE.
	//
	// Elle était surtout fonction de la taille de carte, ce qui paraît naturel (« un
	// grand monde, beaucoup de monstres ») et produit une aberration dès qu'on découple
	// la taille du salon de l'effectif réel : un salon public est créé pour vingt joueurs
	// — donc sur une carte de 134² — mais démarre dès deux. Mesuré, ces deux joueurs
	// tenaient TRENTE vagues là où deux joueurs sur leur propre carte tombaient à la
	// seizième : les packs naissaient loin et mettaient des dizaines de vagues à
	// atteindre les murs. Une partie sous-remplie devenait la plus facile du jeu.
	//
	// La menace vient donc de qui défend la ville ; la surface ne garde qu'un terme
	// d'ambiance (un grand monde n'est pas vide, mais il n'est pas plus dangereux).
	target := 4 + 3*players + (g.Width*g.Height)/1200
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
