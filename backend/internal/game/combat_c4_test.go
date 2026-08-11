package game

import "testing"

// Lot C4 : ligne de vue (Bresenham), couverture −25 %, hauteur formalisée
// (+1/niveau max +3, −1 en contre-plongée), attaque de dos +25 % (Facing).

func TestLOSBlockedByObstacle(t *testing.T) {
	_, c, hu, mu := c3Combat(t)
	hu.X, hu.Y = 1, 3
	mu.X, mu.Y = 4, 3
	hu.ClassID = "chasseur" // Tir de zone : portée 3 (manhattan)
	sk := heroSkillFor("chasseur")
	if len(c.TargetsFor(hu, &sk)) != 1 {
		t.Fatalf("clear path: the ranged skill should see the target")
	}
	// un rocher SUR le trajet coupe la ligne de vue
	c.Cells[3*c.GridW+2].Blocked = true
	if len(c.TargetsFor(hu, &sk)) != 0 {
		t.Fatalf("an obstacle on the path must block the ranged shot")
	}
	if err := c.PlayerAction(hu.ID, "skill", 0, 0, mu.ID); err == nil {
		t.Fatalf("firing through an obstacle must be rejected")
	}
	// la mêlée n'est pas concernée : au contact, on frappe
	mu.X, mu.Y = 2, 4 // hors mêlée pour hu(1,3) ? non : (1,3)->(2,4) diag — place au contact
	mu.X, mu.Y = 1, 4
	base := c.baseAttackFor(hu)
	if !c.canTarget(hu, &base, mu) {
		t.Fatalf("melee ignores line of sight")
	}
}

func TestHeightPenaltyFromBelow(t *testing.T) {
	_, c, hu, mu := c3Combat(t)
	hu.X, hu.Y = 3, 3
	mu.X, mu.Y = 4, 3
	atk := c.baseAttackFor(hu)
	lo0, _ := c.EstimateDamage(hu, mu, &atk)
	// la cible est surélevée de 2 : contre-plongée = −1 (borné)
	c.Cells[3*c.GridW+4].Height = 2
	c.Heights[3*c.GridW+4] = 2
	lo1, _ := c.EstimateDamage(hu, mu, &atk)
	if lo1 != lo0-1 {
		t.Fatalf("attacking from below should cost exactly -1: %d -> %d", lo0, lo1)
	}
}

func TestRearAttackBonus(t *testing.T) {
	_, c, hu, mu := c3Combat(t)
	hu.X, hu.Y = 3, 3
	mu.X, mu.Y = 4, 3
	mu.FX, mu.FY = 1, 0 // la cible regarde à l'EST — l'attaquant (à l'ouest) est dans son dos
	if !c.isRearAttack(hu, mu) {
		t.Fatalf("attacker west of an east-facing target is in its rear arc")
	}
	atk := c.baseAttackFor(hu)
	lo, hi := c.EstimateDamage(hu, mu, &atk)
	mu.FX, mu.FY = -1, 0 // la cible fait face → plus d'attaque de dos
	loF, _ := c.EstimateDamage(hu, mu, &atk)
	if lo <= loF {
		t.Fatalf("rear attack should deal more: rear lo=%d vs front lo=%d", lo, loF)
	}
	// les dégâts réels restent dans la fourchette annoncée (dos)
	mu.FX, mu.FY = 1, 0
	for i := 0; i < 50; i++ {
		d := c.damageWith(hu, mu, &atk)
		if d < lo || d > hi {
			t.Fatalf("rear damage %d outside estimate [%d,%d]", d, lo, hi)
		}
	}
}

func TestFacingUpdatedByMoveAndAttack(t *testing.T) {
	_, c, hu, mu := c3Combat(t)
	hu.X, hu.Y = 3, 3
	c.enterCell(hu, 4, 3) // pas vers l'est
	if hu.FX != 1 || hu.FY != 0 {
		t.Fatalf("moving east should face east, got (%d,%d)", hu.FX, hu.FY)
	}
	mu.X, mu.Y = 4, 2 // au nord de hu
	atk := c.baseAttackFor(hu)
	c.performAttack(hu, &atk, mu.X, mu.Y)
	if hu.FX != 0 || hu.FY != -1 {
		t.Fatalf("attacking north should face north, got (%d,%d)", hu.FX, hu.FY)
	}
}

func TestCoverReducesRangedDamage(t *testing.T) {
	_, c, hu, mu := c3Combat(t)
	hu.ClassID = "chasseur"
	hu.X, hu.Y = 1, 3
	mu.X, mu.Y = 5, 3
	mu.FX, mu.FY = -1, 0 // fait face au tireur (pas d'attaque de dos)
	sk := heroSkillFor("chasseur")
	// portée 3 : rapproche le tireur
	hu.X = 2
	lo0, _ := c.EstimateDamage(hu, mu, &sk)
	// obstacle collé à la cible CÔTÉ tireur (4,3) — mais PAS sur la ligne de tir ?
	// (4,3) est sur le trajet (2,3)→(5,3) : il couperait la LOS. On teste la
	// couverture avec un obstacle ADJACENT côté tireur mais hors trajectoire :
	// tireur en diagonale.
	hu.X, hu.Y = 3, 1 // manhattan((3,1),(5,3)) = 4 > 3 — trop loin. (4,1) → d=3 ok
	hu.X, hu.Y = 4, 1
	lo0, _ = c.EstimateDamage(hu, mu, &sk)
	c.Cells[3*c.GridW+4].Blocked = true // obstacle en (4,3), adjacent ouest de la cible ? non : (4,3) est à l'OUEST de (5,3)
	// direction obstacle depuis la cible : (-1,0) ; direction tireur : (4-5,1-3)=(-1,-2) → dot = 1 > 0 : côté tireur ✓
	if !c.hasLOS(hu.X, hu.Y, mu.X, mu.Y) {
		t.Fatalf("the cover obstacle must not sit on the firing line for this test")
	}
	if !c.inCover(hu, mu) {
		t.Fatalf("target adjacent to an attacker-side obstacle should be in cover")
	}
	lo1, _ := c.EstimateDamage(hu, mu, &sk)
	if lo1 >= lo0 {
		t.Fatalf("cover should reduce ranged damage: %d -> %d", lo0, lo1)
	}
	// l'attaque de dos IGNORE la couverture
	mu.FX, mu.FY = 0, 1 // regarde le sud — le tireur (au nord) est dans son dos
	loRear, _ := c.EstimateDamage(hu, mu, &sk)
	if loRear <= lo1 {
		t.Fatalf("a rear attack should ignore cover and exceed the covered value: covered=%d rear=%d", lo1, loRear)
	}
	// la mêlée n'est pas réduite par la couverture
	hu2 := hu
	_ = hu2
	base := c.baseAttackFor(hu)
	hu.X, hu.Y = 5, 2 // au contact nord de la cible, qui refait face
	mu.FX, mu.FY = 0, -1
	loM0, _ := c.EstimateDamage(hu, mu, &base)
	_ = loM0 // la couverture ne s'applique qu'à distance>1 — vérifié par dmgMods
	if _, num, den := c.dmgMods(hu, mu, &base); num != den {
		t.Fatalf("melee against a faced attacker should have no multiplier: %d/%d", num, den)
	}
}
