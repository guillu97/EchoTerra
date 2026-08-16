package game

import "fmt"

// Class tiers. Heroes start at ClassTierNone ("Sans classe", no bonuses) and evolve
// sequentially: an intermediate class (tier 1) once EvolveDayIntermediate has passed,
// then an advanced class (tier 2) EvolveDayAdvanced days later.
const (
	ClassTierNone         = 0
	ClassTierIntermediate = 1
	ClassTierAdvanced     = 2
)

// EvolveDayIntermediate/Advanced are game.Day thresholds gating class evolution.
// game.Day increments every 2 waves (one in-game day).
const (
	EvolveDayIntermediate = 2 // after 2 waves (1 day)
	EvolveDayAdvanced     = 4 // 2 more days later
)

// ClassSkill is a class ability entry (map skill or iso-combat skill).
type ClassSkill struct {
	Name    string `json:"name"`
	Scope   string `json:"scope"` // "map" | "iso"
	PA      int    `json:"pa"`    // activation cost (0 = passif)
	Desc    string `json:"desc"`
	Effects string `json:"effects,omitempty"` // design numbers ("+5 dégâts", "poids 3"…)
}

// ClassAppearance names the character assets used for a class: on the world map /
// combat (map) and on the hero stats screen (icon).
type ClassAppearance struct {
	Map  string `json:"map"`
	Icon string `json:"icon"`
}

// ClassDef describes one selectable class (GDD "classe intermédiaire" / "classe avancée").
type ClassDef struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Tier       int             `json:"tier"`     // ClassTierIntermediate | ClassTierAdvanced
	Day        int             `json:"day"`      // game.Day gate
	Requires   []string        `json:"requires"` // parent class ids (any-of; empty = from Sans classe)
	Role       string          `json:"role"`
	Bonuses    Stats           `json:"bonuses"`
	PABonus    int             `json:"paBonus"`
	Skills     []ClassSkill    `json:"skills"`
	Appearance ClassAppearance `json:"appearance"`
}

// LES SIX PROFILS SONT DISTINCTS — et ne l'étaient pas.
//
// Le catalogue portait SIX classes pour TROIS blocs de statistiques seulement :
// Pionnier == Gardien (Force 5, Endurance 3), et Éclaireur == Récupérateur ==
// Herboriste (Athlétisme 5, Agilité 3, Endurance 2). Autrement dit, l'Éclaireur — la
// classe de la vision — était chiffré exactement comme l'Herboriste, et tout ce qui
// les séparait était passif. Choisir sa classe n'engageait donc rien de mesurable.
//
// Chaque bloc vaut désormais 10 points, et chacun raconte ce que la classe SAIT FAIRE,
// en accord avec ses propres compétences :
//
//	Pionnier     Force 5 · Athlétisme 3 · Endurance 2   il ouvre le passage (et il GRIMPE,
//	                                                    ce que son passif de carte promet)
//	Chasseur     Dextérité 5 · Précision 3 · Endurance 2 ses deux tirs portent à la dextérité,
//	                                                    la précision place le coup
//	Éclaireur    Perception 5 · Agilité 3 · Endurance 2  l'ŒIL : il voit ce que les autres ratent
//	Gardien      Endurance 5 · Force 5                  le mur : le seul à être haut dans les deux
//	Récupérateur Athlétisme 5 · Endurance 3 · Force 2   celui qui va chercher LOIN et rapporte
//	Herboriste   Précision 4 · Dextérité 3 · Endurance 3 la main sûre (son Aspersion acide
//	                                                    frappe DÉJÀ à la précision)
//
// ⚠ Le total est le même pour toutes (10) : différencier ne doit pas hiérarchiser.
//
// ⚠⚠ ET LA SOMME D'ENDURANCE DU CATALOGUE EST UN RÉGLAGE À PART ENTIÈRE. Un premier jet
// répartissait joliment (Gardien 6, et zéro pour trois classes) — mais le catalogue
// passait de 14 points d'endurance à 11, et comme l'endurance porte les PV depuis
// l'audit, la survie médiane a chuté d'une à deux vagues (mesuré : 18 → 17 à quatre
// joueurs, 19 → 17 à douze). Différencier ne doit pas non plus AMAIGRIR : toutes les
// classes en gardent désormais, et le total est remonté.

// Classes is the evolution catalog from the 🧙 Classes tab of the design.
var Classes = []ClassDef{
	{
		ID: "pionnier", Name: "Pionnier", Tier: ClassTierIntermediate, Day: EvolveDayIntermediate,
		Role:    "Robuste et débrouillard, il ouvre la voie et affronte les obstacles de front.",
		Bonuses: Stats{Force: 5, Athletisme: 3, Endurance: 2},
		PABonus: 1,
		Skills: []ClassSkill{
			{Name: "Poussée du Survivant", Scope: "map", PA: 1, Desc: "Force un passage là où les autres doivent contourner.", Effects: "ignore 1 case bloquée"},
			{Name: "Frappe de la mort qui tue", Scope: "iso", PA: 2, Desc: "Attaque puissante.", Effects: "+5 dégâts"},
		},
		Appearance: ClassAppearance{Map: "char-builder", Icon: "char-builder"},
	},
	{
		ID: "chasseur", Name: "Chasseur", Tier: ClassTierIntermediate, Day: EvolveDayIntermediate,
		Role:    "Traqueur précis qui trouve et élimine sa cible.",
		Bonuses: Stats{Dexterite: 5, Precision: 3, Endurance: 2},
		PABonus: 1,
		Skills: []ClassSkill{
			{Name: "Tir précis", Scope: "map", PA: 1, Desc: "Élimine un monstre affaibli sur sa case.", Effects: "tue si PV pack ≤ 5"},
			{Name: "Tir de zone", Scope: "iso", PA: 2, Desc: "Dégâts de zone en croix.", Effects: "+3 dégâts par case touchée"},
		},
		Appearance: ClassAppearance{Map: "char-archer", Icon: "char-archer"},
	},
	{
		ID: "eclaireur", Name: "Éclaireur", Tier: ClassTierIntermediate, Day: EvolveDayIntermediate,
		Role:    "Discret et rapide, il voit loin et repère les dangers avant les autres.",
		Bonuses: Stats{Perception: 5, Agilite: 3, Endurance: 2},
		Skills: []ClassSkill{
			// ⚠ « Observation Large » n'est plus un cas particulier codé en dur : c'est
			// sa PERCEPTION qui porte sa vision, sur la carte comme dans l'arène. La
			// classe cesse d'être une exception dans le moteur pour devenir un profil.
			{Name: "Observation Large", Scope: "map", Desc: "Sa Perception lève le brouillard plus loin que quiconque.", Effects: "+5 perception : rayon de vision élargi (passif)"},
			{Name: "Éclairer", Scope: "iso", PA: 1, Desc: "Désigne une zone : tout ce qui s'y trouve devient visible pour l'équipe.", Effects: "révèle un rayon 2 pendant 2 rounds"},
		},
		Appearance: ClassAppearance{Map: "char-scout", Icon: "char-scout"},
	},
	{
		ID: "gardien", Name: "Gardien", Tier: ClassTierAdvanced, Day: EvolveDayAdvanced,
		Requires: []string{"pionnier"},
		Role:     "Protecteur du groupe et du territoire : encaisse et sécurise les zones dangereuses.",
		Bonuses:  Stats{Endurance: 5, Force: 5},
		PABonus:  1,
		Skills: []ClassSkill{
			{Name: "Rassure", Scope: "map", Desc: "Compte pour 3 héros face à une horde.", Effects: "poids 3 dans le calcul Tétanisé (passif)"},
			{Name: "Posture défensive", Scope: "iso", PA: 1, Desc: "Réduit les dégâts subis.", Effects: "-50% dégâts jusqu'au prochain tour"},
		},
		Appearance: ClassAppearance{Map: "char-knight", Icon: "char-knight"},
	},
	{
		ID: "recuperateur", Name: "Récupérateur", Tier: ClassTierAdvanced, Day: EvolveDayAdvanced,
		Requires: []string{"chasseur", "eclaireur"},
		Role:     "Récupère tout ce qui traîne : fragments, restes, débris, matériaux et objets tombés.",
		Bonuses:  Stats{Athletisme: 5, Endurance: 3, Force: 2},
		PABonus:  1,
		Skills: []ClassSkill{
			{Name: "Sac élargi", Scope: "map", Desc: "Transporte plus lors d'une fouille.", Effects: "+1 ressource par fouille (passif)"},
			{Name: "Récupération", Scope: "iso", Desc: "Butin supplémentaire sur les ennemis vaincus.", Effects: "+1 trophée par victoire (passif)"},
		},
		Appearance: ClassAppearance{Map: "char-merchant", Icon: "char-merchant"},
	},
	{
		ID: "herboriste", Name: "Herboriste & Minéral", Tier: ClassTierAdvanced, Day: EvolveDayAdvanced,
		Requires: []string{"eclaireur"},
		Role:     "Récolte les plantes, herbes rares et minerais simples.",
		Bonuses:  Stats{Precision: 4, Dexterite: 3, Endurance: 3},
		PABonus:  1,
		Skills: []ClassSkill{
			{Name: "Récolte Délicate", Scope: "map", Desc: "Récolte assurée sur plantes et minéraux.", Effects: "+1 ressource plante/minerai (passif)"},
			{Name: "Résistance", Scope: "iso", Desc: "Résiste aux biomes hostiles.", Effects: "immunisé froid/chaleur/toxique (passif)"},
		},
		Appearance: ClassAppearance{Map: "char-healer", Icon: "char-healer"},
	},
}

// joinOr renders a French "A ou B" list.
func joinOr(names []string) string {
	switch len(names) {
	case 0:
		return ""
	case 1:
		return names[0]
	default:
		out := names[0]
		for _, n := range names[1 : len(names)-1] {
			out += ", " + n
		}
		return out + " ou " + names[len(names)-1]
	}
}

// ClassByID returns the class definition with the given id, or nil.
func ClassByID(id string) *ClassDef {
	for i := range Classes {
		if Classes[i].ID == id {
			return &Classes[i]
		}
	}
	return nil
}

// EvolveHero promotes a hero to the next class tier, applying the chosen class's stat
// and PA bonuses once. Heroes start "Sans classe" (tier 0, no bonuses); classID must
// name a class of tier h.ClassTier+1, and the day requirement for that tier must be met.
func (g *GameState) EvolveHero(heroID, classID string) error {
	h := g.HeroByID(heroID)
	if h == nil {
		return ActionError{"héros introuvable"}
	}
	if h.ClassTier >= ClassTierAdvanced {
		return ActionError{h.Name + " a déjà atteint sa classe avancée"}
	}
	nextTier := h.ClassTier + 1
	minDay := EvolveDayIntermediate
	if nextTier == ClassTierAdvanced {
		minDay = EvolveDayAdvanced
	}
	if g.Day < minDay {
		return ActionError{fmt.Sprintf("%s ne peut évoluer qu'à partir du jour %d (actuellement jour %d)", h.Name, minDay, g.Day)}
	}
	cls := ClassByID(classID)
	if cls == nil || cls.Tier != nextTier {
		return ActionError{"classe invalide pour cette évolution"}
	}
	// Tech-tree prerequisite: an advanced class requires one of its parent classes
	// (Gardien ← Pionnier ; Récupérateur ← Chasseur/Éclaireur ; Herboriste ← Éclaireur).
	if len(cls.Requires) > 0 {
		ok := false
		for _, req := range cls.Requires {
			if h.ClassID == req {
				ok = true
				break
			}
		}
		if !ok {
			names := make([]string, 0, len(cls.Requires))
			for _, req := range cls.Requires {
				if p := ClassByID(req); p != nil {
					names = append(names, p.Name)
				} else {
					names = append(names, req)
				}
			}
			return ActionError{fmt.Sprintf("%s exige d'être %s", cls.Name, joinOr(names))}
		}
	}

	h.Stats.Force += cls.Bonuses.Force
	h.Stats.Dexterite += cls.Bonuses.Dexterite
	h.Stats.Agilite += cls.Bonuses.Agilite
	h.Stats.Endurance += cls.Bonuses.Endurance
	h.Stats.Athletisme += cls.Bonuses.Athletisme
	h.Stats.Precision += cls.Bonuses.Precision
	h.Stats.Perception += cls.Bonuses.Perception
	h.ClassBonuses.Force += cls.Bonuses.Force
	h.ClassBonuses.Dexterite += cls.Bonuses.Dexterite
	h.ClassBonuses.Agilite += cls.Bonuses.Agilite
	h.ClassBonuses.Endurance += cls.Bonuses.Endurance
	h.ClassBonuses.Athletisme += cls.Bonuses.Athletisme
	h.ClassBonuses.Precision += cls.Bonuses.Precision
	h.ClassBonuses.Perception += cls.Bonuses.Perception
	h.MaxPA += cls.PABonus
	h.PA += cls.PABonus
	// L'ENDURANCE PORTE LES PV. `NewStarterHero` pose `hp = 8 + endurance*2`, mais
	// l'évolution ajoutait de l'endurance SANS toucher aux PV : un gardien à
	// 7 d'endurance gardait les 16 PV de ses 4 points de départ, et la moitié
	// « visible » de la statistique (encaisser plus) ne se produisait jamais — seule
	// la réduction de dégâts au combat suivait. Même barème que la création, et les
	// PV courants montent d'autant (une évolution n'est pas un soin, c'est un gain
	// de constitution : on ne perd rien, on ne se soigne pas non plus).
	if gain := 2 * cls.Bonuses.Endurance; gain > 0 {
		h.MaxHP += gain
		h.HP += gain
	}

	h.ClassID = cls.ID
	h.ClassTier = nextTier
	h.Class = cls.Name
	return nil
}
