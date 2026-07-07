package game

// Bot players. A bot is a Player with Bot=true whose 3-hero team is driven by the
// server: between waves the heroes draw water, drop loot in the Bank, help build and
// repair, go out gathering, and come home (or hide) before the horde hits — the same
// verbs a human uses, applied through the same validated actions.
//
// BotAct performs at most ONE action per bot hero per call, so behaviour spreads
// over the scheduler's ticks instead of a bot burning its whole day instantly.

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

	// A pack on my own tile (or pinning me) is the one thing worth a Fire ball.
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

	// Wounded, or the wave clock beats the walk home: retreat / conceal.
	lowHP := h.HP*100 < h.MaxHP*40
	if !inTown && (lowHP || h.PA <= distTown) {
		if h.PA == 1 && distTown > 1 && !h.HasState(StateCache) {
			return g.HideHero(h.ID) == nil // can't make it — vanish before the wave
		}
		return g.botStepToward(h, g.Town.X, g.Town.Y)
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
		// Fresh legs: go gather.
		if h.PA >= 3 {
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

// botBuild spends 1 PA on the most useful town work: finish/start a construction
// site (materials permitting), else repair a badly damaged building. Upgrades are
// left to humans (they'd silently drain the Bank).
func (g *GameState) botBuild(h *Hero) bool {
	for _, b := range g.Town.Buildings {
		if !b.Built {
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
