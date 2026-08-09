package game

import (
	"testing"
	"time"
)

// UNE PARTIE APPARTIENT À LA SAISON OÙ ELLE A COMMENCÉ.
//
// C'est LA décision de conception des saisons. Une expédition dure une dizaine de jours
// réels : la faire changer de saison en cours de route la ferait disparaître du tableau
// qu'elle disputait, exactement au moment où elle y monte. Et c'est aussi ce qui rend la
// valeur STABLE — StartedAt ne bouge plus une fois posé, donc chaque réécriture de la
// ligne de classement (à chaque vague, à chaque battement) recalcule la même saison.
func TestAGameStaysInTheSeasonItStartedIn(t *testing.T) {
	g := &GameState{}
	g.CreatedAt = time.Date(2026, 7, 28, 20, 0, 0, 0, time.UTC)
	g.StartedAt = time.Date(2026, 7, 31, 23, 0, 0, 0, time.UTC) // lancée fin juillet
	if got := g.Season(); got != "2026-07" {
		t.Fatalf("saison du LANCEMENT attendue, obtenu %q", got)
	}
	// Elle vit jusqu'en août : elle reste une expédition de juillet.
	g.Day, g.WaveNumber = 12, 24
	if got := g.Season(); got != "2026-07" {
		t.Fatalf("la saison ne doit pas suivre le calendrier : %q", got)
	}
}

// Une partie d'avant le lancement horodaté se rattache à sa création — la meilleure
// approximation disponible — et une partie sans aucune date n'a pas de saison plutôt
// qu'une fausse.
func TestASeasonlessGameIsNotGivenAFakeOne(t *testing.T) {
	legacy := &GameState{}
	legacy.CreatedAt = time.Date(2026, 3, 4, 12, 0, 0, 0, time.UTC)
	if got := legacy.Season(); got != "2026-03" {
		t.Fatalf("repli sur la création attendu, obtenu %q", got)
	}
	if got := (&GameState{}).Season(); got != "" {
		t.Fatalf("sans date, pas de saison inventée : %q", got)
	}
}

func TestSeasonLabelsReadLikeFrench(t *testing.T) {
	cases := map[string]string{
		"2026-08":   "Saison d'août 2026",
		"2026-04":   "Saison d'avril 2026",
		"2026-10":   "Saison d'octobre 2026",
		"2026-01":   "Saison de janvier 2026",
		"2026-12":   "Saison de décembre 2026",
		SeasonAll:   "Toutes les saisons",
		"":          "Hors saison",
		"n'importe": "Hors saison",
	}
	for id, want := range cases {
		if got := SeasonLabel(id); got != want {
			t.Errorf("SeasonLabel(%q) = %q, attendu %q", id, got, want)
		}
	}
	// Un mois hors bornes ne doit pas indexer le tableau des mois.
	if got := SeasonLabel("2026-13"); got != "Hors saison" {
		t.Errorf("mois invalide : %q", got)
	}
}

func TestSeasonBoundariesAreMonths(t *testing.T) {
	last := time.Date(2026, 8, 31, 23, 59, 59, 0, time.UTC)
	next := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	if SeasonFor(last) != "2026-08" || SeasonFor(next) != "2026-09" {
		t.Fatalf("frontière de mois mal placée : %q puis %q", SeasonFor(last), SeasonFor(next))
	}
	// Un identifiant se trie comme une date : c'est ce dont dépend « la plus récente
	// d'abord » côté base (ORDER BY season DESC), sans conversion.
	if !(SeasonFor(last) < SeasonFor(next)) {
		t.Fatal("les identifiants de saison doivent se trier chronologiquement")
	}
}
