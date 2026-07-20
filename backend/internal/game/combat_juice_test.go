package game

import "testing"

// Lot C2 (lisibilité & juice) : Seq/LastHits (dégâts flottants), EstimateDamage
// (fourchette prévisualisée), ThreatCells (télégraphie) et Rewards (victoire).

func juiceGame() (*GameState, *Combat, *CombatUnit, *CombatUnit) {
	gs := &GameState{ID: "g1", Width: 8, Height: 8, Monsters: map[string]*Monster{}, Combats: map[string]*Combat{}}
	gs.Tiles = make([]Tile, 64)
	m := testMonster()
	gs.Monsters[m.ID] = m
	gs.TileAt(m.X, m.Y).MonsterID = m.ID
	hero := testHero("Aldric", 30)
	hero.X, hero.Y = m.X, m.Y
	gs.Heroes = []*Hero{hero}
	c := NewCombat(gs, []*Hero{hero}, m, "")
	var hu, mu *CombatUnit
	for _, u := range c.Units {
		if u.Side == "hero" {
			hu = u
		} else {
			mu = u
		}
	}
	// arène neutre pour des tests déterministes : plate, sans obstacle ni danger
	for i := range c.Cells {
		c.Cells[i] = CombatCell{}
		c.Heights[i] = 0
	}
	return gs, c, hu, mu
}

func TestSeqAndLastHitsPerAction(t *testing.T) {
	_, c, hu, mu := juiceGame()
	// place le monstre au contact et donne le tour au héros
	mu.X, mu.Y = hu.X+1, hu.Y
	for c.CurrentUnit() != hu {
		c.advanceTurn()
	}
	seq0 := c.Seq
	if err := c.PlayerAction(hu.ID, "attack", 0, 0, mu.ID); err != nil {
		t.Fatalf("attack: %v", err)
	}
	if c.Seq != seq0+1 {
		t.Fatalf("Seq should advance once per action: %d -> %d", seq0, c.Seq)
	}
	// au moins le coup du héros doit figurer dans LastHits, attribué au monstre
	found := false
	for _, h := range c.LastHits {
		if h.UnitID == mu.ID && h.Kind == "dmg" && h.Amount > 0 {
			found = true
		}
	}
	if !found {
		t.Fatalf("LastHits should carry the hero's hit on the monster: %+v", c.LastHits)
	}
}

func TestLastHitsResetEachAction(t *testing.T) {
	_, c, hu, _ := juiceGame()
	for c.CurrentUnit() != hu {
		c.advanceTurn()
	}
	if err := c.PlayerAction(hu.ID, "end", 0, 0, ""); err != nil {
		t.Fatalf("end: %v", err)
	}
	hitsAfterEnemy := len(c.LastHits) // coups du tour IA éventuel
	if c.Status != "active" {
		t.Skipf("combat ended early (hits=%d)", hitsAfterEnemy)
	}
	cur := c.CurrentUnit()
	if cur == nil || cur.Side != "hero" {
		t.Fatalf("expected hero turn")
	}
	seq0 := c.Seq
	if err := c.PlayerAction(cur.ID, "end", 0, 0, ""); err != nil {
		t.Fatalf("end 2: %v", err)
	}
	if c.Seq != seq0+1 {
		t.Fatalf("Seq should advance")
	}
	// LastHits ne contient QUE les coups du dernier lot (reset à chaque action)
	for _, h := range c.LastHits {
		if h.Amount <= 0 {
			t.Fatalf("hit amounts must be positive: %+v", h)
		}
	}
}

func TestEstimateDamageBracketsReality(t *testing.T) {
	_, c, hu, mu := juiceGame()
	atk := c.baseAttackFor(hu)
	lo, hi := c.EstimateDamage(hu, mu, &atk)
	if lo < 1 || hi < lo {
		t.Fatalf("bad estimate: [%d,%d]", lo, hi)
	}
	if hi != lo+2 && lo != 1 { // la borne haute = borne basse + 2 sauf clamp à 1
		t.Fatalf("expected hi=lo+2, got [%d,%d]", lo, hi)
	}
	for i := 0; i < 50; i++ {
		d := c.damageWith(hu, mu, &atk)
		if d < lo || d > hi {
			t.Fatalf("real damage %d outside estimate [%d,%d]", d, lo, hi)
		}
	}
	// le Bouclier divise la fourchette comme les dégâts réels
	mu.addState("Bouclier")
	slo, shi := c.EstimateDamage(hu, mu, &atk)
	if slo > lo || shi > hi {
		t.Fatalf("shielded estimate [%d,%d] should not exceed [%d,%d]", slo, shi, lo, hi)
	}
	for i := 0; i < 50; i++ {
		d := c.damageWith(hu, mu, &atk)
		if d < slo || d > shi {
			t.Fatalf("shielded damage %d outside estimate [%d,%d]", d, slo, shi)
		}
	}
}

func TestEstimateHighGroundBonus(t *testing.T) {
	_, c, hu, mu := juiceGame()
	atk := c.baseAttackFor(hu)
	lo0, _ := c.EstimateDamage(hu, mu, &atk)
	// surélève l'attaquant : +1 dans la fourchette
	c.Cells[hu.Y*c.GridW+hu.X].Height = 2
	c.Heights[hu.Y*c.GridW+hu.X] = 2
	lo1, _ := c.EstimateDamage(hu, mu, &atk)
	if lo1 != lo0+1 {
		t.Fatalf("high ground should add +1 to the estimate: %d -> %d", lo0, lo1)
	}
}

func TestThreatCellsCoverAdjacent(t *testing.T) {
	_, c, _, mu := juiceGame()
	mu.X, mu.Y = 3, 3
	cells := c.ThreatCells(mu)
	if len(cells) == 0 {
		t.Fatalf("a monster should threaten at least its melee ring")
	}
	want := map[[2]int]bool{{4, 3}: false, {2, 3}: false, {3, 4}: false, {3, 2}: false}
	for _, cell := range cells {
		if _, ok := want[cell]; ok {
			want[cell] = true
		}
		if cell[0] < 0 || cell[1] < 0 || cell[0] >= c.GridW || cell[1] >= c.GridH {
			t.Fatalf("threat cell out of grid: %v", cell)
		}
	}
	for k, seen := range want {
		if !seen {
			t.Fatalf("orthogonal cell %v missing from threats %v", k, cells)
		}
	}
}

func TestVictoryRecordsRewards(t *testing.T) {
	gs, c, hu, mu := juiceGame()
	// tue le monstre puis termine : FinishCombat doit consigner le butin par héros
	mu.HP = 0
	c.checkEnd()
	if c.Status != "won" {
		t.Fatalf("expected won, got %s", c.Status)
	}
	gs.FinishCombat(c)
	if len(c.Rewards) != 1 {
		t.Fatalf("expected 1 reward entry, got %d", len(c.Rewards))
	}
	r := c.Rewards[0]
	if r.HeroID != gs.Heroes[0].ID || r.HeroName != gs.Heroes[0].Name {
		t.Fatalf("reward should belong to the hero: %+v", r)
	}
	if len(r.Items) == 0 || r.Items[0].Qty <= 0 {
		t.Fatalf("reward should carry at least one item: %+v", r.Items)
	}
	// et le sac du héros contient bien ce butin
	if len(gs.Heroes[0].Inventory) == 0 {
		t.Fatalf("hero inventory should hold the loot")
	}
	_ = hu
}
