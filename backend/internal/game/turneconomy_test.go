package game

// L'ÉCONOMIE DU TOUR ET LES RECHARGES.
//
// Ce que ces tests défendent, et pourquoi ils n'existaient pas avant : le combat
// tenait déjà « une action par tour » — toute action appelait endTurn — mais
// AUCUN test ne l'affirmait, et surtout rien n'empêchait de rejouer la MÊME
// capacité, la plus bonifiée, à chaque tour, indéfiniment. Le tour de jeu se
// résumait donc à une question dont la réponse ne changeait jamais.
//
// Trois contrats ici :
//  1. une action par tour, et elle est REFUSÉE deux fois ;
//  2. une capacité spéciale part en recharge, l'IA la respecte comme le joueur ;
//  3. le déplacement reste disponible après avoir agi (frapper puis décrocher) —
//     et le tour se ferme tout seul quand les deux budgets sont dépensés.

import "testing"

// teCombat monte un combat à un héros contre un monstre planté loin, pour que
// l'IA ne vienne pas fausser le compte des tours.
func teCombat(t *testing.T) (*GameState, *Combat, *CombatUnit, *CombatUnit) {
	t.Helper()
	SeedRNG(7)
	gs := &GameState{ID: "g", Width: 9, Height: 9, Tiles: make([]Tile, 81)}
	h := NewStarterHero(0, "Ava", 4, 4)
	h.HP, h.MaxHP = 200, 200
	h.Stats.Agilite = 9 // il joue avant le monstre
	gs.Heroes = []*Hero{h}
	m := &Monster{ID: "m", Species: "Slime", X: 4, Y: 4, HP: 400, MaxHP: 400, Count: 1,
		Stats: Stats{Force: 1, Agilite: 0, Endurance: 1}}
	c := NewCombat(gs, []*Hero{h}, m, "")
	var hu, mu *CombatUnit
	for _, u := range c.Units {
		if u.Side == "hero" {
			hu = u
		} else if mu == nil {
			mu = u
		}
	}
	if c.CurrentUnit() != hu {
		t.Fatalf("le héros devrait ouvrir (initiative) — c'est %v", c.CurrentUnit().Name)
	}
	mu.X, mu.Y = hu.X, hu.Y-1 // au contact, dans la grille orthogonale de l'attaque
	// Les hauteurs de l'arène sont tirées au sort : on les aplanit pour que ces
	// tests ne parlent QUE de l'économie du tour.
	for i := range c.Cells {
		c.Cells[i] = CombatCell{}
		c.Heights[i] = 0
	}
	return gs, c, hu, mu
}

// UNE SEULE ACTION PAR TOUR. C'est le reproche d'origine : « on peut se déplacer
// puis faire dix fois la même attaque ». Le tour ne portait pas de budget nommé,
// donc rien ne pouvait le refuser explicitement.
func TestOneActionPerTurn(t *testing.T) {
	_, c, hu, mu := teCombat(t)
	if err := c.PlayerAction(hu.ID, "attack", 0, 0, mu.ID); err != nil {
		t.Fatalf("première attaque: %v", err)
	}
	if !hu.Acted {
		t.Fatal("attaquer doit dépenser l'action du tour")
	}
	// Le héros n'a pas bougé : la main lui reste (il peut décrocher). Mais il ne
	// peut plus FRAPPER.
	if c.CurrentUnit() != hu {
		t.Fatal("le héros garde la main tant qu'il lui reste son déplacement")
	}
	if err := c.PlayerAction(hu.ID, "attack", 0, 0, mu.ID); err == nil {
		t.Fatal("une seconde attaque dans le même tour doit être refusée")
	}
	if err := c.PlayerAction(hu.ID, "defend", 0, 0, ""); err == nil {
		t.Fatal("se défendre après avoir frappé doit être refusé : c'est la même action")
	}
}

// FRAPPER PUIS DÉCROCHER. L'ancien modèle fermait le tour sur l'attaque, donc un
// arc ou une lance n'avaient aucune façon de reculer après leur coup : leur portée
// ne servait qu'à ouvrir l'échange.
func TestActThenMoveThenTurnCloses(t *testing.T) {
	_, c, hu, mu := teCombat(t)
	round0 := c.Round
	if err := c.PlayerAction(hu.ID, "attack", 0, 0, mu.ID); err != nil {
		t.Fatalf("attaque: %v", err)
	}
	if c.Round != round0 || c.CurrentUnit() != hu {
		t.Fatal("agir seul ne doit pas fermer le tour tant que le déplacement reste")
	}
	// Une case atteignable : on prend la première que le serveur propose.
	reach := c.Reachable(hu)
	if len(reach) == 0 {
		t.Fatal("le héros devrait pouvoir bouger")
	}
	if err := c.PlayerAction(hu.ID, "move", reach[0][0], reach[0][1], ""); err != nil {
		t.Fatalf("déplacement après l'attaque: %v", err)
	}
	if c.Round == round0 && c.CurrentUnit() == hu {
		t.Fatal("les deux budgets dépensés, le tour doit se fermer tout seul")
	}
}

// LE CAS ORDINAIRE NE COÛTE PAS UN CLIC DE PLUS : avancer puis frapper ferme le
// tour exactement comme avant. C'est la contrepartie du test précédent — sans
// cette garantie, le nouveau modèle serait une taxe sur chaque tour joué.
func TestMoveThenActStillClosesTheTurn(t *testing.T) {
	_, c, hu, mu := teCombat(t)
	round0 := c.Round
	reach := c.Reachable(hu)
	if len(reach) == 0 {
		t.Fatal("le héros devrait pouvoir bouger")
	}
	if err := c.PlayerAction(hu.ID, "move", reach[0][0], reach[0][1], ""); err != nil {
		t.Fatalf("déplacement: %v", err)
	}
	if c.CurrentUnit() != hu {
		t.Fatal("un simple pas ne ferme jamais le tour")
	}
	mu.X, mu.Y = hu.X, hu.Y-1 // le monstre reste au contact après le pas
	if err := c.PlayerAction(hu.ID, "attack", 0, 0, mu.ID); err != nil {
		t.Fatalf("attaque après le pas: %v", err)
	}
	if c.Round == round0 && c.CurrentUnit() == hu {
		t.Fatal("avancer puis frapper doit fermer le tour, comme avant")
	}
}

// LA RECHARGE. Le vrai correctif du reproche : ce n'est pas le nombre d'actions
// qui manquait de limite, c'est la RÉPÉTITION de la meilleure d'entre elles.
func TestSpecialSkillGoesOnCooldown(t *testing.T) {
	_, c, hu, mu := teCombat(t)
	skills := c.HeroSkills(hu)
	if len(skills) == 0 {
		t.Fatal("un héros sans classe a quand même sa Frappe puissante")
	}
	if skills[0].Cooldown <= 0 {
		t.Fatalf("une capacité spéciale doit porter une recharge: %+v", skills[0])
	}
	if err := c.PlayerAction(hu.ID, "skill", 0, 0, mu.ID, 0); err != nil {
		t.Fatalf("compétence: %v", err)
	}
	if left := hu.cooldownLeft(&skills[0]); left != skills[0].Cooldown {
		t.Fatalf("la recharge doit démarrer pleine: %d/%d", left, skills[0].Cooldown)
	}
	// On rend la main jusqu'au tour suivant du héros.
	hu.Moved = true
	c.spendBudget(hu)
	for guard := 0; guard < 40 && c.CurrentUnit() != hu; guard++ {
		c.advanceTurn()
		c.advanceUntilHeroOrEnd()
	}
	if err := c.PlayerAction(hu.ID, "skill", 0, 0, mu.ID, 0); err == nil {
		t.Fatal("relancer la compétence au tour suivant doit être refusé (recharge)")
	}
	// … mais l'attaque de BASE, elle, reste disponible chaque tour : la recharge
	// pousse à composer, elle ne prive jamais d'agir.
	mu.X, mu.Y = hu.X, hu.Y-1
	if err := c.PlayerAction(hu.ID, "attack", 0, 0, mu.ID); err != nil {
		t.Fatalf("l'attaque de base ne se recharge pas: %v", err)
	}
}

// La recharge doit s'ÉCOULER : un cooldown de 2 rend la capacité au 3ᵉ tour de
// l'unité. Sans ce test, mettre le compteur à 999 passerait la suite.
func TestCooldownExpires(t *testing.T) {
	_, c, hu, mu := teCombat(t)
	sk := c.HeroSkills(hu)[0]
	if err := c.PlayerAction(hu.ID, "skill", 0, 0, mu.ID, 0); err != nil {
		t.Fatalf("compétence: %v", err)
	}
	turns := 0
	for guard := 0; guard < 60 && !hu.ready(&sk); guard++ {
		hu.Moved, hu.Acted = true, true
		c.spendBudget(hu)
		for g2 := 0; g2 < 40 && c.CurrentUnit() != hu; g2++ {
			c.advanceTurn()
			c.advanceUntilHeroOrEnd()
		}
		turns++
	}
	if !hu.ready(&sk) {
		t.Fatal("la recharge doit finir par s'écouler")
	}
	if turns != sk.Cooldown {
		t.Fatalf("une recharge de %d doit rendre la capacité après %d tours, pas %d", sk.Cooldown, sk.Cooldown, turns)
	}
}

// L'IA JOUE LA MÊME RÈGLE. Un cooldown que seul le joueur subit n'est pas une
// règle du jeu, c'est un handicap : les monstres et les héros auto-résolus des
// bots doivent le respecter aussi.
func TestAIRespectsCooldowns(t *testing.T) {
	SeedRNG(11)
	gs := &GameState{ID: "g", Width: 9, Height: 9, Tiles: make([]Tile, 81)}
	h := NewStarterHero(0, "Ava", 4, 4)
	h.HP, h.MaxHP = 900, 900
	gs.Heroes = []*Hero{h}
	// L'Élémentaire de Vent : sa Colonne de Vent étourdit à 100 %. Rejouée à chaque
	// tour, elle verrouillait un héros jusqu'à sa mort — ce n'est pas un combat.
	m := &Monster{ID: "m", Species: "Elementaire de Vent", X: 4, Y: 4, HP: 900, MaxHP: 900, Count: 1,
		Stats: Stats{Dexterite: 2, Agilite: 3, Endurance: 5, Precision: 2}}
	c := NewCombat(gs, []*Hero{h}, m, "")
	var mu *CombatUnit
	for _, u := range c.Units {
		if u.Side == "monster" {
			mu = u
		}
	}
	var col *AttackDef
	for _, a := range monsterAttacks(mu.Kind) {
		if a.Kind == "special" {
			ad := a
			col = &ad
		}
	}
	if col == nil || col.Cooldown <= 0 {
		t.Fatalf("les spéciales du catalogue de design doivent hériter d'une recharge: %+v", col)
	}
	// On force la spéciale, puis on rejoue le tour du monstre : il ne doit pas la
	// relancer tant qu'elle se recharge.
	c.performAttack(mu, col, mu.X, mu.Y)
	mu.startCooldown(col)
	before := mu.cooldownLeft(col)
	c.monsterTurn(mu)
	if mu.cooldownLeft(col) > before {
		t.Fatal("l'IA a rejoué une capacité en recharge")
	}
}

// ATHLÉTISME — la statistique morte. Trois classes sur six la donnaient comme
// bonus PRINCIPAL (+5) et aucune ligne de code ne la lisait. Elle décide
// désormais de la marche qu'on franchit : l'athlète monte là où les autres
// restent en bas, et la hauteur donne déjà un bonus de dégâts.
func TestAthletismeOpensHigherGround(t *testing.T) {
	_, c, hu, mu := teCombat(t)
	mu.X, mu.Y = 0, 0 // teCombat le pose au contact : on dégage la case à escalader
	// une terrasse de 3 niveaux juste à côté du héros
	tx, ty := hu.X, hu.Y-1
	c.Heights[ty*c.GridW+tx] = 3
	c.Cells[ty*c.GridW+tx] = CombatCell{Height: 3}

	hu.Stats.Athletisme = 0
	if c.passable(tx, ty, hu) {
		t.Fatal("sans athlétisme, une marche de 3 niveaux doit rester infranchissable")
	}
	hu.Stats.Athletisme = 8 // +2 de franchissement
	if !c.passable(tx, ty, hu) {
		t.Fatal("l'athlétisme doit ouvrir la terrasse haute")
	}
}

// PRÉCISION — elle ne servait que de statistique de dégâts à DEUX capacités sur
// tout le jeu. Elle achète maintenant le coup critique, pour tout le monde, et
// ce critique est ANNONCÉ (le client n'invente jamais un chiffre de dégâts).
func TestPrecisionBuysCriticalHits(t *testing.T) {
	_, c, hu, mu := teCombat(t)
	atk := c.BaseAttack(hu)

	hu.Stats.Precision = 0
	if pct, _ := c.CritChance(hu, mu, &atk); pct != 0 {
		t.Fatalf("sans précision, aucun critique à annoncer (%d %%)", pct)
	}
	hu.Stats.Precision = 5
	pct, cmax := c.CritChance(hu, mu, &atk)
	if pct <= 0 {
		t.Fatal("la précision doit donner une chance de critique")
	}
	_, ordinary := c.EstimateDamage(hu, mu, &atk)
	if cmax <= ordinary {
		t.Fatalf("un critique doit frapper plus fort qu'un coup ordinaire: %d vs %d", cmax, ordinary)
	}
	// PLAFOND : une statistique poussée à l'extrême ne doit pas rendre le critique
	// systématique — ce serait un multiplicateur de dégâts déguisé.
	hu.Stats.Precision = 99
	if p := hu.critPct(); p > 40 {
		t.Fatalf("la chance de critique doit rester plafonnée: %d %%", p)
	}
}

// ENDURANCE — la moitié « visible » de la statistique (encaisser plus) ne se
// produisait jamais après la création : l'évolution de classe ajoutait de
// l'endurance sans toucher aux PV.
func TestEvolutionRaisesMaxHPWithEndurance(t *testing.T) {
	SeedRNG(3)
	gs := &GameState{ID: "g", Day: EvolveDayIntermediate, Width: 5, Height: 5, Tiles: make([]Tile, 25)}
	h := NewStarterHero(0, "Ava", 2, 2)
	gs.Heroes = []*Hero{h}
	hp0, end0 := h.MaxHP, h.Stats.Endurance

	if err := gs.EvolveHero(h.ID, "pionnier"); err != nil {
		t.Fatalf("évolution: %v", err)
	}
	gained := h.Stats.Endurance - end0
	if gained <= 0 {
		t.Fatal("le Pionnier apporte de l'endurance")
	}
	if h.MaxHP != hp0+2*gained {
		t.Fatalf("les PV doivent suivre l'endurance (même barème qu'à la création): %d -> %d, attendu %d",
			hp0, h.MaxHP, hp0+2*gained)
	}
	if h.HP != h.MaxHP {
		t.Fatalf("un héros intact doit rester intact après son évolution: %d/%d", h.HP, h.MaxHP)
	}
}
