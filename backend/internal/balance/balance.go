// Package balance runs a whole Echo Terra game headlessly, wave after wave, and
// reports what happened. It exists to answer ONE question automatically: « une partie
// est-elle jouable ? » — i.e. does a town driven only by the bot AI survive, build,
// gather and evolve, or does it get flattened in a handful of waves?
//
// The harness is deliberately NOT a mock. It builds a real world with worldgen, seeds
// real bot players, and advances the real simulation clock (game.AdvanceTo) — the same
// code path the heartbeat runs in production. So a verdict here is a verdict about the
// actual game, and a bot improvement shows up as a moved number rather than a hunch.
//
// Two consumers:
//   - `go run ./cmd/balance` — the exploration tool (tables, per-wave curves, sweeps);
//   - balance_test.go — the regression guard ("the town must not fall before wave N").
package balance

import (
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"time"

	"echoterra/internal/game"
	"echoterra/internal/worldgen"
)

// Config describes one simulated run.
type Config struct {
	Seed    int64 // world seed (also seeds the global RNG → runs are reproducible)
	Width   int   // map size (0 → worldgen.DefaultSize)
	Height  int
	Players int // bot players; each fields game.HeroesPerPlayer heroes
	Waves   int // how many waves to simulate before stopping
}

func (c Config) withDefaults() Config {
	if c.Width <= 0 {
		c.Width = worldgen.DefaultSize
	}
	if c.Height <= 0 {
		c.Height = worldgen.DefaultSize
	}
	if c.Players <= 0 {
		c.Players = 4
	}
	if c.Waves <= 0 {
		c.Waves = 20
	}
	return c
}

// Snapshot is the state of the town right after one wave resolved. These are the
// numbers a balance discussion actually needs: what hit us, what held, what we own,
// and whether the expedition is still making progress out in the field.
type Snapshot struct {
	Wave       int `json:"wave"`
	Day        int `json:"day"`
	HordePower int `json:"hordePower"`
	Defense    int `json:"defense"`
	TownDamage int `json:"townDamage"`
	TownHP     int `json:"townHp"`

	HeroesAlive   int `json:"heroesAlive"`
	HeroesInTown  int `json:"heroesInTown"`
	HeroesHidden  int `json:"heroesHidden"`
	HeroesStuck   int `json:"heroesStuck"` // Tétanisé — pinned by a pack
	HeroesWounded int `json:"heroesWounded"`
	HeroesEvolved int `json:"heroesEvolved"` // classTier >= 1

	BuiltCount  int    `json:"builtCount"`  // buildings standing
	LevelSum    int    `json:"levelSum"`    // sum of levels (progression of the town)
	Chantiers   int    `json:"chantiers"`   // open construction sites
	GateOpen    bool   `json:"gateOpen"`    // an open gate = zero gate defense
	DefenseWear int    `json:"defenseWear"` // % durability left on defensive buildings
	Buildings   string `json:"buildings"`   // compact "wall2 gate1 tower0…"

	BankItems int `json:"bankItems"` // total qty in the Bank
	BankWood  int `json:"bankWood"`
	BankStone int `json:"bankStone"`
	BagItems  int `json:"bagItems"` // total qty still in hero bags

	MonsterPacks   int `json:"monsterPacks"`
	MonsterUnits   int `json:"monsterUnits"`
	MonstersKilled int `json:"monstersKilled"`

	ResourceTiles int `json:"resourceTiles"` // discovered walkable tiles with resources left
	ResourcesLeft int `json:"resourcesLeft"` // sum of those resources
	Discovered    int `json:"discovered"`    // tiles out of the fog
}

// Report is the outcome of one run.
type Report struct {
	Config    Config     `json:"config"`
	TownName  string     `json:"townName"`
	Snapshots []Snapshot `json:"snapshots"`
	GameOver  bool       `json:"gameOver"`
	DiedAt    int        `json:"diedAt"` // wave number the town fell on (0 = survived)
	Elapsed   string     `json:"elapsed"`
}

// Survived reports whether the town was still standing at the end of the run.
func (r Report) Survived() bool { return !r.GameOver }

// Last returns the final snapshot (zero value when nothing was simulated).
func (r Report) Last() Snapshot {
	if len(r.Snapshots) == 0 {
		return Snapshot{}
	}
	return r.Snapshots[len(r.Snapshots)-1]
}

// Run plays a full game headlessly and returns its report.
//
// The clock is virtual: we step minute by minute (the bot round cadence) and let
// game.AdvanceTo decide what is due — waves, bot rounds, automatic foraging — exactly
// as the production heartbeat does. Stepping rather than jumping straight to the end
// keeps the interleaving honest and lets us snapshot every single wave.
func Run(cfg Config) Report {
	_, rep := run(cfg.withDefaults())
	return rep
}

// run plays the game and hands back BOTH the report and the final state — the state is
// what an investigation needs (town journal, bank, hero positions) when a number in the
// report looks wrong.
func run(cfg Config) (*game.GameState, Report) {
	rand.Seed(cfg.Seed) // determinism: same seed ⇒ same run

	g := worldgen.NewLobby(cfg.Width, cfg.Height, cfg.Seed, "Simulation", 1, 8)
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

	host, err := g.AddPlayer("Bot 1", now)
	if err != nil {
		return g, Report{Config: cfg}
	}
	host.Bot = true // the host is simulated too — nobody is at the keyboard here
	for i := 1; i < cfg.Players; i++ {
		if _, err := g.AddBot(host.ID, now); err != nil {
			break // lobby full
		}
	}
	if err := g.StartGame(host.ID, now); err != nil {
		return g, Report{Config: cfg}
	}

	rep := Report{Config: cfg, TownName: g.Town.Name}
	started := time.Now()
	// Generous budget: nobody is waiting on this, and a truncated catch-up would
	// silently change the very balance we are measuring.
	budget := game.SimBudget{Waves: 4, BotRounds: 4096, Forages: 4096}
	seen := g.WaveNumber
	step := game.BotCatchUpInterval
	deadline := now.Add(time.Duration(cfg.Waves+2) * game.WaveInterval)

	for g.Status == game.StatusActive && len(rep.Snapshots) < cfg.Waves && now.Before(deadline) {
		now = now.Add(step)
		g.AdvanceTo(now, budget)
		for g.WaveNumber > seen {
			seen++
			rep.Snapshots = append(rep.Snapshots, snapshot(g))
			if g.Status != game.StatusActive {
				break
			}
		}
	}
	rep.GameOver = g.Status == game.StatusGameOver
	if rep.GameOver {
		rep.DiedAt = g.WaveNumber
	}
	rep.Elapsed = time.Since(started).Round(time.Millisecond).String()
	return g, rep
}

// snapshot reads the interesting numbers off a live game state.
func snapshot(g *game.GameState) Snapshot {
	s := Snapshot{Wave: g.WaveNumber, Day: g.Day, Defense: g.Town.Defense, TownHP: g.Town.HP}
	if w := g.LastWave; w != nil {
		s.HordePower, s.TownDamage = w.HordePower, w.TownDamage
		s.Defense = w.Defense // the defense that actually faced this horde
	}
	s.MonstersKilled = g.MonstersKilled

	for _, h := range g.Heroes {
		if h.HP <= 0 {
			continue
		}
		s.HeroesAlive++
		if h.X == g.Town.X && h.Y == g.Town.Y {
			s.HeroesInTown++
		}
		if h.HasState("Blessé") {
			s.HeroesWounded++
		}
		if h.HasState("Caché") {
			s.HeroesHidden++
		}
		if h.HasState("Tétanisé") {
			s.HeroesStuck++
		}
		if h.ClassTier >= 1 {
			s.HeroesEvolved++
		}
		for _, it := range h.Inventory {
			s.BagItems += it.Qty
		}
	}

	var parts []string
	dur, maxDur := 0, 0
	for _, b := range g.Town.Buildings {
		if b.Built {
			s.BuiltCount++
			s.LevelSum += b.Level
		}
		if b.UnderConstruction {
			s.Chantiers++
		}
		if b.ID == "gate" {
			s.GateOpen = b.Open
		}
		// Wear is about what actually stands: an unbuilt tower is not a worn tower.
		if b.Built && (b.ID == "wall" || b.ID == "gate" || b.ID == "tower") {
			dur += b.Durability
			maxDur += b.MaxDurability
		}
		parts = append(parts, fmt.Sprintf("%s%d", short(b.ID), b.Level))
	}
	sort.Strings(parts)
	s.Buildings = strings.Join(parts, " ")
	if maxDur > 0 {
		s.DefenseWear = 100 * dur / maxDur
	}

	for _, it := range g.Town.Storage {
		s.BankItems += it.Qty
		switch it.Name {
		case "Bois":
			s.BankWood += it.Qty
		case "Pierre":
			s.BankStone += it.Qty
		}
	}

	for _, m := range g.Monsters {
		s.MonsterPacks++
		s.MonsterUnits += m.Count
	}

	for i := range g.Tiles {
		t := &g.Tiles[i]
		if !t.Discovered {
			continue
		}
		s.Discovered++
		if t.Biome.Walkable() && t.Resources > 0 {
			s.ResourceTiles++
			s.ResourcesLeft += t.Resources
		}
	}
	return s
}

func short(id string) string {
	if len(id) <= 4 {
		return id
	}
	return id[:4]
}

// Table renders the per-wave curve as a fixed-width table (the CLI's main output).
func (r Report) Table() string {
	var b strings.Builder
	fmt.Fprintf(&b, "  %-5s %-2s %5s %5s %5s %4s | %4s %4s %4s %4s | %3s %3s %3s | %5s %5s %5s %4s | %4s %5s | %5s\n",
		"vague", "j", "horde", "déf", "dégât", "PV", "héro", "vill", "cach", "coin",
		"bât", "niv", "usé", "banq", "bois", "pier", "sacs", "pack", "unité", "resto")
	for _, s := range r.Snapshots {
		gate := " "
		if s.GateOpen {
			gate = "!" // an open gate is the single biggest defense leak — flag it
		}
		fmt.Fprintf(&b, "  %-5d %-2d %5d %4d%s %5d %4d | %4d %4d %4d %4d | %3d %3d %2d%% | %5d %5d %5d %4d | %4d %5d | %5d\n",
			s.Wave, s.Day, s.HordePower, s.Defense, gate, s.TownDamage, s.TownHP,
			s.HeroesAlive, s.HeroesInTown, s.HeroesHidden, s.HeroesStuck,
			s.BuiltCount, s.LevelSum, s.DefenseWear,
			s.BankItems, s.BankWood, s.BankStone, s.BagItems,
			s.MonsterPacks, s.MonsterUnits, s.ResourcesLeft)
	}
	return b.String()
}

// Verdict is the one-line summary of a run.
func (r Report) Verdict() string {
	last := r.Last()
	if r.GameOver {
		return fmt.Sprintf("☠️  %s TOMBÉE à la vague %d (défense %d vs horde %d, %d héros vivants)",
			r.TownName, r.DiedAt, last.Defense, last.HordePower, last.HeroesAlive)
	}
	return fmt.Sprintf("✅ %s tient %d vagues — PV %d/100, défense %d, %d bâtiments (niv. cumulés %d), %d héros vivants dont %d évolués, %d monstres tués",
		r.TownName, last.Wave, last.TownHP, last.Defense, last.BuiltCount, last.LevelSum,
		last.HeroesAlive, last.HeroesEvolved, last.MonstersKilled)
}
