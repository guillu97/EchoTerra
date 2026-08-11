package balance

import (
	"testing"
)

// SurvivalFloor is the contract this repository holds itself to: a town left entirely
// to the bot AI, on any seed, must still be standing after this many waves.
//
// It is not an aspiration, it is a regression guard. The whole reason this package
// exists is that the game used to fail it catastrophically and silently — every seed
// died at wave 5, and nothing in the test suite noticed, because no test had ever
// played a game. A change that drops a town below this line has broken the game for
// every player, and should fail CI rather than ship.
// Relevé de 10 à 12 le 2026-08-09 : sur vingt graines, la pire configuration (un
// joueur seul, la plus dure — voir la ladder ci-dessous) tombe au plus tôt à la
// quatorzième vague, et la médiane de toutes les tailles est de 15 à 22. Un plancher
// qu'on dépasse de moitié ne garde plus rien ; celui-ci laisse deux vagues de marge à
// la variance des graines et échouerait pour de bon si une régression revenait.
const SurvivalFloor = 12

// TestTownSurvivesTheFirstWaves plays a full game per seed and fails if the town falls
// before the floor. Kept to a handful of seeds and a short horizon so it stays a test
// and not an afternoon; use `go run ./cmd/balance` for the wider sweeps.
func TestTownSurvivesTheFirstWaves(t *testing.T) {
	for _, seed := range []int64{1, 2, 3, 4} {
		rep := Run(Config{Seed: seed, Players: 4, Waves: SurvivalFloor})
		if len(rep.Snapshots) < SurvivalFloor {
			t.Errorf("seed %d: only %d waves simulated, expected %d", seed, len(rep.Snapshots), SurvivalFloor)
			continue
		}
		if rep.GameOver {
			t.Errorf("seed %d: %s", seed, rep.Verdict())
			t.Logf("%s", rep.Table())
		}
	}
}

// TestEveryThemeHoldsTheFloor : le plancher vaut pour CHAQUE thème, pas seulement pour
// la carte tempérée.
//
// C'est le garde-fou qui rend les expéditions thématiques livrables (RETENTION-PLAN.md
// §8). Un thème déplace les biomes autour de la ville — donc les gisements, donc les
// espèces qui apparaissent, donc l'économie entière de la partie. Un thème dont on n'a
// pas mesuré la survie est une partie perdue d'avance pour ceux qui le tirent, et comme
// le thème se TIRE (personne ne le choisit), ce serait une punition au hasard.
//
// On balaie les deux extrémités de l'échelle (solo et grande expédition) : c'est là que
// les défauts d'économie se voient, le milieu étant toujours le cas le plus confortable.
func TestEveryThemeHoldsTheFloor(t *testing.T) {
	if testing.Short() {
		t.Skip("simulation complète — ignorée en -short")
	}
	for _, theme := range []string{"tempere", "nordique", "desertique"} {
		for _, players := range []int{1, 8} {
			for _, seed := range []int64{5, 6} {
				rep := Run(Config{Seed: seed, Players: players, Waves: SurvivalFloor, Theme: theme})
				if rep.Theme != theme {
					t.Fatalf("thème %s demandé, %s obtenu — worldgen.WithTheme ne prend pas", theme, rep.Theme)
				}
				// ⚠ SANS CETTE LIGNE LE TEST PASSE À VIDE : run() rend un rapport
				// vierge quand la partie n'a pas pu démarrer (GameOver faux, zéro
				// instantané), et « la ville n'est pas tombée » serait vrai d'une
				// partie qui n'a jamais eu lieu.
				if len(rep.Snapshots) < SurvivalFloor {
					t.Errorf("thème %s, %d joueur(s), seed %d : %d vagues simulées sur %d",
						theme, players, seed, len(rep.Snapshots), SurvivalFloor)
					continue
				}
				if rep.GameOver {
					t.Errorf("thème %s, %d joueur(s), seed %d : %s", theme, players, seed, rep.Verdict())
					t.Logf("%s", rep.Table())
				}
			}
		}
	}
}

// TestBigExpeditionsGoFurther: vingt joueurs doivent aller PLUS LOIN qu'un seul.
//
// Ça n'a rien d'automatique — c'est même l'inverse qui était vrai. Le plafond de
// défense d'une ville (muraille + portail + tour) ne dépend pas de l'effectif, donc
// tant que la puissance de la horde était une formule du numéro de vague, des joueurs
// en plus n'apportaient que des monstres en plus. Il a fallu trois choses pour
// renverser ça : la horde tire sa puissance des créatures RÉELLEMENT massées aux
// abords (donc tuer compte), la carte suit l'expédition (worldgen.SizeForPlayers), et
// les gisements garantis suivent la carte (biomeQuota) — sinon vingt équipes se
// partagent la carrière d'un solo.
func TestBigExpeditionsGoFurther(t *testing.T) {
	reach := func(players int) float64 {
		total, n := 0, 0
		for _, seed := range []int64{11, 12, 13} {
			rep := Run(Config{Seed: seed, Players: players, Waves: 30})
			last := rep.Last()
			total += last.Wave
			n++
		}
		return float64(total) / float64(n)
	}
	// UNE ÉCHELLE, PAS DEUX POINTS. « 20 > 1 » se satisfaisait d'une courbe qui plongeait
	// au milieu, et c'était le cas : mesuré, 15 · 14 · 14 · 16 · 17 · 19 vagues pour
	// 1 · 2 · 4 · 8 · 12 · 20 joueurs — deux et quatre joueurs allaient MOINS loin qu'un
	// solo, parce qu'ils héritaient d'une horde plus dure sans aucun moyen de bâtir plus
	// haut. On garde donc l'ordre sur toute la plage.
	solo, mid, big := reach(1), reach(4), reach(20)
	t.Logf("portée moyenne : 1 joueur %.1f · 4 joueurs %.1f · 20 joueurs %.1f vagues", solo, mid, big)
	if mid <= solo {
		t.Errorf("quatre joueurs doivent dépasser un solo : %.1f vs %.1f vagues", mid, solo)
	}
	if big <= mid {
		t.Errorf("une expédition de 20 doit dépasser quatre joueurs : %.1f vs %.1f vagues", big, mid)
	}
}

// Un salon PUBLIC est créé pour vingt joueurs — donc sur une grande carte — mais démarre
// dès son minimum atteint. Une expédition sous-remplie ne doit pas devenir la partie la
// plus facile du jeu.
//
// Elle l'était, et de loin : deux joueurs sur la carte d'un salon à vingt tenaient
// TRENTE vagues quand deux joueurs sur leur propre carte tombaient à la seizième. Rien
// à voir avec les monstres semés — les packs naissaient jusqu'à soixante-dix cases de
// la ville et migrent d'une case par vague, donc la horde n'arrivait jamais. D'où le
// front à rayon fixe (hordeFrontRadius) et une menace qui suit l'expédition et non la
// surface. Ce test garde les deux.
func TestUnderfilledPublicLobbyIsNotEasyMode(t *testing.T) {
	const publicSide = 134 // la carte d'un salon prévu pour 20 (worldgen.SizeForPlayers)
	reach := func(players, side int) float64 {
		total := 0
		seeds := []int64{21, 22, 23}
		for _, seed := range seeds {
			total += Run(Config{Seed: seed, Players: players, Width: side, Height: side, Waves: 30}).Last().Wave
		}
		return float64(total) / float64(len(seeds))
	}
	sized := reach(2, 0)                // deux joueurs sur leur propre carte
	underfilled := reach(2, publicSide) // les deux mêmes dans un salon prévu pour vingt
	t.Logf("2 joueurs : carte à leur taille %.1f vagues · carte de salon public %.1f vagues", sized, underfilled)
	// Une grande carte reste un peu plus clémente (plus de place, plus de ressources) ;
	// ce qui est interdit, c'est qu'elle double la durée de vie.
	if underfilled > sized*1.5 {
		t.Errorf("une expédition sous-remplie ne doit pas être le mode facile : %.1f vs %.1f vagues",
			underfilled, sized)
	}
}

// TestEveryExpeditionSizeIsPlayable holds the floor across the whole lobby range.
// Difficulty must not depend on how many people showed up: the horde is weighted by
// expedition size (game.hordeScale) precisely because the town's defense ceiling —
// wall plus gate plus tower — is the same for three heroes as for eighteen. A first
// attempt at that weighting was too steep and inverted the curve, so that a full table
// died BEFORE a solo player. That is exactly the kind of regression this test exists
// to catch, and it is invisible to every other test in the repository.
func TestEveryExpeditionSizeIsPlayable(t *testing.T) {
	for _, players := range []int{1, 2, 4, 8, 12, 20} {
		for _, seed := range []int64{5, 6, 7} {
			rep := Run(Config{Seed: seed, Players: players, Waves: SurvivalFloor})
			if rep.GameOver {
				t.Errorf("%d joueur(s), seed %d: %s", players, seed, rep.Verdict())
				t.Logf("%s", rep.Table())
			}
		}
	}
}

// TestTownActuallyProgresses is the other half of "playable": a town can survive by
// doing nothing if the horde is weak enough, and that is not a game. The bots must be
// seen to gather, bank materials and raise the town's defense above what it started
// with — if any of these flatlines, the balance is broken even though nobody died.
//
// Le verdict porte sur PLUSIEURS graines, et pas par confort : la simulation garde un
// non-déterminisme résiduel (l'ordre d'itération des maps de Go alimente le flux
// aléatoire, cf. journal 2026-08-09), donc une partie isolée peut tomber sur un tirage
// où rien n'est bâti. Une garde qui échoue au hasard est une garde qu'on finit par
// ignorer. La question honnête n'est pas « cette graine-ci bâtit-elle ? » mais « une
// ville laissée aux bots progresse-t-elle, en général ? ».
func TestTownActuallyProgresses(t *testing.T) {
	seeds := []int64{1, 2, 3, 4}
	built, gathered, fought, evolved, alive := 0, 0, 0, 0, 0
	for _, seed := range seeds {
		rep := Run(Config{Seed: seed, Players: 4, Waves: 12})
		if len(rep.Snapshots) == 0 {
			t.Fatalf("seed %d: aucune vague simulée", seed)
		}
		first, last := rep.Snapshots[0], rep.Last()
		if last.LevelSum > first.LevelSum {
			built++
		}
		if last.BankItems > 0 {
			gathered++
		}
		if last.MonstersKilled > 0 {
			fought++
		}
		if last.HeroesEvolved > 0 {
			evolved++
		}
		if last.HeroesAlive > 0 {
			alive++
		}
	}
	n := len(seeds)
	// Récolter, évoluer et survivre doivent tenir sur TOUTES les graines : ce sont les
	// boucles de base, elles ne dépendent pas d'un coup de chance.
	if gathered != n {
		t.Errorf("la Banque est restée vide sur %d graine(s) — rien n'est récolté ni déposé", n-gathered)
	}
	if evolved != n {
		t.Errorf("aucun héros n'a pris de classe sur %d graine(s) — les paliers sont inatteignables", n-evolved)
	}
	if alive != n {
		t.Errorf("l'expédition entière est morte sur %d graine(s)", n-alive)
	}
	// Bâtir et combattre dépendent de ce que la carte offre : on exige la MAJORITÉ.
	if built*2 <= n {
		t.Errorf("la ville n'a rien bâti sur %d graines sur %d", n-built, n)
	}
	if fought*2 <= n {
		t.Errorf("les bots n'ont pas combattu sur %d graines sur %d", n-fought, n)
	}
}
