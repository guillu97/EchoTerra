package game

import "math/rand"

// Map-level state names used by the slice.
const (
	StateFatigue  = "Fatigue"
	StateSoif     = "Soif"
	StateTetanise = "Tétanisé"
	StateCache    = "Caché"
)

// Fire ball (map skill) tuning.
const (
	FireballPACost = 2 // a hero spends 2 PA to cast Fire ball on the map
	FireballBase   = 5 // base damage before the caster's magical aptitude
)

// ActionError is a player-facing rejection of a map action.
type ActionError struct{ Msg string }

func (e ActionError) Error() string { return e.Msg }

// GateClosed reports whether the town gate blocks passage: a BUILT, closed gate
// seals the town — nobody walks in or out (Hordes-style: opening it is a town
// action, and an open gate contributes zero defense). No gate / unbuilt gate =
// a gap in the wall, free passage.
func (g *GameState) GateClosed() bool {
	for _, b := range g.Town.Buildings {
		if b.ID == "gate" {
			return b.Built && !b.Open
		}
	}
	return false
}

// MoveHero moves a hero by one orthogonal step, spending 1 PA.
func (g *GameState) MoveHero(heroID string, dx, dy int) error {
	if g.ActiveCombat != "" {
		return ActionError{"un combat est en cours"}
	}
	h := g.HeroByID(heroID)
	if h == nil {
		return ActionError{"héros introuvable"}
	}
	if absI(dx)+absI(dy) != 1 {
		return ActionError{"déplacement invalide (une case orthogonale)"}
	}
	if h.HasState(StateTetanise) {
		return ActionError{h.Name + " est tétanisé et ne peut pas bouger"}
	}
	if h.PA <= 0 {
		return ActionError{h.Name + " n'a plus de point d'action"}
	}
	nx, ny := h.X+dx, h.Y+dy
	t := g.TileAt(nx, ny)
	if t == nil {
		return ActionError{"case inaccessible"}
	}
	if !t.Biome.Walkable() {
		// Eau SOUS LE BROUILLARD (exploration au contact) : le héros s'avance,
		// paie son PA et DÉCOUVRE l'eau… mais reste sur sa case. Une fois l'eau
		// connue, le client masque la destination et le serveur refuse gratis.
		if !t.Discovered {
			h.PA--
			h.Bars["athletisme"]++
			h.RemoveState("Caché") // il a bougé à découvert
			t.Discovered = true
			if h.PA == 0 {
				h.AddState(StateFatigue)
			}
			return nil
		}
		return ActionError{"case inaccessible"}
	}
	// A built, closed gate seals the town in BOTH directions.
	if g.GateClosed() {
		if nx == g.Town.X && ny == g.Town.Y {
			return ActionError{"la porte de la ville est fermée — impossible d'entrer"}
		}
		if h.X == g.Town.X && h.Y == g.Town.Y {
			return ActionError{"la porte de la ville est fermée — impossible de sortir"}
		}
	}
	h.X, h.Y = nx, ny
	h.PA--
	h.Bars["athletisme"]++
	h.RemoveState("Caché") // moving breaks concealment
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	return nil
}

// HideHero conceals a hero on their current tile. A hidden hero is skipped by the next
// wave's attack (concealment is then consumed). Costs 1 PA.
func (g *GameState) HideHero(heroID string) error {
	if g.ActiveCombat != "" {
		return ActionError{"un combat est en cours"}
	}
	h := g.HeroByID(heroID)
	if h == nil {
		return ActionError{"héros introuvable"}
	}
	// Pointless AND confusing on the town tile: the wave already spares in-town
	// heroes, hiding is for the wilds.
	if h.X == g.Town.X && h.Y == g.Town.Y {
		return ActionError{"inutile de se cacher en ville — la ville protège déjà ses habitants"}
	}
	// A hero pinned by a pack (Tétanisé) can't slip away to hide: the monsters
	// hold them. Break free first (kill/thin the pack, or Escape).
	if h.HasState(StateTetanise) {
		return ActionError{h.Name + " est tétanisé — impossible de se cacher sous les griffes de la horde"}
	}
	if h.PA <= 0 {
		return ActionError{h.Name + " n'a plus de point d'action"}
	}
	h.PA--
	h.Bars["athletisme"]++
	h.AddState("Caché")
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	return nil
}

// EscapeHero retreats one step toward town; 25% chance to stumble (Blessé) and stay
// put. Costs 1 PA.
func (g *GameState) EscapeHero(heroID string) error {
	if g.ActiveCombat != "" {
		return ActionError{"un combat est en cours"}
	}
	h := g.HeroByID(heroID)
	if h == nil {
		return ActionError{"héros introuvable"}
	}
	if h.PA <= 0 {
		return ActionError{h.Name + " n'a plus de point d'action"}
	}
	h.PA--
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	if rand.Intn(100) < 25 {
		h.AddState("Blessé") // stumbled
		return nil
	}
	dx, dy := 0, 0
	if g.Town.X > h.X {
		dx = 1
	} else if g.Town.X < h.X {
		dx = -1
	}
	if g.Town.Y > h.Y {
		dy = 1
	} else if g.Town.Y < h.Y {
		dy = -1
	}
	order := [][2]int{{dx, 0}, {0, dy}}
	if absI(g.Town.Y-h.Y) > absI(g.Town.X-h.X) {
		order = [][2]int{{0, dy}, {dx, 0}}
	}
	for _, d := range order {
		if d[0] == 0 && d[1] == 0 {
			continue
		}
		nx, ny := h.X+d[0], h.Y+d[1]
		// A closed gate also stops a retreating hero at the walls: the escape step
		// may not END on the town tile (retreat along the other axis instead).
		if g.GateClosed() && nx == g.Town.X && ny == g.Town.Y {
			continue
		}
		if t := g.TileAt(nx, ny); t != nil && t.Biome.Walkable() {
			h.X, h.Y = nx, ny
			h.RemoveState("Caché")
			break
		}
	}
	return nil
}

// FireballReport summarises a Fire ball cast for the client log.
type FireballReport struct {
	MonsterID string `json:"monsterId"`
	Species   string `json:"species"`
	Damage    int    `json:"damage"`
	Slain     int    `json:"slain"`  // creatures removed from the pack by this cast
	Killed    bool   `json:"killed"` // the whole pack was destroyed
	X         int    `json:"x"`
	Y         int    `json:"y"`
}

// FireballHero casts the Fire ball map skill (mockup page 3): an area blast that hits a
// monster pack on the hero's tile or an orthogonally adjacent tile. Damage scales with
// the caster's précision/dextérité and burns through the pack, thinning its Count (and
// thus easing Tétanisé) or destroying it outright. Costs FireballPACost PA. A Tétanisé
// hero may still cast it — clearing the surrounding pack is a way to break free.
func (g *GameState) FireballHero(heroID string) (*FireballReport, error) {
	if g.ActiveCombat != "" {
		return nil, ActionError{"un combat est en cours"}
	}
	h := g.HeroByID(heroID)
	if h == nil {
		return nil, ActionError{"héros introuvable"}
	}
	if h.PA < FireballPACost {
		return nil, ActionError{h.Name + " n'a pas assez de PA pour une boule de feu"}
	}
	m := g.fireballTarget(h.X, h.Y)
	if m == nil {
		return nil, ActionError{"aucune cible à portée pour la boule de feu"}
	}

	dmg := FireballBase + h.Stats.Precision + h.Stats.Dexterite/2 + rand.Intn(4)
	rep := &FireballReport{MonsterID: m.ID, Species: m.Species, Damage: dmg, X: m.X, Y: m.Y}

	m.HP -= dmg
	for m.HP <= 0 && m.Count > 1 { // the blast carries through the pack
		m.Count--
		rep.Slain++
		m.HP += m.MaxHP
	}
	if m.HP <= 0 && m.Count <= 1 {
		rep.Slain++
		rep.Killed = true
		delete(g.Monsters, m.ID)
		if t := g.TileAt(m.X, m.Y); t != nil && t.MonsterID == m.ID {
			t.MonsterID = ""
		}
	}

	h.PA -= FireballPACost
	h.Bars["combat"]++
	h.RemoveState(StateCache) // casting reveals the hero
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	return rep, nil
}

// fireballTarget finds the pack the Fire ball will hit: the monster on (x,y) if any,
// otherwise the first monster on an orthogonally adjacent tile.
func (g *GameState) fireballTarget(x, y int) *Monster {
	candidates := [][2]int{{x, y}, {x, y - 1}, {x, y + 1}, {x - 1, y}, {x + 1, y}}
	for _, c := range candidates {
		t := g.TileAt(c[0], c[1])
		if t == nil || t.MonsterID == "" {
			continue
		}
		if m := g.Monsters[t.MonsterID]; m != nil {
			return m
		}
	}
	return nil
}

// SearchTile performs a fouille on the hero's current tile, spending 1 PA and
// possibly yielding loot whose type depends on the biome.
func (g *GameState) SearchTile(heroID string) (*Item, error) {
	if g.ActiveCombat != "" {
		return nil, ActionError{"un combat est en cours"}
	}
	h := g.HeroByID(heroID)
	if h == nil {
		return nil, ActionError{"héros introuvable"}
	}
	if h.PA <= 0 {
		return nil, ActionError{h.Name + " n'a plus de point d'action"}
	}
	// A hero pinned by a pack (Tétanisé) fights for their life — no digging around.
	if h.HasState(StateTetanise) {
		return nil, ActionError{h.Name + " est tétanisé — impossible de fouiller sous les griffes de la horde"}
	}
	// The town tile is not searchable (its resources are zeroed at worldgen; town
	// loot lives in the Bank, not under the plaza).
	if h.X == g.Town.X && h.Y == g.Town.Y {
		return nil, ActionError{"rien à fouiller en ville — le stock est à la Banque"}
	}
	t := g.TileAt(h.X, h.Y)
	if t == nil {
		return nil, ActionError{"case invalide"}
	}
	td, ok := Terrains[t.Biome]
	if !ok || !td.Searchable {
		return nil, ActionError{"ce terrain n'a rien à fouiller"}
	}
	if t.Resources <= 0 {
		return nil, ActionError{"cette case est épuisée"}
	}
	h.PA--
	h.Bars["collecte"]++
	t.Resources--
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	d := weightedDrop(td.Drops)
	if d == nil {
		return nil, ActionError{"rien trouvé"}
	}
	it := Item{Type: d.Type, Name: d.Name, Qty: d.Qty}
	// Class harvest passives: Récupérateur carries +1 of anything it digs up;
	// Herboriste & Minéral guarantees +1 on plants and ores.
	if h.ClassID == "recuperateur" {
		it.Qty++
	}
	if h.ClassID == "herboriste" && (it.Type == "plante" || it.Type == "minerai") {
		it.Qty++
	}
	h.AddLoot(it)
	return &it, nil
}

// PreciseShotPACost / PreciseShotMaxHP tune the Chasseur's map skill "Tir précis":
// for 1 PA, a Chasseur finishes off a weakened pack on their tile — it only works
// when the pack's current creature is down to 5 HP or less.
const (
	PreciseShotPACost = 1
	PreciseShotMaxHP  = 5
)

// PreciseShotHero fires the Chasseur's Tir précis at the pack on the hero's tile:
// kills ONE creature of the pack when its current HP is ≤ PreciseShotMaxHP.
func (g *GameState) PreciseShotHero(heroID string) (*FireballReport, error) {
	if g.ActiveCombat != "" {
		return nil, ActionError{"un combat est en cours"}
	}
	h := g.HeroByID(heroID)
	if h == nil {
		return nil, ActionError{"héros introuvable"}
	}
	if h.ClassID != "chasseur" {
		return nil, ActionError{"seul un Chasseur maîtrise le Tir précis"}
	}
	if h.PA < PreciseShotPACost {
		return nil, ActionError{h.Name + " n'a plus de point d'action"}
	}
	t := g.TileAt(h.X, h.Y)
	if t == nil || t.MonsterID == "" {
		return nil, ActionError{"aucun monstre sur cette case"}
	}
	m := g.Monsters[t.MonsterID]
	if m == nil {
		return nil, ActionError{"ennemi introuvable"}
	}
	if m.HP > PreciseShotMaxHP {
		return nil, ActionError{"la cible est trop vigoureuse (PV > 5) pour un Tir précis"}
	}
	rep := &FireballReport{MonsterID: m.ID, Species: m.Species, Damage: m.HP, Slain: 1, X: m.X, Y: m.Y}
	if m.Count > 1 {
		m.Count--
		m.HP = m.MaxHP // the next creature of the pack steps up
	} else {
		rep.Killed = true
		delete(g.Monsters, m.ID)
		if t.MonsterID == m.ID {
			t.MonsterID = ""
		}
	}
	h.PA -= PreciseShotPACost
	h.Bars["combat"]++
	h.RemoveState(StateCache)
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	return rep, nil
}

// Advance moves the game forward half a day: regenerate PA and clear fatigue.
// (In the real game this is driven by the wave scheduler at 13h/1h.)
func (g *GameState) Advance() {
	g.Wave++
	if g.Wave >= 2 {
		g.Wave = 0
		g.Day++
	}
	for _, h := range g.Heroes {
		h.PA = h.MaxPA
		h.RemoveState(StateFatigue)
		h.RemoveState(StateTetanise)
	}
}

// StartCombat engages the monster on the acting hero's tile. Every hero standing on
// that tile joins the fight.
func (g *GameState) StartCombat(heroID string) (*Combat, error) {
	if g.ActiveCombat != "" {
		return nil, ActionError{"un combat est déjà en cours"}
	}
	h := g.HeroByID(heroID)
	if h == nil {
		return nil, ActionError{"héros introuvable"}
	}
	t := g.TileAt(h.X, h.Y)
	if t == nil || t.MonsterID == "" {
		return nil, ActionError{"aucun ennemi sur cette case"}
	}
	m := g.Monsters[t.MonsterID]
	if m == nil {
		return nil, ActionError{"ennemi introuvable"}
	}
	var party []*Hero
	for _, hh := range g.Heroes {
		if hh.X == h.X && hh.Y == h.Y && hh.HP > 0 {
			party = append(party, hh)
		}
	}
	if len(party) == 0 {
		party = []*Hero{h}
	}
	c := NewCombat(g, party, m)
	if g.Combats == nil { // states from legacy rows/fixtures may lack the map
		g.Combats = map[string]*Combat{}
	}
	g.Combats[c.ID] = c
	g.ActiveCombat = c.ID
	if c.Status != "active" {
		g.FinishCombat(c)
	}
	return c, nil
}

// FinishCombat writes a resolved combat's consequences back onto the world.
func (g *GameState) FinishCombat(c *Combat) {
	if c.Status == "active" {
		return
	}
	// Write hero HP back from their combat units.
	for _, u := range c.Units {
		if u.Side != "hero" {
			continue
		}
		if h := g.HeroByID(u.RefID); h != nil {
			h.HP = u.HP
			h.Bars["combat"]++
		}
	}

	switch c.Status {
	case "won":
		// Remove the defeated monster and reward the party: each hero draws one entry
		// from the species' weighted loot table (👹 Monstres). A Récupérateur's
		// "Récupération" passive nets an extra trophy on top.
		var sp *SpeciesDef
		if t := g.TileAt(c.TileX, c.TileY); t != nil {
			if m := g.Monsters[t.MonsterID]; m != nil {
				sp = SpeciesByName(m.Species)
			}
			delete(g.Monsters, t.MonsterID)
			t.MonsterID = ""
		}
		for _, u := range c.Units {
			if u.Side == "hero" {
				if h := g.HeroByID(u.RefID); h != nil {
					loot := Item{Type: "animal", Name: "Trophée de monstre", Qty: 1}
					if sp != nil {
						if d := weightedDrop(sp.Drops); d != nil {
							loot = Item{Type: d.Type, Name: d.Name, Qty: d.Qty}
						}
					}
					h.AddLoot(loot)
					if h.ClassID == "recuperateur" {
						h.AddLoot(Item{Type: "animal", Name: "Trophée de monstre", Qty: 1})
					}
				}
			}
		}
	case "lost":
		// Heroes retreat to town and are stabilized at 1 HP; the monster remains.
		for _, h := range g.Heroes {
			if h.X == c.TileX && h.Y == c.TileY {
				h.X, h.Y = g.Town.X, g.Town.Y
				if h.HP < 1 {
					h.HP = 1
				}
				h.AddState(StateTetanise)
			}
		}
	}
	g.ActiveCombat = ""
}
