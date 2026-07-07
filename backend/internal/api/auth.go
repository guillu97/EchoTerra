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
	writeJSON(w, code, map[string]any{"user": toPublic(u), "token": tok})
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
	writeJSON(w, http.StatusOK, map[string]any{"user": toPublic(u)})
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
