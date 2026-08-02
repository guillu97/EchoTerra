package game

import (
	"strings"
	"testing"
	"time"
)

// newChatTestGame builds a two-player town: p1 owns h1 (standing in town), p2
// owns h2 (out in the field). That is exactly the shape the positional gate is
// about — one player at the notice board, one on expedition.
func newChatTestGame() *GameState {
	g := &GameState{Width: 5, Height: 5, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 25)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: BiomeGrass, Resources: 3}
	}
	g.Town.X, g.Town.Y = 2, 2
	g.Town.HP, g.Town.MaxHP = 100, 100
	g.Town.Buildings = DefaultBuildings()
	g.Day = 1
	g.Heroes = []*Hero{
		{ID: "h1", Name: "Cael", X: 2, Y: 2, HP: 10, MaxHP: 10, PA: 6, States: []string{}, Bars: map[string]int{}, Inventory: []Item{}},
		{ID: "h2", Name: "Brisa", X: 4, Y: 4, HP: 10, MaxHP: 10, PA: 6, States: []string{}, Bars: map[string]int{}, Inventory: []Item{}},
	}
	g.Players = []*Player{
		{ID: "p1", Name: "Guillaume", HeroIDs: []string{"h1"}, Host: true},
		{ID: "p2", Name: "Neko", HeroIDs: []string{"h2"}},
	}
	g.Recompute()
	return g
}

// buildPoste completes the Poste the way the game does, without walking the whole
// chantier (plan + materials + PA) — that flow has its own tests in build_test.go.
func buildPoste(g *GameState) {
	b := g.buildingByID("poste")
	b.Built, b.Level = true, 1
	b.Durability = b.MaxDurability
}

func TestChatInTownIsAlwaysAllowed(t *testing.T) {
	g := newChatTestGame()
	remote, err := g.ChatAccess("p1")
	if err != nil {
		t.Fatalf("a player with a hero in town must be able to write: %v", err)
	}
	if remote {
		t.Fatal("writing from town is not remote")
	}
	m, err := g.PostChat("p1", "j'ai trouvé le Plan de la Tour")
	if err != nil {
		t.Fatalf("PostChat: %v", err)
	}
	if m.Author != "Guillaume" || m.Day != 1 || m.ID == "" || m.At.IsZero() {
		t.Fatalf("message not stamped: %+v", m)
	}
	if m.Remote {
		t.Fatal("message sent from town must not be flagged remote")
	}
	if len(g.Town.Chat) != 1 || g.Town.Chat[0].Text != "j'ai trouvé le Plan de la Tour" {
		t.Fatalf("board = %+v", g.Town.Chat)
	}
}

// THE rule: out in the field with no Poste, the expedition is out of touch — for
// reading as well as writing. Gating only the send would leave the restriction
// purely decorative.
func TestChatOutOfTownNeedsThePoste(t *testing.T) {
	g := newChatTestGame()
	if _, err := g.PostChat("p1", "coucou"); err != nil {
		t.Fatalf("setup message: %v", err)
	}

	if _, err := g.ChatAccess("p2"); err == nil {
		t.Fatal("a player whose heroes are all in the field must be locked out")
	}
	if _, err := g.PostChat("p2", "au secours"); err == nil {
		t.Fatal("PostChat must refuse a field player without a Poste")
	}
	if _, err := g.ChatFor("p2"); err == nil {
		t.Fatal("reading must be gated too, not just writing")
	}

	buildPoste(g)

	remote, err := g.ChatAccess("p2")
	if err != nil {
		t.Fatalf("the Poste must unlock the field: %v", err)
	}
	if !remote {
		t.Fatal("a message from the field goes through the Poste — it is remote")
	}
	m, err := g.PostChat("p2", "je rentre demain")
	if err != nil {
		t.Fatalf("PostChat through the Poste: %v", err)
	}
	if !m.Remote {
		t.Fatal("field message must carry Remote")
	}
	msgs, err := g.ChatFor("p2")
	if err != nil || len(msgs) != 2 {
		t.Fatalf("ChatFor = %d messages, err=%v — want the whole board", len(msgs), err)
	}
}

// A ruined Poste relays nothing, same convention as a wrecked Gate giving no
// defense: the building's durability is what makes it work.
func TestRuinedPosteDoesNotRelay(t *testing.T) {
	g := newChatTestGame()
	buildPoste(g)
	g.buildingByID("poste").Durability = 0
	if g.PosteReady() {
		t.Fatal("a Poste at 0 durability is not ready")
	}
	if _, err := g.ChatAccess("p2"); err == nil {
		t.Fatal("a ruined Poste must not unlock the field")
	}
}

// A dead hero is not "in town" even when their body is on the tile.
func TestDeadHeroInTownDoesNotUnlockChat(t *testing.T) {
	g := newChatTestGame()
	g.HeroByID("h1").HP = 0
	if _, err := g.ChatAccess("p1"); err == nil {
		t.Fatal("a fallen hero must not count as present at the notice board")
	}
}

func TestChatAppliesModeration(t *testing.T) {
	g := newChatTestGame()
	m, err := g.PostChat("p1", "putain qui a laissé la porte ouverte")
	if err != nil {
		t.Fatalf("PostChat: %v", err)
	}
	if !m.Filtered {
		t.Fatal("message should be flagged as filtered")
	}
	if strings.Contains(m.Text, "putain") {
		t.Fatalf("the insult survived moderation: %q", m.Text)
	}
	if !strings.Contains(m.Text, "qui a laissé la porte ouverte") {
		t.Fatalf("moderation ate the rest of the message: %q", m.Text)
	}
	// Masked, NOT rejected — the message is on the board.
	if len(g.Town.Chat) != 1 {
		t.Fatalf("board should hold the masked message, got %d entries", len(g.Town.Chat))
	}
}

func TestChatRejectsEmptyAndFloods(t *testing.T) {
	g := newChatTestGame()
	if _, err := g.PostChat("p1", "   \n "); err == nil {
		t.Fatal("a blank message must be refused")
	}
	if _, err := g.PostChat("p1", "premier"); err != nil {
		t.Fatalf("first message: %v", err)
	}
	if _, err := g.PostChat("p1", "second tout de suite"); err == nil {
		t.Fatal("two messages back to back must trip the anti-flood")
	}
	// The flood window is per PLAYER: p1 spamming must not silence anyone else.
	buildPoste(g)
	if _, err := g.PostChat("p2", "moi je peux parler"); err != nil {
		t.Fatalf("another player must not be caught by p1's cooldown: %v", err)
	}
	// Once the window has passed, p1 speaks again.
	g.Town.Chat[0].At = time.Now().Add(-chatMinInterval - time.Second)
	g.Town.Chat[1].At = time.Now().Add(-chatMinInterval - time.Second)
	if _, err := g.PostChat("p1", "troisième"); err != nil {
		t.Fatalf("after the cooldown the message must go through: %v", err)
	}
}

func TestChatIsCapped(t *testing.T) {
	g := newChatTestGame()
	for i := 0; i < chatCap+20; i++ {
		g.Town.Chat = append(g.Town.Chat, ChatMessage{ID: "x", PlayerID: "p1", Text: "vieux"})
	}
	if _, err := g.PostChat("p1", "le dernier"); err != nil {
		t.Fatalf("PostChat: %v", err)
	}
	if len(g.Town.Chat) != chatCap {
		t.Fatalf("board length = %d, want the cap %d", len(g.Town.Chat), chatCap)
	}
	// Oldest first: the newest message is the LAST one, and the head scrolled away.
	if g.Town.Chat[len(g.Town.Chat)-1].Text != "le dernier" {
		t.Fatalf("newest message should be last: %+v", g.Town.Chat[len(g.Town.Chat)-1])
	}
}

// Legacy solo games have no players array and no ownership at all — there is
// nobody to gate against, so the board stays open (same convention as
// CheckHeroOwnership).
func TestChatOpenInLegacySoloGame(t *testing.T) {
	g := newChatTestGame()
	g.Players = nil
	if _, err := g.ChatAccess(""); err != nil {
		t.Fatalf("legacy game must not gate the chat: %v", err)
	}
	if _, err := g.PostChat("", "test"); err != nil {
		t.Fatalf("PostChat in a legacy game: %v", err)
	}
}

// DefaultBuildings() only ever runs at worldgen, so a town saved before the Poste
// existed would never see it and the messaging feature would be unreachable in
// every game already in flight. Recompute backfills the catalog — without
// resetting anything the town already has.
func TestRecomputeBackfillsNewBuildings(t *testing.T) {
	g := newChatTestGame()
	// Simulate an old save: drop the Poste, and damage a building so we can prove
	// the backfill leaves existing state alone.
	kept := g.Town.Buildings[:0]
	for _, b := range g.Town.Buildings {
		if b.ID != "poste" {
			kept = append(kept, b)
		}
	}
	g.Town.Buildings = kept
	wall := g.buildingByID("wall")
	wall.Durability = 33
	before := len(g.Town.Buildings)

	g.Recompute()

	p := g.buildingByID("poste")
	if p == nil {
		t.Fatal("Recompute must backfill the Poste into a game created before it existed")
	}
	if p.Built || p.Level != 0 {
		t.Fatalf("the backfilled building must arrive pristine (a site), got %+v", p)
	}
	if len(g.Town.Buildings) != before+1 {
		t.Fatalf("backfill added %d buildings, want exactly 1", len(g.Town.Buildings)-before)
	}
	if g.buildingByID("wall").Durability != 33 {
		t.Fatal("backfill must not reset buildings the town already had")
	}

	// Convergent: calling it again changes nothing.
	g.Recompute()
	if len(g.Town.Buildings) != before+1 {
		t.Fatalf("backfill is not idempotent: %d buildings", len(g.Town.Buildings))
	}
}

func TestChatUnknownPlayerIsRejected(t *testing.T) {
	g := newChatTestGame()
	if _, err := g.ChatAccess("nope"); err == nil {
		t.Fatal("an unknown player id must be refused")
	}
}

// The board must never ride the game payload: reading is gated per player and
// ClientView has no idea who is asking. Only the count survives.
func TestClientViewStripsChat(t *testing.T) {
	g := newChatTestGame()
	if _, err := g.PostChat("p1", "un secret"); err != nil {
		t.Fatalf("PostChat: %v", err)
	}
	cv := g.ClientView()
	if cv.Town.Chat != nil {
		t.Fatalf("ClientView leaked the board: %+v", cv.Town.Chat)
	}
	if cv.Town.ChatCount != 1 {
		t.Fatalf("ChatCount = %d, want 1 (the unread pip needs it)", cv.Town.ChatCount)
	}
	if len(g.Town.Chat) != 1 {
		t.Fatal("ClientView must not mutate the real state")
	}
}
