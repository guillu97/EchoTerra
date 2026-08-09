package worldgen

import (
	"testing"

	"echoterra/internal/game"
)

// LE GISEMENT DOIT ÊTRE À PORTÉE DE MARCHE, PAS « QUELQUE PART DANS LE VOISINAGE ».
//
// Le rayon de la garantie suivait la taille de la carte : sur le monde d'une expédition
// de vingt (134²) le « gisement proche » pouvait s'étaler à dix-huit cases du bourg —
// satisfait sur le papier, inatteignable en jeu, puisqu'un héros a six PA par vague et
// doit rentrer. Mesuré alors sur une partie de vingt joueurs : ZÉRO tuile de forêt
// découverte pendant trois vagues, quatre en douze vagues contre cinquante de montagne ;
// bois en Banque nul du début à la fin, donc aucune tour, aucun site, et 143 pierres
// inutiles à la Banque.
//
// La portée d'un héros est FIXE ; c'est le monde qui grandit. Le quota suit la
// population, le rayon jamais.
func TestTheNearbyDepositStaysWithinWalkingDistanceOnEveryMapSize(t *testing.T) {
	for _, players := range []int{1, 4, 12, 20} {
		side := SizeForPlayers(players)
		r, quota := biomeQuota(side)
		if r != nearBiomeR {
			t.Fatalf("%d joueurs (carte %d²) : le rayon du gisement doit rester %d, obtenu %d",
				players, side, nearBiomeR, r)
		}
		if quota < minBiomeTiles {
			t.Fatalf("%d joueurs : quota %d sous le plancher %d", players, quota, minBiomeTiles)
		}
		// Deux gisements ne peuvent pas dévorer tout le voisinage.
		if area := (2*r + 1) * (2*r + 1); 2*quota > area {
			t.Fatalf("%d joueurs : deux gisements de %d tuiles pour %d cases voisines", players, quota, area)
		}
	}
}

// Et le résultat en jeu : quelle que soit la taille de l'expédition, une ville naît avec
// du BOIS et de la PIERRE réellement accessibles. C'est la condition d'exister du reste
// (bâtir, réparer, monter la tour).
func TestEveryTownIsBornWithWoodAndStoneWithinReach(t *testing.T) {
	const reach = nearBiomeR // ce qu'un héros peut atteindre et d'où il peut revenir
	for _, players := range []int{1, 4, 12, 20} {
		side := SizeForPlayers(players)
		for _, seed := range []int64{1, 2, 3} {
			g := NewGame(side, side, seed)
			forest, mountain := 0, 0
			for dy := -reach; dy <= reach; dy++ {
				for dx := -reach; dx <= reach; dx++ {
					tl := g.TileAt(g.Town.X+dx, g.Town.Y+dy)
					if tl == nil {
						continue
					}
					switch tl.Biome {
					case game.BiomeForest:
						forest++
					case game.BiomeMountain, game.BiomeSnow:
						mountain++
					}
				}
			}
			if forest < minBiomeTiles || mountain < minBiomeTiles {
				t.Errorf("%d joueurs, graine %d (carte %d²) : forêt=%d montagne=%d à %d cases de la ville (minimum %d)",
					players, seed, side, forest, mountain, reach, minBiomeTiles)
			}
		}
	}
}
