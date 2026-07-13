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

// biomeFromHeight maps a normalized height value in [0,1] to a biome, using the
// thresholds from the GDD (water .30 / sand .35 / grass .60 / forest .75 / mountain .90 / snow).
func biomeFromHeight(v float64) game.Biome {
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

// heightLevel turns a normalized value into a small integer elevation for display.
func heightLevel(v float64) int {
	return int(math.Round(v * 6))
}

// GenerateTiles produces a row-major slice of tiles of size width*height using
// layered Perlin noise. Returns the tiles and the normalized heightmap (for tests).
func GenerateTiles(width, height int, seed int64) ([]game.Tile, []float64) {
	const (
		alpha = 2.0
		beta  = 2.0
		n     = 3
	)
	p := perlin.NewPerlin(alpha, beta, n, seed)
	tiles := make([]game.Tile, width*height)
	hm := make([]float64, width*height)

	// Sample a few octaves and normalize the result into [0,1].
	scale := 0.08
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			fx, fy := float64(x)*scale, float64(y)*scale
			v := p.Noise2D(fx, fy)         // octave 1
			v += 0.5 * p.Noise2D(fx*2, fy*2) // octave 2
			v += 0.25 * p.Noise2D(fx*4, fy*4) // octave 3
			v /= 1.75
			// Perlin output is roughly [-1,1]; squash to [0,1].
			nv := (v + 1) / 2
			if nv < 0 {
				nv = 0
			} else if nv > 1 {
				nv = 1
			}
			idx := y*width + x
			hm[idx] = nv
			b := biomeFromHeight(nv)
			res := 0
			if b != game.BiomeWater {
				// Forest/grass are richer; mountains/snow are sparse.
				switch b {
				case game.BiomeForest, game.BiomeGrass:
					res = 3 + rand.Intn(4)
				default:
					res = 1 + rand.Intn(3)
				}
			}
			tiles[idx] = game.Tile{Biome: b, Height: heightLevel(nv), Resources: res}
		}
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
	gs.Town.HP, gs.Town.MaxHP = 100, 100
	gs.Town.Buildings = game.DefaultBuildings()
	gs.Town.Storage = []game.Item{}
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
	gs.Recompute()
	return gs
}

// (Initial monster seeding lives in game.SeedStartingMonsters — it runs at launch
// time, scaled by the number of players.)
