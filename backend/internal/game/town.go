package game

// Town buildings and the action-point economy of the city tile.
//
// Like in Hordes/Die2Nite, work in town is paid with the action points (PA) of the
// heroes who are physically standing on the town tile. Several heroes in town means a
// bigger shared PA pool to spend on construction, restoration and town actions.

// BuildReq is the cost of the next build/upgrade of a building: action points (labour)
// plus materials that must be present in the Bank.
type BuildReq struct {
	PA        int    `json:"pa"`
	Materials []Item `json:"materials"`
}

// TownBuilding is the authoritative state of one city building.
type TownBuilding struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Built             bool     `json:"built"`             // false => construction site
	UnderConstruction bool     `json:"underConstruction"` // site whose build has been started (visible on Home)
	Level             int      `json:"level"`
	Durability        int      `json:"durability"`
	MaxDurability     int      `json:"maxDurability"`
	Capacity          int      `json:"capacity"`    // e.g. water stored in the Well
	MaxCapacity       int      `json:"maxCapacity"` // 0 when the building has no stock
	Open              bool     `json:"open"`        // Gate only: an open gate gives no defense
	Defense           int      `json:"defense"`     // computed defense contribution
	Cost              BuildReq `json:"cost"`        // computed cost of the next build/upgrade
}

// buildMaterials is the base material recipe to build each building (scaled by level
// on upgrades). Materials must sit in the Bank (town storage).
var buildMaterials = map[string][]Item{
	"townhall": {{Type: "objet", Name: "Bois", Qty: 4}, {Type: "minerai", Name: "Pierre", Qty: 2}},
	"tower":    {{Type: "objet", Name: "Bois", Qty: 2}, {Type: "minerai", Name: "Pierre", Qty: 3}},
	"kitchen":  {{Type: "objet", Name: "Bois", Qty: 3}},
	"wall":     {{Type: "minerai", Name: "Pierre", Qty: 3}},
	"gate":     {{Type: "objet", Name: "Bois", Qty: 2}, {Type: "minerai", Name: "Minerai de fer", Qty: 1}},
	"well":     {{Type: "minerai", Name: "Pierre", Qty: 2}},
	"bank":     {{Type: "objet", Name: "Bois", Qty: 2}},
	"workshop": {{Type: "objet", Name: "Bois", Qty: 3}},
	"panel":    {{Type: "objet", Name: "Bois", Qty: 1}},
}

// buildingCost returns the cost of the next build action:
//   - site not started  -> start cost: base materials + labour
//   - under construction -> finish cost: labour only (materials were paid to start)
//   - built              -> upgrade cost: scaled materials + labour
func buildingCost(b *TownBuilding) BuildReq {
	if b.UnderConstruction {
		return BuildReq{PA: 2, Materials: nil} // finish: labour only
	}
	mult := 1
	if b.Built {
		mult = b.Level + 1
	}
	base := buildMaterials[b.ID]
	mats := make([]Item, 0, len(base))
	for _, it := range base {
		mats = append(mats, Item{Type: it.Type, Name: it.Name, Qty: it.Qty * mult})
	}
	return BuildReq{PA: 2 + b.Level, Materials: mats}
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
		{ID: "gate", Name: "Gate", Built: true, Level: 2, Durability: 40, MaxDurability: 100},
		{ID: "wall", Name: "Wall", Built: true, Level: 1, Durability: 20, MaxDurability: 100},
		{ID: "kitchen", Name: "Kitchen", Built: false, Level: 0, MaxDurability: 80},
		{ID: "panel", Name: "Panel", Built: true, Level: 1, Durability: 97, MaxDurability: 100},
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

// DepositHeroLoot moves every in-town hero's inventory into the shared storage.
func (g *GameState) DepositHeroLoot() (int, error) {
	heroes := g.HeroesInTown()
	if len(heroes) == 0 {
		return 0, ActionError{"aucun héros dans la ville"}
	}
	moved := 0
	for _, h := range heroes {
		for _, it := range h.Inventory {
			g.addStorage(it)
			moved += it.Qty
		}
		h.Inventory = []Item{}
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
//   - "build":   build (if it's a construction site) or upgrade — spends PA AND the
//                required materials from the Bank.
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

	switch action {
	case "build":
		cost := buildingCost(b)
		// All materials must be in the Bank, and the labour must be payable, before
		// anything is consumed.
		for _, m := range cost.Materials {
			if g.storageQty(m.Name) < m.Qty {
				return ActionError{"matériau manquant dans la banque : " + m.Name}
			}
		}
		if !g.canPay(heroID, cost.PA) {
			return ActionError{"PA insuffisants"}
		}
		for _, m := range cost.Materials {
			g.removeStorage(m.Name, m.Qty)
		}
		g.spendFor(heroID, cost.PA)
		switch {
		case b.Built:
			// Upgrade an existing building.
			b.Level++
			b.MaxDurability += 20
			b.Durability = b.MaxDurability
			if b.MaxCapacity > 0 {
				b.MaxCapacity += b.MaxCapacity / 2
			}
		case b.UnderConstruction:
			// Finish an in-progress construction.
			b.UnderConstruction = false
			b.Built = true
			b.Level = 1
			b.Durability = b.MaxDurability
		default:
			// Start construction on a fresh site (materials paid now; it now shows on Home
			// as "en construction" and a follow-up build finishes it).
			b.UnderConstruction = true
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
		return nil

	case "use":
		if !b.Built {
			return ActionError{b.Name + " n'est pas encore construit"}
		}
		if !g.spendFor(heroID, 1) {
			return ActionError{"PA insuffisants"}
		}
		return nil
	}
	return ActionError{"action de ville inconnue"}
}
