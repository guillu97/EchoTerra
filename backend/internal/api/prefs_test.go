package api

// LES PRÉFÉRENCES DE COMPTE, de bout en bout : la langue choisie sur un appareil doit
// se retrouver sur le suivant, et sur personne d'autre.

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// register crée un compte et rend son jeton de session.
func registerUser(t *testing.T, srv *Server, email string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"email": email, "name": "Gui", "password": "motdepasse"})
	req := httptest.NewRequest("POST", "/api/auth/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
		t.Fatalf("register a répondu %d : %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Token == "" {
		t.Fatalf("pas de jeton de session : %s", rec.Body.String())
	}
	return out.Token
}

func doAuth(t *testing.T, srv *Server, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body != nil {
		raw, _ := json.Marshal(body)
		r = httptest.NewRequest(method, path, bytes.NewReader(raw))
		r.Header.Set("Content-Type", "application/json")
	} else {
		r = httptest.NewRequest(method, path, nil)
	}
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, r)
	return rec
}

// LE COMPORTEMENT DEMANDÉ : « si quelqu'un change la langue, c'est sauvegardé en base
// dans ses préférences utilisateur ». Donc : rien par défaut (le client suit alors son
// navigateur), et ce qu'on écrit revient à la connexion suivante.
func TestLanguagePreferenceSurvivesTheSession(t *testing.T) {
	srv := newTestServer(t)

	tok := registerUser(t, srv, "gui@example.com")

	// 1. Un compte neuf n'a AUCUNE langue : c'est ce qui laisse le navigateur décider.
	//    Un défaut écrit ici écraserait la préférence du navigateur dès l'inscription.
	rec := doAuth(t, srv, "GET", "/api/auth/me", tok, nil)
	var me struct {
		Prefs struct {
			Language string `json:"language"`
		} `json:"prefs"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &me)
	if me.Prefs.Language != "" {
		t.Fatalf("un compte neuf ne doit porter aucune langue, trouvé %q", me.Prefs.Language)
	}

	// 2. On choisit l'anglais.
	if rec := doAuth(t, srv, "PUT", "/api/auth/me/prefs", tok, map[string]string{"language": "en"}); rec.Code != http.StatusOK {
		t.Fatalf("enregistrement refusé : %d %s", rec.Code, rec.Body.String())
	}

	// 3. Il revient — c'est tout l'intérêt d'une préférence de COMPTE : un autre
	//    appareil, un autre localStorage, la même langue.
	rec = doAuth(t, srv, "GET", "/api/auth/me", tok, nil)
	_ = json.Unmarshal(rec.Body.Bytes(), &me)
	if me.Prefs.Language != "en" {
		t.Fatalf("la langue ne survit pas : %q", me.Prefs.Language)
	}

	// 4. Et elle repart AVEC la session, pour s'appliquer dès l'écran suivant la
	//    connexion plutôt qu'un aller-retour plus tard.
	body, _ := json.Marshal(map[string]string{"email": "gui@example.com", "password": "motdepasse"})
	r := httptest.NewRequest("POST", "/api/auth/login", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	login := httptest.NewRecorder()
	srv.Router().ServeHTTP(login, r)
	_ = json.Unmarshal(login.Body.Bytes(), &me)
	if me.Prefs.Language != "en" {
		t.Fatalf("la connexion ne rend pas la langue du compte : %s", login.Body.String())
	}
}

// ⚠ ON N'ENREGISTRE QUE CE QU'ON SAIT SERVIR. Une langue inconnue écrite dans un compte
// le suivrait d'appareil en appareil et rendrait le jeu illisible partout à la fois,
// sans que rien n'indique d'où ça vient.
func TestUnknownLanguageIsRefused(t *testing.T) {
	srv := newTestServer(t)
	tok := registerUser(t, srv, "kl@example.com")

	if rec := doAuth(t, srv, "PUT", "/api/auth/me/prefs", tok, map[string]string{"language": "kl"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("une langue inconnue devrait être refusée, reçu %d", rec.Code)
	}
	// Et vider la préférence reste permis : c'est le retour au « suis mon navigateur ».
	if rec := doAuth(t, srv, "PUT", "/api/auth/me/prefs", tok, map[string]string{"language": ""}); rec.Code != http.StatusOK {
		t.Fatalf("revenir au défaut devrait être permis, reçu %d", rec.Code)
	}
}

// Les préférences appartiennent à leur titulaire : l'identité vient du JETON, jamais du
// corps de la requête, et un anonyme n'écrit nulle part.
func TestPrefsRequireTheOwnersSession(t *testing.T) {
	srv := newTestServer(t)

	if rec := doAuth(t, srv, "PUT", "/api/auth/me/prefs", "", map[string]string{"language": "en"}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("un anonyme ne doit pas pouvoir écrire de préférences, reçu %d", rec.Code)
	}

	a := registerUser(t, srv, "a@example.com")
	b := registerUser(t, srv, "b@example.com")
	doAuth(t, srv, "PUT", "/api/auth/me/prefs", a, map[string]string{"language": "en"})

	rec := doAuth(t, srv, "GET", "/api/auth/me", b, nil)
	var me struct {
		Prefs struct {
			Language string `json:"language"`
		} `json:"prefs"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &me)
	if me.Prefs.Language != "" {
		t.Fatalf("la préférence d'un compte a fuité vers un autre : %q", me.Prefs.Language)
	}
}
