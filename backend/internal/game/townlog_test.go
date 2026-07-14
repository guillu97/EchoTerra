package game

import (
	"strings"
	"testing"
)

// Every in-town action lands in the town journal (Panel building), newest first.
func TestTownJournalRecordsTownActions(t *testing.T) {
	g, h := newGateTestGame()
	g.Day = 1 // fresh heroes have DrewWaterDay 0 — day 0 would read as "already drank"
	h.Inventory = []Item{{Type: "objet", Name: "Bois", Qty: 3}}

	if err := g.TownAction("gate", "toggle", 1, "h1"); err != nil {
		t.Fatalf("toggle: %v", err)
	}
	if err := g.TownAction("well", "water", 1, "h1"); err != nil {
		t.Fatalf("water: %v", err)
	}
	if _, err := g.DepositHeroLoot([]string{"h1"}); err != nil {
		t.Fatalf("deposit: %v", err)
	}

	log := g.Town.Log
	if len(log) != 3 {
		t.Fatalf("expected 3 journal entries, got %d: %+v", len(log), log)
	}
	// Newest first: deposit, water, gate.
	for i, want := range []string{"déposé 4 objet", "puisé une ration", "porte de la ville"} {
		if !strings.Contains(log[i].Text, want) {
			t.Fatalf("entry %d = %q, want it to contain %q", i, log[i].Text, want)
		}
		if log[i].Day != g.Day || log[i].At.IsZero() {
			t.Fatalf("entry %d missing day/timestamp: %+v", i, log[i])
		}
	}
}

// The journal is capped so the persisted state blob stays bounded.
func TestTownJournalIsCapped(t *testing.T) {
	g, _ := newGateTestGame()
	for i := 0; i < townLogCap+25; i++ {
		g.logTown("entrée de test")
	}
	if len(g.Town.Log) != townLogCap {
		t.Fatalf("journal must be capped at %d, got %d", townLogCap, len(g.Town.Log))
	}
}
