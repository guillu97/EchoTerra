package game

import (
	"math/rand"
	"time"
)

// WaveInterval is the real-time delay between two horde waves (set from main via env).
var WaveInterval = 10 * time.Minute

// Defensive buildings and their base defense per level. The town's total defense is
// the sum over these, scaled by each building's durability.
var defensiveBase = map[string]int{
	"wall":  8,
	"gate":  5,
	"tower": 6,
}

// WaveHit records a durability/HP change applied to a building or hero during a wave.
type WaveHit struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Delta int    `json:"delta"` // negative
}

// WaveReport summarizes the outcome of one wave for the UI.
type WaveReport struct {
	Wave            int       `json:"wave"`
	Day             int       `json:"day"`
	HordePower      int       `json:"hordePower"`
	Defense         int       `json:"defense"`
	TownDamage      int       `json:"townDamage"`
	TownHPAfter     int       `json:"townHpAfter"`
	BuildingsHit    []WaveHit `json:"buildingsHit"`
	HeroesHit       []WaveHit `json:"heroesHit"`
	MonstersSpawned int       `json:"monstersSpawned"`
	At              time.Time `json:"at"`
	GameOver        bool      `json:"gameOver"`
}

// TownDefense computes the city's defense from its defensive buildings, scaled by
// durability (a broken wall barely protects).
// buildingDefense is one building's contribution to the town defense (0 if it isn't a
// defensive building, isn't built, or — for the Gate — is left open).
func buildingDefense(b *TownBuilding) int {
	base, ok := defensiveBase[b.ID]
	if !ok || !b.Built {
		return 0
	}
	if b.ID == "gate" && b.Open {
		return 0
	}
	ratio := 1.0
	if b.MaxDurability > 0 {
		ratio = float64(b.Durability) / float64(b.MaxDurability)
	}
	return int(float64(base*b.Level) * ratio)
}

func (g *GameState) TownDefense() int {
	def := 0
	for _, b := range g.Town.Buildings {
		def += buildingDefense(b)
	}
	return def
}

// Recompute refreshes derived fields (town defense, hero "Tétanisé", building costs,
// Bank usage). Safe anytime.
func (g *GameState) Recompute() {
	g.Town.Defense = g.TownDefense()
	g.recomputeTetanise()
	// Which in-town heroes have already drawn their daily water ration.
	drawn := g.Town.WaterDrawnToday[:0]
	for _, h := range g.HeroesInTown() {
		if h.DrewWaterDay == g.Day {
			drawn = append(drawn, h.ID)
		}
	}
	g.Town.WaterDrawnToday = drawn
	total := 0
	for _, it := range g.Town.Storage {
		total += it.Qty
	}
	for _, b := range g.Town.Buildings {
		b.Cost = buildingCost(b)
		b.Defense = buildingDefense(b)
		if b.ID == "bank" {
			b.Capacity = total // the Bank's "contents" = the town storage
		}
	}
}

// heroesPerPack: how many monsters one hero can "hold" before being overwhelmed.
// GDD: joueurs requis = monstres ÷ 4. A Gardien will later count for 3 heroes — the
// effective-players computation in recomputeTetanise is the hook for that.
const heroesPerPack = 4

// recomputeTetanise sets/clears the "Tétanisé" state: a hero is stuck (no movement)
// when standing on a tile with 2+ monsters and there aren't enough heroes to hold the
// pack (effectivePlayers < ceil(monsters / heroesPerPack)).
func (g *GameState) recomputeTetanise() {
	type key struct{ x, y int }
	players := map[key]int{}
	for _, h := range g.Heroes {
		if h.HP > 0 {
			players[key{h.X, h.Y}]++ // TODO: a Gardien here should add 3, not 1
		}
	}
	for _, h := range g.Heroes {
		stuck := false
		if h.HP > 0 {
			if t := g.TileAt(h.X, h.Y); t != nil && t.MonsterID != "" {
				if m := g.Monsters[t.MonsterID]; m != nil && m.Count >= 2 {
					required := (m.Count + heroesPerPack - 1) / heroesPerPack
					if players[key{h.X, h.Y}] < required {
						stuck = true
					}
				}
			}
		}
		if stuck {
			h.AddState(StateTetanise)
		} else {
			h.RemoveState(StateTetanise)
		}
	}
}

func hordePower(waveNumber int) int {
	return 12 + waveNumber*6 + rand.Intn(6)
}

// ProcessWave resolves a single horde assault on the town. It does NOT schedule the
// next wave — callers (ForceWave / CatchUpWaves) own NextWaveAt.
func (g *GameState) ProcessWave(now time.Time) {
	if g.Status != "active" {
		return
	}
	g.WaveNumber++
	g.Wave++
	if g.Wave >= 2 {
		g.Wave = 0
		g.Day++
	}

	power := hordePower(g.WaveNumber)
	defense := g.TownDefense()

	r := &WaveReport{Wave: g.WaveNumber, Day: g.Day, HordePower: power, Defense: defense, At: now}

	// Defensive structures absorb the blow, wearing down in the process.
	absorbed := power
	if absorbed > defense {
		absorbed = defense
	}
	g.wearDefensiveBuildings(absorbed, r)

	// Whatever the defenses can't stop hits the town (and some buildings).
	overflow := power - defense
	if overflow < 0 {
		overflow = 0
	}
	if overflow > 0 {
		g.Town.HP -= overflow
		if g.Town.HP < 0 {
			g.Town.HP = 0
		}
		r.TownDamage = overflow
		g.damageRandomBuildings(overflow, r)
	}
	r.TownHPAfter = g.Town.HP

	// Heroes caught outside the walls are attacked individually.
	g.attackHeroesOutside(g.WaveNumber, r)

	// A new half-day begins: surviving heroes recover their action points.
	for _, h := range g.Heroes {
		if h.HP > 0 {
			h.PA = h.MaxPA
			h.RemoveState(StateFatigue)
			h.RemoveState(StateTetanise)
		}
	}

	// The Well slowly refills between waves.
	if w := g.buildingByID("well"); w != nil && w.Built && w.Capacity < w.MaxCapacity {
		w.Capacity += 10
		if w.Capacity > w.MaxCapacity {
			w.Capacity = w.MaxCapacity
		}
	}

	// The horde grows: new monsters appear on the map.
	r.MonstersSpawned = g.spawnWaveMonsters(g.WaveNumber)

	if g.Town.HP <= 0 {
		g.Status = "gameover"
		r.GameOver = true
	}

	g.LastWave = r
	g.Recompute()
}

// ForceWave triggers a wave immediately (used by the dev "advance" endpoint).
func (g *GameState) ForceWave(now time.Time) {
	if g.Status != "active" {
		return
	}
	g.ProcessWave(now)
	g.NextWaveAt = now.Add(WaveInterval)
}

// CatchUpWaves processes any wave whose time has passed. To stay forgiving when a
// player has been away a long time, it resolves at most a few missed waves then snaps
// the timer to the future. Returns true if the state changed.
func (g *GameState) CatchUpWaves(now time.Time) bool {
	if g.Status != "active" || g.NextWaveAt.IsZero() {
		return false
	}
	changed := false
	for guard := 0; guard < 3 && g.Status == "active" && now.After(g.NextWaveAt); guard++ {
		g.ProcessWave(now)
		g.NextWaveAt = g.NextWaveAt.Add(WaveInterval)
		changed = true
	}
	if g.Status == "active" && now.After(g.NextWaveAt) {
		g.NextWaveAt = now.Add(WaveInterval)
		changed = true
	}
	return changed
}

func (g *GameState) wearDefensiveBuildings(absorbed int, r *WaveReport) {
	if absorbed <= 0 {
		return
	}
	var def []*TownBuilding
	for _, b := range g.Town.Buildings {
		if _, ok := defensiveBase[b.ID]; ok && b.Built && b.Durability > 0 {
			def = append(def, b)
		}
	}
	if len(def) == 0 {
		return
	}
	per := absorbed / (len(def) * 2)
	if per < 1 {
		per = 1
	}
	for _, b := range def {
		before := b.Durability
		b.Durability -= per
		if b.Durability < 0 {
			b.Durability = 0
		}
		if b.Durability != before {
			r.BuildingsHit = append(r.BuildingsHit, WaveHit{b.ID, b.Name, b.Durability - before})
		}
	}
}

func (g *GameState) damageRandomBuildings(overflow int, r *WaveReport) {
	var others []*TownBuilding
	for _, b := range g.Town.Buildings {
		if _, ok := defensiveBase[b.ID]; !ok && b.Built && b.Durability > 0 {
			others = append(others, b)
		}
	}
	if len(others) == 0 {
		return
	}
	hits := 1 + overflow/15
	for i := 0; i < hits; i++ {
		b := others[rand.Intn(len(others))]
		before := b.Durability
		b.Durability -= 5 + rand.Intn(10)
		if b.Durability < 0 {
			b.Durability = 0
		}
		if b.Durability != before {
			r.BuildingsHit = append(r.BuildingsHit, WaveHit{b.ID, b.Name, b.Durability - before})
		}
	}
}

func (g *GameState) attackHeroesOutside(waveNumber int, r *WaveReport) {
	for _, h := range g.Heroes {
		if h.HP <= 0 || (h.X == g.Town.X && h.Y == g.Town.Y) {
			continue // dead or safely in town
		}
		if h.HasState("Caché") {
			h.RemoveState("Caché") // concealment saves them this wave, then fades
			continue
		}
		dmg := 3 + waveNumber + rand.Intn(4)
		if t := g.TileAt(h.X, h.Y); t != nil && t.MonsterID != "" {
			dmg += 4 // monsters already on the hero's tile pile on
		}
		before := h.HP
		h.HP -= dmg
		if h.HP < 0 {
			h.HP = 0
		}
		h.AddState("Blessé")
		r.HeroesHit = append(r.HeroesHit, WaveHit{h.ID, h.Name, h.HP - before})
	}
}

func (g *GameState) spawnWaveMonsters(waveNumber int) int {
	count := 2 + waveNumber/2
	if count > 8 {
		count = 8
	}
	spawned := 0
	for tries := 0; tries < count*30 && spawned < count; tries++ {
		x, y := rand.Intn(g.Width), rand.Intn(g.Height)
		if x == g.Town.X && y == g.Town.Y {
			continue
		}
		t := g.TileAt(x, y)
		if t == nil || !t.Biome.Walkable() || t.MonsterID != "" {
			continue
		}
		m := NewMonster(MonsterSpecies[rand.Intn(len(MonsterSpecies))], x, y)
		// The horde packs grow with the waves, so lone heroes can get Tétanisé.
		m.Count = 2 + rand.Intn(3+waveNumber)
		if m.Count > 9 {
			m.Count = 9
		}
		g.Monsters[m.ID] = m
		t.MonsterID = m.ID
		spawned++
	}
	return spawned
}
