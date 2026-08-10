package game

import "testing"

// L'USAGE DES OBJETS — le catalogue portait vingt-six recettes dont les effets n'étaient
// que du TEXTE. On récoltait, on cuisinait, et le résultat dormait en Banque.

func TestUsingAPotionHealsAndClearsWounded(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	h := g.HeroByID(ana.HeroIDs[0])
	h.HP = 1
	h.AddState("Blessé")
	h.AddLoot(Item{Type: "consommable", Name: "Potion de soin", Qty: 2})

	_, eff, err := g.UseItem(h.ID, "Potion de soin")
	if err != nil {
		t.Fatal(err)
	}
	want := 1 + eff.HP
	if want > h.MaxHP {
		want = h.MaxHP
	}
	if h.HP != want {
		t.Fatalf("PV attendus %d, obtenus %d", want, h.HP)
	}
	if h.HasState("Blessé") {
		t.Fatal("la potion doit retirer Blessé")
	}
	if heroItemQty(h, "Potion de soin") != 1 {
		t.Fatal("l'objet doit être consommé, une seule fois")
	}
}

// Un objet consommé pour rien est PERDU, et le joueur ne peut pas le récupérer : on
// refuse plutôt que de gaspiller.
func TestUsingAnItemThatWouldChangeNothingIsRefused(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	h := g.HeroByID(ana.HeroIDs[0])
	h.HP, h.PA = h.MaxHP, h.MaxPA
	h.AddLoot(Item{Type: "aliment", Name: "Ragoût forestier", Qty: 1})
	if _, _, err := g.UseItem(h.ID, "Ragoût forestier"); err == nil {
		t.Fatal("héros au mieux : ne pas gâcher le plat")
	}
	if heroItemQty(h, "Ragoût forestier") != 1 {
		t.Fatal("un usage refusé ne consomme rien")
	}
	// …et ce qui ne se mange pas ne se mange pas.
	h.AddLoot(Item{Type: "minerai", Name: "Pierre", Qty: 1})
	if _, _, err := g.UseItem(h.ID, "Pierre"); err == nil {
		t.Fatal("une pierre ne se mange pas")
	}
}

// LA CANTINE : en ville on se restaure sur la réserve commune. ⚠ Ce n'est PAS un retrait —
// la seule sortie de la Banque vers un joueur reste la requête du Panneau, qui exige
// d'être deux. Sans cette porte, tout ce que la Cuisine produit restait bloqué en Banque.
func TestAHeroInTownEatsFromTheCommonStoreButCannotCarryItOff(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	h := g.HeroByID(ana.HeroIDs[0])
	h.PA = 0
	g.addStorage(Item{Type: "aliment", Name: "Ragoût forestier", Qty: 2})

	if _, _, err := g.UseItem(h.ID, "Ragoût forestier"); err != nil {
		t.Fatalf("en ville, on mange sur la réserve : %v", err)
	}
	if h.PA == 0 {
		t.Fatal("le plat doit rendre des PA")
	}
	if g.storageQty("Ragoût forestier") != 1 {
		t.Fatal("la réserve commune doit être entamée d'UNE part")
	}
	if heroItemQty(h, "Ragoût forestier") != 0 {
		t.Fatal("rien ne doit passer dans le sac : on consomme sur place")
	}

	// Hors des murs, le sac est la seule ressource : il faut qu'un coéquipier ait
	// honoré une demande (requests.go).
	h.X, h.Y = g.Town.X+2, g.Town.Y
	h.PA = 0
	if _, _, err := g.UseItem(h.ID, "Ragoût forestier"); err == nil {
		t.Fatal("hors de la ville, on ne pioche pas dans la Banque")
	}
}

// ⚠ TÉTANISÉ NE SE MANGE PAS : c'est un pack qui cloue le héros, pas une fatigue. Le
// retirer d'une gorgée viderait de son sens la seule vraie menace de la carte.
func TestFoodDoesNotFreeAPinnedHero(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	h := g.HeroByID(ana.HeroIDs[0])
	h.X, h.Y = g.Town.X+2, g.Town.Y
	m := NewMonster("Slime Vorace", h.X, h.Y)
	m.Count = 40
	g.Monsters[m.ID] = m
	g.TileAt(h.X, h.Y).MonsterID = m.ID
	g.Recompute()
	if !h.HasState(StateTetanise) {
		t.Fatal("staging: le héros doit être tétanisé")
	}
	h.PA = 0
	h.AddLoot(Item{Type: "aliment", Name: "Ragoût forestier", Qty: 1})
	if _, _, err := g.UseItem(h.ID, "Ragoût forestier"); err != nil {
		t.Fatal(err)
	}
	if !h.HasState(StateTetanise) {
		t.Fatal("manger ne libère pas d'un pack")
	}
}

// LES BOTS S'EN SERVENT — sinon les vivres dormiraient toujours en Banque, ce qui était
// exactement le problème.
func TestBotsDrinkAPotionWhenHurtAndEatWhenSpent(t *testing.T) {
	g, bot := botGame(t)
	h := g.HeroByID(bot.HeroIDs[0])
	h.HP = h.MaxHP / 4
	h.AddLoot(Item{Type: "consommable", Name: "Potion de soin", Qty: 1})
	if !g.botUseItem(h) {
		t.Fatal("un bot bien amoché doit boire sa potion")
	}
	if heroItemQty(h, "Potion de soin") != 0 || h.HP <= h.MaxHP/4 {
		t.Fatalf("la potion doit être bue et soigner : PV %d", h.HP)
	}

	// À court de PA : il mange, et il prend le MEILLEUR de son sac.
	h.HP, h.PA = h.MaxHP, 1
	h.AddLoot(Item{Type: "aliment", Name: "Baie sauvage", Qty: 1})
	h.AddLoot(Item{Type: "aliment", Name: "Ragoût forestier", Qty: 1})
	if !g.botUseItem(h) {
		t.Fatal("un bot sans PA doit se restaurer")
	}
	if heroItemQty(h, "Ragoût forestier") != 0 {
		t.Fatal("il doit choisir le plat qui rend le plus")
	}

	// En pleine forme et avec des PA : on ne gaspille rien.
	h.HP, h.PA = h.MaxHP, h.MaxPA
	if g.botUseItem(h) {
		t.Fatal("rien à soigner ni à restaurer : ne rien consommer")
	}
}
