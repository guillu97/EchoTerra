package store

import (
	"path/filepath"
	"testing"
	"time"
)

func TestUserAndSessionRoundTrip(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	u := &User{ID: "u1", Email: "Gui@Example.com", Name: "Guillaume", Provider: "email", PassHash: "x", CreatedAt: time.Now().Unix()}
	if err := st.CreateUser(u); err != nil {
		t.Fatal(err)
	}
	// Emails are case-insensitive (stored lowercased).
	got, err := st.UserByEmail("gui@example.COM")
	if err != nil || got == nil || got.ID != "u1" || got.Email != "gui@example.com" {
		t.Fatalf("UserByEmail round-trip failed: %+v %v", got, err)
	}
	// Duplicate email rejected.
	if err := st.CreateUser(&User{ID: "u2", Email: "gui@example.com", Name: "X", PassHash: "y", CreatedAt: 1}); err == nil {
		t.Fatal("duplicate email must be rejected")
	}

	// Sessions: valid token resolves, expired one doesn't, deleted one doesn't.
	if err := st.CreateSession("tok1", "u1", time.Now().Add(time.Hour).Unix()); err != nil {
		t.Fatal(err)
	}
	if got, _ := st.UserByToken("tok1"); got == nil || got.ID != "u1" {
		t.Fatal("valid session must resolve to its user")
	}
	if err := st.CreateSession("tok2", "u1", time.Now().Add(-time.Hour).Unix()); err != nil {
		t.Fatal(err)
	}
	if got, _ := st.UserByToken("tok2"); got != nil {
		t.Fatal("expired session must not resolve")
	}
	if err := st.DeleteSession("tok1"); err != nil {
		t.Fatal(err)
	}
	if got, _ := st.UserByToken("tok1"); got != nil {
		t.Fatal("deleted session must not resolve")
	}
	if got, _ := st.UserByToken("nope"); got != nil {
		t.Fatal("unknown token must not resolve")
	}
}
