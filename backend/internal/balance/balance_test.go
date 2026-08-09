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

// TestEveryExpeditionSizeIsPlayable holds the floor across the whole lobby range.
// Difficulty must not depend on how many people showed up: the horde is weighted by
// expedition size (game.hordeScale) precisely because the town's defense ceiling —
// wall plus gate plus tower — is the same for three heroes as for eighteen. A first
// attempt at that weighting was too steep and inverted the curve, so that a full table
// died BEFORE a solo player. That is exactly the kind of regression this test exists
// to catch, and it is invisible to every other test in the repository.
func TestEveryExpeditionSizeIsPlayable(t *testing.T) {
	for _, players := range []int{1, 2, 3, 4, 5, 6} {
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
