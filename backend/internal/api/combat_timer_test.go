package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"echoterra/internal/game"
)

// Anti-blocage HTTP : quand le poll de combat (GET) arrive après l'échéance du
// tour d'un joueur AFK, le handler résout ce tour automatiquement.
func TestGetCombatEnforcesTurnTimer(t *testing.T) {
	s := newTestServer(t)

	rec := postJSON(t, s, "/api/games/lobby", map[string]any{"playerName": "Alice", "minPlayers": 2})
	var created struct {
		Game   game.GameState `json:"game"`
		Player game.Player    `json:"player"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	id := created.Game.ID
	alice := created.Player
	rec = postJSON(t, s, "/api/games/"+id+"/join", map[string]any{"playerName": "Bob"})
	var joined struct {
		Player game.Player `json:"player"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &joined); err != nil {
		t.Fatal(err)
	}
	bob := joined.Player
	if rec = postJSON(t, s, "/api/games/"+id+"/start", map[string]any{"playerId": alice.ID}); rec.Code != http.StatusOK {
		t.Fatalf("start: %d %s", rec.Code, rec.Body.String())
	}

	// Monte un combat PARTAGÉ (2 présents) avec une échéance déjà dépassée, en
	// manipulant l'état chargé du store (le pathing d'un héros vers un monstre
	// n'est pas nécessaire pour tester l'enforcement HTTP).
	gs, err := s.store.Load(id)
	if err != nil {
		t.Fatal(err)
	}
	tx, ty := gs.Town.X, gs.Town.Y
	for _, h := range gs.Heroes {
		h.X, h.Y = tx, ty // tous les héros (Alice + Bob) sur la case du combat
	}
	m := &game.Monster{ID: "mtest", Species: "Slime Vorace", X: tx, Y: ty, HP: 300, MaxHP: 300,
		Stats: game.Stats{Force: 1, Agilite: 1, Endurance: 12}, Count: 3}
	gs.Monsters[m.ID] = m
	gs.TileAt(tx, ty).MonsterID = m.ID
	c, err := gs.StartCombat(alice.HeroIDs[0], alice.ID)
	if err != nil {
		t.Fatalf("startCombat: %v", err)
	}
	if _, err := gs.JoinCombat(c.ID, bob.ID); err != nil {
		t.Fatalf("joinCombat: %v", err)
	}
	if c.TurnDeadline == nil {
		t.Fatalf("le minuteur devait être armé (combat partagé, tour humain)")
	}
	past := time.Now().Add(-time.Second)
	c.TurnDeadline = &past
	seqBefore := c.Seq
	if err := s.store.Save(gs); err != nil {
		t.Fatal(err)
	}

	// GET du combat → le handler doit résoudre le tour AFK (Seq bump).
	req := httptest.NewRequest(http.MethodGet, "/api/games/"+id+"/combat/"+c.ID, nil)
	rr := httptest.NewRecorder()
	s.Router().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("getCombat: %d %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Combat game.Combat `json:"combat"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Combat.Seq == seqBefore {
		t.Fatalf("le tour AFK aurait dû être résolu à l'accès HTTP (Seq inchangé = %d)", seqBefore)
	}
}
