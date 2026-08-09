package game

import "testing"

// LA GARNISON — les murs se tiennent (wave.go GarrisonDefense).
//
// Ce que ces tests protègent : sans ce terme, la défense d'une ville ne dépendait QUE
// de ses bâtiments, plafonnés aux mêmes trois niveaux qu'on soit trois héros ou
// soixante, pendant que la pression de la horde suivait l'expédition. Une expédition
// nombreuse n'avait donc aucun moyen d'aller plus loin qu'un solo.

func TestHeroesInTownAddToTheDefense(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	walls := g.buildingsDefense()
	if walls <= 0 {
		t.Fatal("staging: la ville doit tenir quelque chose")
	}
	n, garrison := g.GarrisonDefense()
	if n == 0 || garrison == 0 {
		t.Fatalf("des héros sont en ville : la garnison doit compter (n=%d val=%d)", n, garrison)
	}
	if g.TownDefense() != walls+garrison {
		t.Fatalf("défense = bâtiments + garnison : %d ≠ %d + %d", g.TownDefense(), walls, garrison)
	}

	// Un héros qui SORT ne défend plus : c'est le dilemme, il ne peut pas faire les deux.
	h := g.HeroByID(ana.HeroIDs[0])
	before := g.TownDefense()
	if err := g.MoveHero(h.ID, 1, 0); err != nil {
		t.Fatal(err)
	}
	g.Recompute()
	if g.Town.Defense >= before {
		t.Fatalf("un héros sorti des murs ne doit plus défendre : %d -> %d", before, g.Town.Defense)
	}
}

// LE PLAFOND EST LA RAISON D'ÊTRE DE LA CONSTRUCTION. Sans lui, masser assez de héros
// en ville rendrait les murs — donc le jeu — inutiles.
func TestGarrisonNeverExceedsWhatTheWallsHold(t *testing.T) {
	g, _, _ := twoPlayerTown(t)
	// Une foule : bien plus de poids que la ville ne peut en employer.
	for i := 0; i < 40; i++ {
		g.Heroes = append(g.Heroes, &Hero{
			ID: NewJoinCode() + string(rune('a'+i%26)), Name: "Renfort",
			X: g.Town.X, Y: g.Town.Y, HP: 10, MaxHP: 10, Bars: map[string]int{},
		})
	}
	walls := g.buildingsDefense()
	n, garrison := g.GarrisonDefense()
	if n < 40 {
		t.Fatalf("staging: %d héros seulement en ville", n)
	}
	if garrison != walls {
		t.Fatalf("la garnison doit saturer au niveau des murs : %d pour des murs à %d", garrison, walls)
	}
	if g.TownDefense() != 2*walls {
		t.Fatalf("le plafond total est le double des murs : %d ≠ %d", g.TownDefense(), 2*walls)
	}
}

// Un Gardien vaut trois hommes aux remparts comme il en vaut trois face à un pack :
// une classe avancée doit se voir.
func TestAnEvolvedHeroIsWorthMoreOnTheWalls(t *testing.T) {
	plain := &Hero{}
	scout := &Hero{ClassID: "eclaireur", ClassTier: ClassTierIntermediate}
	guard := &Hero{ClassID: "gardien", ClassTier: ClassTierAdvanced}
	if garrisonWeight(plain) != 1 || garrisonWeight(scout) != 2 || garrisonWeight(guard) != 3 {
		t.Fatalf("poids attendus 1/2/3, obtenus %d/%d/%d",
			garrisonWeight(plain), garrisonWeight(scout), garrisonWeight(guard))
	}
}

// Une brèche ne se tient pas à mains nues : portail ouvert = sa défense tombe, ET le
// plafond de la garnison tombe avec elle.
func TestAnOpenGateAlsoLowersTheGarrisonCeiling(t *testing.T) {
	g, _, _ := twoPlayerTown(t)
	gate := g.buildingByID("gate")
	gate.Open = false
	g.Recompute()
	closed := g.Town.Defense

	gate.Open = true
	g.Recompute()
	if g.Town.Defense >= closed {
		t.Fatalf("porte ouverte : la défense doit baisser (%d -> %d)", closed, g.Town.Defense)
	}
}
