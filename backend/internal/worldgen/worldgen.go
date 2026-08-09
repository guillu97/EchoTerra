// Package worldgen generates the global map (heightmap -> biomes) and assembles a
// fresh GameState. The biome thresholds mirror the Python snippet from the GDD so the
// generated world matches the design intent.
package worldgen

import (
	"math"
	"math/rand"
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

// DefaultSize is the default map edge from the design's mapgen parameters (60×60).
const DefaultSize = 60

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

	for i, lvl := range levels {
		hm[i] = float64(lvl) / float64(genMaxHeight)
		b := biomeFromLevel(lvl)
		// Tile richness (number of successful searches) comes from the ⛰️ Terrains
		// tab: plains/forest 3–6, mountain/snow 1–3, water none.
		res := 0
		if td, ok := game.Terrains[b]; ok && td.Searchable {
			res = td.ResourcesMin + rand.Intn(td.ResourcesMax-td.ResourcesMin+1)
		}
		tiles[i] = game.Tile{Biome: b, Height: lvl, Resources: res}
	}
	return tiles, hm
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
	nearBiomeR     = 8  // rayon dans lequel la ville doit trouver de quoi bâtir
	minBiomeTiles  = 12 // tuiles minimum par biome-clé dans ce rayon
	blobHalfSpread = 2  // demi-largeur du gisement creusé
)

func ensureNearbyBiomes(gs *game.GameState) {
	const R = nearBiomeR
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
			return td.ResourcesMin + rand.Intn(td.ResourcesMax-td.ResourcesMin+1)
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
	if n := count(game.BiomeMountain) + count(game.BiomeSnow); n < minBiomeTiles {
		carve(game.BiomeMountain, minBiomeTiles-n)
	}
	if n := count(game.BiomeForest); n < minBiomeTiles {
		carve(game.BiomeForest, minBiomeTiles-n)
	}
}

func absW(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// newWorld builds the shared skeleton of a game: generated world, town at the center
// plain, default buildings, seeded monsters — but no heroes, players, or status yet.
func newWorld(width, height int, seed int64) *game.GameState {
	rand.Seed(seed)
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
	// Accès aux biomes : garantit une forêt (bois) et une montagne (pierre)
	// atteignables près de la ville — sinon les matériaux de base sont hors de
	// portée et on ne peut jamais amorcer la construction.
	ensureNearbyBiomes(gs)
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
func NewLobby(width, height int, seed int64, name string, minPlayers, maxPlayers int) *game.GameState {
	if maxPlayers < 1 {
		maxPlayers = 4
	}
	if maxPlayers > 8 {
		maxPlayers = 8
	}
	if minPlayers < 1 {
		minPlayers = 1
	}
	if minPlayers > maxPlayers {
		minPlayers = maxPlayers
	}
	gs := newWorld(width, height, seed)
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
func NewGame(width, height int, seed int64) *game.GameState {
	gs := newWorld(width, height, seed)
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
