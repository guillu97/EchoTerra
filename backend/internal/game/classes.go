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

// ClassSkill is a short flavor/skill entry shown on the Hero screen.
type ClassSkill struct {
	Name  string `json:"name"`
	Scope string `json:"scope"` // "map" | "iso"
	Desc  string `json:"desc"`
}

// ClassDef describes one selectable class (GDD "classe intermédiaire" / "classe avancée").
type ClassDef struct {
	ID      string       `json:"id"`
	Name    string       `json:"name"`
	Tier    int          `json:"tier"` // ClassTierIntermediate | ClassTierAdvanced
	Role    string       `json:"role"`
	Bonuses Stats        `json:"bonuses"`
	PABonus int          `json:"paBonus"`
	Skills  []ClassSkill `json:"skills"`
}

// Classes is the evolution catalog, drawn from the GDD.
var Classes = []ClassDef{
	{
		ID: "pionnier", Name: "Pionnier", Tier: ClassTierIntermediate,
		Role:    "Robuste et débrouillard, il ouvre la voie et affronte les obstacles de front.",
		Bonuses: Stats{Force: 5, Endurance: 3},
		PABonus: 1,
		Skills: []ClassSkill{
			{Name: "Poussée du Survivant", Scope: "map", Desc: "Force un passage là où les autres doivent contourner."},
			{Name: "Frappe de la mort qui tue", Scope: "iso", Desc: "Attaque puissante (+5 dégâts)."},
		},
	},
	{
		ID: "chasseur", Name: "Chasseur", Tier: ClassTierIntermediate,
		Role:    "Traqueur précis qui trouve et élimine sa cible.",
		Bonuses: Stats{Dexterite: 5, Agilite: 3, Endurance: 2},
		PABonus: 1,
		Skills: []ClassSkill{
			{Name: "Tir précis", Scope: "map", Desc: "Élimine un monstre affaibli sur sa case."},
			{Name: "Tir de zone", Scope: "iso", Desc: "+3 dégâts par case touchée."},
		},
	},
	{
		ID: "eclaireur", Name: "Éclaireur", Tier: ClassTierIntermediate,
		Role:    "Discret et rapide, il voit loin et repère les dangers avant les autres.",
		Bonuses: Stats{Athletisme: 5, Agilite: 3, Endurance: 2},
		Skills: []ClassSkill{
			{Name: "Observation Large", Scope: "map", Desc: "Vision étendue autour de lui (+1 case)."},
			{Name: "Éclairer", Scope: "iso", Desc: "Illumine 4 cases (passif)."},
		},
	},
	{
		ID: "gardien", Name: "Gardien", Tier: ClassTierAdvanced,
		Role:    "Protecteur du groupe et du territoire : encaisse et sécurise les zones dangereuses.",
		Bonuses: Stats{Force: 5, Endurance: 3},
		PABonus: 1,
		Skills: []ClassSkill{
			{Name: "Rassure", Scope: "map", Desc: "Compte pour 3 héros face à une horde (Tétanisé)."},
			{Name: "Posture défensive", Scope: "iso", Desc: "Réduit les dégâts subis."},
		},
	},
	{
		ID: "recuperateur", Name: "Récupérateur", Tier: ClassTierAdvanced,
		Role:    "Récupère tout ce qui traîne : fragments, restes, débris, matériaux et objets tombés.",
		Bonuses: Stats{Athletisme: 5, Agilite: 3, Endurance: 2},
		PABonus: 1,
		Skills: []ClassSkill{
			{Name: "Sac élargi", Scope: "map", Desc: "Transporte +1 ressource lors d'une fouille."},
			{Name: "Récupération", Scope: "iso", Desc: "Butin supplémentaire sur les ennemis vaincus."},
		},
	},
	{
		ID: "herboriste", Name: "Herboriste & Minéral", Tier: ClassTierAdvanced,
		Role:    "Récolte les plantes, herbes rares et minerais simples.",
		Bonuses: Stats{Athletisme: 5, Agilite: 3, Endurance: 2},
		PABonus: 1,
		Skills: []ClassSkill{
			{Name: "Récolte Délicate", Scope: "map", Desc: "+1 ressource assuré sur les plantes et minéraux."},
			{Name: "Résistance", Scope: "iso", Desc: "Résiste mieux aux biomes hostiles (froid, chaleur, toxique)."},
		},
	},
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
