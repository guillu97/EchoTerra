// Package game holds the Echo Terra domain model for the prototype vertical slice.
//
// The whole game state lives in a single GameState struct that gets serialized to
// JSON and persisted as a blob (see internal/store). This keeps the prototype simple
// while remaining server-authoritative: every action is validated and applied here.
package game

import "time"

// Biome enumerates the map tile types produced by world generation.
type Biome int

const (
	BiomeWater Biome = iota
	BiomeSand
	BiomeGrass
	BiomeForest
	BiomeMountain
	BiomeSnow
)

// Walkable reports whether a hero may stand on this biome on the global map.
func (b Biome) Walkable() bool { return b != BiomeWater }

// Stats are the six physical competences from the GDD.
type Stats struct {
	Force      int `json:"force"`
	Dexterite  int `json:"dexterite"`
	Agilite    int `json:"agilite"`
	Endurance  int `json:"endurance"`
	Athletisme int `json:"athletisme"`
	Precision  int `json:"precision"`
}

// Item is a stack of loot in a hero inventory.
type Item struct {
	Type string `json:"type"` // animal | objet | plante | minerai | eau | aliment
	Name string `json:"name"`
	Qty  int    `json:"qty"`
}

// Tile is one cell of the global orthogonal map.
type Tile struct {
	Biome     Biome `json:"biome"`
	Height    int   `json:"height"`    // cosmetic elevation on the global map
	Resources int   `json:"resources"` // remaining successful searches (0 => depleted)
	MonsterID string `json:"monsterId,omitempty"`
}

// Hero is a controllable unit on the global map.
type Hero struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	X         int      `json:"x"`
	Y         int      `json:"y"`
	PA        int      `json:"pa"`
	MaxPA     int      `json:"maxPa"`
	HP        int      `json:"hp"`
	MaxHP     int      `json:"maxHp"`
	Stats     Stats    `json:"stats"`
	Class     string   `json:"class"`
	States    []string `json:"states"`
	Inventory []Item   `json:"inventory"`
	// Barres de competences (montent selon les actions, influencent les classes).
	Bars map[string]int `json:"bars"`
}

// HasState reports whether the hero currently has the named state.
func (h *Hero) HasState(s string) bool {
	for _, st := range h.States {
		if st == s {
			return true
		}
	}
	return false
}

// AddState adds a state if not already present.
func (h *Hero) AddState(s string) {
	if !h.HasState(s) {
		h.States = append(h.States, s)
	}
}

// RemoveState removes a state if present.
func (h *Hero) RemoveState(s string) {
	out := h.States[:0]
	for _, st := range h.States {
		if st != s {
			out = append(out, st)
		}
	}
	h.States = out
}

// AddLoot merges a stack into the inventory.
func (h *Hero) AddLoot(it Item) {
	for i := range h.Inventory {
		if h.Inventory[i].Name == it.Name {
			h.Inventory[i].Qty += it.Qty
			return
		}
	}
	h.Inventory = append(h.Inventory, it)
}

// Monster is an enemy on the global map; it expands into combat units on engagement.
type Monster struct {
	ID      string `json:"id"`
	Species string `json:"species"`
	X       int    `json:"x"`
	Y       int    `json:"y"`
	HP      int    `json:"hp"`
	MaxHP   int    `json:"maxHp"`
	Stats   Stats  `json:"stats"`
	Count   int    `json:"count"` // how many creatures stand on the tile
}

// GameState is the full persisted state of one game (one cooperative session).
type GameState struct {
	ID       string              `json:"id"`
	Seed     int64               `json:"seed"`
	Width    int                 `json:"width"`
	Height   int                 `json:"height"`
	Tiles    []Tile              `json:"tiles"` // row-major, length Width*Height
	Heroes   []*Hero             `json:"heroes"`
	Monsters map[string]*Monster `json:"monsters"`
	Day      int                 `json:"day"`
	Wave     int                 `json:"wave"`
	// Horde / wave scheduling (server-authoritative).
	WaveNumber int          `json:"waveNumber"` // total waves resolved so far
	NextWaveAt time.Time    `json:"nextWaveAt"` // when the next wave hits the town
	Status     string       `json:"status"`     // "active" | "gameover"
	LastWave   *WaveReport  `json:"lastWave,omitempty"`
	Town       struct {
		X         int             `json:"x"`
		Y         int             `json:"y"`
		HP        int             `json:"hp"`
		MaxHP     int             `json:"maxHp"`
		Defense   int             `json:"defense"` // computed from defensive buildings
		Buildings []*TownBuilding `json:"buildings"`
		Storage   []Item          `json:"storage"` // shared stash (the House/Bank)
	} `json:"town"`
	// ActiveCombat is the id of the combat in progress, if any.
	ActiveCombat string             `json:"activeCombat,omitempty"`
	Combats      map[string]*Combat `json:"combats,omitempty"`
}

// TileAt returns a pointer to the tile at (x,y), or nil if out of bounds.
func (g *GameState) TileAt(x, y int) *Tile {
	if x < 0 || y < 0 || x >= g.Width || y >= g.Height {
		return nil
	}
	return &g.Tiles[y*g.Width+x]
}

// HeroByID returns the hero with the given id, or nil.
func (g *GameState) HeroByID(id string) *Hero {
	for _, h := range g.Heroes {
		if h.ID == id {
			return h
		}
	}
	return nil
}
