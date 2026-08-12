package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"echoterra/internal/store"
)

// LE CHIFFRE (metrics.go) — le calcul de cohortes est la seule chose ici qui puisse
// mentir en silence : un tableau bien formé se lit comme une vérité même quand la
// division est fausse. D'où des cas montés à la main, dont on connaît la réponse.

func day(d string) string { return d }

func TestRetentionCountsWhoCameBack(t *testing.T) {
	// ana revient le lendemain, bo revient au 5e jour (donc pas à J1/J3, mais à J7),
	// cléo ne revient jamais. Tous trois découverts le même jour.
	rows := []store.ActivityRow{
		{UserID: "ana", GameID: "g1", Day: day("2026-08-01"), Actions: 3},
		{UserID: "bo", GameID: "g1", Day: day("2026-08-01"), Actions: 1},
		{UserID: "cleo", GameID: "g1", Day: day("2026-08-01"), Actions: 9},
		{UserID: "ana", GameID: "g1", Day: day("2026-08-02"), Actions: 2},
		{UserID: "bo", GameID: "g2", Day: day("2026-08-06"), Actions: 4},
	}
	// « aujourd'hui » loin devant : toutes les cohortes sont mûres.
	m := computeMetrics(rows, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))

	if m.Users != 3 || m.Games != 2 {
		t.Errorf("comptes %d, parties %d — attendu 3 et 2", m.Users, m.Games)
	}
	if len(m.Cohorts) != 1 {
		t.Fatalf("une seule cohorte attendue, %d obtenues", len(m.Cohorts))
	}
	c := m.Cohorts[0]
	if c.Size != 3 {
		t.Errorf("cohorte de %d, attendu 3", c.Size)
	}
	// J1 : ana seule. J3 : ana toujours seule (bo revient le 6). J7 : ana + bo.
	if c.Returned["d1"] != 1 || c.Returned["d3"] != 1 || c.Returned["d7"] != 2 {
		t.Errorf("revenus J1/J3/J7 = %d/%d/%d, attendu 1/1/2",
			c.Returned["d1"], c.Returned["d3"], c.Returned["d7"])
	}
	if m.Retained["d7"] != 66 { // 2 sur 3
		t.Errorf("rétention J7 = %d %%, attendu 66", m.Retained["d7"])
	}
}

// ⚠ LE ZÉRO D'UNE CHOSE QUI N'A PAS ENCORE EU LIEU. Une cohorte d'hier ne peut pas avoir
// de J7 ; la compter tirerait la moyenne vers le bas et donnerait un chiffre faux dans
// le sens le plus décourageant qui soit.
func TestAYoungCohortIsNotCountedAsLost(t *testing.T) {
	today := time.Date(2026, 8, 12, 10, 0, 0, 0, time.UTC)
	rows := []store.ActivityRow{
		// cohorte mûre : revenue.
		{UserID: "vieux", GameID: "g1", Day: "2026-08-01", Actions: 1},
		{UserID: "vieux", GameID: "g1", Day: "2026-08-05", Actions: 1},
		// cohorte d'hier : elle n'a pas eu ses sept jours.
		{UserID: "neuf", GameID: "g1", Day: "2026-08-11", Actions: 1},
	}
	m := computeMetrics(rows, today)
	var young cohortMetric
	for _, c := range m.Cohorts {
		if c.Day == "2026-08-11" {
			young = c
		}
	}
	if young.Mature["d7"] {
		t.Error("une cohorte d'hier ne peut pas être mûre à J7")
	}
	if young.Mature["d1"] != true {
		t.Error("elle est en revanche mûre à J1 : le lendemain a eu lieu")
	}
	if m.Retained["d7"] != 100 {
		t.Errorf("la rétention J7 ne doit porter que sur la cohorte mûre (100 %%), obtenu %d", m.Retained["d7"])
	}
}

func TestMetricsOnAnEmptyBase(t *testing.T) {
	m := computeMetrics(nil, time.Now())
	if m.Users != 0 || len(m.Days) != 0 || len(m.Cohorts) != 0 {
		t.Errorf("une base vide doit rendre des listes vides, pas nil : %+v", m)
	}
	// ⚠ des listes VIDES et non nil : le client (ou un tableur) lit `.length`.
	if m.Days == nil || m.Cohorts == nil || m.Retained == nil {
		t.Error("les collections doivent être initialisées (nil se sérialise en null)")
	}
}

// Le compte de la journée additionne les actions, pas les lignes : un joueur qui touche
// trois parties le même jour reste UN actif.
func TestOneActivePlayerCountsOnce(t *testing.T) {
	rows := []store.ActivityRow{
		{UserID: "ana", GameID: "g1", Day: "2026-08-01", Actions: 4},
		{UserID: "ana", GameID: "g2", Day: "2026-08-01", Actions: 6},
	}
	m := computeMetrics(rows, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
	if len(m.Days) != 1 || m.Days[0].Actives != 1 || m.Days[0].Actions != 10 {
		t.Errorf("attendu 1 actif et 10 actions, obtenu %+v", m.Days)
	}
}

// ⚠ LA BOUCLE TOURNE-T-ELLE VRAIMENT ? Un calcul juste sur des lignes fabriquées ne dit
// rien de l'enregistrement. Ce test-ci part d'un compte, joue une action par la vraie
// route, et va regarder la base — c'est la seule preuve que la mesure existe.
func TestPlayingRecordsActivityForAnAccount(t *testing.T) {
	s := newTestServer(t)

	var reg struct {
		Token string `json:"token"`
		User  struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	rec := postJSON(t, s, "/api/auth/register", map[string]string{
		"email": "ana@example.com", "name": "Ana", "password": "motdepasse",
	})
	if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
		t.Fatalf("inscription : %d %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &reg); err != nil {
		t.Fatal(err)
	}

	// Une partie solo, créée AVEC le jeton : c'est le porteur qui identifie le compte.
	var solo struct {
		Game struct {
			ID string `json:"id"`
		} `json:"game"`
	}
	req := httptest.NewRequest(http.MethodPost, "/api/games/solo",
		bytes.NewReader([]byte(`{"playerName":"Ana"}`)))
	req.Header.Set("Authorization", "Bearer "+reg.Token)
	rec = httptest.NewRecorder()
	s.Router().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
		t.Fatalf("partie solo : %d %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &solo); err != nil {
		t.Fatal(err)
	}

	// …puis UNE action de jeu sur cette partie (forcer une vague : POST, sous /{gameID}).
	req = httptest.NewRequest(http.MethodPost, "/api/games/"+solo.Game.ID+"/advance",
		bytes.NewReader([]byte(`{"safe":true}`)))
	req.Header.Set("Authorization", "Bearer "+reg.Token)
	rec = httptest.NewRecorder()
	s.Router().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("action de jeu : %d %s", rec.Code, rec.Body.String())
	}

	rows, err := s.store.Activity("2000-01-01")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("une ligne d'activité attendue, %d obtenues : %+v", len(rows), rows)
	}
	if rows[0].UserID != reg.User.ID || rows[0].GameID != solo.Game.ID {
		t.Errorf("ligne %+v — attendue pour le compte %s sur la partie %s", rows[0], reg.User.ID, solo.Game.ID)
	}

	// ⚠ un GET n'est PAS de l'activité : le client sonde tout seul toutes les 20 s, et
	// les compter ferait passer une page laissée ouverte pour un joueur qui joue.
	req = httptest.NewRequest(http.MethodGet, "/api/games/"+solo.Game.ID, nil)
	req.Header.Set("Authorization", "Bearer "+reg.Token)
	rec = httptest.NewRecorder()
	s.Router().ServeHTTP(rec, req)
	rows, _ = s.store.Activity("2000-01-01")
	if len(rows) != 1 || rows[0].Actions != 1 {
		t.Errorf("un rafraîchissement ne doit rien ajouter : %+v", rows)
	}
}

// ⚠ LA PORTE. Des agrégats d'audience ne sont pas un contenu de jeu : sans jeton
// configuré, l'endpoint se tait en déploiement (même règle que le battement).
func TestMetricsAreClosedWithoutAToken(t *testing.T) {
	s := newTestServer(t) // serverless : le mode « déploiement »
	rec := httptest.NewRecorder()
	s.Router().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/metrics", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("sans jeton : %d, attendu 503", rec.Code)
	}

	s.SetTickToken("secret")
	rec = httptest.NewRecorder()
	s.Router().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/metrics?token=faux", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("mauvais jeton : %d, attendu 401", rec.Code)
	}

	rec = httptest.NewRecorder()
	s.Router().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/metrics?token=secret", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("bon jeton : %d %s", rec.Code, rec.Body.String())
	}
}
