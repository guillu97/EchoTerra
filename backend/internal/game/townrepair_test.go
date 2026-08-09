package game

import "testing"

// Relever les remparts : la ville se répare en PA ET en pierre.
//
// Avant cette action, Town.HP ne pouvait que DESCENDRE — les bâtiments se restauraient,
// la ville non. Toute partie était donc un compte à rebours dont l'issue ne dépendait
// pas des joueurs, et la simulation de balance le montrait sans ambiguïté (voir
// internal/balance). C'est aussi ce qui déplace la vraie limite d'une longue partie
// vers l'épuisement de la carte, comme le veut le design.
func TestTownRepairSpendsStoneAndHeals(t *testing.T) {
	g, h, _ := newTetaniseGame(1)
	g.TileAt(h.X, h.Y).MonsterID = ""
	g.Monsters = map[string]*Monster{}
	g.Town.X, g.Town.Y = h.X, h.Y
	g.Town.HP = 60
	g.Recompute()

	// Sans pierre, l'action est refusée et rien n'est dépensé.
	paBefore := h.PA
	if err := g.TownAction("wall", "repair", 2, h.ID); err == nil {
		t.Fatal("repairing without stone must be refused")
	}
	if h.PA != paBefore || g.Town.HP != 60 {
		t.Fatalf("a refused repair must cost nothing: PA %d->%d, HP %d", paBefore, h.PA, g.Town.HP)
	}

	g.addStorage(Item{Type: "minerai", Name: TownRepairMaterial, Qty: 5})
	if err := g.TownAction("wall", "repair", 2, h.ID); err != nil {
		t.Fatalf("repair should succeed with stone banked: %v", err)
	}
	if want := 60 + 2*TownRepairHP; g.Town.HP != want {
		t.Fatalf("town HP = %d, want %d", g.Town.HP, want)
	}
	if got := g.storageQty(TownRepairMaterial); got != 3 {
		t.Fatalf("stone left = %d, want 3 (one per action point)", got)
	}
	if h.PA != paBefore-2 {
		t.Fatalf("PA = %d, want %d", h.PA, paBefore-2)
	}
}

// La réparation ne dépasse jamais le maximum, et ne consomme que la pierre réellement
// utile : demander 10 points sur une ville à 5 PV du plein n'en dépense qu'un.
func TestTownRepairClampsToMissingHP(t *testing.T) {
	g, h, _ := newTetaniseGame(1)
	g.TileAt(h.X, h.Y).MonsterID = ""
	g.Monsters = map[string]*Monster{}
	g.Town.X, g.Town.Y = h.X, h.Y
	g.Town.HP = g.Town.MaxHP - TownRepairHP
	g.addStorage(Item{Type: "minerai", Name: TownRepairMaterial, Qty: 10})
	g.Recompute()

	if err := g.TownAction("wall", "repair", 10, h.ID); err != nil {
		t.Fatalf("repair: %v", err)
	}
	if g.Town.HP != g.Town.MaxHP {
		t.Fatalf("town HP = %d, want %d", g.Town.HP, g.Town.MaxHP)
	}
	if got := g.storageQty(TownRepairMaterial); got != 9 {
		t.Fatalf("stone left = %d, want 9 — only the useful point should be paid", got)
	}
	if err := g.TownAction("wall", "repair", 1, h.ID); err == nil {
		t.Fatal("repairing an intact town must be refused")
	}
}
