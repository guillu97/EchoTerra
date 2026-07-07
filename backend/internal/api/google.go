package api

// Google Sign-In ("Continuer avec Google") : le navigateur obtient un ID token
// via Google Identity Services, le POSTe ici, et le serveur le vérifie auprès de
// l'endpoint tokeninfo de Google avant d'ouvrir une session Echo Terra. Gratuit —
// il faut seulement un client OAuth GCP (env ECHOTERRA_GOOGLE_CLIENT_ID sur le
// backend ; le front découvre la config via GET /api/auth/config, sans rebuild).
// Sign in with Apple reste hors périmètre : Apple Developer Program payant.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"

	"echoterra/internal/store"
)

// googleClientID returns the OAuth client id this deployment is configured with.
// Empty = Google Sign-In disabled (the frontend then hides the button).
func googleClientID() string {
	return strings.TrimSpace(os.Getenv("ECHOTERRA_GOOGLE_CLIENT_ID"))
}

// googleClaims is the subset of the ID-token payload we rely on. tokeninfo returns
// every claim as a string, including email_verified.
type googleClaims struct {
	Aud           string `json:"aud"`
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified string `json:"email_verified"`
	Name          string `json:"name"`
}

// verifyGoogleIDToken validates an ID token and returns its claims (var → tests
// inject a fake). The tokeninfo endpoint checks signature and expiry for us; the
// caller still checks the audience and that Google verified the email.
var verifyGoogleIDToken = func(idToken string) (*googleClaims, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get("https://oauth2.googleapis.com/tokeninfo?id_token=" + url.QueryEscape(idToken))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("tokeninfo: HTTP %d", resp.StatusCode)
	}
	var c googleClaims
	if err := json.NewDecoder(resp.Body).Decode(&c); err != nil {
		return nil, err
	}
	return &c, nil
}

// authConfig tells the frontend which auth providers are available at runtime.
func (s *Server) authConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"googleClientId": googleClientID()})
}

// loginGoogle exchanges a Google ID token (the GIS "credential") for an Echo Terra
// session, creating the account on first login. An existing email+password account
// with the same address is simply logged in — Google verified the email, so it's
// the same person and the same account.
func (s *Server) loginGoogle(w http.ResponseWriter, r *http.Request) {
	clientID := googleClientID()
	if clientID == "" {
		writeErr(w, http.StatusNotImplemented, "connexion Google non configurée sur ce serveur")
		return
	}
	var body struct {
		Credential string `json:"credential"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Credential) == "" {
		writeErr(w, http.StatusBadRequest, "credential Google manquant")
		return
	}
	claims, err := verifyGoogleIDToken(body.Credential)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "jeton Google invalide")
		return
	}
	if claims.Aud != clientID {
		writeErr(w, http.StatusUnauthorized, "jeton Google émis pour une autre application")
		return
	}
	email := strings.ToLower(strings.TrimSpace(claims.Email))
	if email == "" || claims.EmailVerified != "true" {
		writeErr(w, http.StatusUnauthorized, "email Google non vérifié")
		return
	}
	u, err := s.store.UserByEmail(email)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if u == nil {
		name := strings.TrimSpace(claims.Name)
		if name == "" {
			name = strings.SplitN(email, "@", 2)[0]
		}
		u = &store.User{
			ID:        uuid.NewString(),
			Email:     email,
			Name:      name,
			Provider:  "google",
			CreatedAt: time.Now().Unix(),
		}
		if err := s.store.CreateUser(u); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	s.issueSession(w, u, http.StatusOK)
}
