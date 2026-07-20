package game

import "testing"

// Lot C5 : boss 2×2 en arène 9×9 (patterns télégraphiés), IA de meute
// (focus-fire, retraite, buffeur en retrait), renforts vague 4+.

func bossGame(t *testing.T) (*GameState, *Combat, *CombatUnit, *CombatUnit) {
	t.Helper()
	gs := &GameState{ID: "g1", Width: 8, Height: 8, Monsters: map[string]*Monster{}, Combats: map[string]*Combat{}}
	gs.Tiles = make([]Tile, 64)
	m := &Monster{ID: "m1", Species: "Roi Gobelin sur Sanglier Géant", X: 3, Y: 3,
		HP: 20, MaxHP: 20, Stats: Stats{Force: 4, Agilite: 2, Endurance: 3}, Count: 1}
	gs.Monsters[m.ID] = m
	gs.TileAt(m.X, m.Y).MonsterID = m.ID
	h := testHero("Aldric", 6)
	h.X, h.Y = m.X, m.Y
	h.HP, h.MaxHP = 60, 60
	h.Stats.Endurance = 8
	gs.Heroes = []*Hero{h}
	c, err := gs.StartCombat(h.ID, "")
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	var hu, bu *CombatUnit
	for _, u := range c.Units {
		if u.Side == "hero" {
			hu = u
		} else {
			bu = u
		}
	}
	return gs, c, hu, bu
}

func TestBossArenaAndFootprint(t *testing.T) {
	_, c, _, bu := bossGame(t)
	if c.GridW != 9 || c.GridH != 9 {
		t.Fatalf("boss arena should be 9x9, got %dx%d", c.GridW, c.GridH)
	}
	if bu == nil || bu.Size != 2 {
		t.Fatalf("boss unit should be 2x2")
	}
	// une seule unité monstre, qui occupe bien 4 cases
	monsters := 0
	for _, u := range c.Units {
		if u.Side == "monster" {
			monsters++
		}
	}
	if monsters != 1 {
		t.Fatalf("a boss fights alone, got %d monster units", monsters)
	}
	for _, cell := range bu.footprint() {
		if got := c.unitAt(cell[0], cell[1]); got != bu {
			t.Fatalf("unitAt(%v) should resolve to the boss", cell)
		}
	}
	if len(bu.footprint()) != 4 {
		t.Fatalf("2x2 boss occupies 4 cells")
	}
}

func TestBossMeleeFromAnyFootprintCell(t *testing.T) {
	_, c, hu, bu := bossGame(t)
	// héros collé au coin bas-droit de l'empreinte (hors adjacence de l'ANCRE)
	bu.X, bu.Y = 3, 3
	hu.X, hu.Y = 4, 5 // adjacent (orth) à la case (4,4) de l'empreinte
	base := c.baseAttackFor(bu)
	if !c.canTarget(bu, &base, hu) {
		t.Fatalf("the boss should reach a hero adjacent to ANY footprint cell")
	}
	// et réciproquement le héros atteint le boss par cette case
	hb := c.baseAttackFor(hu)
	if !c.canTarget(hu, &hb, bu) {
		t.Fatalf("the hero should reach the boss via its nearest cell")
	}
	// un boss ne se pousse pas
	for c.CurrentUnit() != hu && c.Status == "active" {
		c.advanceTurn()
	}
	if err := c.PlayerAction(hu.ID, "push", 0, 0, bu.ID); err == nil {
		t.Fatalf("pushing a boss must be rejected")
	}
}

func TestBossAttacksEveryTurnBaseOrSpecial(t *testing.T) {
	// Révision 2026-07-20 : plus d'annonce (un tour gratuit s'esquivait à
	// l'infini) — au contact, le boss FRAPPE à chaque tour, base ou spéciale.
	_, c, hu, bu := bossGame(t)
	bu.X, bu.Y = 3, 1
	hu.X, hu.Y = 3, 3 // collé au bord bas de l'empreinte (mêlée)
	usedBase, usedSpecial := false, false
	for i := 0; i < 60; i++ {
		hu.HP = hu.MaxHP // on ne mesure que le comportement, pas la survie
		bu.Moved = true  // géométrie figée
		logLen := len(c.Log)
		c.bossTurn(bu)
		if hu.HP == hu.MaxHP {
			t.Fatalf("at melee range the boss must attack EVERY turn (iter %d, log %v)", i, c.Log[logLen:])
		}
		turnLog := ""
		for _, l := range c.Log[logLen:] {
			turnLog += l + " | "
		}
		if contains(turnLog, "Charge du Sanglier") {
			usedBase = true // l'attaque de base du Roi Gobelin
		}
		if contains(turnLog, "Piétinement du Croc") {
			usedSpecial = true // sa spéciale de zone (immédiate)
		}
	}
	if !usedBase || !usedSpecial {
		t.Fatalf("over 60 turns the boss should mix base and special attacks (base=%v special=%v)", usedBase, usedSpecial)
	}
}

func TestPackFocusFireTargetsWounded(t *testing.T) {
	_, c, hu, mu := c3Combat(t)
	mu.X, mu.Y = 3, 3
	// deux héros : l'un intact à côté, l'autre BLESSÉ un peu plus loin
	hu.X, hu.Y = 4, 3
	hu.HP = 20
	wounded := &CombatUnit{ID: "h-wound", Name: "Blessé", Side: "hero", RefID: "hw",
		X: 3, Y: 5, HP: 3, MaxHP: 20, States: []string{}, Move: 2}
	c.Units = append(c.Units, wounded)
	if got := c.packTarget(mu); got != wounded {
		t.Fatalf("pack AI should focus the most wounded enemy, got %s", got.Name)
	}
}

func TestRetreatWhenBadlyHurt(t *testing.T) {
	_, c, hu, mu := c3Combat(t)
	hu.X, hu.Y = 3, 3
	mu.X, mu.Y = 4, 3
	mu.HP = 1 // < 25 % de 6
	d0 := manhattan(hu.X, hu.Y, mu.X, mu.Y)
	c.monsterTurn(mu)
	d1 := manhattan(hu.X, hu.Y, mu.X, mu.Y)
	if d1 <= d0 {
		t.Fatalf("a badly hurt creature should step away first: dist %d -> %d", d0, d1)
	}
}

func TestReinforcementsArriveWave4(t *testing.T) {
	gs := &GameState{ID: "g1", Width: 8, Height: 8, WaveNumber: 5,
		Monsters: map[string]*Monster{}, Combats: map[string]*Combat{}}
	gs.Tiles = make([]Tile, 64)
	m := &Monster{ID: "m1", Species: "Slime Vorace", X: 3, Y: 3, HP: 30, MaxHP: 30,
		Stats: Stats{Force: 1, Agilite: 1, Endurance: 6}, Count: 3}
	gs.Monsters[m.ID] = m
	gs.TileAt(m.X, m.Y).MonsterID = m.ID
	h := testHero("Aldric", 3)
	h.X, h.Y = m.X, m.Y
	h.HP, h.MaxHP = 80, 80
	h.Stats.Endurance = 10
	gs.Heroes = []*Hero{h}
	c, err := gs.StartCombat(h.ID, "")
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if c.ReinforceAt != 3 {
		t.Fatalf("wave >= 4 should schedule reinforcements at round 3, got %d", c.ReinforceAt)
	}
	before := 0
	for _, u := range c.Units {
		if u.Side == "monster" {
			before++
		}
	}
	// jouer des tours (end) jusqu'au round 3
	for i := 0; i < 40 && c.Status == "active" && c.Round < 3; i++ {
		cur := c.CurrentUnit()
		if cur == nil || cur.Side != "hero" {
			break
		}
		if err := c.PlayerAction(cur.ID, "end", 0, 0, ""); err != nil {
			t.Fatalf("end: %v", err)
		}
	}
	if c.Status != "active" {
		t.Skipf("combat ended before round 3 (status=%s)", c.Status)
	}
	if !c.ReinforceDone {
		t.Fatalf("reinforcements should have arrived by round %d", c.Round)
	}
	after := 0
	for _, u := range c.Units {
		if u.Side == "monster" {
			after++
		}
	}
	if after <= before {
		t.Fatalf("reinforcements should add monster units: %d -> %d", before, after)
	}
	// annoncés dans le log avant d'arriver
	announced := false
	for _, l := range c.Log {
		if contains(l, "renforts ennemis approchent") {
			announced = true
		}
	}
	if !announced {
		t.Fatalf("reinforcements must be announced one round ahead: %v", c.Log)
	}
}

func TestNoReinforcementsEarlyWaves(t *testing.T) {
	gs, c, _, _ := juiceGame()
	_ = gs
	if c.ReinforceAt != 0 {
		t.Fatalf("early waves should not schedule reinforcements")
	}
}
