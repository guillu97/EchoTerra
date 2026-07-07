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

func TestBotFireballsAPackTooBigToEngage(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, 3, 3, 6)
	m := NewMonster("Slime Vorace", 3, 3)
	m.Count = 9 // 4 combat units vs 3 heroes: no engage — thin it with Fire ball
	g.Monsters[m.ID] = m
	g.TileAt(3, 3).MonsterID = m.ID
	if !g.BotAct() {
		t.Fatal("bot should act")
	}
	if len(g.Combats) != 0 {
		t.Fatal("no combat should be opened against an oversized pack")
	}
	if m.Count == 9 && m.HP == m.MaxHP {
		t.Fatal("the pack should have been thinned by Fire ball")
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

func TestBotEngagesAndAutoResolvesCombat(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, 3, 3, 6)
	for _, id := range bot.HeroIDs { // stack the odds so the win is deterministic
		hh := g.HeroByID(id)
		hh.Stats.Force = 20
		hh.HP, hh.MaxHP = 60, 60
	}
	m := NewMonster("Slime Vorace", 3, 3)
	m.Count = 2 // 2 units vs a 3-hero party -> engage
	g.Monsters[m.ID] = m
	g.TileAt(3, 3).MonsterID = m.ID

	if !g.BotAct() {
		t.Fatal("bot should act")
	}
	if g.ActiveCombat != "" {
		t.Fatal("the auto-resolved combat must not stay open")
	}
	if g.TileAt(3, 3).MonsterID != "" {
		t.Fatal("the pack should be defeated and removed from the map")
	}
	won := false
	for _, c := range g.Combats {
		if c.Status == "won" {
			won = true
		}
	}
	if !won {
		t.Fatal("a won combat should be recorded")
	}
}

func TestBotDoesNotEngageOutnumberedNorWithHumans(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, 3, 3, 6)
	m := NewMonster("Slime Vorace", 3, 3)
	m.Count = 9 // 4 combat units vs 3 heroes -> too risky, fireball instead
	g.Monsters[m.ID] = m
	g.TileAt(3, 3).MonsterID = m.ID
	g.BotAct()
	if len(g.Combats) != 0 {
		t.Fatal("an outnumbered bot party must not open a combat")
	}

	// A human standing on the tile also vetoes bot-initiated combat.
	g2, bot2 := botGame(t)
	parkTeam(g2, bot2, 3, 3, 6)
	human := g2.Players[0]
	parkTeam(g2, human, 3, 3, 6)
	m2 := NewMonster("Slime Vorace", 3, 3)
	m2.Count = 1
	g2.Monsters[m2.ID] = m2
	g2.TileAt(3, 3).MonsterID = m2.ID
	g2.BotAct()
	if len(g2.Combats) != 0 {
		t.Fatal("bots must never drag a human hero into an auto-resolved combat")
	}
}

func TestBotEvolvesAtDayGates(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, g.Town.X, g.Town.Y, 2)
	g.Day = EvolveDayIntermediate
	if !g.BotAct() {
		t.Fatal("bots should evolve when the gate opens")
	}
	for _, id := range bot.HeroIDs {
		if h := g.HeroByID(id); h.ClassTier != 1 || h.ClassID == "" {
			t.Fatalf("hero %s should have an intermediate class, got tier %d %q", h.Name, h.ClassTier, h.ClassID)
		}
	}
	g.Day = EvolveDayAdvanced
	if !g.BotAct() {
		t.Fatal("bots should evolve to advanced when the gate opens")
	}
	for _, id := range bot.HeroIDs {
		if h := g.HeroByID(id); h.ClassTier != 2 {
			t.Fatalf("hero %s should have an advanced class, got tier %d %q", h.Name, h.ClassTier, h.ClassID)
		}
	}
}
