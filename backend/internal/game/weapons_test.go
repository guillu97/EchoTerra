package game

import "testing"

// LES ARMES FONT LE COMBAT (weapons.go) : chaque archétype apporte une technique,
// et cette technique doit se JOUER — pas seulement s'afficher.

// armedGame monte le combat de référence (arène plate, 1 héros / 1 monstre) avec
// une arme au poing.
func armedGame(t *testing.T, weapon string) (*GameState, *Combat, *CombatUnit, *CombatUnit) {
	t.Helper()
	gs, c, hu, mu := juiceGame()
	h := gs.Heroes[0]
	h.Weapon = weapon
	old := Equipment[hu.WeaponName]
	c.refreshWeapon(hu, h, old)
	for c.CurrentUnit() != hu {
		c.advanceTurn()
	}
	return gs, c, hu, mu
}

func TestWeaponGrantsItsTechnique(t *testing.T) {
	_, c, hu, _ := armedGame(t, "")
	bare := len(c.HeroSkills(hu))

	for weapon, want := range map[string]string{
		"Lame de fer":       "Fauchage",
		"Dague en croc":     "Coup bas",
		"Lance de sanglier": "Estoc",
		"Arc sylvestre":     "Tir en cloche",
	} {
		_, c, hu, _ := armedGame(t, weapon)
		skills := c.HeroSkills(hu)
		if len(skills) != bare+1 {
			t.Fatalf("%s should add exactly one technique: %d -> %d", weapon, bare, len(skills))
		}
		// la technique FERME la liste — c'est le contrat que l'API et le client
		// indexent par skillIdx.
		if got := skills[len(skills)-1].Name; got != want {
			t.Fatalf("%s: last skill should be %q, got %q", weapon, want, got)
		}
	}
}

// Les mains nues ne sont pas punies : sans arme, le héros garde exactement les
// compétences de sa classe (voir l'en-tête de weapons.go).
func TestBareHandsKeepClassSkillsOnly(t *testing.T) {
	_, c, hu, _ := armedGame(t, "")
	skills := c.HeroSkills(hu)
	if len(skills) != len(heroIsoSkillsFor(hu.ClassID)) {
		t.Fatalf("bare hands must not add or remove a skill: %d", len(skills))
	}
	if hu.Reach != 0 || hu.WeaponKind != "" {
		t.Fatalf("bare hands: no reach, no archetype (reach=%d kind=%q)", hu.Reach, hu.WeaponKind)
	}
}

// Fauchage (épée) frappe la case visée ET ses voisines : c'est sa raison d'être
// face à un pack, et ce que l'attaque de base ne fait pas.
func TestSwordSweepHitsNeighbours(t *testing.T) {
	_, c, hu, mu := armedGame(t, "Lame de fer")
	hu.X, hu.Y = 3, 3
	mu.X, mu.Y = 3, 2
	second := &CombatUnit{
		ID: "m2", Name: "Deuxième", Side: "monster", Kind: mu.Kind,
		X: 2, Y: 2, HP: 20, MaxHP: 20, Stats: mu.Stats, States: []string{}, Move: 1,
	}
	c.Units = append(c.Units, second)
	c.computeOrder()

	tech, ok := weaponTechnique(ArchSword)
	if !ok {
		t.Fatal("the sword must have a technique")
	}
	hp1, hp2 := mu.HP, second.HP
	c.performAttack(hu, &tech, mu.X, mu.Y)
	if mu.HP >= hp1 {
		t.Fatalf("the aimed target must be hit: %d -> %d", hp1, mu.HP)
	}
	if second.HP >= hp2 {
		t.Fatalf("a neighbour of the struck cell must be hit too: %d -> %d", hp2, second.HP)
	}
	// … et l'attaque de base, elle, ne touche QUE la case visée.
	base := c.baseAttackFor(hu)
	hp2 = second.HP
	c.performAttack(hu, &base, mu.X, mu.Y)
	if second.HP != hp2 {
		t.Fatalf("the plain attack must not splash: %d -> %d", hp2, second.HP)
	}
}

// Estoc (lance) : portée 2 ET la cible recule d'une case. C'est l'identité
// « tenir à distance », pas juste des chiffres plus gros.
func TestSpearThrustPushesTheTarget(t *testing.T) {
	_, c, hu, mu := armedGame(t, "Lance de sanglier")
	hu.X, hu.Y = 3, 4
	mu.X, mu.Y = 3, 2 // à DEUX cases : hors de portée d'une mêlée
	mu.HP, mu.MaxHP = 40, 40

	base := c.baseAttackFor(hu)
	if !c.canTarget(hu, &base, mu) {
		t.Fatal("a spear's plain attack reaches 2 cells (Reach)")
	}
	tech, _ := weaponTechnique(ArchSpear)
	c.performAttack(hu, &tech, mu.X, mu.Y)
	if mu.Y != 1 {
		t.Fatalf("the thrust must push the target one cell away: y=%d (want 1)", mu.Y)
	}
}

// Tir en cloche (arc) : ignore la couverture — mais ne peut pas viser au contact.
func TestBowLobIgnoresCoverButNotPointBlank(t *testing.T) {
	_, c, hu, mu := armedGame(t, "Arc sylvestre")
	hu.X, hu.Y = 3, 5
	mu.X, mu.Y = 3, 2
	mu.FX, mu.FY = 0, -1                // la cible fait DOS à l'arc ? non : elle regarde au nord…
	mu.FX, mu.FY = 0, 1                 // … elle fait face au tireur : pas d'attaque de dos
	c.Cells[3*c.GridW+3].Blocked = true // un abri juste devant elle, côté tireur

	tech, _ := weaponTechnique(ArchBow)
	base := c.baseAttackFor(hu) // arc : portée 3, même distance, mais pas de cloche
	loBase, _ := c.EstimateDamage(hu, mu, &base)
	loTech, _ := c.EstimateDamage(hu, mu, &tech)
	if _, cover := c.EstimateFlags(hu, mu, &base); !cover {
		t.Fatal("the plain shot must be penalised by cover (the fixture is wrong otherwise)")
	}
	if _, cover := c.EstimateFlags(hu, mu, &tech); cover {
		t.Fatal("the lob must not be flagged as covered")
	}
	if loTech <= loBase {
		t.Fatalf("ignoring cover must pay: base=%d lob=%d", loBase, loTech)
	}
	// … et au contact la cloche ne vise rien (portée MINIMALE 2).
	mu.X, mu.Y = 3, 4
	if c.canTarget(hu, &tech, mu) {
		t.Fatal("the lob must be unusable point-blank")
	}
}

// Changer d'arme est une ACTION : l'arme rangée revient au sac, la nouvelle en
// sort, les dérivés (portée, stats, déplacement) suivent, et le tour se termine.
func TestSwapWeaponCostsTheTurnAndRewiresTheUnit(t *testing.T) {
	gs, c, hu, mu := armedGame(t, "Lame de fer")
	mu.X, mu.Y = 0, 0 // au loin : l'IA ne viendra pas fausser le test
	h := gs.Heroes[0]
	h.AddLoot(Item{Type: "arme", Name: "Arc sylvestre", Qty: 1})
	force0 := hu.Stats.Force
	round0 := c.Round

	if err := c.SwapWeapon(gs, hu.ID, "Arc sylvestre"); err != nil {
		t.Fatalf("swap: %v", err)
	}
	if h.Weapon != "Arc sylvestre" {
		t.Fatalf("the hero should now hold the bow: %q", h.Weapon)
	}
	if heroItemQty(h, "Lame de fer") != 1 {
		t.Fatal("the sheathed weapon must return to the bag")
	}
	if heroItemQty(h, "Arc sylvestre") != 0 {
		t.Fatal("the drawn weapon must leave the bag")
	}
	if hu.Reach != 3 || hu.WeaponKind != ArchBow {
		t.Fatalf("the unit must follow the new weapon: reach=%d kind=%q", hu.Reach, hu.WeaponKind)
	}
	if want := force0 - 3; hu.Stats.Force != want {
		t.Fatalf("the sword's +3 force must be given back: %d -> %d (want %d)", force0, hu.Stats.Force, want)
	}
	// (avec un seul héros le tour revient à lui aussitôt : c'est le ROUND qui dit
	// que le tour a bien été rendu — même convention que le test de Défendre.)
	if c.Status == "active" && c.CurrentUnit() == hu && c.Round == round0 {
		t.Fatal("swapping weapons must end the turn")
	}
}

func TestSwapWeaponRefusesWhatIsNotInTheBag(t *testing.T) {
	gs, c, hu, _ := armedGame(t, "Lame de fer")
	if err := c.SwapWeapon(gs, hu.ID, "Arc sylvestre"); err == nil {
		t.Fatal("drawing a weapon the hero does not carry must be refused")
	}
	gs.Heroes[0].AddLoot(Item{Type: "conso", Name: "Potion de soin", Qty: 1})
	if err := c.SwapWeapon(gs, hu.ID, "Potion de soin"); err == nil {
		t.Fatal("a potion is not a weapon")
	}
	if err := c.SwapWeapon(gs, hu.ID, "Lame de fer"); err == nil {
		t.Fatal("drawing the weapon already in hand must be refused")
	}
}

// ⚠ LE MIROIR : la fourchette prévisualisée doit encadrer les dégâts réels, y
// compris avec les effets d'ARME (cloche qui ignore la couverture). Une preview
// qui ment est pire que pas de preview.
func TestWeaponTechniqueEstimateBracketsReality(t *testing.T) {
	SeedRNG(7)
	_, c, hu, mu := armedGame(t, "Arc sylvestre")
	hu.X, hu.Y = 3, 5
	mu.X, mu.Y = 3, 2
	mu.HP, mu.MaxHP = 5000, 5000
	c.Cells[3*c.GridW+3].Blocked = true
	tech, _ := weaponTechnique(ArchBow)
	lo, hi := c.EstimateDamage(hu, mu, &tech)
	for i := 0; i < 200; i++ {
		if d := c.damageWith(hu, mu, &tech); d < lo || d > hi {
			t.Fatalf("damage %d outside the announced bracket [%d,%d]", d, lo, hi)
		}
	}
}

// LA PORTÉE SE VOIT (AimCells) — et ce qu'elle montre doit être EXACTEMENT ce
// que le serveur accepte. Une portée peinte au sol plus large que la réalité
// est pire que pas de portée du tout : le joueur vise une case et se fait
// refuser.
func TestAimCellsMatchWhatTheServerAccepts(t *testing.T) {
	_, c, hu, mu := armedGame(t, "Lance de sanglier")
	hu.X, hu.Y = 3, 3
	base := c.baseAttackFor(hu)
	cells := c.AimCells(hu, &base)
	if len(cells) == 0 {
		t.Fatal("une lance doit pouvoir viser quelque chose")
	}
	// toute case peinte doit être DANS l'arène et réellement ciblable
	for _, cell := range cells {
		if cell[0] < 0 || cell[1] < 0 || cell[0] >= c.GridW || cell[1] >= c.GridH {
			t.Fatalf("case hors arène peinte : %v", cell)
		}
		mu.X, mu.Y = cell[0], cell[1]
		if !c.canTarget(hu, &base, mu) {
			t.Fatalf("case %v peinte mais refusée par canTarget", cell)
		}
	}
	// … et réciproquement : une case ciblable doit être peinte.
	painted := map[[2]int]bool{}
	for _, cell := range cells {
		painted[cell] = true
	}
	for y := 0; y < c.GridH; y++ {
		for x := 0; x < c.GridW; x++ {
			mu.X, mu.Y = x, y
			if c.canTarget(hu, &base, mu) && !painted[[2]int{x, y}] {
				t.Fatalf("case (%d,%d) ciblable mais NON peinte", x, y)
			}
		}
	}
}

func TestAimCellsRespectLineOfSight(t *testing.T) {
	_, c, hu, _ := armedGame(t, "Arc sylvestre")
	hu.X, hu.Y = 3, 5
	tech, _ := weaponTechnique(ArchBow)
	before := len(c.AimCells(hu, &tech))
	c.Cells[4*c.GridW+3].Blocked = true // un rocher juste devant, plein nord
	after := c.AimCells(hu, &tech)
	if len(after) >= before {
		t.Fatalf("un obstacle doit RETIRER des cases visables : %d -> %d", before, len(after))
	}
	for _, cell := range after {
		if cell[0] == 3 && cell[1] < 4 {
			t.Fatalf("la colonne derrière le rocher ne doit plus être visable : %v", cell)
		}
	}
}

// Une capacité sur soi ne peint rien : il n'y a rien à viser.
func TestAimCellsEmptyForSelfCast(t *testing.T) {
	_, c, hu, _ := armedGame(t, "")
	hu.ClassID = "gardien"
	sk := heroSkillFor("gardien") // Posture défensive
	if cells := c.AimCells(hu, &sk); len(cells) != 0 {
		t.Fatalf("une capacité sur soi ne peint aucune case : %v", cells)
	}
}
