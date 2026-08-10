package game

import "testing"

// UN RÉCOLTEUR VOYAGE, IL N'ERRE PAS (bots.go botGatherTarget).
//
// La destination était rechoisie à chaque round, au hasard parmi les trois meilleures
// cases — or leurs scores dépendent de la position du héros et de celles de ses
// coéquipiers, donc le classement basculait à chaque pas. Mesuré : 2651 déplacements
// pour 389 fouilles chez vingt joueurs, sept pas par récolte. Comme un héros n'a que six
// PA par vague, une case à dix pas n'était jamais atteinte.
func TestAGathererKeepsItsDestinationBetweenRounds(t *testing.T) {
	g, bot := botGame(t)
	h := g.HeroByID(bot.HeroIDs[0])
	x1, y1, ok := g.botGatherTarget(h)
	if !ok {
		t.Skip("aucune case de récolte sur ce plateau")
	}
	if !h.HasGoal || h.GoalX != x1 || h.GoalY != y1 {
		t.Fatalf("le cap doit être mémorisé : (%d,%d) vs (%d,%d,%v)", x1, y1, h.GoalX, h.GoalY, h.HasGoal)
	}
	// Un pas fait, la question ne se rouvre pas — tant qu'on n'est pas arrivé.
	steps := 0
	for i := 0; i < 4; i++ {
		if !g.botStepToward(h, x1, y1) {
			break
		}
		steps++
		if h.X == x1 && h.Y == y1 {
			break // arrivé : le cap DOIT se rouvrir, c'est l'autre test
		}
		x2, y2, ok := g.botGatherTarget(h)
		if !ok || x2 != x1 || y2 != y1 {
			t.Fatalf("cap changé en route après %d pas : (%d,%d) -> (%d,%d)", steps, x1, y1, x2, y2)
		}
	}
	if steps == 0 {
		t.Skip("le héros n'a pas pu faire un pas sur ce plateau")
	}
}

// …mais un cap qui ne vaut plus le voyage est abandonné : arrivé, ou la case prise par
// un pack. Un cap qu'on ne lâche jamais serait un bot bloqué.
func TestAGathererDropsAGoalThatStoppedBeingWorthIt(t *testing.T) {
	g, bot := botGame(t)
	h := g.HeroByID(bot.HeroIDs[0])
	x, y, ok := g.botGatherTarget(h)
	if !ok {
		t.Skip("aucune case de récolte sur ce plateau")
	}
	// Un pack s'installe dessus.
	m := NewMonster("Slime Vorace", x, y)
	g.Monsters[m.ID] = m
	g.TileAt(x, y).MonsterID = m.ID
	if g.botGoalWorthKeeping(h) {
		t.Fatal("une case occupée par un pack ne vaut plus le déplacement")
	}
	// Et arrivé sur place, la question se rouvre.
	h.X, h.Y = x, y
	if g.botGoalWorthKeeping(h) {
		t.Fatal("arrivé à destination, le cap doit être reconsidéré")
	}
}

// ON RENTRE CE QUI MANQUE, MÊME AVEC UN SAC LÉGER (bots.go botCarryingWanted).
//
// Le seuil de portage est un critère de RENDEMENT, pas d'urgence : à soixante héros
// portant chacun huit objets, personne n'atteignait jamais le seuil. Mesuré : 56 Pierre
// et 39 plans dormaient dans les sacs pendant que la Banque en tenait zéro — dont dix
// « Plan de la Tour » alors que la tour n'a jamais été bâtie de la partie.
func TestAGathererHeadsHomeWithAMaterialTheBankHasNoneOf(t *testing.T) {
	g, bot := botGame(t)
	h := g.HeroByID(bot.HeroIDs[0])
	h.Inventory = nil
	if g.botCarryingWanted(h) {
		t.Fatal("sac vide : rien à rapporter")
	}
	// La Banque n'a pas une seule Pierre, et les murs en réclament.
	h.AddLoot(Item{Type: "minerai", Name: TownRepairMaterial, Qty: 1})
	g.Town.HP = g.Town.MaxHP - 10
	g.Recompute()
	if !g.botCarryingWanted(h) {
		t.Fatal("une pierre quand la Banque en a zéro doit valoir le voyage")
	}
	// …et dès que la Banque en tient, l'urgence retombe : le héros retourne récolter.
	g.addStorage(Item{Type: "minerai", Name: TownRepairMaterial, Qty: 20})
	if g.botCarryingWanted(h) {
		t.Fatal("la Banque approvisionnée, ce n'est plus une urgence")
	}
}

// Un PLAN dans un sac ne construit rien. Dans la Banque, il ouvre un chantier.
func TestAGathererHeadsHomeWithABlueprintTheTownLacks(t *testing.T) {
	g, bot := botGame(t)
	h := g.HeroByID(bot.HeroIDs[0])
	h.Inventory = nil
	plan := buildingPlanItem("tower")
	if plan == "" || g.buildingByID("tower").Built {
		t.Skip("staging: la tour doit être un site à bâtir")
	}
	h.AddLoot(Item{Type: "objet", Name: plan, Qty: 1})
	if !g.botCarryingWanted(h) {
		t.Fatal("un plan que la ville n'a pas doit ramener le héros")
	}
	g.addStorage(Item{Type: "objet", Name: plan, Qty: 1})
	if g.botCarryingWanted(h) {
		t.Fatal("le plan déjà en Banque, un second ne justifie plus le trajet")
	}
}

// UN BÂTIMENT QUI GARDE UN MATÉRIAU DE DÉFENSE EST UN BÂTIMENT DE DÉFENSE.
//
// Les bots n'amélioraient que la muraille, le portail et la tour. Or le dernier niveau
// du portail (+16 au lieu de +12) réclame de l'ACIER, l'acier réclame un Atelier de
// niveau 2, et l'Atelier n'était sur la liste de personne : mesuré, atelier bloqué au
// niveau 1 et portail plafonné au niveau 2 sur CHAQUE partie simulée, pendant que le
// bois du chantier dormait à la Banque.
func TestBotsUpgradeTheForgeWhenTheWallsNeedWhatItCannotYetMake(t *testing.T) {
	g, _ := botGame(t)
	gate, shop := g.buildingByID("gate"), g.buildingByID("workshop")
	gate.Built, gate.Level = true, 2 // le niveau 3 réclame de l'Acier
	shop.Built, shop.Level = true, 1 // …que la forge ne sait pas encore faire
	g.Recompute()

	// Sans de quoi monter la forge, on ne promet rien.
	if b := g.botCraftUnlockNeeded(); b != nil {
		t.Fatalf("Banque vide : aucun chantier ne doit être proposé, obtenu %q", b.ID)
	}
	// Avec les matériaux de la forge en Banque, c'est ELLE qu'il faut monter.
	for _, m := range g.buildingCost(shop).Materials {
		g.addStorage(Item{Type: m.Type, Name: m.Name, Qty: m.Qty})
	}
	b := g.botCraftUnlockNeeded()
	if b == nil || b.ID != "workshop" {
		t.Fatalf("il faut monter l'Atelier pour débloquer l'Acier, obtenu %v", b)
	}
	// …et une fois la forge au niveau requis, plus rien à débloquer de ce côté.
	shop.Level = 2
	g.Recompute()
	if b := g.botCraftUnlockNeeded(); b != nil && b.ID == "workshop" {
		t.Fatal("la forge sait désormais faire l'Acier : ne pas la remonter pour rien")
	}
}

// LE DÉBUT DE PARTIE SERT À VOIR (bots.go botProspecting).
//
// L'exploration n'était qu'un repli : on ne poussait le brouillard que si plus aucune
// case connue ne fournissait ce qu'on cherchait — condition presque jamais vraie. Mesuré :
// 0,9 % d'une carte de vingt joueurs explorée en vingt vagues, et les bots faisaient la
// NAVETTE (2491 déplacements pour 572 cases révélées). Une carte qu'on ne voit pas est une
// carte qui n'existe pas : ni gisement de remplacement, ni ruine, donc aucun plan de
// spécialité. Après : 2,5 %, soit 2,3 fois plus, à survie égale.
func TestGatherersProspectEarlyThenSettleDown(t *testing.T) {
	g, bot := botGame(t)
	// Un récolteur (rang 2 de son équipe), une ville qui ne manque de rien.
	var scout *Hero
	for _, id := range bot.HeroIDs {
		if h := g.HeroByID(id); h != nil && g.heroRole(id) == roleGatherer {
			scout = h
		}
	}
	if scout == nil {
		t.Skip("aucun récolteur dans cette équipe")
	}
	for i := 0; i < 10; i++ {
		want := g.botShoppingList()
		if len(want) == 0 {
			break
		}
		for name := range want {
			g.addStorage(Item{Type: "objet", Name: name, Qty: 999})
		}
	}
	g.Town.HP = g.Town.MaxHP
	g.Recompute()

	g.WaveNumber = 1
	if !g.botProspecting(scout) {
		t.Fatal("au début, un récolteur part en repérage")
	}
	// …mais la pénurie reprend TOUJOURS le pas sur la curiosité.
	g.Town.Storage = nil
	g.Town.HP = g.Town.MaxHP - 10
	g.Recompute()
	if g.botProspecting(scout) {
		t.Fatal("la Banque à zéro : on va chercher, pas voir du pays")
	}

	// Passé les premières vagues, on s'installe : c'est la phase d'économie.
	for i := 0; i < 10; i++ {
		for name := range g.botShoppingList() {
			g.addStorage(Item{Type: "objet", Name: name, Qty: 999})
		}
	}
	g.Town.HP = g.Town.MaxHP
	g.Recompute()
	g.WaveNumber = botProspectWaves + 1
	if g.botProspecting(scout) {
		t.Fatal("passé la phase de repérage, un récolteur récolte")
	}

	// Et le bâtisseur ne part JAMAIS en repérage : il tient la ville.
	for _, id := range bot.HeroIDs {
		if g.heroRole(id) == roleBuilder {
			g.WaveNumber = 1
			if g.botProspecting(g.HeroByID(id)) {
				t.Fatal("un bâtisseur reste en ville")
			}
		}
	}
}
