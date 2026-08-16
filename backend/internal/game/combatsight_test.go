package game

// LA VISION EN COMBAT.
//
// Ce que ces tests défendent : qu'on ne puisse ni voir ni frapper à travers l'arène
// entière, que la règle soit la MÊME pour les monstres (une vision que seul le joueur
// subirait serait un handicap, pas une règle), que « Éclairer » serve vraiment à
// quelque chose, et surtout qu'un combat où personne ne voit personne ne se BLOQUE pas.

import "testing"

func sightCombat(t *testing.T) (*GameState, *Combat, *CombatUnit, *CombatUnit) {
	t.Helper()
	SeedRNG(9)
	gs := &GameState{ID: "g", Width: 9, Height: 9, Tiles: make([]Tile, 81)}
	h := NewStarterHero(0, "Ava", 4, 4)
	h.HP, h.MaxHP = 200, 200
	gs.Heroes = []*Hero{h}
	m := &Monster{ID: "m", Species: "Slime", X: 4, Y: 4, HP: 200, MaxHP: 200, Count: 1}
	c := NewCombat(gs, []*Hero{h}, m, "")
	var hu, mu *CombatUnit
	for _, u := range c.Units {
		if u.Side == "hero" {
			hu = u
		} else if mu == nil {
			mu = u
		}
	}
	for i := range c.Cells { // arène plate et dégagée : on ne teste QUE la vision
		c.Cells[i] = CombatCell{}
		c.Heights[i] = 0
	}
	return gs, c, hu, mu
}

func TestSightIsLimitedAndFollowsPerception(t *testing.T) {
	_, c, hu, mu := sightCombat(t)
	hu.Stats.Perception = 0
	hu.Sight = hu.sight()
	hu.X, hu.Y = 0, 0
	mu.X, mu.Y = 0, 6 // six cases : hors de portée d'œil

	if c.VisibleTo("hero", mu) {
		t.Fatalf("à %d de portée, l'ennemi ne doit pas être visible à six cases", hu.Sight)
	}
	// la PERCEPTION achète la portée (et elle seule : la Précision, elle, n'achète que
	// le coup critique — les deux étaient confondues au premier jet, à tort)
	hu.Stats.Perception = 12 // portée 3 + 12/3 = 7
	hu.Sight = hu.sight()
	if !c.VisibleTo("hero", mu) {
		t.Fatalf("une grande précision doit porter jusqu'à six cases (portée %d)", hu.Sight)
	}
}

// ON NE FRAPPE QUE CE QU'ON VOIT — la conséquence qui compte vraiment.
func TestCannotTargetWhatYouCannotSee(t *testing.T) {
	_, c, hu, mu := sightCombat(t)
	hu.Stats.Perception, hu.Sight = 0, 0
	hu.Sight = hu.sight()
	// une arme de très longue portée, mais un ennemi hors de vue
	atk := AttackDef{Name: "Tir long", Kind: "special", Targets: manhattanCells(1, 6), DmgStat: "dexterite"}
	hu.X, hu.Y = 0, 0
	mu.X, mu.Y = 0, 6
	if c.canTarget(hu, &atk, mu) {
		t.Fatal("une portée d'arme ne doit pas permettre de viser un ennemi invisible")
	}
	if err := c.PlayerAction(hu.ID, "attack", 0, 0, mu.ID); err == nil {
		t.Fatal("le serveur doit refuser une attaque sur une unité qu'on ne voit pas")
	}
	// il s'approche : dès qu'il le voit, il peut viser
	mu.X, mu.Y = 0, 2
	if !c.canTarget(hu, &atk, mu) {
		t.Fatal("à portée de vue, la cible redevient visable")
	}
}

// LE PAYLOAD NE PORTE PAS CE QU'ON NE VOIT PAS : masquer côté client ne serait qu'un
// effet d'affichage, la position voyagerait quand même.
func TestHiddenUnitsAreNotServed(t *testing.T) {
	_, c, hu, mu := sightCombat(t)
	hu.Stats.Perception, hu.X, hu.Y = 0, 0, 0
	hu.Sight = hu.sight()
	mu.X, mu.Y = 0, 6
	view := c.SightView("hero")
	for _, u := range view.Units {
		if u.ID == mu.ID {
			t.Fatal("une unité invisible ne doit pas figurer dans la vue servie")
		}
	}
	if len(view.Units) == 0 {
		t.Fatal("les unités du camp servi doivent rester")
	}
	// ⚠ l'ORDRE du tour n'est pas amputé : le raccourcir trahirait le NOMBRE d'ennemis.
	if len(view.Order) != len(c.Order) {
		t.Fatal("l'ordre du tour ne doit pas révéler combien d'unités sont cachées")
	}
}

// ÉCLAIRER : la capacité de l'Éclaireur révèle une zone pour toute l'équipe, même hors
// de portée de vue, et le marquage S'ESTOMPE.
func TestEclairerRevealsAnArea(t *testing.T) {
	_, c, hu, mu := sightCombat(t)
	hu.ClassID = "eclaireur"
	hu.Stats.Perception, hu.X, hu.Y = 0, 0, 0
	hu.Sight = hu.sight()
	mu.X, mu.Y = 0, 5
	if c.VisibleTo("hero", mu) {
		t.Fatal("préalable : l'ennemi doit être hors de vue")
	}
	var eclairer *AttackDef
	for _, sk := range heroIsoSkillsFor("eclaireur") {
		if sk.Reveal > 0 {
			s := sk
			eclairer = &s
		}
	}
	if eclairer == nil {
		t.Fatal("l'Éclaireur doit avoir une compétence de révélation")
	}
	c.performAttack(hu, eclairer, mu.X, mu.Y)
	if !c.VisibleTo("hero", mu) {
		t.Fatal("Éclairer doit rendre la zone visible")
	}
	if mu.HP != mu.MaxHP {
		t.Fatal("Éclairer ne fait AUCUN dégât : elle désigne, elle ne frappe pas")
	}
	for i := 0; i < spotRounds; i++ {
		c.tickSpots()
	}
	if c.VisibleTo("hero", mu) {
		t.Fatal("le marquage doit s'estomper : c'est un renseignement, pas une révélation permanente")
	}
}

// LA RÈGLE EST SYMÉTRIQUE : un monstre ne cible pas non plus ce qu'il ne voit pas.
func TestMonstersObeyTheSameSight(t *testing.T) {
	_, c, hu, mu := sightCombat(t)
	mu.Stats.Perception = 0
	mu.Sight = mu.sight()
	mu.X, mu.Y = 0, 0
	hu.X, hu.Y = 0, 6
	if c.VisibleTo("monster", hu) {
		t.Fatal("le monstre ne doit pas voir à six cases")
	}
	hpBefore := hu.HP
	c.monsterTurn(mu)
	if hu.HP != hpBefore {
		t.Fatal("un monstre aveugle ne doit pas frapper — la règle vaut pour les deux camps")
	}
}

// ⚠ ET SURTOUT : DEUX CAMPS AVEUGLES NE SE BLOQUENT PAS. Sans la soupape de
// `packTarget`, ils resteraient plantés jusqu'à la limite de rounds — ce n'est pas une
// tension, c'est une panne.
func TestBlindCombatStillConverges(t *testing.T) {
	_, c, hu, mu := sightCombat(t)
	hu.Stats.Precision, mu.Stats.Perception = 0, 0
	hu.Sight, mu.Sight = hu.sight(), mu.sight()
	hu.X, hu.Y = 0, 0
	mu.X, mu.Y = 0, 6
	d0 := absI(hu.Y - mu.Y) // 6 : hors de la portée d'œil de base (3)
	c.monsterTurn(mu)
	if d := absI(hu.Y - mu.Y); d >= d0 {
		t.Fatalf("un monstre qui ne voit rien doit quand même se rapprocher : %d -> %d", d0, d)
	}
}
