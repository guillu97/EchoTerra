package game

import (
	"fmt"
	"time"
)

// Town buildings and the action-point economy of the city tile.
//
// Like in Hordes/Die2Nite, work in town is paid with the action points (PA) of the
// heroes who are physically standing on the town tile. Several heroes in town means a
// bigger shared PA pool to spend on construction, restoration and town actions.

// BuildReq is the cost of the next build/upgrade of a building: action points (labour)
// plus materials that must be present in the Bank. For a fresh site (level-1 build)
// the raw materials are replaced by a single lootable Plan (blueprint) item — you find
// the plan out in the world, and having it in town lets you lay the chantier down.
type BuildReq struct {
	PA        int    `json:"pa"`
	Materials []Item `json:"materials"`
	Plan      string `json:"plan,omitempty"` // blueprint item name required to open a fresh site ("" for upgrades)
}

// buildingPlanItem returns the blueprint (plan) item that must be FOUND out in the
// world and carried to town before a fresh site's construction plan can be laid.
// Only the constructible-at-start sites use plans; buildings that start built (and
// every upgrade) return "" (no plan — upgrades still consume crafted materials).
func buildingPlanItem(id string) string {
	switch id {
	case "townhall":
		return "Plan de la Mairie"
	case "tower":
		return "Plan de la Tour"
	case "kitchen":
		return "Plan de la Cuisine"
	case "recyclerie":
		return "Plan de la Recyclerie"
	}
	return ""
}

// TownBuilding is the authoritative state of one city building.
type TownBuilding struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Built             bool     `json:"built"`             // false => construction site
	UnderConstruction bool     `json:"underConstruction"` // an open chantier (plan laid; visible on Home)
	PaInvested        int      `json:"paInvested"`        // labour poured into the open chantier so far
	Level             int      `json:"level"`
	Durability        int      `json:"durability"`
	MaxDurability     int      `json:"maxDurability"`
	Capacity          int      `json:"capacity"`    // e.g. water stored in the Well
	MaxCapacity       int      `json:"maxCapacity"` // 0 when the building has no stock
	Open              bool     `json:"open"`        // Gate only: an open gate gives no defense
	Defense           int      `json:"defense"`     // computed defense contribution
	Cost              BuildReq `json:"cost"`        // computed cost of the next build/upgrade
	// Requires mirrors the design tech tree (derived; refreshed by Recompute) so the
	// client can show why a site's plan is locked.
	Requires []BuildingRequire `json:"requires,omitempty"`
}

// buildPA is the total labour a chantier requires to complete a building at level 1;
// an upgrade to level L costs base × L. Construction is a collective effort: players
// pour their heroes' PA into the site over several days (Hordes-style). These values
// deliberately IGNORE the design file's pa fields (user decision).
var buildPA = map[string]int{
	"townhall":   20,
	"tower":      15,
	"kitchen":    12,
	"wall":       15,
	"gate":       12,
	"well":       10,
	"bank":       12,
	"workshop":   15,
	"panel":      6,
	"recyclerie": 12,
}

// planPACost is the price of laying down the plan that opens a chantier.
const planPACost = 1

// buildingCost returns the FULL requirement of the current (or next) chantier:
//   - site / under construction -> total labour + level-1 materials
//   - built                     -> the NEXT level's requirement (per-level materials
//     from the design tech tree — higher levels ask for crafted goods like Planche,
//     Corde, Brique, Acier or the Cœur de chêne ancien)
//
// Materials are a PRESENCE gate while investing PA and are only consumed when the
// chantier completes; b.PaInvested tracks progress toward Cost.PA. A built Workshop
// level 2+ shaves 1 PA off every chantier ("coût PA chantiers -1"). At max level the
// requirement is empty (callers reject further builds).
func (g *GameState) buildingCost(b *TownBuilding) BuildReq {
	target := 1
	if b.Built {
		target = b.Level + 1
	}
	if target > MaxBuildingLevel {
		return BuildReq{Materials: []Item{}}
	}
	pa := buildPA[b.ID]
	if pa == 0 {
		pa = 10
	}
	pa *= target
	if w := g.buildingByID("workshop"); w != nil && w != b && w.Built && w.Level >= 2 && pa > 1 {
		pa-- // Workshop niv.2 : coût PA des chantiers -1
	}
	var mats []Item
	if lv := buildingLevelDef(b.ID, target); lv != nil {
		mats = make([]Item, len(lv.Materials))
		copy(mats, lv.Materials)
	}
	// A fresh site ALSO needs its lootable Plan (blueprint) in the Bank to lay the
	// chantier — on TOP of the level-1 materials and PA (the plan is an extra gate,
	// consumed at plan-laying; upgrades need no plan). Simple buildings' plans drop
	// commonly (see design.go / ruins.go) so this doesn't stall the early game.
	plan := ""
	if !b.Built {
		plan = buildingPlanItem(b.ID)
	}
	return BuildReq{PA: pa, Materials: mats, Plan: plan}
}

// checkBuildRequires validates a site's tech-tree prerequisites (from the design)
// before its construction plan can be laid.
func (g *GameState) checkBuildRequires(b *TownBuilding) error {
	for _, req := range BuildingDesigns[b.ID].Requires {
		o := g.buildingByID(req.Building)
		if o == nil || !o.Built || o.Level < req.Level {
			name := req.Building
			if o != nil {
				name = o.Name
			}
			return ActionError{fmt.Sprintf("%s requiert %s niveau %d", b.Name, name, req.Level)}
		}
	}
	return nil
}

// DefaultBuildings seeds the city. Built at start: gate, wall, bank, well, workshop,
// panel. Construction sites (not built): townhall (the old House — revive), tower, kitchen.
func DefaultBuildings() []*TownBuilding {
	return []*TownBuilding{
		{ID: "townhall", Name: "Townhall", Built: false, Level: 0, MaxDurability: 120},
		{ID: "well", Name: "Well", Built: true, Level: 1, Durability: 97, MaxDurability: 100, Capacity: 12, MaxCapacity: 50},
		{ID: "bank", Name: "Bank", Built: true, Level: 1, Durability: 80, MaxDurability: 100, MaxCapacity: 500},
		{ID: "tower", Name: "Tower", Built: false, Level: 0, MaxDurability: 100},
		{ID: "workshop", Name: "Workshop", Built: true, Level: 1, Durability: 85, MaxDurability: 100},
		// The gate starts OPEN: a built, closed gate seals the town (nobody in or out),
		// and freshly spawned heroes must be able to leave. Closing it (1 PA toggle)
		// restores its defense contribution — that's the Hordes-style trade-off.
		{ID: "gate", Name: "Gate", Built: true, Level: 2, Durability: 40, MaxDurability: 100, Open: true},
		{ID: "wall", Name: "Wall", Built: true, Level: 1, Durability: 20, MaxDurability: 100},
		{ID: "kitchen", Name: "Kitchen", Built: false, Level: 0, MaxDurability: 80},
		{ID: "panel", Name: "Panel", Built: true, Level: 1, Durability: 97, MaxDurability: 100},
		// Recyclerie : chantier à construire — débloque le recyclage des débris en
		// matériaux (recettes de forge gatées sur ce bâtiment, cf. craft.go).
		{ID: "recyclerie", Name: "Recyclerie", Built: false, Level: 0, MaxDurability: 80},
	}
}

// TownLogEntry is one line of the town journal (the Panel building): who did what
// in town, when. Only IN-TOWN actions are recorded (gate, well, bank, builds,
// repairs, town crafts) — field actions (search, hide, combat…) don't belong here.
type TownLogEntry struct {
	At   time.Time `json:"at"`
	Day  int       `json:"day"`
	Text string    `json:"text"`
}

// townLogCap bounds the journal (newest first) so the state blob stays small.
const townLogCap = 100

// logTown prepends an entry to the town journal.
func (g *GameState) logTown(text string) {
	e := TownLogEntry{At: time.Now(), Day: g.Day, Text: text}
	g.Town.Log = append([]TownLogEntry{e}, g.Town.Log...)
	if len(g.Town.Log) > townLogCap {
		g.Town.Log = g.Town.Log[:townLogCap]
	}
}

// InitWellRations sets the Well's starting stock per the design: 2 in-game days of
// water for the whole expedition (2 rations × total heroes). Called at game launch,
// when the final roster is known.
func (g *GameState) InitWellRations() {
	w := g.buildingByID("well")
	if w == nil {
		return
	}
	w.Capacity = 2 * len(g.Heroes)
	if w.MaxCapacity > 0 && w.Capacity > w.MaxCapacity {
		w.Capacity = w.MaxCapacity
	}
}

// HeroesInTown returns the living heroes currently standing on the town tile.
func (g *GameState) HeroesInTown() []*Hero {
	var out []*Hero
	for _, h := range g.Heroes {
		if h.HP > 0 && h.X == g.Town.X && h.Y == g.Town.Y {
			out = append(out, h)
		}
	}
	return out
}

// TownPA is the shared action-point pool available for town work.
func (g *GameState) TownPA() int {
	n := 0
	for _, h := range g.HeroesInTown() {
		n += h.PA
	}
	return n
}

// spendTownPA drains n action points from the heroes in town (one after another).
// Returns false (spending nothing) if the pool is too small.
func (g *GameState) spendTownPA(n int) bool {
	if n <= 0 {
		return true
	}
	if g.TownPA() < n {
		return false
	}
	remaining := n
	for _, h := range g.HeroesInTown() {
		if remaining == 0 {
			break
		}
		take := h.PA
		if take > remaining {
			take = remaining
		}
		h.PA -= take
		remaining -= take
		if h.PA == 0 {
			h.AddState(StateFatigue)
		}
	}
	return true
}

// spendFor spends n action points. If heroID is set, that specific in-town hero pays;
// otherwise it draws from the shared town pool. Returns false (spending nothing) if it
// can't be paid.
func (g *GameState) spendFor(heroID string, n int) bool {
	if n <= 0 {
		return true
	}
	if heroID == "" {
		return g.spendTownPA(n)
	}
	h := g.HeroByID(heroID)
	if h == nil || h.HP <= 0 || h.X != g.Town.X || h.Y != g.Town.Y || h.PA < n {
		return false
	}
	h.PA -= n
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	return true
}

// canPay reports whether n action points can be paid (without spending them).
func (g *GameState) canPay(heroID string, n int) bool {
	if n <= 0 {
		return true
	}
	if heroID == "" {
		return g.TownPA() >= n
	}
	h := g.HeroByID(heroID)
	return h != nil && h.HP > 0 && h.X == g.Town.X && h.Y == g.Town.Y && h.PA >= n
}

// --- town storage (the Bank stash) ----------------------------------------

func (g *GameState) storageQty(name string) int {
	for _, it := range g.Town.Storage {
		if it.Name == name {
			return it.Qty
		}
	}
	return 0
}

func (g *GameState) addStorage(it Item) {
	for i := range g.Town.Storage {
		if g.Town.Storage[i].Name == it.Name {
			g.Town.Storage[i].Qty += it.Qty
			return
		}
	}
	g.Town.Storage = append(g.Town.Storage, it)
}

func (g *GameState) removeStorage(name string, qty int) {
	out := g.Town.Storage[:0]
	for _, it := range g.Town.Storage {
		if it.Name == name {
			it.Qty -= qty
			if it.Qty <= 0 {
				continue
			}
		}
		out = append(out, it)
	}
	g.Town.Storage = out
}

// DepositHeroLoot moves in-town heroes' inventories into the shared storage.
// With a non-empty `only` filter, just those heroes deposit (multiplayer: a player
// empties their OWN team's bags); with nil every in-town hero deposits (legacy solo).
func (g *GameState) DepositHeroLoot(only []string) (int, error) {
	heroes := g.HeroesInTown()
	if len(only) > 0 {
		allowed := map[string]bool{}
		for _, id := range only {
			allowed[id] = true
		}
		filtered := heroes[:0]
		for _, h := range heroes {
			if allowed[h.ID] {
				filtered = append(filtered, h)
			}
		}
		heroes = filtered
		if len(heroes) == 0 {
			return 0, ActionError{"aucun de tes héros n'est dans la ville"}
		}
	}
	if len(heroes) == 0 {
		return 0, ActionError{"aucun héros dans la ville"}
	}
	moved := 0
	for _, h := range heroes {
		n := 0
		for _, it := range h.Inventory {
			g.addStorage(it)
			n += it.Qty
		}
		h.Inventory = []Item{}
		if n > 0 {
			g.logTown(fmt.Sprintf("📦 %s a déposé %d objet(s) à la Banque", h.Name, n))
		}
		moved += n
	}
	return moved, nil
}

func (g *GameState) buildingByID(id string) *TownBuilding {
	for _, b := range g.Town.Buildings {
		if b.ID == id {
			return b
		}
	}
	return nil
}

// TownAction applies a town action to a building. Supported actions:
//   - "build":   chantier flow. No open chantier -> lay the PLAN (1 PA, no materials);
//     open chantier -> invest `points` PA, allowed only while ALL required
//     materials sit in the Bank (they are NOT consumed yet — invested PA
//     remain if materials vanish, investing just pauses). Reaching the PA
//     requirement consumes the materials and completes the build/upgrade.
//   - "restore": spend `points` PA to repair (+5 durability per PA). Built only.
//   - "use":     a flavored 1-PA action (draw water, …). Built only.
//
// Every variant requires at least one hero in town.
func (g *GameState) TownAction(buildingID, action string, points int, heroID string) error {
	if len(g.HeroesInTown()) == 0 {
		return ActionError{"aucun héros dans la ville"}
	}
	b := g.buildingByID(buildingID)
	if b == nil {
		return ActionError{"bâtiment introuvable"}
	}
	if points <= 0 {
		points = 1
	}
	// Journal attribution: the paying hero, or the shared pool in legacy solo.
	worker := "l'équipe"
	if h := g.HeroByID(heroID); h != nil {
		worker = h.Name
	}

	switch action {
	case "build":
		if b.Built && b.Level >= MaxBuildingLevel {
			return ActionError{b.Name + " est déjà au niveau maximum"}
		}
		cost := g.buildingCost(b)
		if !b.UnderConstruction {
			// Phase 1 — the PLAN: opening the chantier costs 1 PA and no materials.
			// The full requirement (cost.PA labour + materials) is now on display.
			// A fresh site must first satisfy its tech-tree prerequisites.
			if !b.Built {
				if err := g.checkBuildRequires(b); err != nil {
					return err
				}
				// A fresh site needs its blueprint FOUND and sitting in the Bank; laying
				// the plan consumes it (that's the whole cost of a level-1 build besides PA).
				if cost.Plan != "" {
					if g.storageQty(cost.Plan) < 1 {
						return ActionError{"il faut trouver « " + cost.Plan + " » et le déposer à la Banque pour poser ce chantier"}
					}
				}
			}
			if !g.spendFor(heroID, planPACost) {
				return ActionError{"PA insuffisants"}
			}
			if cost.Plan != "" {
				g.removeStorage(cost.Plan, 1)
			}
			b.UnderConstruction = true
			b.PaInvested = 0
			if b.Built {
				g.logTown(fmt.Sprintf("📐 %s a posé le plan d'amélioration de %s (niveau %d — %d PA à investir)", worker, b.Name, b.Level+1, cost.PA))
			} else if cost.Plan != "" {
				g.logTown(fmt.Sprintf("📐 %s a posé %s (%d PA à investir)", worker, cost.Plan, cost.PA))
			} else {
				g.logTown(fmt.Sprintf("📐 %s a posé le plan de chantier de %s (%d PA à investir)", worker, b.Name, cost.PA))
			}
			return nil
		}
		// Phase 2 — the LABOUR: PA can be invested only while every required material
		// sits in the Bank. Nothing is consumed here — if materials vanish mid-build the
		// invested PA remain, the chantier just pauses.
		for _, m := range cost.Materials {
			if g.storageQty(m.Name) < m.Qty {
				return ActionError{"matériau manquant dans la banque : " + m.Name + " (les PA déjà investis restent acquis)"}
			}
		}
		if remaining := cost.PA - b.PaInvested; points > remaining {
			points = remaining
		}
		// Invest what the payer can actually afford rather than rejecting outright.
		if heroID != "" {
			if h := g.HeroByID(heroID); h != nil && points > h.PA {
				points = h.PA
			}
		} else if pool := g.TownPA(); points > pool {
			points = pool
		}
		if points <= 0 || !g.spendFor(heroID, points) {
			return ActionError{"PA insuffisants"}
		}
		b.PaInvested += points
		if b.PaInvested < cost.PA {
			g.logTown(fmt.Sprintf("🏗️ %s a travaillé sur %s (+%d PA — %d/%d)", worker, b.Name, points, b.PaInvested, cost.PA))
			return nil
		}
		// Chantier complete: NOW the materials are consumed.
		for _, m := range cost.Materials {
			g.removeStorage(m.Name, m.Qty)
		}
		b.UnderConstruction = false
		b.PaInvested = 0
		if b.Built {
			b.Level++
			b.MaxDurability += 20
			b.Durability = b.MaxDurability
			g.logTown(fmt.Sprintf("🏗️ %s a achevé l'amélioration de %s (niveau %d, matériaux prélevés à la Banque)", worker, b.Name, b.Level))
		} else {
			b.Built = true
			b.Level = 1
			b.Durability = b.MaxDurability
			g.logTown(fmt.Sprintf("🏗️ %s a achevé la construction de %s", worker, b.Name))
		}
		// Per-level stock capacity from the design (Well 50/75/112, Bank 500/750/1125).
		if lv := buildingLevelDef(b.ID, b.Level); lv != nil && lv.Capacity > 0 {
			b.MaxCapacity = lv.Capacity
		}
		return nil

	case "restore":
		if !b.Built {
			return ActionError{b.Name + " n'est pas encore construit"}
		}
		if b.Durability >= b.MaxDurability {
			return ActionError{b.Name + " est déjà au maximum de durabilité"}
		}
		if !g.spendFor(heroID, points) {
			return ActionError{"PA insuffisants"}
		}
		b.Durability += 5 * points
		if b.Durability > b.MaxDurability {
			b.Durability = b.MaxDurability
		}
		g.logTown(fmt.Sprintf("🔧 %s a réparé %s (+%d durabilité)", worker, b.Name, 5*points))
		return nil

	case "water": // Well: a hero draws a daily water ration (free, 1 per hero per day).
		if b.ID != "well" {
			return ActionError{"action réservée au puits"}
		}
		if !b.Built {
			return ActionError{b.Name + " n'est pas encore construit"}
		}
		if b.Capacity <= 0 {
			return ActionError{"le puits est à sec"}
		}
		// A specific in-town hero must draw the water (the town worker). The shared
		// pool can't drink for everyone at once.
		h := g.HeroByID(heroID)
		if h == nil || h.HP <= 0 || h.X != g.Town.X || h.Y != g.Town.Y {
			return ActionError{"sélectionnez un héros présent dans la ville pour puiser"}
		}
		if h.DrewWaterDay == g.Day {
			return ActionError{h.Name + " a déjà puisé de l'eau aujourd'hui"}
		}
		b.Capacity--
		h.DrewWaterDay = g.Day
		h.RemoveState(StateSoif) // drinking quenches thirst
		h.AddLoot(Item{Type: "eau", Name: "Ration d'eau", Qty: 1})
		g.logTown(fmt.Sprintf("💧 %s a puisé une ration d'eau au puits", h.Name))
		return nil

	case "revive": // Townhall: resurrect a fallen hero (design: lit du Townhall).
		if b.ID != "townhall" {
			return ActionError{"action réservée au Townhall"}
		}
		if !b.Built {
			return ActionError{b.Name + " n'est pas encore construit"}
		}
		var dead *Hero
		for _, hh := range g.Heroes {
			if hh.HP <= 0 {
				dead = hh
				break
			}
		}
		if dead == nil {
			return ActionError{"aucun héros à ressusciter"}
		}
		// Daily allowance = Townhall level (1/jour au niv.1, 2/jour au niv.2);
		// level 3 is unlimited AND free ("revive gratuit").
		if g.Town.ReviveDay != g.Day {
			g.Town.ReviveDay = g.Day
			g.Town.RevivesToday = 0
		}
		if b.Level < 3 && g.Town.RevivesToday >= b.Level {
			return ActionError{"le lit du Townhall a déjà servi aujourd'hui"}
		}
		cost := 2
		if b.Level >= 3 {
			cost = 0
		}
		if !g.spendFor(heroID, cost) {
			return ActionError{"PA insuffisants"}
		}
		dead.HP = dead.MaxHP / 2
		if dead.HP < 1 {
			dead.HP = 1
		}
		dead.X, dead.Y = g.Town.X, g.Town.Y
		dead.States = []string{}
		g.Town.RevivesToday++
		g.logTown(fmt.Sprintf("🛏️ %s a ressuscité %s au Townhall", worker, dead.Name))
		return nil

	case "toggle": // Gate: open/close it. An open gate provides no defense. Costs 1 PA.
		if b.ID != "gate" {
			return ActionError{"action réservée à la porte"}
		}
		if !b.Built {
			return ActionError{b.Name + " n'est pas encore construit"}
		}
		if !g.spendFor(heroID, 1) {
			return ActionError{"PA insuffisants"}
		}
		b.Open = !b.Open
		if b.Open {
			g.logTown(fmt.Sprintf("🚪 %s a OUVERT la porte de la ville", worker))
		} else {
			g.logTown(fmt.Sprintf("🚪 %s a FERMÉ la porte de la ville", worker))
		}
		return nil

	case "use":
		if !b.Built {
			return ActionError{b.Name + " n'est pas encore construit"}
		}
		if !g.spendFor(heroID, 1) {
			return ActionError{"PA insuffisants"}
		}
		g.logTown(fmt.Sprintf("✨ %s a utilisé %s", worker, b.Name))
		return nil
	}
	return ActionError{"action de ville inconnue"}
}
