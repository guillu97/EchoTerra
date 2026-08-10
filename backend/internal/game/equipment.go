package game

// L'ÉQUIPEMENT — ce que la forge sert enfin à faire.
//
// Le trou que ça bouche : la forge produisait des lames, des arcs, des capes et des
// armures dont les effets n'étaient QUE DU TEXTE (« Lame de fer : +3 force en combat »).
// On récoltait le minerai, on montait l'Atelier au niveau 2, on fabriquait l'objet — et
// il rejoignait la Banque pour n'en jamais ressortir. C'est le pendant des consommables
// (items.go) : là on rendait des PA et des PV, ici on change ce qu'un héros VAUT au
// combat.
//
// DEUX EMPLACEMENTS, pas davantage : une ARME et un ÉQUIPEMENT (cape ou armure). Assez
// pour qu'un choix se pose — une lame lourde ou un arc, une cape légère ou du cuir — et
// assez peu pour rester lisible sur un téléphone. Un inventaire à huit emplacements
// serait un autre jeu.
//
// ⚠ L'OBJET QUITTE LE SAC quand on le porte, et y revient quand on le retire. Sans ça il
// serait déposé en Banque tout en restant équipé, et une seule lame armerait la ville
// entière.
//
// ⚠ LE BONUS EST PRÊTÉ À L'UNITÉ DE COMBAT, jamais greffé sur `Hero.Stats` — même règle
// que l'Armurerie (combat.go armoryBonus). Greffé, il s'empilerait à chaque combat et un
// héros finirait la partie avec quarante de force.

// Slots d'équipement.
const (
	SlotWeapon = "arme"
	SlotGear   = "equipement"
)

// EquipDef décrit ce qu'un objet porté apporte.
//
// ⚠ TAGS JSON : cette table est servie au client (GET /api/equipment), comme celle des
// consommables — sans eux Go sérialiserait les noms de champs Go et l'interface lirait
// `undefined` (le piège rencontré sur ItemEffect).
type EquipDef struct {
	Slot      string `json:"slot"`
	Force     int    `json:"force,omitempty"`
	Dexterite int    `json:"dexterite,omitempty"`
	Agilite   int    `json:"agilite,omitempty"`
	Endurance int    `json:"endurance,omitempty"`
	// Armor : dégâts SUBIS en moins, à chaque coup encaissé (plancher 1 : rien ne rend
	// invulnérable).
	Armor int `json:"armor,omitempty"`
	// Reach : portée de l'attaque de BASE. 0 = mêlée orthogonale, la portée par défaut
	// d'un héros. C'est ce qui fait d'un arc autre chose qu'une épée un peu différente.
	Reach int `json:"reach,omitempty"`
	// RangedStat : la statistique qui porte les dégâts d'une arme à distance (la dextérité
	// pour un arc). Vide = force, comme au corps à corps.
	RangedStat string `json:"rangedStat,omitempty"`
	// VsCursed : bonus de dégâts contre les créatures maudites (loups-garous) — l'argent
	// des légendes. Le seul effet conditionnel, et il vient du texte de la recette.
	VsCursed int    `json:"vsCursed,omitempty"`
	Desc     string `json:"desc"`
}

// Equipment : le catalogue de ce qui se PORTE. Les valeurs reprennent les effets
// annoncés par les recettes de forge (craft.go) — c'est le contrat que le joueur a lu.
var Equipment = map[string]EquipDef{
	"Lame de fer":       {Slot: SlotWeapon, Force: 3, Desc: "+3 force au combat"},
	"Dague en croc":     {Slot: SlotWeapon, Force: 2, Desc: "+2 force au combat"},
	"Lame d'argent":     {Slot: SlotWeapon, Force: 2, VsCursed: 4, Desc: "+2 force, +4 contre les créatures maudites"},
	"Arc sylvestre":     {Slot: SlotWeapon, Dexterite: 2, Reach: 3, RangedStat: "dexterite", Desc: "attaque à portée 3, +2 dextérité"},
	"Lance de sanglier": {Slot: SlotWeapon, Force: 3, Reach: 2, Desc: "+3 force, attaque à portée 2"},

	"Cape de plumes": {Slot: SlotGear, Agilite: 2, Desc: "+2 agilité (déplacement, initiative)"},
	"Cape de garou":  {Slot: SlotGear, Endurance: 2, Desc: "+2 endurance (encaisse mieux)"},
	"Armure de cuir": {Slot: SlotGear, Armor: 2, Desc: "−2 dégâts subis à chaque coup"},
}

// EquipableItem reports whether this item can be worn, and in which slot.
func EquipableItem(name string) (EquipDef, bool) { d, ok := Equipment[name]; return d, ok }

// Equip fait porter un objet du sac. Gratuit en PA — s'armer n'est pas une action de la
// journée, c'est une décision. Refusé en plein combat : on ne change pas d'arme au
// milieu d'une mêlée.
func (g *GameState) Equip(heroID, name string) (*Hero, error) {
	if g.heroInCombat(heroID) != nil {
		return nil, ActionError{"ce héros est en plein combat"}
	}
	h := g.HeroByID(heroID)
	if h == nil || h.HP <= 0 {
		return nil, ActionError{"héros introuvable"}
	}
	def, ok := Equipment[name]
	if !ok {
		return nil, ActionError{name + " ne se porte pas"}
	}
	if heroItemQty(h, name) < 1 {
		return nil, ActionError{h.Name + " n'a pas « " + name + " » dans son sac"}
	}
	// L'emplacement se libère d'abord : l'objet remplacé retourne au sac, il n'est
	// jamais perdu.
	if err := g.unequipSlot(h, def.Slot); err != nil {
		return nil, err
	}
	removeHeroItem(h, name, 1)
	switch def.Slot {
	case SlotWeapon:
		h.Weapon = name
	default:
		h.Gear = name
	}
	return h, nil
}

// Unequip range un objet porté dans le sac.
func (g *GameState) Unequip(heroID, slot string) (*Hero, error) {
	if g.heroInCombat(heroID) != nil {
		return nil, ActionError{"ce héros est en plein combat"}
	}
	h := g.HeroByID(heroID)
	if h == nil || h.HP <= 0 {
		return nil, ActionError{"héros introuvable"}
	}
	if slot != SlotWeapon && slot != SlotGear {
		return nil, ActionError{"emplacement inconnu"}
	}
	if err := g.unequipSlot(h, slot); err != nil {
		return nil, err
	}
	return h, nil
}

func (g *GameState) unequipSlot(h *Hero, slot string) error {
	var cur *string
	if slot == SlotWeapon {
		cur = &h.Weapon
	} else {
		cur = &h.Gear
	}
	if *cur == "" {
		return nil
	}
	if _, ok := Equipment[*cur]; ok {
		h.AddLoot(Item{Type: "arme", Name: *cur, Qty: 1})
	}
	*cur = ""
	return nil
}

// heroGear rend les définitions des deux emplacements d'un héros.
func heroGear(h *Hero) (weapon, gear EquipDef) {
	if h == nil {
		return
	}
	weapon = Equipment[h.Weapon]
	gear = Equipment[h.Gear]
	return
}

// equipBonuses cumule ce que l'équipement d'un héros apporte à son unité de combat.
func equipBonuses(h *Hero) (stats Stats, armor, reach, vsCursed int, rangedStat string) {
	w, gr := heroGear(h)
	for _, d := range []EquipDef{w, gr} {
		stats.Force += d.Force
		stats.Dexterite += d.Dexterite
		stats.Agilite += d.Agilite
		stats.Endurance += d.Endurance
		armor += d.Armor
		vsCursed += d.VsCursed
		if d.Reach > reach {
			reach = d.Reach
			rangedStat = d.RangedStat
		}
	}
	return
}
