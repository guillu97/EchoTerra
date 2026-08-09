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
	if !g.BotAct(time.Now()) {
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
	// Un butin qu'AUCUNE recette ne consomme : avec du Bois, un coéquipier bâtisseur le
	// transforme en Planche dans le même tour (botCraft) et l'assertion sur la Banque
	// mesurerait le craft plutôt que le dépôt.
	h.AddLoot(Item{Type: "animal", Name: "Trophée de monstre", Qty: 2})
	if !g.BotAct(time.Now()) {
		t.Fatal("bot should act")
	}
	if len(h.Inventory) != 0 || g.storageQty("Trophée de monstre") != 2 {
		t.Fatalf("bot should deposit its loot into the Bank: inv=%d bank=%d",
			len(h.Inventory), g.storageQty("Trophée de monstre"))
	}

	// Thirsty in town: next action is the daily ration.
	h.AddState(StateSoif)
	if !g.BotAct(time.Now()) {
		t.Fatal("bot should act on thirst")
	}
	if h.HasState(StateSoif) {
		t.Fatal("bot should have drawn water and cleared Soif")
	}
}

// Un sac PLEIN ramène le héros à la ville — c'est la seule raison de rentrer avec la
// fouille automatique : le butin ne vaut rien tant qu'il n'est pas en Banque. Manquer
// de PA, lui, n'est PAS une raison (le héros posté continue de récolter tout seul).
func TestBotHaulsFullBagHome(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, g.Town.X+3, g.Town.Y, 3)
	h := g.HeroByID(bot.HeroIDs[0])
	h.Inventory = []Item{{Type: "objet", Name: "Bois", Qty: botHaulSize}}
	distBefore := absI(g.Town.X-h.X) + absI(g.Town.Y-h.Y)
	if !g.BotAct(time.Now()) {
		t.Fatal("bot should act")
	}
	if distAfter := absI(g.Town.X-h.X) + absI(g.Town.Y-h.Y); distAfter != distBefore-1 {
		t.Fatalf("a loaded bot must walk its haul home, dist %d->%d", distBefore, distAfter)
	}
}

// Le DERNIER PA d'un héros dehors est son PA de dissimulation : il ne sert à rien
// d'autre. Sans cette réserve les récolteurs mouraient tous avant la vague 9 (voir
// bots.go) — mais il n'est dépensé qu'au couvre-feu, pour récolter jusqu'au bout.
func TestBotKeepsLastPAForHiding(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, g.Town.X+4, g.Town.Y, 1)
	h := g.HeroByID(bot.HeroIDs[0])
	g.TileAt(h.X, h.Y).Resources = 5 // tempting: without the reserve it would search

	// Loin de la vague : le point est GARDÉ, pas brûlé.
	g.NextWaveAt = time.Now().Add(WaveInterval)
	g.BotAct(time.Now())
	if h.PA != 1 || h.HasState(StateCache) {
		t.Fatalf("hors couvre-feu le dernier PA doit être gardé intact, PA=%d caché=%v", h.PA, h.HasState(StateCache))
	}
	// La horde arrive : c'est le moment de le dépenser.
	g.NextWaveAt = time.Now().Add(WaveInterval / 12)
	if !g.BotAct(time.Now()) {
		t.Fatal("bot should act at curfew")
	}
	if !h.HasState(StateCache) {
		t.Fatal("au couvre-feu, le dernier PA paie la dissimulation")
	}
}

// Tétanisé, un héros ne peut ni bouger, ni fouiller, ni se cacher : rester sur place
// c'est mourir sous la vague suivante. Il doit tenter de s'échapper.
func TestBotEscapesWhenPinned(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, g.Town.X+3, g.Town.Y, 6)
	h := g.HeroByID(bot.HeroIDs[0])
	// Les coéquipiers sont ailleurs : personne à un pas, donc aucun renfort à attendre.
	for _, id := range bot.HeroIDs[1:] {
		o := g.HeroByID(id)
		o.X, o.Y, o.PA = g.Town.X, g.Town.Y, 0
	}
	// Un pack qui tétanise ET que l'équipe ne peut pas battre : c'est la PUISSANCE qui
	// décide d'engager (botShouldEngage), pas le nombre — d'où des monstres costauds.
	m := NewMonster("Slime Vorace", h.X, h.Y)
	m.Count = 40
	m.HP, m.MaxHP = 400, 400
	m.Stats.Force = 60
	g.Monsters[m.ID] = m
	g.TileAt(h.X, h.Y).MonsterID = m.ID
	g.Recompute()
	if !h.HasState(StateTetanise) {
		t.Fatal("staging: the hero should be pinned by the pack")
	}
	before := h.PA
	g.BotAct(time.Now())
	if h.PA == before {
		t.Fatal("a pinned bot must try something (escape), not stand still and die")
	}
}

// Un pack hors de portée de l'équipe n'est pas attaqué en mêlée : on le grignote à
// la compétence de carte. « Hors de portée » se mesure en PUISSANCE, pas en effectif —
// un combat n'oppose jamais plus de 4 unités, alors exiger un héros par unité revenait
// à ne jamais combattre du tout (cf. botShouldEngage).
func TestBotFireballsAPackTooBigToEngage(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, 3, 3, 6)
	m := NewMonster("Slime Vorace", 3, 3)
	m.Count = 9
	m.HP, m.MaxHP = 400, 400
	m.Stats.Force = 60
	g.Monsters[m.ID] = m
	g.TileAt(3, 3).MonsterID = m.ID
	if !g.BotAct(time.Now()) {
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
	g.BotAct(time.Now())
	if h.PA != pa {
		t.Fatal("BotAct must not spend a human hero's PA")
	}
}

func TestBotEngagesAndAutoResolvesCombat(t *testing.T) {
	// UN COMBAT SE JOUE AUX DÉS — ce test doit donc poser la même question à chaque fois.
	// Mesuré sans graine : trois héros à 20 de force et 60 PV perdent contre DEUX slimes
	// une fois sur vingt, et le test échouait au hasard (« stack the odds so the win is
	// deterministic » était faux — empiler les statistiques rend une victoire probable,
	// pas certaine). Un 5 % d'upset est un choix de game design défendable ; en faire
	// dépendre une suite de tests ne l'est pas.
	seedForTest(t, 1)
	g, bot := botGame(t)
	parkTeam(g, bot, 3, 3, 6)
	for _, id := range bot.HeroIDs {
		hh := g.HeroByID(id)
		hh.Stats.Force = 20
		hh.HP, hh.MaxHP = 60, 60
	}
	m := NewMonster("Slime Vorace", 3, 3)
	m.Count = 2 // 2 units vs a 3-hero party -> engage
	g.Monsters[m.ID] = m
	g.TileAt(3, 3).MonsterID = m.ID

	if !g.BotAct(time.Now()) {
		t.Fatal("bot should act")
	}
	if g.ActiveCombat != "" {
		t.Fatal("the auto-resolved combat must not stay open")
	}
	if g.TileAt(3, 3).MonsterID != "" {
		t.Fatal("the pack should be defeated and removed from the map")
	}
	// Le combat gagné est nettoyé de g.Combats (combats concurrents) ; la victoire
	// se lit à ses effets : le pack a disparu (ci-dessus) et les héros ont combattu.
	fought := false
	for _, id := range bot.HeroIDs {
		if h := g.HeroByID(id); h != nil && h.Bars["combat"] > 0 {
			fought = true
		}
	}
	if !fought {
		t.Fatal("the bot team should have fought (combat bar incremented)")
	}
}

func TestBotDoesNotEngageOutnumberedNorWithHumans(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, 3, 3, 6)
	m := NewMonster("Slime Vorace", 3, 3)
	m.Count = 9 // 4 combat units vs 3 heroes -> too risky, fireball instead
	g.Monsters[m.ID] = m
	g.TileAt(3, 3).MonsterID = m.ID
	g.BotAct(time.Now())
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
	g2.BotAct(time.Now())
	if len(g2.Combats) != 0 {
		t.Fatal("bots must never drag a human hero into an auto-resolved combat")
	}
}

func TestBotEvolvesAtDayGates(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, g.Town.X, g.Town.Y, 2)
	g.Day = EvolveDayIntermediate
	if !g.BotAct(time.Now()) {
		t.Fatal("bots should evolve when the gate opens")
	}
	for _, id := range bot.HeroIDs {
		if h := g.HeroByID(id); h.ClassTier != 1 || h.ClassID == "" {
			t.Fatalf("hero %s should have an intermediate class, got tier %d %q", h.Name, h.ClassTier, h.ClassID)
		}
	}
	g.Day = EvolveDayAdvanced
	if !g.BotAct(time.Now()) {
		t.Fatal("bots should evolve to advanced when the gate opens")
	}
	for _, id := range bot.HeroIDs {
		if h := g.HeroByID(id); h.ClassTier != 2 {
			t.Fatalf("hero %s should have an advanced class, got tier %d %q", h.Name, h.ClassTier, h.ClassID)
		}
	}
}

// Bots spread out: a tile a teammate already works on is never picked as a target.
func TestBotAvoidsTilesOccupiedByTeammates(t *testing.T) {
	g, bot := botGame(t)
	// The town wants for nothing, so the choice is purely about spreading out — with a
	// shopping list the bots would (rightly) rank a barren quarry above a rich meadow.
	g.Town.HP = g.Town.MaxHP
	for _, name := range []string{"Bois", "Pierre", "Minerai de fer", "Fibre végétale"} {
		g.addStorage(Item{Type: "objet", Name: name, Qty: 999})
	}
	// Every tile barren except two: R1 (occupied by a teammate) and R2 (free).
	for i := range g.Tiles {
		g.Tiles[i].Resources = 0
	}
	r1x, r1y := g.Town.X+2, g.Town.Y
	r2x, r2y := g.Town.X-2, g.Town.Y
	g.TileAt(r1x, r1y).Resources = 5
	g.TileAt(r2x, r2y).Resources = 5
	// Teammate parked ON R1; the acting hero sits in between, others out of PA.
	teammate := g.HeroByID(bot.HeroIDs[1])
	teammate.X, teammate.Y, teammate.PA = r1x, r1y, 0
	third := g.HeroByID(bot.HeroIDs[2])
	third.PA = 0
	actor := g.HeroByID(bot.HeroIDs[0])
	actor.X, actor.Y, actor.PA = g.Town.X, g.Town.Y+3, 6 // équidistant des deux

	tx, ty, ok := g.pickResourceTile(actor)
	if !ok {
		t.Fatal("R2 should be pickable")
	}
	if tx == r1x && ty == r1y {
		t.Fatal("the bot must not queue behind a teammate already working R1")
	}
	if tx != r2x || ty != r2y {
		t.Fatalf("expected R2 (%d,%d), got (%d,%d)", r2x, r2y, tx, ty)
	}
}

// With the known map picked clean, bots go EXPLORING (a frontier tile touching the
// fog) instead of idling in town.
func TestBotExploresFrontierWhenNothingToGather(t *testing.T) {
	g, bot := botGame(t)
	for i := range g.Tiles {
		g.Tiles[i].Resources = 0 // nothing to gather anywhere
	}
	// No town work either (all built and pristine), so exploring is the best move.
	for _, b := range g.Town.Buildings {
		b.Built, b.UnderConstruction = true, false
		if b.Level < 1 {
			b.Level = 1
		}
		if b.MaxDurability == 0 {
			b.MaxDurability = 100
		}
		b.Durability = b.MaxDurability
	}
	parkTeam(g, bot, g.Town.X, g.Town.Y, 6)
	h := g.HeroByID(bot.HeroIDs[0])
	if _, _, ok := g.pickFrontierTile(h); !ok {
		t.Fatal("staging: the fog frontier should exist around the revealed start")
	}
	if !g.BotAct(time.Now()) {
		t.Fatal("bot should act")
	}
	moved := false
	for _, id := range bot.HeroIDs {
		hh := g.HeroByID(id)
		if hh.X != g.Town.X || hh.Y != g.Town.Y {
			moved = true
		}
	}
	if !moved {
		t.Fatal("with nothing to gather, the bots should head out to explore the fog")
	}
}

// Per-hero compass bias: two heroes with different sectors pick different targets
// when equidistant tiles exist all around.
func TestBotSectorBiasSpreadsTargets(t *testing.T) {
	g, bot := botGame(t)
	for i := range g.Tiles {
		g.Tiles[i].Resources = 0
	}
	// Four equidistant rich tiles around town.
	for _, d := range [][2]int{{3, 0}, {-3, 0}, {0, 3}, {0, -3}} {
		g.TileAt(g.Town.X+d[0], g.Town.Y+d[1]).Resources = 5
	}
	parkTeam(g, bot, g.Town.X, g.Town.Y, 6)
	// The pick is randomized among the top three — sample each hero a few times and
	// count the distinct targets across the team: a single shared destination for
	// every draw would mean the old single-file behaviour.
	seen := map[[2]int]bool{}
	for _, id := range bot.HeroIDs {
		h := g.HeroByID(id)
		for i := 0; i < 6; i++ {
			if tx, ty, ok := g.pickResourceTile(h); ok {
				seen[[2]int{tx, ty}] = true
			}
		}
	}
	if len(seen) < 2 {
		t.Fatalf("the team should spread over several gathering targets, saw %d", len(seen))
	}
}

// A boss pack is never engaged by less than a full three-hero bot team.
func TestBotRespectsBosses(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, 3, 3, 6)
	lone := g.HeroByID(bot.HeroIDs[0])
	for _, id := range bot.HeroIDs[1:] { // only one hero on the boss tile
		hh := g.HeroByID(id)
		hh.X, hh.Y = g.Town.X, g.Town.Y
	}
	m := NewMonster("Roi Gobelin sur Sanglier Géant", 3, 3)
	g.Monsters[m.ID] = m
	g.TileAt(3, 3).MonsterID = m.ID
	if g.botShouldEngage(lone, m) {
		t.Fatal("a lone bot hero must not challenge a boss")
	}
	// The full (buffed) team may.
	parkTeam(g, bot, 3, 3, 6)
	for _, id := range bot.HeroIDs {
		hh := g.HeroByID(id)
		hh.HP, hh.MaxHP, hh.Stats.Force = 40, 40, 10
	}
	if !g.botShouldEngage(lone, m) {
		t.Fatal("a strong full team should engage the boss")
	}
}

// The power estimate keeps weak parties out of losing fights even when they match
// the pack unit-for-unit.
func TestBotDeclinesFightAboveItsPower(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, 3, 3, 6)
	for _, id := range bot.HeroIDs { // frail team
		hh := g.HeroByID(id)
		hh.HP, hh.MaxHP = 3, 3
		hh.Stats.Force = 0
	}
	m := NewMonster("Loup-garou", 3, 3) // 12 PV force 5 -> power 27/unit
	m.Count = 2
	g.Monsters[m.ID] = m
	g.TileAt(3, 3).MonsterID = m.ID
	if g.botShouldEngage(g.HeroByID(bot.HeroIDs[0]), m) {
		t.Fatal("a frail party must not engage a pack far above its power")
	}
}

// Les bots FABRIQUENT ce qui ne se ramasse pas. Tous les niveaux 2-3 du design
// réclament un matériau crafté (Planche, Corde, Brique, Acier) : une ville qui ne
// passe jamais à l'atelier reste bloquée à sa défense de départ quelle que soit la
// pierre accumulée — mesuré, la défense plafonnait à ~24 quand 48 est atteignable.
func TestBotCraftsMissingBuildingMaterial(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, g.Town.X, g.Town.Y, 6)
	// La muraille de niveau 3 réclame de la Brique, qui se fabrique à partir de Pierre.
	if w := g.buildingByID("wall"); w != nil {
		w.Level = 2
	}
	g.addStorage(Item{Type: "minerai", Name: "Pierre", Qty: 20})
	g.Recompute()

	for i := 0; i < 6 && g.storageQty("Brique") == 0; i++ {
		g.BotAct(time.Now())
	}
	if g.storageQty("Brique") == 0 {
		t.Fatal("les bots doivent transformer la Pierre en Brique pour la muraille niv.3")
	}
}

// Le recyclage des Débris est la réponse du design à une carte qui se vide : c'est ce
// qui permet à une longue partie de continuer une fois les cases épuisées.
func TestBotRecyclesDebrisWhenRecyclerieStands(t *testing.T) {
	g, bot := botGame(t)
	parkTeam(g, bot, g.Town.X, g.Town.Y, 6)
	r := g.buildingByID("recyclerie")
	r.Built, r.Level, r.Durability, r.MaxDurability = true, 1, 80, 80
	g.addStorage(Item{Type: "objet", Name: "Débris", Qty: 9})
	g.Town.HP = g.Town.MaxHP // pas d'urgence : le recyclage n'est pas masqué par une réparation
	g.Recompute()

	before := g.storageQty("Pierre")
	for i := 0; i < 6 && g.storageQty("Pierre") == before; i++ {
		g.BotAct(time.Now())
	}
	if g.storageQty("Pierre") <= before {
		t.Fatal("les bots doivent recycler les Débris en Pierre quand la Recyclerie est debout")
	}
}

// Un renfort qui arrive sur la case est LA façon documentée de briser Tétanisé, et
// aucun bot n'y allait : les coéquipiers passaient à côté d'un camarade cloué. Le
// pinné, lui, tient bon quand l'aide est à un pas plutôt que de tenter une fuite qui
// échoue une fois sur quatre.
func TestBotsRallyToAPinnedComrade(t *testing.T) {
	g, bot := botGame(t)
	pinned := g.HeroByID(bot.HeroIDs[0])
	rescuer := g.HeroByID(bot.HeroIDs[1])
	parkTeam(g, bot, g.Town.X+3, g.Town.Y, 6)
	// Le sauveteur est à deux pas ; le troisième héros est rangé en ville.
	rescuer.X, rescuer.Y = pinned.X+2, pinned.Y
	third := g.HeroByID(bot.HeroIDs[2])
	third.X, third.Y, third.PA = g.Town.X, g.Town.Y, 0

	m := NewMonster("Slime Vorace", pinned.X, pinned.Y)
	m.Count, m.HP, m.MaxHP = 40, 400, 400
	m.Stats.Force = 60
	g.Monsters[m.ID] = m
	g.TileAt(pinned.X, pinned.Y).MonsterID = m.ID
	g.Recompute()
	if !pinned.HasState(StateTetanise) {
		t.Fatal("staging: le héros doit être tétanisé")
	}

	before := absI(rescuer.X-pinned.X) + absI(rescuer.Y-pinned.Y)
	g.BotAct(time.Now())
	if after := absI(rescuer.X-pinned.X) + absI(rescuer.Y-pinned.Y); after >= before {
		t.Fatalf("le coéquipier doit marcher vers le camarade cloué : %d -> %d", before, after)
	}
}

// seedForTest rend le hasard du jeu REPRODUCTIBLE le temps d'un test, puis le rend à
// l'horloge. À utiliser dès qu'un test affirme quelque chose sur une issue tirée aux dés
// (combat, butin, apparition) : sans graine il pose une question différente à chaque
// exécution, et un échec ne veut plus rien dire.
func seedForTest(t *testing.T, seed int64) {
	t.Helper()
	SeedRNG(seed)
	t.Cleanup(func() { SeedRNG(time.Now().UnixNano()) })
}
