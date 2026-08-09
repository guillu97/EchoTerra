package game

// LES SAISONS (P8 de RETENTION-PLAN.md) — pourquoi un classement doit se remettre à zéro.
//
// Le trou qu'elles bouchent : un classement cumulatif SE FIGE. Au bout de quelques mois
// les dix premières lignes sont tenues par des expéditions qu'on ne reverra pas, et un
// joueur qui arrive n'a plus rien à viser — le tableau lui dit seulement qu'il est arrivé
// trop tard. Découpé en saisons, il redevient atteignable à chaque période, sans qu'on
// perde quoi que ce soit : les anciennes saisons restent consultables, et la chronique de
// compte (chronicle.go), elle, ne se réinitialise JAMAIS. Une remise à zéro qui effacerait
// le souvenir serait une punition, pas un renouveau.
//
// ⚠ UNE PARTIE APPARTIENT À LA SAISON OÙ ELLE A COMMENCÉ, pas à celle où elle finit. Une
// expédition dure une dizaine de jours réels (2 vagues/jour) : la faire changer de saison
// en cours de route la ferait disparaître du tableau qu'elle disputait, au moment précis
// où elle y monte. C'est aussi ce qui rend la valeur STABLE — StartedAt ne bouge plus une
// fois posé, donc chaque réécriture de la ligne de classement recalcule la même saison.
//
// ⚠ AUCUNE PUISSANCE NE TRAVERSE UNE SAISON, comme rien ne traverse une partie (cf. les
// mémoriaux et les titres) : une saison change ce qu'on VISE, jamais ce qu'on a.

import (
	"fmt"
	"time"
)

// SeasonAll est le pseudo-identifiant « toutes saisons confondues ».
const SeasonAll = "all"

// SeasonFor rend l'identifiant de saison d'un instant. Une saison = un MOIS civil.
//
// Pourquoi le mois : une expédition dure une dizaine de jours à la cadence visée, donc un
// mois en contient deux ou trois — assez pour qu'une saison raconte quelque chose, assez
// court pour que le tableau ne se fige pas. Et c'est une frontière que tout le monde lit
// sans explication, ce qui vaut mieux qu'un compteur de semaines depuis une époque
// arbitraire que personne ne peut situer.
func SeasonFor(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	u := t.UTC()
	return fmt.Sprintf("%04d-%02d", u.Year(), int(u.Month()))
}

// CurrentSeason est la saison en cours.
func CurrentSeason() string { return SeasonFor(time.Now()) }

// Season rend la saison d'une partie : celle de son LANCEMENT. Un salon jamais lancé n'a
// pas de saison — il n'a rien disputé.
func (g *GameState) Season() string {
	if !g.StartedAt.IsZero() {
		return SeasonFor(g.StartedAt)
	}
	// Parties d'avant le lancement horodaté : on se rabat sur la création, qui est la
	// meilleure approximation disponible. Vide plutôt que faux si les deux manquent.
	return SeasonFor(g.CreatedAt)
}

var seasonMonths = [...]string{"janvier", "février", "mars", "avril", "mai", "juin",
	"juillet", "août", "septembre", "octobre", "novembre", "décembre"}

// SeasonLabel rend une saison en clair (« Saison d'août 2026 »). Les identifiants sont
// faits pour les URL et le tri ; les joueurs lisent ceci.
func SeasonLabel(season string) string {
	if season == SeasonAll {
		return "Toutes les saisons"
	}
	var y, m int
	if _, err := fmt.Sscanf(season, "%d-%d", &y, &m); err != nil || m < 1 || m > 12 {
		return "Hors saison"
	}
	name := seasonMonths[m-1]
	if name == "août" || name == "avril" || name == "octobre" {
		return fmt.Sprintf("Saison d'%s %d", name, y)
	}
	return fmt.Sprintf("Saison de %s %d", name, y)
}
