package game

import "testing"

// petit monde de test : 8×8, prairie partout sauf une bande de forêt, ville en (1,1)
func ruinsTestGame() *GameState {
	g := &GameState{ID: "t", Seed: 42, Width: 8, Height: 8, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 64)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: 2, Resources: 3}
	}
	for x := 0; x < 8; x++ {
		g.Tiles[6*8+x].Biome = 3 // rangée de forêt
	}
	g.Town.X, g.Town.Y = 1, 1
	g.Heroes = []*Hero{NewStarterHero(0, "Testeur", 1, 1)}
	return g
}

func TestSeedRuinsDeterministicAndPlaced(t *testing.T) {
	g := ruinsTestGame()
	g.SeedRuins()
	if len(g.Ruins) == 0 {
		t.Fatal("aucune ruine semée")
	}
	// une ruine par biome présent (prairie + forêt ici)
	if g.Ruins["ruin-ferme"] == nil || g.Ruins["ruin-sanctuaire"] == nil {
		t.Fatalf("ruines attendues ferme+sanctuaire, obtenu %v", g.Ruins)
	}
	for id, ru := range g.Ruins {
		tl := g.TileAt(ru.X, ru.Y)
		if tl == nil || tl.RuinID != id {
			t.Fatalf("la tuile de %s ne porte pas son ruinId", id)
		}
	}
	// même seed → mêmes positions ; idempotent
	g2 := ruinsTestGame()
	g2.SeedRuins()
	g2.SeedRuins()
	if g2.Ruins["ruin-ferme"].X != g.Ruins["ruin-ferme"].X || g2.Ruins["ruin-ferme"].Y != g.Ruins["ruin-ferme"].Y {
		t.Fatal("le semis n'est pas déterministe par seed")
	}
	if len(g2.Ruins) != len(g.Ruins) {
		t.Fatal("SeedRuins n'est pas idempotent")
	}
}

func TestClearRuinCollectiveFlow(t *testing.T) {
	g := ruinsTestGame()
	g.SeedRuins()
	ru := g.Ruins["ruin-ferme"]
	h := g.Heroes[0]
	h.X, h.Y = ru.X, ru.Y
	h.PA = 6

	if _, err := g.ExploreRuin(h.ID); err == nil {
		t.Fatal("explorer une ruine non déblayée doit être refusé")
	}
	r1, err := g.ClearRuin(h.ID, 5)
	if err != nil {
		t.Fatalf("clear: %v", err)
	}
	if r1.PaInvested != 5 || h.PA != 1 || r1.Cleared {
		t.Fatalf("après 5 PA : invested=%d pa=%d cleared=%v", r1.PaInvested, h.PA, r1.Cleared)
	}
	// un 2e héros termine le chantier (collectif) — points bornés au restant
	h2 := NewStarterHero(1, "Renfort", ru.X, ru.Y)
	h2.PA = 6
	g.Heroes = append(g.Heroes, h2)
	r2, err := g.ClearRuin(h2.ID, 99)
	if err != nil {
		t.Fatalf("clear 2: %v", err)
	}
	if !r2.Cleared {
		t.Fatalf("le chantier devrait être fini : invested=%d/%d", r2.PaInvested, r2.ClearPA)
	}
	if h2.PA != 6-(ru.ClearPA-5) {
		t.Fatalf("les points doivent être bornés au restant, PA=%d", h2.PA)
	}
	if _, err := g.ClearRuin(h.ID, 1); err == nil {
		t.Fatal("déblayer une ruine déjà déblayée doit être refusé")
	}
}

func TestExploreRuinLootAndCharges(t *testing.T) {
	g := ruinsTestGame()
	g.SeedRuins()
	ru := g.Ruins["ruin-ferme"]
	ru.Cleared = true
	h := g.Heroes[0]
	h.X, h.Y = ru.X, ru.Y
	h.PA = ruinCharges * ruinExplorePA

	for i := 0; i < ruinCharges; i++ {
		it, err := g.ExploreRuin(h.ID)
		if err != nil {
			t.Fatalf("explore %d: %v", i, err)
		}
		if it == nil || it.Name == "" || it.Qty < 1 {
			t.Fatalf("butin invalide: %+v", it)
		}
	}
	if h.PA != 0 {
		t.Fatalf("PA attendu 0, obtenu %d", h.PA)
	}
	if len(h.Inventory) == 0 {
		t.Fatal("le butin doit aller dans le sac du héros")
	}
	if ru.Charges != 0 {
		t.Fatalf("charges attendues 0, obtenu %d", ru.Charges)
	}
	h.PA = 6
	if _, err := g.ExploreRuin(h.ID); err == nil {
		t.Fatal("un donjon épuisé doit refuser l'exploration")
	}
}

func TestRuinFogRedaction(t *testing.T) {
	g := ruinsTestGame()
	g.SeedRuins()
	ru := g.Ruins["ruin-ferme"]
	// tuile non découverte → la ruine et le ruinId sont caviardés
	cv := g.ClientView()
	if cv.Ruins[ru.ID] != nil {
		t.Fatal("ruine visible sous la brume")
	}
	if cv.Tiles[ru.Y*g.Width+ru.X].RuinID != "" {
		t.Fatal("ruinId visible sur une tuile caviardée")
	}
	g.TileAt(ru.X, ru.Y).Discovered = true
	cv = g.ClientView()
	if cv.Ruins[ru.ID] == nil {
		t.Fatal("ruine découverte absente du ClientView")
	}
}

func TestClearRuinRefusedWhenTetanise(t *testing.T) {
	g := ruinsTestGame()
	g.SeedRuins()
	ru := g.Ruins["ruin-ferme"]
	h := g.Heroes[0]
	h.X, h.Y = ru.X, ru.Y
	h.PA = 6
	h.AddState(StateTetanise)
	if _, err := g.ClearRuin(h.ID, 1); err == nil {
		t.Fatal("un héros tétanisé ne peut pas déblayer")
	}
	if _, err := g.ExploreRuin(h.ID); err == nil {
		t.Fatal("un héros tétanisé ne peut pas explorer")
	}
}
