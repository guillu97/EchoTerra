package game

// LE RELIEF ARRÊTE — sur la carte comme dans l'arène.
//
// Ce que ces tests défendent : que l'athlétisme décide vraiment de où l'on peut
// aller (il ne décidait de RIEN avant l'audit, et seulement de l'arène après lui),
// que l'équipement compte hors combat — c'est le piège naturel, les bonus
// d'équipement n'étant PRÊTÉS qu'à l'unité de combat — et qu'un refus de relief ne
// coûte jamais un point d'action.

import "testing"

// climbGame : une petite carte plate et découverte, un héros au centre.
func climbGame(t *testing.T) (*GameState, *Hero) {
	t.Helper()
	SeedRNG(5)
	gs := &GameState{ID: "g", Width: 7, Height: 7, Tiles: make([]Tile, 49)}
	for i := range gs.Tiles {
		gs.Tiles[i] = Tile{Biome: BiomeGrass, Height: 3, Resources: 3, Discovered: true}
	}
	gs.Town.X, gs.Town.Y = 0, 0
	h := NewStarterHero(0, "Ava", 3, 3)
	gs.Heroes = []*Hero{h}
	return gs, h
}

func TestReliefStopsAHeroOnTheMap(t *testing.T) {
	gs, h := climbGame(t)
	h.Stats.Athletisme = 0 // franchissement 1
	cliff := gs.TileAt(4, 3)
	cliff.Height = 5       // marche de 2 : une falaise de mesa (worldgen)
	pa0 := h.PA

	err := gs.MoveHero(h.ID, 1, 0)
	if err == nil {
		t.Fatal("une marche de 2 doit arrêter un héros sans athlétisme")
	}
	if h.X != 3 || h.Y != 3 {
		t.Fatalf("le héros ne doit pas avoir bougé : (%d,%d)", h.X, h.Y)
	}
	// ⚠ un refus de RELIEF est gratuit : la case est découverte, sa hauteur est
	// servie, donc le joueur pouvait le voir. Facturer le pas serait une amende
	// pour une information qu'on lui avait donnée.
	if h.PA != pa0 {
		t.Fatalf("un refus de relief ne doit rien coûter : %d -> %d", pa0, h.PA)
	}
	// …et le tour du plateau, lui, passe.
	if err := gs.MoveHero(h.ID, 0, 1); err != nil {
		t.Fatalf("contourner doit rester possible : %v", err)
	}
}

func TestAthletismeOpensTheCliff(t *testing.T) {
	gs, h := climbGame(t)
	gs.TileAt(4, 3).Height = 5
	h.Stats.Athletisme = 5 // franchissement 2 — le palier d'une classe d'exploration
	if err := gs.MoveHero(h.ID, 1, 0); err != nil {
		t.Fatalf("un héros athlétique doit gravir la falaise : %v", err)
	}
	if h.X != 4 {
		t.Fatal("le héros devrait être sur le plateau")
	}
	// et il peut redescendre : la règle est SYMÉTRIQUE, on ne piège personne en haut
	if err := gs.MoveHero(h.ID, -1, 0); err != nil {
		t.Fatalf("redescendre doit être possible : %v", err)
	}
}

// LES BOTTES. C'est le piège que ce lot devait éviter : les bonus d'équipement ne
// sont PRÊTÉS qu'à l'unité de combat et ne touchent jamais `Hero.Stats`, donc un
// objet d'athlétisme n'aurait rien fait là où il a le plus de sens — sur la falaise.
func TestClimbingBootsOpenTheCliff(t *testing.T) {
	gs, h := climbGame(t)
	gs.TileAt(4, 3).Height = 5
	h.Stats.Athletisme = 2 // valeur de départ : ne grimpe pas
	if err := gs.MoveHero(h.ID, 1, 0); err == nil {
		t.Fatal("sans bottes, la falaise doit arrêter")
	}
	h.AddLoot(Item{Type: "arme", Name: "Bottes cloutées", Qty: 1})
	if _, err := gs.Equip(h.ID, "Bottes cloutées"); err != nil {
		t.Fatalf("équiper les bottes : %v", err)
	}
	if err := gs.MoveHero(h.ID, 1, 0); err != nil {
		t.Fatalf("chaussé, le héros doit gravir la falaise : %v", err)
	}
}

// LE BROUILLARD NE BLOQUE JAMAIS. `ClientView` sert une tuile non découverte
// VIERGE (hauteur 0) : refuser sur sa hauteur serait refuser pour une raison que le
// joueur n'avait aucun moyen de voir, et l'exploration au contact deviendrait un
// tirage au sort.
func TestFogNeverLooksLikeACliff(t *testing.T) {
	gs, h := climbGame(t)
	unknown := gs.TileAt(4, 3)
	unknown.Height = 6
	unknown.Discovered = false
	if err := gs.MoveHero(h.ID, 1, 0); err != nil {
		t.Fatalf("une case sous la brume ne doit jamais être refusée pour son relief : %v", err)
	}
}

// Le champ servi au client doit suivre l'équipement — sinon la carte dessinerait des
// pas que le serveur refuse (ou cacherait des pas qu'il accepte).
func TestServedClimbFollowsGear(t *testing.T) {
	gs, h := climbGame(t)
	h.Stats.Athletisme = 2
	gs.Recompute()
	if h.Climb != 1 {
		t.Fatalf("franchissement de départ attendu 1, obtenu %d", h.Climb)
	}
	h.AddLoot(Item{Type: "arme", Name: "Bottes cloutées", Qty: 1})
	if _, err := gs.Equip(h.ID, "Bottes cloutées"); err != nil {
		t.Fatalf("équiper : %v", err)
	}
	gs.Recompute()
	if h.Climb != 2 {
		t.Fatalf("chaussé, franchissement attendu 2, obtenu %d", h.Climb)
	}
}

// LES OBJETS DES DEUX STATISTIQUES RESSUSCITÉES arrivent bien jusqu'à l'unité de
// combat. Sans ça ils existeraient dans le catalogue et nulle part ailleurs — c'est
// exactement le défaut que l'audit reprochait à la forge d'origine.
func TestNewGearReachesTheCombatUnit(t *testing.T) {
	gs, h := climbGame(t)
	h.HP, h.MaxHP = 40, 40
	ath0, prec0 := h.Stats.Athletisme, h.Stats.Precision
	h.AddLoot(Item{Type: "arme", Name: "Bottes cloutées", Qty: 1})
	h.AddLoot(Item{Type: "arme", Name: "Stylet d'écorcheur", Qty: 1})
	if _, err := gs.Equip(h.ID, "Bottes cloutées"); err != nil {
		t.Fatalf("bottes : %v", err)
	}
	if _, err := gs.Equip(h.ID, "Stylet d'écorcheur"); err != nil {
		t.Fatalf("stylet : %v", err)
	}
	m := &Monster{ID: "m", Species: "Slime", X: 3, Y: 3, HP: 30, MaxHP: 30, Count: 1}
	c := NewCombat(gs, []*Hero{h}, m, "")
	var hu *CombatUnit
	for _, u := range c.Units {
		if u.Side == "hero" {
			hu = u
		}
	}
	if hu.Stats.Athletisme != ath0+3 {
		t.Fatalf("les bottes doivent voyager jusqu'au combat : %d -> %d", ath0, hu.Stats.Athletisme)
	}
	if hu.Stats.Precision != prec0+4 {
		t.Fatalf("le stylet doit voyager jusqu'au combat : %d -> %d", prec0, hu.Stats.Precision)
	}
	// …et la précision se traduit en chance de critique ANNONCÉE.
	atk := c.BaseAttack(hu)
	var mu *CombatUnit
	for _, u := range c.Units {
		if u.Side == "monster" {
			mu = u
		}
	}
	if pct, _ := c.CritChance(hu, mu, &atk); pct <= 3*prec0 {
		t.Fatalf("le stylet doit augmenter la chance de critique servie (%d %%)", pct)
	}
	// Et le franchissement d'ARÈNE suit la même statistique, avec son plancher de 2.
	if hu.climbLimit() < arenaClimbBase+1 {
		t.Fatalf("les bottes doivent aussi ouvrir les terrasses de l'arène : %d", hu.climbLimit())
	}
}

// La retraite (Escape) obéit au relief elle aussi : sans ça un héros s'échapperait
// par une falaise que la marche lui refuse.
func TestEscapeRespectsRelief(t *testing.T) {
	gs, h := climbGame(t)
	gs.Town.X, gs.Town.Y = 0, 3 // la ville est à l'ouest
	h.Stats.Athletisme = 0
	gs.TileAt(2, 3).Height = 6 // falaise sur le chemin du repli
	SeedRNG(2)
	if err := gs.EscapeHero(h.ID); err != nil {
		t.Fatalf("escape: %v", err)
	}
	if h.X == 2 {
		t.Fatal("la retraite ne doit pas franchir une falaise")
	}
}
