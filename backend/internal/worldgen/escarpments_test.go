package worldgen

// LES INVARIANTS DES MESAS.
//
// Trois choses doivent rester vraies quelle que soit la graine, et chacune a coûté
// une itération à découvrir (voir l'en-tête d'escarpments.go) :
//
//  1. la marche maximale reste 2 — sinon un grimpeur lui-même serait bloqué, et une
//     région du monde deviendrait inatteignable pour tout le monde ;
//  2. une part réelle de la carte demande de grimper — sans quoi la statistique
//     n'ouvre rien, ce qui était le cas des TROIS premières approches essayées ;
//  3. le BOIS et la PIERRE restent atteignables sans grimper — c'est la famine déjà
//     mesurée deux fois dans ce projet, on ne la réintroduit pas pour du relief.

import (
	"testing"

	"echoterra/internal/game"
)

func climbReach(gs *game.GameState, climb int) []int { return distancesFrom(gs, climb) }

func TestMesaStepNeverExceedsTwo(t *testing.T) {
	for _, side := range []int{40, 60, 100} {
		for seed := int64(1); seed <= 6; seed++ {
			gs := NewGame(side, side, seed)
			for y := 0; y < gs.Height; y++ {
				for x := 0; x < gs.Width; x++ {
					a := gs.TileAt(x, y)
					if !a.Biome.Walkable() {
						continue
					}
					for _, d := range [][2]int{{1, 0}, {0, 1}} {
						b := gs.TileAt(x+d[0], y+d[1])
						if b == nil || !b.Biome.Walkable() {
							continue
						}
						if absW(a.Height-b.Height) > 2 {
							t.Fatalf("side %d seed %d : marche de %d en (%d,%d) — un grimpeur ne passerait pas",
								side, seed, absW(a.Height-b.Height), x, y)
						}
					}
				}
			}
		}
	}
}

// Un grimpeur atteint (quasiment) tout : une mesa est une POCHE, jamais un mur.
// Le seuil n'est pas 100 % parce que le générateur produit déjà, sans escarpements,
// de rares îlots cernés d'eau — ce qui n'a rien à voir avec le relief.
func TestAClimberReachesEverything(t *testing.T) {
	for seed := int64(1); seed <= 6; seed++ {
		gs := NewGame(60, 60, seed)
		d := climbReach(gs, 2)
		tot, out := 0, 0
		for i, tl := range gs.Tiles {
			if !tl.Biome.Walkable() {
				continue
			}
			tot++
			if d[i] < 0 {
				out++
			}
		}
		if pct := 100 * float64(out) / float64(tot); pct > 1 {
			t.Fatalf("seed %d : %.1f %% de la carte hors d'atteinte MÊME en grimpant", seed, pct)
		}
	}
}

// La fonctionnalité doit se JOUER : une part mesurable de la carte doit demander de
// l'athlétisme. C'est ce test qui aurait attrapé les trois approches abandonnées —
// toutes rendaient 0,0 %.
func TestSomeGroundNeedsAClimber(t *testing.T) {
	tot, gated := 0, 0
	for seed := int64(1); seed <= 8; seed++ {
		gs := NewGame(60, 60, seed)
		d1 := climbReach(gs, 1)
		for i, tl := range gs.Tiles {
			if !tl.Biome.Walkable() {
				continue
			}
			tot++
			if d1[i] < 0 {
				gated++
			}
		}
	}
	pct := 100 * float64(gated) / float64(tot)
	if pct < 2 {
		t.Fatalf("seulement %.2f %% de la carte demande de grimper : la falaise ne se joue pas", pct)
	}
	if pct > 20 {
		t.Fatalf("%.2f %% de la carte hors d'atteinte sans athlétisme : c'est une amputation, pas un relief", pct)
	}
	t.Logf("part de carte gardée par le relief : %.2f %%", pct)
}

// Bois et pierre restent accessibles à une expédition NEUVE, quelle que soit la
// graine. C'est le filet `openStarterPasses`.
func TestStarterEconomyStaysReachable(t *testing.T) {
	for _, side := range []int{40, 60, 100} {
		for seed := int64(1); seed <= 8; seed++ {
			gs := NewGame(side, side, seed)
			d1 := climbReach(gs, 1)
			// ⚠ LA PIERRE SE LIT SUR DEUX BIOMES (montagne OU neige), comme dans
			// `ensureNearbyBiomes` : une carte nordique peut ne contenir aucune tuile
			// de biome montagne et n'en être pas moins pourvue — le sol gelé donne de
			// la pierre depuis que sa table a été réglée. Mesuré sur 40²/graine 2 :
			// zéro montagne, et la carte est parfaitement jouable.
			for _, grp := range [][]game.Biome{
				{game.BiomeForest},
				{game.BiomeMountain, game.BiomeSnow},
			} {
				ok := false
				for _, b := range grp {
					if reachesBiome(gs, d1, b) {
						ok = true
						break
					}
				}
				if !ok {
					t.Fatalf("side %d seed %d : %v hors d'atteinte d'un héros neuf — la ville ne peut rien bâtir",
						side, seed, grp)
				}
			}
		}
	}
}

// Une mesa ne touche AUCUN biome : c'est ce qui rend la passe sûre pour l'économie.
func TestMesasDoNotChangeBiomes(t *testing.T) {
	for seed := int64(1); seed <= 5; seed++ {
		a := NewGame(60, 60, seed)
		b := NewGame(60, 60, seed)
		for i := range a.Tiles {
			if a.Tiles[i].Biome != b.Tiles[i].Biome {
				t.Fatalf("seed %d : la génération n'est pas déterministe (tuile %d)", seed, i)
			}
		}
	}
}

// LE BOUT EN BOUT : sur une carte RÉELLEMENT générée, un héros ordinaire est arrêté
// par une falaise, et le même héros chaussé la gravit.
//
// ⚠ Ce test vaut les cinq autres réunis : les invariants de la passe pouvaient tous
// être vrais pendant que `MoveHero` ignorait le relief (c'était l'état du jeu avant ce
// lot) — seule une vraie tentative de déplacement le prouve.
func TestOnARealMapACliffStopsAHeroAndBootsOpenIt(t *testing.T) {
	found := 0
	for seed := int64(1); seed <= 8 && found < 3; seed++ {
		gs := NewGame(60, 60, seed)
		w := gs.Width
		// une falaise quelque part : deux voisines praticables à 2 niveaux d'écart
		var fx, fy, tx, ty int
		ok := false
		for i, tl := range gs.Tiles {
			if !tl.Biome.Walkable() {
				continue
			}
			x, y := i%w, i/w
			for _, d := range orthDirs {
				n := gs.TileAt(x+d[0], y+d[1])
				if n != nil && n.Biome.Walkable() && n.Height-tl.Height == 2 {
					fx, fy, tx, ty, ok = x, y, x+d[0], y+d[1], true
					break
				}
			}
			if ok {
				break
			}
		}
		if !ok {
			continue
		}
		found++
		// Les deux cases sont DÉCOUVERTES : le relief ne doit jamais arrêter une
		// exploration au contact (le client ne pourrait pas le prévoir).
		gs.TileAt(fx, fy).Discovered = true
		gs.TileAt(tx, ty).Discovered = true
		h := game.NewStarterHero(0, "Ava", fx, fy)
		h.PA, h.MaxPA = 6, 6
		gs.Heroes = []*game.Hero{h}
		gs.Recompute()

		if err := gs.MoveHero(h.ID, tx-fx, ty-fy); err == nil {
			t.Fatalf("seed %d : la falaise (%d,%d)->(%d,%d) devrait arrêter un héros neuf (athlétisme %d, franchit %d)",
				seed, fx, fy, tx, ty, h.Stats.Athletisme, h.Climb)
		}
		if h.PA != 6 {
			t.Fatalf("seed %d : un refus de relief ne doit rien coûter (PA %d)", seed, h.PA)
		}
		h.AddLoot(game.Item{Type: "arme", Name: "Bottes cloutées", Qty: 1})
		if _, err := gs.Equip(h.ID, "Bottes cloutées"); err != nil {
			t.Fatalf("équiper les bottes : %v", err)
		}
		gs.Recompute()
		if err := gs.MoveHero(h.ID, tx-fx, ty-fy); err != nil {
			t.Fatalf("seed %d : chaussé (franchit %d), le héros doit gravir la falaise : %v", seed, h.Climb, err)
		}
	}
	if found == 0 {
		t.Fatal("aucune falaise trouvée sur huit cartes : la passe ne produit pas de relief")
	}
	t.Logf("falaises éprouvées sur %d cartes", found)
}
