package game

import (
	"strings"
	"testing"
	"time"
)

// newSimGame builds a launched game with one human player (and optionally bots),
// its clocks set as if it had just started at `start`.
func newSimGame(t *testing.T, start time.Time, bots int) *GameState {
	t.Helper()
	g := newTestLobby(1, 8)
	host, err := g.AddPlayer("Guillaume", start)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < bots; i++ {
		if _, err := g.AddBot(host.ID, start); err != nil {
			t.Fatal(err)
		}
	}
	g.launch(start)
	return g
}

// Une partie laissée sans requête doit rattraper TOUTES ses vagues dues, à leur heure
// prévue — c'est ce qui fait avancer le monde sur un hébergement qui s'endort.
func TestAdvanceToReplaysEveryDueWave(t *testing.T) {
	start := time.Now().Add(-time.Hour)
	g := newSimGame(t, start, 0)
	firstWave := g.NextWaveAt

	// 3,5 intervalles après la première vague : quatre vagues sont dues (celle de
	// départ + trois), la cinquième ne l'est pas.
	now := firstWave.Add(WaveInterval*3 + WaveInterval/2)
	res := g.AdvanceTo(now, SimBudget{Waves: 10, BotRounds: 10})

	if res.Waves != 4 || !res.Changed || !res.Done {
		t.Fatalf("attendu 4 vagues rattrapées et terminé, got %+v", res)
	}
	if g.WaveNumber != 4 {
		t.Fatalf("WaveNumber = %d, attendu 4", g.WaveNumber)
	}
	// L'horloge reste alignée sur le CALENDRIER d'origine (pas de dérive : sinon
	// chaque absence repousserait la vague suivante d'un intervalle plein).
	if want := firstWave.Add(4 * WaveInterval); !g.NextWaveAt.Equal(want) {
		t.Fatalf("NextWaveAt = %v, attendu %v (calendrier d'origine)", g.NextWaveAt, want)
	}
	// Rappelé aussitôt, le rattrapage ne doit RIEN rejouer (opération convergente).
	if res := g.AdvanceTo(now, SimBudget{Waves: 10, BotRounds: 10}); res.Waves != 0 {
		t.Fatalf("second passage: %+v (doit être un no-op)", res)
	}
}

// Les joueurs-IA doivent jouer pendant l'absence, à leur cadence, et entrelacés avec
// les vagues — pas rejoués en bloc après coup.
func TestAdvanceToRunsBotRoundsAtTheirPace(t *testing.T) {
	start := time.Now().Add(-time.Hour)
	g := newSimGame(t, start, 1)

	now := start.Add(5 * BotCatchUpInterval)
	res := g.AdvanceTo(now, SimBudget{Waves: 10, BotRounds: 10})
	if res.BotRounds != 5 {
		t.Fatalf("BotRounds = %d, attendu 5 (un par %v écoulée)", res.BotRounds, BotCatchUpInterval)
	}
	if !g.LastBotAt.Equal(now) {
		t.Fatalf("LastBotAt = %v, attendu %v", g.LastBotAt, now)
	}
	// Sans bots dans la partie, l'horloge suit le temps réel sans brûler de budget.
	solo := newSimGame(t, start, 0)
	res = solo.AdvanceTo(now, SimBudget{Waves: 10, BotRounds: 10})
	if res.BotRounds != 0 || !solo.LastBotAt.Equal(now) {
		t.Fatalf("sans bot: rounds=%d lastBotAt=%v", res.BotRounds, solo.LastBotAt)
	}
}

// Budget épuisé = rattrapage SUSPENDU, pas perdu : l'appel suivant reprend où le
// précédent s'est arrêté (c'est ce qui permet à une requête de joueur de rester
// rapide sans que la partie perde des vagues).
func TestAdvanceToResumesAfterBudget(t *testing.T) {
	start := time.Now().Add(-time.Hour)
	g := newSimGame(t, start, 0)
	now := g.NextWaveAt.Add(WaveInterval * 3)

	res := g.AdvanceTo(now, SimBudget{Waves: 2})
	if res.Waves != 2 || res.Done {
		t.Fatalf("premier passage: %+v (attendu 2 vagues, non terminé)", res)
	}
	res = g.AdvanceTo(now, SimBudget{Waves: 10})
	if !res.Done || g.WaveNumber != 4 {
		t.Fatalf("second passage: %+v waveNumber=%d (attendu 4 vagues au total)", res, g.WaveNumber)
	}
}

// Une partie oubliée très longtemps ne doit pas rejouer des centaines de vagues (état
// ingérable, rattrapage interminable) : au-delà du plafond, la période est sautée et
// tracée dans le journal de la ville.
func TestAdvanceToCapsTheBacklog(t *testing.T) {
	start := time.Now().Add(-72 * time.Hour)
	g := newSimGame(t, start, 0)
	now := time.Now()

	res := g.AdvanceTo(now, SimBudget{Waves: 1000, BotRounds: 1000})
	if res.SkippedWaves == 0 {
		t.Fatal("aucune vague sautée : le plafond de retard n'a pas joué")
	}
	// Seule la fenêtre autorisée est réellement jouée.
	if maxPlayed := int(CatchUpMaxBacklog/WaveInterval) + 2; res.Waves > maxPlayed {
		t.Fatalf("%d vagues rejouées, plafond attendu ~%d", res.Waves, maxPlayed)
	}
	// Fin du rattrapage : soit l'horloge a rejoint le présent, soit la ville est
	// tombée en cours de route — une ville laissée sans défenseur MEURT, c'est la
	// règle du jeu, pas un défaut du rattrapage.
	if !res.Done || (g.Status == StatusActive && g.NextWaveAt.Before(now)) {
		t.Fatalf("rattrapage inachevé: done=%v status=%s nextWaveAt=%v now=%v", res.Done, g.Status, g.NextWaveAt, now)
	}
	found := false
	for _, e := range g.Town.Log {
		if strings.Contains(e.Text, "sans personne") {
			found = true
		}
	}
	if !found {
		t.Fatalf("l'oubli doit être tracé dans le journal de la ville: %+v", g.Town.Log)
	}
}

// Un salon (partie non lancée) ne vieillit pas, quoi qu'il arrive.
func TestAdvanceToIgnoresLobbies(t *testing.T) {
	g := newTestLobby(2, 4)
	if _, err := g.AddPlayer("Guillaume", time.Now()); err != nil {
		t.Fatal(err)
	}
	g.NextWaveAt = time.Now().Add(-48 * time.Hour)
	if res := g.AdvanceTo(time.Now(), SimBudget{Waves: 100, BotRounds: 100}); res.Waves != 0 || res.Changed {
		t.Fatalf("un salon ne doit jamais avancer: %+v", res)
	}
	if g.WaveNumber != 0 || g.Town.HP != 100 {
		t.Fatalf("salon touché: wave=%d hp=%d", g.WaveNumber, g.Town.HP)
	}
}
