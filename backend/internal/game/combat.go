package game

import (
	"fmt"
	"sort"
	"strings"
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
	Side       string   `json:"side"`                 // "hero" | "monster"
	RefID      string   `json:"refId"`                // source hero/monster id on the map
	Kind       string   `json:"kind"`                 // species (monster) or class (hero), for art
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
	Acted      bool     `json:"acted"` // already spent its ACTION this turn (attaque/compétence/objet…)
	// Sight : portée de vision (combatsight.go), dérivée de la Précision. Servie au
	// client pour qu'il puisse peindre le champ de vision de l'unité active.
	Sight int `json:"sight,omitempty"`
	// Spotted : rounds restants de marquage par « Éclairer » — l'unité est visible de
	// toute l'équipe adverse à l'Éclaireur, où qu'elle soit.
	Spotted int `json:"spotted,omitempty"`
	Initiative int      `json:"initiative"`
	// Cooldowns : tours restants avant de pouvoir rejouer chaque capacité, par NOM
	// d'attaque. Décrémenté au début du tour de l'unité (advanceTurn). Absent de la
	// carte = disponible.
	Cooldowns map[string]int `json:"cooldowns,omitempty"`
	Fled       bool     `json:"fled,omitempty"`    // a quitté l'arène par le bord bas (lot C3)
	OwnerID    string   `json:"ownerId,omitempty"` // joueur propriétaire du héros ("" = partie legacy)
	// Facing (lot C4) : direction regardée, mise à jour au déplacement et à
	// l'attaque — une attaque depuis l'arc ARRIÈRE fait +25 % et ignore la
	// couverture. Vecteur unitaire orthogonal (FX,FY).
	FX int `json:"fx"`
	FY int `json:"fy"`
	// ÉQUIPEMENT PRÊTÉ (equipment.go) : ce que l'arme et la cape/armure du héros
	// apportent, valable le temps de CE combat. Jamais greffé sur le héros lui-même.
	Armor      int    `json:"armor,omitempty"`      // dégâts subis en moins (plancher 1)
	Reach      int    `json:"reach,omitempty"`      // portée de l'attaque de base (0 = mêlée)
	VsCursed   int    `json:"vsCursed,omitempty"`   // bonus contre les créatures maudites
	RangedStat string `json:"rangedStat,omitempty"` // stat de dégâts d'une arme à distance
	// L'ARME PORTÉE (weapons.go) : son nom pour l'interface, son ARCHÉTYPE pour la
	// technique de combat qu'elle donne ET pour le modèle voxel tenu par le rig — un
	// héros à l'arc ne doit pas faucher de l'épée.
	WeaponName string `json:"weaponName,omitempty"`
	WeaponKind string `json:"weaponKind,omitempty"`
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

// --- Économie du TOUR : un déplacement, une action, et des recharges ---------
//
// Trois règles, et elles se complètent :
//
//  1. UN DÉPLACEMENT (`Moved`) — la règle FFTA2 d'origine, déjà en place.
//  2. UNE ACTION (`Acted`) — frapper, lancer une compétence, se défendre, pousser,
//     boire, dégainer. Nouveauté : l'action ne CLÔT plus le tour d'office. Tant
//     qu'il reste le déplacement, on peut frapper PUIS reculer (l'arc et la lance
//     n'avaient aucune façon de décrocher) ; le tour se ferme tout seul dès que les
//     deux budgets sont dépensés, donc le classique « j'avance et je tape » ne
//     coûte pas un clic de plus qu'avant.
//  3. DES RECHARGES (`Cooldowns`) — voir AttackDef.Cooldown. Sans elles, « une
//     action par tour » ne limitait rien : c'était une action, TOUJOURS la même.

// cooldownLeft rend le nombre de tours restants avant que u puisse rejouer atk.
func (u *CombatUnit) cooldownLeft(atk *AttackDef) int {
	if atk == nil || atk.Cooldown <= 0 || u.Cooldowns == nil {
		return 0
	}
	return u.Cooldowns[atk.Name]
}

// ready : la capacité est disponible ce tour.
func (u *CombatUnit) ready(atk *AttackDef) bool { return u.cooldownLeft(atk) == 0 }

// CooldownLeftOf expose la recharge restante à la couche API (combatResponse).
func (u *CombatUnit) CooldownLeftOf(atk *AttackDef) int { return u.cooldownLeft(atk) }

// startCooldown met atk en recharge après usage.
func (u *CombatUnit) startCooldown(atk *AttackDef) {
	if atk == nil || atk.Cooldown <= 0 {
		return
	}
	if u.Cooldowns == nil {
		u.Cooldowns = map[string]int{}
	}
	u.Cooldowns[atk.Name] = atk.Cooldown
}

// tickCooldowns fait passer un tour à toutes les recharges de l'unité (appelé au
// DÉBUT de son propre tour : une recharge se compte en tours de l'unité, pas en
// rounds — sinon une unité rapide et une unité lente ne paieraient pas le même prix).
func (u *CombatUnit) tickCooldowns() {
	for name, left := range u.Cooldowns {
		if left <= 1 {
			delete(u.Cooldowns, name)
		} else {
			u.Cooldowns[name] = left - 1
		}
	}
}

// climbLimit : l'écart de hauteur qu'une unité peut franchir d'un pas.
//
// C'EST LA RAISON D'ÊTRE DE L'ATHLÉTISME. La statistique existait dans le modèle,
// s'affichait sur la fiche de personnage, et TROIS classes sur six la donnaient
// comme bonus principal (+5 pour l'éclaireur, le récupérateur et l'herboriste) —
// pour un effet strictement nul : aucune ligne de code ne la lisait, ni au combat
// ni sur la carte. Ces trois classes échangeaient donc leurs points contre rien.
// Elle porte désormais la MOBILITÉ VERTICALE : grimper la terrasse, c'est prendre
// la hauteur, et la hauteur donne déjà un bonus de dégâts (dmgMods). L'athlète ne
// frappe pas plus fort, il arrive là où les autres ne montent pas.
// ⚠ MÊME FORMULE QUE LA CARTE (climb.go) : un seul diviseur, deux planchers. Le
// joueur n'a qu'une règle à apprendre, et l'arène garde son plancher de 2 — la
// valeur qui y était codée en dur, donc personne ne perd de terrain jouable.
func (u *CombatUnit) climbLimit() int { return climbFrom(u.Stats.Athletisme, arenaClimbBase) }

// critPct : chance de coup critique (×1.5 dégâts), en pourcentage.
//
// C'EST LA RAISON D'ÊTRE DE LA PRÉCISION. Elle ne servait que de statistique de
// dégâts à DEUX capacités (l'Aspersion acide de l'herboriste et le Balayage du
// bâton) — c'est-à-dire une seconde Force sous un autre nom, invisible pour tous
// les autres héros. Le jeu n'a pas de jet de toucher (et ne doit pas en avoir :
// rater son tour dans un jeu où l'on joue deux fois par jour est une punition),
// donc la précision achète le COUP CRITIQUE : une pointe de dégâts, télégraphiée
// dans la fourchette servie au client, jamais un échec.
func (u *CombatUnit) critPct() int {
	p := 3 * u.Stats.Precision
	if p > 40 {
		p = 40
	}
	if p < 0 {
		p = 0
	}
	return p
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
			{Name: "Frappe de la mort qui tue", Kind: "special", Desc: "Attaque puissante en mêlée.", Targets: orthCells(), DmgStat: "force", Bonus: 5, Cooldown: 3},
			{Name: "Coup de bouclier", Kind: "special", Desc: "Frappe étourdissante (30% Stun).", Targets: orthCells(), DmgStat: "force", Bonus: 2, StunPct: 30, Cooldown: 2},
		}
	case "chasseur":
		return []AttackDef{
			{Name: "Tir de zone", Kind: "special", Desc: "Dégâts de zone en croix à distance.", Targets: manhattanCells(1, 3), Damage: orthCells(), DmgStat: "dexterite", Bonus: 3, Cooldown: 3},
			{Name: "Flèche perçante", Kind: "special", Desc: "Tir précis à longue portée.", Targets: lineCells(3), DmgStat: "dexterite", Bonus: 4, Cooldown: 2},
		}
	case "eclaireur":
		return []AttackDef{
			{Name: "Coup vif", Kind: "special", Desc: "Frappe rapide et sûre.", Targets: orthCells(), DmgStat: "dexterite", Bonus: 3, Cooldown: 2},
			// ÉCLAIRER — la capacité qui fait de l'Éclaireur l'œil de l'équipe. Elle ne
			// fait AUCUN dégât, et c'est le point : sa portée de ciblage est la plus
			// longue du jeu (5) parce qu'on désigne un endroit qu'on ne peut pas
			// atteindre. C'est le pendant en combat de son passif de carte.
			{Name: "Éclairer", Kind: "special",
				Desc:    "Désigne une zone : tout ce qui s'y trouve est visible par l'équipe pendant 2 rounds.",
				Targets: manhattanCells(1, 5), Reveal: eclairerRadius, Cooldown: 3},
		}
	case "gardien":
		return []AttackDef{
			{Name: "Posture défensive", Kind: "special", Desc: "-50% dégâts subis jusqu'au prochain tour.", SelfShield: true, Cooldown: 2},
			{Name: "Provocation", Kind: "special", Desc: "Coup lourd qui entrave la cible (Root).", Targets: orthCells(), DmgStat: "force", Bonus: 2, Root: true, Cooldown: 3},
		}
	case "recuperateur":
		return []AttackDef{
			{Name: "Coup de grâce", Kind: "special", Desc: "Achève brutalement un ennemi.", Targets: orthCells(), DmgStat: "force", Bonus: 4, Cooldown: 3},
		}
	case "herboriste":
		return []AttackDef{
			{Name: "Aspersion acide", Kind: "special", Desc: "Nuage corrosif de zone.", Targets: manhattanCells(1, 2), Damage: orthCells(), DmgStat: "precision", Bonus: 2, Cooldown: 2},
		}
	default:
		return []AttackDef{
			{Name: "Frappe puissante", Kind: "special", Desc: "Attaque renforcée en mêlée.", Targets: orthCells(), DmgStat: "force", Bonus: 3, Cooldown: 2},
		}
	}
}

// heroSkillFor returns the hero's PRIMARY iso skill (index 0) — used by the AI and
// as a back-compatible single-skill accessor.
func heroSkillFor(classID string) AttackDef {
	return heroIsoSkillsFor(classID)[0]
}

// defaultSpecialCooldown : la recharge d'une capacité SPÉCIALE qui n'en déclare
// pas. C'est ce qui étend la règle au catalogue de design (design.go) sans y
// ajouter un champ que le Studio ne connaît pas et sans avoir à annoter onze
// espèces à la main — et ça vaut pour les monstres comme pour les héros : une
// Colonne de Vent qui étourdit à 100 % rejouée à chaque tour verrouillait un héros
// jusqu'à sa mort, ce qui n'est pas un combat mais une exécution.
const defaultSpecialCooldown = 2

// withCooldowns pose la recharge par défaut sur les spéciales qui n'en ont pas.
// ⚠ COPIE : `Species` est un catalogue global, le muter contaminerait toutes les
// parties du processus.
func withCooldowns(atks []AttackDef) []AttackDef {
	out := make([]AttackDef, len(atks))
	copy(out, atks)
	for i := range out {
		if out[i].Kind == "special" && out[i].Cooldown == 0 {
			out[i].Cooldown = defaultSpecialCooldown
		}
	}
	return out
}

// monsterAttacks returns a species' attack list (with a melee fallback).
func monsterAttacks(kind string) []AttackDef {
	if sp := SpeciesByName(kind); sp != nil && len(sp.Attacks) > 0 {
		return withCooldowns(sp.Attacks)
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
			r := randIntn(10)
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
				h = (x + y + randIntn(2)) / 4
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
		cx, cy := 0, 2+randIntn(gh-4)
		if randIntn(2) == 0 {
			cx = gw - 1
		}
		for i := 0; i < 3+randIntn(2); i++ {
			x, y := cx, cy+randIntn(2)-i%2
			if x >= 0 && x < gw && y >= 1 && y < gh-1 {
				at(x, y).Hazard = "water"
				at(x, y).Height = 0
			}
		}
	case 5: // plaques de glace
		for i := 0; i < 4+randIntn(3); i++ {
			x, y := randIntn(gw), 1+randIntn(gh-2)
			at(x, y).Hazard = "ice"
		}
	case 2, 3: // ronces
		for i := 0; i < 2; i++ {
			x, y := randIntn(gw), 2+randIntn(gh-4)
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
		x, y := randIntn(gw), 1+randIntn(gh-2)
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
	// L'ARMURERIE (bâtiment de spécialité) : ce que la ville forge part au combat avec
	// ses héros. C'est l'axe « frapper » — le seul bâtiment dont l'effet se voit hors des
	// murs, et le pendant de la Caserne (qui, elle, ne sert qu'à l'intérieur).
	forge := gs.armoryBonus()
	for i, h := range heroes {
		// L'ÉQUIPEMENT PORTÉ (equipment.go) : prêté à l'unité, jamais greffé sur le héros.
		gear, armor, reach, vsCursed, rangedStat := equipBonuses(h)
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
		u.Stats.Force += forge + gear.Force
		u.Stats.Dexterite += gear.Dexterite
		u.Stats.Agilite += gear.Agilite
		u.Stats.Endurance += gear.Endurance
		// ⚠ Les deux statistiques ressuscitées par l'audit voyagent AUSSI : sans ces
		// deux lignes, des bottes de grimpeur ne feraient rien sur les terrasses de
		// l'arène et un stylet de précision n'ajouterait aucun critique — les objets
		// existeraient, leur effet non.
		u.Stats.Athletisme += gear.Athletisme
		u.Stats.Precision += gear.Precision
		u.Armor, u.Reach, u.VsCursed, u.RangedStat = armor, reach, vsCursed, rangedStat
		u.WeaponName, u.WeaponKind = h.Weapon, WeaponArchetype(h.Weapon)
		// L'agilité gagnée doit compter pour le DÉPLACEMENT : Move a été calculé au-dessus
		// sur la statistique nue, une cape de plumes n'aurait rien changé.
		u.Move = 2 + u.Stats.Agilite/3
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
		u.Initiative = u.Stats.Agilite*10 + randIntn(10)
		// La portée de vision (combatsight.go) : posée ICI, une fois, pour héros comme
		// monstres — donc après que l'équipement et l'Armurerie ont fini de bonifier
		// la Précision, sinon l'œil d'un objet ne porterait pas.
		u.Sight = u.sight()
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
			// L'ATHLÉTISME décide de la marche qu'on franchit (climbLimit) : 2
			// niveaux pour tout le monde, un de plus tous les 4 points. C'est ce
			// qui ouvre les terrasses hautes — et la hauteur donne des dégâts.
			if absI(c.heightAt(cx, cy)-c.heightAt(u.X, u.Y)) > u.climbLimit() {
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
//
// ⚠ LA TECHNIQUE D'ARME EST LA DERNIÈRE DE LA LISTE (weapons.go) : classe d'abord,
// arme ensuite. C'est CETTE fonction que PlayerAction indexe par `skillIdx`, donc
// personne ne peut se désynchroniser du client — il n'y a qu'une liste.
func (c *Combat) HeroSkills(u *CombatUnit) []AttackDef {
	if u.Side != "hero" {
		return nil
	}
	out := heroIsoSkillsFor(u.ClassID)
	if tech, ok := weaponTechnique(u.WeaponKind); ok {
		out = append(out, tech)
	}
	return out
}

// baseAttackFor returns a unit's plain attack (heroes: melee; monsters: their
// species' "base" attack from the design grids).
func (c *Combat) baseAttackFor(u *CombatUnit) AttackDef {
	if u.Side == "hero" {
		// UNE ARME CHANGE LA PORTÉE. C'est ce qui fait d'un arc autre chose qu'une épée
		// aux chiffres différents : on frappe de loin, donc on choisit sa place autrement.
		a := heroBaseAttack()
		if u.Reach > 1 {
			a.Targets = manhattanCells(1, u.Reach)
			if u.RangedStat != "" {
				a.DmgStat = u.RangedStat
			}
		}
		return a
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
	// ON NE FRAPPE QUE CE QU'ON VOIT (combatsight.go). Placé en TÊTE : c'est la
	// condition la moins chère et la plus forte, et la mettre après la grille de
	// ciblage aurait laissé `TargetsFor` proposer des cibles que l'action refuse.
	if def != nil && def.Side != att.Side && !c.VisibleTo(att.Side, def) {
		return false
	}
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
func (c *Combat) dmgMods(att, def *CombatUnit, atk *AttackDef) (heightBonus, mulNum, mulDen int) {
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
	// L'ARC passe par-dessus l'abri (technique « Tir en cloche ») : la couverture
	// ne s'applique pas. C'est le seul cas où l'ARME, et pas la position, annule un
	// modificateur de terrain.
	if !rear && !atk.IgnoreCover && def.distTo(att.X, att.Y) > 1 && c.inCover(att, def) {
		mulNum, mulDen = mulNum*3, mulDen*4
	}
	return hd, mulNum, mulDen
}

// EstimateFlags expose l'attaque de dos et la couverture effective pour la
// télégraphie client (🗡 dos / 🛡 à couvert) — mêmes règles que dmgMods.
func (c *Combat) EstimateFlags(att, def *CombatUnit, atk *AttackDef) (rear, cover bool) {
	rear = def.span() == 1 && c.isRearAttack(att, def)
	cover = !rear && !atk.IgnoreCover && def.distTo(att.X, att.Y) > 1 && c.inCover(att, def)
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
	hd, num, den := c.dmgMods(att, def, atk)
	d := stat + atk.Bonus + hd + randIntn(3) - def.Stats.Endurance/2 + att.cursedBonus(def)
	if d < 1 {
		d = 1
	}
	d = d * num / den
	if d < 1 {
		d = 1
	}
	// LA PRÉCISION : coup critique (×1.5). Après les modificateurs de position et
	// avant la garde — un critique perce mieux une posture, mais l'armure encaisse
	// toujours. Le tirage est le DERNIER de la fonction pour que la fourchette
	// servie (EstimateDamage) reste le miroir exact du reste.
	if p := att.critPct(); p > 0 && randIntn(100) < p {
		d = d * 3 / 2
		c.logf("%s frappe un point faible — coup critique !", att.Name)
	}
	if def.hasState("Bouclier") {
		d /= 2
		if d < 1 {
			d = 1
		}
	}
	// L'ARMURE PORTÉE, en dernier : elle retire des dégâts réellement encaissés, après
	// les multiplicateurs. Plancher à 1 — rien ne rend invulnérable.
	if d -= def.Armor; d < 1 {
		d = 1
	}
	return d
}

// cursedBonus : l'argent des légendes mord la chair maudite (loup-garou). Le seul effet
// conditionnel du catalogue d'équipement, et il vient du texte de la recette.
func (u *CombatUnit) cursedBonus(def *CombatUnit) int {
	if u.VsCursed == 0 || def == nil || !isCursedSpecies(def.Kind) {
		return 0
	}
	return u.VsCursed
}

// isCursedSpecies : les créatures que l'argent brûle.
func isCursedSpecies(species string) bool {
	return strings.Contains(strings.ToLower(species), "garou")
}

// EstimateDamage renvoie la fourchette [min,max] des dégâts de atk sur def —
// le miroir EXACT de damageWith sans le tirage aléatoire (randIntn(3) ∈ 0..2).
// Servie par combatResponse pour la prévisualisation d'attaque (lot C2) : le
// serveur calcule, le client ne fait qu'afficher.
func (c *Combat) EstimateDamage(att, def *CombatUnit, atk *AttackDef) (int, int) {
	return c.estimate(att, def, atk, false)
}

// CritChance rend la chance de coup critique de l'attaquant (en %) et les dégâts
// MAXIMUM qu'un critique infligerait à cette cible. 0 = l'attaquant n'a aucune
// précision, il n'y a rien à annoncer.
//
// ⚠ Servi À CÔTÉ de la fourchette ordinaire, et non fondu dedans : une moyenne
// pondérée ne dirait ni ce qu'on va probablement faire, ni ce qu'on peut espérer.
// Le joueur lit « −4…6 · 🎯12 % → 9 ».
func (c *Combat) CritChance(att, def *CombatUnit, atk *AttackDef) (pct, critMax int) {
	pct = att.critPct()
	if pct == 0 || atk.DmgStat == "" {
		return 0, 0
	}
	_, critMax = c.estimate(att, def, atk, true)
	return pct, critMax
}

func (c *Combat) estimate(att, def *CombatUnit, atk *AttackDef, crit bool) (int, int) {
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
	hd, num, den := c.dmgMods(att, def, atk) // mêmes modificateurs C4 que damageWith
	base := stat + atk.Bonus + hd - def.Stats.Endurance/2 + att.cursedBonus(def)
	clamp := func(d int) int {
		if d < 1 {
			d = 1
		}
		d = d * num / den
		if d < 1 {
			d = 1
		}
		if crit { // ⚠ MÊME PLACE que dans damageWith : après la position, avant la garde
			d = d * 3 / 2
		}
		if def.hasState("Bouclier") {
			d /= 2
			if d < 1 {
				d = 1
			}
		}
		if d -= def.Armor; d < 1 { // ⚠ MIROIR EXACT de damageWith, armure comprise
			d = 1
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

// AimCells renvoie les cases que `atk` peut VISER depuis la position de u : sa
// grille de ciblage VERTE, ramenée en coordonnées d'arène, bornée à la grille et
// — pour un tir — filtrée par la ligne de vue.
//
// Pourquoi le serveur et pas le client : c'est exactement la règle que
// `canTarget` applique pour ACCEPTER une attaque (bornes + LOS depuis chaque
// case de l'empreinte). Recalculée côté client, elle divergerait au premier
// obstacle, et le joueur verrait une portée que le serveur refuse.
//
// C'est ce qui rend une ARME lisible sans texte : la lance dessine une couronne
// à deux cases, l'arc une grande tache trouée par les rochers, l'épée quatre
// cases. Avant, la portée d'une arme ne se lisait que dans une liste de cibles.
func (c *Combat) AimCells(u *CombatUnit, atk *AttackDef) [][2]int {
	out := [][2]int{}
	if atk.SelfShield || atk.BuffAllies {
		return out // capacité sur soi : rien à viser
	}
	seen := map[[2]int]bool{}
	for _, fc := range u.footprint() {
		for _, t := range atk.Targets {
			x, y := fc[0]+t.DX, fc[1]+t.DY
			if x < 0 || y < 0 || x >= c.GridW || y >= c.GridH || seen[[2]int{x, y}] {
				continue
			}
			if manhattan(fc[0], fc[1], x, y) > 1 && !c.hasLOS(fc[0], fc[1], x, y) {
				continue // on ne tire pas à travers un rocher
			}
			seen[[2]int{x, y}] = true
			out = append(out, [2]int{x, y})
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
	// ÉCLAIRER (combatsight.go) : la capacité ne frappe pas, elle DÉSIGNE. Traitée
	// avant la zone de dégâts et avec un retour immédiat — lui faire traverser le
	// calcul de dégâts n'aurait produit qu'un coup à zéro dans le journal.
	if atk.Reveal > 0 {
		n := c.spotArea(att, tx, ty, atk.Reveal)
		if n == 0 {
			c.logf("%s scrute la zone — rien à signaler.", att.Name)
		} else {
			c.logf("%s éclaire la zone : %d ennemi(s) repéré(s) pour %d rounds.", att.Name, n, spotRounds)
		}
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
			if atk.StunPct > 0 && randIntn(100) < atk.StunPct {
				def.addState("Stun")
				c.logf("%s est étourdi (Stun).", def.Name)
			}
			if atk.Root {
				def.addState("Root")
				c.logf("%s est entravé (Root).", def.Name)
			}
			// La LANCE repousse (technique « Estoc », weapons.go) : mêmes règles que
			// l'action Poussée — collision, chute, eau. ⚠ un boss ne bouge pas, et la
			// direction se lit depuis l'ATTAQUANT (une zone d'effet écarte tout le
			// monde du même souffle, pas chacun dans un sens différent).
			if atk.Push && def.span() == 1 {
				dx, dy := def.X-att.X, def.Y-att.Y
				if absI(dx) >= absI(dy) {
					dx, dy = signI(dx), 0
				} else {
					dx, dy = 0, signI(dy)
				}
				if dx != 0 || dy != 0 {
					c.pushUnit(att, def, dx, dy)
				}
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
	// UNE ACTION PAR TOUR. La règle était déjà tenue de fait — toute action
	// appelait endTurn — mais elle n'était écrite nulle part et rien ne la
	// défendait ; `Acted` la rend explicite, refusable et AFFICHABLE.
	if cur.Acted {
		switch action {
		case "attack", "skill", "defend", "push":
			return ErrInvalidAction{cur.Name + " a déjà agi ce tour"}
		}
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
		c.spendBudget(cur) // le tour se ferme si l'action est déjà dépensée
		return nil

	case "attack", "skill":
		atk := c.baseAttackFor(cur)
		if action == "skill" {
			skills := c.HeroSkills(cur) // classe + technique d'arme, MÊME liste que l'UI
			idx := 0
			if len(skillIdx) > 0 {
				idx = skillIdx[0]
			}
			if idx < 0 || idx >= len(skills) {
				return ErrInvalidAction{"compétence inconnue"}
			}
			atk = skills[idx]
			if left := cur.cooldownLeft(&atk); left > 0 {
				return ErrInvalidAction{fmt.Sprintf("%s se recharge encore (%d tour(s))", atk.Name, left)}
			}
		}
		// ÉCLAIRER vise une CASE, pas une unité — et c'est tout le point : on désigne
		// l'endroit où l'on soupçonne quelque chose, précisément parce qu'on ne voit
		// rien à cibler. Exiger une cible aurait rendu la capacité inutilisable dans la
		// seule situation où elle sert.
		if atk.Reveal > 0 {
			if !atk.inTargets(tx-cur.X, ty-cur.Y) {
				return ErrInvalidAction{"case hors de portée"}
			}
			c.performAttack(cur, &atk, tx, ty)
			cur.startCooldown(&atk)
			cur.Acted = true
			c.spendBudget(cur)
			return nil
		}
		// Self abilities (Posture défensive) need no target — anything else must aim
		// at a living enemy standing on one of the attack's green targeting cells.
		if atk.SelfShield || atk.BuffAllies {
			c.performAttack(cur, &atk, cur.X, cur.Y)
			cur.startCooldown(&atk)
			cur.Acted = true
			c.spendBudget(cur)
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
		cur.startCooldown(&atk)
		cur.Acted = true
		c.spendBudget(cur)
		return nil

	case "defend":
		// Lot C3 : le Defend générique (pending §9.3) — réutilise le Bouclier de la
		// Posture défensive (-50 % subis, consommé au début du prochain tour du héros).
		cur.addState("Bouclier")
		c.logf("%s se met en garde : dégâts subis réduits de moitié jusqu'à son prochain tour.", cur.Name)
		cur.Acted = true
		c.spendBudget(cur)
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
		cur.Acted = true
		c.spendBudget(cur)
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

// CombatHeal renvoie les PV rendus par un objet EN COMBAT (0 = inutilisable).
//
// ⚠ DÉRIVÉ DU CATALOGUE (items.go), plus jamais d'une liste à part. Le lot C3
// avait figé sa propre table de quatre objets ; elle a divergé sans bruit — elle
// listait « Baies », qui n'est le nom d'AUCUN objet du jeu (c'est « Baie
// sauvage »), donc une entrée morte, pendant que l'Élixir de sève et le Baume de
// gelée, eux, ne s'utilisaient pas au combat alors qu'ils soignent. Un objet qui
// rend des PV les rend ici aussi ; ce qui ne rend que des PA (l'eau, les plats)
// n'a rien à faire dans une bataille, où les PA n'existent pas.
func CombatHeal(name string) int { return ItemEffects[name].HP }

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
	cur.Acted = true
	c.spendBudget(cur)
	return nil
}

// spendBudget ferme le tour dès que les DEUX budgets — le déplacement et
// l'action — sont dépensés, ou qu'il ne reste rien à faire du survivant.
//
// C'est ce qui rend le nouveau modèle gratuit à l'usage : « j'avance puis je
// frappe » se joue exactement comme avant (le second geste clôt le tour), et le
// seul cas où la main reste au joueur est celui où il a délibérément agi D'ABORD
// — parce qu'il veut décrocher ensuite. Un arc ou une lance ont enfin une raison
// d'exister au-delà de leur portée : frapper puis reculer hors d'atteinte.
func (c *Combat) spendBudget(u *CombatUnit) {
	if !u.Acted {
		return // il lui reste son action : on ne clôt jamais sur un simple pas
	}
	if !u.Moved && len(c.Reachable(u)) > 0 {
		return // il peut encore décrocher — la main lui reste
	}
	c.endTurn()
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
			c.tickSpots() // les marquages d'« Éclairer » s'estompent d'un round
			c.roundTick() // lot C5 : annonce/arrivée des renforts
		}
		u := c.CurrentUnit()
		if u == nil || !u.inBattle() {
			continue
		}
		// Les RECHARGES se comptent en tours de l'unité : elles avancent même si
		// l'étourdissement lui fait perdre celui-ci — un tour perdu reste un tour.
		u.tickCooldowns()
		// Tick one-turn states at the start of the unit's turn.
		if u.hasState("Stun") {
			u.removeState("Stun")
			c.logf("%s se remet de l'étourdissement.", u.Name)
			continue // loses the turn
		}
		u.removeState("Cécité")
		u.removeState("Bouclier") // the shield holds until the owner's next turn
		u.Moved = false           // fresh movement budget for the new turn
		u.Acted = false           // et une action neuve
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
	// Ordre STABLE (par case) et non celui de la map : forcer un tour fait jouer l'IA,
	// donc consomme du hasard — l'ordre d'itération aléatoire de Go rendait deux rejeux
	// de la même période divergents, ce qui contredit le principe de sim.go (le monde
	// est une fonction du temps écoulé, rejouable par n'importe quelle instance).
	ids := make([]string, 0, len(gs.Combats))
	for id := range gs.Combats {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		a, b := gs.Combats[ids[i]], gs.Combats[ids[j]]
		if a.TileY != b.TileY {
			return a.TileY < b.TileY
		}
		return a.TileX < b.TileX
	})
	for _, id := range ids {
		if c := gs.Combats[id]; c != nil && c.EnforceTurnTimer(now) {
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
	// ⚠ On ne tire que parmi les spéciales DISPONIBLES : sans ce filtre, l'IA
	// piochait une capacité en recharge et la jouait quand même — le cooldown
	// n'aurait bridé que le joueur, ce qui est le contraire du but.
	ready := readyOnly(u, specials)
	if len(ready) > 0 && randIntn(100) < 35 {
		pick := ready[randIntn(len(ready))]
		// Don't re-shield while already shielded; self abilities fire immediately.
		if !pick.SelfShield || !u.hasState("Bouclier") {
			atk = pick
		}
	}
	if atk.SelfShield || atk.BuffAllies {
		c.performAttack(u, &atk, u.X, u.Y)
		u.startCooldown(&atk)
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
		u.startCooldown(&atk)
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
	// ~40 % : une spéciale OFFENSIVE (zone GDD appliquée autour de la cible), et
	// seulement si elle n'est pas en recharge — un boss qui piétinerait à chaque
	// tour ne laisserait aucune fenêtre pour se regrouper.
	var zone *AttackDef
	specials := readyOnly(u, c.specialsFor(u))
	for i := range specials {
		sp := &specials[i]
		if sp.DmgStat != "" && !sp.SelfShield && !sp.BuffAllies {
			zone = sp
			break
		}
	}
	if zone != nil && randIntn(100) < 40 && c.canTarget(u, zone, target) {
		c.performAttack(u, zone, target.X, target.Y)
		u.startCooldown(zone)
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
	// ⚠ MÊME RÈGLE QUE LE JOUEUR : on ne concentre le feu que sur ce qu'on distingue.
	for _, o := range c.visibleEnemies(u) {
		score := o.HP*100 + o.distTo(u.X, u.Y)
		if score < bestScore {
			bestScore, best = score, o
		}
	}
	if best == nil {
		// AVEUGLE : on avance quand même vers le plus proche, sinon deux camps qui ne
		// se voient pas resteraient plantés jusqu'à la limite de rounds. Ce n'est pas
		// une tension, c'est une panne.
		best = c.nearestEnemy(u)
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
	n := 1 + randIntn(2)
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
	target := c.packTarget(u) // visible d'abord, sinon le plus proche (cf. packTarget)
	if target == nil {
		return
	}
	// L'IA joue AUSSI la technique de l'arme portée (weapons.go) : sinon un héros
	// équipé d'une lance se battrait mieux entre les mains d'un joueur qu'entre
	// celles du serveur, et les combats auto-résolus des bots ignoreraient tout
	// l'équipement qu'ils ramassent.
	//
	// ⚠ Deux candidates seulement — la compétence de classe (celle d'avant) et la
	// technique d'arme — et la plus bonifiée l'emporte. Balayer TOUTE la liste
	// changeait le choix des classes à deux compétences (le chasseur passait sur sa
	// Flèche perçante, à la grille de ciblage bien plus étroite) : ce n'est pas ce
	// lot-ci qui doit rendre l'IA plus maligne.
	sk := heroSkillFor(u.ClassID)
	if tech, ok := weaponTechnique(u.WeaponKind); ok && tech.DmgStat != "" && tech.Bonus > sk.Bonus {
		sk = tech
	}
	atk := sk
	// Une compétence en RECHARGE n'est pas jouable : l'IA retombe sur l'attaque de
	// base, comme un joueur. Sans ça les combats auto-résolus des bots (et les
	// héros des joueurs absents) contourneraient la règle qu'on vient de poser.
	if sk.DmgStat == "" || !u.ready(&sk) {
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
		u.startCooldown(&atk)
	} else if base := c.baseAttackFor(u); c.canTarget(u, &base, target) {
		c.performAttack(u, &base, target.X, target.Y)
	} else {
		c.logf("%s avance.", u.Name)
	}
	u.Acted = true
}

// readyOnly filtre les capacités qui ne sont pas en recharge.
func readyOnly(u *CombatUnit, atks []AttackDef) []AttackDef {
	out := make([]AttackDef, 0, len(atks))
	for i := range atks {
		if u.ready(&atks[i]) {
			out = append(out, atks[i])
		}
	}
	return out
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

// armoryBonus rend la force que l'Armurerie ajoute à chaque héros au combat (0 si elle
// n'est pas bâtie, ou si elle est en ruine — un atelier détruit ne forge plus).
func (g *GameState) armoryBonus() int {
	b := g.buildingByID("armurerie")
	if b == nil || !b.Built || b.Durability <= 0 {
		return 0
	}
	return b.Level
}
