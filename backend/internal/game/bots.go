package game

import "time"

// Bot players. A bot is a Player with Bot=true whose 3-hero team is driven by the
// server: between waves the heroes draw water, drop loot in the Bank, help build and
// repair, go out gathering, and come home (or hide) before the horde hits — the same
// verbs a human uses, applied through the same validated actions.
//
// BotAct performs at most ONE action per bot hero per call, so behaviour spreads
// over the scheduler's ticks instead of a bot burning its whole day instantly.

// BotCatchUpInterval paces bot heroes when the server has no background scheduler
// (serverless deployments): one BotAct round per elapsed interval, replayed lazily
// on the next request that touches the game.
const BotCatchUpInterval = time.Minute

// botCatchUpMaxRounds bounds a lazy catch-up so a game left idle for hours doesn't
// replay hundreds of bot rounds on the next request — bots are PA-bound anyway, a
// few rounds spend everything they have until the next wave regen.
const botCatchUpMaxRounds = 6

// BotCatchUp is the lazy (serverless) counterpart of the wave scheduler's BotAct
// pacing. Returns true when the state changed and must be persisted.
func (g *GameState) BotCatchUp(now time.Time) bool {
	if g.Status != StatusActive {
		return false
	}
	hasBots := false
	for _, p := range g.Players {
		if p.Bot {
			hasBots = true
			break
		}
	}
	if !hasBots {
		return false
	}
	if g.LastBotAt.IsZero() {
		// Persist the baseline so the next request measures a real elapsed time.
		g.LastBotAt = now
		return true
	}
	rounds := int(now.Sub(g.LastBotAt) / BotCatchUpInterval)
	if rounds <= 0 {
		return false
	}
	if rounds > botCatchUpMaxRounds {
		rounds = botCatchUpMaxRounds
	}
	g.LastBotAt = now
	changed := false
	for i := 0; i < rounds; i++ {
		if !g.BotAct() {
			break
		}
		changed = true
	}
	return changed
}

// BotAct runs one action for every bot-owned hero able to act. Returns true if any
// state changed. No-op while a combat is open (map actions are blocked then).
func (g *GameState) BotAct() bool {
	if g.Status != StatusActive || g.ActiveCombat != "" {
		return false
	}
	changed := false
	for _, p := range g.Players {
		if !p.Bot {
			continue
		}
		for _, id := range p.HeroIDs {
			h := g.HeroByID(id)
			if h == nil || h.HP <= 0 || h.PA <= 0 {
				continue
			}
			if g.botHeroAct(h) {
				changed = true
			}
		}
	}
	if changed {
		g.Recompute()
	}
	return changed
}

// botHeroAct picks and performs one action for a bot hero. Priorities: survive
// (burn the pack pinning me, run home when weak or out of time, hide as a last
// resort), then contribute (water, deposit, build/repair), then gather.
func (g *GameState) botHeroAct(h *Hero) bool {
	inTown := h.X == g.Town.X && h.Y == g.Town.Y
	distTown := absI(g.Town.X-h.X) + absI(g.Town.Y-h.Y)

	// A pack on my own tile: fight it out when the bot party can match it (full iso
	// combat, auto-resolved), otherwise thin it with a Fire ball.
	if t := g.TileAt(h.X, h.Y); t != nil && t.MonsterID != "" {
		if m := g.Monsters[t.MonsterID]; m != nil && g.botShouldEngage(h, m) {
			if c, err := g.StartCombat(h.ID); err == nil {
				c.AutoResolve()
				g.FinishCombat(c)
				return true
			}
		}
	}
	if h.PA >= FireballPACost {
		t := g.TileAt(h.X, h.Y)
		if (t != nil && t.MonsterID != "") || h.HasState(StateTetanise) {
			if _, err := g.FireballHero(h.ID); err == nil {
				return true
			}
		}
	}
	if h.HasState(StateTetanise) {
		return false // pinned and unable to burn free — wait for help
	}

	// Seize a class evolution the moment its day gate opens (free, like a human would).
	if g.botEvolve(h) {
		return true
	}

	// Wounded, or the wave clock beats the walk home: retreat / conceal.
	lowHP := h.HP*100 < h.MaxHP*40
	if !inTown && (lowHP || h.PA <= distTown) {
		if h.PA == 1 && distTown > 1 && !h.HasState(StateCache) {
			return g.HideHero(h.ID) == nil // can't make it — vanish before the wave
		}
		if g.botStepToward(h, g.Town.X, g.Town.Y) {
			return true
		}
		// Locked out (closed gate) or path blocked — vanish before the wave instead.
		if !h.HasState(StateCache) {
			return g.HideHero(h.ID) == nil
		}
		return false
	}

	if inTown {
		// Daily ration while home (also clears Soif).
		if h.HasState(StateSoif) && h.DrewWaterDay != g.Day {
			if err := g.TownAction("well", "water", 1, h.ID); err == nil {
				return true
			}
		}
		// Empty the bag into the Bank (free, feeds constructions).
		if len(h.Inventory) > 0 {
			if moved, err := g.DepositHeroLoot([]string{h.ID}); err == nil && moved > 0 {
				return true
			}
		}
		// Help the town before heading back out.
		if g.botBuild(h) {
			return true
		}
		// Fresh legs: go gather — but a closed gate seals the town, so open it first
		// (1 PA at the gate, like a human would).
		if h.PA >= 3 {
			if _, _, ok := g.nearestResourceTile(h); ok && g.GateClosed() {
				if err := g.TownAction("gate", "toggle", 1, h.ID); err == nil {
					return true
				}
			}
			if tx, ty, ok := g.nearestResourceTile(h); ok {
				return g.botStepToward(h, tx, ty)
			}
		}
		return false
	}

	// In the field: harvest here, else walk to the closest known resource.
	if t := g.TileAt(h.X, h.Y); t != nil && t.Resources > 0 {
		if _, err := g.SearchTile(h.ID); err == nil {
			return true
		}
	}
	if tx, ty, ok := g.nearestResourceTile(h); ok {
		return g.botStepToward(h, tx, ty)
	}
	return g.botStepToward(h, g.Town.X, g.Town.Y) // nothing left out here — drift home
}

// botShouldEngage decides whether a bot hero opens a full (auto-resolved) combat on
// the pack sharing its tile: every living hero on the tile must be bot-owned (never
// drag a human into a fight the server plays for them), and the party must at least
// match the pack's combat units (capped at 4 like NewCombat).
func (g *GameState) botShouldEngage(h *Hero, m *Monster) bool {
	units := m.Count
	if units < 1 {
		units = 1
	}
	if units > 4 {
		units = 4
	}
	party := 0
	for _, hh := range g.Heroes {
		if hh.HP > 0 && hh.X == h.X && hh.Y == h.Y {
			if !g.botOwnsHero(hh.ID) {
				return false
			}
			party++
		}
	}
	return party >= units
}

// botOwnsHero reports whether the hero belongs to a bot player.
func (g *GameState) botOwnsHero(heroID string) bool {
	for _, p := range g.Players {
		if p.Bot && p.OwnsHero(heroID) {
			return true
		}
	}
	return false
}

// botEvolve picks a class fitting the hero's stats once the day gate opens (the
// EvolveHero validation owns the gates, so trying early is a harmless no-op).
func (g *GameState) botEvolve(h *Hero) bool {
	var pick string
	switch h.ClassTier {
	case 0:
		switch {
		case h.Stats.Precision >= h.Stats.Agilite && h.Stats.Precision >= h.Stats.Force:
			pick = "chasseur"
		case h.Stats.Agilite > h.Stats.Force:
			pick = "eclaireur"
		default:
			pick = "pionnier"
		}
	case 1:
		// Advanced classes have tech-tree prerequisites — follow the hero's branch.
		switch h.ClassID {
		case "pionnier":
			pick = "gardien"
		case "chasseur":
			pick = "recuperateur"
		case "eclaireur":
			if h.Stats.Athletisme >= h.Stats.Agilite {
				pick = "herboriste"
			} else {
				pick = "recuperateur"
			}
		default:
			return false
		}
	default:
		return false
	}
	return g.EvolveHero(h.ID, pick) == nil
}

// botBuild spends 1 PA on the most useful town work: lay the plan / invest in a
// construction site (materials permitting), join an upgrade chantier a human opened,
// else repair a badly damaged building. Bots never OPEN upgrade plans themselves
// (they'd silently drain the Bank).
func (g *GameState) botBuild(h *Hero) bool {
	for _, b := range g.Town.Buildings {
		if !b.Built || b.UnderConstruction {
			if err := g.TownAction(b.ID, "build", 1, h.ID); err == nil {
				return true
			}
		}
	}
	for _, b := range g.Town.Buildings {
		if b.Built && b.Durability*2 < b.MaxDurability {
			if err := g.TownAction(b.ID, "restore", 1, h.ID); err == nil {
				return true
			}
		}
	}
	return false
}

// nearestResourceTile finds the closest discovered, walkable, monster-free tile with
// resources left (the same information a human reads off the map).
func (g *GameState) nearestResourceTile(h *Hero) (int, int, bool) {
	bestX, bestY, bestD := 0, 0, 1<<30
	for y := 0; y < g.Height; y++ {
		for x := 0; x < g.Width; x++ {
			t := g.TileAt(x, y)
			if t == nil || !t.Discovered || !t.Biome.Walkable() || t.Resources <= 0 || t.MonsterID != "" {
				continue
			}
			if x == h.X && y == h.Y {
				continue
			}
			d := absI(x-h.X) + absI(y-h.Y)
			if d < bestD {
				bestX, bestY, bestD = x, y, d
			}
		}
	}
	return bestX, bestY, bestD < 1<<30
}

// botStepToward moves one orthogonal step toward (tx,ty): all four directions are
// ranked by the resulting distance to the target (stable order, so no oscillation on
// ties), and monster tiles are never entered unless they ARE the destination. Ranking
// every direction lets the bot detour around a pack sitting on the straight line.
func (g *GameState) botStepToward(h *Hero, tx, ty int) bool {
	if h.X == tx && h.Y == ty {
		return false
	}
	dirs := [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	// Stable insertion sort by resulting Manhattan distance.
	dist := func(c [2]int) int { return absI(tx-(h.X+c[0])) + absI(ty-(h.Y+c[1])) }
	for i := 1; i < len(dirs); i++ {
		for j := i; j > 0 && dist(dirs[j]) < dist(dirs[j-1]); j-- {
			dirs[j], dirs[j-1] = dirs[j-1], dirs[j]
		}
	}
	for _, c := range dirs {
		nx, ny := h.X+c[0], h.Y+c[1]
		nt := g.TileAt(nx, ny)
		if nt == nil || !nt.Biome.Walkable() {
			continue
		}
		if nt.MonsterID != "" && !(nx == tx && ny == ty) {
			continue
		}
		if err := g.MoveHero(h.ID, c[0], c[1]); err == nil {
			return true
		}
	}
	return false
}
