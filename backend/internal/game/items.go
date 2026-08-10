package game

// L'USAGE DES OBJETS — ce que le sac sert enfin à faire.
//
// Le trou que ça bouche : le catalogue portait VINGT-SIX recettes dont les effets
// n'étaient que du texte. « Potion de soin : +8 PV, retire Blessé », « Ragoût forestier :
// restaure la faim » — rien ne consommait quoi que ce soit. On récoltait, on cuisinait,
// et le résultat dormait en Banque. Toute la moitié « cuisine et alchimie » du jeu était
// décorative, et la seule ligne de vie d'un héros abîmé était de mourir puis d'être
// ressuscité.
//
// ⚠ LA FAIM N'EXISTE PAS dans le jeu (elle est au GDD, pas dans le code). Un plat ne
// « restaure la faim » donc pas : il rend des POINTS D'ACTION, la vraie monnaie d'une
// journée de héros — exactement comme la Ration d'eau (RationPA), dont ce fichier
// généralise le geste. C'est une traduction honnête plutôt qu'un système de faim bâclé,
// et elle donne d'un coup un usage à la Cuisine, aux baies et au gibier.
//
// ⚠ GRATUIT EN PA, comme boire. Ce qui borne l'usage d'un objet, c'est l'objet lui-même :
// il a fallu le récolter, souvent le cuisiner, et il disparaît. Facturer un PA pour
// récupérer des PA n'aurait servi qu'à rendre les petits plats inutiles.

// ItemEffect est ce qu'un objet fait quand un héros l'utilise.
// ⚠ TAGS JSON OBLIGATOIRES : cette table est SERVIE au client (GET /api/items) et le
// reste du DTO est en minuscule. Sans eux, Go sérialisait `PA`/`Desc` et le client lisait
// `undefined` — le libellé de l'objet arrivait vide dans l'interface.
type ItemEffect struct {
	PA        int      `json:"pa"`                  // points d'action rendus (plafonnés à MaxPA)
	HP        int      `json:"hp"`                  // points de vie rendus (plafonnés à MaxHP)
	Clears    []string `json:"clears,omitempty"`    // états retirés
	ClearsAll bool     `json:"clearsAll,omitempty"` // retire TOUS les états (Ambroisie)
	Desc      string   `json:"desc"`                // ce que le joueur lit
}

// ItemEffects : le catalogue de ce qui se CONSOMME. Les valeurs suivent les effets
// annoncés par les recettes (craft.go) et par le catalogue d'objets du Studio.
//
// Les proportions : une Ration d'eau rend RationPA (6). Un plat cuisiné vaut donc de 3 à
// 5 — moins qu'une gorgée d'eau franche, mais on peut en porter plusieurs. Un aliment
// BRUT (baie, viande crue) rend 1 : c'est un dépannage, pas un repas, et ça laisse à la
// Cuisine sa raison d'être.
var ItemEffects = map[string]ItemEffect{
	// — Cuisine (recettes `conso`)
	"Ragoût forestier":   {PA: 5, Clears: []string{StateFatigue}, Desc: "un vrai repas : +5 PA"},
	"Mapo Curry":         {PA: 4, Clears: []string{StateFatigue}, Desc: "épicé et nourrissant : +4 PA"},
	"Poisson grillé":     {PA: 3, Clears: []string{StateFatigue}, Desc: "+3 PA"},
	"Confiture de baies": {PA: 2, Clears: []string{StateFatigue}, Desc: "+2 PA, se conserve"},
	"Jus de fruit":       {PA: 1, Clears: []string{StateSoif}, Desc: "désaltère (retire Soif)"},
	"Ambroisie":          {PA: 6, HP: 10, ClearsAll: true, Desc: "nectar des dieux : rend tout, retire TOUS les états"},

	// — Alchimie (recettes `potion`). Le SEUL soin portatif du jeu : ailleurs il faut
	// l'Infirmerie, donc être rentré en ville.
	"Potion de soin":  {HP: 8, Clears: []string{"Blessé"}, Desc: "+8 PV, retire Blessé"},
	"Élixir de sève":  {HP: 10, Clears: []string{"Blessé"}, Desc: "+10 PV, retire Blessé"},
	"Baume de gelée":  {HP: 5, Desc: "+5 PV"},
	"Élixir de givre": {PA: 3, Clears: []string{StateSoif}, Desc: "+3 PA, retire Soif"},

	// — Bruts. Manger une baie sur le chemin ne remplace pas un repas, mais ça évite de
	// rentrer bredouille quand il ne reste qu'un point à faire.
	"Baie sauvage": {PA: 1, Desc: "+1 PA"},
	"Champignon":   {PA: 1, Desc: "+1 PA"},
	"Viande":       {PA: 1, Desc: "+1 PA"},
	"Poisson":      {PA: 1, Desc: "+1 PA"},

	// L'eau garde son geste dédié (DrinkRation, boutons 💧) mais passe par la même table :
	// deux chemins pour un même objet finiraient par diverger.
	"Ration d'eau": {PA: RationPA, Clears: []string{StateFatigue, StateSoif}, Desc: "+6 PA, retire Fatigue et Soif"},
}

// UsableItem reports whether this item can be consumed.
func UsableItem(name string) bool { _, ok := ItemEffects[name]; return ok }

// UseItem fait consommer un objet du sac d'un héros. Gratuit en PA (voir l'en-tête).
//
// Refusé quand ça ne servirait à rien — un objet consommé pour rien est perdu, et le
// joueur ne peut pas le récupérer.
func (g *GameState) UseItem(heroID, name string) (*Hero, *ItemEffect, error) {
	if g.heroInCombat(heroID) != nil {
		return nil, nil, ActionError{"ce héros est en plein combat"}
	}
	h := g.HeroByID(heroID)
	if h == nil || h.HP <= 0 {
		return nil, nil, ActionError{"héros introuvable"}
	}
	eff, ok := ItemEffects[name]
	if !ok {
		return nil, nil, ActionError{name + " ne se consomme pas"}
	}
	// OÙ L'ON PREND L'OBJET. Dans le sac du héros ; et À DÉFAUT, s'il est EN VILLE, dans
	// la Banque — on se restaure sur place, comme à une cantine.
	//
	// ⚠ CE N'EST PAS UN RETRAIT. La Banque n'a qu'une sortie vers un joueur, la requête du
	// Panneau, et elle exige d'être DEUX (requests.go) : c'est une règle de coopération,
	// pas une friction à contourner. Consommer sur place ne fait sortir aucun objet des
	// murs — pour emporter une potion en expédition, il faut toujours qu'un coéquipier
	// honore votre demande. Sans cette porte, en revanche, tout ce que la Cuisine et
	// l'Alchimie produisent restait bloqué en Banque : les vivres allaient dans le stock
	// commun et personne ne pouvait jamais y toucher.
	inTown := h.X == g.Town.X && h.Y == g.Town.Y
	fromBank := heroItemQty(h, name) < 1
	if fromBank && !(inTown && g.storageQty(name) > 0) {
		return nil, nil, ActionError{h.Name + " n'a pas « " + name + " » dans son sac"}
	}
	if !g.itemWouldHelp(h, eff) {
		return nil, nil, ActionError{"cela ne servirait à rien maintenant — " + h.Name + " est déjà au mieux"}
	}
	if fromBank {
		g.removeStorage(name, 1)
		g.logTown("🍽️ " + h.Name + " a consommé « " + name + " » sur la réserve commune")
	} else {
		removeHeroItem(h, name, 1)
	}
	if eff.PA > 0 {
		if h.PA += eff.PA; h.PA > h.MaxPA {
			h.PA = h.MaxPA
		}
	}
	if eff.HP > 0 {
		if h.HP += eff.HP; h.HP > h.MaxHP {
			h.HP = h.MaxHP
		}
	}
	if eff.ClearsAll {
		h.States = nil
	} else {
		for _, st := range eff.Clears {
			h.RemoveState(st)
		}
	}
	// ⚠ Tétanisé ne se soigne PAS en mangeant : c'est un pack qui cloue le héros, pas une
	// fatigue. Le rendre par une potion viderait de son sens la seule vraie menace de la
	// carte. (ClearsAll de l'Ambroisie le retire bien — c'est son prix et sa rareté.)
	if !eff.ClearsAll {
		g.recomputeTetanise()
	}
	return h, &eff, nil
}

// itemWouldHelp : cet objet changerait-il quelque chose pour ce héros ?
func (g *GameState) itemWouldHelp(h *Hero, eff ItemEffect) bool {
	if eff.PA > 0 && h.PA < h.MaxPA {
		return true
	}
	if eff.HP > 0 && h.HP < h.MaxHP {
		return true
	}
	if eff.ClearsAll && len(h.States) > 0 {
		return true
	}
	for _, st := range eff.Clears {
		if h.HasState(st) {
			return true
		}
	}
	return false
}
