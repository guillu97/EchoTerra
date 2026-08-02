package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"echoterra/internal/game"
)

// startedGame crée une partie solo LANCÉE (créateur + 4 bots) via l'API publique.
func startedGame(t *testing.T, s *Server) string {
	t.Helper()
	rec := postJSON(t, s, "/api/games/solo", map[string]any{"playerName": "Guillaume"})
	if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
		t.Fatalf("solo: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		Game game.GameState `json:"game"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Game.Status != game.StatusActive {
		t.Fatalf("la partie solo doit démarrer aussitôt: %s", created.Game.Status)
	}
	return created.Game.ID
}

func tickReq(t *testing.T, s *Server, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/tick", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	s.Router().ServeHTTP(rec, req)
	return rec
}

// Le battement est la porte d'entrée du monde qui tourne tout seul : elle doit être
// fermée à qui n'a pas le jeton, et refuser de s'ouvrir si aucun jeton n'est posé.
func TestTickRequiresToken(t *testing.T) {
	s := newTestServer(t) // stateless (déploiement)

	if rec := tickReq(t, s, ""); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("sans jeton configuré: %d %s (attendu 503)", rec.Code, rec.Body.String())
	}
	s.SetTickToken("s3cret")
	if rec := tickReq(t, s, "mauvais"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("mauvais jeton: %d (attendu 401)", rec.Code)
	}
	if rec := tickReq(t, s, "s3cret"); rec.Code != http.StatusOK {
		t.Fatalf("bon jeton: %d %s", rec.Code, rec.Body.String())
	}
}

// LE test de la demande : sans AUCUNE requête de jeu, le battement seul doit faire
// avancer la partie — vagues résolues ET joueurs-IA qui jouent.
func TestTickAdvancesGamesWithoutPlayerRequests(t *testing.T) {
	s := newTestServer(t)
	s.SetTickToken("s3cret")
	id := startedGame(t, s)

	// On remonte les horloges dans le passé, comme si personne n'avait touché la
	// partie depuis une demi-heure (écriture directe : aucune requête de jeu).
	gs, err := s.store.Load(id)
	if err != nil || gs == nil {
		t.Fatalf("load: %v", err)
	}
	past := time.Now().Add(-30 * time.Minute)
	gs.NextWaveAt = past
	gs.LastBotAt = past
	before := *gs
	if err := s.store.Save(gs); err != nil {
		t.Fatal(err)
	}

	rec := tickReq(t, s, "s3cret")
	if rec.Code != http.StatusOK {
		t.Fatalf("tick: %d %s", rec.Code, rec.Body.String())
	}
	var res tickResult
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.Advanced == 0 || len(res.Games) == 0 {
		t.Fatalf("le battement n'a fait avancer aucune partie: %+v", res)
	}
	if res.Games[0].Waves == 0 {
		t.Fatalf("aucune vague résolue: %+v", res.Games[0])
	}
	if res.Games[0].BotRounds == 0 {
		t.Fatalf("aucun round de joueurs-IA joué: %+v", res.Games[0])
	}

	after, err := s.store.Load(id)
	if err != nil || after == nil {
		t.Fatalf("reload: %v", err)
	}
	if after.WaveNumber <= before.WaveNumber {
		t.Fatalf("les vagues ne sont pas persistées: %d -> %d", before.WaveNumber, after.WaveNumber)
	}
	if !after.NextWaveAt.After(time.Now()) {
		t.Fatalf("la prochaine vague doit être replanifiée dans le futur: %v", after.NextWaveAt)
	}
	// Convergent : un second balayage ne rejoue rien. (On appelle sweep directement :
	// par l'URL, l'anti-martèlement répondrait sans rien examiner et le test passerait
	// pour la mauvaise raison.)
	if again := s.sweep(time.Now()); again.Advanced != 0 {
		t.Fatalf("second balayage: %+v (doit être un no-op)", again)
	}
}

// Deux battements rapprochés ne doivent pas relire la base pour rien.
func TestTickDampsRepeatedCalls(t *testing.T) {
	s := newTestServer(t)
	s.SetTickToken("s3cret")
	startedGame(t, s)

	if rec := tickReq(t, s, "s3cret"); rec.Code != http.StatusOK {
		t.Fatalf("premier battement: %d", rec.Code)
	}
	rec := tickReq(t, s, "s3cret")
	var res tickResult
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.Swept != 0 {
		t.Fatalf("battement rapproché: %d parties examinées (attendu 0)", res.Swept)
	}
}

// Le battement tourne en fond, éventuellement sur une autre instance qu'un joueur en
// train d'agir : il ne doit JAMAIS écraser l'écriture de ce joueur.
func TestTickNeverClobbersAConcurrentPlayerWrite(t *testing.T) {
	s := newTestServer(t)
	s.SetTickToken("s3cret")
	id := startedGame(t, s)

	stale, err := s.store.Load(id) // ce que le battement aurait chargé
	if err != nil || stale == nil {
		t.Fatalf("load: %v", err)
	}
	stale.NextWaveAt = time.Now().Add(-time.Hour)

	// Pendant ce temps, le joueur agit depuis une autre instance.
	fresh, _ := s.store.Load(id)
	fresh.Name = "action du joueur"
	if err := s.store.Save(fresh); err != nil {
		t.Fatal(err)
	}

	if res := s.advanceOne(stale); res == nil || !res.Conflict {
		t.Fatalf("le battement aurait dû détecter le conflit: %+v", res)
	}
	after, _ := s.store.Load(id)
	if after.Name != "action du joueur" {
		t.Fatalf("l'écriture du joueur a été écrasée par le battement: %q", after.Name)
	}
}

// Le battement remplace le janitor : il garantit un salon public et un seul.
func TestTickKeepsExactlyOnePublicLobby(t *testing.T) {
	s := newTestServer(t)
	s.SetTickToken("s3cret")

	if rec := tickReq(t, s, "s3cret"); rec.Code != http.StatusOK {
		t.Fatalf("tick: %d", rec.Code)
	}
	countPublic := func() int {
		games, err := s.store.List(50)
		if err != nil {
			t.Fatal(err)
		}
		n := 0
		for _, gs := range games {
			if gs.Status == game.StatusLobby && gs.IsPublic() {
				n++
			}
		}
		return n
	}
	if n := countPublic(); n != 1 {
		t.Fatalf("salons publics après le premier battement: %d (attendu 1)", n)
	}
	// Deux instances froides peuvent créer chacune leur salon public : le doublon VIDE
	// doit être purgé au passage suivant, sans toucher à celui qui a des joueurs.
	s.newPublicLobby()
	if n := countPublic(); n != 2 {
		t.Fatalf("le doublon n'a pas été créé pour le test: %d", n)
	}
	s.housekeeping()
	if n := countPublic(); n != 1 {
		t.Fatalf("salons publics après entretien: %d (attendu 1)", n)
	}
}
