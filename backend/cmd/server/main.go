// Command server boots the Echo Terra prototype REST API. It serves local dev
// (:8080, SQLite) and Vercel Services (PORT injected, Postgres via DATABASE_URL)
// with the same binary.
package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"echoterra/internal/api"
	"echoterra/internal/game"
	"echoterra/internal/store"
)

func main() {
	addr := os.Getenv("ECHOTERRA_ADDR")
	if addr == "" {
		if p := os.Getenv("PORT"); p != "" { // Vercel Services tell us where to listen
			addr = ":" + p
		} else {
			addr = ":8080"
		}
	}

	// DSN: explicit override first, then the URL a hosted Postgres integration
	// injects (Neon via the Vercel Marketplace), then the local SQLite file.
	dsn := os.Getenv("ECHOTERRA_DB")
	for _, k := range []string{"DATABASE_URL", "POSTGRES_URL"} {
		if dsn == "" {
			dsn = os.Getenv(k)
		}
	}
	if dsn == "" {
		dsn = "echoterra.db"
	}

	// Real-time delay between horde waves (default 10 min; lower it for testing).
	if v := os.Getenv("ECHOTERRA_WAVE_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			game.WaveInterval = time.Duration(n) * time.Second
		}
	}

	st, err := store.Open(dsn)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()

	var srv *api.Server
	if os.Getenv("VERCEL") != "" {
		// Scale-to-zero platform: background goroutines die with the instance and
		// several instances may coexist, so run stateless — no scheduler, no
		// cross-request cache, waves/bots/housekeeping catch up lazily.
		srv = api.NewServerless(st)
	} else {
		srv = api.New(st)
	}
	log.Printf("Echo Terra API en écoute sur %s (db=%s, vercel=%v)", addr, dsn, os.Getenv("VERCEL") != "")
	if err := http.ListenAndServe(addr, srv.Router()); err != nil {
		log.Fatalf("server: %v", err)
	}
}
