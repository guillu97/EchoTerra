package game

import "testing"

// L'ÉQUIPEMENT — la forge produisait des lames, des arcs, des capes et des armures dont
// les effets n'étaient QUE DU TEXTE. On montait l'Atelier au niveau 2, on fabriquait
// l'objet, et il rejoignait la Banque pour n'en jamais ressortir.

func TestEquippingTakesTheItemOutOfTheBagAndBackIn(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	h := g.HeroByID(ana.HeroIDs[0])
	h.AddLoot(Item{Type: "arme", Name: "Lame de fer", Qty: 1})

	if _, err := g.Equip(h.ID, "Lame de fer"); err != nil {
		t.Fatal(err)
	}
	if h.Weapon != "Lame de fer" {
		t.Fatalf("l'arme doit être portée : %q", h.Weapon)
	}
	// ⚠ ELLE QUITTE LE SAC : sinon on la déposerait en Banque tout en la portant, et une
	// seule lame armerait la ville entière.
	if heroItemQty(h, "Lame de fer") != 0 {
		t.Fatal("l'objet porté ne doit plus être dans le sac")
	}

	// Remplacer libère l'emplacement SANS perdre l'ancienne pièce.
	h.AddLoot(Item{Type: "arme", Name: "Dague en croc", Qty: 1})
	if _, err := g.Equip(h.ID, "Dague en croc"); err != nil {
		t.Fatal(err)
	}
	if h.Weapon != "Dague en croc" || heroItemQty(h, "Lame de fer") != 1 {
		t.Fatalf("l'arme remplacée retourne au sac : arme=%q sac=%d", h.Weapon, heroItemQty(h, "Lame de fer"))
	}
	// …et la retirer aussi.
	if _, err := g.Unequip(h.ID, SlotWeapon); err != nil {
		t.Fatal(err)
	}
	if h.Weapon != "" || heroItemQty(h, "Dague en croc") != 1 {
		t.Fatal("retirer une arme la rend au sac")
	}
}

func TestOnlyRealGearCanBeWorn(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	h := g.HeroByID(ana.HeroIDs[0])
	h.AddLoot(Item{Type: "minerai", Name: "Pierre", Qty: 1})
	if _, err := g.Equip(h.ID, "Pierre"); err == nil {
		t.Fatal("une pierre ne se porte pas")
	}
	if _, err := g.Equip(h.ID, "Lame de fer"); err == nil {
		t.Fatal("on ne porte pas ce qu'on n'a pas")
	}
}

// LES BONUS SONT PRÊTÉS À L'UNITÉ, jamais greffés sur le héros — même règle que
// l'Armurerie. Greffés, ils s'empileraient à chaque combat.
func TestGearBoostsTheCombatUnitNotTheHero(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	h := g.HeroByID(ana.HeroIDs[0])
	force, agi := h.Stats.Force, h.Stats.Agilite
	h.AddLoot(Item{Type: "arme", Name: "Lame de fer", Qty: 1})
	h.AddLoot(Item{Type: "arme", Name: "Cape de plumes", Qty: 1})
	if _, err := g.Equip(h.ID, "Lame de fer"); err != nil {
		t.Fatal(err)
	}
	if _, err := g.Equip(h.ID, "Cape de plumes"); err != nil {
		t.Fatal(err)
	}

	m := NewMonster("Slime Vorace", h.X, h.Y)
	c := NewCombat(g, []*Hero{h}, m, h.ID)
	var u *CombatUnit
	for _, x := range c.Units {
		if x.RefID == h.ID {
			u = x
		}
	}
	if u == nil {
		t.Fatal("le héros doit être dans l'arène")
	}
	if u.Stats.Force != force+3 || u.Stats.Agilite != agi+2 {
		t.Fatalf("bonus non appliqués : force %d (attendu %d), agilité %d (attendu %d)",
			u.Stats.Force, force+3, u.Stats.Agilite, agi+2)
	}
	// L'agilité gagnée doit compter pour le DÉPLACEMENT : sinon une cape de plumes ne
	// changerait rien à ce qu'elle promet.
	if u.Move != 2+(agi+2)/3 {
		t.Fatalf("le déplacement doit suivre l'agilité équipée : %d", u.Move)
	}
	if h.Stats.Force != force || h.Stats.Agilite != agi {
		t.Fatal("les statistiques du héros hors combat ne doivent pas bouger")
	}
}

// UNE ARMURE RETIRE DES DÉGÂTS RÉELLEMENT ENCAISSÉS — et ne rend jamais invulnérable.
// ⚠ damageWith et EstimateDamage doivent rester MIROIRS : la prévisualisation d'attaque
// mentirait sinon.
func TestArmourReducesDamageAndTheEstimateAgrees(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	h := g.HeroByID(ana.HeroIDs[0])
	m := NewMonster("Slime Vorace", h.X, h.Y)
	c := NewCombat(g, []*Hero{h}, m, h.ID)
	var hero, mob *CombatUnit
	for _, u := range c.Units {
		if u.Side == "hero" {
			hero = u
		} else if mob == nil {
			mob = u
		}
	}
	atk := c.baseAttackFor(mob)
	bare, _ := c.EstimateDamage(mob, hero, &atk)
	hero.Armor = 2
	armoured, _ := c.EstimateDamage(mob, hero, &atk)
	if armoured >= bare && bare > 1 {
		t.Fatalf("l'armure doit réduire les dégâts : %d puis %d", bare, armoured)
	}
	// Plancher : même sous une montagne de cuir, un coup fait au moins 1.
	hero.Armor = 999
	if d, _ := c.EstimateDamage(mob, hero, &atk); d < 1 {
		t.Fatalf("un coup fait toujours au moins 1 dégât, obtenu %d", d)
	}
}

// UNE ARME CHANGE LA PORTÉE : c'est ce qui fait d'un arc autre chose qu'une épée aux
// chiffres différents.
func TestABowMakesTheBaseAttackRanged(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	h := g.HeroByID(ana.HeroIDs[0])
	m := NewMonster("Slime Vorace", h.X, h.Y)

	melee := NewCombat(g, []*Hero{h}, m, h.ID)
	var mu *CombatUnit
	for _, u := range melee.Units {
		if u.Side == "hero" {
			mu = u
		}
	}
	plain := melee.baseAttackFor(mu)

	h.AddLoot(Item{Type: "arme", Name: "Arc sylvestre", Qty: 1})
	if _, err := g.Equip(h.ID, "Arc sylvestre"); err != nil {
		t.Fatal(err)
	}
	ranged := NewCombat(g, []*Hero{h}, m, h.ID)
	var ru *CombatUnit
	for _, u := range ranged.Units {
		if u.Side == "hero" {
			ru = u
		}
	}
	bow := ranged.baseAttackFor(ru)
	if len(bow.Targets) <= len(plain.Targets) {
		t.Fatalf("l'arc doit élargir le ciblage : %d cases contre %d", len(bow.Targets), len(plain.Targets))
	}
	if bow.DmgStat != "dexterite" {
		t.Fatalf("un arc frappe à la dextérité, pas à la force : %q", bow.DmgStat)
	}
}

// L'ARGENT DES LÉGENDES mord la chair maudite — et seulement elle.
func TestSilverBitesCursedCreaturesOnly(t *testing.T) {
	silver := &CombatUnit{VsCursed: 4}
	if got := silver.cursedBonus(&CombatUnit{Kind: "Loup-garou"}); got != 4 {
		t.Fatalf("l'argent doit mordre un loup-garou : %d", got)
	}
	if got := silver.cursedBonus(&CombatUnit{Kind: "Slime Vorace"}); got != 0 {
		t.Fatalf("…et rien d'autre : %d", got)
	}
	plain := &CombatUnit{}
	if got := plain.cursedBonus(&CombatUnit{Kind: "Loup-garou"}); got != 0 {
		t.Fatalf("sans lame d'argent, pas de bonus : %d", got)
	}
}

// LES BOTS S'ARMENT — sinon une Lame de fer voyage dans un sac vingt vagues durant.
func TestBotsWearTheBestGearTheyCarry(t *testing.T) {
	g, bot := botGame(t)
	h := g.HeroByID(bot.HeroIDs[0])
	h.AddLoot(Item{Type: "arme", Name: "Dague en croc", Qty: 1})
	h.AddLoot(Item{Type: "arme", Name: "Lame de fer", Qty: 1})

	if !g.botEquip(h) {
		t.Fatal("un bot doit s'armer de ce qu'il porte")
	}
	if h.Weapon != "Lame de fer" {
		t.Fatalf("il doit choisir la meilleure arme : %q", h.Weapon)
	}
	// Déjà mieux armé qu'il ne le pourrait : il n'y touche plus.
	h.Inventory = nil
	h.AddLoot(Item{Type: "arme", Name: "Dague en croc", Qty: 1})
	if g.botEquip(h) {
		t.Fatal("ne pas troquer une bonne arme contre une moins bonne")
	}
}
