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
	// stateless marks a serverless deployment (e.g. one Vercel function): no
	// background goroutines (waves AND bots catch up lazily in tick, housekeeping
	// runs on the lobby-list poll) and no cross-request cache — concurrent function
	// instances would serve each other stale state, so the store is the only source
	// of truth. The per-game mutex still serializes requests within one instance.
	stateless bool
	// tickToken is the shared secret guarding POST /api/tick (the heartbeat a cron
	// calls so games advance with nobody connected — see tick.go); lastTickAt damps
	// repeated calls to one instance.
	tickToken  string
	lastTickAt time.Time
}

// New creates a Server backed by the given store and starts the wave scheduler and
// the lobby janitor.
func New(st *store.Store) *Server {
	s := &Server{store: st, cache: map[string]*game.GameState{}, locks: map[string]*sync.Mutex{}}
	s.ensurePublicLobby() // there is always an open public game to join
	go s.waveScheduler()
	go s.lobbyJanitor()
	return s
}

// NewServerless creates a Server for platforms without a resident process (Vercel
// functions…): everything the goroutines of New do happens lazily instead.
func NewServerless(st *store.Store) *Server {
	// Pas d'ensurePublicLobby ici : un DÉMARRAGE À FROID n'est pas un bon moment pour
	// balayer la base (chaque instance qui s'éveille le referait), et deux instances
	// froides simultanées créeraient deux salons publics. C'est housekeeping() — sur le
	// battement et sur le poll de la liste — qui garantit le salon et dédoublonne.
	return &Server{store: st, cache: map[string]*game.GameState{}, locks: map[string]*sync.Mutex{}, stateless: true}
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
		games, err := s.store.ListByStatus(game.StatusLobby, 500)
		if err != nil {
			return
		}
		cutoff := time.Now().Add(-lobbyTTL)
		for _, gs := range games {
			if !gs.CreatedAt.IsZero() && gs.CreatedAt.Before(cutoff) {
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
		s.ensurePublicLobby() // replace a purged (or started) public lobby
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

// tick rattrape le temps écoulé pour une partie fraîchement chargée : vagues dues,
// rounds de joueurs-IA et tours de combat AFK (voir game.AdvanceTo). Budget de
// REQUÊTE : un joueur attend sa réponse, le reste du retard est absorbé par le
// battement (POST /api/tick) ou les requêtes suivantes.
func (s *Server) tick(gs *game.GameState) {
	if gs == nil {
		return
	}
	res := gs.AdvanceTo(time.Now(), game.RequestBudget)
	gs.Recompute()
	if res.Changed {
		_ = s.store.Save(gs)
	}
}

// waveScheduler advances every live (cached) game on a timer, so the town is attacked
// on schedule and the bots play while a client is idle. C'est le pendant RÉSIDENT du
// battement HTTP (voir tick.go) : les deux passent par la même horloge de simulation
// (game.AdvanceTo), donc une partie avance de la même façon quel que soit l'hôte.
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
			unlock := s.lockGame(g.ID)
			if res := g.AdvanceTo(now, game.TickBudget); res.Changed {
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

	// Classement des villes. ?mode=solo|public|private restreint à un type de partie
	// (les trois ne se comparent pas) ; sans mode, tout est classé ensemble.
	r.Get("/api/leaderboard", func(w http.ResponseWriter, r *http.Request) {
		mode := r.URL.Query().Get("mode")
		switch mode {
		case "", game.ModeSolo, game.ModePublic, game.ModePrivate:
		default:
			writeErr(w, http.StatusBadRequest, "mode inconnu: "+mode)
			return
		}
		entries, err := s.store.Leaderboard(mode, 50)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, entries)
	})

	r.Get("/api/mapskills", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, game.MapSkills)
	})

	// Battement : fait avancer TOUTES les parties actives (vagues, bots, tours AFK)
	// sans qu'un joueur soit connecté. GET est accepté aussi : beaucoup de pingers
	// gratuits ne savent poser qu'une URL.
	r.Post("/api/tick", s.tickHandler)
	r.Get("/api/tick", s.tickHandler)

	r.Route("/api/auth", s.authRoutes)

	r.Route("/api/games", func(r chi.Router) {
		r.Get("/", s.listGames)
		r.Post("/", s.createGame)
		r.Post("/lobby", s.createLobby)
		r.Post("/solo", s.soloGame)
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
			r.Post("/reveal", s.reveal)
			r.Post("/town/action", s.townAction)
			r.Post("/town/deposit", s.townDeposit)
			r.Post("/town/craft", s.townCraft)
			r.Get("/town/chat", s.townChatList)
			r.Post("/town/chat", s.townChatPost)
			r.Post("/heroes/{heroID}/move", s.moveHero)
			r.Post("/heroes/{heroID}/search", s.searchTile)
			r.Post("/heroes/{heroID}/hide", s.hideHero)
			r.Post("/heroes/{heroID}/escape", s.escapeHero)
			r.Post("/heroes/{heroID}/skill", s.castMapSkill)
			r.Post("/heroes/{heroID}/drink", s.drinkRation)
			r.Post("/heroes/{heroID}/ruin/clear", s.ruinClear)
			r.Post("/heroes/{heroID}/ruin/explore", s.ruinExplore)
			r.Post("/heroes/{heroID}/evolve", s.evolveHero)
			r.Post("/heroes/{heroID}/combat/start", s.startCombat)
			r.Get("/combat/{combatID}", s.getCombat)
			r.Post("/combat/{combatID}/action", s.combatAction)
			r.Post("/combat/{combatID}/join", s.joinCombat)
		})
	})
	return r
}

// --- helpers ---------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(clientView(v))
}

// clientView redacts every GameState in an outgoing payload (fog of war: tiles no
// hero has discovered must not reach the network, see GameState.ClientView).
// Centralized here so no handler — current or future — can leak the full state.
func clientView(v any) any {
	switch t := v.(type) {
	case *game.GameState:
		return t.ClientView()
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			out[k] = clientView(val)
		}
		return out
	}
	return v
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// load fetches a game from cache or the store. Stateless mode always reads the
// store: another function instance may have written since our last request.
func (s *Server) load(id string) (*game.GameState, error) {
	if s.stateless {
		return s.store.Load(id)
	}
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
	if !s.stateless {
		s.mu.Lock()
		s.cache[gs.ID] = gs
		s.mu.Unlock()
	}
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
		body.Width = worldgen.DefaultSize
	}
	if body.Height == 0 {
		body.Height = worldgen.DefaultSize
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
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Status     string         `json:"status"`
	Visibility string         `json:"visibility"`
	Players    []*game.Player `json:"players"`
	MinPlayers int            `json:"minPlayers"`
	MaxPlayers int            `json:"maxPlayers"`
	Day        int            `json:"day"`
	WaveNumber int            `json:"waveNumber"`
	CreatedAt  time.Time      `json:"createdAt"`
	// Fenêtre d'accueil : une expédition publique déjà LANCÉE reste rejoignable
	// quelques vagues. Le front en a besoin pour dire « en cours — encore N vagues
	// pour embarquer » au lieu d'afficher un salon qui n'en est plus un.
	JoinOpen      bool `json:"joinOpen"`
	JoinWavesLeft int  `json:"joinWavesLeft"`
}

// summarize omits the join code on purpose: private lobbies are joined by sharing
// their code out-of-band, never by picking them off the public list.
func summarize(gs *game.GameState) gameSummary {
	players := gs.Players
	if players == nil {
		players = []*game.Player{}
	}
	vis := gs.Visibility
	if vis == "" {
		vis = game.VisibilityPrivate
	}
	left := 0
	if gs.Status == game.StatusActive && gs.JoinOpen() {
		left = gs.JoinClosesAtWave() - gs.WaveNumber
	}
	return gameSummary{
		ID: gs.ID, Name: gs.Name, Status: gs.Status, Visibility: vis,
		Players: players, MinPlayers: gs.MinPlayers, MaxPlayers: gs.MaxPlayers,
		Day: gs.Day, WaveNumber: gs.WaveNumber, CreatedAt: gs.CreatedAt,
		JoinOpen: gs.JoinOpen(), JoinWavesLeft: left,
	}
}

// housekeeping replaces the janitor + ensurePublicLobby goroutine work when there is
// no resident process: purge stale lobbies and keep EXACTLY one public lobby open. Il
// tourne sur le battement (POST /api/tick) et sur le poll de la liste des salons.
func (s *Server) housekeeping() {
	games, err := s.store.ListByStatus(game.StatusLobby, 200)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-lobbyTTL)
	var public []*game.GameState
	for _, gs := range games {
		if !gs.CreatedAt.IsZero() && gs.CreatedAt.Before(cutoff) {
			unlock := s.lockGame(gs.ID)
			s.drop(gs.ID)
			unlock()
			continue
		}
		if gs.IsPublic() {
			public = append(public, gs)
		}
	}
	// Une expédition publique LANCÉE mais encore ouverte tient lieu de salon public :
	// tant qu'elle accueille, on n'en ouvre pas un second à côté (cf.
	// joinablePublicCount). Les doublons de salons restent purgés ci-dessous.
	if len(public) == 0 {
		if n, err := s.joinablePublicCount(); err == nil && n > 0 {
			return
		}
	}
	// Deux instances froides peuvent créer chacune leur salon public (rien ne les
	// sérialise entre elles) : on garde le plus PEUPLÉ (à défaut le premier, la liste
	// est déjà triée du plus récent au plus ancien) et on purge les doublons vides.
	if len(public) > 1 {
		keep := 0
		for i, gs := range public {
			if len(gs.Players) > len(public[keep].Players) {
				keep = i
			}
		}
		for i, gs := range public {
			if i == keep || len(gs.Players) > 0 {
				continue
			}
			unlock := s.lockGame(gs.ID)
			s.drop(gs.ID)
			unlock()
		}
		return
	}
	if len(public) == 0 {
		s.newPublicLobby()
	}
}

// seedMemorials sème sur une carte NEUVE les ruines des dernières villes tombées —
// nom, dernière vague, défenseurs (cf. game.SeedMemorialRuins). Best-effort : une base
// vide, ou en erreur, donne simplement une carte sans mémorial.
//
// C'est ici que le méta-jeu se referme : une expédition qui meurt le mardi devient un
// lieu sur la carte de quelqu'un d'autre le mercredi.
func (s *Server) seedMemorials(gs *game.GameState) {
	fallen, err := s.store.FallenTowns(12)
	if err != nil || len(fallen) == 0 {
		return
	}
	mem := make([]game.Memorial, 0, len(fallen))
	for _, f := range fallen {
		if f.GameID == gs.ID || f.TownName == "" {
			continue
		}
		mem = append(mem, game.Memorial{TownName: f.TownName, Wave: f.Waves, Defenders: f.Players})
	}
	gs.SeedMemorialRuins(mem)
}

// newPublicLobby crée et persiste un salon public ouvert (celui qu'on rejoint sans code).
func (s *Server) newPublicLobby() *game.GameState {
	// Un salon public accueille large : 2 minimum, jusqu'à MaxPlayersPerGame, et la
	// carte suit (taille 0 = worldgen.SizeForPlayers).
	gs := worldgen.NewLobby(0, 0, time.Now().UnixNano(), "", 2, worldgen.MaxPlayersPerGame)
	gs.Visibility = game.VisibilityPublic
	s.seedMemorials(gs)
	// Nommée d'après sa ville ("Expédition de Clairmont") : deux salons publics
	// successifs se distinguent, et le classement lit le même nom.
	gs.Name = publicLobbyName + gs.Town.Name
	s.persist(gs)
	return gs
}

// listGames returns recent games as summaries. ?status=lobby filters to open lobbies.
func (s *Server) listGames(w http.ResponseWriter, r *http.Request) {
	if s.stateless {
		s.housekeeping()
	}
	// Le filtre est appliqué EN SQL : filtrer après le LIMIT faisait disparaître les
	// salons de la liste dès qu'il y avait 50 parties actives plus fraîches (elles sont
	// réécrites à chaque vague et par le battement).
	//
	// `status=open` = « ce que je peux rejoindre » : les salons ET les expéditions
	// publiques encore dans leur fenêtre d'accueil. C'est ce que le front demande —
	// `status=lobby` reste disponible pour qui veut strictement les salons.
	var games []*game.GameState
	var err error
	if st := r.URL.Query().Get("status"); st == "open" {
		games, err = s.store.OpenForJoin(50)
	} else {
		games, err = s.store.ListByStatus(st, 50)
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := []gameSummary{}
	for _, gs := range games {
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
	// Width/Height à 0 = « la taille qui va avec ce lobby » (worldgen.SizeForPlayers) :
	// une carte fixe voudrait dire vingt équipes sur les mêmes gisements, ou un solo
	// perdu dans un monde vide.
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
	// A logged-in creator plays under their account name and gets linked to it.
	user := s.userFromReq(r)
	if user != nil && body.PlayerName == "" {
		body.PlayerName = user.Name
	}
	gs := worldgen.NewLobby(body.Width, body.Height, body.Seed, body.Name, body.MinPlayers, body.MaxPlayers)
	gs.Visibility = game.VisibilityPrivate
	s.seedMemorials(gs)
	p, err := gs.AddPlayer(body.PlayerName, time.Now())
	if err != nil {
		writeActionErr(w, err)
		return
	}
	if user != nil {
		p.UserID = user.ID
	}
	s.persist(gs)
	writeJSON(w, http.StatusCreated, map[string]any{"game": gs, "player": p})
}

// soloGame creates and immediately launches a private game: the caller + 4 bots.
// One call powers the menu's "solo" mode.
func (s *Server) soloGame(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PlayerName string `json:"playerName"`
		Width      int    `json:"width"`
		Height     int    `json:"height"`
		Seed       int64  `json:"seed"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Seed == 0 {
		body.Seed = time.Now().UnixNano()
	}
	user := s.userFromReq(r)
	if user != nil && body.PlayerName == "" {
		body.PlayerName = user.Name
	}
	name := "Expédition solo"
	if body.PlayerName != "" {
		name = "Solo de " + body.PlayerName
	}
	now := time.Now()
	gs := worldgen.NewLobby(body.Width, body.Height, body.Seed, name, 1, 5)
	gs.Visibility = game.VisibilityPrivate
	s.seedMemorials(gs)
	gs.Solo = true // classement : les runs solo se comparent entre eux
	p, err := gs.AddPlayer(body.PlayerName, now)
	if err != nil {
		writeActionErr(w, err)
		return
	}
	if user != nil {
		p.UserID = user.ID
	}
	for i := 0; i < 4; i++ {
		if _, err := gs.AddBot(p.ID, now); err != nil {
			writeActionErr(w, err)
			return
		}
	}
	if err := gs.StartGame(p.ID, now); err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusCreated, map[string]any{"game": gs, "player": p})
}

// publicLobbyName prefixes the display name of server-created public games, which
// is completed by the generated town name (see newPublicLobby).
const publicLobbyName = "Expédition de "

// ensurePublicLobby guarantees at least one OPEN public lobby exists, so there is
// always a game to join without a code. Called at startup, from the janitor, and
// after a public game auto-starts.
func (s *Server) ensurePublicLobby() {
	if n, err := s.joinablePublicCount(); err != nil || n > 0 {
		return
	}
	s.newPublicLobby()
}

// joinablePublicCount compte les expéditions publiques qu'un nouveau venu peut encore
// rejoindre — salons ouverts ET parties lancées encore dans leur fenêtre d'accueil.
//
// C'est la nuance qui fait tenir la fenêtre : tant que l'expédition en cours accepte du
// monde, ouvrir un salon neuf à côté SÉPARERAIT les joueurs entre deux parties, ce qui
// est exactement ce que la fenêtre est censée éviter. Le salon suivant naît quand les
// portes de celle-ci se ferment (ou qu'elle est complète).
func (s *Server) joinablePublicCount() (int, error) {
	games, err := s.store.OpenForJoin(200)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, gs := range games {
		if gs.IsPublic() && gs.JoinOpen() {
			n++
		}
	}
	return n, nil
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
	// On cherche parmi les parties REJOIGNABLES, pas parmi les salons : une expédition
	// publique lancée reste ouverte pendant sa fenêtre d'accueil (game.JoinOpen).
	games, err := s.store.OpenForJoin(200)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, cand := range games {
		if cand.JoinCode == code || cand.ID == body.Code {
			// This route lives outside the /{gameID} middleware: take the lock here.
			unlock := s.lockGame(cand.ID)
			s.join(w, r, cand.ID, body.PlayerName)
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
	s.join(w, r, chi.URLParam(r, "gameID"), body.PlayerName)
}

// join loads the canonical (cached) game and adds the player. Callers must hold the
// game lock (the /{gameID} middleware provides it; joinByCode takes it explicitly —
// the per-game mutex is NOT reentrant, locking here again would deadlock).
func (s *Server) join(w http.ResponseWriter, r *http.Request, gameID, playerName string) {
	gs, err := s.load(gameID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if gs == nil {
		writeErr(w, http.StatusNotFound, "partie introuvable")
		return
	}
	now := time.Now()
	user := s.userFromReq(r)
	// Une partie PUBLIQUE exige un compte : sans identité stable on ne saurait pas
	// à quel joueur rendre la partie (reprise multi-appareils). Les parties privées
	// (join par code) restent ouvertes aux anonymes.
	if gs.IsPublic() && user == nil {
		writeErr(w, http.StatusUnauthorized, "connecte-toi pour rejoindre une partie publique")
		return
	}
	if user != nil {
		// Already in this game under my account (other device / lost localStorage):
		// hand back my player instead of adding a duplicate.
		if p := gs.PlayerByUserID(user.ID); p != nil {
			writeJSON(w, http.StatusOK, map[string]any{"game": gs, "player": p, "rejoined": true})
			return
		}
		if playerName == "" {
			playerName = user.Name
		}
	}
	p, err := gs.AddPlayer(playerName, now)
	if err != nil {
		writeActionErr(w, err)
		return
	}
	if user != nil {
		p.UserID = user.ID
	}
	// Public games launch on their own the moment MinPlayers is reached — but they keep
	// their doors open for the welcome window (game.PublicJoinGraceWaves), so this call
	// is normally a no-op: a fresh lobby is only opened once nobody can board this one.
	if gs.MaybeAutoStart(now) {
		defer s.ensurePublicLobby()
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

// kickPlayer expels a player: host decision in private games, majority vote in
// public ones (the response then carries the vote tally).
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
	if gs.IsPublic() {
		votes, needed, kicked, err := gs.VoteKick(body.PlayerID, body.TargetID)
		if err != nil {
			writeActionErr(w, err)
			return
		}
		s.persist(gs)
		writeJSON(w, http.StatusOK, map[string]any{"game": gs, "votes": votes, "needed": needed, "kicked": kicked})
		return
	}
	if _, err := gs.KickPlayer(body.PlayerID, body.TargetID); err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, map[string]any{"game": gs, "kicked": true})
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
	cv := gs.ClientView() // fog of war: never ship undiscovered tiles
	writeJSON(w, http.StatusOK, map[string]any{
		"width":  cv.Width,
		"height": cv.Height,
		"tiles":  cv.Tiles,
		"town":   cv.Town,
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

// castMapSkill runs a hero's class map skill (remplace fireball/snipe) — le corps
// porte l'id de la compétence choisie côté client.
func (s *Server) castMapSkill(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	var body struct {
		SkillID  string `json:"skillId"`
		PlayerID string `json:"playerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	if !s.ownHero(w, gs, body.PlayerID, chi.URLParam(r, "heroID")) {
		return
	}
	rep, err := gs.CastMapSkill(chi.URLParam(r, "heroID"), body.SkillID)
	if err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, map[string]any{"report": rep, "game": gs})
}

// drinkRation consumes a Ration d'eau from the hero's bag to restore action points.
func (s *Server) drinkRation(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	if !s.ownHero(w, gs, decodePlayer(r), chi.URLParam(r, "heroID")) {
		return
	}
	if _, err := gs.DrinkRation(chi.URLParam(r, "heroID")); err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, gs)
}

// ruinClear invests the hero's PA into clearing the ruin on their tile (collective).
func (s *Server) ruinClear(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	var body struct {
		Points   int    `json:"points"`
		PlayerID string `json:"playerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	if !s.ownHero(w, gs, body.PlayerID, chi.URLParam(r, "heroID")) {
		return
	}
	ru, err := gs.ClearRuin(chi.URLParam(r, "heroID"), body.Points)
	if err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, map[string]any{"ruin": ru, "game": gs})
}

// ruinExplore draws one treasure from the cleared dungeon under the hero (2 PA).
func (s *Server) ruinExplore(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	if !s.ownHero(w, gs, decodePlayer(r), chi.URLParam(r, "heroID")) {
		return
	}
	item, err := gs.ExploreRuin(chi.URLParam(r, "heroID"))
	if err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, map[string]any{"item": item, "game": gs})
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
	// {safe:true} (dev cheat) advances the wave WITHOUT any town damage.
	var body struct {
		Safe bool `json:"safe"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Safe {
		gs.ForceWaveSafe(time.Now())
	} else {
		gs.ForceWave(time.Now())
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, gs)
}

// reveal is a DEBUG toggle for the fog of war: {on:true} sends the whole map,
// {on:false} restores the genuine explored-only fog (see game.RevealAll / fog.go).
func (s *Server) reveal(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	var body struct {
		On bool `json:"on"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	gs.RevealAll = body.On
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
	// The town worker paying the PA must be the calling player's own hero. In
	// multiplayer the heroId is REQUIRED: the legacy shared pool (heroId="") would
	// drain PA from every hero in town, including other players' teams.
	if len(gs.Players) > 0 && body.HeroID == "" {
		writeErr(w, http.StatusBadRequest, "sélectionne lequel de tes héros paie l'action (heroId)")
		return
	}
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

// townChatList serves the messaging board to one player (see game/chat.go).
//
// It deliberately does NOT go through mustGame: mustGame runs tick(), which
// replays missed waves and bot rounds and writes to the store. The chat is polled
// every few seconds while the sheet is open — routing that through the simulation
// would multiply catch-up work and DB writes by an order of magnitude. Loading
// without ticking is exactly what getWorld does, for the same reason.
func (s *Server) townChatList(w http.ResponseWriter, r *http.Request) {
	gs, err := s.load(chi.URLParam(r, "gameID"))
	if err != nil || gs == nil {
		writeErr(w, http.StatusNotFound, "partie introuvable")
		return
	}
	msgs, err := gs.ChatFor(r.URL.Query().Get("playerId")) // GET: the player id rides the query string
	if err != nil {
		writeActionErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": msgs, "poste": gs.PosteReady()})
}

func (s *Server) townChatPost(w http.ResponseWriter, r *http.Request) {
	gs := s.mustGame(w, r)
	if gs == nil {
		return
	}
	var body struct {
		PlayerID string `json:"playerId"`
		Text     string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "corps invalide")
		return
	}
	msg, err := gs.PostChat(body.PlayerID, body.Text)
	if err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	msgs, err := gs.ChatFor(body.PlayerID)
	if err != nil {
		writeActionErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"message": msg, "messages": msgs, "poste": gs.PosteReady()})
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
	playerID := decodePlayer(r)
	if !s.ownHero(w, gs, playerID, chi.URLParam(r, "heroID")) {
		return
	}
	c, err := gs.StartCombat(chi.URLParam(r, "heroID"), playerID)
	if err != nil {
		writeActionErr(w, err)
		return
	}
	s.persist(gs)
	writeJSON(w, http.StatusOK, combatResponse(gs, c))
}

// joinCombat (multijoueur) : un joueur dont les héros ont été embarqués dans un
// combat (IA) le rejoint et reprend le contrôle de SES unités.
func (s *Server) joinCombat(w http.ResponseWriter, r *http.Request) {
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
	c, err := gs.JoinCombat(chi.URLParam(r, "combatID"), body.PlayerID)
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
	// anti-blocage : si le joueur dont c'est le tour a dépassé le délai, on
	// résout son tour ICI (le poll de combat toutes les 3 s déclenche cette voie).
	if c.EnforceTurnTimer(time.Now()) {
		if c.Status != "active" {
			gs.FinishCombat(c)
		}
		s.persist(gs)
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
		SkillIdx int    `json:"skillIdx"` // action "skill" : quelle compétence iso (défaut 0)
		Item     string `json:"item"`     // action "item" (C3) : nom de l'objet du sac
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
			// Agir dans le combat vaut présence : un joueur qui joue son unité
			// est (re)inscrit comme participant (défensif — reconnexion).
			c.AddParticipant(body.PlayerID)
			break
		}
	}
	var err error
	if body.Action == "item" {
		err = c.UseItem(gs, body.UnitID, body.Item) // touche le sac du héros → besoin de gs
	} else {
		err = c.PlayerAction(body.UnitID, body.Action, body.X, body.Y, body.TargetID, body.SkillIdx)
	}
	if err != nil {
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
			base := c.BaseAttack(cur)
			sk := c.HeroSkill(cur)
			var reach [][2]int
			if !cur.Moved {
				reach = c.Reachable(cur)
			}
			if reach == nil {
				reach = [][2]int{}
			}
			atkTargets := c.TargetsFor(cur, &base)
			skTargets := c.TargetsFor(cur, &sk)
			// Liste COMPLÈTE des compétences iso du héros (une par bouton) — chacune
			// avec ses cibles et fourchettes prêtes à afficher.
			isoSkills := c.HeroSkills(cur)
			skills := make([]map[string]any, 0, len(isoSkills))
			for i := range isoSkills {
				s := isoSkills[i]
				tgts := c.TargetsFor(cur, &s)
				skills = append(skills, map[string]any{
					"idx":       i,
					"skill":     s,
					"targets":   idsOf(tgts),
					"estimates": estimatesOf(c, cur, &s, tgts),
					"selfCast":  s.SelfShield || s.BuffAllies,
				})
			}
			resp["current"] = map[string]any{
				"unitId":        cur.ID,
				"reachable":     reach,
				"attackTargets": idsOf(atkTargets),
				"skillTargets":  idsOf(skTargets),
				"skill":         sk,
				// Fourchettes de dégâts prévisualisées (lot C2) — calcul serveur.
				"attackEstimates": estimatesOf(c, cur, &base, atkTargets),
				"skillEstimates":  estimatesOf(c, cur, &sk, skTargets),
				// Compétences iso multiples (une par bouton).
				"skills": skills,
				// Lot C3 : cibles de Poussée + objets du sac utilisables en combat.
				"pushTargets": idsOf(c.PushTargets(cur)),
				"items":       usableItemsOf(gs, cur),
			}
		}
		// Télégraphie (lot C2) : cases menacées par chaque ennemi vivant depuis sa
		// position — le client les teinte en orange quand on tape l'ennemi.
		threats := []map[string]any{}
		for _, u := range c.Units {
			if u.Alive() && u.Side == "monster" {
				cells := c.ThreatCells(u)
				if cells == nil {
					cells = [][2]int{}
				}
				threats = append(threats, map[string]any{"unitId": u.ID, "cells": cells})
			}
		}
		resp["threats"] = threats
	}
	return resp
}

// usableItemsOf lists the combat consumables in the acting hero's bag (C3).
func usableItemsOf(gs *game.GameState, cur *game.CombatUnit) []map[string]any {
	out := []map[string]any{}
	h := gs.HeroByID(cur.RefID)
	if h == nil {
		return out
	}
	for _, it := range h.Inventory {
		if heal := game.CombatHeal(it.Name); heal > 0 && it.Qty > 0 {
			out = append(out, map[string]any{"name": it.Name, "qty": it.Qty, "heal": heal})
		}
	}
	return out
}

// estimatesOf maps target unit id -> {min,max} predicted damage of atk.
func estimatesOf(c *game.Combat, att *game.CombatUnit, atk *game.AttackDef, targets []*game.CombatUnit) map[string]map[string]int {
	out := map[string]map[string]int{}
	if atk.DmgStat == "" {
		return out
	}
	for _, t := range targets {
		lo, hi := c.EstimateDamage(att, t, atk)
		e := map[string]int{"min": lo, "max": hi}
		// Télégraphie C4 : attaque de dos (🗡 +25 %) / cible à couvert (🛡 −25 %).
		if rear, cover := c.EstimateFlags(att, t); rear {
			e["rear"] = 1
		} else if cover {
			e["cover"] = 1
		}
		out[t.ID] = e
	}
	return out
}

func idsOf(units []*game.CombatUnit) []string {
	out := make([]string, 0, len(units))
	for _, u := range units {
		out = append(out, u.ID)
	}
	return out
}
