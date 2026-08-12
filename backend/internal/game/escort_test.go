package game

import (
	"testing"
	"time"
)

// L'ESCORTE DE DÉPART (lobby.go, R4 de RETENTION-PLAN.md) — pour qu'un premier contact
// avec le jeu ne soit jamais une salle d'attente.

// waitingLobby : un salon public où `humans` joueurs patientent depuis `waited`.
// Réutilise l'échafaudage de joinwindow_test.go — un second, parallèle, finirait par
// diverger de celui-là.
func waitingLobby(t *testing.T, humans int, waited time.Duration, now time.Time) *GameState {
	t.Helper()
	g := publicLobby(2, 20)
	g.CreatedAt = now.Add(-waited)
	for i := 0; i < humans; i++ {
		if _, err := g.AddPlayer("Humain", now.Add(-waited)); err != nil {
			t.Fatalf("ajout du joueur : %v", err)
		}
	}
	return g
}

func TestAWaitingPlayerLeavesWithAnEscort(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	g := waitingLobby(t, 1, PublicEscortWait+time.Second, now)

	if !g.MaybeStartWithEscort(now) {
		t.Fatal("après l'attente, l'expédition doit partir")
	}
	if g.Status != StatusActive {
		t.Errorf("statut %q, attendu active", g.Status)
	}
	if len(g.Players) != g.MinPlayers {
		t.Errorf("%d joueurs, attendu %d (le MINIMUM, pas le maximum)", len(g.Players), g.MinPlayers)
	}
	bots := 0
	for _, p := range g.Players {
		if p.Bot {
			bots++
		}
	}
	if bots != 1 {
		t.Errorf("%d bots d'escorte, attendu 1", bots)
	}
	// …et chaque joueur, robot compris, a bien son équipe de héros.
	if len(g.Heroes) != len(g.Players)*HeroesPerPlayer {
		t.Errorf("%d héros pour %d joueurs", len(g.Heroes), len(g.Players))
	}
	// L'expédition reste OUVERTE : c'est tout l'intérêt — les humains qui arrivent
	// ensuite trouvent une ville qui vit, pas un salon vide.
	if !g.JoinOpen() {
		t.Error("une expédition d'escorte doit rester rejoignable pendant sa fenêtre")
	}
}

// ⚠ BORNE 3 : on attend VRAIMENT. Deux humains à une minute d'intervalle doivent partir
// ensemble — l'escorte est un filet pour le joueur seul, pas un raccourci qui
// empêcherait les rencontres.
func TestTheEscortLetsARealMeetingHappen(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	g := waitingLobby(t, 1, PublicEscortWait/2, now)
	if g.MaybeStartWithEscort(now) {
		t.Fatal("avant le délai, on attend encore")
	}
	if g.Status != StatusLobby {
		t.Fatalf("le salon ne doit pas avoir démarré : %q", g.Status)
	}
	// Un deuxième humain arrive : c'est le départ ORDINAIRE qui prend la main, sans un
	// seul robot.
	if _, err := g.AddPlayer("Deuxième", now); err != nil {
		t.Fatal(err)
	}
	if !g.MaybeAutoStart(now) {
		t.Fatal("deux humains = départ ordinaire")
	}
	for _, p := range g.Players {
		if p.Bot {
			t.Error("aucun robot ne doit s'inviter quand des humains se sont trouvés")
		}
	}
}

// ⚠ BORNE 1 : jamais sans un humain. Sinon le battement fabriquerait des expéditions
// fantômes en boucle sur un serveur au repos.
func TestNoGhostExpeditionWithoutAHuman(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	g := waitingLobby(t, 0, 10*PublicEscortWait, now)
	if g.MaybeStartWithEscort(now) {
		t.Fatal("un salon vide ne part JAMAIS, quelle que soit l'attente")
	}
	if len(g.Players) != 0 {
		t.Errorf("%d joueurs créés dans un salon vide", len(g.Players))
	}
}

// ⚠ BORNE 2 : jusqu'au minimum, jamais jusqu'au maximum — les places restent pour des
// gens. Une expédition de vingt ne se remplit pas de robots.
func TestTheEscortFillsToTheMinimumOnly(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	g := waitingLobby(t, 1, PublicEscortWait+time.Second, now)
	g.MinPlayers, g.MaxPlayers = 4, 20
	if !g.MaybeStartWithEscort(now) {
		t.Fatal("l'expédition doit partir")
	}
	if len(g.Players) != 4 {
		t.Errorf("%d joueurs, attendu 4 (le minimum du salon)", len(g.Players))
	}
}

// Un JOUEUR ne peut toujours pas bourrer un salon public de robots : l'escorte est une
// décision du SERVEUR, et AddBot garde son refus.
func TestAPlayerStillCannotAddBotsToAPublicLobby(t *testing.T) {
	now := time.Now()
	g := waitingLobby(t, 1, 0, now)
	host := g.Players[0]
	if _, err := g.AddBot(host.ID, now); err == nil {
		t.Error("AddBot doit refuser sur une partie publique")
	}
}
