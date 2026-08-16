package game

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

// Classes is the evolution catalog from the 🧙 Classes tab of the design.
var Classes = []ClassDef{
	{
		ID: "pionnier", Name: "Pionnier", Tier: ClassTierIntermediate, Day: EvolveDayIntermediate,
		Role:    "Robuste et débrouillard, il ouvre la voie et affronte les obstacles de front.",
		Bonuses: Stats{Force: 5, Endurance: 3},
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
		Bonuses: Stats{Dexterite: 5, Agilite: 3, Endurance: 2},
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
		Bonuses: Stats{Athletisme: 5, Agilite: 3, Endurance: 2},
		Skills: []ClassSkill{
			{Name: "Observation Large", Scope: "map", Desc: "Vision étendue autour de lui.", Effects: "+1 case de vision (passif)"},
			{Name: "Éclairer", Scope: "iso", Desc: "Illumine 4 cases.", Effects: "passif"},
		},
		Appearance: ClassAppearance{Map: "char-scout", Icon: "char-scout"},
	},
	{
		ID: "gardien", Name: "Gardien", Tier: ClassTierAdvanced, Day: EvolveDayAdvanced,
		Requires: []string{"pionnier"},
		Role:     "Protecteur du groupe et du territoire : encaisse et sécurise les zones dangereuses.",
		Bonuses:  Stats{Force: 5, Endurance: 3},
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
		Bonuses:  Stats{Athletisme: 5, Agilite: 3, Endurance: 2},
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
		Bonuses:  Stats{Athletisme: 5, Agilite: 3, Endurance: 2},
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
		return actionErr("héros introuvable")
	}
	if h.ClassTier >= ClassTierAdvanced {
		return actionErrf("%s a déjà atteint sa classe avancée", h.Name)
	}
	nextTier := h.ClassTier + 1
	minDay := EvolveDayIntermediate
	if nextTier == ClassTierAdvanced {
		minDay = EvolveDayAdvanced
	}
	if g.Day < minDay {
		return actionErrf("%s ne peut évoluer qu'à partir du jour %d (actuellement jour %d)", h.Name, minDay, g.Day)
	}
	cls := ClassByID(classID)
	if cls == nil || cls.Tier != nextTier {
		return actionErr("classe invalide pour cette évolution")
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
			// NameList et non joinOr : le client joint lui-même, avec SON connecteur.
			return actionErrf("%s exige d'être %s", Name(cls.Name), NameList(names))
		}
	}

	h.Stats.Force += cls.Bonuses.Force
	h.Stats.Dexterite += cls.Bonuses.Dexterite
	h.Stats.Agilite += cls.Bonuses.Agilite
	h.Stats.Endurance += cls.Bonuses.Endurance
	h.Stats.Athletisme += cls.Bonuses.Athletisme
	h.Stats.Precision += cls.Bonuses.Precision
	h.ClassBonuses.Force += cls.Bonuses.Force
	h.ClassBonuses.Dexterite += cls.Bonuses.Dexterite
	h.ClassBonuses.Agilite += cls.Bonuses.Agilite
	h.ClassBonuses.Endurance += cls.Bonuses.Endurance
	h.ClassBonuses.Athletisme += cls.Bonuses.Athletisme
	h.ClassBonuses.Precision += cls.Bonuses.Precision
	h.MaxPA += cls.PABonus
	h.PA += cls.PABonus

	h.ClassID = cls.ID
	h.ClassTier = nextTier
	h.Class = cls.Name
	return nil
}
