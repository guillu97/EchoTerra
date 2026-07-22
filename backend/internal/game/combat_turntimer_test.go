package game

import (
	"testing"
	"time"
)

// Minuteur de tour (anti-blocage multijoueur) : un seul joueur présent = pas de
// limite ; à ≥2 présents, un tour laissé en souffrance est résolu par l'IA.

func TestTurnTimerNotArmedSolo(t *testing.T) {
	_, c := multiGame(t) // seul pA est présent (starter)
	if c.sharedHumanCombat() {
		t.Fatalf("un seul participant ne doit pas être un combat partagé: %v", c.Participants)
	}
	if c.TurnDeadline != nil {
		t.Fatalf("aucun minuteur avec un seul joueur présent")
	}
	if c.EnforceTurnTimer(time.Now().Add(time.Hour)) {
		t.Fatalf("sans échéance, rien ne doit se déclencher")
	}
}

func TestTurnTimerAutoResolvesAfkTurn(t *testing.T) {
	gs, c := multiGame(t)
	if _, err := gs.JoinCombat(c.ID, "pB"); err != nil {
		t.Fatalf("join: %v", err)
	}
	if !c.sharedHumanCombat() {
		t.Fatalf("combat partagé attendu après l'arrivée de pB: %v", c.Participants)
	}
	// 2 présents : le tour humain courant doit être minuté (armé à la jonction)
	if c.TurnDeadline == nil {
		t.Fatalf("le minuteur du tour humain courant doit être armé")
	}
	// pas encore expiré → aucun effet
	if c.EnforceTurnTimer(time.Now()) {
		t.Fatalf("le minuteur ne doit pas se déclencher avant l'échéance")
	}
	before, curBefore := c.Seq, c.CurrentUnit().ID
	// on force l'expiration
	past := time.Now().Add(-time.Second)
	c.TurnDeadline = &past
	if !c.EnforceTurnTimer(time.Now()) {
		t.Fatalf("un minuteur expiré doit résoudre le tour automatiquement")
	}
	if c.Seq == before {
		t.Fatalf("Seq doit s'incrémenter pour que les clients rafraîchissent")
	}
	if c.Status == "active" {
		if c.CurrentUnit().ID == curBefore {
			t.Fatalf("le tour AFK aurait dû avancer")
		}
		if c.TurnDeadline == nil {
			t.Fatalf("le minuteur du prochain tour humain doit être réarmé")
		}
	}
}
