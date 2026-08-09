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
const SurvivalFloor = 10

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
	solo, big := reach(1), reach(20)
	t.Logf("portée moyenne : 1 joueur %.1f vagues · 20 joueurs %.1f vagues", solo, big)
	if big <= solo {
		t.Errorf("une expédition de 20 doit dépasser un solo : %.1f vs %.1f vagues", big, solo)
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
func TestTownActuallyProgresses(t *testing.T) {
	rep := Run(Config{Seed: 1, Players: 4, Waves: 12})
	last := rep.Last()
	if last.BankItems == 0 {
		t.Error("the Bank is empty after twelve waves — nothing is being gathered or deposited")
	}
	if last.MonstersKilled == 0 {
		t.Error("not a single creature killed in twelve waves — the bots never fight")
	}
	first := rep.Snapshots[0]
	if last.LevelSum <= first.LevelSum {
		t.Errorf("the town never built anything: levels %d -> %d", first.LevelSum, last.LevelSum)
	}
	if last.HeroesEvolved == 0 {
		t.Error("no hero ever took a class — the evolution gates are unreachable")
	}
	if last.HeroesAlive == 0 {
		t.Error("the whole expedition is dead")
	}
}
