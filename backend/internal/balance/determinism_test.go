package balance

import (
	"fmt"
	"testing"

	"echoterra/internal/game"
	"echoterra/internal/worldgen"
)

// LE DÉTERMINISME EST UNE PROPRIÉTÉ DU JEU, PAS UN CONFORT DE TEST.
//
// Toute l'architecture d'Echo Terra repose sur « rejouer le temps écoulé » (game/sim.go) :
// le battement, une requête HTTP et le planificateur de dev appellent le MÊME AdvanceTo,
// et deux instances qui rattrapent la même période doivent aboutir au même monde. Une
// partie qui n'est pas reproductible, c'est un monde qui dépend de qui l'a réveillé.
//
// Ces gardes existent parce que le contraire était vrai et invisible : depuis Go 1.24,
// `rand.Seed` est un NO-OP, et deux endroits comptaient dessus — worldgen.newWorld (donc
// deux parties de même graine n'avaient PAS la même carte : le champ Seed mentait) et la
// simulation d'équilibrage (donc elle ne répondait pas deux fois pareil à la même
// question, ce qui a coûté deux faux positifs de non-régression). Rien n'échouait
// bruyamment. Voir game/rng.go.
func TestSameSeedBuildsTheSameWorld(t *testing.T) {
	world := func(seed int64) string {
		game.SeedRNG(seed)
		g := worldgen.NewGame(60, 60, seed)
		h := 0
		for _, tl := range g.Tiles {
			h = h*31 + int(tl.Biome)*7 + tl.Height*3 + tl.Resources
		}
		m := 0
		for _, mo := range g.Monsters {
			m += mo.Count*7 + mo.X*3 + mo.Y // somme : indépendante de l'ordre de la map
		}
		return fmt.Sprintf("tiles=%d monsters=%d town=%d,%d %q", h, m, g.Town.X, g.Town.Y, g.Town.Name)
	}
	for _, seed := range []int64{1, 42, 1234} {
		if a, b := world(seed), world(seed); a != b {
			t.Fatalf("graine %d : deux mondes différents\n  A %s\n  B %s", seed, a, b)
		}
	}
	// …et deux graines différentes donnent bien deux mondes différents : une empreinte
	// qui ne bouge jamais passerait le test ci-dessus sans rien garantir.
	if world(1) == world(2) {
		t.Fatal("deux graines différentes donnent le même monde")
	}
}

// Une partie ENTIÈRE rejouée à l'identique — le vrai contrat, celui dont dépendent
// les gardes d'équilibrage (SurvivalFloor) et le rattrapage en production.
func TestSameSeedReplaysTheSameGame(t *testing.T) {
	for _, seed := range []int64{1, 2, 3} {
		a := Run(Config{Seed: seed, Players: 4, Waves: 14})
		b := Run(Config{Seed: seed, Players: 4, Waves: 14})
		if len(a.Snapshots) != len(b.Snapshots) {
			t.Fatalf("graine %d : %d vagues jouées puis %d", seed, len(a.Snapshots), len(b.Snapshots))
		}
		for i := range a.Snapshots {
			if a.Snapshots[i] != b.Snapshots[i] {
				t.Fatalf("graine %d : divergence à la vague %d\n  A %+v\n  B %+v",
					seed, a.Snapshots[i].Wave, a.Snapshots[i], b.Snapshots[i])
			}
		}
	}
}
