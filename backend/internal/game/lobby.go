package game

// Lobby / multiplayer lifecycle. A game is created in status "lobby": players join it
// (each join spawns that player's hero in town), and once at least MinPlayers have
// joined the host launches it (StartGame) — only then do the horde waves start.

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Game status values.
const (
	StatusLobby    = "lobby"
	StatusActive   = "active"
	StatusGameOver = "gameover"
)

// Game visibility values. Private games are player-created, joined by code, launched
// by their host, and moderated by the host (kick). Public games are auto-created by
// the server, listed openly, auto-start once MinPlayers is reached, and are
// moderated by majority vote. An empty Visibility is treated as private (legacy).
const (
	VisibilityPrivate = "private"
	VisibilityPublic  = "public"
)

// IsPublic reports whether this is a server-created public game.
func (g *GameState) IsPublic() bool { return g.Visibility == VisibilityPublic }

// Leaderboard modes: how a town's run is classified in the ranking. The three are
// not comparable (a solo run with 4 bots plays nothing like a public expedition of
// four humans), so the leaderboard is browsed one mode at a time.
const (
	ModeSolo    = "solo"
	ModePublic  = "public"
	ModePrivate = "private"
)

// LeaderboardMode classifies the game for the ranking: "solo" (one human + bots),
// "public" (server-created open expedition) or "private" (coded lobby between
// friends). The Solo flag is authoritative; games created before the flag existed
// fall back to the shape a solo game has — private, exactly one human, at least one
// bot — which is also a fair description of any such run.
func (g *GameState) LeaderboardMode() string {
	if g.Solo {
		return ModeSolo
	}
	humans, bots := 0, 0
	for _, p := range g.Players {
		if p.Bot {
			bots++
		} else {
			humans++
		}
	}
	// ⚠ UN SEUL HUMAIN ENTOURÉ DE ROBOTS EST UN RUN SOLO, publique ou pas. Depuis
	// l'escorte de départ (MaybeStartWithEscort), une expédition publique peut partir
	// avec un joueur et des bots : la classer parmi les villes tenues à plusieurs
	// comparerait des choses qui n'ont rien à voir. Le mode est recalculé à chaque
	// écriture, donc l'expédition redevient « publique » dès qu'un deuxième humain
	// embarque — ce qui est exactement la vérité de ce moment-là.
	if humans == 1 && bots > 0 {
		return ModeSolo
	}
	if g.IsPublic() {
		return ModePublic
	}
	return ModePrivate
}

// HeroesPerPlayer is the size of each player's team (GDD: 1 joueur = 3 héros).
const HeroesPerPlayer = 3

// Player is a human participant in one game. Each player owns a team of
// HeroesPerPlayer heroes.
type Player struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	HeroIDs  []string  `json:"heroIds"`
	Host     bool      `json:"host"`             // the creator; only the host can launch the game
	Bot      bool      `json:"bot"`              // computer-controlled player (added by the host)
	UserID   string    `json:"userId,omitempty"` // linked account (multi-device reconnect)
	JoinedAt time.Time `json:"joinedAt"`
}

// PlayerByUserID returns the player linked to a user account, or nil.
func (g *GameState) PlayerByUserID(userID string) *Player {
	if userID == "" {
		return nil
	}
	for _, p := range g.Players {
		if p.UserID == userID {
			return p
		}
	}
	return nil
}

// OwnsHero reports whether this player's team contains the hero.
func (p *Player) OwnsHero(heroID string) bool {
	for _, id := range p.HeroIDs {
		if id == heroID {
			return true
		}
	}
	return false
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

// companionNames is the pool of names for the 2nd/3rd hero of each player's team
// (the 1st hero carries the player's own name), cycled over total hero count.
var companionNames = []string{
	"Aldric", "Brisa", "Cael", "Dara", "Ewen", "Fara",
	"Garen", "Hilda", "Ilan", "Jora", "Kellan", "Lyra",
}

// AddPlayer joins a player to the lobby, spawning their team of HeroesPerPlayer
// heroes in town (the first hero is named after the player). The first player to
// join becomes the host. Fails once the game has started or is full.
// LA FENÊTRE D'ACCUEIL D'UNE PARTIE PUBLIQUE.
//
// Une expédition publique démarre dès MinPlayers atteint — sinon les premiers arrivés
// attendent devant une porte close — mais elle reste OUVERTE quelques vagues pour que
// les suivants puissent embarquer. Sur un jeu qui se joue en plusieurs jours réels,
// exiger d'être là à la minute du lancement reviendrait à réserver le multijoueur aux
// gens présents au bon moment.
//
// La fenêtre se compte en VAGUES, pas en heures, et c'est délibéré : WaveInterval vaut
// dix minutes en développement et six heures en cible (2 vagues par jour réel). « Deux
// jours » n'a donc de sens portable que compté en vagues — quatre vagues, soit deux
// jours de jeu ET deux jours réels à la cadence visée.
const PublicJoinGraceWaves = 4

// JoinOpen reports whether a newcomer may still join. A lobby always accepts; a public
// expedition keeps accepting during its grace window. Private games close at launch —
// their host controls who comes in, and they are launched deliberately.
func (g *GameState) JoinOpen() bool {
	if len(g.Players) >= g.MaxPlayers {
		return false
	}
	switch g.Status {
	case StatusLobby:
		return true
	case StatusActive:
		return g.IsPublic() && g.WaveNumber < PublicJoinGraceWaves
	}
	return false
}

// JoinClosesAtWave is the first wave at which the doors shut (0 when they never opened
// this way). The UI counts down with it.
func (g *GameState) JoinClosesAtWave() int {
	if !g.IsPublic() {
		return 0
	}
	return PublicJoinGraceWaves
}

func (g *GameState) AddPlayer(name string, now time.Time) (*Player, error) {
	if len(g.Players) >= g.MaxPlayers {
		return nil, ActionError{fmt.Sprintf("partie complète (%d/%d joueurs)", len(g.Players), g.MaxPlayers)}
	}
	if !g.JoinOpen() {
		if g.Status == StatusActive && g.IsPublic() {
			return nil, ActionError{"les portes de cette expédition sont fermées (accueil terminé)"}
		}
		return nil, ActionError{"la partie a déjà commencé"}
	}
	if name == "" {
		name = fmt.Sprintf("Aventurier %d", len(g.Players)+1)
	}
	p := &Player{
		ID:       uuid.NewString(),
		Name:     name,
		Host:     len(g.Players) == 0,
		JoinedAt: now,
	}
	for j := 0; j < HeroesPerPlayer; j++ {
		heroName := name
		if j > 0 {
			heroName = companionNames[(len(g.Heroes))%len(companionNames)]
		}
		h := NewStarterHero(len(g.Heroes), heroName, g.Town.X, g.Town.Y)
		g.Heroes = append(g.Heroes, h)
		p.HeroIDs = append(p.HeroIDs, h.ID)
	}
	g.Players = append(g.Players, p)
	// Arrivée EN COURS DE PARTIE : la ville doit pouvoir accueillir la recrue. Les
	// rations du puits ont été calculées au lancement sur l'effectif d'alors
	// (InitWellRations) — sans ce complément, chaque nouveau venu boirait la réserve
	// des autres, et accepter du monde se paierait en soif.
	if g.Status == StatusActive {
		g.addWellRations(WellRationsPerHero * HeroesPerPlayer)
		g.logTown(fmt.Sprintf("🤝 %s rejoint l'expédition avec %d héros", p.Name, HeroesPerPlayer))
	}
	return p, nil
}

// botNames is the pool of bot player names (their companions come from
// companionNames like any player's team).
var botNames = []string{"Marcel", "Odile", "Gustave", "Colette", "Firmin", "Suzette", "Léon", "Berthe"}

// AddBot lets the host add a computer-controlled player to the lobby. Bots count
// toward MinPlayers/MaxPlayers exactly like humans and field a 3-hero team.
func (g *GameState) AddBot(hostID string, now time.Time) (*Player, error) {
	if g.IsPublic() {
		return nil, ActionError{"pas de bots dans une partie publique"}
	}
	host := g.PlayerByID(hostID)
	if host == nil {
		return nil, ActionError{"joueur inconnu"}
	}
	if !host.Host {
		return nil, ActionError{"seul l'hôte peut ajouter un bot"}
	}
	name := botNames[len(g.Players)%len(botNames)]
	// Avoid a duplicate name if a human already took it.
	for _, p := range g.Players {
		if p.Name == name {
			name = name + " II"
			break
		}
	}
	p, err := g.AddPlayer(name, now)
	if err != nil {
		return nil, err
	}
	p.Bot = true
	return p, nil
}

// StartGame launches a PRIVATE lobby: only the host may start, and only once at
// least MinPlayers players have joined. Public lobbies start on their own (see
// MaybeAutoStart) — a manual start is rejected to keep the rule unambiguous.
func (g *GameState) StartGame(playerID string, now time.Time) error {
	if g.Status != StatusLobby {
		return ActionError{"la partie a déjà commencé"}
	}
	if g.IsPublic() {
		return ActionError{"partie publique — elle démarre automatiquement quand assez de joueurs ont rejoint"}
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
	g.launch(now)
	return nil
}

// launch flips a lobby to active: waves scheduled and starting monsters seeded from
// the final player count. Callers own the validation.
func (g *GameState) launch(now time.Time) {
	g.Status = StatusActive
	g.StartedAt = now
	g.NextWaveAt = now.Add(WaveInterval)
	g.LastBotAt = now // origine de l'horloge des joueurs-IA (voir sim.go)
	g.KickVotes = nil // lobby-only state
	g.SeedStartingMonsters(len(g.Players))
	g.InitWellRations() // 2 jours d'eau × héros au départ
	g.Recompute()
}

// MaybeAutoStart launches a PUBLIC lobby once MinPlayers is reached (public games
// have no launching host). Returns true if the game just started.
func (g *GameState) MaybeAutoStart(now time.Time) bool {
	if !g.IsPublic() || g.Status != StatusLobby || len(g.Players) < g.MinPlayers {
		return false
	}
	g.launch(now)
	return true
}

// --- L'ESCORTE DE DÉPART (R4 de RETENTION-PLAN.md) -----------------------------------
//
// LE PROBLÈME : le premier contact avec le jeu pouvait être une SALLE D'ATTENTE. Le
// serveur ne tient qu'UN point d'accueil public à la fois (règle voulue : deux salons
// côte à côte sépareraient les joueurs), et ce salon ne part qu'à `MinPlayers`. Sur une
// population faible — c'est-à-dire au lancement, et c'est-à-dire aujourd'hui — un
// nouveau venu clique « expéditions publiques » et attend un deuxième humain qui
// n'arrivera peut-être jamais. Tout le travail de rétention en amont ne sert à rien si
// la première minute est un écran d'attente.
//
// LA RÉPONSE : au bout de `PublicEscortWait`, l'expédition part avec une ESCORTE de
// joueurs-IA — juste assez pour atteindre son minimum. Elle reste ensuite OUVERTE
// pendant sa fenêtre d'accueil (PublicJoinGraceWaves), donc les humains qui arrivent
// ensuite ne rejoignent pas un salon vide mais une ville qui VIT déjà, avec des murs,
// une banque et un journal. C'est mieux que ce qu'ils auraient trouvé en attendant.
//
// ⚠ TROIS BORNES, et elles comptent :
//
//  1. **JAMAIS SANS UN HUMAIN.** Une expédition d'escorte pure serait un fantôme que le
//     battement fabriquerait en boucle sur un serveur au repos. L'escorte accompagne
//     quelqu'un ; elle ne joue pas toute seule.
//  2. **JUSTE JUSQU'AU MINIMUM**, jamais jusqu'au maximum : les places restent pour des
//     gens. Une expédition de vingt ne se remplit pas de robots parce qu'un joueur est
//     arrivé le premier.
//  3. **ON ATTEND VRAIMENT.** Le délai n'est pas cosmétique : si deux humains se
//     présentent à une minute d'intervalle, ils doivent partir ENSEMBLE. L'escorte est
//     un filet pour le joueur seul, pas un raccourci qui empêcherait les rencontres.
//
// ⚠ Les bots d'escorte RESTENT toute la partie : les retirer en cours de route voudrait
// dire supprimer trois héros, leurs contributions au registre et leur part du travail
// déjà fait. Ce sont des coéquipiers, pas des figurants.

// PublicEscortWait : ce qu'un joueur seul attend avant que son expédition parte quand
// même. Assez pour laisser une chance à une vraie rencontre, assez court pour qu'on ne
// referme pas l'onglet.
const PublicEscortWait = 90 * time.Second

// waitingSince rend l'instant où le PREMIER humain de ce salon est arrivé (zéro s'il n'y
// en a aucun).
func (g *GameState) waitingSince() time.Time {
	var first time.Time
	for _, p := range g.Players {
		if p.Bot {
			continue
		}
		if first.IsZero() || p.JoinedAt.Before(first) {
			first = p.JoinedAt
		}
	}
	return first
}

// MaybeStartWithEscort fait partir un salon public qui attend depuis trop longtemps, en
// complétant l'équipage de joueurs-IA. Rend true si l'expédition vient de se lancer.
func (g *GameState) MaybeStartWithEscort(now time.Time) bool {
	if !g.IsPublic() || g.Status != StatusLobby {
		return false
	}
	since := g.waitingSince()
	if since.IsZero() {
		return false // borne 1 : pas d'humain, pas d'expédition
	}
	if len(g.Players) >= g.MinPlayers {
		return false // MaybeAutoStart s'en charge : ce chemin-ci est celui de l'attente
	}
	if now.Sub(since) < PublicEscortWait {
		return false // borne 3 : on laisse sa chance à une vraie rencontre
	}
	for len(g.Players) < g.MinPlayers { // borne 2 : jusqu'au MINIMUM, pas au maximum
		if _, err := g.addEscortBot(now); err != nil {
			return false
		}
	}
	g.launch(now)
	return true
}

// addEscortBot ajoute un joueur-IA d'escorte. Même chose qu'AddBot sans le contrôle
// d'hôte — c'est le SERVEUR qui décide ici, jamais un joueur : `AddBot` continue de
// refuser qu'un humain bourre un salon public de robots.
func (g *GameState) addEscortBot(now time.Time) (*Player, error) {
	name := botNames[len(g.Players)%len(botNames)]
	for _, p := range g.Players {
		if p.Name == name {
			name += " II"
			break
		}
	}
	p, err := g.AddPlayer(name, now)
	if err != nil {
		return nil, err
	}
	p.Bot = true
	return p, nil
}

// OwnerOfHero returns the id of the player owning the hero ("" if none — legacy
// games, or a hero not attached to any player).
func (g *GameState) OwnerOfHero(heroID string) string {
	for _, p := range g.Players {
		if p.OwnsHero(heroID) {
			return p.ID
		}
	}
	return ""
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
	if !p.OwnsHero(heroID) {
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
		if !p.OwnsHero(h.ID) {
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
	// Prune the departed player from the kick-vote ledger (as target AND as voter).
	delete(g.KickVotes, playerID)
	for target, votes := range g.KickVotes {
		kept := votes[:0]
		for _, v := range votes {
			if v != playerID {
				kept = append(kept, v)
			}
		}
		if len(kept) == 0 {
			delete(g.KickVotes, target)
		} else {
			g.KickVotes[target] = kept
		}
	}
	return len(g.Players), nil
}

// KickPlayer lets the host remove another player from a PRIVATE lobby. In public
// games expulsion goes through a majority vote instead (VoteKick).
func (g *GameState) KickPlayer(hostID, targetID string) (int, error) {
	if g.IsPublic() {
		return len(g.Players), ActionError{"partie publique — l'expulsion se décide par un vote"}
	}
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

// VoteKick registers an expulsion vote in a PUBLIC lobby. When a strict majority of
// the OTHER human players agrees, the target (and their heroes) is removed. Returns
// (votes, needed, kicked): current vote count for the target, the majority
// threshold, and whether the kick just happened.
func (g *GameState) VoteKick(voterID, targetID string) (int, int, bool, error) {
	if !g.IsPublic() {
		return 0, 0, false, ActionError{"partie privée — seul l'hôte peut expulser"}
	}
	if g.Status != StatusLobby {
		return 0, 0, false, ActionError{"le vote d'expulsion n'existe qu'en salle d'attente"}
	}
	voter := g.PlayerByID(voterID)
	target := g.PlayerByID(targetID)
	if voter == nil || target == nil {
		return 0, 0, false, ActionError{"joueur inconnu"}
	}
	if voter.Bot {
		return 0, 0, false, ActionError{"les bots ne votent pas"}
	}
	if voterID == targetID {
		return 0, 0, false, ActionError{"impossible de voter contre soi-même (quitter le salon)"}
	}
	if g.KickVotes == nil {
		g.KickVotes = map[string][]string{}
	}
	votes := g.KickVotes[targetID]
	for _, v := range votes {
		if v == voterID {
			return len(votes), g.kickMajority(targetID), false, ActionError{"tu as déjà voté contre ce joueur"}
		}
	}
	votes = append(votes, voterID)
	g.KickVotes[targetID] = votes

	needed := g.kickMajority(targetID)
	if len(votes) >= needed {
		delete(g.KickVotes, targetID)
		if _, err := g.RemovePlayer(targetID); err != nil {
			return len(votes), needed, false, err
		}
		return len(votes), needed, true, nil
	}
	return len(votes), needed, false, nil
}

// kickMajority is the strict majority of human players other than the target.
func (g *GameState) kickMajority(targetID string) int {
	eligible := 0
	for _, p := range g.Players {
		if !p.Bot && p.ID != targetID {
			eligible++
		}
	}
	return eligible/2 + 1
}

// joinCodeAlphabet avoids ambiguous characters (0/O, 1/I/L).
const joinCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// NewJoinCode generates a short shareable lobby code (not guaranteed globally unique;
// the API layer resolves codes against open lobbies only, newest first).
func NewJoinCode() string {
	b := make([]byte, 5)
	for i := range b {
		b[i] = joinCodeAlphabet[randIntn(len(joinCodeAlphabet))]
	}
	return string(b)
}
