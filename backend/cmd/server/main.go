// Command server boots the Echo Terra prototype REST API.
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
	addr := envOr("ECHOTERRA_ADDR", ":8080")
	dbPath := envOr("ECHOTERRA_DB", "echoterra.db")

	// Real-time delay between horde waves (default 10 min; lower it for testing).
	if v := os.Getenv("ECHOTERRA_WAVE_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			game.WaveInterval = time.Duration(n) * time.Second
		}
	}

	st, err := store.Open(dbPath)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()

	srv := api.New(st)
	log.Printf("Echo Terra API en écoute sur %s (db=%s)", addr, dbPath)
	if err := http.ListenAndServe(addr, srv.Router()); err != nil {
		log.Fatalf("server: %v", err)
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
