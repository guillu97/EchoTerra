package game

import (
	"fmt"
	"time"
)

// --- Horloge de simulation --------------------------------------------------
//
// Echo Terra est un jeu ASYNCHRONE : la horde frappe et les joueurs-IA agissent que
// quelqu'un soit connecté ou non. Sur un hébergement sans processus résident (Vercel :
// les instances s'endorment, une goroutine de fond meurt avec elles), le seul état de
// vérité est la base — donc l'avancement du monde doit être une FONCTION DU TEMPS
// ÉCOULÉ, rejouable à n'importe quel moment par n'importe quelle instance.
//
// AdvanceTo est ce rejeu. Il déroule la période écoulée dans l'ORDRE CHRONOLOGIQUE en
// entrelaçant TROIS horloges — les vagues (NextWaveAt, toutes les WaveInterval), les
// rounds de bots (LastBotAt, toutes les BotCatchUpInterval) et les fouilles
// automatiques (Hero.ForageAt, toutes les ForageInterval, cf. forage.go) — pour que la
// partie retrouvée soit celle qui SE SERAIT déroulée, et pas un raccourci. Deux appelants :
//   - le battement (`POST /api/tick`, cron externe) : le monde tourne sans joueur ;
//   - toute requête touchant la partie (filet de sécurité si le battement a sauté).
//
// L'opération est donc convergente : la rejouer trop souvent ne fait rien de plus, et
// l'avoir manquée longtemps se rattrape.

// BotCatchUpInterval est la cadence d'un round de joueurs-IA : chaque bot joue une
// action par intervalle écoulé, pour que sa journée s'étale au lieu d'être brûlée d'un
// coup. (Vit ici plutôt que dans bots.go : c'est une horloge de simulation.)
const BotCatchUpInterval = time.Minute

// CatchUpMaxBacklog plafonne le RETARD réellement rejoué. Au-delà, la période
// excédentaire est sautée (et tracée dans le journal de la ville) au lieu d'être
// simulée : une partie oubliée trois jours représenterait des centaines de vagues,
// donc des dizaines de milliers de monstres — un état ingérable et un rattrapage
// interminable. Réglable par ECHOTERRA_CATCHUP_HOURS.
var CatchUpMaxBacklog = 12 * time.Hour

// SimBudget borne le travail d'UN appel. Le rattrapage restant n'est pas perdu : les
// horloges ne sont pas avancées au-delà de ce qui a été joué, donc l'appel suivant
// reprend exactement où celui-ci s'est arrêté (voir SimResult.Done).
type SimBudget struct {
	Waves     int // vagues résolues au maximum
	BotRounds int // rounds de bots joués au maximum
	Forages   int // fouilles automatiques jouées au maximum
}

// RequestBudget est le budget d'une requête de JEU : petit, car un joueur attend sa
// réponse. Le reste du retard sera absorbé par les requêtes/battements suivants.
var RequestBudget = SimBudget{Waves: 4, BotRounds: 6, Forages: 24}

// TickBudget est le budget du BATTEMENT (cron) : personne n'attend, on peut rattraper
// franchement. Le balayage complet reste borné par son échéance (voir api/tick.go).
var TickBudget = SimBudget{Waves: 24, BotRounds: 30, Forages: 200}

// SimResult décrit ce qu'un rattrapage a réellement joué.
type SimResult struct {
	Waves        int  // vagues résolues
	BotRounds    int  // rounds de joueurs-IA joués
	Forages      int  // fouilles automatiques jouées
	SkippedWaves int  // vagues sautées par le plafond de retard
	Changed      bool // l'état a changé → l'appelant doit persister
	Done         bool // l'horloge de la partie a rattrapé `now` (sinon : budget épuisé)
}

// AdvanceTo fait avancer la partie jusqu'à `now` en rejouant, dans l'ordre, les vagues
// et les rounds de bots dus depuis le dernier passage. Sûr à appeler à tout moment et
// depuis n'importe quelle instance ; l'appelant doit tenir le verrou de la partie.
func (g *GameState) AdvanceTo(now time.Time, b SimBudget) SimResult {
	res := SimResult{Done: true}
	if g == nil {
		return res
	}
	// L'HORLOGE DE LA SIMULATION. Un rattrapage rejoue des instants PASSÉS : ce qu'une
	// action y planifie (la fouille automatique) doit partir de l'instant rejoué, pas de
	// l'heure qu'il est. Sans cela un round de bots joué à T-3 h posait sa prochaine
	// récolte à « maintenant + un sixième de vague », donc trois heures trop tard.
	//
	// C'est aussi ce qui rendait la fouille automatique INVISIBLE à la simulation
	// d'équilibrage, dont l'horloge est synthétique : mesuré, ZÉRO récolte automatique
	// sur une partie entière — l'instrument mesurait un jeu amputé de son économie de
	// campement, et concluait que les bots ne récoltaient rien.
	defer func() { g.simNow = time.Time{} }()
	// Les combats en cours sont minutés en temps réel : un tour AFK se résout même si
	// rien d'autre n'est dû (et même en dehors du statut "active", par prudence).
	if g.EnforceCombatTimers(now) {
		res.Changed = true
	}
	if g.Status != StatusActive || g.NextWaveAt.IsZero() {
		return res
	}

	// Amorce : une partie qui n'a jamais eu de round de bots part de maintenant, sinon
	// le premier rattrapage rejouerait tout le temps écoulé depuis l'époque zéro.
	if g.LastBotAt.IsZero() {
		g.LastBotAt = now
		res.Changed = true
	}

	if skipped := g.trimBacklog(now); skipped > 0 {
		res.SkippedWaves = skipped
		res.Changed = true
	}

	hasBots := g.hasBotPlayers()
	if !hasBots && g.LastBotAt.Before(now) {
		g.LastBotAt = now // rien à jouer : l'horloge des bots suit le temps réel
	}

	for g.Status == StatusActive {
		waveDue := !now.Before(g.NextWaveAt)
		botAt := g.LastBotAt.Add(BotCatchUpInterval)
		botDue := hasBots && !now.Before(botAt)
		forager, forageAt := g.nextForage()
		forageDue := forager != nil && !now.Before(forageAt)
		if !waveDue && !botDue && !forageDue {
			break
		}
		// La fouille automatique passe en premier quand c'est elle la plus ancienne :
		// une récolte due AVANT une vague doit avoir eu lieu avant que la horde ne
		// blesse le héros (elle pourrait l'interrompre).
		if forageDue && (!waveDue || forageAt.Before(g.NextWaveAt)) && (!botDue || forageAt.Before(botAt)) {
			if res.Forages >= b.Forages {
				res.Done = false
				break
			}
			g.simNow = forageAt
			g.forageOnce(forager)
			res.Forages++
			res.Changed = true
			continue
		}
		// Ordre chronologique strict : l'événement le plus ancien d'abord. À égalité la
		// vague passe en premier (elle régénère les PA dont le round de bots profite).
		if waveDue && (!botDue || !g.NextWaveAt.After(botAt)) {
			if res.Waves >= b.Waves {
				res.Done = false
				break
			}
			at := g.NextWaveAt
			g.simNow = at
			g.ProcessWave(at)
			g.NextWaveAt = at.Add(WaveInterval)
			g.EnforceCombatTimers(at)
			res.Waves++
			res.Changed = true
			continue
		}
		if res.BotRounds >= b.BotRounds {
			res.Done = false
			break
		}
		g.LastBotAt = botAt
		g.simNow = botAt
		if g.BotAct(botAt) {
			res.Changed = true
		}
		g.EnforceCombatTimers(botAt)
		res.BotRounds++
	}

	if g.Status != StatusActive {
		res.Done = true // partie terminée : plus rien à rattraper
	}
	return res
}

// CatchUpPending dit si le monde doit ENCORE avancer : une vague est due et n'a pas
// été rejouée. Appelé APRÈS AdvanceTo, c'est exactement « le budget de cette requête
// n'a pas suffi, il reste du retard » — la seule chose que le client ait besoin de
// savoir pour redemander tout de suite au lieu d'attendre son sondage de 20 s.
//
// Dérivé de l'horloge, donc rien à mémoriser ni à invalider : si NextWaveAt est dans
// le passé alors que la partie tourne, c'est qu'une vague est due.
func (g *GameState) CatchUpPending(now time.Time) bool {
	if g == nil || g.Status != StatusActive || g.NextWaveAt.IsZero() {
		return false
	}
	return now.After(g.NextWaveAt)
}

// trimBacklog applique le plafond de retard : si la prochaine vague est due depuis
// plus de CatchUpMaxBacklog, les vagues antérieures à la fenêtre sont SAUTÉES (elles
// ne sont pas jouées) et l'oubli est tracé dans le journal de la ville. Renvoie le
// nombre de vagues sautées.
func (g *GameState) trimBacklog(now time.Time) int {
	if CatchUpMaxBacklog <= 0 || WaveInterval <= 0 {
		return 0
	}
	cutoff := now.Add(-CatchUpMaxBacklog)
	if g.LastBotAt.Before(cutoff) {
		g.LastBotAt = cutoff // les bots ne rattrapent jamais plus que la fenêtre
	}
	// Idem pour les fouilles automatiques : sans ça, une partie oubliée trois jours
	// déverserait des milliers d'objets dans les sacs d'un coup.
	for _, h := range g.Heroes {
		if h.Foraging() && h.ForageAt.Before(cutoff) {
			h.ForageAt = cutoff
		}
	}
	if !g.NextWaveAt.Before(cutoff) {
		return 0
	}
	skipped := int(cutoff.Sub(g.NextWaveAt)/WaveInterval) + 1
	g.NextWaveAt = g.NextWaveAt.Add(time.Duration(skipped) * WaveInterval)
	noun := "vagues passées"
	if skipped == 1 {
		noun = "vague passée"
	}
	g.logTown(fmt.Sprintf("%d %s sans personne — la horde a rôdé sans attaquer.", skipped, noun))
	return skipped
}

// hasBotPlayers reports whether any player of the game is an AI player.
func (g *GameState) hasBotPlayers() bool {
	for _, p := range g.Players {
		if p.Bot {
			return true
		}
	}
	return false
}
