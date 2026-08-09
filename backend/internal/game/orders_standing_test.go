package game

import (
	"testing"
	"time"
)

// standingWorld : une ville, un héros posté dehors avec du butin.
func standingWorld(t *testing.T, dist int) (*GameState, *Hero) {
	t.Helper()
	g, ana, _ := twoPlayerTown(t)
	h := g.HeroByID(ana.HeroIDs[0])
	h.X, h.Y = g.Town.X+dist, g.Town.Y
	h.AddLoot(Item{Type: "objet", Name: "Bois", Qty: 4})
	// Les coéquipiers ne doivent pas brouiller la lecture.
	for _, id := range ana.HeroIDs[1:] {
		o := g.HeroByID(id)
		o.PA = 0
	}
	g.Recompute()
	return g, h
}

// « Se cacher avant la vague » : la consigne qui sauve une soirée manquée. Se cacher
// fait sauter l'attaque de la vague, et c'est tout ce qu'on demande à un filet.
func TestShelterOrderHidesTheHeroBeforeTheWave(t *testing.T) {
	g, h := standingWorld(t, 4)
	if err := g.SetHeroOrder(h.ID, OrderShelter); err != nil {
		t.Fatal(err)
	}
	hp := h.HP
	g.ForceWave(time.Now())

	if h.HP != hp {
		t.Fatalf("un héros caché ne doit pas être frappé : %d -> %d", hp, h.HP)
	}
	// …et la consigne est CONSOMMÉE : il faut revenir pour la reposer. C'est ce qui
	// sépare un filet d'un pilote automatique.
	if h.Order != OrderNone {
		t.Fatalf("la consigne doit être consommée, got %q", h.Order)
	}
}

// « Rentrer et déposer » : le héros marche vers la ville avec les PA qui lui restent,
// et vide son sac s'il arrive.
func TestReturnOrderWalksHomeAndBanksTheLoot(t *testing.T) {
	g, h := standingWorld(t, 3)
	h.PA = 6
	if err := g.SetHeroOrder(h.ID, OrderReturn); err != nil {
		t.Fatal(err)
	}
	g.ForceWave(time.Now())

	if h.X != g.Town.X || h.Y != g.Town.Y {
		t.Fatalf("le héros devait rentrer, il est en (%d,%d)", h.X, h.Y)
	}
	if len(h.Inventory) != 0 || g.storageQty("Bois") < 4 {
		t.Fatalf("il devait déposer son sac : sac=%d banque=%d", len(h.Inventory), g.storageQty("Bois"))
	}
}

// Trop loin pour rentrer : la consigne se rabat sur la dissimulation. Rentrer était
// l'intention, survivre était le but.
func TestReturnOrderFallsBackToHidingWhenTownIsOutOfReach(t *testing.T) {
	g, h := standingWorld(t, 5)
	h.PA = 2 // deux pas, cinq à faire
	if err := g.SetHeroOrder(h.ID, OrderReturn); err != nil {
		t.Fatal(err)
	}
	hp := h.HP
	g.ForceWave(time.Now())

	if h.X == g.Town.X && h.Y == g.Town.Y {
		t.Fatal("staging: il ne devait pas pouvoir rentrer")
	}
	if h.HP != hp {
		t.Fatalf("faute de rentrer, il devait se cacher : PV %d -> %d", hp, h.HP)
	}
}

// UNE VAGUE, PAS DEUX. Sans ce plafond, un joueur poserait une consigne et le jeu se
// jouerait sans lui — on aurait résolu la rétention en supprimant le jeu.
func TestAnOrderLastsExactlyOneWave(t *testing.T) {
	g, h := standingWorld(t, 4)
	if err := g.SetHeroOrder(h.ID, OrderShelter); err != nil {
		t.Fatal(err)
	}
	g.ForceWave(time.Now())
	if h.Order != OrderNone {
		t.Fatal("la consigne doit être consommée par la première vague")
	}
	hp := h.HP
	g.ForceWave(time.Now()) // seconde vague, plus de consigne
	if h.HP >= hp {
		t.Fatal("sans consigne reposée, le héros doit encaisser la vague suivante")
	}
}

// Un joueur PRÉSENT fait strictement mieux : la consigne ne fouille pas, ne bâtit pas,
// ne combat pas. Elle dépense les PA en aveugle.
func TestAnOrderNeverFightsNorGathers(t *testing.T) {
	g, h := standingWorld(t, 2)
	tile := g.TileAt(h.X, h.Y)
	tile.Resources = 5
	// Un pack sur la case voisine : la consigne ne doit pas aller le chercher.
	m := NewMonster("Slime Vorace", h.X+1, h.Y)
	m.Count = 2
	g.Monsters[m.ID] = m
	g.TileAt(m.X, m.Y).MonsterID = m.ID
	res := tile.Resources
	if err := g.SetHeroOrder(h.ID, OrderShelter); err != nil {
		t.Fatal(err)
	}
	g.ForceWave(time.Now())

	if tile.Resources != res {
		t.Fatal("une consigne ne fouille pas")
	}
	if len(g.Combats) != 0 {
		t.Fatal("une consigne n'engage jamais de combat")
	}
}

// Un héros tétanisé ne peut ni fuir ni se cacher : la consigne le dit au journal
// plutôt que de faire semblant.
func TestAPinnedHeroOrderFailsHonestly(t *testing.T) {
	g, h := standingWorld(t, 3)
	m := NewMonster("Slime Vorace", h.X, h.Y)
	m.Count = 40
	g.Monsters[m.ID] = m
	g.TileAt(h.X, h.Y).MonsterID = m.ID
	g.Recompute()
	if !h.HasState(StateTetanise) {
		t.Fatal("staging: le héros doit être tétanisé")
	}
	if err := g.SetHeroOrder(h.ID, OrderShelter); err != nil {
		t.Fatal(err)
	}
	g.ForceWave(time.Now())
	if h.HasState(StateCache) {
		t.Fatal("un tétanisé ne peut pas se cacher — la consigne ne doit pas contourner la règle")
	}
}
