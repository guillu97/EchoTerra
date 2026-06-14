package game

// Recipe is a craftable item. In town it consumes ingredients from the shared Maison
// storage and outputs back there; in the field (no town building) a "Field" recipe
// consumes the crafting hero's own bag and outputs to it. Paid with the hero's PA.
type Recipe struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Category    string `json:"category"`   // conso | potion | forge | deco
	Building    string `json:"building"`   // kitchen | workshop
	OutputType  string `json:"outputType"` // aliment | consommable | arme | deco
	Field       bool   `json:"field"`      // craftable outside town (campfire-style)
	PACost      int    `json:"paCost"`
	Ingredients []Item `json:"ingredients"`
}

// Recipes is the prototype crafting catalog. Kitchen recipes are field-craftable
// (a campfire is enough); forge/workshop recipes need the town buildings.
var Recipes = []Recipe{
	{ID: "mapo_curry", Name: "Mapo Curry", Category: "conso", Building: "kitchen", OutputType: "aliment", Field: true, PACost: 1,
		Ingredients: []Item{{Type: "animal", Name: "Viande", Qty: 2}, {Type: "plante", Name: "Fleur", Qty: 1}}},
	{ID: "orange_juice", Name: "Jus de fruit", Category: "conso", Building: "kitchen", OutputType: "aliment", Field: true, PACost: 1,
		Ingredients: []Item{{Type: "plante", Name: "Fleur", Qty: 2}}},
	{ID: "healing_potion", Name: "Potion de soin", Category: "potion", Building: "kitchen", OutputType: "consommable", Field: true, PACost: 1,
		Ingredients: []Item{{Type: "plante", Name: "Herbe médicinale", Qty: 2}}},
	{ID: "iron_blade", Name: "Lame de fer", Category: "forge", Building: "workshop", OutputType: "arme", Field: false, PACost: 2,
		Ingredients: []Item{{Type: "minerai", Name: "Minerai de fer", Qty: 2}, {Type: "objet", Name: "Bois", Qty: 1}}},
	{ID: "wooden_totem", Name: "Totem de bois", Category: "deco", Building: "workshop", OutputType: "deco", Field: false, PACost: 1,
		Ingredients: []Item{{Type: "objet", Name: "Bois", Qty: 3}}},
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
//   - in town  -> ingredients from the Maison, output to the Maison;
//   - in field -> ingredients from the hero's bag, output to the bag (Field recipes only).
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
				where = "la Maison"
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
	out := Item{Type: r.OutputType, Name: r.Name, Qty: 1}
	if inTown {
		for _, ing := range r.Ingredients {
			g.removeStorage(ing.Name, ing.Qty)
		}
		g.addStorage(out)
	} else {
		for _, ing := range r.Ingredients {
			removeHeroItem(h, ing.Name, ing.Qty)
		}
		h.AddLoot(out)
	}
	return &out, nil
}
