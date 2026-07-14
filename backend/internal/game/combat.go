package game

import (
	"fmt"
	"math/rand"
	"sort"

	"github.com/google/uuid"
)

// CombatUnit is a hero or monster instantiated on the isometric battle grid.
type CombatUnit struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Side       string   `json:"side"`  // "hero" | "monster"
	RefID      string   `json:"refId"` // source hero/monster id on the map
	Kind       string   `json:"kind"`  // species (monster) or class (hero), for art
	ClassID    string   `json:"classId,omitempty"`    // hero class id (skill selection)
	Appearance string   `json:"appearance,omitempty"` // asset file for the client
	X          int      `json:"x"`
	Y          int      `json:"y"`
	HP         int      `json:"hp"`
	MaxHP      int      `json:"maxHp"`
	Stats      Stats    `json:"stats"`
	States     []string `json:"states"`
	Move       int      `json:"move"`
	Moved      bool     `json:"moved"` // already moved this turn (FFTA2: one move per turn)
	Initiative int      `json:"initiative"`
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

// Combat abilities are AttackDefs from the design catalog (design.go): monsters use
// their species' attack list (base + specials with GDD targeting/damage grids), and
// heroes get a generic melee attack plus their class's iso skill.

// heroBaseAttack is every hero's plain melee strike.
func heroBaseAttack() AttackDef {
	return AttackDef{Name: "Attaque", Kind: "base", Targets: orthCells(), DmgStat: "force"}
}

// heroSkillFor returns the hero's class iso skill (the generic Frappe puissante for
// classless heroes and for classes whose iso ability is passive).
func heroSkillFor(classID string) AttackDef {
	switch classID {
	case "pionnier":
		return AttackDef{Name: "Frappe de la mort qui tue", Kind: "special", Desc: "Attaque puissante.", Targets: orthCells(), DmgStat: "force", Bonus: 5}
	case "chasseur":
		return AttackDef{Name: "Tir de zone", Kind: "special", Desc: "Dégâts de zone en croix.", Targets: manhattanCells(1, 3), Damage: orthCells(), DmgStat: "dexterite", Bonus: 3}
	case "gardien":
		return AttackDef{Name: "Posture défensive", Kind: "special", Desc: "-50% dégâts subis jusqu'au prochain tour.", SelfShield: true}
	default:
		return AttackDef{Name: "Frappe puissante", Kind: "special", Targets: orthCells(), DmgStat: "force", Bonus: 3}
	}
}

// monsterAttacks returns a species' attack list (with a melee fallback).
func monsterAttacks(kind string) []AttackDef {
	if sp := SpeciesByName(kind); sp != nil && len(sp.Attacks) > 0 {
		return sp.Attacks
	}
	return []AttackDef{{Name: "Attaque", Kind: "base", Targets: orthCells(), DmgStat: "force"}}
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
		appearance := ""
		if cls := ClassByID(h.ClassID); cls != nil {
			appearance = cls.Appearance.Map
		}
		u := &CombatUnit{
			ID:         uuid.NewString(),
			Name:       h.Name,
			Side:       "hero",
			RefID:      h.ID,
			Kind:       h.Class,
			ClassID:    h.ClassID,
			Appearance: appearance,
			X:          2 + i,
			Y:          gh - 1,
			HP:         h.HP,
			MaxHP:      h.MaxHP,
			Stats:      h.Stats,
			Move:       2 + h.Stats.Agilite/3,
			States:     []string{},
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
			ID:         uuid.NewString(),
			Name:       monster.Species,
			Side:       "monster",
			RefID:      monster.ID,
			Kind:       monster.Species,
			Appearance: monster.Appearance,
			X:          2 + i,
			Y:          0,
			HP:         monster.HP,
			MaxHP:      monster.MaxHP,
			Stats:      monster.Stats,
			Move:       2 + monster.Stats.Agilite/3,
			States:     []string{},
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

// TargetsFor returns the enemy units standing on the attack's green targeting cells.
func (c *Combat) TargetsFor(u *CombatUnit, atk *AttackDef) []*CombatUnit {
	var out []*CombatUnit
	for _, o := range c.Units {
		if o.Alive() && o.Side != u.Side && atk.inTargets(o.X-u.X, o.Y-u.Y) {
			out = append(out, o)
		}
	}
	return out
}

// BaseAttack / HeroSkill expose a unit's abilities to the API view layer.
func (c *Combat) BaseAttack(u *CombatUnit) AttackDef { return c.baseAttackFor(u) }
func (c *Combat) HeroSkill(u *CombatUnit) AttackDef  { return heroSkillFor(u.ClassID) }

// baseAttackFor returns a unit's plain attack (heroes: melee; monsters: their
// species' "base" attack from the design grids).
func (c *Combat) baseAttackFor(u *CombatUnit) AttackDef {
	if u.Side == "hero" {
		return heroBaseAttack()
	}
	for _, a := range monsterAttacks(u.Kind) {
		if a.Kind == "base" {
			return a
		}
	}
	return heroBaseAttack()
}

// specialsFor returns a unit's special abilities (heroes: the class iso skill).
func (c *Combat) specialsFor(u *CombatUnit) []AttackDef {
	if u.Side == "hero" {
		return []AttackDef{heroSkillFor(u.ClassID)}
	}
	var out []AttackDef
	for _, a := range monsterAttacks(u.Kind) {
		if a.Kind == "special" {
			out = append(out, a)
		}
	}
	return out
}

// damageWith computes one hit of `atk` from att onto def: the attack's damage stat
// (force/dexterite/precision), its divisor and flat bonus, high-ground bonus, the
// defender's endurance, and the -50% Bouclier state.
func (c *Combat) damageWith(att, def *CombatUnit, atk *AttackDef) int {
	var stat int
	switch atk.DmgStat {
	case "dexterite":
		stat = att.Stats.Dexterite
	case "precision":
		stat = att.Stats.Precision
	default:
		stat = att.Stats.Force
	}
	if atk.DmgDiv > 1 {
		stat /= atk.DmgDiv
	}
	bonus := atk.Bonus
	if c.heightAt(att.X, att.Y) > c.heightAt(def.X, def.Y) {
		bonus++ // high ground
	}
	d := stat + bonus + rand.Intn(3) - def.Stats.Endurance/2
	if d < 1 {
		d = 1
	}
	if def.hasState("Bouclier") {
		d /= 2
		if d < 1 {
			d = 1
		}
	}
	return d
}

// performAttack executes an AttackDef from att onto the struck cell (tx,ty): every
// enemy in the damage zone (struck cell + the attack's red grid) takes damage and
// effects. Self-targeted abilities (SelfShield/BuffAllies) ignore the target.
func (c *Combat) performAttack(att *CombatUnit, atk *AttackDef, tx, ty int) {
	if atk.SelfShield {
		att.addState("Bouclier")
		c.logf("%s utilise %s : les dégâts subis sont réduits de moitié.", att.Name, atk.Name)
		return
	}
	if atk.BuffAllies {
		n := 0
		for _, o := range c.Units {
			if o.Alive() && o != att && o.Side == att.Side && manhattan(att.X, att.Y, o.X, o.Y) == 1 {
				o.Stats.Force += 2
				n++
			}
		}
		c.logf("%s utilise %s : %d allié(s) gagnent +2 force.", att.Name, atk.Name, n)
		return
	}
	zone := append([]GridCell{{0, 0}}, atk.Damage...)
	struck := 0
	for _, z := range zone {
		def := c.unitAt(tx+z.DX, ty+z.DY)
		if def == nil || !def.Alive() || def.Side == att.Side {
			continue
		}
		struck++
		if atk.DmgStat != "" {
			dmg := c.damageWith(att, def, atk)
			def.HP -= dmg
			c.logf("%s utilise %s sur %s (-%d PV).", att.Name, atk.Name, def.Name, dmg)
			if atk.Absorb && att.Alive() {
				heal := dmg / 2
				if heal > 0 {
					att.HP += heal
					if att.HP > att.MaxHP {
						att.HP = att.MaxHP
					}
					c.logf("%s absorbe %d PV.", att.Name, heal)
				}
			}
		} else {
			c.logf("%s utilise %s sur %s.", att.Name, atk.Name, def.Name)
		}
		if def.Alive() {
			if atk.StunPct > 0 && rand.Intn(100) < atk.StunPct {
				def.addState("Stun")
				c.logf("%s est étourdi (Stun).", def.Name)
			}
			if atk.Root {
				def.addState("Root")
				c.logf("%s est entravé (Root).", def.Name)
			}
		} else {
			c.logf("%s est vaincu.", def.Name)
		}
	}
	if struck == 0 {
		c.logf("%s utilise %s dans le vide.", att.Name, atk.Name)
	}
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
		atk := c.baseAttackFor(cur)
		if action == "skill" {
			atk = heroSkillFor(cur.ClassID)
		}
		// Self abilities (Posture défensive) need no target — anything else must aim
		// at a living enemy standing on one of the attack's green targeting cells.
		if atk.SelfShield || atk.BuffAllies {
			c.performAttack(cur, &atk, cur.X, cur.Y)
			c.endTurn()
			return nil
		}
		def := c.unitByID(targetID)
		if def == nil || !def.Alive() || def.Side == cur.Side {
			return ErrInvalidAction{"cible invalide"}
		}
		if !atk.inTargets(def.X-cur.X, def.Y-cur.Y) {
			return ErrInvalidAction{"cible hors de portée"}
		}
		c.performAttack(cur, &atk, def.X, def.Y)
		c.endTurn()
		return nil

	case "end":
		c.endTurn()
		return nil
	}
	return ErrInvalidAction{"action inconnue"}
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
		u.removeState("Bouclier") // the shield holds until the owner's next turn
		u.Moved = false           // fresh movement budget for the new turn
		if u.hasState("Root") {
			u.removeState("Root")
			u.Moved = true // rooted: no movement this turn (acting is still allowed)
			c.logf("%s se libère des entraves mais ne peut pas bouger ce tour.", u.Name)
		}
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

// monsterTurn runs the monster AI: pick an attack (a special ~35% of the time),
// approach the nearest hero until it stands on one of the attack's targeting cells,
// then strike (with the attack's damage zone and effects).
func (c *Combat) monsterTurn(u *CombatUnit) {
	target := c.nearestEnemy(u)
	if target == nil {
		return
	}
	atk := c.baseAttackFor(u)
	if specials := c.specialsFor(u); len(specials) > 0 && rand.Intn(100) < 35 {
		pick := specials[rand.Intn(len(specials))]
		// Don't re-shield while already shielded; self abilities fire immediately.
		if !pick.SelfShield || !u.hasState("Bouclier") {
			atk = pick
		}
	}
	if atk.SelfShield || atk.BuffAllies {
		c.performAttack(u, &atk, u.X, u.Y)
		return
	}
	// Step toward the target until it sits on one of the attack's green cells.
	if !u.Moved {
		reach := atk.maxReach()
		for steps := u.Move; steps > 0 && manhattan(u.X, u.Y, target.X, target.Y) > reach; steps-- {
			if !c.stepToward(u, target) {
				break
			}
		}
	}
	if atk.inTargets(target.X-u.X, target.Y-u.Y) {
		c.performAttack(u, &atk, target.X, target.Y)
	} else if base := c.baseAttackFor(u); base.inTargets(target.X-u.X, target.Y-u.Y) {
		c.performAttack(u, &base, target.X, target.Y) // fall back to the base strike
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

// --- Auto-resolution (bot parties) ------------------------------------------

// AutoResolve plays every hero turn with the same simple AI as the monsters until
// the battle ends. Used when a bot-only party engages a pack: the whole fight is
// resolved server-side in one call (the caller then applies FinishCombat).
func (c *Combat) AutoResolve() {
	for guard := 0; c.Status == "active" && guard < 400; guard++ {
		u := c.CurrentUnit()
		if u == nil {
			break
		}
		if u.Side != "hero" { // defensive: monster turns normally auto-play already
			c.advanceUntilHeroOrEnd()
			continue
		}
		c.heroAutoTurn(u)
	}
}

// heroAutoTurn mirrors monsterTurn for a hero unit: close on the nearest enemy and
// strike with the class skill when it deals damage (its bonus beats a plain attack),
// falling back to the base attack.
func (c *Combat) heroAutoTurn(u *CombatUnit) {
	target := c.nearestEnemy(u)
	if target == nil {
		c.endTurn()
		return
	}
	sk := heroSkillFor(u.ClassID)
	atk := sk
	if sk.DmgStat == "" { // defensive/self skill — the bot just swings instead
		atk = c.baseAttackFor(u)
	}
	if !u.Moved {
		reach := atk.maxReach()
		for steps := u.Move; steps > 0 && manhattan(u.X, u.Y, target.X, target.Y) > reach; steps-- {
			if !c.stepToward(u, target) {
				break
			}
		}
	}
	if atk.inTargets(target.X-u.X, target.Y-u.Y) {
		c.performAttack(u, &atk, target.X, target.Y)
	} else if base := c.baseAttackFor(u); base.inTargets(target.X-u.X, target.Y-u.Y) {
		c.performAttack(u, &base, target.X, target.Y)
	} else {
		c.logf("%s avance.", u.Name)
	}
	c.endTurn()
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
