package game

import (
	"math/rand"
	"sort"
)

// Bot players. A bot is a Player with Bot=true whose 3-hero team is driven by the
// server: between waves the heroes draw water, drop loot in the Bank, help build and
// repair, go out gathering, and come home (or hide) before the horde hits — the same
// verbs a human uses, applied through the same validated actions.
//
// BotAct performs at most ONE action per bot hero per call, so behaviour spreads
// over time instead of a bot burning its whole day instantly. La CADENCE des rounds
// (une action par BotCatchUpInterval écoulé, rejouée depuis LastBotAt) appartient à
// l'horloge de simulation : voir sim.go / AdvanceTo.

// BotAct runs one action for every bot-owned hero able to act. Returns true if any
// state changed. No-op while a combat is open (map actions are blocked then).
func (g *GameState) BotAct() bool {
	if g.Status != StatusActive {
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
			// Un héros bot engagé dans un combat (humain) est joué par l'IA de
			// combat — il n'agit pas sur la carte en parallèle (combats concurrents).
			if g.heroInCombat(id) != nil {
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
			if c, err := g.StartCombat(h.ID, g.OwnerOfHero(h.ID)); err == nil {
				c.AutoResolve()
				if c.Status == "active" {
					// Pathological stall (AutoResolve guard hit): the bots retreat
					// rather than leaving an orphan ActiveCombat wedging the game.
					c.Status = "lost"
					c.logf("La mêlée s'enlise — les héros se replient.")
				}
				g.FinishCombat(c)
				return true
			}
		}
	}
	// Un pack sur/à côté du bot (ou Tétanisé) : il lance sa 1re compétence de
	// carte offensive abordable (remplace l'ancienne boule de feu universelle).
	{
		t := g.TileAt(h.X, h.Y)
		if (t != nil && t.MonsterID != "") || h.HasState(StateTetanise) {
			for _, sk := range MapSkillsForClass(h.ClassID) {
				if sk.Kind == "blast" && h.PA >= sk.PA {
					if _, err := g.CastMapSkill(h.ID, sk.ID); err == nil {
						return true
					}
				}
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

	// Wounded, or the wave clock beats the walk home: retreat / conceal. Each hero
	// has its own caution margin (heroBias) so the team doesn't all turn back on
	// exactly the same tick.
	_, _, caution := heroBias(h.ID)
	lowHP := h.HP*100 < h.MaxHP*40
	if !inTown && (lowHP || h.PA <= distTown+caution) {
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
		// Fresh legs: go gather (or explore the fog when the known map is picked
		// clean) — but a closed gate seals the town, so open it first (1 PA at the
		// gate, like a human would).
		if h.PA >= 3 {
			tx, ty, ok := g.pickResourceTile(h)
			if !ok && h.PA >= 4 {
				tx, ty, ok = g.pickFrontierTile(h)
			}
			if ok {
				if g.GateClosed() {
					if err := g.TownAction("gate", "toggle", 1, h.ID); err == nil {
						return true
					}
				}
				return g.botStepToward(h, tx, ty)
			}
		}
		return false
	}

	// In the field: harvest here, else walk to a good resource tile, else push the
	// fog back (each hero leaning toward its own sector).
	if t := g.TileAt(h.X, h.Y); t != nil && t.Resources > 0 {
		if _, err := g.SearchTile(h.ID); err == nil {
			return true
		}
	}
	if tx, ty, ok := g.pickResourceTile(h); ok {
		return g.botStepToward(h, tx, ty)
	}
	if tx, ty, ok := g.pickFrontierTile(h); ok && h.PA > distTown+1 {
		return g.botStepToward(h, tx, ty)
	}
	return g.botStepToward(h, g.Town.X, g.Town.Y) // nothing left out here — drift home
}

// botShouldEngage decides whether a bot hero opens a full (auto-resolved) combat on
// the pack sharing its tile: every living hero on the tile must be bot-owned (never
// drag a human into a fight the server plays for them), the party must at least
// match the pack's combat units (capped at 4 like NewCombat), the rough power
// estimate (HP + 3×force per fighter) must favour the heroes, and a BOSS is only
// challenged by a full three-hero team.
func (g *GameState) botShouldEngage(h *Hero, m *Monster) bool {
	units := m.Count
	if units < 1 {
		units = 1
	}
	if units > 4 {
		units = 4
	}
	var party []*Hero
	for _, hh := range g.Heroes {
		if hh.HP > 0 && hh.X == h.X && hh.Y == h.Y {
			if !g.botOwnsHero(hh.ID) {
				return false
			}
			party = append(party, hh)
		}
	}
	if len(party) < units {
		return false
	}
	if sp := SpeciesByName(m.Species); sp != nil && sp.Boss && len(party) < 3 {
		return false // a boss deserves respect — full team or Fire balls
	}
	partyPower := 0
	for _, hh := range party {
		partyPower += hh.HP + 3*hh.Stats.Force
	}
	packPower := units * (m.MaxHP + 3*m.Stats.Force)
	return partyPower >= packPower
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

// heroBias derives a stable per-hero "personality" from its id: a preferred compass
// direction for gathering/exploring, and a caution margin for the walk home. This is
// what keeps bot teammates from all marching single-file to the same tile — each
// hero leans toward its own sector of the map, like humans splitting up.
func heroBias(id string) (dirX, dirY, caution int) {
	hsh := 0
	for _, c := range id {
		hsh = hsh*31 + int(c)
	}
	if hsh < 0 {
		hsh = -hsh
	}
	dirs := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	d := dirs[hsh%4]
	return d[0], d[1], (hsh / 4) % 2
}

// pickResourceTile chooses where the bot hero goes gathering: discovered, walkable,
// monster-free tiles with resources left, scored by distance MINUS richness, plus a
// penalty outside the hero's preferred sector — then one of the top three is drawn
// at random. Tiles another living hero already stands on are skipped (spread out
// instead of queueing behind a teammate).
func (g *GameState) pickResourceTile(h *Hero) (int, int, bool) {
	dirX, dirY, _ := heroBias(h.ID)
	occupied := map[[2]int]bool{}
	for _, o := range g.Heroes {
		if o.HP > 0 && o.ID != h.ID {
			occupied[[2]int{o.X, o.Y}] = true
		}
	}
	type cand struct{ x, y, score int }
	var cands []cand
	for y := 0; y < g.Height; y++ {
		for x := 0; x < g.Width; x++ {
			t := g.TileAt(x, y)
			if t == nil || !t.Discovered || !t.Biome.Walkable() || t.Resources <= 0 || t.MonsterID != "" {
				continue
			}
			if (x == h.X && y == h.Y) || occupied[[2]int{x, y}] {
				continue
			}
			r := t.Resources
			if r > 5 {
				r = 5
			}
			score := 2*(absI(x-h.X)+absI(y-h.Y)) - r
			if (x-h.X)*dirX+(y-h.Y)*dirY < 0 {
				score += 6 // outside my sector — someone else will cover it
			}
			cands = append(cands, cand{x, y, score})
		}
	}
	if len(cands) == 0 {
		return 0, 0, false
	}
	sort.Slice(cands, func(i, j int) bool { return cands[i].score < cands[j].score })
	k := 3
	if len(cands) < k {
		k = len(cands)
	}
	c := cands[rand.Intn(k)]
	return c.x, c.y, true
}

// pickFrontierTile finds a discovered tile touching the fog (an exploration target)
// in the hero's preferred sector — when there is nothing left to gather, a human
// goes exploring, so the bots do too.
func (g *GameState) pickFrontierTile(h *Hero) (int, int, bool) {
	dirX, dirY, _ := heroBias(h.ID)
	bestX, bestY, bestScore := 0, 0, 1<<30
	for y := 0; y < g.Height; y++ {
		for x := 0; x < g.Width; x++ {
			t := g.TileAt(x, y)
			if t == nil || !t.Discovered || !t.Biome.Walkable() || t.MonsterID != "" {
				continue
			}
			touchesFog := false
			for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
				if n := g.TileAt(x+d[0], y+d[1]); n != nil && !n.Discovered {
					touchesFog = true
					break
				}
			}
			if !touchesFog || (x == h.X && y == h.Y) {
				continue
			}
			score := 2 * (absI(x-h.X) + absI(y-h.Y))
			if (x-h.X)*dirX+(y-h.Y)*dirY < 0 {
				score += 8
			}
			if score < bestScore {
				bestX, bestY, bestScore = x, y, score
			}
		}
	}
	return bestX, bestY, bestScore < 1<<30
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
