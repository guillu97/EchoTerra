package game

import "fmt"

// Recipe is a craftable item. In town it consumes ingredients from the Bank and
// outputs back there (the required building must be BUILT at BuildingLevel or more);
// in the field (no town building) a "Field" recipe consumes the crafting hero's own
// bag and outputs to it. Paid with the hero's PA.
type Recipe struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Category      string `json:"category"`             // conso | potion | forge | deco
	Building      string `json:"building"`             // kitchen | workshop ("" = aucun)
	BuildingLevel int    `json:"buildingLevel"`        // minimum level of that building (town crafts)
	OutputType    string `json:"outputType"`           // aliment | consommable | arme | deco | objet | minerai
	OutputName    string `json:"outputName,omitempty"` // defaults to Name
	OutputQty     int    `json:"outputQty,omitempty"`  // defaults to 1
	Field         bool   `json:"field"`                // craftable outside town (campfire-style)
	PACost        int    `json:"paCost"`
	Ingredients   []Item `json:"ingredients"`
	Effects       string `json:"effects,omitempty"` // design text (what the item does)
	// Favor : la FAVEUR DES DIEUX que fabriquer cet objet verse à la ville (mythic.go).
	// Réservé en pratique à la catégorie « deco » — orner le bourg est ce qui attire le
	// regard des dieux. C'est ce qui remplace le « moral de la ville » que ces recettes
	// promettaient depuis le premier jour sans qu'une ligne de code le porte.
	Favor int `json:"favor,omitempty"`
}

// Recipes is the crafting catalog from the ⚒️ Craft tab of the design (26 recipes):
// transformations (Planche/Corde/Brique/Cuir/Acier), mythic weapons & equipment,
// cuisine and alchemy. Kitchen level 2 unlocks the refined dishes/potions, level 3
// the banquets (Ambroisie); Workshop level 2 the forge alloys/equipment, level 3 the
// advanced pieces (Talisman, Amulette).
var Recipes = []Recipe{
	// --- cuisine (kitchen) ---
	{ID: "mapo_curry", Name: "Mapo Curry", Category: "conso", Building: "kitchen", BuildingLevel: 1, OutputType: "aliment", Field: true, PACost: 1,
		Ingredients: []Item{{"animal", "Viande", 2}, {"plante", "Fleur", 1}}, Effects: "Restaure la faim (+40)"},
	{ID: "orange_juice", Name: "Jus de fruit", Category: "conso", Building: "kitchen", BuildingLevel: 1, OutputType: "aliment", Field: true, PACost: 1,
		Ingredients: []Item{{"plante", "Fleur", 2}}, Effects: "Désaltère (retire Soif)"},
	{ID: "grilled_fish", Name: "Poisson grillé", Category: "conso", Building: "kitchen", BuildingLevel: 1, OutputType: "aliment", Field: true, PACost: 1,
		Ingredients: []Item{{"aliment", "Poisson", 1}}, Effects: "Restaure la faim (+25)"},
	{ID: "berry_jam", Name: "Confiture de baies", Category: "conso", Building: "kitchen", BuildingLevel: 1, OutputType: "aliment", PACost: 1,
		Ingredients: []Item{{"plante", "Baie sauvage", 2}}, Effects: "Restaure la faim (+20), se conserve"},
	{ID: "forest_stew", Name: "Ragoût forestier", Category: "conso", Building: "kitchen", BuildingLevel: 2, OutputType: "aliment", PACost: 1,
		Ingredients: []Item{{"plante", "Champignon", 1}, {"animal", "Viande", 1}}, Effects: "Restaure la faim (+50)"},
	{ID: "ambrosia", Name: "Ambroisie", Category: "conso", Building: "kitchen", BuildingLevel: 3, OutputType: "aliment", PACost: 2,
		Ingredients: []Item{{"plante", "Baie sauvage", 2}, {"plante", "Fleur", 1}, {"plante", "Sève de dryade", 1}}, Effects: "Nectar des dieux : retire TOUS les états"},
	// --- alchimie (potions) ---
	{ID: "healing_potion", Name: "Potion de soin", Category: "potion", Building: "kitchen", BuildingLevel: 1, OutputType: "consommable", Field: true, PACost: 1,
		Ingredients: []Item{{"plante", "Herbe médicinale", 2}}, Effects: "+8 PV, retire Blessé"},
	{ID: "slime_balm", Name: "Baume de gelée", Category: "potion", Building: "kitchen", BuildingLevel: 1, OutputType: "consommable", Field: true, PACost: 1,
		Ingredients: []Item{{"animal", "Gelée de slime", 1}, {"plante", "Herbe médicinale", 1}}, Effects: "+5 PV (ne retire pas Blessé)"},
	{ID: "sap_elixir", Name: "Élixir de sève", Category: "potion", Building: "kitchen", BuildingLevel: 2, OutputType: "consommable", PACost: 1,
		Ingredients: []Item{{"plante", "Sève de dryade", 1}, {"plante", "Herbe médicinale", 1}}, Effects: "+10 PV, retire Blessé"},
	{ID: "agility_potion", Name: "Potion d'agilité", Category: "potion", Building: "kitchen", BuildingLevel: 2, OutputType: "consommable", PACost: 1,
		Ingredients: []Item{{"objet", "Essence de vent", 1}, {"plante", "Herbe médicinale", 1}}, Effects: "+2 agilité pendant 1 combat"},
	{ID: "frost_talisman", Name: "Talisman de givre", Category: "potion", Building: "workshop", BuildingLevel: 3, OutputType: "consommable", PACost: 2,
		Ingredients: []Item{{"minerai", "Givre éternel", 1}, {"objet", "Soie cristalline", 1}}, Effects: "Immunise au froid et à la Soif pendant 1 jour"},
	// --- transformations (forge/atelier) ---
	{ID: "plank", Name: "Planche", Category: "forge", Building: "workshop", BuildingLevel: 1, OutputType: "objet", OutputQty: 2, PACost: 1,
		Ingredients: []Item{{"objet", "Bois", 2}}, Effects: "Matériau : améliorations Townhall/Bank"},
	{ID: "rope", Name: "Corde", Category: "forge", Building: "workshop", BuildingLevel: 1, OutputType: "objet", PACost: 1,
		Ingredients: []Item{{"plante", "Fibre végétale", 2}}, Effects: "Matériau : améliorations Tower, équipements"},
	{ID: "brick", Name: "Brique", Category: "forge", Building: "workshop", BuildingLevel: 1, OutputType: "minerai", OutputQty: 2, PACost: 1,
		Ingredients: []Item{{"minerai", "Pierre", 2}}, Effects: "Matériau : améliorations Wall/Well"},
	{ID: "leather", Name: "Cuir", Category: "forge", Building: "workshop", BuildingLevel: 1, OutputType: "objet", PACost: 1,
		Ingredients: []Item{{"animal", "Peau", 2}}, Effects: "Matériau : équipements"},
	{ID: "steel", Name: "Acier", Category: "forge", Building: "workshop", BuildingLevel: 2, OutputType: "minerai", PACost: 2,
		Ingredients: []Item{{"minerai", "Minerai de fer", 1}, {"minerai", "Charbon", 1}}, Effects: "Alliage : Gate niv.3, Workshop niv.3"},
	// --- recyclage des débris (RECYCLERIE, à construire) : les broutilles ramassées
	// sur les cases épuisées redeviennent des matériaux de base — 3 débris + 1 PA. ---
	{ID: "recycle_wood", Name: "Recyclage → Bois", Category: "forge", Building: "recyclerie", BuildingLevel: 1, OutputType: "objet", OutputName: "Bois", OutputQty: 1, PACost: 1,
		Ingredients: []Item{{"objet", "Débris", 3}}, Effects: "Recycle 3 débris en 1 Bois"},
	{ID: "recycle_stone", Name: "Recyclage → Pierre", Category: "forge", Building: "recyclerie", BuildingLevel: 1, OutputType: "minerai", OutputName: "Pierre", OutputQty: 1, PACost: 1,
		Ingredients: []Item{{"objet", "Débris", 3}}, Effects: "Recycle 3 débris en 1 Pierre"},
	// --- armes & équipements ---
	{ID: "iron_blade", Name: "Lame de fer", Category: "forge", Building: "workshop", BuildingLevel: 1, OutputType: "arme", PACost: 2,
		Ingredients: []Item{{"minerai", "Minerai de fer", 2}, {"objet", "Bois", 1}}, Effects: "Arme : +3 force en combat"},
	{ID: "fang_dagger", Name: "Dague en croc", Category: "forge", Building: "workshop", BuildingLevel: 1, OutputType: "arme", PACost: 2,
		Ingredients: []Item{{"animal", "Croc", 2}, {"objet", "Corde", 1}}, Effects: "Arme : +2 force en combat"},
	{ID: "silver_blade", Name: "Lame d'argent", Category: "forge", Building: "workshop", BuildingLevel: 2, OutputType: "arme", PACost: 2,
		Ingredients: []Item{{"minerai", "Minerai d'argent", 2}, {"objet", "Bois", 1}}, Effects: "+2 force, +4 contre créatures maudites (loups-garous)"},
	{ID: "sylvan_bow", Name: "Arc sylvestre", Category: "forge", Building: "workshop", BuildingLevel: 2, OutputType: "arme", PACost: 2,
		Ingredients: []Item{{"objet", "Bois", 2}, {"objet", "Soie cristalline", 1}}, Effects: "Arme à distance : attaque portée 3 en combat"},
	{ID: "boar_lance", Name: "Lance de sanglier", Category: "forge", Building: "workshop", BuildingLevel: 2, OutputType: "arme", PACost: 2,
		Ingredients: []Item{{"animal", "Défense de sanglier", 1}, {"objet", "Bois", 2}}, Effects: "+3 force, portée 2 (relique du Roi Gobelin)"},
	// LES ARMES D'UN THÈME (theme.go) : un AUTRE CHEMIN vers une puissance connue, pas
	// une puissance de plus (voir Equipment). Elles ne sont gatées par aucun test de
	// thème — c'est leur MATÉRIAU qui les rend plausibles là où le thème le fournit :
	// le verre des dunes ne tombe que sur le sable d'une carte désertique
	// (ThemeDef.ExtraDrops), le givre éternel demande de la neige, et une carte
	// tempérée en porte trois tuiles. Gater par la matière plutôt que par un `if
	// theme ==` garde le catalogue lisible et n'invente aucune règle nouvelle.
	{ID: "glass_khopesh", Name: "Khopesh de verre", Category: "forge", Building: "workshop", BuildingLevel: 2, OutputType: "arme", PACost: 2,
		Ingredients: []Item{{"minerai", "Verre du désert", 2}, {"objet", "Bois", 1}}, Effects: "+3 force en combat (lame de verre volcanique)"},
	{ID: "frost_harpoon", Name: "Harpon de givre", Category: "forge", Building: "workshop", BuildingLevel: 2, OutputType: "arme", PACost: 2,
		Ingredients: []Item{{"minerai", "Givre éternel", 2}, {"objet", "Bois", 2}}, Effects: "+2 force, portée 2 — le fer de lance des grèves gelées"},
	{ID: "feather_cloak", Name: "Cape de plumes", Category: "forge", Building: "workshop", BuildingLevel: 2, OutputType: "arme", PACost: 2,
		Ingredients: []Item{{"animal", "Plume de harpie", 3}, {"objet", "Cuir", 1}}, Effects: "Équipement : +2 agilité (esquive)"},
	{ID: "werewolf_cloak", Name: "Cape de garou", Category: "forge", Building: "workshop", BuildingLevel: 2, OutputType: "arme", PACost: 2,
		Ingredients: []Item{{"animal", "Fourrure maudite", 1}, {"objet", "Cuir", 1}}, Effects: "Équipement : +2 endurance"},
	{ID: "leather_armor", Name: "Armure de cuir", Category: "forge", Building: "workshop", BuildingLevel: 2, OutputType: "arme", PACost: 2,
		Ingredients: []Item{{"objet", "Cuir", 2}, {"objet", "Corde", 1}}, Effects: "Équipement : -2 dégâts subis en combat"},
	// --- déco : LA FAVEUR DES DIEUX (mythic.go) ---
	//
	// Ces recettes annonçaient « moral de la ville » — un système qui n'a jamais existé
	// dans le code. Elles versent désormais de la FAVEUR : orner le bourg attire le
	// regard des dieux, et la ville dépense cette faveur en bénédictions votées au
	// Temple. ⚠ elles se paient en BOIS, en PIERRE et en minerais — c'est-à-dire dans la
	// même bourse que la muraille, les remparts et (au nord) les foyers. La ferveur doit
	// coûter quelque chose à la défense, sinon ce n'est pas un choix.
	//
	// Le barème suit la rareté de la matière : trois faveurs pour du bois brut, dix pour
	// de l'or. Un dieu coûte BlessingCost (20).
	{ID: "wooden_totem", Name: "Totem de bois", Category: "deco", Building: "workshop", BuildingLevel: 1, OutputType: "deco", PACost: 1, Favor: 3,
		Ingredients: []Item{{"objet", "Bois", 3}}, Effects: "Offrande : +3 faveur des dieux"},
	{ID: "carved_stele", Name: "Stèle gravée", Category: "deco", Building: "workshop", BuildingLevel: 1, OutputType: "deco", PACost: 1, Favor: 3,
		Ingredients: []Item{{"minerai", "Pierre", 3}}, Effects: "Offrande : +3 faveur des dieux"},
	{ID: "flower_wreath", Name: "Couronne de fleurs", Category: "deco", Building: "kitchen", BuildingLevel: 1, OutputType: "deco", PACost: 1, Favor: 2,
		Ingredients: []Item{{"plante", "Fleur", 2}, {"plante", "Fibre végétale", 1}}, Effects: "Offrande : +2 faveur des dieux"},
	{ID: "votive_brazier", Name: "Brasero votif", Category: "deco", Building: "workshop", BuildingLevel: 2, OutputType: "deco", PACost: 2, Favor: 6,
		Ingredients: []Item{{"minerai", "Brique", 1}, {"minerai", "Charbon", 1}}, Effects: "Offrande : +6 faveur des dieux"},
	{ID: "golden_amulet", Name: "Amulette dorée", Category: "deco", Building: "workshop", BuildingLevel: 3, OutputType: "deco", PACost: 2, Favor: 10,
		Ingredients: []Item{{"minerai", "Minerai d'or", 1}, {"objet", "Corde", 1}}, Effects: "Offrande précieuse : +10 faveur des dieux"},
}

// RecipeByID returns the recipe with the given id, or nil.
func RecipeByID(id string) *Recipe {
	for i := range Recipes {
		if Recipes[i].ID == id {
			return &Recipes[i]
		}
	}
	return nil
}

func heroItemQty(h *Hero, name string) int {
	for _, it := range h.Inventory {
		if it.Name == name {
			return it.Qty
		}
	}
	return 0
}

func removeHeroItem(h *Hero, name string, qty int) {
	out := h.Inventory[:0]
	for _, it := range h.Inventory {
		if it.Name == name {
			it.Qty -= qty
			if it.Qty <= 0 {
				continue
			}
		}
		out = append(out, it)
	}
	h.Inventory = out
}

// Craft makes a recipe. The acting hero (heroID) determines the context:
//   - in town  -> the required building must be BUILT at BuildingLevel or more;
//     ingredients from the Bank, output to the Bank;
//   - in field -> ingredients from the hero's bag, output to the bag (Field recipes
//     only — a campfire needs no building).
//
// Either way the hero pays the PA cost.
func (g *GameState) Craft(recipeID, heroID string) (*Item, error) {
	h := g.HeroByID(heroID)
	if h == nil || h.HP <= 0 {
		return nil, ActionError{"héros invalide"}
	}
	r := RecipeByID(recipeID)
	if r == nil {
		return nil, ActionError{"recette inconnue"}
	}
	inTown := h.X == g.Town.X && h.Y == g.Town.Y
	if !inTown && !r.Field {
		return nil, ActionError{r.Name + " nécessite un bâtiment de la ville (atelier/forge)"}
	}
	// Town crafting goes through the recipe's building — it must exist at the level
	// the design asks for (Kitchen niv.2 = plats raffinés, Workshop niv.3 = pièces
	// avancées…). Field crafting (campfire) skips the requirement.
	if inTown && r.Building != "" {
		b := g.buildingByID(r.Building)
		if b == nil || !b.Built {
			return nil, ActionError{r.Name + " nécessite le bâtiment " + r.Building}
		}
		lvl := r.BuildingLevel
		if lvl < 1 {
			lvl = 1
		}
		if b.Level < lvl {
			return nil, ActionError{fmt.Sprintf("%s nécessite %s niveau %d", r.Name, b.Label(), lvl)}
		}
	}

	// Check ingredients against the right source.
	for _, ing := range r.Ingredients {
		var have int
		if inTown {
			have = g.storageQty(ing.Name)
		} else {
			have = heroItemQty(h, ing.Name)
		}
		if have < ing.Qty {
			where := "le sac"
			if inTown {
				where = "la Banque"
			}
			return nil, ActionError{"ingrédient manquant dans " + where + " : " + ing.Name}
		}
	}
	if h.PA < r.PACost {
		return nil, ActionError{"PA insuffisants pour " + h.Name}
	}

	h.PA -= r.PACost
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	name := r.OutputName
	if name == "" {
		name = r.Name
	}
	qty := r.OutputQty
	if qty < 1 {
		qty = 1
	}
	qty += g.craftYieldBonus(r)
	out := Item{Type: r.OutputType, Name: name, Qty: qty}
	if inTown {
		for _, ing := range r.Ingredients {
			g.removeStorage(ing.Name, ing.Qty)
		}
		g.addStorage(out)
		g.credit(h.ID, func(c *Contribution) { c.Crafted += out.Qty })
		g.logTown("⚒️ " + h.Name + " a fabriqué " + r.Name + " (ingrédients de la Banque)")
		// LA FAVEUR (mythic.go) : une offrande fabriquée EN VILLE orne le bourg. Au
		// feu de camp elle n'orne rien — et les recettes de déco sont de toute façon
		// gatées sur l'Atelier ou la Cuisine, donc ce cas ne se présente pas ; la
		// garde reste, parce que le catalogue est modifiable et que la règle est « la
		// ville, pas le sac ».
		g.grantFavor(r.Favor*out.Qty, h.Name, r.Name)
	} else {
		for _, ing := range r.Ingredients {
			removeHeroItem(h, ing.Name, ing.Qty)
		}
		h.AddLoot(out)
	}
	return &out, nil
}

// craftYieldBonus : ce que le NIVEAU de l'atelier ajoute à une fournée.
//
// Les niveaux 2 et 3 de la Recyclerie annonçaient « recyclage plus efficace » puis
// « recyclage optimisé » — et ne faisaient RIEN : du texte dans le catalogue de design,
// zéro ligne de code. Un niveau qu'on paie en PA et en matériaux doit se voir. Une
// recyclerie améliorée tire donc une unité de plus par palier des mêmes débris, ce qui
// est exactement la réponse du design à une carte qui se vide.
//
// Réservé au bâtiment dont c'est la raison d'être : élargir ce bonus à toutes les
// recettes ferait de l'Atelier une machine à dupliquer l'acier.
func (g *GameState) craftYieldBonus(r *Recipe) int {
	if r == nil || r.Building != "recyclerie" {
		return 0
	}
	b := g.buildingByID("recyclerie")
	if b == nil || !b.Built || b.Durability <= 0 {
		return 0
	}
	return b.Level - 1
}
