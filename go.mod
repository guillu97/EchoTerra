// Root module for the Vercel deployment ONLY: Vercel's Go runtime requires a
// go.mod at the repo root to build api/index.go. It wraps the real backend module
// (backend/go.mod) via a local replace. Local dev keeps using `go -C backend ...`.
module echoterra-vercel

go 1.26

require echoterra v0.0.0

require (
	github.com/aquilax/go-perlin v1.1.0 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/go-chi/chi/v5 v5.1.0 // indirect
	github.com/go-chi/cors v1.2.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/hashicorp/golang-lru/v2 v2.0.7 // indirect
	github.com/lib/pq v1.12.3 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/ncruces/go-strftime v0.1.9 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	golang.org/x/sys v0.22.0 // indirect
	modernc.org/gc/v3 v3.0.0-20240107210532-573471604cb6 // indirect
	modernc.org/libc v1.55.3 // indirect
	modernc.org/mathutil v1.6.0 // indirect
	modernc.org/memory v1.8.0 // indirect
	modernc.org/sqlite v1.34.4 // indirect
	modernc.org/strutil v1.2.0 // indirect
	modernc.org/token v1.1.0 // indirect
)

replace echoterra => ./backend
