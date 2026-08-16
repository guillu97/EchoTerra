// Package worldgen generates the global map (heightmap -> biomes) and assembles a
// fresh GameState. The biome thresholds mirror the Python snippet from the GDD so the
// generated world matches the design intent.
package worldgen

import (
	"math"
	"math/rand"
	"sort"
	"time"

	"github.com/aquilax/go-perlin"
	"github.com/google/uuid"

	"echoterra/internal/game"
)

// Mapgen parameters from the 🌍 Génération tab of the Studio (echoterra-design):
// Perlin (scale 0.08, 3 octaves, persistence 0.5), maxHeight 6, SMOOTHING maxStep 1
// (a level-6 mountain can never touch a level-0 plain), thresholds .30/.35/.60/.75/.90.
const (
	genScale     = 0.08
	genMaxHeight = 6
	genMaxStep   = 1 // max height difference between two orthogonal neighbours
)

// DefaultSize is the default map edge from the design's mapgen parameters (60×60) —
// la taille d'une expédition de quatre joueurs.
const DefaultSize = 60

// MaxPlayersPerGame borne la taille d'un lobby. Vingt équipes de trois = soixante
// héros autour d'une seule ville.
const MaxPlayersPerGame = 20

// Bornes de la carte. Le maximum n'est pas esthétique : chaque tuile voyage dans le
// payload JSON de la partie, donc une carte de 200² pèserait sur chaque requête.
const (
	MinMapSize = 40
	MaxMapSize = 140
)

// SizeForPlayers donne le côté de la carte pour un lobby de cette taille, à surface
// par joueur À PEU PRÈS CONSTANTE (~900 tuiles, la densité d'une partie à quatre sur
// 60×60). Sans ça, vingt joueurs se marchent dessus sur les mêmes gisements — et comme
// la horde semée croît avec la SURFACE (SeedStartingMonsters), c'est aussi ce qui fait
// monter la difficulté avec l'effectif, comme demandé.
func SizeForPlayers(players int) int {
	if players < 1 {
		players = 1
	}
	side := int(math.Round(math.Sqrt(float64(900 * players))))
	if side < MinMapSize {
		side = MinMapSize
	}
	if side > MaxMapSize {
		side = MaxMapSize
	}
	return side
}

// biomeFromLevel maps a SMOOTHED height level (0..genMaxHeight) to a biome using the
// design thresholds applied to level/maxHeight — so biomes follow the smoothed relief
// and transitions always ride the gentle slopes.
func biomeFromLevel(level int) game.Biome {
	v := float64(level) / float64(genMaxHeight)
	switch {
	case v < 0.30:
		return game.BiomeWater
	case v < 0.35:
		return game.BiomeSand
	case v < 0.60:
		return game.BiomeGrass
	case v < 0.75:
		return game.BiomeForest
	case v < 0.90:
		return game.BiomeMountain
	default:
		return game.BiomeSnow
	}
}

// smoothLevels iteratively lowers peaks until no tile is more than genMaxStep above
// any orthogonal neighbour (the Studio's "lissage" — same algorithm as the preview).
func smoothLevels(levels []int, width, height int) {
	for changed := true; changed; {
		changed = false
		for y := 0; y < height; y++ {
			for x := 0; x < width; x++ {
				i := y*width + x
				minN := 1 << 30
				for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
					nx, ny := x+d[0], y+d[1]
					if nx < 0 || ny < 0 || nx >= width || ny >= height {
						continue
					}
					if n := levels[ny*width+nx]; n < minN {
						minN = n
					}
				}
				if minN < 1<<30 && levels[i] > minN+genMaxStep {
					levels[i] = minN + genMaxStep
					changed = true
				}
			}
		}
	}
}

// GenerateTiles produces a row-major slice of tiles of size width*height using
// layered Perlin noise, smoothed so neighbouring tiles never differ by more than
// genMaxStep levels. Returns the tiles and the smoothed levels normalized to [0,1]
// (for tests).
func GenerateTiles(width, height int, seed int64) ([]game.Tile, []float64) {
	const (
		alpha = 2.0
		beta  = 2.0
		n     = 3
	)
	p := perlin.NewPerlin(alpha, beta, n, seed)
	// Un générateur LOCAL semé par la graine — surtout pas le hasard global : depuis
	// Go 1.24 `rand.Seed` est un no-op, si bien que deux parties de même graine ne
	// donnaient PAS la même carte. Le champ Seed du GameState mentait, et personne ne
	// s'en apercevait parce que rien n'échouait.
	rng := rand.New(rand.NewSource(seed))
	tiles := make([]game.Tile, width*height)
	hm := make([]float64, width*height)
	levels := make([]int, width*height)

	// Sample a few octaves, normalize into [0,1], quantize to height levels.
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			fx, fy := float64(x)*genScale, float64(y)*genScale
			v := p.Noise2D(fx, fy)            // octave 1
			v += 0.5 * p.Noise2D(fx*2, fy*2)  // octave 2
			v += 0.25 * p.Noise2D(fx*4, fy*4) // octave 3
			v /= 1.75
			nv := (v + 1) / 2 // Perlin output is roughly [-1,1]; squash to [0,1]
			if nv < 0 {
				nv = 0
			} else if nv > 1 {
				nv = 1
			}
			levels[y*width+x] = int(math.Round(nv * genMaxHeight))
		}
	}
	smoothLevels(levels, width, height)
	snow := snowCaps(levels, width, height)

	for i, lvl := range levels {
		hm[i] = float64(lvl) / float64(genMaxHeight)
		b := biomeFromLevel(lvl)
		if snow[i] {
			b = game.BiomeSnow
		}
		// Tile richness (number of successful searches) comes from the ⛰️ Terrains
		// tab: plains/forest 3–6, mountain/snow 1–3, water none.
		res := 0
		if td, ok := game.Terrains[b]; ok && td.Searchable {
			res = td.ResourcesMin + rng.Intn(td.ResourcesMax-td.ResourcesMin+1)
		}
		tiles[i] = game.Tile{Biome: b, Height: lvl, Resources: res}
	}
	return tiles, hm
}

// snowCaps coiffe de NEIGE les sommets du relief.
//
// ⚠ LA NEIGE N'EXISTAIT PAS. Les seuils du Studio donnent un biome par niveau de
// hauteur (0-1 eau, 2 sable, 3 prairie, 4 forêt, 5 montagne, 6 neige) — or le LISSAGE
// (genMaxStep 1, qui interdit qu'un pic touche une plaine) rabote systématiquement les
// sommets et le niveau 6 n'est JAMAIS atteint. Mesuré sur 8 graines et quatre tailles
// de carte : **zéro** tuile de neige, de 40² à 134², niveau maximum réellement produit
// = 5. Le biome, sa Tour gelée et le Plan de la Caserne qu'elle est SEULE à donner
// étaient donc du code mort — un bâtiment du catalogue inatteignable dans toutes les
// parties, sans que rien n'échoue nulle part.
//
// Le correctif garde le mécanisme de rareté intact (une spécialité par biome, cf.
// ruins.go) : on ne baisse pas le seuil de la neige, qui volerait tout son terrain à
// la montagne ; on coiffe les SOMMETS ISOLÉS — une tuile au niveau maximum dont les
// quatre voisines orthogonales sont strictement plus basses. Ça donne une poignée de
// tuiles (mesuré : 0,6 à 11 selon la taille), et la montagne garde l'essentiel de son
// terrain. La neige rend de la pierre comme la montagne (Terrains), donc l'économie de
// la ville ne bouge pas.
//
// ⚠ AU MOINS UNE : sur une petite carte les sommets isolés peuvent manquer, et la
// Caserne redeviendrait introuvable. On coiffe alors la première tuile du niveau
// maximum (ordre d'index = déterministe).
func snowCaps(levels []int, width, height int) []bool {
	snow := make([]bool, len(levels))
	maxLvl := 0
	for _, l := range levels {
		if l > maxLvl {
			maxLvl = l
		}
	}
	if maxLvl < 5 {
		return snow // relief trop mou pour porter des neiges éternelles
	}
	first, capped := -1, 0
	for i, l := range levels {
		if l != maxLvl {
			continue
		}
		if first < 0 {
			first = i
		}
		x, y := i%width, i/width
		isolated := true
		for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			nx, ny := x+d[0], y+d[1]
			if nx < 0 || ny < 0 || nx >= width || ny >= height {
				continue // le bord de carte ne compte pas comme un voisin plus haut
			}
			if levels[ny*width+nx] >= l {
				isolated = false
				break
			}
		}
		if isolated {
			snow[i] = true
			capped++
		}
	}
	if capped == 0 && first >= 0 {
		snow[first] = true
	}
	return snow
}

// findTown returns the walkable (grass-preferred) tile closest to the map center.
func findTown(tiles []game.Tile, width, height int) (int, int) {
	cx, cy := width/2, height/2
	bestX, bestY, bestScore := cx, cy, math.MaxFloat64
	found := false
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			b := tiles[y*width+x].Biome
			if b == game.BiomeWater {
				continue
			}
			d := math.Hypot(float64(x-cx), float64(y-cy))
			// Strongly prefer grass plains for the town.
			score := d
			if b != game.BiomeGrass {
				score += 8
			}
			if score < bestScore {
				bestScore, bestX, bestY = score, x, y
				found = true
			}
		}
	}
	if !found {
		// Degenerate world: force the center to grass.
		tiles[cy*width+cx] = game.Tile{Biome: game.BiomeGrass, Height: 3, Resources: 5}
		return cx, cy
	}
	return bestX, bestY
}

// ensureNearbyBiomes guarantees a FOREST (wood) and a MOUNTAIN (stone/ore) tile are
// reachable within radius R of the town. When a biome is missing, it carves a small
// 2×2 patch on the nearest land ring — biome + matching richness only, the height is
// left untouched so the relief stays coherent.
// Le VIVIER minimal de matériaux autour de la ville.
//
// Un seul carré de montagne à dix cases ne suffit pas : le bois et surtout la PIERRE
// sont ce dont la ville est faite (murs, remparts, réparations), et les cases
// s'épuisent. L'ancienne garantie ("au moins UNE tuile du biome dans le rayon 10")
// était satisfaite par n'importe quel caillou perdu — mesuré sur une carte 60×60
// lissée : 21 tuiles de montagne sur 3600, une seule à portée, épuisée en deux vagues,
// et donc ZÉRO pierre en banque sur toute la partie. Sans pierre : pas d'amélioration
// de muraille, pas de réparation de la ville, défaite arithmétique garantie.
//
// On garantit donc un GISEMENT : au moins minBiomeTiles tuiles de chaque biome-clé
// dans le rayon nearBiomeR. La carte générée est laissée telle quelle quand elle en
// fournit déjà assez — on ne creuse que le manque.
const (
	nearBiomeR     = 8  // rayon de référence (carte 60×60) dans lequel la ville doit trouver de quoi bâtir
	minBiomeTiles  = 12 // tuiles minimum par biome-clé dans ce rayon, pour une carte de référence
	blobHalfSpread = 2  // demi-largeur du gisement creusé
)

// biomeQuota adapte la garantie à la TAILLE de la carte — donc à celle de l'expédition.
// Le gisement était un absolu : douze tuiles de montagne dans le rayon 8, que la ville
// abrite trois héros ou soixante. Vingt équipes se partageaient donc la carrière d'un
// solo, et c'est ce qui faisait s'effondrer les grandes parties — mesuré : à vingt
// joueurs la banque restait à ZÉRO pierre, la muraille au niveau 1 et la ville tombait
// vague 8, quand huit joueurs tenaient vingt vagues. La densité de matériaux par héros
// doit être la même à toutes les tailles ; la surface l'est déjà (SizeForPlayers).
func biomeQuota(side int) (radius, tiles int) {
	// ⚠ LE RAYON NE SUIT PAS LA CARTE. Il suivait la taille du monde, ce qui satisfait
	// la garantie sur le papier et affame la ville en pratique : sur la carte d'une
	// expédition de vingt (134²) le « gisement proche » pouvait s'étaler jusqu'à DIX-HUIT
	// cases du bourg, alors qu'un héros a six PA par vague et doit rentrer. Mesuré sur
	// une partie de vingt joueurs : ZÉRO tuile de forêt découverte pendant trois vagues,
	// quatre en douze vagues contre cinquante de montagne — bois en banque = 0 du début
	// à la fin, donc ni tour, ni portail niveau 3, ni aucun des sites, pendant que 143
	// pierres dormaient à la Banque.
	//
	// La portée d'un héros est fixe ; c'est le monde qui grandit. Même erreur, même
	// correctif que hordeFrontRadius (wave.go).
	radius = nearBiomeR
	f := float64(side) / float64(DefaultSize)
	tiles = int(math.Round(float64(minBiomeTiles) * f * f)) // ∝ surface, comme la population
	if tiles < minBiomeTiles {
		tiles = minBiomeTiles
	}
	// …mais deux gisements ne peuvent pas dévorer tout le voisinage : un quart chacun
	// au plus, sinon la ville naît entre une falaise et une futaie, sans rien d'autre.
	if maxTiles := (2*radius + 1) * (2*radius + 1) / 4; tiles > maxTiles {
		tiles = maxTiles
	}
	return radius, tiles
}

func ensureNearbyBiomes(gs *game.GameState) {
	rng := rand.New(rand.NewSource(gs.Seed ^ 0x42696f6d)) // "Biom"
	side := gs.Width
	if gs.Height > side {
		side = gs.Height
	}
	R, quota := biomeQuota(side)
	w, h := gs.Width, gs.Height
	tx, ty := gs.Town.X, gs.Town.Y
	count := func(b game.Biome) int {
		n := 0
		for dy := -R; dy <= R; dy++ {
			for dx := -R; dx <= R; dx++ {
				nx, ny := tx+dx, ty+dy
				if nx >= 0 && ny >= 0 && nx < w && ny < h && gs.Tiles[ny*w+nx].Biome == b {
					n++
				}
			}
		}
		return n
	}
	res := func(b game.Biome) int {
		if td, ok := game.Terrains[b]; ok && td.ResourcesMax > 0 {
			return td.ResourcesMin + rng.Intn(td.ResourcesMax-td.ResourcesMin+1)
		}
		return 0
	}
	// carve grows a deposit of `b` around the first dry anchor found on a ring, until
	// `missing` tiles have been converted. Water is never overwritten (it would break
	// the coastline and the walkability the rest of the generator assumes), and neither
	// is the town tile itself.
	carve := func(b game.Biome, missing int) {
		for r := 3; r <= R && missing > 0; r++ {
			for dy := -r; dy <= r && missing > 0; dy++ {
				for dx := -r; dx <= r && missing > 0; dx++ {
					if absW(dx)+absW(dy) != r {
						continue
					}
					ax, ay := tx+dx, ty+dy
					if ax < 1 || ay < 1 || ax >= w-1 || ay >= h-1 || gs.Tiles[ay*w+ax].Biome == game.BiomeWater {
						continue
					}
					for oy := -blobHalfSpread; oy <= blobHalfSpread && missing > 0; oy++ {
						for ox := -blobHalfSpread; ox <= blobHalfSpread && missing > 0; ox++ {
							px, py := ax+ox, ay+oy
							if px < 1 || py < 1 || px >= w-1 || py >= h-1 {
								continue
							}
							if px == tx && py == ty {
								continue
							}
							t := &gs.Tiles[py*w+px]
							if t.Biome == game.BiomeWater || t.Biome == b {
								continue
							}
							t.Biome = b
							t.Resources = res(b)
							missing--
						}
					}
				}
			}
		}
	}
	// Mountains first: stone is the scarcer of the two and the one the walls eat.
	if n := count(game.BiomeMountain) + count(game.BiomeSnow); n < quota {
		carve(game.BiomeMountain, quota-n)
	}
	if n := count(game.BiomeForest); n < quota {
		carve(game.BiomeForest, quota-n)
	}
}

func absW(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// ensureSnowCap garantit qu'il reste au moins une tuile de NEIGE sur la carte, même
// quand le relief n'a produit aucun vrai sommet.
//
// snowCaps ne coiffe que les sommets du niveau maximum, et une carte molle n'en a pas :
// mesuré sur 40², les graines 4 et 6 plafonnent au niveau 4 (aucune montagne naturelle,
// c'est ensureNearbyBiomes qui creuse le gisement). Sans neige, pas de Tour gelée, donc
// pas de Plan de la Caserne — le bâtiment redevient inatteignable, ce que ce correctif
// entend justement supprimer. On coiffe donc le point culminant du gisement de
// montagne, ce qui garde la neige ACCROCHÉE à la roche au lieu de la poser au hasard.
//
// Déterministe (balayage en ordre de tuile) et ne coûte qu'UNE tuile, prise le plus
// loin possible du bourg — la ruine qu'elle porte doit rester un voyage (SeedRuins
// exige Chebyshev ≥ 3).
func ensureSnowCap(gs *game.GameState) {
	best := -1
	bestScore := -1
	for i, t := range gs.Tiles {
		if t.Biome == game.BiomeSnow {
			return // la carte a déjà ses neiges
		}
		if t.Biome != game.BiomeMountain {
			continue
		}
		x, y := i%gs.Width, i/gs.Width
		d := absW(x-gs.Town.X) + absW(y-gs.Town.Y)
		if maxW(absW(x-gs.Town.X), absW(y-gs.Town.Y)) < 3 {
			continue
		}
		if score := t.Height*1000 + d; score > bestScore {
			best, bestScore = i, score
		}
	}
	if best < 0 {
		return
	}
	gs.Tiles[best].Biome = game.BiomeSnow
	if td, ok := game.Terrains[game.BiomeSnow]; ok && td.ResourcesMax > 0 {
		// Richesse déterministe : la moyenne du biome, pas un tirage — cette tuile est
		// posée par une garantie, pas par le hasard du monde.
		gs.Tiles[best].Resources = (td.ResourcesMin + td.ResourcesMax) / 2
	}
}

func maxW(a, b int) int {
	if b > a {
		return b
	}
	return a
}

// --- thèmes d'expédition ------------------------------------------------------------
//
// « Dominant » ne veut PAS dire « monochrome » : le thème décide du biome qui entoure
// la VILLE, pas du monde entier. Le biais décroît avec la distance au bourg, si bien
// qu'au loin la carte redevient elle-même — avec ses montagnes, ses forêts et ses lacs.
// C'est voulu : la variété devient lointaine, donc elle se mérite (« il faut descendre
// au sud pour trouver du sable, donc l'épave, donc le Plan du Cartographe »), et le
// thème devient un moteur d'exploration.
//
// ⚠ DEUX GARDE-FOUS, et ils ne sont pas négociables :
//  1. la GARANTIE DE GISEMENT l'emporte sur le thème — applyThemeBias tourne AVANT
//     ensureNearbyBiomes, qui creuse ensuite ses quotas de forêt et de montagne comme
//     si de rien n'était. Une carte nordique, c'est de la neige à perte de vue PLUS un
//     bosquet et une carrière garantis. Sans ça on rejoue la famine déjà mesurée deux
//     fois (banque à zéro bois, aucun chantier, défaite arithmétique) ;
//  2. aucun biome PRÉSENT ne peut disparaître (keepBiomesAlive) : SeedRuins pose une
//     ruine par biome présent et chaque ruine porte le plan d'une spécialité — noyer
//     un biome sous le sable ferait disparaître un bâtiment de la partie.
const (
	themeMinKeep = 8 // tuiles minimum conservées par biome que la carte possédait déjà
)

// applyThemeBias convertit une partie des tuiles vers le biome dominant du thème, avec
// une probabilité maximale au centre et nulle au bord du rayon. L'EAU n'est jamais
// convertie (elle porte les côtes, la cascade et la praticabilité que le reste du
// générateur suppose).
func applyThemeBias(gs *game.GameState, th *game.ThemeDef) {
	if th == nil || th.Bias <= 0 {
		return
	}
	w, h := gs.Width, gs.Height
	radius := float64(w)
	if float64(h) > radius {
		radius = float64(h)
	}
	radius /= 2 // la moitié de la carte : au-delà, le monde est à lui-même
	if radius <= 0 {
		return
	}
	rng := rand.New(rand.NewSource(gs.Seed ^ 0x5468656d)) // "Them"
	res := func(b game.Biome) int {
		if td, ok := game.Terrains[b]; ok && td.ResourcesMax > 0 {
			return td.ResourcesMin + rng.Intn(td.ResourcesMax-td.ResourcesMin+1)
		}
		return 0
	}
	before := map[game.Biome]int{}
	for _, t := range gs.Tiles {
		before[t.Biome]++
	}
	// converted garde ce qu'on a transformé, DU PLUS PROCHE AU PLUS LOIN de la ville :
	// keepBiomesAlive rendra les plus lointaines en premier, pour que le cœur du thème
	// reste pur.
	type conv struct {
		idx  int
		from game.Biome
		dist float64
	}
	var converted []conv
	for i := range gs.Tiles {
		t := &gs.Tiles[i]
		if t.Biome == game.BiomeWater || t.Biome == th.Dominant {
			continue
		}
		x, y := i%w, i/w
		d := math.Hypot(float64(x-gs.Town.X), float64(y-gs.Town.Y))
		p := th.Bias * (1 - d/radius)
		if p <= 0 || rng.Float64() >= p {
			continue
		}
		converted = append(converted, conv{i, t.Biome, d})
		t.Biome = th.Dominant
		t.Resources = res(th.Dominant)
	}
	sort.Slice(converted, func(i, j int) bool { return converted[i].dist < converted[j].dist })
	// Garde-fou 2 : rendre ce qu'il faut pour qu'aucun biome ne disparaisse.
	after := map[game.Biome]int{}
	for _, t := range gs.Tiles {
		after[t.Biome]++
	}
	for b, n := range before {
		if b == game.BiomeWater || b == th.Dominant || n == 0 {
			continue
		}
		want := themeMinKeep
		if n < want {
			want = n // un biome déjà rare le reste : on ne fabrique pas ce qui n'était pas là
		}
		for i := len(converted) - 1; i >= 0 && after[b] < want; i-- {
			c := converted[i]
			if c.from != b {
				continue
			}
			gs.Tiles[c.idx].Biome = b
			gs.Tiles[c.idx].Resources = res(b)
			after[b]++
			after[th.Dominant]--
		}
	}
}

// Option paramètre la génération d'un monde. Une seule aujourd'hui — le THÈME — et
// elle existe pour que la simulation d'équilibrage puisse balayer les thèmes un par un
// (`cmd/balance -theme nordique`) : en jeu, le thème se tire de la graine et ne se
// choisit pas.
type Option func(*genOpts)

type genOpts struct{ theme *game.ThemeDef }

// WithTheme impose le thème au lieu de le tirer de la graine (outillage, tests).
func WithTheme(id string) Option {
	return func(o *genOpts) {
		if id != "" {
			o.theme = game.ThemeByID(id)
		}
	}
}

func resolveOpts(seed int64, opts []Option) genOpts {
	o := genOpts{theme: game.PickTheme(seed)}
	for _, f := range opts {
		f(&o)
	}
	return o
}

// newWorld builds the shared skeleton of a game: generated world, town at the center
// plain, default buildings, seeded monsters — but no heroes, players, or status yet.
func newWorld(width, height int, seed int64, theme *game.ThemeDef) *game.GameState {
	// (Pas de rand.Seed : c'est un no-op depuis Go 1.24. Chaque étape qui tire au sort
	// reçoit un générateur semé par la graine — c'est ce qui rend enfin vraie la
	// promesse « même graine, même monde ».)
	tiles, _ := GenerateTiles(width, height, seed)
	tx, ty := findTown(tiles, width, height)

	gs := &game.GameState{
		ID:        uuid.NewString(),
		Seed:      seed,
		Width:     width,
		Height:    height,
		Tiles:     tiles,
		Monsters:  map[string]*game.Monster{},
		Combats:   map[string]*game.Combat{},
		Day:       1,
		Wave:      0,
		CreatedAt: time.Now(),
	}
	gs.Town.Name = game.NewTownName()
	gs.Town.X, gs.Town.Y = tx, ty
	// La NATURE de l'expédition (theme.go), tirée de la graine. Le biais habille les
	// abords de la ville de son biome dominant…
	gs.ThemeID = theme.ID
	applyThemeBias(gs, theme)
	// …puis la garantie passe APRÈS et l'emporte : quel que soit le thème, la ville
	// doit trouver du bois et de la pierre à portée de héros, sinon les matériaux de
	// base sont hors d'atteinte et on ne peut jamais amorcer la construction.
	ensureNearbyBiomes(gs)
	ensureSnowCap(gs)
	// LE RELIEF DEVIENT UN OBSTACLE (escarpments.go) — en DERNIER, une fois les
	// biomes définitifs : cette passe relève des hauteurs sans jamais toucher à un
	// biome, donc elle doit voir la carte que les joueurs auront vraiment (le biais
	// de thème et les deux garanties de gisement sont déjà passés).
	carveEscarpments(gs, rand.New(rand.NewSource(seed^0x5CA49)))
	gs.Town.HP, gs.Town.MaxHP = 100, 100
	gs.Town.Buildings = game.DefaultBuildings()
	gs.Town.Storage = []game.Item{}
	// The town tile can't be searched (SearchTile rejects it), so it must not carry
	// resources: bots' nearest-resource targeting and the UI would chase a tile
	// that can never be harvested.
	gs.Tiles[ty*width+tx].Resources = 0
	// Ruines-donjons : un bâtiment en ruine par biome présent (déterministe par
	// seed) — chantier de déblayage collectif puis donjon à butin rare (ruins.go).
	gs.SeedRuins()
	return gs
}

// NewLobby builds a game in "lobby" status: the world exists but no hero is spawned
// and no wave is scheduled — players join (AddPlayer) then the host launches it
// (StartGame) once at least minPlayers have joined.
func NewLobby(width, height int, seed int64, name string, minPlayers, maxPlayers int, opts ...Option) *game.GameState {
	if maxPlayers < 1 {
		maxPlayers = 4
	}
	if maxPlayers > MaxPlayersPerGame {
		maxPlayers = MaxPlayersPerGame
	}
	if minPlayers < 1 {
		minPlayers = 1
	}
	if minPlayers > maxPlayers {
		minPlayers = maxPlayers
	}
	// La carte suit l'expédition : une taille fixe pour vingt joueurs voudrait dire
	// vingt équipes qui se disputent les mêmes forêts, et un solo perdu au milieu d'un
	// monde vide. Un appelant qui ne demande rien reçoit la taille de son lobby.
	if width <= 0 || height <= 0 {
		width = SizeForPlayers(maxPlayers)
		height = width
	}
	gs := newWorld(width, height, seed, resolveOpts(seed, opts).theme)
	gs.Name = name
	gs.Status = game.StatusLobby
	gs.JoinCode = game.NewJoinCode()
	gs.MinPlayers = minPlayers
	gs.MaxPlayers = maxPlayers
	gs.Recompute()
	return gs
}

// NewGame builds a fresh, ready-to-play solo GameState: generated world, town at the
// center plain, three heroes spawned on the town, and a few monsters seeded nearby.
// (Legacy/dev path — the multiplayer flow goes through NewLobby.)
func NewGame(width, height int, seed int64, opts ...Option) *game.GameState {
	gs := newWorld(width, height, seed, resolveOpts(seed, opts).theme)
	gs.MinPlayers, gs.MaxPlayers = 1, 3
	gs.Status = "active"
	gs.StartedAt = time.Now()
	gs.NextWaveAt = time.Now().Add(game.WaveInterval)

	// Three classless starter heroes (per the GDD early game: 1 joueur = 3 héros).
	for _, name := range []string{"Aldric", "Brisa", "Cael"} {
		gs.Heroes = append(gs.Heroes, game.NewStarterHero(len(gs.Heroes), name, gs.Town.X, gs.Town.Y))
	}
	gs.SeedStartingMonsters(1)
	gs.InitWellRations() // 2 jours d'eau × héros au départ
	gs.Recompute()
	return gs
}

// (Initial monster seeding lives in game.SeedStartingMonsters — it runs at launch
// time, scaled by the number of players.)
