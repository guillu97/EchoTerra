package game

import (
	"testing"
	"time"
)

func TestAddBotHostOnlyAndCountsForStart(t *testing.T) {
	g := grassLobby(2, 4)
	now := time.Now()
	host, _ := g.AddPlayer("Hôte", now)

	// Alone, the host cannot start (min 2)…
	if err := g.StartGame(host.ID, now); err == nil {
		t.Fatal("start below MinPlayers must fail")
	}
	// …a guest cannot add a bot…
	guestGame := grassLobby(2, 4)
	_, _ = guestGame.AddPlayer("H", now)
	gg, _ := guestGame.AddPlayer("G", now)
	if _, err := guestGame.AddBot(gg.ID, now); err == nil {
		t.Fatal("non-host must not add bots")
	}
	// …but a bot fills the seat and the game can launch.
	bot, err := g.AddBot(host.ID, now)
	if err != nil {
		t.Fatal(err)
	}
	if !bot.Bot || len(bot.HeroIDs) != HeroesPerPlayer {
		t.Fatalf("bot must be flagged and field %d heroes: %+v", HeroesPerPlayer, bot)
	}
	if err := g.StartGame(host.ID, now); err != nil {
		t.Fatalf("host+bot should satisfy minPlayers=2: %v", err)
	}
	// Ownership guards apply to bot heroes like anyone's.
	if err := g.CheckHeroOwnership(host.ID, bot.HeroIDs[0]); err == nil {
		t.Fatal("humans must not control bot heroes")
	}
}

// botGame builds a started game with one human and one bot on a grass world, with
// the launch-seeded monsters cleared so each test stages its own board.
func botGame(t *testing.T) (*GameState, *Player) {
	t.Helper()
	g := grassLobby(1, 4)
	now := time.Now()
	host, _ := g.AddPlayer("Humain", now)
	bot, err := g.AddBot(host.ID, now)
	if err != nil {
		t.Fatal(err)
	}
	if err := g.StartGame(host.ID, now); err != nil {
		t.Fatal(err)
	}
	for id, m := range g.Monsters {
		if tl := g.TileAt(m.X, m.Y); tl != nil {
			tl.MonsterID = ""
		}
		delete(g.Monsters, id)
	}
	return g, bot
}

// parkTeam moves every hero of the player onto (x,y) with the given PA, so tests can
// reason about ONE acting hero without the rest of the team interfering.
func parkTeam(g *GameState, p *Player, x, y, pa int) {
	for _, id := range p.HeroIDs {
		if h := g.HeroByID(id); h != nil {
			h.X, h.Y, h.PA = x, y, pa
		}
	}
}

func TestBotSearchesInTheField(t *testing.T) {
	g, bot := botGame(t)
	// Two steps from town: plenty of PA left, so the team gathers instead of retreating.
	parkTeam(g, bot, g.Town.X+2, g.Town.Y, 6)
	tile := g.TileAt(g.Town.X+2, g.Town.Y)
	tile.Resources = 9
	tile.MonsterID = ""
	if !g.BotAct() {
		t.Fatal("bot should act")
	}
	if tile.Resources != 6 { // the whole team of 3 searched once each
		t.Fatalf("each bot hero should search its tile once: res=%d", tile.Resources)
	}
	if h := g.HeroByID(bot.HeroIDs[0]); len(h.Inventory) == 0 {
		t.Fatal("searching should have yielded loot")
	}
}

func TestBotDepositsAndDrawsWaterInTown(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, g.Town.X, g.Town.Y, 2) // low PA so nobody heads back out
	h := g.HeroByID(bot.HeroIDs[0])
	h.AddLoot(Item{Type: "objet", Name: "Bois", Qty: 2})
	if !g.BotAct() {
		t.Fatal("bot should act")
	}
	if len(h.Inventory) != 0 || g.storageQty("Bois") != 2 {
		t.Fatalf("bot should deposit its loot into the Bank: inv=%d bank=%d", len(h.Inventory), g.storageQty("Bois"))
	}

	// Thirsty in town: next action is the daily ration.
	h.AddState(StateSoif)
	if !g.BotAct() {
		t.Fatal("bot should act on thirst")
	}
	if h.HasState(StateSoif) {
		t.Fatal("bot should have drawn water and cleared Soif")
	}
}

func TestBotHeadsHomeWhenPARunsOut(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, g.Town.X+3, g.Town.Y, 3) // 3 steps from town, exactly the walk home
	h := g.HeroByID(bot.HeroIDs[0])
	g.TileAt(h.X, h.Y).Resources = 5 // tempting, but time's up
	distBefore := absI(g.Town.X-h.X) + absI(g.Town.Y-h.Y)
	if !g.BotAct() {
		t.Fatal("bot should act")
	}
	distAfter := absI(g.Town.X-h.X) + absI(g.Town.Y-h.Y)
	if distAfter != distBefore-1 {
		t.Fatalf("bot should walk home when PA == distance, dist %d->%d", distBefore, distAfter)
	}
}

func TestBotHidesAtLastPA(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, g.Town.X+4, g.Town.Y, 1)
	h := g.HeroByID(bot.HeroIDs[0])
	if !g.BotAct() {
		t.Fatal("bot should act")
	}
	if !h.HasState(StateCache) {
		t.Fatal("with 1 PA far from town, the bot should hide before the wave")
	}
}

func TestBotFireballsAPackOnItsTile(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, 3, 3, 6)
	h := g.HeroByID(bot.HeroIDs[0])
	h.Stats.Precision = 30 // one cast wipes the pack
	m := NewMonster("Slime Vorace", 3, 3)
	m.Count = 1
	g.Monsters[m.ID] = m
	g.TileAt(3, 3).MonsterID = m.ID
	if !g.BotAct() {
		t.Fatal("bot should act")
	}
	if g.TileAt(3, 3).MonsterID != "" {
		t.Fatal("bot should have burned the pack on its tile")
	}
}

func TestHumansAreNeverBotDriven(t *testing.T) {
	g, _ := botGame(t)
	human := g.Players[0]
	parkTeam(g, human, 3, 3, 6)
	g.TileAt(3, 3).Resources = 3
	h := g.HeroByID(human.HeroIDs[0])
	pa := h.PA
	g.BotAct()
	if h.PA != pa {
		t.Fatal("BotAct must not spend a human hero's PA")
	}
}
