package api

// User accounts: register / login with email+password (free), bearer-token
// sessions, and "my games" for multi-device reconnection. Google Sign-In lives in
// google.go (free, enabled by ECHOTERRA_GOOGLE_CLIENT_ID); Sign in with Apple is
// NOT free (Apple Developer Program) and is deliberately out of scope.

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"echoterra/internal/game"
	"echoterra/internal/store"
)

const sessionTTL = 30 * 24 * time.Hour

// publicUser is the client-facing account DTO (no hash).
type publicUser struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Provider string `json:"provider"`
}

func toPublic(u *store.User) publicUser {
	return publicUser{ID: u.ID, Email: u.Email, Name: u.Name, Provider: u.Provider}
}

func newToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// bearerToken extracts the session token from "Authorization: Bearer <token>".
func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	return ""
}

// userFromReq resolves the calling account, or nil (anonymous is always allowed —
// accounts enrich the experience, they don't gate the prototype).
func (s *Server) userFromReq(r *http.Request) *store.User {
	tok := bearerToken(r)
	if tok == "" {
		return nil
	}
	u, err := s.store.UserByToken(tok)
	if err != nil {
		return nil
	}
	return u
}

func (s *Server) authRoutes(r chi.Router) {
	r.Get("/config", s.authConfig)
	r.Post("/register", s.register)
	r.Post("/login", s.login)
	r.Post("/google", s.loginGoogle)
	r.Post("/logout", s.logout)
	r.Get("/me", s.me)
	r.Get("/me/games", s.myGames)
	r.Get("/me/chronicle", s.myChronicle)
	r.Put("/me/prefs", s.savePrefs)
}

// prefsOf rend les préférences d'un compte, en avalant l'erreur de lecture.
//
// ⚠ VOLONTAIRE : une base qui bafouille sur une préférence ne doit pas empêcher
// quelqu'un de se connecter. Le client retombe alors sur la langue de son navigateur,
// ce qui est exactement son comportement par défaut — l'échec est donc invisible et
// sans conséquence, là où un 500 rendrait le jeu inaccessible.
func (s *Server) prefsOf(u *store.User) store.Prefs {
	p, err := s.store.PrefsFor(u.ID)
	if err != nil {
		return store.Prefs{}
	}
	return p
}

// savePrefs enregistre les préférences du TITULAIRE, et de personne d'autre : l'id du
// compte vient du jeton de session, jamais du corps de la requête.
func (s *Server) savePrefs(w http.ResponseWriter, r *http.Request) {
	u := s.userFromReq(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "connexion requise")
		return
	}
	var body store.Prefs
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	// On ne stocke qu'une langue qu'on sait servir : une valeur inconnue écrite ici
	// suivrait le compte d'appareil en appareil et rendrait le jeu illisible partout à
	// la fois, sans que rien n'indique d'où ça vient.
	if body.Language != "" && !game.IsLang(body.Language) {
		writeErr(w, http.StatusBadRequest, "langue inconnue")
		return
	}
	if err := s.store.SavePrefs(u.ID, body); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"prefs": body})
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	if !strings.Contains(email, "@") || len(email) < 5 {
		writeErr(w, http.StatusBadRequest, "adresse email invalide")
		return
	}
	if len(body.Password) < 6 {
		writeErr(w, http.StatusBadRequest, "mot de passe trop court (6 caractères minimum)")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = strings.SplitN(email, "@", 2)[0]
	}
	if existing, err := s.store.UserByEmail(email); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	} else if existing != nil {
		writeErr(w, http.StatusConflict, "un compte existe déjà avec cet email")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	u := &store.User{
		ID:        uuid.NewString(),
		Email:     email,
		Name:      name,
		Provider:  "email",
		PassHash:  string(hash),
		CreatedAt: time.Now().Unix(),
	}
	if err := s.store.CreateUser(u); err != nil {
		writeErr(w, http.StatusConflict, "impossible de créer le compte (email déjà pris ?)")
		return
	}
	s.issueSession(w, u, http.StatusCreated)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	u, err := s.store.UserByEmail(body.Email)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if u != nil && u.PassHash == "" {
		// Google-only account: no password to compare against.
		writeErr(w, http.StatusUnauthorized, "ce compte utilise « Continuer avec Google »")
		return
	}
	if u == nil || bcrypt.CompareHashAndPassword([]byte(u.PassHash), []byte(body.Password)) != nil {
		writeErr(w, http.StatusUnauthorized, "email ou mot de passe incorrect")
		return
	}
	s.issueSession(w, u, http.StatusOK)
}

func (s *Server) issueSession(w http.ResponseWriter, u *store.User, code int) {
	tok := newToken()
	if err := s.store.CreateSession(tok, u.ID, time.Now().Add(sessionTTL).Unix()); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Les préférences partent AVEC la session : la langue du joueur doit s'appliquer
	// dès l'écran qui suit sa connexion, pas au prochain aller-retour.
	writeJSON(w, code, map[string]any{"user": toPublic(u), "token": tok, "prefs": s.prefsOf(u)})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if tok := bearerToken(r); tok != "" {
		_ = s.store.DeleteSession(tok)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	u := s.userFromReq(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "non connecté")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": toPublic(u), "prefs": s.prefsOf(u)})
}

// myGames lists the games where a player is linked to my account, with my player id
// per game — enough for any device to resume without localStorage.
func (s *Server) myGames(w http.ResponseWriter, r *http.Request) {
	u := s.userFromReq(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "non connecté")
		return
	}
	games, err := s.store.List(200)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	type mine struct {
		gameSummary
		MyPlayerID string `json:"myPlayerId"`
	}
	out := []mine{}
	for _, gs := range games {
		if p := gs.PlayerByUserID(u.ID); p != nil {
			out = append(out, mine{summarize(gs), p.ID})
		}
	}
	writeJSON(w, http.StatusOK, out)
}
