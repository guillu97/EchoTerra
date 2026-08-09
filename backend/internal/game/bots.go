package game

import (
	"math/rand"
	"sort"
	"time"
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

// COUVRE-FEU : la fin de l'intervalle de vague se joue en deux temps.
//
//	curfewSoft  — dernière moitié : on ne repart plus récolter, on rentre, et la porte
//	              se ferme dès que plus personne d'exposé n'est en chemin ;
//	curfewBolt  — dernier sixième : on VERROUILLE, point. Attendre le dernier traînard
//	              revient à laisser la porte ouverte pour toujours (mesuré : avec douze
//	              héros il y a toujours quelqu'un dehors à portée de marche), et une
//	              porte ouverte ne défend rien. Les retardataires se cachent.
const (
	curfewNone = iota
	curfewSoft
	curfewBolt
)

// curfewPhase says how close the horde is, in bot terms.
func (g *GameState) curfewPhase(now time.Time) int {
	if g.NextWaveAt.IsZero() || WaveInterval <= 0 {
		return curfewNone
	}
	left := g.NextWaveAt.Sub(now)
	switch {
	case left <= WaveInterval/6:
		return curfewBolt
	case left <= WaveInterval/2:
		return curfewSoft
	}
	return curfewNone
}

// BotAct runs one action for every bot-owned hero able to act. Returns true if any
// state changed. No-op while a combat is open (map actions are blocked then).
// `now` is the simulated instant of this round (see sim.go): the bots read the wave
// clock off it to know when the curfew starts.
func (g *GameState) BotAct(now time.Time) bool {
	if g.Status != StatusActive {
		return false
	}
	changed := false
	curfew := g.curfewPhase(now)
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
			if g.botHeroAct(h, curfew) {
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
// During the CURFEW (the horde is nearly here) nobody leaves and the town shuts.
func (g *GameState) botHeroAct(h *Hero, curfew int) bool {
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
	// Pinned and unable to burn the pack free: BREAK OUT. A Tétanisé hero may neither
	// move, search nor hide — so standing still is not "waiting for help", it is waiting
	// to die: the wave hits it for 3 + waveNumber, +4 again because the pack shares its
	// tile. Escape (1 PA, one step toward town, 25% chance of stumbling) is the one door
	// the rules leave open, and the bots never used it. Measured before: the entire
	// gathering half of the expedition was dead by wave 7, bags full, Bank empty.
	if h.HasState(StateTetanise) {
		return g.EscapeHero(h.ID) == nil
	}

	// Seize a class evolution the moment its day gate opens (free, like a human would).
	if g.botEvolve(h) {
		return true
	}

	// Out in the field, the choice is: haul the load home, or CAMP.
	//
	// Camping is what the game is built for — a search arms the automatic foraging
	// (forage.go), which keeps harvesting the tile for free as long as the hero doesn't
	// move, and hiding costs one PA and skips the wave's attack entirely. So a gatherer
	// posted on a forest or a mountain out of walking range brings back far more than
	// one that spends its six PA a wave commuting. Before this, bots turned back the
	// moment PA ran low and only ever reached the plain around town: measured, the Bank
	// filled with flowers and mushrooms and held ZERO wood and ZERO stone — so no
	// chantier, no upgrade and no repair was ever possible.
	lowHP := h.HP*100 < h.MaxHP*40
	if !inTown {
		hidden := h.HasState(StateCache)
		// THE LAST POINT OUTSIDE IS THE CONCEALMENT POINT — it is never spent on
		// anything else. Hiding skips the wave's attack entirely, and a hero caught in
		// the open takes 3 + waveNumber (+4 more if a pack shares its tile), which is
		// most of a starting hero's health by wave 8. Measured without this reserve:
		// every gatherer was dead by wave 9, carrying a hundred items that never
		// reached the Bank.
		if !hidden && h.PA <= 1 {
			if curfew > curfewNone {
				return g.HideHero(h.ID) == nil
			}
			return false // hold the point back
		}
		// Walk home only for a REASON — a full load or a wound — never merely because
		// the action points ran out. Running out of PA far from town is the normal state
		// of a posted gatherer, and that is fine: the tile keeps foraging itself
		// (forage.go) as long as the hero stays put.
		if lowHP || heroLoad(h) >= botHaulSize {
			if curfew > curfewNone && h.PA < distTown && !hidden {
				return g.HideHero(h.ID) == nil // can't make it — vanish for this wave
			}
			if g.botStepToward(h, g.Town.X, g.Town.Y) {
				return true
			}
			// The way home is walled off by packs (the horde converges on the town, so
			// this is the NORMAL late-game situation): blow a hole in it rather than
			// standing there. Measured before: loaded gatherers froze in place for the
			// rest of the game, a hundred items each, and the Bank never saw them.
			if g.botBlastBlocker(h) {
				return true
			}
			// Locked out (closed gate) or nothing left to try — vanish instead.
			if !hidden {
				return g.HideHero(h.ID) == nil
			}
			return false
		}
		// Camped on a tile worth having: forage until the last moment, THEN dig in.
		// Hiding stops the automatic foraging, so it waits for the bolt window rather
		// than starting at the first sign of the curfew.
		if curfew == curfewBolt && !hidden {
			return g.HideHero(h.ID) == nil
		}
		if curfew > curfewNone {
			return false
		}
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
		// THE GATE HAS A RHYTHM: open by day, bolted at dusk.
		//
		// Treating it as "open it when I personally want to leave" produced both failure
		// modes in turn — a town sealed from day 1 that nobody could leave, and a town
		// that faced every wave wide open because the last hero home had no point left
		// to turn the key. A gate is a collective decision, so it gets a collective
		// policy, and a builder stays home to carry it out.
		if g.botGateWork(h, curfew) {
			return true
		}
		// ROLE SPLIT. Only a BUILDER reaches for the town's work list first. Letting
		// every hero try to build before considering leaving looked harmless and was
		// fatal: there is always a wall to patch after a wave, so botBuild answered
		// "yes" for everyone, every round — nobody ever reached the code that reopens
		// the gate, the town stayed bolted shut from day 1, and the whole expedition sat
		// inside repairing the same wall while the Bank held no stone and no chantier
		// could advance. Measured: twelve heroes still within three tiles of the town at
		// wave 8, with a discovered mountain four tiles away.
		builder := g.heroIsBuilder(h.ID)
		if builder {
			// A BUILDER DOES NOT LEAVE. It is the town's standing crew: the chantiers,
			// the repairs and the gate all need someone who is reliably home. Letting
			// builders wander off "when the town has nothing to do" emptied the town
			// completely in the early waves — measured: zero heroes inside for four waves
			// running, so nobody closed the gate and the horde walked in against a
			// defense of 9.
			return g.botBuild(h)
		}
		if curfew > curfewNone {
			return g.botBuild(h) // stuck at home anyway — lend a hand
		}
		// Fresh legs: go gather, or push the fog back when nothing known supplies what
		// the town is waiting for.
		if h.PA >= 3 {
			if tx, ty, ok := g.botGatherTarget(h); ok && g.botStepToward(h, tx, ty) {
				return true
			}
		}
		return g.botBuild(h) // nowhere worth going — help the town instead
	}

	// In the field: harvest here, else walk to a good resource tile, else push the
	// fog back (each hero leaning toward its own sector).
	//
	// (The concealment reserve is enforced above, before any of this can run.)
	if t := g.TileAt(h.X, h.Y); t != nil && t.Resources > 0 {
		if _, err := g.SearchTile(h.ID); err == nil {
			return true
		}
	}
	if tx, ty, ok := g.botGatherTarget(h); ok {
		if g.botStepToward(h, tx, ty) {
			return true
		}
		if g.botBlastBlocker(h) {
			return true
		}
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

// gateOpenAndBuilt reports whether the town has a standing but open gate.
func (g *GameState) gateOpenAndBuilt() bool {
	b := g.buildingByID("gate")
	return b != nil && b.Built && b.Open
}

// botGateWork applies the town's gate policy for one in-town hero, at a cost of 1 PA
// per turn of the key: OPEN while the horde is far (gatherers must be able to leave
// AND to come back with their load — a bolted gate locks them out, and a hero locked
// out hides in the field forever with the Bank's materials in its bag), BOLTED as the
// wave approaches. In the soft window it still waits for the exposed stragglers; in the
// last sixth it shuts regardless, because a gate that waits for everyone never shuts.
func (g *GameState) botGateWork(h *Hero, curfew int) bool {
	b := g.buildingByID("gate")
	if b == nil || !b.Built {
		return false
	}
	switch {
	case curfew == curfewNone && !b.Open:
		return g.TownAction("gate", "toggle", 1, h.ID) == nil
	case curfew > curfewNone && b.Open && (curfew == curfewBolt || !g.heroesStillWalkingHome()):
		return g.TownAction("gate", "toggle", 1, h.ID) == nil
	}
	return false
}

// heroesStillWalkingHome reports whether a living hero is out in the field, exposed
// (not hidden) and could still reach town — the reason not to bolt the gate yet.
func (g *GameState) heroesStillWalkingHome() bool {
	for _, h := range g.Heroes {
		if h.HP <= 0 || h.HasState(StateCache) {
			continue
		}
		if h.X == g.Town.X && h.Y == g.Town.Y {
			continue
		}
		if absI(g.Town.X-h.X)+absI(g.Town.Y-h.Y) <= h.PA {
			return true
		}
	}
	return false
}

// botHaulSize is how much a gatherer carries before walking the load back to the Bank.
// Loot is worthless out in the field — it only becomes a wall once it reaches the town.
const botHaulSize = 14

// heroLoad counts the ITEMS a hero carries, not the stacks. Inventory entries carry a
// Qty, so len(Inventory) is the number of distinct kinds — measured with len(), bots
// camped forever with two hundred items in their bags and a starving Bank.
func heroLoad(h *Hero) int {
	n := 0
	for _, it := range h.Inventory {
		n += it.Qty
	}
	return n
}

// botShoppingList is what the town is SHORT of right now: the stone its walls are
// repaired with, plus every material missing for the next level of every building.
// This is what turns bots from "harvest the nearest tile" into "go get what we need" —
// the plain around town yields flowers, and flowers build nothing.
func (g *GameState) botShoppingList() map[string]bool {
	need := map[string]bool{}
	add := func(name string) {
		// Only RAW materials belong on a gathering list. The upper building levels ask
		// for crafted goods (Planche, Corde, Brique, Acier, Cœur de chêne ancien) that no
		// terrain ever drops — leaving them in would make "we don't know where to find
		// what we need" permanently true and send the whole expedition exploring forever.
		if terrainDroppable(name) {
			need[name] = true
		}
	}
	if g.Town.HP < g.Town.MaxHP {
		add(TownRepairMaterial)
	}
	for _, b := range g.Town.Buildings {
		if b.Built && b.Level >= MaxBuildingLevel {
			continue
		}
		for _, m := range g.buildingCost(b).Materials {
			if g.storageQty(m.Name) < m.Qty {
				add(m.Name)
			}
		}
	}
	return need
}

// terrainDroppable reports whether ANY terrain can drop this item.
func terrainDroppable(name string) bool {
	for _, td := range Terrains {
		for _, d := range td.Drops {
			if d.Name == name {
				return true
			}
		}
	}
	return false
}

// biomeSupplies reports whether searching this biome can drop one of the wanted items.
func biomeSupplies(b Biome, want map[string]bool) bool {
	for _, d := range Terrains[b].Drops {
		if want[d.Name] {
			return true
		}
	}
	return false
}

// botCriticalList narrows the shopping list to what the town has NONE of. "We need
// wood and we need stone" is not a plan when the forest is next door and the mountain
// is five tiles further: scored on distance alone the expedition harvests wood forever.
// Measured with a flat bonus: 21 wood in the Bank and 0 stone at wave 12, so the wall
// stayed at level 1 with a fully-stocked woodpile beside it.
func (g *GameState) botCriticalList(want map[string]bool) map[string]bool {
	crit := map[string]bool{}
	for name := range want {
		if g.storageQty(name) == 0 {
			crit[name] = true
		}
	}
	return crit
}

// botSupplyKnown reports whether some DISCOVERED tile can still drop what the town is
// waiting for. When it can't — the classic case being "we need stone and the mountains
// are all under the fog" — gathering the nearest plain is busywork, and the right move
// is to go and find the biome that has it. Measured before this: the Bank filled with
// flowers while stone stayed at zero for twenty-five waves, so no wall was ever
// upgraded and the town could never repair itself.
func (g *GameState) botSupplyKnown(want map[string]bool) bool {
	if len(want) == 0 {
		return true // nothing needed — the nearest tile is as good as any
	}
	// PER MATERIAL, not "any of them". Asking only whether SOME wanted thing is
	// reachable let the forest next door answer for the mountains: wood was known, so
	// the expedition never went looking for stone, and the Bank held zero Pierre for
	// twenty-five waves while the walls could not be raised or the town repaired.
	sourced := map[string]bool{}
	for i := range g.Tiles {
		t := &g.Tiles[i]
		if !t.Discovered || !t.Biome.Walkable() || t.Resources <= 0 {
			continue
		}
		for _, d := range Terrains[t.Biome].Drops {
			if want[d.Name] {
				sourced[d.Name] = true
			}
		}
	}
	for name := range want {
		if !sourced[name] {
			return false // this one has no known source — go and find it
		}
	}
	return true
}

// botGatherTarget picks where a gatherer goes: a known tile that supplies the town, or
// — when nothing known does — the edge of the fog, to go and find one.
func (g *GameState) botGatherTarget(h *Hero) (int, int, bool) {
	if g.botSupplyKnown(g.botShoppingList()) {
		if x, y, ok := g.pickResourceTile(h); ok {
			return x, y, ok
		}
	}
	if x, y, ok := g.pickFrontierTile(h); ok {
		return x, y, ok
	}
	return g.pickResourceTile(h)
}

// botBlastBlocker throws the hero's class blast at a pack that is in the way (its own
// tile or an adjacent one). This is the bots' only way through a horde that has
// converged on the town — and their only contribution to thinning it. Returns false
// when the hero has no affordable blast, keeping the concealment point in reserve.
func (g *GameState) botBlastBlocker(h *Hero) bool {
	for _, sk := range MapSkillsForClass(h.ClassID) {
		if sk.Kind == "blast" && h.PA >= sk.PA+1 {
			if _, err := g.CastMapSkill(h.ID, sk.ID); err == nil {
				return true
			}
		}
	}
	return false
}

// botTileWorthCamping reports whether the hero's current tile is worth digging in on:
// it still holds resources and it drops something the town is waiting for.
func (g *GameState) botTileWorthCamping(h *Hero) bool {
	t := g.TileAt(h.X, h.Y)
	if t == nil || !t.Biome.Walkable() {
		return false
	}
	return biomeSupplies(t.Biome, g.botShoppingList())
}

// botDefensiveOrder is the order bots pour labour into the town's protection. The
// wall carries the most defense per level, the gate is the cheapest big win once it
// is actually closed, and the tower is the growth room afterwards.
var botDefensiveOrder = []string{"wall", "gate", "tower"}

// botBuild spends 1 PA on the most useful town work, in the order a player who wants
// to survive would pick:
//
//  1. finish whatever chantier is already open (sunk labour first);
//  2. patch the DEFENSE back up — a worn wall defends in proportion to its durability,
//     so repairs are the cheapest defense there is (5 durability per PA, no materials);
//  3. rebuild the town's own HP at the wall, spending stone (the long-game sink);
//  4. lay a plan for a site whose blueprint has been found;
//  5. OPEN an upgrade chantier on a defensive building — but only when the Bank already
//     holds every material, so the town never stalls half-built on a promise;
//  6. patch up the rest of the buildings.
//
// Step 5 is the change that lets a town outgrow the horde at all: bots used to refuse
// to open upgrades entirely, so defense was frozen at its level-1 value forever while
// the horde grew +6 every wave.
func (g *GameState) botBuild(h *Hero) bool {
	// Keep one point in hand while the gate stands open: bolting it is worth more
	// defense than any single repair, and a hero that spent everything can't turn the
	// key. Measured before this guard: builders burned their six PA on repairs by
	// mid-wave, so the curfew close silently failed and the gate faced most waves open.
	if g.gateOpenAndBuilt() && h.PA <= 1 {
		return false
	}
	// 1. Sunk labour first — an open chantier is a commitment.
	for _, b := range g.Town.Buildings {
		if b.UnderConstruction {
			if err := g.TownAction(b.ID, "build", 1, h.ID); err == nil {
				return true
			}
		}
	}
	// 2. Defense repairs: the ratio is what the horde meets, so a wall at 70% is 30%
	// of its defense thrown away for want of 6 PA.
	for _, id := range botDefensiveOrder {
		b := g.buildingByID(id)
		if b != nil && b.Built && b.Durability*10 < b.MaxDurability*9 {
			if err := g.TownAction(b.ID, "restore", 1, h.ID); err == nil {
				return true
			}
		}
	}
	// 3. Grow the defense — BEFORE spending the same stone on patching hit points.
	// A wall level is worth +5 defense on every wave that ever follows; five hit points
	// are worth one wave. Measured with the order reversed: every single stone that
	// reached the Bank was burned on repairs within the round, the wall never left
	// level 1, and the town died at wave 12 to a horde its maxed walls would have held.
	for _, id := range botDefensiveOrder {
		b := g.buildingByID(id)
		if b == nil || !b.Built || b.Level >= MaxBuildingLevel {
			continue
		}
		if !g.bankCovers(g.buildingCost(b).Materials) {
			continue
		}
		if err := g.TownAction(b.ID, "build", 1, h.ID); err == nil {
			return true
		}
	}
	// 4. Sites whose blueprint we found — but only when the Bank can actually FEED the
	// chantier. Opening one on a promise burns the (lootable, scarce) plan and parks a
	// site that refuses every point of labour until the missing material shows up: measured,
	// a townhall chantier opened on day 1 with no stone in the Bank stayed frozen for
	// the rest of the game.
	for _, b := range g.Town.Buildings {
		if b.Built {
			continue
		}
		// …and not with stone the walls are saving for. A recyclerie costs 2 Pierre; so
		// does the difference between a level-1 and a level-2 wall being reachable this
		// week. The defense comes first.
		if !g.bankCoversBeyondDefense(g.buildingCost(b).Materials) {
			continue
		}
		if err := g.TownAction(b.ID, "build", 1, h.ID); err == nil {
			return true
		}
	}
	// 4b. Make what cannot be gathered. Every level-2/3 building in the design wants a
	// crafted good, so a town that never visits its own workshop stops dead at its
	// starting defense — and recycling débris is the design's answer to a map run dry.
	if g.botCraft(h) {
		return true
	}
	// 5. The town's own wounds, paid in the SURPLUS stone only. Nothing else in the
	// game heals Town.HP, so a town that never repairs is on a one-way slide — but
	// stone earmarked for the next wall level is not surplus. A town actually bleeding
	// out (below townRepairUrgentPct) stops saving and patches itself regardless.
	if g.Town.HP < g.Town.MaxHP {
		urgent := g.Town.HP*100 < g.Town.MaxHP*townRepairUrgentPct
		if urgent || g.storageQty(TownRepairMaterial) > g.reservedForDefense(TownRepairMaterial) {
			if err := g.TownAction("wall", "repair", 1, h.ID); err == nil {
				return true
			}
		}
	}
	// 6. Everything else, once it is properly broken.
	for _, b := range g.Town.Buildings {
		if b.Built && b.Durability*2 < b.MaxDurability {
			if err := g.TownAction(b.ID, "restore", 1, h.ID); err == nil {
				return true
			}
		}
	}
	return false
}

// townRepairUrgentPct: below this share of its hit points the town stops saving
// materials for tomorrow's wall and patches itself today.
const townRepairUrgentPct = 50

// reservedForDefense is how much of a material is spoken for by the next level of the
// defensive buildings that are not yet at max. Spending it on anything else means the
// upgrade never happens — the Bank hovers just under the requirement forever.
func (g *GameState) reservedForDefense(name string) int {
	n := 0
	for _, id := range botDefensiveOrder {
		b := g.buildingByID(id)
		if b == nil || !b.Built || b.Level >= MaxBuildingLevel {
			continue
		}
		for _, m := range g.buildingCost(b).Materials {
			if m.Name == name {
				n += m.Qty
			}
		}
	}
	return n
}

// recipeFor returns the town recipe whose OUTPUT is this item name, or nil.
func recipeFor(name string) *Recipe {
	for i := range Recipes {
		r := &Recipes[i]
		out := r.OutputName
		if out == "" {
			out = r.Name
		}
		if out == name {
			return r
		}
	}
	return nil
}

// botCraft turns raw materials into the CRAFTED ones the town's upgrades ask for
// (Planche, Corde, Brique, Acier) and recycles Débris back into Bois and Pierre.
//
// Without this the town hits a hard ceiling and stops: every level-2 and level-3
// building in the design wants a crafted good, so a town that never crafts is stuck at
// its starting defense forever however much stone it piles up. Measured before: defense
// plateaued around 24 while 48 was reachable. Recycling matters for a different reason
// — it is the design's answer to a map running dry, which is exactly what a long game
// is supposed to run into.
func (g *GameState) botCraft(h *Hero) bool {
	// 1. What is missing for the next level of something, and can only be made?
	for _, b := range g.orderedForCraft() {
		if b.Built && b.Level >= MaxBuildingLevel {
			continue
		}
		for _, m := range g.buildingCost(b).Materials {
			if g.storageQty(m.Name) >= m.Qty || terrainDroppable(m.Name) {
				continue // already have it, or it is gathered rather than made
			}
			r := recipeFor(m.Name)
			if r == nil || !g.bankCovers(r.Ingredients) {
				continue
			}
			if _, err := g.Craft(r.ID, h.ID); err == nil {
				return true
			}
		}
	}
	// 2. Recycle the junk from picked-clean tiles back into the two materials that
	// actually build things — stone first, it is the one the walls eat.
	for _, name := range []string{"Pierre", "Bois"} {
		r := recipeFor(name)
		if r == nil || !g.bankCovers(r.Ingredients) {
			continue
		}
		if _, err := g.Craft(r.ID, h.ID); err == nil {
			return true
		}
	}
	return false
}

// orderedForCraft lists the buildings worth crafting for, defense first.
func (g *GameState) orderedForCraft() []*TownBuilding {
	var out []*TownBuilding
	for _, id := range botDefensiveOrder {
		if b := g.buildingByID(id); b != nil {
			out = append(out, b)
		}
	}
	for _, b := range g.Town.Buildings {
		if !isDefensive(b.ID) {
			out = append(out, b)
		}
	}
	return out
}

// bankCovers reports whether the Bank currently holds every listed material.
func (g *GameState) bankCovers(mats []Item) bool {
	for _, m := range mats {
		if g.storageQty(m.Name) < m.Qty {
			return false
		}
	}
	return true
}

// bankCoversBeyondDefense is bankCovers for spending that must NOT eat into what the
// next defensive upgrade needs.
func (g *GameState) bankCoversBeyondDefense(mats []Item) bool {
	for _, m := range mats {
		if g.storageQty(m.Name) < m.Qty+g.reservedForDefense(m.Name) {
			return false
		}
	}
	return true
}

// heroBias derives a stable per-hero "personality" from its id: a preferred compass
// direction for gathering/exploring, and a caution margin for the walk home. This is
// what keeps bot teammates from all marching single-file to the same tile — each
// hero leans toward its own sector of the map, like humans splitting up.
func heroBias(id string) (dirX, dirY, caution int) {
	hsh := heroHash(id)
	dirs := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	d := dirs[hsh%4]
	return d[0], d[1], (hsh / 4) % 2
}

// heroHash is the stable per-hero seed behind every "personality" derived from an id.
func heroHash(id string) int {
	h := 0
	for _, c := range id {
		h = h*31 + int(c)
	}
	if h < 0 {
		h = -h
	}
	return h
}

// heroIsBuilder splits a bot team into roles the way a real expedition does: the FIRST
// hero of each team stays home as a BUILDER (chantiers, repairs, crafting, the gate)
// while the other two range out for materials.
//
// The role comes from the hero's rank in its own team, not from a hash of its id: a
// hash gives "roughly one in three" over many heroes but says nothing about any single
// team, and a lone bot player whose three heroes all hashed to gatherers had NOBODY to
// work the gate, hold a chantier or visit the workshop — the town simply never built
// anything. Per-team ranking guarantees exactly one builder per three heroes, which is
// what the split was always meant to mean.
func (g *GameState) heroIsBuilder(heroID string) bool {
	for _, p := range g.Players {
		for i, id := range p.HeroIDs {
			if id == heroID {
				return i == 0
			}
		}
	}
	return false // heroes with no owner (legacy solo) are all gatherers
}

// pickResourceTile chooses where the bot hero goes gathering: discovered, walkable,
// monster-free tiles with resources left, scored by distance MINUS richness, plus a
// penalty outside the hero's preferred sector — then one of the top three is drawn
// at random. Tiles another living hero already stands on are skipped (spread out
// instead of queueing behind a teammate).
func (g *GameState) pickResourceTile(h *Hero) (int, int, bool) {
	dirX, dirY, _ := heroBias(h.ID)
	want := g.botShoppingList()
	crit := g.botCriticalList(want)
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
			if t == nil || !t.Discovered || !t.Biome.Walkable() || t.MonsterID != "" {
				continue
			}
			supplies := biomeSupplies(t.Biome, want)
			// An EXHAUSTED tile is not a dead tile: searching it still turns up a real
			// resource a quarter of the time (see depletedFindPct). That trickle is worth
			// working when it is the only stone in reach — but only then.
			if t.Resources <= 0 && !supplies {
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
			// A tile that drops what the town is waiting for is worth a long walk —
			// everything the town builds comes from the forest and the mountain. A
			// material the Bank has NONE of outranks one it merely wants more of, by
			// enough to send a hero past the near forest to the far quarry.
			switch {
			case biomeSupplies(t.Biome, crit):
				score -= 45
			case supplies:
				score -= 12
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
