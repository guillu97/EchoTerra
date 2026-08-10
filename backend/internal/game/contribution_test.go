package game

import "testing"

// LE REGISTRE EST LE SOCLE DE LA CHRONIQUE ET DES TITRES (store/chronicle.go, P7) : ce
// qu'il ne compte pas, un compte ne le gardera jamais. Il n'était couvert qu'indirectement.
func TestContributionsCreditTheHerosOwner(t *testing.T) {
	g, ana, bo := twoPlayerTown(t)
	hero := g.HeroByID(ana.HeroIDs[0])

	// 1. Les PA de CHANTIER, comptés à l'investissement (la pose du plan n'en est pas).
	g.addStorage(Item{Type: "minerai", Name: "Pierre", Qty: 20})
	if err := g.TownAction("wall", "build", 1, hero.ID); err != nil { // pose le plan
		t.Fatal(err)
	}
	if err := g.TownAction("wall", "build", 2, hero.ID); err != nil { // investit 2 PA
		t.Fatal(err)
	}
	c := g.Contributions[ana.ID]
	if c == nil || c.BuildPA != 2 {
		t.Fatalf("2 PA de chantier attendus au crédit d'Ana : %+v", c)
	}

	// 2. Les DÉPÔTS à la Banque.
	hero.AddLoot(Item{Type: "objet", Name: "Bois", Qty: 3})
	if _, err := g.DepositHeroLoot([]string{hero.ID}); err != nil {
		t.Fatal(err)
	}
	if g.Contributions[ana.ID].Deposited != 3 {
		t.Fatalf("3 objets déposés attendus : %+v", g.Contributions[ana.ID])
	}

	// 3. Les PV rendus aux REMPARTS.
	g.Town.HP = g.Town.MaxHP - 20
	if err := g.TownAction("wall", "repair", 1, hero.ID); err != nil {
		t.Fatal(err)
	}
	if g.Contributions[ana.ID].Repaired != TownRepairHP {
		t.Fatalf("%d PV rendus attendus : %+v", TownRepairHP, g.Contributions[ana.ID])
	}

	// ⚠ CHACUN SON REGISTRE : le travail d'Ana ne doit jamais tomber au crédit de Bo.
	if bc := g.Contributions[bo.ID]; bc != nil && !bc.Empty() {
		t.Fatalf("Bo n'a rien fait et se voit créditer : %+v", bc)
	}
}

// Une partie sans joueurs (« Test rapide », parties héritées) ne crédite personne, sans
// planter : le registre n'a de sens que s'il y a des gens à créditer.
func TestContributionsAreANoOpWithoutPlayers(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	hero := g.HeroByID(ana.HeroIDs[0])
	g.Players = nil // plus personne à qui rattacher les héros
	g.Contributions = nil
	hero.AddLoot(Item{Type: "objet", Name: "Bois", Qty: 2})
	if _, err := g.DepositHeroLoot([]string{hero.ID}); err != nil {
		t.Fatal(err)
	}
	if len(g.Contributions) != 0 {
		t.Fatalf("aucun crédit sans propriétaire : %+v", g.Contributions)
	}
	if len(g.Ledger()) != 0 {
		t.Fatal("un registre vide reste vide")
	}
}
