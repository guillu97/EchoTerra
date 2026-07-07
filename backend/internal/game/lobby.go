package game

// Lobby / multiplayer lifecycle. A game is created in status "lobby": players join it
// (each join spawns that player's hero in town), and once at least MinPlayers have
// joined the host launches it (StartGame) — only then do the horde waves start.

import (
	"fmt"
	"math/rand"
	"time"

	"github.com/google/uuid"
)

// Game status values.
const (
	StatusLobby    = "lobby"
	StatusActive   = "active"
	StatusGameOver = "gameover"
)

// Player is a human participant in one game. Each player owns exactly one hero.
type Player struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	HeroID   string    `json:"heroId"`
	Host     bool      `json:"host"` // the creator; only the host can launch the game
	JoinedAt time.Time `json:"joinedAt"`
}

// PlayerByID returns the player with the given id, or nil.
func (g *GameState) PlayerByID(id string) *Player {
	for _, p := range g.Players {
		if p.ID == id {
			return p
		}
	}
	return nil
}

// starterStats is the pool of starting stat blocks (from the GDD early game),
// cycled over join order so a full lobby stays balanced.
var starterStats = []Stats{
	{Force: 4, Dexterite: 2, Agilite: 3, Endurance: 4, Athletisme: 3, Precision: 2},
	{Force: 2, Dexterite: 4, Agilite: 4, Endurance: 2, Athletisme: 3, Precision: 4},
	{Force: 3, Dexterite: 3, Agilite: 2, Endurance: 5, Athletisme: 4, Precision: 2},
	{Force: 3, Dexterite: 2, Agilite: 4, Endurance: 3, Athletisme: 2, Precision: 4},
}

// NewStarterHero builds the classless starting hero for the i-th player to join,
// spawned in town and named after the player.
func NewStarterHero(i int, name string, x, y int) *Hero {
	st := starterStats[i%len(starterStats)]
	hp := 8 + st.Endurance*2
	return &Hero{
		ID:        uuid.NewString(),
		Name:      name,
		X:         x,
		Y:         y,
		PA:        6,
		MaxPA:     6,
		HP:        hp,
		MaxHP:     hp,
		Stats:     st,
		Class:     "Sans classe",
		States:    []string{},
		Inventory: []Item{},
		Bars:      map[string]int{"combat": 0, "collecte": 0, "ingeniosite": 0, "athletisme": 0},
	}
}

// AddPlayer joins a player to the lobby, spawning their hero in town. The first
// player to join becomes the host. Fails once the game has started or is full.
func (g *GameState) AddPlayer(name string, now time.Time) (*Player, error) {
	if g.Status != StatusLobby {
		return nil, ActionError{"la partie a déjà commencé"}
	}
	if len(g.Players) >= g.MaxPlayers {
		return nil, ActionError{fmt.Sprintf("partie complète (%d/%d joueurs)", len(g.Players), g.MaxPlayers)}
	}
	if name == "" {
		name = fmt.Sprintf("Aventurier %d", len(g.Players)+1)
	}
	h := NewStarterHero(len(g.Players), name, g.Town.X, g.Town.Y)
	g.Heroes = append(g.Heroes, h)
	p := &Player{
		ID:       uuid.NewString(),
		Name:     name,
		HeroID:   h.ID,
		Host:     len(g.Players) == 0,
		JoinedAt: now,
	}
	g.Players = append(g.Players, p)
	return p, nil
}

// StartGame launches a lobby: only the host may start, and only once at least
// MinPlayers players have joined. Waves are scheduled from the launch instant.
func (g *GameState) StartGame(playerID string, now time.Time) error {
	if g.Status != StatusLobby {
		return ActionError{"la partie a déjà commencé"}
	}
	p := g.PlayerByID(playerID)
	if p == nil {
		return ActionError{"joueur inconnu"}
	}
	if !p.Host {
		return ActionError{"seul l'hôte peut lancer la partie"}
	}
	if len(g.Players) < g.MinPlayers {
		return ActionError{fmt.Sprintf("en attente de joueurs (%d/%d minimum)", len(g.Players), g.MinPlayers)}
	}
	g.Status = StatusActive
	g.StartedAt = now
	g.NextWaveAt = now.Add(WaveInterval)
	g.Recompute()
	return nil
}

// CheckHeroOwnership validates that the player may control the hero. Games without
// players (legacy solo / dev "Test rapide") are unrestricted; multiplayer games
// require the caller to identify as the player owning that hero.
func (g *GameState) CheckHeroOwnership(playerID, heroID string) error {
	if len(g.Players) == 0 {
		return nil
	}
	p := g.PlayerByID(playerID)
	if p == nil {
		return ActionError{"joueur inconnu — reconnecte-toi à la partie"}
	}
	if p.HeroID != heroID {
		return ActionError{"ce héros appartient à un autre joueur"}
	}
	return nil
}

// RemovePlayer removes a player and their hero from a lobby (pre-launch only).
// If the host leaves, the next player inherits the host role. Returns the number
// of players remaining (0 means the lobby is now empty and can be deleted).
func (g *GameState) RemovePlayer(playerID string) (int, error) {
	if g.Status != StatusLobby {
		return len(g.Players), ActionError{"impossible de quitter une partie déjà lancée"}
	}
	p := g.PlayerByID(playerID)
	if p == nil {
		return len(g.Players), ActionError{"joueur inconnu"}
	}
	heroes := g.Heroes[:0]
	for _, h := range g.Heroes {
		if h.ID != p.HeroID {
			heroes = append(heroes, h)
		}
	}
	g.Heroes = heroes
	players := g.Players[:0]
	for _, pl := range g.Players {
		if pl.ID != playerID {
			players = append(players, pl)
		}
	}
	g.Players = players
	if p.Host && len(g.Players) > 0 {
		g.Players[0].Host = true
	}
	return len(g.Players), nil
}

// KickPlayer lets the host remove another player from the lobby.
func (g *GameState) KickPlayer(hostID, targetID string) (int, error) {
	host := g.PlayerByID(hostID)
	if host == nil {
		return len(g.Players), ActionError{"joueur inconnu"}
	}
	if !host.Host {
		return len(g.Players), ActionError{"seul l'hôte peut expulser un joueur"}
	}
	if hostID == targetID {
		return len(g.Players), ActionError{"l'hôte ne peut pas s'expulser lui-même (quitter le salon)"}
	}
	return g.RemovePlayer(targetID)
}

// joinCodeAlphabet avoids ambiguous characters (0/O, 1/I/L).
const joinCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// NewJoinCode generates a short shareable lobby code (not guaranteed globally unique;
// the API layer resolves codes against open lobbies only, newest first).
func NewJoinCode() string {
	b := make([]byte, 5)
	for i := range b {
		b[i] = joinCodeAlphabet[rand.Intn(len(joinCodeAlphabet))]
	}
	return string(b)
}
