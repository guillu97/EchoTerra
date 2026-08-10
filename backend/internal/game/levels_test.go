package game

import "testing"

// UN NIVEAU QU'ON PAIE DOIT SE VOIR.
//
// Quatre effets du catalogue de design n'existaient que sur le papier : « recyclage plus
// efficace », « sondages / statistiques », « courrier plus fiable / relais permanent »,
// « rations +1 ». Le joueur versait des PA et des matériaux pour une phrase. Ces tests
// tiennent la promesse : chaque palier change quelque chose de mesurable.

// RECYCLERIE — la même poignée de débris rend davantage à mesure qu'on l'améliore.
func TestRecycleryYieldsMoreAtHigherLevels(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	h := g.HeroByID(ana.HeroIDs[0])
	b := g.buildingByID("recyclerie")
	b.Built, b.Level, b.Durability = true, 1, b.MaxDurability

	yield := func() int {
		g.Town.Storage = nil
		g.addStorage(Item{Type: "objet", Name: "Débris", Qty: 20})
		h.PA = 6
		it, err := g.Craft("recycle_wood", h.ID)
		if err != nil {
			t.Fatal(err)
		}
		return it.Qty
	}
	one := yield()
	b.Level = 3
	three := yield()
	if three <= one {
		t.Fatalf("une recyclerie niveau 3 doit rendre plus : %d puis %d", one, three)
	}

	// ⚠ RÉSERVÉ À LA RECYCLERIE : étendre le bonus à toutes les recettes ferait de
	// l'Atelier une machine à dupliquer l'acier.
	w := g.buildingByID("workshop")
	w.Built, w.Level, w.Durability = true, 3, w.MaxDurability
	plank := recipeFor("Planche")
	if plank == nil {
		t.Fatal("staging: la recette de la Planche a disparu")
	}
	if g.craftYieldBonus(plank) != 0 {
		t.Fatal("seule la Recyclerie profite du bonus de rendement")
	}
}

// PANNEAU — la mémoire écrite de la ville s'allonge : journal et tableau de demandes.
func TestNoticeBoardHoldsMoreAsItGrows(t *testing.T) {
	g, _, _ := twoPlayerTown(t)
	b := g.buildingByID("panel")
	b.Built, b.Durability = true, b.MaxDurability

	b.Level = 1
	small, smallReq := g.townLogCapacity(), g.requestsCapacity()
	b.Level = 3
	big, bigReq := g.townLogCapacity(), g.requestsCapacity()
	if big <= small || bigReq <= smallReq {
		t.Fatalf("le Panneau amélioré doit tenir plus : journal %d→%d, demandes %d→%d",
			small, big, smallReq, bigReq)
	}

	// …et le journal garde effectivement ce surplus.
	b.Level = 3
	for i := 0; i < big+10; i++ {
		g.logTown("ligne")
	}
	if len(g.Town.Log) != big {
		t.Fatalf("le journal doit retenir %d lignes, il en tient %d", big, len(g.Town.Log))
	}
	// Un Panneau en ruine ne retient plus rien de plus que la base.
	b.Durability = 0
	if g.townLogCapacity() != townLogCap {
		t.Fatal("un Panneau détruit revient à la capacité de base")
	}
}

// POSTE — depuis le TERRAIN, le relais transmet d'autant plus loin qu'il est bon. En
// ville on lit tout : on est devant le panneau.
func TestPostRelayCarriesFurtherAtHigherLevels(t *testing.T) {
	g, ana, bo := twoPlayerTown(t)
	poste := g.buildingByID("poste")
	poste.Built, poste.Level, poste.Durability = true, 1, poste.MaxDurability
	for i := 0; i < chatRemoteBase+15; i++ {
		g.Town.Chat = append(g.Town.Chat, ChatMessage{ID: NewJoinCode(), Text: "coucou", PlayerID: bo.ID})
	}
	// Ana sort des murs : elle dépend du relais.
	for _, id := range ana.HeroIDs {
		h := g.HeroByID(id)
		h.X, h.Y = g.Town.X+3, g.Town.Y
	}
	g.Recompute()

	got, err := g.ChatFor(ana.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != chatRemoteBase {
		t.Fatalf("relais niveau 1 : %d messages attendus, %d reçus", chatRemoteBase, len(got))
	}
	poste.Level = MaxBuildingLevel
	if got, _ = g.ChatFor(ana.ID); len(got) != len(g.Town.Chat) {
		t.Fatalf("relais permanent : tout le fil attendu, %d reçus", len(got))
	}
	// Bo est resté en ville : il lit tout, quel que soit le relais.
	poste.Level = 1
	if got, _ = g.ChatFor(bo.ID); len(got) != len(g.Town.Chat) {
		t.Fatalf("en ville on lit tout le fil, %d reçus", len(got))
	}
}

// CUISINE niveau 2 — « rations +1 » : une seconde ration d'eau par jour et par héros.
// L'eau rend des PA sur le terrain, c'est donc du temps de jeu rendu.
func TestKitchenGrantsASecondDailyRation(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	h := g.HeroByID(ana.HeroIDs[0])
	if g.dailyWaterAllowance() != 1 {
		t.Fatal("sans Cuisine niveau 2, une seule ration par jour")
	}
	if err := g.TownAction("well", "water", 1, h.ID); err != nil {
		t.Fatal(err)
	}
	if err := g.TownAction("well", "water", 1, h.ID); err == nil {
		t.Fatal("la seconde ration doit être refusée sans Cuisine niveau 2")
	}

	k := g.buildingByID("kitchen")
	k.Built, k.Level, k.Durability = true, 2, k.MaxDurability
	if g.dailyWaterAllowance() != 2 {
		t.Fatal("Cuisine niveau 2 : deux rations par jour")
	}
	if err := g.TownAction("well", "water", 1, h.ID); err != nil {
		t.Fatalf("la seconde ration doit passer : %v", err)
	}
	if err := g.TownAction("well", "water", 1, h.ID); err == nil {
		t.Fatal("…mais pas une troisième")
	}
	// Le jour suivant remet le compteur à zéro.
	g.Day++
	if err := g.TownAction("well", "water", 1, h.ID); err != nil {
		t.Fatalf("un nouveau jour rouvre le puits : %v", err)
	}
}
