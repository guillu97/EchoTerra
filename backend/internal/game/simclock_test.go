package game

import (
	"testing"
	"time"
)

// L'HORLOGE DU MONDE — une échéance posée pendant un rattrapage part de l'instant
// REJOUÉ, jamais de l'heure qu'il est.
//
// Ce que ce test protège : la fouille automatique (forage.go) est planifiée par
// SearchTile. Tant qu'elle partait de time.Now(), un round de bots rejoué à T-3 h posait
// sa récolte suivante trois heures trop tard — et la simulation d'équilibrage, dont
// l'horloge est synthétique, ne la voyait JAMAIS se déclencher : mesuré, zéro récolte
// automatique sur une partie entière. L'instrument mesurait un jeu amputé de toute son
// économie de campement et en concluait que les bots ne récoltaient rien.
func TestForagingIsScheduledOnTheReplayedInstantNotTheWallClock(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	h := g.HeroByID(ana.HeroIDs[0])
	if err := g.MoveHero(h.ID, 1, 0); err != nil {
		t.Fatal(err)
	}
	g.TileAt(h.X, h.Y).Resources = 10

	// Un instant REJOUÉ, franchement dans le passé.
	past := time.Now().Add(-6 * time.Hour)
	g.simNow = past
	if _, err := g.SearchTile(h.ID); err != nil {
		t.Fatal(err)
	}
	g.simNow = time.Time{}

	want := past.Add(ForageInterval())
	if !h.ForageAt.Equal(want) {
		t.Fatalf("la récolte suivante doit partir de l'instant rejoué : %s (attendu %s)", h.ForageAt, want)
	}
	// …et elle est donc DUE dès qu'on rattrape le temps, au lieu d'être repoussée.
	if forager, at := g.nextForage(); forager == nil || at.After(time.Now()) {
		t.Fatal("une récolte posée dans le passé doit être due immédiatement")
	}
}

// Hors rattrapage l'horloge est l'heure réelle : rien ne change pour une requête HTTP.
func TestClockFallsBackToWallClockOutsideACatchUp(t *testing.T) {
	g, _, _ := twoPlayerTown(t)
	if d := time.Since(g.clock()); d < 0 || d > time.Minute {
		t.Fatalf("hors rattrapage l'horloge doit être l'heure réelle, écart %s", d)
	}
	// AdvanceTo doit TOUJOURS relâcher l'horloge, sinon une action jouée juste après
	// (même processus, partie en cache) daterait de la dernière vague rejouée.
	g.AdvanceTo(time.Now(), RequestBudget)
	if !g.simNow.IsZero() {
		t.Fatal("AdvanceTo doit remettre l'horloge de simulation à zéro en sortant")
	}
}

// La fouille automatique tourne réellement quand on rejoue le temps — c'est ce qui rend
// le campement (poster un héros et revenir plus tard) payant.
func TestACampedHeroKeepsHarvestingAcrossACatchUp(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	h := g.HeroByID(ana.HeroIDs[0])
	if err := g.MoveHero(h.ID, 1, 0); err != nil {
		t.Fatal(err)
	}
	g.TileAt(h.X, h.Y).Resources = 50
	if _, err := g.SearchTile(h.ID); err != nil {
		t.Fatal(err)
	}
	before := 0
	for _, it := range h.Inventory {
		before += it.Qty
	}
	res := g.AdvanceTo(time.Now().Add(3*ForageInterval()), SimBudget{Waves: 0, BotRounds: 0, Forages: 8})
	if res.Forages == 0 {
		t.Fatal("aucune récolte automatique jouée par le rattrapage")
	}
	after := 0
	for _, it := range h.Inventory {
		after += it.Qty
	}
	if after <= before {
		t.Fatalf("le sac doit s'être rempli tout seul : %d -> %d", before, after)
	}
}
