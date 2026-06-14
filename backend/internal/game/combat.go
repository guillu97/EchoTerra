package game

import (
	"fmt"
	"math/rand"
	"sort"

	"github.com/google/uuid"
)

// CombatUnit is a hero or monster instantiated on the isometric battle grid.
type CombatUnit struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Side    string   `json:"side"` // "hero" | "monster"
	RefID   string   `json:"refId"` // source hero/monster id on the map
	Kind    string   `json:"kind"`  // species (monster) or class (hero), for art
	X       int      `json:"x"`
	Y       int      `json:"y"`
	HP      int      `json:"hp"`
	MaxHP   int      `json:"maxHp"`
	Stats   Stats    `json:"stats"`
	States  []string `json:"states"`
	Move    int      `json:"move"`
	Moved   bool     `json:"moved"` // already moved this turn (FFTA2: one move per turn)
	Initiative int   `json:"initiative"`
}

// Alive reports whether the unit still has hit points.
func (u *CombatUnit) Alive() bool { return u.HP > 0 }

func (u *CombatUnit) hasState(s string) bool {
	for _, st := range u.States {
		if st == s {
			return true
		}
	}
	return false
}

func (u *CombatUnit) addState(s string) {
	if !u.hasState(s) {
		u.States = append(u.States, s)
	}
}

func (u *CombatUnit) removeState(s string) {
	out := u.States[:0]
	for _, st := range u.States {
		if st != s {
			out = append(out, st)
		}
	}
	u.States = out
}

// Skill describes a unit's special ability for the slice.
type Skill struct {
	Name   string `json:"name"`
	Range  int    `json:"range"`
	Kind   string `json:"kind"`   // "melee" | "ranged"
	Effect string `json:"effect"` // "stun" | "absorb" | "burst" | ""
}

// Combat is one isometric battle instance, fully server-authoritative.
type Combat struct {
	ID      string        `json:"id"`
	GameID  string        `json:"gameId"`
	TileX   int           `json:"tileX"`
	TileY   int           `json:"tileY"`
	GridW   int           `json:"gridW"`
	GridH   int           `json:"gridH"`
	Heights []int         `json:"heights"` // row-major iso elevations
	Units   []*CombatUnit `json:"units"`
	Order   []string      `json:"order"` // unit ids, by initiative desc
	TurnIdx int           `json:"turnIdx"`
	Round   int           `json:"round"`
	Status  string        `json:"status"` // "active" | "won" | "lost"
	Log     []string      `json:"log"`
}

// NewCombat builds a battle from the heroes on a tile versus the tile's monster.
func NewCombat(gs *GameState, heroes []*Hero, monster *Monster) *Combat {
	const gw, gh = 7, 7
	heights := make([]int, gw*gh)
	for i := range heights {
		// Gentle, mostly-flat terrain with a few raised cells (FFTA2 vibe).
		r := rand.Intn(10)
		switch {
		case r < 7:
			heights[i] = 0
		case r < 9:
			heights[i] = 1
		default:
			heights[i] = 2
		}
	}

	c := &Combat{
		ID:      uuid.NewString(),
		GameID:  gs.ID,
		TileX:   monster.X,
		TileY:   monster.Y,
		GridW:   gw,
		GridH:   gh,
		Heights: heights,
		Status:  "active",
		Log:     []string{},
	}

	// Heroes spawn on the bottom row, monsters on the top row.
	for i, h := range heroes {
		u := &CombatUnit{
			ID:    uuid.NewString(),
			Name:  h.Name,
			Side:  "hero",
			RefID: h.ID,
			Kind:  h.Class,
			X:     2 + i,
			Y:     gh - 1,
			HP:    h.HP,
			MaxHP: h.MaxHP,
			Stats: h.Stats,
			Move:  2 + h.Stats.Agilite/3,
			States: []string{},
		}
		c.Units = append(c.Units, u)
	}
	// One combat unit per creature on the tile, capped so fights stay manageable even
	// when the surrounding pack (monster.Count, used for Tétanisé) is large.
	n := monster.Count
	if n < 1 {
		n = 1
	}
	if n > 4 {
		n = 4
	}
	for i := 0; i < n; i++ {
		u := &CombatUnit{
			ID:    uuid.NewString(),
			Name:  monster.Species,
			Side:  "monster",
			RefID: monster.ID,
			Kind:  monster.Species,
			X:     2 + i,
			Y:     0,
			HP:    monster.HP,
			MaxHP: monster.MaxHP,
			Stats: monster.Stats,
			Move:  2 + monster.Stats.Agilite/3,
			States: []string{},
		}
		c.Units = append(c.Units, u)
	}

	c.computeOrder()
	c.logf("Le combat commence !")
	// If the first unit is a monster, let the AI play up to the first hero turn.
	c.advanceUntilHeroOrEnd()
	return c
}

// computeOrder sorts units by initiative (agility, +small roll) descending.
func (c *Combat) computeOrder() {
	for _, u := range c.Units {
		u.Initiative = u.Stats.Agilite*10 + rand.Intn(10)
	}
	units := append([]*CombatUnit(nil), c.Units...)
	sort.SliceStable(units, func(i, j int) bool {
		if units[i].Initiative != units[j].Initiative {
			return units[i].Initiative > units[j].Initiative
		}
		return units[i].Side == "hero" // heroes win ties
	})
	c.Order = c.Order[:0]
	for _, u := range units {
		c.Order = append(c.Order, u.ID)
	}
	c.TurnIdx = 0
	c.Round = 1
}

func (c *Combat) unitByID(id string) *CombatUnit {
	for _, u := range c.Units {
		if u.ID == id {
			return u
		}
	}
	return nil
}

// CurrentUnit returns the unit whose turn it is, or nil.
func (c *Combat) CurrentUnit() *CombatUnit {
	if len(c.Order) == 0 {
		return nil
	}
	return c.unitByID(c.Order[c.TurnIdx])
}

func (c *Combat) unitAt(x, y int) *CombatUnit {
	for _, u := range c.Units {
		if u.Alive() && u.X == x && u.Y == y {
			return u
		}
	}
	return nil
}

func (c *Combat) heightAt(x, y int) int {
	if x < 0 || y < 0 || x >= c.GridW || y >= c.GridH {
		return 0
	}
	return c.Heights[y*c.GridW+x]
}

func (c *Combat) aliveOnSide(side string) int {
	n := 0
	for _, u := range c.Units {
		if u.Alive() && u.Side == side {
			n++
		}
	}
	return n
}

func (c *Combat) logf(format string, a ...any) {
	c.Log = append(c.Log, fmt.Sprintf(format, a...))
}

// passable reports whether unit u may stand on (x,y): in-bounds, unoccupied, and
// not too steep a climb (height difference up to 2, an FFTA2-style limit).
func (c *Combat) passable(x, y int, u *CombatUnit) bool {
	if x < 0 || y < 0 || x >= c.GridW || y >= c.GridH {
		return false
	}
	if o := c.unitAt(x, y); o != nil && o != u {
		return false
	}
	if absI(c.heightAt(x, y)-c.heightAt(u.X, u.Y)) > 2 {
		return false
	}
	return true
}

// Reachable returns the tiles unit u can reach this turn (BFS up to its Move range).
func (c *Combat) Reachable(u *CombatUnit) [][2]int {
	type node struct{ x, y, d int }
	seen := map[[2]int]bool{{u.X, u.Y}: true}
	q := []node{{u.X, u.Y, 0}}
	var out [][2]int
	for len(q) > 0 {
		cur := q[0]
		q = q[1:]
		if cur.d >= u.Move {
			continue
		}
		for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			nx, ny := cur.x+d[0], cur.y+d[1]
			key := [2]int{nx, ny}
			if seen[key] || !c.passable(nx, ny, u) {
				continue
			}
			seen[key] = true
			out = append(out, key)
			q = append(q, node{nx, ny, cur.d + 1})
		}
	}
	return out
}

func manhattan(ax, ay, bx, by int) int { return absI(ax-bx) + absI(ay-by) }

// Targets returns the enemy units u can hit with the given range.
func (c *Combat) Targets(u *CombatUnit, rng int) []*CombatUnit {
	var out []*CombatUnit
	for _, o := range c.Units {
		if o.Alive() && o.Side != u.Side && manhattan(u.X, u.Y, o.X, o.Y) <= rng {
			out = append(out, o)
		}
	}
	return out
}

// SkillFor returns the special ability available to a unit, by class/species.
func (c *Combat) SkillFor(u *CombatUnit) Skill {
	if u.Side == "hero" {
		return Skill{Name: "Frappe puissante", Range: 1, Kind: "melee", Effect: ""}
	}
	switch u.Kind {
	case "Goblin Pillard":
		return Skill{Name: "Tranche vicieuse", Range: 1, Kind: "melee", Effect: ""}
	case "Elementaire de Vent":
		return Skill{Name: "Colonne de Vent", Range: 3, Kind: "ranged", Effect: "stun"}
	default: // Slime Vorace
		return Skill{Name: "Absorbe", Range: 1, Kind: "melee", Effect: "absorb"}
	}
}

// baseAttackRange returns the normal-attack reach for a unit.
func (c *Combat) baseAttackRange(u *CombatUnit) int {
	if u.Kind == "Elementaire de Vent" {
		return 2 // ranged creature
	}
	return 1
}

func (c *Combat) damage(att, def *CombatUnit, ranged bool, bonus int) int {
	atk := att.Stats.Force
	if ranged {
		atk = att.Stats.Dexterite
	}
	// Height advantage adds a flat bonus (high ground).
	if c.heightAt(att.X, att.Y) > c.heightAt(def.X, def.Y) {
		bonus++
	}
	d := atk + bonus + rand.Intn(3) - def.Stats.Endurance/2
	if d < 1 {
		d = 1
	}
	return d
}

// --- Player-driven actions -------------------------------------------------

// ErrInvalidAction describes why a player action was rejected.
type ErrInvalidAction struct{ Msg string }

func (e ErrInvalidAction) Error() string { return e.Msg }

// PlayerAction applies a hero action and then auto-resolves enemy turns.
// action is one of "move", "attack", "skill", "end".
func (c *Combat) PlayerAction(unitID, action string, tx, ty int, targetID string) error {
	if c.Status != "active" {
		return ErrInvalidAction{"le combat est terminé"}
	}
	cur := c.CurrentUnit()
	if cur == nil || cur.ID != unitID {
		return ErrInvalidAction{"ce n'est pas le tour de cette unité"}
	}
	if cur.Side != "hero" {
		return ErrInvalidAction{"cette unité n'est pas contrôlable"}
	}

	switch action {
	case "move":
		if cur.hasState("Root") {
			return ErrInvalidAction{cur.Name + " est entravé (Root)"}
		}
		if cur.Moved {
			return ErrInvalidAction{cur.Name + " s'est déjà déplacé ce tour"}
		}
		ok := false
		for _, t := range c.Reachable(cur) {
			if t[0] == tx && t[1] == ty {
				ok = true
				break
			}
		}
		if !ok {
			return ErrInvalidAction{"case hors de portée"}
		}
		cur.X, cur.Y = tx, ty
		cur.Moved = true
		c.logf("%s se déplace.", cur.Name)
		return nil // moving does not end the turn, but acting/ending does

	case "attack", "skill":
		def := c.unitByID(targetID)
		if def == nil || !def.Alive() || def.Side == cur.Side {
			return ErrInvalidAction{"cible invalide"}
		}
		rng := c.baseAttackRange(cur)
		ranged := rng > 1
		bonus := 0
		effect := ""
		label := "attaque"
		if action == "skill" {
			sk := c.SkillFor(cur)
			rng, ranged, effect, label = sk.Range, sk.Kind == "ranged", sk.Effect, sk.Name
			bonus = 3 // heroes' special hits harder
		}
		if manhattan(cur.X, cur.Y, def.X, def.Y) > rng {
			return ErrInvalidAction{"cible hors de portée"}
		}
		dmg := c.damage(cur, def, ranged, bonus)
		def.HP -= dmg
		c.logf("%s utilise %s sur %s (-%d PV).", cur.Name, label, def.Name, dmg)
		c.applyEffect(effect, def)
		if !def.Alive() {
			c.logf("%s est vaincu.", def.Name)
		}
		c.endTurn()
		return nil

	case "end":
		c.endTurn()
		return nil
	}
	return ErrInvalidAction{"action inconnue"}
}

func (c *Combat) applyEffect(effect string, def *CombatUnit) {
	switch effect {
	case "stun":
		def.addState("Stun")
		c.logf("%s est étourdi (Stun).", def.Name)
	case "absorb":
		def.addState("Cécité")
		c.logf("%s perd en précision (Cécité).", def.Name)
	}
}

// endTurn finishes the current unit's turn and resolves AI up to the next hero turn.
func (c *Combat) endTurn() {
	c.checkEnd()
	if c.Status != "active" {
		return
	}
	c.advanceTurn()
	c.advanceUntilHeroOrEnd()
}

// advanceTurn moves to the next living unit in initiative order, ticking states.
func (c *Combat) advanceTurn() {
	for i := 0; i < len(c.Order)+1; i++ {
		c.TurnIdx++
		if c.TurnIdx >= len(c.Order) {
			c.TurnIdx = 0
			c.Round++
		}
		u := c.CurrentUnit()
		if u == nil || !u.Alive() {
			continue
		}
		// Tick one-turn states at the start of the unit's turn.
		if u.hasState("Stun") {
			u.removeState("Stun")
			c.logf("%s se remet de l'étourdissement.", u.Name)
			continue // loses the turn
		}
		u.removeState("Cécité")
		u.Moved = false // fresh movement budget for the new turn
		return
	}
}

// advanceUntilHeroOrEnd auto-plays monster turns until a hero must act or combat ends.
func (c *Combat) advanceUntilHeroOrEnd() {
	guard := 0
	for c.Status == "active" {
		guard++
		if guard > 200 {
			break // safety against pathological loops
		}
		u := c.CurrentUnit()
		if u == nil {
			break
		}
		if u.Side == "hero" {
			return
		}
		c.monsterTurn(u)
		c.checkEnd()
		if c.Status != "active" {
			return
		}
		c.advanceTurn()
	}
}

// monsterTurn runs a simple AI: approach the nearest hero and attack if in range.
func (c *Combat) monsterTurn(u *CombatUnit) {
	target := c.nearestEnemy(u)
	if target == nil {
		return
	}
	// Decide attack range (skill sometimes for variety).
	useSkill := rand.Intn(100) < 35
	sk := c.SkillFor(u)
	rng := c.baseAttackRange(u)
	if useSkill {
		rng = sk.Range
	}
	// Step toward the target until in range or out of movement.
	steps := u.Move
	for steps > 0 && manhattan(u.X, u.Y, target.X, target.Y) > rng {
		if c.stepToward(u, target) {
			steps--
		} else {
			break
		}
	}
	if manhattan(u.X, u.Y, target.X, target.Y) <= rng {
		ranged := rng > 1
		dmg := c.damage(u, target, ranged, 0)
		target.HP -= dmg
		label := "attaque"
		if useSkill {
			label = sk.Name
		}
		c.logf("%s utilise %s sur %s (-%d PV).", u.Name, label, target.Name, dmg)
		if useSkill {
			c.applyEffect(sk.Effect, target)
		}
		if !target.Alive() {
			c.logf("%s tombe au combat.", target.Name)
		}
	} else {
		c.logf("%s avance.", u.Name)
	}
}

func (c *Combat) nearestEnemy(u *CombatUnit) *CombatUnit {
	var best *CombatUnit
	bestD := 1 << 30
	for _, o := range c.Units {
		if o.Alive() && o.Side != u.Side {
			if d := manhattan(u.X, u.Y, o.X, o.Y); d < bestD {
				bestD, best = d, o
			}
		}
	}
	return best
}

// stepToward moves u one tile closer to target, returning false if it cannot move.
func (c *Combat) stepToward(u, target *CombatUnit) bool {
	bestDX, bestDY, bestD := 0, 0, manhattan(u.X, u.Y, target.X, target.Y)
	moved := false
	for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
		nx, ny := u.X+d[0], u.Y+d[1]
		if !c.passable(nx, ny, u) {
			continue
		}
		if dd := manhattan(nx, ny, target.X, target.Y); dd < bestD {
			bestD, bestDX, bestDY, moved = dd, d[0], d[1], true
		}
	}
	if moved {
		u.X += bestDX
		u.Y += bestDY
	}
	return moved
}

func (c *Combat) checkEnd() {
	if c.aliveOnSide("monster") == 0 {
		c.Status = "won"
		c.logf("Victoire ! Les monstres sont vaincus.")
	} else if c.aliveOnSide("hero") == 0 {
		c.Status = "lost"
		c.logf("Défaite... tous les héros sont tombés.")
	}
}

func absI(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
