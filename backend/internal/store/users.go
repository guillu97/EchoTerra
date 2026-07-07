package store

// User accounts and sessions ("savoir qui est qui"). Email+password is the free
// baseline; the provider column leaves room for Google OAuth later (free, needs a
// GCP client id) — Sign in with Apple is NOT free (Apple Developer Program) and is
// intentionally not implemented.

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// User is an account. PassHash never leaves the server (json:"-").
type User struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Provider  string `json:"provider"` // "email" (future: "google")
	CreatedAt int64  `json:"createdAt"`
	PassHash  string `json:"-"`
}

func (s *Store) migrateAuth() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id         TEXT PRIMARY KEY,
		email      TEXT UNIQUE NOT NULL,
		name       TEXT NOT NULL,
		pass_hash  TEXT NOT NULL,
		provider   TEXT NOT NULL DEFAULT 'email',
		created_at BIGINT NOT NULL
	)`); err != nil {
		return fmt.Errorf("migrate users: %w", err)
	}
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS sessions (
		token      TEXT PRIMARY KEY,
		user_id    TEXT NOT NULL,
		created_at BIGINT NOT NULL,
		expires_at BIGINT NOT NULL
	)`); err != nil {
		return fmt.Errorf("migrate sessions: %w", err)
	}
	return nil
}

// CreateUser inserts a new account. Fails if the email is already registered.
func (s *Store) CreateUser(u *User) error {
	u.Email = strings.ToLower(strings.TrimSpace(u.Email))
	_, err := s.db.Exec(
		s.rebind(`INSERT INTO users (id, email, name, pass_hash, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)`),
		u.ID, u.Email, u.Name, u.PassHash, u.Provider, u.CreatedAt)
	return err
}

func (s *Store) scanUser(row *sql.Row) (*User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Email, &u.Name, &u.PassHash, &u.Provider, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// UserByEmail returns the account for an email, or (nil, nil).
func (s *Store) UserByEmail(email string) (*User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	return s.scanUser(s.db.QueryRow(
		s.rebind(`SELECT id, email, name, pass_hash, provider, created_at FROM users WHERE email = ?`), email))
}

// UserByID returns the account by id, or (nil, nil).
func (s *Store) UserByID(id string) (*User, error) {
	return s.scanUser(s.db.QueryRow(
		s.rebind(`SELECT id, email, name, pass_hash, provider, created_at FROM users WHERE id = ?`), id))
}

// CreateSession stores a bearer token for a user.
func (s *Store) CreateSession(token, userID string, expiresAt int64) error {
	_, err := s.db.Exec(
		s.rebind(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`),
		token, userID, time.Now().Unix(), expiresAt)
	return err
}

// UserByToken resolves a session token to its (non-expired) user, or (nil, nil).
func (s *Store) UserByToken(token string) (*User, error) {
	var userID string
	err := s.db.QueryRow(
		s.rebind(`SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?`),
		token, time.Now().Unix()).Scan(&userID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.UserByID(userID)
}

// DeleteSession logs a token out.
func (s *Store) DeleteSession(token string) error {
	_, err := s.db.Exec(s.rebind(`DELETE FROM sessions WHERE token = ?`), token)
	return err
}
