package game

import (
	"time"

	"github.com/google/uuid"
)

// The town messaging board: players of one town talking to each other.
//
// The rule that gives it its shape — and its cost — is POSITIONAL. A hero
// standing in town is at the notice board and writes freely. Out in the field an
// expedition is out of reach, unless the town has built the POSTE, which puts the
// whole roster back in touch. So the chat is not a social feature bolted onto the
// game; it is a thing you can lose (all heroes out, no Poste) and a thing you can
// build back, exactly like the Well or the Gate.
//
// Everything here is server-authoritative. The client re-derives the same gate to
// draw a locked panel instead of a dead input, but it is never asked.

// ChatMessage is one line of the board.
type ChatMessage struct {
	ID       string    `json:"id"`
	At       time.Time `json:"at"`
	Day      int       `json:"day"`
	PlayerID string    `json:"playerId"`
	Author   string    `json:"author"`             // Player.Name as of sending (players can't be renamed, but games outlive them)
	Text     string    `json:"text"`               // already moderated — this is the only copy kept
	Filtered bool      `json:"filtered,omitempty"` // moderation masked at least one word
	Remote   bool      `json:"remote,omitempty"`   // sent from the field, through the Poste
}

// chatCap bounds the board (oldest dropped first) so the state blob stays small.
// The journal keeps 100 lines of events; a conversation needs a bit more room.
const chatCap = 120

// chatMinInterval is the anti-flood delay between two messages FROM THE SAME
// player. Deduced from the board itself — no extra state to persist, and it
// survives a server restart or a cold serverless instance for free.
const chatMinInterval = 3 * time.Second

// chatBuildingID is the building that grants messaging from outside the walls.
const chatBuildingID = "poste"

// PosteReady reports whether the town's Poste is standing and usable. A ruined
// building (durability 0) relays nothing — same convention as the Gate, whose
// defense also collapses with its durability.
func (g *GameState) PosteReady() bool {
	b := g.buildingByID(chatBuildingID)
	return b != nil && b.Built && b.Durability > 0
}

// ChatAccess reports whether a player may read and write the board, and whether
// they are doing it remotely (from the field, through the Poste). The error is
// player-facing.
func (g *GameState) ChatAccess(playerID string) (remote bool, err error) {
	// Legacy solo games have no players array and no ownership at all; there is
	// nobody to gate against, so the board is simply open (same convention as
	// CheckHeroOwnership).
	if len(g.Players) == 0 {
		return false, nil
	}
	p := g.PlayerByID(playerID)
	if p == nil {
		return false, ActionError{"joueur inconnu — reconnecte-toi à la partie"}
	}
	for _, id := range p.HeroIDs {
		h := g.HeroByID(id)
		if h != nil && h.HP > 0 && h.X == g.Town.X && h.Y == g.Town.Y {
			return false, nil // at the notice board
		}
	}
	if g.PosteReady() {
		return true, nil // the Poste carries the mail out to the expedition
	}
	return false, ActionError{"aucun de tes héros n'est en ville — construis la Poste pour écrire depuis le terrain"}
}

// ChatFor returns the board as the given player may see it. Reading is gated by
// the same rule as writing: an expedition without a Poste is out of touch, and
// that has to cut both ways or the restriction is decoration.
func (g *GameState) ChatFor(playerID string) ([]ChatMessage, error) {
	if _, err := g.ChatAccess(playerID); err != nil {
		return nil, err
	}
	if g.Town.Chat == nil {
		return []ChatMessage{}, nil
	}
	out := make([]ChatMessage, len(g.Town.Chat))
	copy(out, g.Town.Chat)
	return out, nil
}

// PostChat validates, moderates and appends a player's message.
func (g *GameState) PostChat(playerID, text string) (*ChatMessage, error) {
	remote, err := g.ChatAccess(playerID)
	if err != nil {
		return nil, err
	}
	clean, filtered := Moderate(text)
	if clean == "" {
		return nil, ActionError{"message vide"}
	}
	now := time.Now()
	for i := len(g.Town.Chat) - 1; i >= 0; i-- {
		if g.Town.Chat[i].PlayerID != playerID {
			continue
		}
		if now.Sub(g.Town.Chat[i].At) < chatMinInterval {
			return nil, ActionError{"doucement — attends quelques secondes avant de renvoyer un message"}
		}
		break // only the player's LAST message matters
	}

	author := "Anonyme"
	if p := g.PlayerByID(playerID); p != nil {
		author = p.Name
	}
	m := ChatMessage{
		ID:       uuid.NewString(),
		At:       now,
		Day:      g.Day,
		PlayerID: playerID,
		Author:   author,
		Text:     clean,
		Filtered: filtered,
		Remote:   remote,
	}
	g.Town.Chat = append(g.Town.Chat, m)
	if n := len(g.Town.Chat); n > chatCap {
		// Drop from the HEAD: the board reads oldest-first, so the old lines are
		// the ones that scroll away.
		g.Town.Chat = append([]ChatMessage(nil), g.Town.Chat[n-chatCap:]...)
	}
	return &m, nil
}
