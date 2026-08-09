package game

import (
	"testing"
	"time"
)

// publicLobby stages an open PUBLIC expedition on a small grass world.
func publicLobby(minPlayers, maxPlayers int) *GameState {
	g := grassLobby(minPlayers, maxPlayers)
	g.Visibility = VisibilityPublic
	return g
}

// Une expédition publique démarre dès MinPlayers atteint ET garde ses portes ouvertes
// pendant la fenêtre d'accueil : sur un jeu qui se joue en plusieurs jours réels, exiger
// d'être présent à la minute du lancement réserverait le multijoueur aux gens là au bon
// moment.
func TestPublicGameKeepsAcceptingPlayersAfterLaunch(t *testing.T) {
	g := publicLobby(2, 8)
	now := time.Now()
	if _, err := g.AddPlayer("Ana", now); err != nil {
		t.Fatal(err)
	}
	if _, err := g.AddPlayer("Bo", now); err != nil {
		t.Fatal(err)
	}
	if !g.MaybeAutoStart(now) {
		t.Fatal("a public lobby must launch on its own once MinPlayers is reached")
	}
	if g.Status != StatusActive {
		t.Fatalf("status = %q, want active", g.Status)
	}
	if !g.JoinOpen() {
		t.Fatal("a freshly launched public expedition must still accept newcomers")
	}

	wellBefore := g.buildingByID("well").Capacity
	late, err := g.AddPlayer("Zoé", now)
	if err != nil {
		t.Fatalf("a latecomer must be able to board during the window: %v", err)
	}
	if len(late.HeroIDs) != HeroesPerPlayer {
		t.Fatalf("a latecomer fields %d heroes, got %d", HeroesPerPlayer, len(late.HeroIDs))
	}
	for _, id := range late.HeroIDs {
		h := g.HeroByID(id)
		if h == nil || h.X != g.Town.X || h.Y != g.Town.Y {
			t.Fatal("a latecomer's heroes must spawn in town")
		}
	}
	// La ville doit pouvoir l'accueillir : sans complément d'eau, accepter du monde se
	// paierait en soif pour ceux qui étaient déjà là.
	if got, want := g.buildingByID("well").Capacity, wellBefore+WellRationsPerHero*HeroesPerPlayer; got != want {
		t.Fatalf("well rations = %d, want %d (a newcomer brings their own share)", got, want)
	}
}

// …mais elles se ferment. Passé la fenêtre, l'expédition est partie sans les retardataires.
func TestPublicJoinWindowCloses(t *testing.T) {
	g := publicLobby(1, 8)
	now := time.Now()
	if _, err := g.AddPlayer("Ana", now); err != nil {
		t.Fatal(err)
	}
	g.MaybeAutoStart(now)

	// Une vague avant la fermeture : on embarque encore.
	for g.WaveNumber < PublicJoinGraceWaves-1 {
		g.ForceWave(now)
	}
	if !g.JoinOpen() {
		t.Fatalf("wave %d is still inside the window (%d)", g.WaveNumber, PublicJoinGraceWaves)
	}
	if _, err := g.AddPlayer("Bo", now); err != nil {
		t.Fatalf("still inside the window: %v", err)
	}

	g.ForceWave(now) // la fenêtre se referme
	if g.JoinOpen() {
		t.Fatalf("wave %d must be past the window (%d)", g.WaveNumber, PublicJoinGraceWaves)
	}
	if _, err := g.AddPlayer("Tard", now); err == nil {
		t.Fatal("joining after the window must be refused")
	}
}

// Une partie PRIVÉE se ferme à son lancement : son hôte choisit qui entre, et il la
// lance délibérément — il n'y a personne à attendre.
func TestPrivateGameClosesAtLaunch(t *testing.T) {
	g := grassLobby(1, 8)
	now := time.Now()
	host, _ := g.AddPlayer("Hôte", now)
	if err := g.StartGame(host.ID, now); err != nil {
		t.Fatal(err)
	}
	if g.JoinOpen() {
		t.Fatal("a launched private game must not accept newcomers")
	}
	if _, err := g.AddPlayer("Intrus", now); err == nil {
		t.Fatal("joining a launched private game must be refused")
	}
}

// Complète reste complète : la fenêtre ouvre les portes, elle n'agrandit pas la ville.
func TestFullPublicGameRefusesEvenInsideTheWindow(t *testing.T) {
	g := publicLobby(2, 2)
	now := time.Now()
	if _, err := g.AddPlayer("Ana", now); err != nil {
		t.Fatal(err)
	}
	if _, err := g.AddPlayer("Bo", now); err != nil {
		t.Fatal(err)
	}
	g.MaybeAutoStart(now)
	if g.JoinOpen() {
		t.Fatal("a full expedition is not joinable, window or not")
	}
	if _, err := g.AddPlayer("Trop", now); err == nil {
		t.Fatal("joining a full game must be refused")
	}
}
