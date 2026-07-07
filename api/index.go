// Package handler is the single Vercel serverless entrypoint. vercel.json rewrites
// /api/* (and /healthz) here, and Vercel hands the function the ORIGINAL request
// path, so the same chi router as the local dev server matches the routes
// unchanged. All the logic lives in the backend module's serverless package.
package handler

import (
	"net/http"

	"echoterra/serverless"
)

// Handler is the exported symbol Vercel's Go runtime invokes per request.
func Handler(w http.ResponseWriter, r *http.Request) {
	serverless.Handler(w, r)
}
