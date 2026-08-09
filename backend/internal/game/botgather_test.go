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
