package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"echoterra/internal/game"
)

// In multiplayer, town work is paid with MY OWN heroes' PA only: the request must
// name a heroId (the legacy shared pool would drain every in-town hero, including
// other players' teams) and that hero must belong to the calling player.
func TestTownActionRequiresOwnHeroInMultiplayer(t *testing.T) {
	s := newTestServer(t)

	rec := postJSON(t, s, "/api/games/lobby", map[string]any{"playerName": "Alice", "minPlayers": 2})
	if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
		t.Fatalf("create lobby: %d %s", rec.Code, rec.Body.String())
	}
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
	if rec.Code != http.StatusOK {
		t.Fatalf("join: %d %s", rec.Code, rec.Body.String())
	}
	var joined struct {
		Player game.Player `json:"player"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &joined); err != nil {
		t.Fatal(err)
	}
	bob := joined.Player

	rec = postJSON(t, s, "/api/games/"+id+"/start", map[string]any{"playerId": alice.ID})
	if rec.Code != http.StatusOK {
		t.Fatalf("start: %d %s", rec.Code, rec.Body.String())
	}

	action := func(heroID string) map[string]any {
		body := map[string]any{"buildingId": "gate", "action": "toggle", "playerId": alice.ID}
		if heroID != "" {
			body["heroId"] = heroID
		}
		return body
	}

	// No heroId -> rejected: the shared town pool must never pay in multiplayer.
	rec = postJSON(t, s, "/api/games/"+id+"/town/action", action(""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 without heroId, got %d %s", rec.Code, rec.Body.String())
	}

	// Another player's hero -> rejected (Alice can't spend Bob's PA on a build site).
	rec = postJSON(t, s, "/api/games/"+id+"/town/action", action(bob.HeroIDs[0]))
	if rec.Code == http.StatusOK {
		t.Fatalf("expected rejection with another player's hero, got 200 %s", rec.Body.String())
	}

	// My own in-town hero -> allowed.
	rec = postJSON(t, s, "/api/games/"+id+"/town/action", action(alice.HeroIDs[0]))
	if rec.Code != http.StatusOK {
		t.Fatalf("own hero should be allowed: %d %s", rec.Code, rec.Body.String())
	}
}
