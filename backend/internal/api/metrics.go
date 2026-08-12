package api

// LES CHIFFRES (R3 de RETENTION-PLAN.md) — « tant que la rétention J3/J7 n'est pas
// suivie, tout le reste est une opinion ».
//
// Neuf propositions de rétention ont été livrées sans qu'aucune ait jamais été
// confrontée à une mesure. Ce fichier produit LE chiffre que le plan réclame depuis le
// début, et un seul : **de ceux qui ont commencé à jouer tel jour, combien sont revenus
// le lendemain, trois jours après, sept jours après ?**
//
// ⚠ CE QU'IL NE FAUT PAS EN ATTENDRE. La mesure porte sur les COMPTES (un anonyme n'a
// pas d'identité qui traverse les parties, cf. store/activity.go) et sur les jours
// CIVILS UTC. Elle sous-estime donc l'activité réelle, et c'est écrit dans la réponse
// (`scope`) pour qu'on ne l'oublie pas en lisant un joli tableau.
//
// ⚠ L'ENDPOINT EST FERMÉ. Il rend des agrégats, pas des personnes — mais des agrégats
// d'audience restent une information d'exploitation, pas un contenu de jeu. Même jeton
// que le battement (ECHOTERRA_TICK_TOKEN / CRON_SECRET), même règle : sans jeton
// configuré, toléré en dev local et refusé en déploiement.

import (
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"echoterra/internal/store"
)

// metricsWindow : la profondeur d'historique lue. Trois mois suffisent à voir une
// cohorte J7 vivre sa vie, et bornent la lecture.
const metricsWindow = 90 * 24 * time.Hour

// cohortOffsets : les rendez-vous qu'on mesure. J1 dit « est-il revenu demain », J3 « a
// -t-il tenu une expédition », J7 « est-il resté au-delà d'une partie » — une partie
// dure sept à neuf jours réels (§1 du plan), donc J7 est exactement la question de la
// boucle longue.
var cohortOffsets = []int{1, 3, 7}

// dayMetric : ce qui s'est passé un jour donné.
type dayMetric struct {
	Day       string `json:"day"`
	Actives   int    `json:"actives"`   // comptes ayant agi
	Newcomers int    `json:"newcomers"` // comptes dont c'est le PREMIER jour
	Actions   int    `json:"actions"`
}

// cohortMetric : une cohorte, c'est-à-dire les comptes qui ont joué pour la première
// fois ce jour-là, et ce qu'ils sont devenus.
type cohortMetric struct {
	Day  string `json:"day"`
	Size int    `json:"size"`
	// Returned[k] = combien sont revenus AU MOINS une fois entre J+1 et J+k inclus. On
	// mesure « revenu depuis », pas « revenu pile ce jour-là » : à deux sessions par
	// jour sur un jeu qui dure une semaine, exiger une présence à la date exacte
	// mesurerait surtout le hasard des emplois du temps.
	Returned map[string]int `json:"returned"`
	// Mature[k] : la cohorte est-elle assez ANCIENNE pour que J+k ait pu arriver ? Sans
	// ce drapeau, une cohorte d'hier afficherait 0 % à J7 et tirerait la moyenne vers le
	// bas — le zéro d'une chose qui n'a pas encore eu lieu.
	Mature map[string]bool `json:"mature"`
}

type metricsResult struct {
	Scope    string         `json:"scope"`
	From     string         `json:"from"`
	To       string         `json:"to"`
	Users    int            `json:"users"`
	Games    int            `json:"games"`
	Days     []dayMetric    `json:"days"`
	Cohorts  []cohortMetric `json:"cohorts"`
	Retained map[string]int `json:"retained"` // % par offset, sur les cohortes MATURES
}

// computeMetrics agrège les lignes brutes. Fonction PURE (elle prend `today` en
// paramètre) : c'est ce qui la rend testable, et c'est la même raison qui a fait
// introduire GameState.clock() côté jeu.
func computeMetrics(rows []store.ActivityRow, today time.Time) metricsResult {
	res := metricsResult{
		Scope:    "comptes connectés, jours civils UTC (les parties anonymes ne sont pas comptées)",
		Days:     []dayMetric{},
		Cohorts:  []cohortMetric{},
		Retained: map[string]int{},
	}
	if len(rows) == 0 {
		return res
	}
	// jour -> comptes actifs ; compte -> jours de présence
	perDay := map[string]map[string]int{}
	perUser := map[string]map[string]bool{}
	games := map[string]bool{}
	for _, a := range rows {
		if perDay[a.Day] == nil {
			perDay[a.Day] = map[string]int{}
		}
		perDay[a.Day][a.UserID] += a.Actions
		if perUser[a.UserID] == nil {
			perUser[a.UserID] = map[string]bool{}
		}
		perUser[a.UserID][a.Day] = true
		games[a.GameID] = true
	}
	res.Users, res.Games = len(perUser), len(games)

	// premier jour de chaque compte
	firstDay := map[string]string{}
	for user, days := range perUser {
		first := ""
		for d := range days {
			if first == "" || d < first {
				first = d
			}
		}
		firstDay[user] = first
	}

	days := make([]string, 0, len(perDay))
	for d := range perDay {
		days = append(days, d)
	}
	sort.Strings(days)
	res.From, res.To = days[0], days[len(days)-1]

	newcomers := map[string][]string{} // jour -> comptes dont c'est le premier jour
	for user, d := range firstDay {
		newcomers[d] = append(newcomers[d], user)
	}
	for _, d := range days {
		actions := 0
		for _, n := range perDay[d] {
			actions += n
		}
		res.Days = append(res.Days, dayMetric{
			Day: d, Actives: len(perDay[d]), Newcomers: len(newcomers[d]), Actions: actions,
		})
	}

	// cohortes : par jour de première venue
	cohortDays := make([]string, 0, len(newcomers))
	for d := range newcomers {
		cohortDays = append(cohortDays, d)
	}
	sort.Strings(cohortDays)
	sums := map[string][2]int{} // offset -> [revenus, taille] sur les cohortes mûres
	for _, d := range cohortDays {
		start, err := time.Parse(store.ActivityDayFormat, d)
		if err != nil {
			continue
		}
		c := cohortMetric{Day: d, Size: len(newcomers[d]), Returned: map[string]int{}, Mature: map[string]bool{}}
		for _, off := range cohortOffsets {
			key := "d" + strconv.Itoa(off)
			deadline := start.AddDate(0, 0, off)
			mature := !deadline.After(today.UTC())
			c.Mature[key] = mature
			back := 0
			for _, user := range newcomers[d] {
				for k := 1; k <= off; k++ {
					if perUser[user][start.AddDate(0, 0, k).Format(store.ActivityDayFormat)] {
						back++
						break
					}
				}
			}
			c.Returned[key] = back
			if mature {
				s := sums[key]
				sums[key] = [2]int{s[0] + back, s[1] + c.Size}
			}
		}
		res.Cohorts = append(res.Cohorts, c)
	}
	for key, s := range sums {
		if s[1] > 0 {
			res.Retained[key] = s[0] * 100 / s[1]
		}
	}
	return res
}

// metricsHandler sert les chiffres. Même porte que le battement (voir authorizeTick).
func (s *Server) metricsHandler(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeTick(r) {
		if s.tickToken == "" {
			writeErr(w, http.StatusServiceUnavailable, "mesures non configurées (ECHOTERRA_TICK_TOKEN)")
			return
		}
		writeErr(w, http.StatusUnauthorized, "jeton invalide")
		return
	}
	now := time.Now().UTC()
	rows, err := s.store.Activity(now.Add(-metricsWindow).Format(store.ActivityDayFormat))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, computeMetrics(rows, now))
}

// recordActivity note qu'un compte a agi sur une partie.
//
// ⚠ Middleware sur les seules requêtes MUTANTES d'une partie : un GET est un
// rafraîchissement, et le sondage de vingt secondes du client en produit tout seul —
// les compter ferait passer une page laissée ouverte pour un joueur actif.
// Best-effort : une erreur d'écriture ne doit jamais faire échouer une action de jeu.
func (s *Server) recordActivity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
		if r.Method != http.MethodPost {
			return
		}
		gameID := chi.URLParam(r, "gameID")
		if gameID == "" {
			return
		}
		if u := s.userFromReq(r); u != nil {
			_ = s.store.RecordActivity(u.ID, gameID, time.Now())
		}
	})
}
