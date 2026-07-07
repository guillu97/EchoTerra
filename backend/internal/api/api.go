// Package api exposes the REST surface for the Echo Terra prototype. All actions are
// validated and applied server-side; responses carry the authoritative state so the
// client only renders what the server returns.
package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
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
	mu    sync.Mutex // guards cache + locks maps
	cache map[string]*game.GameState
	locks map[string]*sync.Mutex // per-game mutex: one writer/reader at a time per game
}

// New creates a Server backed by the given store and starts the wave scheduler and
// the lobby janitor.
func New(st *store.Store) *Server {
	s := &Server{store: st, cache: map[string]*game.GameState{}, locks: map[string]*sync.Mutex{}}
	go s.waveScheduler()
	go s.lobbyJanitor()
	return s
}

// lockGame acquires the per-game mutex and returns its unlock func. Every access to
// a game's state (HTTP handlers, wave scheduler, janitor) must hold this lock —
// GameState itself has no internal synchronization.
func (s *Server) lockGame(id string) func() {
	s.mu.Lock()
	l, ok := s.locks[id]
	if !ok {
		l = &sync.Mutex{}
		s.locks[id] = l
	}
	s.mu.Unlock()
	l.Lock()
	return l.Unlock
}

// gameLockMiddleware serializes all requests touching one game (even GETs mutate via
// the lazy wave catch-up in tick).
func (s *Server) gameLockMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id := chi.URLParam(r, "gameID"); id != "" {
			unlock := s.lockGame(id)
			defer unlock()
		}
		next.ServeHTTP(w, r)
	})
}

// lobbyTTL is how long an un-launched lobby survives before being purged.
const lobbyTTL = 24 * time.Hour

// lobbyJanitor periodically deletes abandoned lobbies (created long ago, never
// launched) so the open-lobby list and the DB don't fill up with dead salons.
func (s *Server) lobbyJanitor() {
	purge := func() {
		games, err := s.store.List(500)
		if err != nil {
			return
		}
		cutoff := time.Now().Add(-lobbyTTL)
		for _, gs := range games {
			if gs.Status == game.StatusLobby && !gs.CreatedAt.IsZero() && gs.CreatedAt.Before(cutoff) {
				unlock := s.lockGame(gs.ID)
				s.drop(gs.ID)
				unlock()
			}
		}
	}
	purge()
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		purge()
	}
}

// drop removes a game from the cache and the store. Callers must hold the game lock;
// the lock entry itself is left in place (tiny, and avoids unlock-after-delete races).
func (s *Server) drop(id string) {
	s.mu.Lock()
	delete(s.cache, id)
	s.mu.Unlock()
	_ = s.store.Delete(id)
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

// waveScheduler periodically advances waves for all live (cached) games so the town
// is attacked on schedule even while a client is idle, and paces the bot players
// (one action per bot hero every botEvery ticks, so a bot's day unfolds over minutes
// instead of being burned instantly).
func (s *Server) waveScheduler() {
	const botEvery = 4 // bots act every 4th tick (~1/minute)
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	tickNo := 0
	for range ticker.C {
		tickNo++
		now := time.Now()
		s.mu.Lock()
		games := make([]*game.GameState, 0, len(s.cache))
		for _, g := range s.cache {
			games = append(games, g)
		}
		s.mu.Unlock()
		for _, g := range games {
			unlock := s.lockGame(g.ID)
			changed := g.CatchUpWaves(now)
			if tickNo%botEvery == 0 && g.BotAct() {
				changed = true
			}
			if changed {
				g.Recompute()
				_ = s.store.Save(g)
			}
			unlock()
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
		r.Get("/", s.listGames)
		r.Post("/", s.createGame)
		r.Post("/lobby", s.createLobby)
		r.Post("/join", s.joinByCode)
		r.Route("/{gameID}", func(r chi.Router) {
			r.Use(s.gameLockMiddleware)
			r.Get("/", s.getGame)
			r.Post("/join", s.joinGame)
			r.Post("/start", s.startGame)
			r.Post("/leave", s.leaveGame)
			r.Post("/kick", s.kickPlayer)
			r.Post("/bots", s.addBot)
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

// --- lobby / multiplayer -----------------------------------------------------

// gameSummary is the lightweight listing DTO (no tiles/monsters payload).
type gameSummary struct {
	ID         string       `json:"id"`
	Name       string       `json:"name"`
	JoinCode   string       `json:"joinCode,omitempty"`
	Status     string       `json:"status"`
	Players    []*game.Player `json:"players"`
	MinPlayers int          `json:"minPlayers"`
	MaxPlayers int          `json:"maxPlayers"`
	Day        int          `json:"day"`
	WaveNumber int          `json:"waveNumber"`
	CreatedAt  time.Time    `json:"createdAt"`
}

func summarize(gs *game.GameState) gameSummary {
	players := gs.Players
	if players == nil {
		players = []*game.Player{}
	}
	return gameSummary{
		ID: gs.ID, Name: gs.Name, JoinCode: gs.JoinCode, Status: gs.Status,
		Players: players, MinPlayers: gs.MinPlayers, MaxPlayers: gs.MaxPlayers,
		Day: gs.Day, WaveNumber: gs.WaveNumber, CreatedAt: gs.CreatedAt,
	}
}

// listGames returns recent games as summaries. ?status=lobby filters to open lobbies.
func (s *Server) listGames(w http.ResponseWriter, r *http.Request) {
	games, err := s.store.List(50)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	status := r.URL.Query().Get("status")
	out := []gameSummary{}
	for _, gs := range games {
		if status != "" && gs.Status != status {
			continue
		}
		out = append(out, summarize(gs))
	}
	writeJSON(w, http.StatusOK, out)
}

// createLobby creates a game in "lobby" status and joins the creator as host.
func (s *Server) createLobby(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name       string `json:"name"`
		PlayerName string `json:"playerName"`
		MinPlayers int    `json:"minPlayers"`
		MaxPlayers int    `json:"maxPlayers"`
		Width      int    `json:"width"`
		Height     int    `json:"height"`
		Seed       int64  `json:"seed"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Width == 0 {
		body.Width = 22
	}
	if body.Height == 0 {
		body.Height = 22
	}
	if body.Seed == 0 {
		body.Seed = time.Now().UnixNano()
	}
	if body.MinPlayers == 0 {
		body.MinPlayers = 2
	}
	if body.Name == "" {
		if body.PlayerName != "" {
			body.Name = "Partie de " + body.PlayerName
		} else {
			body.Name = "Nouvelle expédition"
		}
	}
	gs := worldgen.NewLobby(body.Width, body.Height, body.Seed, body.Name, body.MinPlayers, body.MaxPlayers)
	p, err := gs.AddPlayer(body.PlayerName, time.Now())
	if err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusCreated, map[string]any{"game": gs, "player": p})
}

// joinByCode resolves a join code against open lobbies (newest first) and joins it.
func (s *Server) joinByCode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code       string `json:"code"`
		PlayerName string `json:"playerName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" {
		writeErr(w, http.StatusBadRequest, "code de partie requis")
		return
	}
	code := strings.ToUpper(strings.TrimSpace(body.Code))
	games, err := s.store.List(200)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, cand := range games {
		if cand.Status == game.StatusLobby && (cand.JoinCode == code || cand.ID == body.Code) {
			// This route lives outside the /{gameID} middleware: take the lock here.
			unlock := s.lockGame(cand.ID)
			s.join(w, cand.ID, body.PlayerName)
			unlock()
			return
		}
	}
	writeErr(w, http.StatusNotFound, "aucune partie ouverte avec ce code")
}

// joinGame joins the lobby named by the URL.
func (s *Server) joinGame(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PlayerName string `json:"playerName"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	s.join(w, chi.URLParam(r, "gameID"), body.PlayerName)
}

// join loads the canonical (cached) game and adds the player. Callers must hold the
// game lock (the /{gameID} middleware provides it; joinByCode takes it explicitly —
// the per-game mutex is NOT reentrant, locking here again would deadlock).
func (s *Server) join(w http.ResponseWriter, gameID, playerName string) {
	gs, err := s.load(gameID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if gs == nil {
		writeErr(w, http.StatusNotFound, "partie introuvable")
		return
	}
	p, err := gs.AddPlayer(playerName, time.Now())
	if err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, map[string]any{"game": gs, "player": p})
}

// leaveGame removes the calling player (and their hero) from a lobby. An emptied
// lobby is deleted outright.
func (s *Server) leaveGame(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	var body struct {
		PlayerID string `json:"playerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	remaining, err := gs.RemovePlayer(body.PlayerID)
	if err != nil {
		writeActionErr(w, err)
		return
	}
	if remaining == 0 {
		s.drop(gs.ID)
		writeJSON(w, http.StatusOK, map[string]any{"left": true, "deleted": true})
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, map[string]any{"left": true, "deleted": false, "game": gs})
}

// kickPlayer lets the host expel another player from the lobby.
func (s *Server) kickPlayer(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	var body struct {
		PlayerID string `json:"playerId"`
		TargetID string `json:"targetId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	if _, err := gs.KickPlayer(body.PlayerID, body.TargetID); err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, gs)
}

// addBot lets the host add a computer-controlled player to the lobby.
func (s *Server) addBot(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	var body struct {
		PlayerID string `json:"playerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	p, err := gs.AddBot(body.PlayerID, time.Now())
	if err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, map[string]any{"game": gs, "player": p})
}

// startGame launches a lobby (host only, requires MinPlayers players).
func (s *Server) startGame(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	var body struct {
		PlayerID string `json:"playerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	if err := gs.StartGame(body.PlayerID, time.Now()); err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, gs)
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

// ownHero enforces per-player hero ownership on multiplayer games; it writes the
// rejection and returns false when the caller may not act with this hero.
func (s *Server) ownHero(w http.ResponseWriter, gs *game.GameState, playerID, heroID string) bool {
	if err := gs.CheckHeroOwnership(playerID, heroID); err != nil {
		writeActionErr(w, err)
		return false
	}
	return true
}

func (s *Server) moveHero(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	var body struct {
		DX, DY   int
		PlayerID string `json:"playerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	if !s.ownHero(w, gs, body.PlayerID, chi.URLParam(r, "heroID")) {
		return
	}
	if err := gs.MoveHero(chi.URLParam(r, "heroID"), body.DX, body.DY); err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, gs)
}

// heroActionBody is the shared optional body of parameterless hero actions.
type heroActionBody struct {
	PlayerID string `json:"playerId"`
}

func decodePlayer(r *http.Request) string {
	var body heroActionBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	return body.PlayerID
}

func (s *Server) searchTile(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	if !s.ownHero(w, gs, decodePlayer(r), chi.URLParam(r, "heroID")) {
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
	if !s.ownHero(w, gs, decodePlayer(r), chi.URLParam(r, "heroID")) {
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
	if !s.ownHero(w, gs, decodePlayer(r), chi.URLParam(r, "heroID")) {
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
	if !s.ownHero(w, gs, decodePlayer(r), chi.URLParam(r, "heroID")) {
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
		ClassID  string `json:"classId"`
		PlayerID string `json:"playerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	if !s.ownHero(w, gs, body.PlayerID, chi.URLParam(r, "heroID")) {
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
		PlayerID   string `json:"playerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	// The town worker paying the PA must be the calling player's own hero.
	if body.HeroID != "" && !s.ownHero(w, gs, body.PlayerID, body.HeroID) {
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
	// In multiplayer, a player only deposits their own team's bags; legacy solo games
	// (no players) keep the deposit-everyone behaviour.
	var only []string
	if pid := decodePlayer(r); len(gs.Players) > 0 {
		p := gs.PlayerByID(pid)
		if p == nil {
			writeErr(w, http.StatusBadRequest, "joueur inconnu — reconnecte-toi à la partie")
			return
		}
		only = p.HeroIDs
	}
	moved, err := gs.DepositHeroLoot(only)
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
		PlayerID string `json:"playerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	// The crafting hero (paying the PA) must belong to the calling player.
	if body.HeroID != "" && !s.ownHero(w, gs, body.PlayerID, body.HeroID) {
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
	if !s.ownHero(w, gs, decodePlayer(r), chi.URLParam(r, "heroID")) {
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
		PlayerID string `json:"playerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	// A hero unit may only be played by the player owning the underlying hero.
	for _, u := range c.Units {
		if u.ID == body.UnitID && u.Side == "hero" {
			if !s.ownHero(w, gs, body.PlayerID, u.RefID) {
				return
			}
			break
		}
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
