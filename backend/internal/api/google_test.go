package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"echoterra/internal/store"

	"golang.org/x/crypto/bcrypt"
)

const testClientID = "test-client.apps.googleusercontent.com"

func newTestServer(t *testing.T) *Server {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "api.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return NewServerless(st)
}

func postJSON(t *testing.T, s *Server, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b))
	rec := httptest.NewRecorder()
	s.Router().ServeHTTP(rec, req)
	return rec
}

// fakeVerifier swaps the Google tokeninfo call for a canned claims map keyed by
// the credential string. Restored automatically at the end of the test.
func fakeVerifier(t *testing.T, tokens map[string]*googleClaims) {
	t.Helper()
	orig := verifyGoogleIDToken
	verifyGoogleIDToken = func(idToken string) (*googleClaims, error) {
		if c, ok := tokens[idToken]; ok {
			return c, nil
		}
		return nil, errors.New("invalid token")
	}
	t.Cleanup(func() { verifyGoogleIDToken = orig })
}

func TestGoogleLoginDisabledWithoutClientID(t *testing.T) {
	t.Setenv("ECHOTERRA_GOOGLE_CLIENT_ID", "")
	s := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/config", nil)
	rec := httptest.NewRecorder()
	s.Router().ServeHTTP(rec, req)
	var cfg struct {
		GoogleClientID string `json:"googleClientId"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&cfg); err != nil || cfg.GoogleClientID != "" {
		t.Fatalf("config must expose an empty googleClientId when unset: %+v %v", cfg, err)
	}

	if rec := postJSON(t, s, "/api/auth/google", map[string]string{"credential": "x"}); rec.Code != http.StatusNotImplemented {
		t.Fatalf("google login must be 501 when unconfigured, got %d", rec.Code)
	}
}

func TestGoogleLoginCreatesAccountAndSession(t *testing.T) {
	t.Setenv("ECHOTERRA_GOOGLE_CLIENT_ID", testClientID)
	s := newTestServer(t)
	fakeVerifier(t, map[string]*googleClaims{
		"good": {Aud: testClientID, Sub: "g-123", Email: "Neko@Example.com", EmailVerified: "true", Name: "Neko"},
	})

	rec := postJSON(t, s, "/api/auth/google", map[string]string{"credential": "good"})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var res struct {
		User  struct{ ID, Email, Name, Provider string }
		Token string
	}
	if err := json.NewDecoder(rec.Body).Decode(&res); err != nil {
		t.Fatal(err)
	}
	if res.User.Email != "neko@example.com" || res.User.Provider != "google" || res.User.Name != "Neko" || res.Token == "" {
		t.Fatalf("unexpected login payload: %+v", res)
	}

	// The session token works on /me.
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+res.Token)
	mrec := httptest.NewRecorder()
	s.Router().ServeHTTP(mrec, req)
	if mrec.Code != http.StatusOK {
		t.Fatalf("/me with google session must be 200, got %d", mrec.Code)
	}

	// Second login: same account, no duplicate.
	rec2 := postJSON(t, s, "/api/auth/google", map[string]string{"credential": "good"})
	var res2 struct {
		User struct{ ID string }
	}
	_ = json.NewDecoder(rec2.Body).Decode(&res2)
	if rec2.Code != http.StatusOK || res2.User.ID != res.User.ID {
		t.Fatalf("re-login must return the same account: %d %s vs %s", rec2.Code, res2.User.ID, res.User.ID)
	}

	// Password login on a Google-only account is refused with a helpful message.
	if rec := postJSON(t, s, "/api/auth/login", map[string]string{"email": "neko@example.com", "password": "whatever"}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("password login on a google account must be 401, got %d", rec.Code)
	}
}

func TestGoogleLoginMatchesExistingEmailAccount(t *testing.T) {
	t.Setenv("ECHOTERRA_GOOGLE_CLIENT_ID", testClientID)
	s := newTestServer(t)
	hash, _ := bcrypt.GenerateFromPassword([]byte("secret1"), bcrypt.MinCost)
	u := &store.User{ID: "u-mail", Email: "gui@example.com", Name: "Guillaume",
		Provider: "email", PassHash: string(hash), CreatedAt: time.Now().Unix()}
	if err := s.store.CreateUser(u); err != nil {
		t.Fatal(err)
	}
	fakeVerifier(t, map[string]*googleClaims{
		"good": {Aud: testClientID, Sub: "g-9", Email: "gui@example.com", EmailVerified: "true", Name: "G. from Google"},
	})

	rec := postJSON(t, s, "/api/auth/google", map[string]string{"credential": "good"})
	var res struct {
		User struct{ ID, Provider, Name string }
	}
	_ = json.NewDecoder(rec.Body).Decode(&res)
	if rec.Code != http.StatusOK || res.User.ID != "u-mail" || res.User.Provider != "email" || res.User.Name != "Guillaume" {
		t.Fatalf("google login on an existing email account must reuse it untouched: %d %+v", rec.Code, res)
	}

	// The password still works too.
	if rec := postJSON(t, s, "/api/auth/login", map[string]string{"email": "gui@example.com", "password": "secret1"}); rec.Code != http.StatusOK {
		t.Fatalf("password login must keep working, got %d", rec.Code)
	}
}

func TestGoogleLoginRejectsBadTokens(t *testing.T) {
	t.Setenv("ECHOTERRA_GOOGLE_CLIENT_ID", testClientID)
	s := newTestServer(t)
	fakeVerifier(t, map[string]*googleClaims{
		"wrong-aud":  {Aud: "someone-else", Sub: "g-1", Email: "a@b.co", EmailVerified: "true"},
		"unverified": {Aud: testClientID, Sub: "g-2", Email: "a@b.co", EmailVerified: "false"},
		"no-email":   {Aud: testClientID, Sub: "g-3", EmailVerified: "true"},
	})

	for _, cred := range []string{"wrong-aud", "unverified", "no-email", "garbage"} {
		if rec := postJSON(t, s, "/api/auth/google", map[string]string{"credential": cred}); rec.Code != http.StatusUnauthorized {
			t.Errorf("credential %q must be 401, got %d", cred, rec.Code)
		}
	}
	if rec := postJSON(t, s, "/api/auth/google", map[string]string{}); rec.Code != http.StatusBadRequest {
		t.Errorf("missing credential must be 400, got %d", rec.Code)
	}
}
