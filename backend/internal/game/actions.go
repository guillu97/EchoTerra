package game

import "math/rand"

// Map-level state names used by the slice.
const (
	StateFatigue  = "Fatigue"
	StateSoif     = "Soif"
	StateTetanise = "Tétanisé"
)

// ActionError is a player-facing rejection of a map action.
type ActionError struct{ Msg string }

func (e ActionError) Error() string { return e.Msg }

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
	if t == nil || !t.Biome.Walkable() {
		return ActionError{"case inaccessible"}
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
		if t := g.TileAt(nx, ny); t != nil && t.Biome.Walkable() {
			h.X, h.Y = nx, ny
			h.RemoveState("Caché")
			break
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
	t := g.TileAt(h.X, h.Y)
	if t == nil {
		return nil, ActionError{"case invalide"}
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
	it := lootForBiome(t.Biome)
	h.AddLoot(it)
	return &it, nil
}

func lootForBiome(b Biome) Item {
	switch b {
	case BiomeForest:
		opts := []Item{{"plante", "Herbe médicinale", 1}, {"animal", "Peau", 1}, {"objet", "Bois", 1}}
		return opts[rand.Intn(len(opts))]
	case BiomeGrass, BiomeSand:
		opts := []Item{{"plante", "Fleur", 1}, {"animal", "Viande", 1}, {"objet", "Débris", 1}}
		return opts[rand.Intn(len(opts))]
	case BiomeMountain, BiomeSnow:
		opts := []Item{{"minerai", "Pierre", 1}, {"minerai", "Minerai de fer", 1}}
		return opts[rand.Intn(len(opts))]
	default:
		return Item{"objet", "Débris", 1}
	}
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
		// Remove the defeated monster and reward the party.
		if t := g.TileAt(c.TileX, c.TileY); t != nil {
			delete(g.Monsters, t.MonsterID)
			t.MonsterID = ""
		}
		for _, u := range c.Units {
			if u.Side == "hero" {
				if h := g.HeroByID(u.RefID); h != nil {
					h.AddLoot(Item{"animal", "Trophée de monstre", 1})
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
