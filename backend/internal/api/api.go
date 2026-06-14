// Package api exposes the REST surface for the Echo Terra prototype. All actions are
// validated and applied server-side; responses carry the authoritative state so the
// client only renders what the server returns.
package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"echoterra/internal/game"
	"echoterra/internal/store"
	"echoterra/internal/worldgen"
)

// Server wires the store and an in-memory cache of live games.
type Server struct {
	store *store.Store
	mu    sync.Mutex
	cache map[string]*game.GameState
}

// New creates a Server backed by the given store and starts the wave scheduler.
func New(st *store.Store) *Server {
	s := &Server{store: st, cache: map[string]*game.GameState{}}
	go s.waveScheduler()
	return s
}

// tick resolves any due wave for a freshly loaded game and refreshes derived fields.
func (s *Server) tick(gs *game.GameState) {
	if gs == nil {
		return
	}
	changed := gs.CatchUpWaves(time.Now())
	gs.Recompute()
	if changed {
		_ = s.store.Save(gs)
	}
}

// waveScheduler periodically advances waves for all live (cached) games so the town is
// attacked on schedule even while a client is idle. NB: prototype-grade concurrency —
// add per-game locking before real multiplayer load.
func (s *Server) waveScheduler() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		now := time.Now()
		s.mu.Lock()
		games := make([]*game.GameState, 0, len(s.cache))
		for _, g := range s.cache {
			games = append(games, g)
		}
		s.mu.Unlock()
		for _, g := range games {
			if g.CatchUpWaves(now) {
				g.Recompute()
				_ = s.store.Save(g)
			}
		}
	}
}

// Router builds the chi router with CORS for the Vite dev server.
func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type"},
	}))

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "time": time.Now().UTC()})
	})

	r.Get("/api/recipes", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, game.Recipes)
	})

	r.Get("/api/classes", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, game.Classes)
	})

	r.Route("/api/games", func(r chi.Router) {
		r.Post("/", s.createGame)
		r.Route("/{gameID}", func(r chi.Router) {
			r.Get("/", s.getGame)
			r.Get("/world", s.getWorld)
			r.Post("/advance", s.advance)
			r.Post("/town/action", s.townAction)
			r.Post("/town/deposit", s.townDeposit)
			r.Post("/town/craft", s.townCraft)
			r.Post("/heroes/{heroID}/move", s.moveHero)
			r.Post("/heroes/{heroID}/search", s.searchTile)
			r.Post("/heroes/{heroID}/hide", s.hideHero)
			r.Post("/heroes/{heroID}/escape", s.escapeHero)
			r.Post("/heroes/{heroID}/fireball", s.fireballHero)
			r.Post("/heroes/{heroID}/evolve", s.evolveHero)
			r.Post("/heroes/{heroID}/combat/start", s.startCombat)
			r.Get("/combat/{combatID}", s.getCombat)
			r.Post("/combat/{combatID}/action", s.combatAction)
		})
	})
	return r
}

// --- helpers ---------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// load fetches a game from cache or the store.
func (s *Server) load(id string) (*game.GameState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if gs, ok := s.cache[id]; ok {
		return gs, nil
	}
	gs, err := s.store.Load(id)
	if err != nil {
		return nil, err
	}
	if gs != nil {
		s.cache[id] = gs
	}
	return gs, nil
}

func (s *Server) persist(gs *game.GameState) {
	gs.Recompute() // keep derived state (town defense, Tétanisé) fresh on every write
	s.mu.Lock()
	s.cache[gs.ID] = gs
	s.mu.Unlock()
	_ = s.store.Save(gs)
}

// --- handlers --------------------------------------------------------------

func (s *Server) createGame(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Width  int   `json:"width"`
		Height int   `json:"height"`
		Seed   int64 `json:"seed"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Width == 0 {
		body.Width = 24
	}
	if body.Height == 0 {
		body.Height = 24
	}
	if body.Seed == 0 {
		body.Seed = time.Now().UnixNano()
	}
	gs := worldgen.NewGame(body.Width, body.Height, body.Seed)
	s.persist(gs)
	writeJSON(w, http.StatusCreated, gs)
}

func (s *Server) getGame(w http.ResponseWriter, r *http.Request) {
	gs, err := s.load(chi.URLParam(r, "gameID"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if gs == nil {
		writeErr(w, http.StatusNotFound, "partie introuvable")
		return
	}
	s.tick(gs)
	writeJSON(w, http.StatusOK, gs)
}

func (s *Server) getWorld(w http.ResponseWriter, r *http.Request) {
	gs, err := s.load(chi.URLParam(r, "gameID"))
	if err != nil || gs == nil {
		writeErr(w, http.StatusNotFound, "partie introuvable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"width":  gs.Width,
		"height": gs.Height,
		"tiles":  gs.Tiles,
		"town":   gs.Town,
	})
}

func (s *Server) moveHero(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	var body struct{ DX, DY int }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	if err := gs.MoveHero(chi.URLParam(r, "heroID"), body.DX, body.DY); err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, gs)
}

func (s *Server) searchTile(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	it, err := gs.SearchTile(chi.URLParam(r, "heroID"))
	if err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, map[string]any{"loot": it, "game": gs})
}

func (s *Server) hideHero(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	if err := gs.HideHero(chi.URLParam(r, "heroID")); err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, gs)
}

func (s *Server) escapeHero(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	if err := gs.EscapeHero(chi.URLParam(r, "heroID")); err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, gs)
}

func (s *Server) fireballHero(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	rep, err := gs.FireballHero(chi.URLParam(r, "heroID"))
	if err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, map[string]any{"report": rep, "game": gs})
}

func (s *Server) evolveHero(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	var body struct {
		ClassID string `json:"classId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	if err := gs.EvolveHero(chi.URLParam(r, "heroID"), body.ClassID); err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, gs)
}

func (s *Server) advance(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	gs.ForceWave(time.Now())
	s.persist(gs)
	writeJSON(w, http.StatusOK, gs)
}

func (s *Server) townAction(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	var body struct {
		BuildingID string `json:"buildingId"`
		Action     string `json:"action"`
		Points     int    `json:"points"`
		HeroID     string `json:"heroId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	if err := gs.TownAction(body.BuildingID, body.Action, body.Points, body.HeroID); err != nil {
		writeActionErr(w, err)
		return
	}
	gs.Recompute() // building changes affect town defense
	s.persist(gs)
	writeJSON(w, http.StatusOK, gs)
}

func (s *Server) townDeposit(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	moved, err := gs.DepositHeroLoot()
	if err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, map[string]any{"moved": moved, "game": gs})
}

func (s *Server) townCraft(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	var body struct {
		RecipeID string `json:"recipeId"`
		HeroID   string `json:"heroId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	out, err := gs.Craft(body.RecipeID, body.HeroID)
	if err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, map[string]any{"crafted": out, "game": gs})
}

func (s *Server) startCombat(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	c, err := gs.StartCombat(chi.URLParam(r, "heroID"))
	if err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, combatResponse(gs, c))
}

func (s *Server) getCombat(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	c := gs.Combats[chi.URLParam(r, "combatID")]
	if c == nil {
		writeErr(w, http.StatusNotFound, "combat introuvable")
		return
	}
	writeJSON(w, http.StatusOK, combatResponse(gs, c))
}

func (s *Server) combatAction(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	c := gs.Combats[chi.URLParam(r, "combatID")]
	if c == nil {
		writeErr(w, http.StatusNotFound, "combat introuvable")
		return
	}
	var body struct {
		UnitID   string `json:"unitId"`
		Action   string `json:"action"`
		X        int    `json:"x"`
		Y        int    `json:"y"`
		TargetID string `json:"targetId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	if err := c.PlayerAction(body.UnitID, body.Action, body.X, body.Y, body.TargetID); err != nil {
		writeActionErr(w, err)
		return
	}
	if c.Status != "active" {
		gs.FinishCombat(c)
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, combatResponse(gs, c))
}

// mustGame loads the game named by the URL or writes a 404 and returns nil.
func (s *Server) mustGame(w http.ResponseWriter, r *http.Request) *game.GameState {
	gs, err := s.load(chi.URLParam(r, "gameID"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return nil
	}
	if gs == nil {
		writeErr(w, http.StatusNotFound, "partie introuvable")
		return nil
	}
	s.tick(gs)
	return gs
}

func writeActionErr(w http.ResponseWriter, err error) {
	var ae game.ActionError
	var ce game.ErrInvalidAction
	if errors.As(err, &ae) || errors.As(err, &ce) {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeErr(w, http.StatusInternalServerError, err.Error())
}

// --- combat view -----------------------------------------------------------

// combatResponse augments the raw combat with per-current-unit hints for the UI.
func combatResponse(gs *game.GameState, c *game.Combat) map[string]any {
	resp := map[string]any{
		"combat": c,
		"game":   gs,
	}
	if c.Status == "active" {
		if cur := c.CurrentUnit(); cur != nil && cur.Side == "hero" {
			sk := c.SkillFor(cur)
			var reach [][2]int
			if !cur.Moved {
				reach = c.Reachable(cur)
			}
			if reach == nil {
				reach = [][2]int{}
			}
			resp["current"] = map[string]any{
				"unitId":        cur.ID,
				"reachable":     reach,
				"attackTargets": idsOf(c.Targets(cur, baseRange(cur))),
				"skillTargets":  idsOf(c.Targets(cur, sk.Range)),
				"skill":         sk,
			}
		}
	}
	return resp
}

func idsOf(units []*game.CombatUnit) []string {
	out := make([]string, 0, len(units))
	for _, u := range units {
		out = append(out, u.ID)
	}
	return out
}

// baseRange mirrors the combat package's base attack range for view hints.
func baseRange(u *game.CombatUnit) int {
	if u.Kind == "Elementaire de Vent" {
		return 2
	}
	return 1
}
