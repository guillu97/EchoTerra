package game

import (
	"fmt"
	"math/rand"
	"sort"
	"time"

	"github.com/google/uuid"
)

// TurnLimit : temps réel MAX qu'un joueur humain PRÉSENT a pour jouer son tour
// de combat avant que le serveur ne le résolve automatiquement (anti-blocage
// multijoueur). Ne s'applique qu'aux combats à ≥2 joueurs présents. Surchargé
// par ECHOTERRA_TURN_SECONDS (voir cmd/server).
var TurnLimit = 60 * time.Second

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
	Fled       bool     `json:"fled,omitempty"`    // a quitté l'arène par le bord bas (lot C3)
	OwnerID    string   `json:"ownerId,omitempty"` // joueur propriétaire du héros ("" = partie legacy)
	// Facing (lot C4) : direction regardée, mise à jour au déplacement et à
	// l'attaque — une attaque depuis l'arc ARRIÈRE fait +25 % et ignore la
	// couverture. Vecteur unitaire orthogonal (FX,FY).
	FX int `json:"fx"`
	FY int `json:"fy"`
	// Size (lot C5) : côté de l'empreinte — 2 pour un BOSS (2×2 cases, une seule
	// unité, ancre = coin haut-gauche X,Y). 0/1 = unité normale.
	Size int `json:"size,omitempty"`
}

// span renvoie le côté de l'empreinte (1 par défaut).
func (u *CombatUnit) span() int {
	if u.Size < 1 {
		return 1
	}
	return u.Size
}

// occupies : (x,y) est dans l'empreinte de l'unité.
func (u *CombatUnit) occupies(x, y int) bool {
	return x >= u.X && x < u.X+u.span() && y >= u.Y && y < u.Y+u.span()
}

// footprint : les cases occupées par l'unité.
func (u *CombatUnit) footprint() [][2]int {
	n := u.span()
	out := make([][2]int, 0, n*n)
	for dy := 0; dy < n; dy++ {
		for dx := 0; dx < n; dx++ {
			out = append(out, [2]int{u.X + dx, u.Y + dy})
		}
	}
	return out
}

// distTo : distance de Manhattan MINIMALE entre (x,y) et l'empreinte.
func (u *CombatUnit) distTo(x, y int) int {
	best := 1 << 30
	for _, cell := range u.footprint() {
		if d := manhattan(cell[0], cell[1], x, y); d < best {
			best = d
		}
	}
	return best
}

// Alive reports whether the unit still has hit points.
func (u *CombatUnit) Alive() bool { return u.HP > 0 }

// inBattle reports whether the unit still fights: alive AND not fled (lot C3 —
// un héros qui a fui est vivant mais a quitté l'arène).
func (u *CombatUnit) inBattle() bool { return u.HP > 0 && !u.Fled }

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

// heroIsoSkillsFor returns the hero's class iso-combat skills (the AttackDefs the
// combat UI turns into skill buttons). Each class has one or two signature
// abilities; classless heroes fall back to a generic Frappe puissante.
func heroIsoSkillsFor(classID string) []AttackDef {
	switch classID {
	case "pionnier":
		return []AttackDef{
			{Name: "Frappe de la mort qui tue", Kind: "special", Desc: "Attaque puissante en mêlée.", Targets: orthCells(), DmgStat: "force", Bonus: 5},
			{Name: "Coup de bouclier", Kind: "special", Desc: "Frappe étourdissante (30% Stun).", Targets: orthCells(), DmgStat: "force", Bonus: 2, StunPct: 30},
		}
	case "chasseur":
		return []AttackDef{
			{Name: "Tir de zone", Kind: "special", Desc: "Dégâts de zone en croix à distance.", Targets: manhattanCells(1, 3), Damage: orthCells(), DmgStat: "dexterite", Bonus: 3},
			{Name: "Flèche perçante", Kind: "special", Desc: "Tir précis à longue portée.", Targets: lineCells(3), DmgStat: "dexterite", Bonus: 4},
		}
	case "eclaireur":
		return []AttackDef{
			{Name: "Coup vif", Kind: "special", Desc: "Frappe rapide et sûre.", Targets: orthCells(), DmgStat: "dexterite", Bonus: 3},
		}
	case "gardien":
		return []AttackDef{
			{Name: "Posture défensive", Kind: "special", Desc: "-50% dégâts subis jusqu'au prochain tour.", SelfShield: true},
			{Name: "Provocation", Kind: "special", Desc: "Coup lourd qui entrave la cible (Root).", Targets: orthCells(), DmgStat: "force", Bonus: 2, Root: true},
		}
	case "recuperateur":
		return []AttackDef{
			{Name: "Coup de grâce", Kind: "special", Desc: "Achève brutalement un ennemi.", Targets: orthCells(), DmgStat: "force", Bonus: 4},
		}
	case "herboriste":
		return []AttackDef{
			{Name: "Aspersion acide", Kind: "special", Desc: "Nuage corrosif de zone.", Targets: manhattanCells(1, 2), Damage: orthCells(), DmgStat: "precision", Bonus: 2},
		}
	default:
		return []AttackDef{
			{Name: "Frappe puissante", Kind: "special", Desc: "Attaque renforcée en mêlée.", Targets: orthCells(), DmgStat: "force", Bonus: 3},
		}
	}
}

// heroSkillFor returns the hero's PRIMARY iso skill (index 0) — used by the AI and
// as a back-compatible single-skill accessor.
func heroSkillFor(classID string) AttackDef {
	return heroIsoSkillsFor(classID)[0]
}

// monsterAttacks returns a species' attack list (with a melee fallback).
func monsterAttacks(kind string) []AttackDef {
	if sp := SpeciesByName(kind); sp != nil && len(sp.Attacks) > 0 {
		return sp.Attacks
	}
	return []AttackDef{{Name: "Attaque", Kind: "base", Targets: orthCells(), DmgStat: "force"}}
}

// Combat is one isometric battle instance, fully server-authoritative.
// CombatCell est une case de l'arène (lot C1 du COMBAT-PLAN) : hauteur + terrain
// tactique. Blocked = rocher/arbre infranchissable (et coupe-ligne-de-vue, C4) ;
// Hazard = "water" (infranchissable), "ice" (le pas glisse d'une case) ou
// "brambles" (−1 PV en entrant, ne tue jamais).
type CombatCell struct {
	Height  int    `json:"height"`
	Blocked bool   `json:"blocked,omitempty"`
	Hazard  string `json:"hazard,omitempty"`
}

// CombatHit est un événement de dégâts/soin structuré (lot C2) : le client
// affiche des étiquettes flottantes sans avoir à parser le log texte.
type CombatHit struct {
	UnitID string `json:"unitId"`
	Amount int    `json:"amount"` // toujours > 0
	Kind   string `json:"kind"`   // "dmg" | "heal" | "hazard"
}

// CombatReward est le butin d'un héros à la victoire (écran de victoire C2).
type CombatReward struct {
	HeroID   string `json:"heroId"`
	HeroName string `json:"heroName"`
	Items    []Item `json:"items"`
}

type Combat struct {
	ID      string        `json:"id"`
	GameID  string        `json:"gameId"`
	TileX   int           `json:"tileX"`
	TileY   int           `json:"tileY"`
	Biome   Biome         `json:"biome"` // biome de la case du monde (thème d'arène)
	GridW   int           `json:"gridW"`
	GridH   int           `json:"gridH"`
	Heights []int         `json:"heights"` // row-major (compat CombatScene classique)
	Cells   []CombatCell  `json:"cells"`   // l'arène C1 (Heights = miroir des hauteurs)
	Units   []*CombatUnit `json:"units"`
	Order   []string      `json:"order"` // unit ids, by initiative desc
	TurnIdx int           `json:"turnIdx"`
	Round   int           `json:"round"`
	Status  string        `json:"status"` // "active" | "won" | "lost" | "fled" (C3)
	Log     []string      `json:"log"`
	// Lot C2 (lisibilité) : Seq s'incrémente à chaque action jouée et LastHits
	// liste les coups de CE lot d'actions (action du héros + tours IA qui suivent)
	// — le client diffe Seq pour faire flotter les dégâts. Rewards est rempli à
	// la victoire (FinishCombat) pour l'écran de fin.
	Seq      int            `json:"seq"`
	LastHits []CombatHit    `json:"lastHits,omitempty"`
	Rewards  []CombatReward `json:"rewards,omitempty"`
	// Combat multijoueur : les joueurs PRÉSENTS dans le combat. Les héros d'un
	// joueur absent (autre joueur pas encore « rejoint », bot) sont joués par
	// l'IA ; « Rejoindre le combat » ajoute le joueur et lui rend le contrôle
	// de SES héros. Vide dans les parties legacy sans joueurs (tout est manuel).
	Participants []string `json:"participants,omitempty"`
	// Lot C5 — boss & IA. Wave : la vague de la partie à l'engagement (les
	// renforts n'arrivent qu'à partir de la vague 4). ReinforceAt : round
	// d'arrivée des renforts (annoncés un round avant), 0 = pas de renforts ;
	// ReinforceDone : déjà arrivés. (L'annonce des patterns de boss un tour à
	// l'avance a été RETIRÉE le 2026-07-20 — trop simple à esquiver ; le boss
	// attaque désormais chaque tour, base ou spéciale.)
	Wave          int  `json:"wave,omitempty"`
	ReinforceAt   int  `json:"reinforceAt,omitempty"`
	ReinforceDone bool `json:"reinforceDone,omitempty"`
	// TurnDeadline : instant limite pour que le joueur humain PRÉSENT dont c'est
	// le tour agisse (multijoueur ≥2 présents). nil = pas de minuteur (tour d'IA,
	// de monstre, ou combat solo). À l'expiration, EnforceTurnTimer résout le tour.
	TurnDeadline *time.Time `json:"turnDeadline,omitempty"`
}

// hasParticipant reports whether a player is present in the combat.
func (c *Combat) hasParticipant(playerID string) bool {
	for _, p := range c.Participants {
		if p == playerID {
			return true
		}
	}
	return false
}

// AddParticipant enregistre un joueur comme présent (idempotent). À partir de
// là, les tours de SES héros attendent ses ordres au lieu d'être joués par l'IA.
func (c *Combat) AddParticipant(playerID string) {
	if playerID != "" && !c.hasParticipant(playerID) {
		c.Participants = append(c.Participants, playerID)
	}
}

// unitIsAuto : l'unité héros est pilotée par l'IA — elle appartient à un joueur
// (bot ou humain) qui n'a pas rejoint le combat. Les héros sans propriétaire
// (parties legacy) restent toujours manuels.
func (c *Combat) unitIsAuto(u *CombatUnit) bool {
	return u.Side == "hero" && u.OwnerID != "" && !c.hasParticipant(u.OwnerID)
}

// addHit enregistre un coup pour l'affichage client (plafonné : les combats
// auto-résolus des bots accumuleraient sinon des centaines d'entrées).
func (c *Combat) addHit(unitID string, amount int, kind string) {
	if amount <= 0 || len(c.LastHits) >= 64 {
		return
	}
	c.LastHits = append(c.LastHits, CombatHit{UnitID: unitID, Amount: amount, Kind: kind})
}

// buildArena génère l'arène C1 depuis le biome de la case du monde : sol et
// hauteurs thématiques, obstacles bloquants, dangers (eau/glace/ronces). Les
// rangées de spawn (y=0 monstres, y=gh-1 héros) restent toujours dégagées.
func buildArena(biome Biome, gw, gh int) []CombatCell {
	cells := make([]CombatCell, gw*gh)
	at := func(x, y int) *CombatCell { return &cells[y*gw+x] }
	// hauteurs par biome
	for y := 0; y < gh; y++ {
		for x := 0; x < gw; x++ {
			r := rand.Intn(10)
			h := 0
			switch biome {
			case 3: // forêt vallonnée
				if r >= 5 {
					h = 1
				}
				if r >= 8 {
					h = 2
				}
			case 4: // montagne : terrasses diagonales marquées
				h = (x + y + rand.Intn(2)) / 4
				if h > 3 {
					h = 3
				}
			case 1: // sable : plat
				if r >= 9 {
					h = 1
				}
			case 5: // neige : plaques douces
				if r >= 8 {
					h = 1
				}
			default: // prairie : douce (l'ancien tirage)
				if r >= 7 {
					h = 1
				}
				if r >= 9 {
					h = 2
				}
			}
			at(x, y).Height = h
		}
	}
	// dangers par biome
	switch biome {
	case 1: // langues d'eau dans un coin
		cx, cy := 0, 2+rand.Intn(gh-4)
		if rand.Intn(2) == 0 {
			cx = gw - 1
		}
		for i := 0; i < 3+rand.Intn(2); i++ {
			x, y := cx, cy+rand.Intn(2)-i%2
			if x >= 0 && x < gw && y >= 1 && y < gh-1 {
				at(x, y).Hazard = "water"
				at(x, y).Height = 0
			}
		}
	case 5: // plaques de glace
		for i := 0; i < 4+rand.Intn(3); i++ {
			x, y := rand.Intn(gw), 1+rand.Intn(gh-2)
			at(x, y).Hazard = "ice"
		}
	case 2, 3: // ronces
		for i := 0; i < 2; i++ {
			x, y := rand.Intn(gw), 2+rand.Intn(gh-4)
			at(x, y).Hazard = "brambles"
		}
	}
	// obstacles bloquants (jamais adjacents entre eux : la 7×7 reste traversante)
	nObs := 2
	if biome == 3 {
		nObs = 4
	} else if biome == 4 {
		nObs = 3
	}
	placed := [][2]int{}
	for tries := 0; tries < 40 && len(placed) < nObs; tries++ {
		x, y := rand.Intn(gw), 1+rand.Intn(gh-2)
		if at(x, y).Hazard != "" || at(x, y).Blocked {
			continue
		}
		ok := true
		for _, p := range placed {
			if absI(p[0]-x) <= 1 && absI(p[1]-y) <= 1 {
				ok = false
				break
			}
		}
		if !ok {
			continue
		}
		at(x, y).Blocked = true
		placed = append(placed, [2]int{x, y})
	}
	// rangées de spawn dégagées
	for x := 0; x < gw; x++ {
		for _, y := range []int{0, gh - 1} {
			at(x, y).Blocked = false
			at(x, y).Hazard = ""
			if at(x, y).Height > 1 {
				at(x, y).Height = 1
			}
		}
	}
	return cells
}

// NewCombat builds a battle from the heroes on a tile versus the tile's monster.
// starterID est le joueur qui ENGAGE le combat : il en est le premier participant ;
// les héros des autres joueurs présents sur la case entrent dans la bataille mais
// sont joués par l'IA tant que leur propriétaire n'a pas « rejoint » ("" = partie
// legacy sans joueurs, tout est manuel).
func NewCombat(gs *GameState, heroes []*Hero, monster *Monster, starterID string) *Combat {
	gw, gh := 7, 7
	// Lot C5 : un BOSS (Roi Gobelin, Arbre Vivant Ancien) se combat dans une
	// arène 9×9 — il occupe 2×2 cases et a besoin d'espace pour ses patterns.
	sp := SpeciesByName(monster.Species)
	boss := sp != nil && sp.Boss
	if boss {
		gw, gh = 9, 9
	}
	biome := Biome(2)
	if t := gs.TileAt(monster.X, monster.Y); t != nil {
		biome = t.Biome
	}
	cells := buildArena(biome, gw, gh)
	heights := make([]int, gw*gh)
	for i := range cells {
		heights[i] = cells[i].Height
	}

	c := &Combat{
		ID:      uuid.NewString(),
		GameID:  gs.ID,
		TileX:   monster.X,
		TileY:   monster.Y,
		Biome:   biome,
		GridW:   gw,
		GridH:   gh,
		Heights: heights,
		Cells:   cells,
		Status:  "active",
		Log:     []string{},
		Wave:    gs.WaveNumber,
	}
	// Renforts (lot C5) : à partir de la vague 4, 1-2 créatures rejoignent le
	// pack au round 3 (annoncées au round 2).
	if !boss && gs.WaveNumber >= bossWaveThreshold && monster.Count > 1 {
		c.ReinforceAt = 3
	}
	c.AddParticipant(starterID)

	// Heroes spawn on the bottom row, monsters on the top row. Avec plusieurs
	// ÉQUIPES sur la case (multijoueur) la rangée se remplit du centre vers les
	// bords — au-delà de 7 héros (largeur de l'arène) les suivants restent
	// spectateurs sur la carte.
	spawnX := []int{3, 2, 4, 1, 5, 0, 6}
	if len(heroes) > len(spawnX) {
		heroes = heroes[:len(spawnX)]
	}
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
			OwnerID:    gs.OwnerOfHero(h.ID),
			X:          spawnX[i],
			Y:          gh - 1,
			FY:         -1, // face aux monstres (rangée du haut)
			HP:         h.HP,
			MaxHP:      h.MaxHP,
			Stats:      h.Stats,
			Move:       2 + h.Stats.Agilite/3,
			States:     []string{},
		}
		c.Units = append(c.Units, u)
	}
	if boss {
		// Une SEULE unité 2×2, ancrée en haut au centre ; son empreinte et la
		// rangée devant elle sont aplanies et dégagées (pas d'obstacle collé).
		bx := gw/2 - 1
		for y := 0; y < 3; y++ {
			for x := bx - 1; x <= bx+2; x++ {
				if x >= 0 && x < gw {
					cells[y*gw+x] = CombatCell{}
					c.Heights[y*gw+x] = 0
				}
			}
		}
		c.Units = append(c.Units, &CombatUnit{
			ID:         uuid.NewString(),
			Name:       monster.Species,
			Side:       "monster",
			RefID:      monster.ID,
			Kind:       monster.Species,
			Appearance: monster.Appearance,
			X:          bx,
			Y:          0,
			FY:         1,
			Size:       2,
			HP:         monster.HP,
			MaxHP:      monster.MaxHP,
			Stats:      monster.Stats,
			Move:       2, // massif : lent
			States:     []string{},
		})
		c.computeOrder()
		c.logf("Le combat commence ! %s se dresse devant vous.", monster.Species)
		c.advanceUntilHeroOrEnd()
		return c
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
			FY:         1, // face aux héros (rangée du bas)
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
		if u.inBattle() && u.occupies(x, y) {
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
		if u.inBattle() && u.Side == side {
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
func (c *Combat) cellAt(x, y int) *CombatCell {
	if x < 0 || y < 0 || x >= c.GridW || y >= c.GridH || len(c.Cells) == 0 {
		return nil
	}
	return &c.Cells[y*c.GridW+x]
}

func (c *Combat) passable(x, y int, u *CombatUnit) bool {
	// une unité large (boss 2×2) doit poser TOUTE son empreinte, ancre en (x,y)
	for dy := 0; dy < u.span(); dy++ {
		for dx := 0; dx < u.span(); dx++ {
			cx, cy := x+dx, y+dy
			if cx < 0 || cy < 0 || cx >= c.GridW || cy >= c.GridH {
				return false
			}
			// arène C1 : rochers/arbres et eau sont infranchissables
			if cell := c.cellAt(cx, cy); cell != nil && (cell.Blocked || cell.Hazard == "water") {
				return false
			}
			if o := c.unitAt(cx, cy); o != nil && o != u {
				return false
			}
			if absI(c.heightAt(cx, cy)-c.heightAt(u.X, u.Y)) > 2 {
				return false
			}
		}
	}
	return true
}

// enterCell pose u sur (tx,ty) et applique le TERRAIN (lot C1) : la glace
// prolonge le pas d'une case dans la direction du déplacement (jusqu'à 3
// glissades si la glace s'enchaîne), les ronces piquent (−1 PV, ne tuent
// jamais). Partagé par le move joueur ET les pas de l'IA.
func (c *Combat) enterCell(u *CombatUnit, tx, ty int) {
	fromX, fromY := u.X, u.Y
	u.X, u.Y = tx, ty
	// direction dominante du déplacement (pour la glissade)
	dx, dy := 0, 0
	if absI(tx-fromX) >= absI(ty-fromY) {
		dx = signI(tx - fromX)
	} else {
		dy = signI(ty - fromY)
	}
	if dx != 0 || dy != 0 {
		u.FX, u.FY = dx, dy // le déplacement oriente l'unité (Facing, lot C4)
	}
	if u.span() > 1 {
		return // un boss est trop massif pour glisser ou craindre les ronces
	}
	for slides := 0; slides < 3 && (dx != 0 || dy != 0); slides++ {
		cell := c.cellAt(u.X, u.Y)
		if cell == nil || cell.Hazard != "ice" {
			break
		}
		nx, ny := u.X+dx, u.Y+dy
		if !c.passable(nx, ny, u) {
			break
		}
		u.X, u.Y = nx, ny
		c.logf("%s glisse sur la glace !", u.Name)
	}
	if cell := c.cellAt(u.X, u.Y); cell != nil && cell.Hazard == "brambles" && u.HP > 1 {
		u.HP--
		c.addHit(u.ID, 1, "hazard")
		c.logf("%s s'écorche dans les ronces (-1 PV).", u.Name)
	}
}

func signI(v int) int {
	if v > 0 {
		return 1
	}
	if v < 0 {
		return -1
	}
	return 0
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

// TargetsFor returns the enemy units standing on the attack's green targeting
// cells — with a clear line of sight for ranged attacks (lot C4).
func (c *Combat) TargetsFor(u *CombatUnit, atk *AttackDef) []*CombatUnit {
	var out []*CombatUnit
	for _, o := range c.Units {
		if o.inBattle() && o.Side != u.Side && c.canTarget(u, atk, o) {
			out = append(out, o)
		}
	}
	return out
}

// BaseAttack / HeroSkill / HeroSkills expose a unit's abilities to the API view layer.
func (c *Combat) BaseAttack(u *CombatUnit) AttackDef { return c.baseAttackFor(u) }
func (c *Combat) HeroSkill(u *CombatUnit) AttackDef  { return heroSkillFor(u.ClassID) }

// HeroSkills lists every iso skill of a hero unit (empty for monsters) — the
// combat UI renders one skill button per entry.
func (c *Combat) HeroSkills(u *CombatUnit) []AttackDef {
	if u.Side != "hero" {
		return nil
	}
	return heroIsoSkillsFor(u.ClassID)
}

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

// --- Lot C4 : ligne de vue, couverture, hauteur formalisée, attaque de dos ----

// hasLOS trace une ligne de Bresenham entre deux cases : un obstacle C1
// (Blocked) sur le TRAJET (extrémités exclues) coupe la ligne de vue des
// attaques à distance.
func (c *Combat) hasLOS(x0, y0, x1, y1 int) bool {
	dx, dy := absI(x1-x0), -absI(y1-y0)
	sx, sy := signI(x1-x0), signI(y1-y0)
	e := dx + dy
	x, y := x0, y0
	for {
		if x == x1 && y == y1 {
			return true
		}
		e2 := 2 * e
		if e2 >= dy {
			e += dy
			x += sx
		}
		if e2 <= dx {
			e += dx
			y += sy
		}
		if x == x1 && y == y1 {
			return true
		}
		if cell := c.cellAt(x, y); cell != nil && cell.Blocked {
			return false // une case traversée bloque le tir
		}
	}
}

// canTarget : la cible est sur une case VERTE de l'attaque ET, pour une attaque
// à distance (>1), la ligne de vue est dégagée. Utilisé par le ciblage servi,
// la validation des actions ET l'IA — personne ne tire à travers un rocher.
func (c *Combat) canTarget(att *CombatUnit, atk *AttackDef, def *CombatUnit) bool {
	// multi-cases (boss 2×2, lot C5) : la grille de ciblage s'évalue entre CHAQUE
	// case de l'attaquant et CHAQUE case de la cible — avec ligne de vue sur ce
	// segment pour les tirs (>1).
	for _, ac := range att.footprint() {
		for _, dc := range def.footprint() {
			if !atk.inTargets(dc[0]-ac[0], dc[1]-ac[1]) {
				continue
			}
			if manhattan(ac[0], ac[1], dc[0], dc[1]) > 1 && !c.hasLOS(ac[0], ac[1], dc[0], dc[1]) {
				continue
			}
			return true
		}
	}
	return false
}

// isRearAttack : l'attaquant est dans l'arc ARRIÈRE de la cible (le vecteur
// cible→attaquant s'oppose au regard de la cible) → +25 %, ignore la couverture.
func (c *Combat) isRearAttack(att, def *CombatUnit) bool {
	if def.FX == 0 && def.FY == 0 {
		return false
	}
	return (att.X-def.X)*def.FX+(att.Y-def.Y)*def.FY < 0
}

// inCover : la cible est adjacente (orth) à un obstacle situé CÔTÉ attaquant
// → −25 % sur les attaques à distance (télégraphié dans la fourchette servie).
func (c *Combat) inCover(att, def *CombatUnit) bool {
	for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
		cell := c.cellAt(def.X+d[0], def.Y+d[1])
		if cell == nil || !cell.Blocked {
			continue
		}
		// l'obstacle protège s'il est du côté d'où vient le tir
		if d[0]*(att.X-def.X)+d[1]*(att.Y-def.Y) > 0 {
			return true
		}
	}
	return false
}

// dmgMods renvoie les modificateurs C4 partagés par damageWith et
// EstimateDamage : bonus de hauteur GRADUÉ (+1 par niveau d'avantage, max +3 ;
// −1 en contre-plongée) et multiplicateur (dos +25 % ; couverture −25 % à
// distance, annulée par une attaque de dos).
func (c *Combat) dmgMods(att, def *CombatUnit) (heightBonus, mulNum, mulDen int) {
	hd := c.heightAt(att.X, att.Y) - c.heightAt(def.X, def.Y)
	if hd > 3 {
		hd = 3
	}
	if hd < -1 {
		hd = -1
	}
	mulNum, mulDen = 1, 1
	rear := def.span() == 1 && c.isRearAttack(att, def) // un boss n'a pas de dos
	if rear {
		mulNum, mulDen = mulNum*5, mulDen*4
	}
	if !rear && def.distTo(att.X, att.Y) > 1 && c.inCover(att, def) {
		mulNum, mulDen = mulNum*3, mulDen*4
	}
	return hd, mulNum, mulDen
}

// EstimateFlags expose l'attaque de dos et la couverture effective pour la
// télégraphie client (🗡 dos / 🛡 à couvert) — mêmes règles que dmgMods.
func (c *Combat) EstimateFlags(att, def *CombatUnit) (rear, cover bool) {
	rear = def.span() == 1 && c.isRearAttack(att, def)
	cover = !rear && def.distTo(att.X, att.Y) > 1 && c.inCover(att, def)
	return
}

// damageWith computes one hit of `atk` from att onto def: the attack's damage stat
// (force/dexterite/precision), its divisor and flat bonus, the C4 modifiers
// (graded height, rear +25%, ranged cover −25%), the defender's endurance, and
// the -50% Bouclier state.
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
	hd, num, den := c.dmgMods(att, def)
	d := stat + atk.Bonus + hd + rand.Intn(3) - def.Stats.Endurance/2
	if d < 1 {
		d = 1
	}
	d = d * num / den
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

// EstimateDamage renvoie la fourchette [min,max] des dégâts de atk sur def —
// le miroir EXACT de damageWith sans le tirage aléatoire (rand.Intn(3) ∈ 0..2).
// Servie par combatResponse pour la prévisualisation d'attaque (lot C2) : le
// serveur calcule, le client ne fait qu'afficher.
func (c *Combat) EstimateDamage(att, def *CombatUnit, atk *AttackDef) (int, int) {
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
	hd, num, den := c.dmgMods(att, def) // mêmes modificateurs C4 que damageWith
	base := stat + atk.Bonus + hd - def.Stats.Endurance/2
	clamp := func(d int) int {
		if d < 1 {
			d = 1
		}
		d = d * num / den
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
	return clamp(base), clamp(base + 2)
}

// ThreatCells renvoie les cases que l'unité peut frapper depuis sa position
// (union des grilles de ciblage de ses attaques, hors capacités sur soi) —
// la télégraphie ORANGE du lot C2 côté client.
func (c *Combat) ThreatCells(u *CombatUnit) [][2]int {
	attacks := append([]AttackDef{c.baseAttackFor(u)}, c.specialsFor(u)...)
	seen := map[[2]int]bool{}
	var out [][2]int
	for i := range attacks {
		a := &attacks[i]
		if a.SelfShield || a.BuffAllies || a.DmgStat == "" {
			continue
		}
		// multi-cases (boss 2×2) : la menace s'évalue depuis CHAQUE case de
		// l'empreinte — l'ancre seule sous-estimerait la portée réelle.
		for _, fc := range u.footprint() {
			for _, t := range a.Targets {
				// la zone de dégâts ROUGE autour de chaque case visée est toujours incluse
				zone := append([]GridCell{{0, 0}}, a.Damage...)
				for _, z := range zone {
					x, y := fc[0]+t.DX+z.DX, fc[1]+t.DY+z.DY
					if x < 0 || y < 0 || x >= c.GridW || y >= c.GridH {
						continue
					}
					key := [2]int{x, y}
					if !seen[key] {
						seen[key] = true
						out = append(out, key)
					}
				}
			}
		}
	}
	return out
}

// performAttack executes an AttackDef from att onto the struck cell (tx,ty): every
// enemy in the damage zone (struck cell + the attack's red grid) takes damage and
// effects. Self-targeted abilities (SelfShield/BuffAllies) ignore the target.
func (c *Combat) performAttack(att *CombatUnit, atk *AttackDef, tx, ty int) {
	// attaquer oriente l'attaquant vers la case frappée (Facing, lot C4)
	if dx, dy := tx-att.X, ty-att.Y; dx != 0 || dy != 0 {
		if absI(dx) >= absI(dy) {
			att.FX, att.FY = signI(dx), 0
		} else {
			att.FX, att.FY = 0, signI(dy)
		}
	}
	if atk.SelfShield {
		att.addState("Bouclier")
		c.logf("%s utilise %s : les dégâts subis sont réduits de moitié.", att.Name, atk.Name)
		return
	}
	if atk.BuffAllies {
		n := 0
		for _, o := range c.Units {
			if o.inBattle() && o != att && o.Side == att.Side && manhattan(att.X, att.Y, o.X, o.Y) == 1 {
				o.Stats.Force += 2
				n++
			}
		}
		c.logf("%s utilise %s : %d allié(s) gagnent +2 force.", att.Name, atk.Name, n)
		return
	}
	zone := append([]GridCell{{0, 0}}, atk.Damage...)
	struck := 0
	hitOnce := map[*CombatUnit]bool{} // un boss 2×2 sous plusieurs cases de zone n'est frappé qu'une fois
	for _, z := range zone {
		def := c.unitAt(tx+z.DX, ty+z.DY)
		if def == nil || !def.Alive() || def.Side == att.Side || hitOnce[def] {
			continue
		}
		hitOnce[def] = true
		struck++
		if atk.DmgStat != "" {
			dmg := c.damageWith(att, def, atk)
			def.HP -= dmg
			c.addHit(def.ID, dmg, "dmg")
			c.logf("%s utilise %s sur %s (-%d PV).", att.Name, atk.Name, def.Name, dmg)
			if atk.Absorb && att.Alive() {
				heal := dmg / 2
				if heal > 0 {
					att.HP += heal
					if att.HP > att.MaxHP {
						att.HP = att.MaxHP
					}
					c.addHit(att.ID, heal, "heal")
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
// action is one of "move", "attack", "skill", "defend", "push", "flee", "end".
// The optional skillIdx selects WHICH iso skill for action=="skill" (default 0).
func (c *Combat) PlayerAction(unitID, action string, tx, ty int, targetID string, skillIdx ...int) error {
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
	// Nouveau lot d'action (C2) : le client diffe Seq et fait flotter les coups de
	// LastHits — l'action du héros ET les tours IA qui s'enchaînent derrière.
	c.Seq++
	c.LastHits = nil

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
		c.logf("%s se déplace.", cur.Name)
		c.enterCell(cur, tx, ty)
		cur.Moved = true
		return nil // moving does not end the turn, but acting/ending does

	case "attack", "skill":
		atk := c.baseAttackFor(cur)
		if action == "skill" {
			skills := heroIsoSkillsFor(cur.ClassID)
			idx := 0
			if len(skillIdx) > 0 {
				idx = skillIdx[0]
			}
			if idx < 0 || idx >= len(skills) {
				return ErrInvalidAction{"compétence inconnue"}
			}
			atk = skills[idx]
		}
		// Self abilities (Posture défensive) need no target — anything else must aim
		// at a living enemy standing on one of the attack's green targeting cells.
		if atk.SelfShield || atk.BuffAllies {
			c.performAttack(cur, &atk, cur.X, cur.Y)
			c.endTurn()
			return nil
		}
		def := c.unitByID(targetID)
		if def == nil || !def.inBattle() || def.Side == cur.Side {
			return ErrInvalidAction{"cible invalide"}
		}
		if !c.canTarget(cur, &atk, def) {
			return ErrInvalidAction{"cible hors de portée ou hors de vue"}
		}
		c.performAttack(cur, &atk, def.X, def.Y)
		c.endTurn()
		return nil

	case "defend":
		// Lot C3 : le Defend générique (pending §9.3) — réutilise le Bouclier de la
		// Posture défensive (-50 % subis, consommé au début du prochain tour du héros).
		cur.addState("Bouclier")
		c.logf("%s se met en garde : dégâts subis réduits de moitié jusqu'à son prochain tour.", cur.Name)
		c.endTurn()
		return nil

	case "push":
		// Lot C3 : Poussée — 0 dégât, déplace la cible d'1 case dans l'axe.
		// Portée 1 orthogonale (2 pour le Pionnier : « Poussée du Survivant »).
		def := c.unitByID(targetID)
		if def == nil || !def.inBattle() || def.Side == cur.Side {
			return ErrInvalidAction{"cible invalide"}
		}
		if def.span() > 1 {
			return ErrInvalidAction{def.Name + " est bien trop massif pour être poussé"}
		}
		dx, dy := def.X-cur.X, def.Y-cur.Y
		rng := 1
		if cur.ClassID == "pionnier" {
			rng = 2
		}
		aligned := (dx == 0 && absI(dy) >= 1 && absI(dy) <= rng) || (dy == 0 && absI(dx) >= 1 && absI(dx) <= rng)
		if !aligned {
			return ErrInvalidAction{"cible hors de portée de poussée"}
		}
		c.pushUnit(cur, def, signI(dx), signI(dy))
		c.endTurn()
		return nil

	case "flee":
		// Lot C3 : fuite — le héros doit avoir rejoint le bord bas de l'arène.
		if cur.Y != c.GridH-1 {
			return ErrInvalidAction{"rejoins le bord bas de l'arène pour fuir"}
		}
		cur.Fled = true
		c.logf("%s fuit le combat !", cur.Name)
		c.endTurn()
		return nil

	case "end":
		c.endTurn()
		return nil
	}
	return ErrInvalidAction{"action inconnue"}
}

// pushUnit (lot C3) : pousse def d'une case dans la direction (dx,dy).
// Collision avec un bord d'arène, un obstacle, un mur de terrain (montée ≥2) ou
// une autre unité = 2 dégâts (aux DEUX unités en cas de télescopage) ; poussée
// dans l'eau = la cible y reste, piégée un tour (Root) ; chute ≥2 niveaux =
// +2 dégâts ; sinon le déplacement passe par enterCell (glace et ronces
// s'appliquent aussi aux poussées).
func (c *Combat) pushUnit(att, def *CombatUnit, dx, dy int) {
	fromH := c.heightAt(def.X, def.Y)
	nx, ny := def.X+dx, def.Y+dy
	blocked := nx < 0 || ny < 0 || nx >= c.GridW || ny >= c.GridH
	if !blocked {
		if cell := c.cellAt(nx, ny); cell != nil && cell.Blocked {
			blocked = true
		}
		if c.heightAt(nx, ny)-fromH >= 2 {
			blocked = true // un mur de terrain arrête la poussée comme un obstacle
		}
	}
	hurt := func(u *CombatUnit, dmg int) {
		u.HP -= dmg
		c.addHit(u.ID, dmg, "dmg")
		if !u.Alive() {
			c.logf("%s est vaincu.", u.Name)
		}
	}
	if blocked {
		hurt(def, 2)
		c.logf("%s pousse %s contre un obstacle (-2 PV).", att.Name, def.Name)
		return
	}
	if other := c.unitAt(nx, ny); other != nil {
		hurt(def, 2)
		hurt(other, 2)
		c.logf("%s pousse %s sur %s (-2 PV chacun).", att.Name, def.Name, other.Name)
		return
	}
	if cell := c.cellAt(nx, ny); cell != nil && cell.Hazard == "water" {
		def.X, def.Y = nx, ny
		def.addState("Root")
		c.logf("%s pousse %s à l'eau — piégé un tour !", att.Name, def.Name)
		return
	}
	c.logf("%s pousse %s.", att.Name, def.Name)
	c.enterCell(def, nx, ny)
	if fall := fromH - c.heightAt(def.X, def.Y); fall >= 2 {
		hurt(def, 2)
		c.logf("%s chute de %d niveaux (-2 PV).", def.Name, fall)
	}
}

// PushTargets renvoie les ennemis poussables par u : alignés orthogonalement à
// portée 1 (2 pour le Pionnier). Servi par combatResponse comme les autres cibles.
func (c *Combat) PushTargets(u *CombatUnit) []*CombatUnit {
	rng := 1
	if u.ClassID == "pionnier" {
		rng = 2
	}
	var out []*CombatUnit
	for _, o := range c.Units {
		if !o.inBattle() || o.Side == u.Side || o.span() > 1 {
			continue // un boss ne se pousse pas
		}
		dx, dy := o.X-u.X, o.Y-u.Y
		if (dx == 0 && absI(dy) >= 1 && absI(dy) <= rng) || (dy == 0 && absI(dx) >= 1 && absI(dx) <= rng) {
			out = append(out, o)
		}
	}
	return out
}

// combatConsumables : les objets du sac utilisables EN COMBAT (lot C3 — premier
// pas du chantier « consommation d'objets » du design) et leurs PV rendus.
var combatConsumables = map[string]int{
	"Potion de soin": 5,
	"Baume de gelée": 3,
	"Ration d'eau":   2,
	"Baies":          2,
}

// CombatHeal renvoie les PV rendus par un objet en combat (0 = inutilisable).
func CombatHeal(name string) int { return combatConsumables[name] }

// UseItem (lot C3) : le héros consomme un objet de SON sac (1 action, termine le
// tour). L'objet est retiré du sac immédiatement — le sac vit dans GameState,
// d'où le paramètre g (l'appelant tient déjà le verrou de la partie).
func (c *Combat) UseItem(g *GameState, unitID, itemName string) error {
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
	heal := CombatHeal(itemName)
	if heal <= 0 {
		return ErrInvalidAction{"cet objet ne s'utilise pas en combat"}
	}
	h := g.HeroByID(cur.RefID)
	if h == nil || heroItemQty(h, itemName) < 1 {
		return ErrInvalidAction{"pas de « " + itemName + " » dans le sac"}
	}
	removeHeroItem(h, itemName, 1)
	c.Seq++
	c.LastHits = nil
	if cur.HP+heal > cur.MaxHP {
		heal = cur.MaxHP - cur.HP
	}
	cur.HP += heal
	c.addHit(cur.ID, heal, "heal")
	c.logf("%s consomme %s (+%d PV).", cur.Name, itemName, heal)
	c.endTurn()
	return nil
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
	c.TurnDeadline = nil // nouveau tour : le minuteur humain est réarmé au besoin
	for i := 0; i < len(c.Order)+1; i++ {
		c.TurnIdx++
		if c.TurnIdx >= len(c.Order) {
			c.TurnIdx = 0
			c.Round++
			c.roundTick() // lot C5 : annonce/arrivée des renforts
		}
		u := c.CurrentUnit()
		if u == nil || !u.inBattle() {
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
			if !c.unitIsAuto(u) {
				c.armTurnTimer(u) // joueur présent : arme le minuteur si multijoueur
				return            // on attend ses ordres
			}
			// Héros d'un joueur absent (bot, ou humain n'ayant pas rejoint le
			// combat) : l'IA joue son tour comme celui d'un monstre.
			c.heroAutoAct(u)
		} else {
			c.monsterTurn(u)
		}
		c.checkEnd()
		if c.Status != "active" {
			return
		}
		c.advanceTurn()
	}
}

// sharedHumanCombat : ≥2 joueurs humains PRÉSENTS (participants) dans le combat.
// C'est la seule situation où un tour peut faire attendre quelqu'un → minuteur.
// (Un seul présent = expérience solo, pas de course ; les héros des absents sont
// déjà joués par l'IA.)
func (c *Combat) sharedHumanCombat() bool {
	return len(c.Participants) >= 2
}

// armTurnTimer pose l'échéance du tour pour un héros contrôlé par un humain
// présent, uniquement en combat partagé (≥2 présents) et si non déjà armé.
func (c *Combat) armTurnTimer(u *CombatUnit) {
	if u.OwnerID == "" || c.TurnDeadline != nil || !c.sharedHumanCombat() {
		return
	}
	d := time.Now().Add(TurnLimit)
	c.TurnDeadline = &d
}

// EnforceTurnTimer résout automatiquement le tour courant si le joueur présent
// dont c'est le tour a laissé son échéance expirer (anti-blocage multijoueur) :
// l'IA joue son héros puis le tour passe. Renvoie true si l'état a changé.
func (c *Combat) EnforceTurnTimer(now time.Time) bool {
	if c.Status != "active" || c.TurnDeadline == nil || now.Before(*c.TurnDeadline) {
		return false
	}
	u := c.CurrentUnit()
	if u == nil || u.Side != "hero" || c.unitIsAuto(u) {
		c.TurnDeadline = nil // échéance obsolète (l'unité a changé) : on la purge
		return false
	}
	c.logf("%s a dépassé le temps de réflexion — l'action est jouée automatiquement.", u.Name)
	c.LastHits = nil
	c.heroAutoAct(u) // l'IA joue le tour du joueur AFK
	c.Seq++          // les clients diffent Seq → ils rafraîchissent/animent
	c.endTurn()      // avance (réarme le minuteur du prochain humain)
	return true
}

// EnforceCombatTimers applique le minuteur de tour à tous les combats actifs de
// la partie (scheduler + accès HTTP paresseux). Renvoie true si un combat a
// changé → l'appelant doit persister.
func (gs *GameState) EnforceCombatTimers(now time.Time) bool {
	changed := false
	for _, c := range gs.Combats {
		if c != nil && c.EnforceTurnTimer(now) {
			changed = true
		}
	}
	return changed
}

// monsterTurn runs the monster AI: pick an attack (a special ~35% of the time),
// approach the nearest hero until it stands on one of the attack's targeting cells,
// then strike (with the attack's damage zone and effects).
func (c *Combat) monsterTurn(u *CombatUnit) {
	if u.span() > 1 {
		c.bossTurn(u)
		return
	}
	// IA de meute (lot C5) : focus-fire sur l'ennemi le plus blessé.
	target := c.packTarget(u)
	if target == nil {
		return
	}
	// Retraite : sous 25 % de PV, la créature recule d'un pas avant d'agir.
	if u.HP*4 < u.MaxHP && !u.Moved {
		if c.stepAway(u, target) {
			c.logf("%s recule, blessé.", u.Name)
		}
	}
	atk := c.baseAttackFor(u)
	specials := c.specialsFor(u)
	isBuffer := false
	for i := range specials {
		if specials[i].BuffAllies {
			isBuffer = true
		}
	}
	if len(specials) > 0 && rand.Intn(100) < 35 {
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
	// Step toward the target until it can actually be HIT : case verte ET ligne
	// de vue dégagée (lot C4) — l'IA continue d'avancer pour débloquer son tir.
	// Le BUFFEUR (Hurlement de Meute) reste derrière : il n'approche pas tant
	// qu'un allié est plus proche de l'ennemi que lui.
	holdBack := isBuffer && c.allyCloserThan(u, target)
	if !u.Moved && !holdBack && u.HP*4 >= u.MaxHP {
		for steps := u.Move; steps > 0 && !c.canTarget(u, &atk, target); steps-- {
			if !c.stepToward(u, target) {
				break
			}
		}
	}
	if c.canTarget(u, &atk, target) {
		c.performAttack(u, &atk, target.X, target.Y)
	} else if base := c.baseAttackFor(u); c.canTarget(u, &base, target) {
		c.performAttack(u, &base, target.X, target.Y) // fall back to the base strike
	} else if holdBack {
		c.logf("%s reste en retrait.", u.Name)
	} else {
		c.logf("%s avance.", u.Name)
	}
}

// bossTurn (lot C5, révisé 2026-07-20) : le boss ATTAQUE à chaque tour — soit
// son attaque de base, soit une SPÉCIALE de zone (~40 %, immédiate, avec sa
// grille de dégâts GDD). L'annonce un tour à l'avance a été retirée : elle
// offrait un tour gratuit et s'esquivait à l'infini (retour utilisateur). La
// lecture du danger passe par la télégraphie C2 (tap sur le boss → cases
// menacées, zones de dégâts incluses).
func (c *Combat) bossTurn(u *CombatUnit) {
	target := c.packTarget(u)
	if target == nil {
		return
	}
	base := c.baseAttackFor(u)
	if !u.Moved {
		for steps := u.Move; steps > 0 && !c.canTarget(u, &base, target); steps-- {
			if !c.stepToward(u, target) {
				break
			}
		}
	}
	// ~40 % : une spéciale OFFENSIVE (zone GDD appliquée autour de la cible)
	var zone *AttackDef
	specials := c.specialsFor(u)
	for i := range specials {
		sp := &specials[i]
		if sp.DmgStat != "" && !sp.SelfShield && !sp.BuffAllies {
			zone = sp
			break
		}
	}
	if zone != nil && rand.Intn(100) < 40 && c.canTarget(u, zone, target) {
		c.performAttack(u, zone, target.X, target.Y)
		return
	}
	if c.canTarget(u, &base, target) {
		c.performAttack(u, &base, target.X, target.Y)
	} else {
		c.logf("%s avance pesamment.", u.Name)
	}
}

// packTarget (lot C5) : focus-fire — l'ennemi le plus BLESSÉ, le plus proche à
// égalité de PV.
func (c *Combat) packTarget(u *CombatUnit) *CombatUnit {
	var best *CombatUnit
	bestScore := 1 << 30
	for _, o := range c.Units {
		if !o.inBattle() || o.Side == u.Side {
			continue
		}
		score := o.HP*100 + o.distTo(u.X, u.Y)
		if score < bestScore {
			bestScore, best = score, o
		}
	}
	return best
}

// allyCloserThan : un allié (hors buffeur) est plus proche de la cible que u.
func (c *Combat) allyCloserThan(u, target *CombatUnit) bool {
	d := target.distTo(u.X, u.Y)
	for _, o := range c.Units {
		if o != u && o.inBattle() && o.Side == u.Side && target.distTo(o.X, o.Y) < d {
			return true
		}
	}
	return false
}

// stepAway (lot C5) : recule d'une case en s'éloignant de la menace.
func (c *Combat) stepAway(u, threat *CombatUnit) bool {
	bestDX, bestDY, bestD := 0, 0, threat.distTo(u.X, u.Y)
	moved := false
	for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
		nx, ny := u.X+d[0], u.Y+d[1]
		if !c.passable(nx, ny, u) {
			continue
		}
		if dd := threat.distTo(nx, ny); dd > bestD {
			bestD, bestDX, bestDY, moved = dd, d[0], d[1], true
		}
	}
	if moved {
		c.enterCell(u, u.X+bestDX, u.Y+bestDY)
	}
	return moved
}

// roundTick (lot C5) : annonce (round R−1) puis fait entrer (round R) les
// renforts par le bord monstre.
func (c *Combat) roundTick() {
	if c.ReinforceAt == 0 || c.ReinforceDone || c.Status != "active" {
		return
	}
	if c.Round == c.ReinforceAt-1 {
		c.logf("Des renforts ennemis approchent — ils surgiront au prochain round !")
	}
	if c.Round >= c.ReinforceAt {
		c.spawnReinforcements()
	}
}

func (c *Combat) spawnReinforcements() {
	c.ReinforceDone = true
	var tpl *CombatUnit
	for _, u := range c.Units {
		if u.Side == "monster" {
			tpl = u
			break
		}
	}
	if tpl == nil {
		return
	}
	n := 1 + rand.Intn(2)
	spawned := 0
	for x := 0; x < c.GridW && spawned < n; x++ {
		cell := c.cellAt(x, 0)
		if c.unitAt(x, 0) != nil || (cell != nil && (cell.Blocked || cell.Hazard == "water")) {
			continue
		}
		nu := &CombatUnit{
			ID: uuid.NewString(), Name: tpl.Name, Side: "monster", RefID: tpl.RefID,
			Kind: tpl.Kind, Appearance: tpl.Appearance, X: x, Y: 0, FY: 1,
			HP: tpl.MaxHP, MaxHP: tpl.MaxHP, Stats: tpl.Stats, Move: tpl.Move, States: []string{},
		}
		c.Units = append(c.Units, nu)
		c.Order = append(c.Order, nu.ID)
		spawned++
	}
	if spawned > 0 {
		c.logf("%d renfort(s) ennemis surgissent par le nord !", spawned)
	}
}

func (c *Combat) nearestEnemy(u *CombatUnit) *CombatUnit {
	var best *CombatUnit
	bestD := 1 << 30
	for _, o := range c.Units {
		if o.inBattle() && o.Side != u.Side {
			if d := manhattan(u.X, u.Y, o.X, o.Y); d < bestD {
				bestD, best = d, o
			}
		}
	}
	return best
}

// stepToward moves u one tile closer to target, returning false if it cannot
// move. Contournement (lot C4) : à distance égale, l'IA préfère la case située
// dans l'arc ARRIÈRE de la cible (attaque de dos +25 %).
func (c *Combat) stepToward(u, target *CombatUnit) bool {
	score := func(x, y int) int {
		s := manhattan(x, y, target.X, target.Y) * 4
		if (x-target.X)*target.FX+(y-target.Y)*target.FY < 0 {
			s-- // derrière la cible
		}
		return s
	}
	bestDX, bestDY, bestS := 0, 0, score(u.X, u.Y)
	moved := false
	for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
		nx, ny := u.X+d[0], u.Y+d[1]
		if !c.passable(nx, ny, u) {
			continue
		}
		if s := score(nx, ny); s < bestS {
			bestS, bestDX, bestDY, moved = s, d[0], d[1], true
		}
	}
	if moved {
		c.enterCell(u, u.X+bestDX, u.Y+bestDY) // l'IA subit aussi glace et ronces
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
	c.heroAutoAct(u)
	c.endTurn()
}

// heroAutoAct joue l'action du tour SANS le clore — utilisé par heroAutoTurn
// (AutoResolve des parties 100 % bots) et par advanceUntilHeroOrEnd pour les
// héros des joueurs absents du combat (l'appelant gère checkEnd/advanceTurn,
// sinon la récursion endTurn→advanceUntilHeroOrEnd s'empilerait).
func (c *Combat) heroAutoAct(u *CombatUnit) {
	target := c.nearestEnemy(u)
	if target == nil {
		return
	}
	sk := heroSkillFor(u.ClassID)
	atk := sk
	if sk.DmgStat == "" { // defensive/self skill — the bot just swings instead
		atk = c.baseAttackFor(u)
	}
	if !u.Moved {
		for steps := u.Move; steps > 0 && !c.canTarget(u, &atk, target); steps-- {
			if !c.stepToward(u, target) {
				break
			}
		}
	}
	if c.canTarget(u, &atk, target) {
		c.performAttack(u, &atk, target.X, target.Y)
	} else if base := c.baseAttackFor(u); c.canTarget(u, &base, target) {
		c.performAttack(u, &base, target.X, target.Y)
	} else {
		c.logf("%s avance.", u.Name)
	}
}

func (c *Combat) checkEnd() {
	if c.aliveOnSide("monster") == 0 {
		c.Status = "won"
		c.logf("Victoire ! Les monstres sont vaincus.")
	} else if c.aliveOnSide("hero") == 0 {
		// Plus aucun héros au combat : s'il reste des fuyards VIVANTS c'est une
		// fuite d'équipe (lot C3 — pas de butin, le pack reste), sinon la défaite.
		fled := false
		for _, u := range c.Units {
			if u.Side == "hero" && u.Alive() && u.Fled {
				fled = true
				break
			}
		}
		if fled {
			c.Status = "fled"
			c.logf("L'équipe se replie — le combat est rompu.")
		} else {
			c.Status = "lost"
			c.logf("Défaite... tous les héros sont tombés.")
		}
	}
}

func absI(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
