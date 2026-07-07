package serverless

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestHandlerServesAPI exercises the whole serverless path end-to-end (stateless
// server, SQLite store, lazy housekeeping): healthz, lobby listing (which must
// auto-create the public lobby), solo game creation and a hero action.
func TestHandlerServesAPI(t *testing.T) {
	os.Setenv("ECHOTERRA_DB", filepath.Join(t.TempDir(), "serverless.db"))
	defer os.Unsetenv("ECHOTERRA_DB")

	do := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		var rd *strings.Reader
		if body == "" {
			rd = strings.NewReader("")
		} else {
			rd = strings.NewReader(body)
		}
		req := httptest.NewRequest(method, path, rd)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		rr := httptest.NewRecorder()
		Handler(rr, req)
		return rr
	}

	if rr := do("GET", "/healthz", ""); rr.Code != 200 {
		t.Fatalf("healthz: %d %s", rr.Code, rr.Body.String())
	}

	// The lobby list runs lazy housekeeping: a public lobby must always be offered.
	rr := do("GET", "/api/games?status=lobby", "")
	if rr.Code != 200 {
		t.Fatalf("list: %d %s", rr.Code, rr.Body.String())
	}
	var lobbies []map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &lobbies); err != nil {
		t.Fatal(err)
	}
	foundPublic := false
	for _, l := range lobbies {
		if l["visibility"] == "public" {
			foundPublic = true
		}
	}
	if !foundPublic {
		t.Fatalf("no public lobby after housekeeping: %s", rr.Body.String())
	}

	// Solo game: created active with 4 bots, then playable through the same router.
	rr = do("POST", "/api/games/solo", `{"playerName":"Testeur"}`)
	if rr.Code != 201 {
		t.Fatalf("solo: %d %s", rr.Code, rr.Body.String())
	}
	var solo struct {
		Game struct {
			ID     string `json:"id"`
			Status string `json:"status"`
			Heroes []struct {
				ID string `json:"id"`
			} `json:"heroes"`
		} `json:"game"`
		Player struct {
			ID      string   `json:"id"`
			HeroIDs []string `json:"heroIds"`
		} `json:"player"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &solo); err != nil {
		t.Fatal(err)
	}
	if solo.Game.Status != "active" || len(solo.Game.Heroes) != 15 {
		t.Fatalf("solo game not launched as expected: status=%s heroes=%d", solo.Game.Status, len(solo.Game.Heroes))
	}

	// GET the game (runs tick + bot catch-up baseline) then act with an owned hero.
	if rr := do("GET", "/api/games/"+solo.Game.ID, ""); rr.Code != 200 {
		t.Fatalf("get game: %d %s", rr.Code, rr.Body.String())
	}
	hero := solo.Player.HeroIDs[0]
	rr = do("POST", "/api/games/"+solo.Game.ID+"/heroes/"+hero+"/search",
		`{"playerId":"`+solo.Player.ID+`"}`)
	if rr.Code != 200 {
		t.Fatalf("search: %d %s", rr.Code, rr.Body.String())
	}
}
