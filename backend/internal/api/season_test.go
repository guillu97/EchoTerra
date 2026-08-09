package api

import (
	"net/http"
	"testing"
	"time"

	"echoterra/internal/game"
)

// LE CLASSEMENT MONTRE LA SAISON EN COURS PAR DÉFAUT — c'est tout l'intérêt : un tableau
// cumulatif se fige, et ne donne plus rien à viser à qui arrive.
func TestLeaderboardDefaultsToTheCurrentSeason(t *testing.T) {
	s := newTestServer(t)

	old := &game.GameState{ID: "old", Status: game.StatusGameOver, WaveNumber: 40}
	old.Town.Name = "Légende"
	old.CreatedAt = time.Date(2024, 1, 5, 12, 0, 0, 0, time.UTC)
	old.StartedAt = old.CreatedAt
	now := &game.GameState{ID: "now", Status: game.StatusActive, WaveNumber: 3}
	now.Town.Name = "Neuville"
	now.CreatedAt, now.StartedAt = time.Now(), time.Now()
	for _, g := range []*game.GameState{old, now} {
		if err := s.store.Save(g); err != nil {
			t.Fatal(err)
		}
	}

	var rows []struct {
		TownName string `json:"townName"`
		Season   string `json:"season"`
	}
	load := func(path string) {
		t.Helper()
		rows = nil
		if rec := getJSON(t, s, path, &rows); rec.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", path, rec.Code, rec.Body.String())
		}
	}

	load("/api/leaderboard")
	if len(rows) != 1 || rows[0].TownName != "Neuville" {
		t.Fatalf("par défaut, la saison EN COURS : %+v", rows)
	}
	// …et la légende de 2024 reste consultable, en « tous les temps » comme dans la sienne.
	load("/api/leaderboard?season=all")
	if len(rows) != 2 {
		t.Fatalf("tous les temps doit tout rendre : %+v", rows)
	}
	load("/api/leaderboard?season=2024-01")
	if len(rows) != 1 || rows[0].TownName != "Légende" {
		t.Fatalf("une saison passée reste consultable : %+v", rows)
	}
	// Une saison jamais jouée est vide, pas une erreur : il n'y a rien de faux à demander.
	load("/api/leaderboard?season=1999-01")
	if len(rows) != 0 {
		t.Fatalf("saison vide attendue : %+v", rows)
	}
}

// Le sélecteur propose les saisons JOUÉES, plus celle en cours même vierge — c'est celle
// qu'on dispute, elle doit être proposée avant d'avoir sa première ville.
func TestSeasonsRouteAlwaysOffersTheCurrentOne(t *testing.T) {
	s := newTestServer(t)
	var body struct {
		Current string `json:"current"`
		Seasons []struct {
			ID      string `json:"id"`
			Label   string `json:"label"`
			Current bool   `json:"current"`
		} `json:"seasons"`
	}
	if rec := getJSON(t, s, "/api/seasons", &body); rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	if body.Current != game.CurrentSeason() {
		t.Fatalf("saison en cours : %q", body.Current)
	}
	if len(body.Seasons) != 1 || !body.Seasons[0].Current || body.Seasons[0].Label == "" {
		t.Fatalf("la saison en cours doit être proposée même vierge : %+v", body.Seasons)
	}

	// Une ville d'une saison passée s'y ajoute, sans doublonner celle en cours.
	g := &game.GameState{ID: "g", Status: game.StatusGameOver, WaveNumber: 9}
	g.Town.Name = "Passée"
	g.CreatedAt = time.Date(2025, 5, 5, 12, 0, 0, 0, time.UTC)
	g.StartedAt = g.CreatedAt
	if err := s.store.Save(g); err != nil {
		t.Fatal(err)
	}
	body.Seasons = nil
	getJSON(t, s, "/api/seasons", &body)
	if len(body.Seasons) != 2 || body.Seasons[1].ID != "2025-05" {
		t.Fatalf("saisons proposées : %+v", body.Seasons)
	}
}
