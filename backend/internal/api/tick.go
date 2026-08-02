package api

import (
	"crypto/subtle"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"echoterra/internal/game"
	"echoterra/internal/store"
)

// --- Battement (heartbeat) --------------------------------------------------
//
// Sur un hébergement sans processus résident (Vercel : scale-to-zero, les goroutines
// meurent avec l'instance), rien ne fait avancer une partie tant qu'aucune requête ne
// la touche. `POST /api/tick` est ce déclencheur : appelé par un cron EXTERNE (voir
// .github/workflows/heartbeat.yml et DEPLOY.md), il fait tourner le monde — vagues,
// joueurs-IA, tours de combat AFK — même si personne n'est connecté.
//
// L'endpoint est idempotent et sans effet propre : il ne fait qu'appliquer le temps
// écoulé (game.AdvanceTo). L'appeler deux fois de suite ne double rien.

// tickSweepBudget borne UN balayage : au-delà, on rend la main et le battement suivant
// reprend (les parties les plus en retard passent en premier, voir store.ActiveGames).
const (
	tickMaxGames   = 25
	tickMaxElapsed = 20 * time.Second
	tickMinPeriod  = 5 * time.Second // anti-martèlement d'une même instance
)

// SetTickToken installe le jeton partagé attendu par POST /api/tick. Vide = endpoint
// refusé en déploiement (voir authorizeTick).
func (s *Server) SetTickToken(tok string) { s.tickToken = tok }

// authorizeTick valide le jeton du battement. Il est accepté en en-tête
// `Authorization: Bearer <jeton>` (convention des crons Vercel, qui envoient
// CRON_SECRET ainsi) ou en paramètre `?token=` (les pingers gratuits ne savent
// souvent poser que l'URL).
func (s *Server) authorizeTick(r *http.Request) bool {
	if s.tickToken == "" {
		// Aucun jeton configuré : toléré en dev local (processus résident, endpoint
		// juste pratique), refusé en déploiement où il serait ouvert à tous.
		return !s.stateless
	}
	got := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if got == "" {
		got = r.URL.Query().Get("token")
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(s.tickToken)) == 1
}

// tickResult est le compte rendu d'un balayage (utile pour lire le cron dans les logs).
type tickResult struct {
	OK        bool             `json:"ok"`
	Games     []tickGameResult `json:"games"`
	Swept     int              `json:"swept"`     // parties examinées
	Advanced  int              `json:"advanced"`  // parties réellement avancées
	Conflicts int              `json:"conflicts"` // écritures abandonnées (joueur prioritaire)
	Pending   bool             `json:"pending"`   // du retard reste à rattraper
	ElapsedMs int64            `json:"elapsedMs"`
}

type tickGameResult struct {
	ID        string `json:"id"`
	Waves     int    `json:"waves,omitempty"`
	BotRounds int    `json:"botRounds,omitempty"`
	Forages   int    `json:"forages,omitempty"`
	Skipped   int    `json:"skipped,omitempty"`
	Pending   bool   `json:"pending,omitempty"`
	Conflict  bool   `json:"conflict,omitempty"`
}

// tickHandler fait avancer toutes les parties actives + l'entretien des salons.
func (s *Server) tickHandler(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeTick(r) {
		if s.tickToken == "" {
			writeErr(w, http.StatusServiceUnavailable, "battement non configuré (ECHOTERRA_TICK_TOKEN)")
			return
		}
		writeErr(w, http.StatusUnauthorized, "jeton de battement invalide")
		return
	}
	started := time.Now()

	// Un même déploiement peut être martelé (plusieurs pingers, retries) : le travail
	// serait de toute façon nul, mais pas les lectures en base.
	s.mu.Lock()
	if !s.lastTickAt.IsZero() && started.Sub(s.lastTickAt) < tickMinPeriod {
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, tickResult{OK: true, Games: []tickGameResult{}})
		return
	}
	s.lastTickAt = started
	s.mu.Unlock()

	res := s.sweep(started)
	res.ElapsedMs = time.Since(started).Milliseconds()
	writeJSON(w, http.StatusOK, res)
}

// sweep avance les parties actives les plus en retard, puis fait le ménage des salons.
func (s *Server) sweep(started time.Time) tickResult {
	out := tickResult{OK: true, Games: []tickGameResult{}}
	games, err := s.store.ActiveGames(tickMaxGames)
	if err != nil {
		log.Printf("battement: liste des parties: %v", err)
		out.OK = false
		return out
	}
	for _, gs := range games {
		if time.Since(started) > tickMaxElapsed {
			out.Pending = true // échéance atteinte : le battement suivant continuera
			break
		}
		out.Swept++
		if g := s.advanceOne(gs); g != nil {
			out.Games = append(out.Games, *g)
			if g.Conflict {
				out.Conflicts++
			} else if g.Waves > 0 || g.BotRounds > 0 || g.Forages > 0 || g.Skipped > 0 {
				out.Advanced++
			}
			if g.Pending {
				out.Pending = true
			}
		}
	}
	s.housekeeping()
	return out
}

// advanceOne rattrape UNE partie et la persiste sans jamais écraser une écriture
// concurrente (un joueur qui agit au même instant depuis une autre instance gagne :
// sa requête aura fait le même rattrapage de son côté). Renvoie nil si rien n'a bougé.
func (s *Server) advanceOne(gs *game.GameState) *tickGameResult {
	unlock := s.lockGame(gs.ID)
	defer unlock()

	if !s.stateless {
		// Mode résident : le cache est la référence que mutent les handlers — avancer
		// la copie relue en base la contournerait. Un seul processus + le verrou par
		// partie suffisent ici, la sauvegarde conditionnelle ne sert qu'au multi-instance.
		cached, err := s.load(gs.ID)
		if err != nil || cached == nil {
			return nil
		}
		res := cached.AdvanceTo(time.Now(), game.TickBudget)
		if !res.Changed {
			return nil
		}
		s.persist(cached)
		return &tickGameResult{ID: cached.ID, Waves: res.Waves, BotRounds: res.BotRounds, Forages: res.Forages, Skipped: res.SkippedWaves, Pending: !res.Done}
	}

	res := gs.AdvanceTo(time.Now(), game.TickBudget)
	if !res.Changed {
		return nil
	}
	gs.Recompute()
	out := &tickGameResult{ID: gs.ID, Waves: res.Waves, BotRounds: res.BotRounds, Forages: res.Forages, Skipped: res.SkippedWaves, Pending: !res.Done}
	if err := s.store.SaveIfUnchanged(gs); err != nil {
		out.Conflict = true
		if !errors.Is(err, store.ErrConflict) {
			log.Printf("battement: sauvegarde de %s: %v", gs.ID, err)
		}
	}
	return out
}
