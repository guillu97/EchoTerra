package game

import "testing"

// Recyclage : l'Atelier transforme les DÉBRIS (ramassés sur les cases épuisées) en
// matériaux de base — 3 débris + 1 PA → 1 Bois / 1 Pierre.
func TestRecycleDebrisIntoMaterials(t *testing.T) {
	g := &GameState{Width: 3, Height: 3, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 9)
	g.Town.X, g.Town.Y = 1, 1
	g.Town.Buildings = DefaultBuildings() // Workshop construit niv.1 au départ
	g.Town.Storage = []Item{{Type: "objet", Name: "Débris", Qty: 7}}
	h := &Hero{ID: "h", Name: "Test", X: 1, Y: 1, HP: 20, MaxHP: 20, PA: 6, MaxPA: 6, Bars: map[string]int{}}
	g.Heroes = []*Hero{h}

	out, err := g.Craft("recycle_wood", "h")
	if err != nil {
		t.Fatalf("recycle_wood: %v", err)
	}
	if out.Name != "Bois" || out.Qty != 1 {
		t.Fatalf("attendu 1 Bois, obtenu %+v", out)
	}
	if q := g.storageQty("Débris"); q != 4 {
		t.Fatalf("3 débris consommés (7→4), reste %d", q)
	}
	if q := g.storageQty("Bois"); q != 1 {
		t.Fatalf("la Banque doit contenir 1 Bois, a %d", q)
	}
	if h.PA != 5 {
		t.Fatalf("le recyclage coûte 1 PA (6→5), reste %d", h.PA)
	}

	if _, err := g.Craft("recycle_stone", "h"); err != nil {
		t.Fatalf("recycle_stone: %v", err)
	}
	if q := g.storageQty("Pierre"); q != 1 {
		t.Fatalf("la Banque doit contenir 1 Pierre, a %d", q)
	}

	// pas assez de débris → refus
	g.Town.Storage = []Item{{Type: "objet", Name: "Débris", Qty: 2}}
	if _, err := g.Craft("recycle_wood", "h"); err == nil {
		t.Fatal("recyclage avec 2 débris (<3) doit échouer")
	}
}
