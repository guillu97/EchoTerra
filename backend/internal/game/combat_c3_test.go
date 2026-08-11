package game

import "testing"

// Lot C3 (actions tactiques) : Defend, Poussée (collisions/eau/chute), objets
// en combat et fuite d'équipe.

// c3Combat construit un duel contrôlé 1 héros / 1 monstre sur arène PLATE
// (déterministe), héros au tour.
func c3Combat(t *testing.T) (*GameState, *Combat, *CombatUnit, *CombatUnit) {
	t.Helper()
	gs, c, hu, mu := juiceGame()
	for c.CurrentUnit() != hu {
		c.advanceTurn()
	}
	if c.Status != "active" {
		t.Fatalf("combat should be active")
	}
	return gs, c, hu, mu
}

func TestDefendGrantsShieldAndEndsTurn(t *testing.T) {
	_, c, hu, mu := c3Combat(t)
	mu.X, mu.Y = 0, 0 // loin : l'IA ne tuera pas le héros pendant son tour
	round0 := c.Round
	if err := c.PlayerAction(hu.ID, "defend", 0, 0, ""); err != nil {
		t.Fatalf("defend: %v", err)
	}
	// le Bouclier est posé PENDANT les tours ennemis puis consommé au début du
	// prochain tour du héros (advanceTurn) — de l'extérieur on vérifie le log
	// (la réduction de moitié est couverte par TestEstimateDamageBracketsReality).
	found := false
	for _, l := range c.Log {
		if len(l) > 0 && contains(l, "se met en garde") {
			found = true
		}
	}
	if !found {
		t.Fatalf("defend should log the guard stance: %v", c.Log)
	}
	if c.Status == "active" && c.CurrentUnit() == hu && c.Round == round0 {
		t.Fatalf("defend should end the turn")
	}
	if hu.hasState("Bouclier") {
		t.Fatalf("Bouclier must be consumed at the start of the hero's next turn")
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func TestPushMovesTarget(t *testing.T) {
	_, c, hu, mu := c3Combat(t)
	hu.X, hu.Y = 3, 3
	mu.X, mu.Y = 4, 3        // à l'est, case 5,3 libre et plate
	c.pushUnit(hu, mu, 1, 0) // mécanique pure (PlayerAction enchaîne les tours IA)
	if mu.X != 5 || mu.Y != 3 {
		t.Fatalf("target should be pushed east to (5,3), got (%d,%d)", mu.X, mu.Y)
	}
	if mu.HP != mu.MaxHP {
		t.Fatalf("a clean push deals no damage, hp=%d", mu.HP)
	}
}

func TestPushCollisionWithEdgeAndUnit(t *testing.T) {
	_, c, hu, mu := c3Combat(t)
	// bord d'arène : monstre collé au bord est, poussé vers l'est
	hu.X, hu.Y = 5, 3
	mu.X, mu.Y = 6, 3
	hp0 := mu.HP
	c.pushUnit(hu, mu, 1, 0)
	if mu.X != 6 || mu.Y != 3 || mu.HP != hp0-2 {
		t.Fatalf("edge collision: stays put and takes 2 (hp %d->%d, pos %d,%d)", hp0, mu.HP, mu.X, mu.Y)
	}

	// télescopage : pousser le monstre sur une autre unité = 2 dégâts aux deux
	_, c2, hu2, mu2 := c3Combat(t)
	other := &CombatUnit{ID: "m-extra", Name: "Gelée", Side: "monster", Kind: "Slime Vorace",
		X: 5, Y: 3, HP: 6, MaxHP: 6, States: []string{}, Move: 2}
	c2.Units = append(c2.Units, other)
	hu2.X, hu2.Y = 3, 3
	mu2.X, mu2.Y = 4, 3
	hpA, hpB := mu2.HP, other.HP
	c2.pushUnit(hu2, mu2, 1, 0)
	if mu2.X != 4 || mu2.HP != hpA-2 || other.HP != hpB-2 {
		t.Fatalf("unit collision: both take 2 (target %d->%d, other %d->%d)", hpA, mu2.HP, hpB, other.HP)
	}
}

func TestPushIntoWaterTraps(t *testing.T) {
	_, c, hu, mu := c3Combat(t)
	hu.X, hu.Y = 3, 3
	mu.X, mu.Y = 4, 3
	c.Cells[3*c.GridW+5] = CombatCell{Hazard: "water"} // (5,3) = eau
	c.pushUnit(hu, mu, 1, 0)
	if mu.X != 5 || mu.Y != 3 {
		t.Fatalf("target should land in the water cell, got (%d,%d)", mu.X, mu.Y)
	}
	if !mu.hasState("Root") {
		t.Fatalf("pushed into water should be trapped (Root)")
	}
	if mu.HP != mu.MaxHP {
		t.Fatalf("water push deals no damage")
	}
}

func TestPushFallDamage(t *testing.T) {
	_, c, hu, mu := c3Combat(t)
	hu.X, hu.Y = 3, 3
	mu.X, mu.Y = 4, 3
	// la cible est sur un promontoire h=2, la case d'arrivée au niveau 0
	c.Cells[3*c.GridW+4].Height = 2
	c.Heights[3*c.GridW+4] = 2
	hp0 := mu.HP
	c.pushUnit(hu, mu, 1, 0)
	if mu.X != 5 || mu.HP != hp0-2 {
		t.Fatalf("a >=2 fall deals 2 damage (hp %d->%d, x=%d)", hp0, mu.HP, mu.X)
	}
}

func TestPushRangeAndPionnierReach(t *testing.T) {
	_, c, hu, mu := c3Combat(t)
	hu.X, hu.Y = 3, 3
	mu.X, mu.Y = 5, 3 // distance 2
	if err := c.PlayerAction(hu.ID, "push", 0, 0, mu.ID); err == nil {
		t.Fatalf("a classless hero cannot push at range 2")
	}
	hu.ClassID = "pionnier" // « Poussée du Survivant » : portée 2
	if len(c.PushTargets(hu)) != 1 {
		t.Fatalf("pionnier should see the range-2 target")
	}
	if err := c.PlayerAction(hu.ID, "push", 0, 0, mu.ID); err != nil {
		t.Fatalf("pionnier push range 2: %v", err)
	}
	pushed := false
	for _, l := range c.Log {
		if contains(l, "pousse") {
			pushed = true
		}
	}
	if !pushed {
		t.Fatalf("range-2 push should have been performed: %v", c.Log)
	}
}

func TestUseItemHealsAndConsumes(t *testing.T) {
	gs, c, hu, mu := c3Combat(t)
	mu.X, mu.Y = 0, 0
	h := gs.Heroes[0]
	h.AddLoot(Item{Type: "consommable", Name: "Potion de soin", Qty: 2})
	hu.HP = 5
	if err := c.UseItem(gs, hu.ID, "Potion de soin"); err != nil {
		t.Fatalf("use item: %v", err)
	}
	// La valeur vient du CATALOGUE (items.go) — la lire ici plutôt que la recopier
	// est ce qui empêche la table du combat de re-diverger (voir CombatHeal).
	heal := CombatHeal("Potion de soin")
	if heal <= 0 {
		t.Fatal("a healing potion must be usable in combat")
	}
	if hu.HP != 5+heal {
		t.Fatalf("potion should heal +%d, hp=%d", heal, hu.HP)
	}
	if got := heroItemQty(h, "Potion de soin"); got != 1 {
		t.Fatalf("potion should be consumed from the bag, qty=%d", got)
	}
	found := false
	for _, hit := range c.LastHits {
		if hit.UnitID == hu.ID && hit.Kind == "heal" && hit.Amount == heal {
			found = true
		}
	}
	if !found {
		t.Fatalf("heal should be reported in LastHits: %+v", c.LastHits)
	}
	// objet absent ou inconnu = refus
	if err := c.UseItem(gs, hu.ID, "Acier"); err == nil {
		t.Fatalf("non-consumable items must be rejected")
	}
}

func TestFleePersistsPackAndSkipsLoot(t *testing.T) {
	gs, c, hu, mu := c3Combat(t)
	// une créature du pack est tuée avant la fuite
	mu.HP = 0
	extra := &CombatUnit{ID: "m-extra", Name: "Gelée", Side: "monster", RefID: mu.RefID,
		Kind: "Slime Vorace", X: 0, Y: 0, HP: 3, MaxHP: 6, States: []string{}, Move: 2}
	c.Units = append(c.Units, extra)
	m := gs.Monsters["m1"]
	m.Count = 3

	// fuite refusée hors du bord bas
	hu.X, hu.Y = 3, 3
	if err := c.PlayerAction(hu.ID, "flee", 0, 0, ""); err == nil {
		t.Fatalf("flee should require the bottom edge")
	}
	hu.Y = c.GridH - 1
	if err := c.PlayerAction(hu.ID, "flee", 0, 0, ""); err != nil {
		t.Fatalf("flee: %v", err)
	}
	if !hu.Fled {
		t.Fatalf("unit should be marked fled")
	}
	if c.Status != "fled" {
		t.Fatalf("last living hero fleeing should end the combat as fled, got %s", c.Status)
	}

	gs.FinishCombat(c)
	// pack conservé avec ses pertes : 3 - 1 tuée = 2, PV de tête = 3
	if _, ok := gs.Monsters["m1"]; !ok {
		t.Fatalf("the pack must survive a flee")
	}
	if m.Count != 2 {
		t.Fatalf("killed units should shrink the pack: count=%d", m.Count)
	}
	if m.HP != 3 {
		t.Fatalf("lead creature HP should persist: hp=%d", m.HP)
	}
	if len(c.Rewards) != 0 {
		t.Fatalf("fleeing yields no loot")
	}
	if len(gs.Heroes[0].Inventory) != 0 {
		t.Fatalf("fleeing hero should not receive loot")
	}
	// le héros reste sur la case du pack (pas de téléportation en ville)
	if gs.Heroes[0].X != c.TileX || gs.Heroes[0].Y != c.TileY {
		t.Fatalf("fled hero stays on the tile")
	}
}

func TestFledUnitSkippedInTurnOrder(t *testing.T) {
	gs, c, hu, mu := c3Combat(t)
	_ = gs
	hero2 := &CombatUnit{ID: "h-extra", Name: "Maëlle", Side: "hero", RefID: "hx",
		Kind: "Sans classe", X: 4, Y: c.GridH - 1, HP: 10, MaxHP: 10, States: []string{}, Move: 2}
	c.Units = append(c.Units, hero2)
	c.Order = append(c.Order, hero2.ID)
	hu.Y = c.GridH - 1
	if err := c.PlayerAction(hu.ID, "flee", 0, 0, ""); err != nil {
		t.Fatalf("flee: %v", err)
	}
	if c.Status != "active" {
		t.Fatalf("combat continues while a hero remains, got %s", c.Status)
	}
	// le fuyard ne doit plus jamais avoir le tour
	for i := 0; i < 20 && c.Status == "active"; i++ {
		cur := c.CurrentUnit()
		if cur == hu {
			t.Fatalf("fled unit must be skipped in the turn order")
		}
		if cur == nil || cur.Side != "hero" {
			break
		}
		if err := c.PlayerAction(cur.ID, "end", 0, 0, ""); err != nil {
			t.Fatalf("end: %v", err)
		}
	}
	_ = mu
}
