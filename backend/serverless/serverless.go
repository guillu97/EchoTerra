// Package serverless exposes the Echo Terra API as a single http.HandlerFunc for
// serverless platforms (the repo-root api/index.go Vercel function delegates here —
// it lives in another module, so it cannot reach the internal packages itself).
//
// Configuration comes from the environment: the database DSN from ECHOTERRA_DB,
// DATABASE_URL or POSTGRES_URL (a postgres:// URL — e.g. Neon — or a SQLite path;
// defaults to an EPHEMERAL /tmp SQLite file so a database-less preview still boots),
// and the wave interval from ECHOTERRA_WAVE_SECONDS.
package serverless

import (
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"echoterra/internal/api"
	"echoterra/internal/game"
	"echoterra/internal/store"
)

var (
	once    sync.Once
	router  http.Handler
	initErr error
)

func setup() {
	if v := os.Getenv("ECHOTERRA_WAVE_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			game.WaveInterval = time.Duration(n) * time.Second
		}
	}
	dsn := os.Getenv("ECHOTERRA_DB")
	for _, k := range []string{"DATABASE_URL", "POSTGRES_URL"} {
		if dsn == "" {
			dsn = os.Getenv(k)
		}
	}
	if dsn == "" {
		dsn = "/tmp/echoterra.db"
	}
	st, err := store.Open(dsn)
	if err != nil {
		initErr = err
		return
	}
	router = api.NewServerless(st).Router()
}

// Handler lazily initializes the stateless API server (once per function instance)
// and serves the request through the same chi router as the local dev server.
func Handler(w http.ResponseWriter, r *http.Request) {
	once.Do(setup)
	if initErr != nil {
		http.Error(w, "init: "+initErr.Error(), http.StatusInternalServerError)
		return
	}
	router.ServeHTTP(w, r)
}
