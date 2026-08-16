// Package game holds the Echo Terra domain model for the prototype vertical slice.
//
// The whole game state lives in a single GameState struct that gets serialized to
// JSON and persisted as a blob (see internal/store). This keeps the prototype simple
// while remaining server-authoritative: every action is validated and applied here.
package game

import "time"

// Biome enumerates the map tile types produced by world generation.
type Biome int

const (
	BiomeWater Biome = iota
	BiomeSand
	BiomeGrass
	BiomeForest
	BiomeMountain
	BiomeSnow
)

// Walkable reports whether a hero may stand on this biome on the global map.
func (b Biome) Walkable() bool { return b != BiomeWater }

// Label rend le nom ORDINAIRE du terrain. Un thème le rhabille (GameState.BiomeLabel
// → « Taïga », « Dunes ») sans jamais toucher au biome lui-même : le renommage est de
// la présentation, cf. theme.go.
func (b Biome) Label() string {
	switch b {
	case BiomeWater:
		return "Eau"
	case BiomeSand:
		return "Sable"
	case BiomeGrass:
		return "Prairie"
	case BiomeForest:
		return "Forêt"
	case BiomeMountain:
		return "Montagne"
	case BiomeSnow:
		return "Neige"
	}
	return "Terrain"
}

// Stats are the six physical competences from the GDD.
type Stats struct {
	Force      int `json:"force"`
	Dexterite  int `json:"dexterite"`
	Agilite    int `json:"agilite"`
	Endurance  int `json:"endurance"`
	Athletisme int `json:"athletisme"`
	Precision  int `json:"precision"`
}

// Item is a stack of loot in a hero inventory.
type Item struct {
	Type string `json:"type"` // animal | objet | plante | minerai | eau | aliment
	Name string `json:"name"`
	Qty  int    `json:"qty"`
}

// Tile is one cell of the global orthogonal map.
type Tile struct {
	Biome     Biome  `json:"biome"`
	Height    int    `json:"height"`    // cosmetic elevation on the global map
	Resources int    `json:"resources"` // remaining successful searches (0 => depleted)
	MonsterID string `json:"monsterId,omitempty"`
	RuinID    string `json:"ruinId,omitempty"` // ruine-donjon posée sur la case (voir ruins.go)
	// Covered : la case est sous la NEIGE FRAÎCHE (thème nordique, cold.go). Elle
	// n'interrompt que la fouille AUTOMATIQUE ; la fouille manuelle rend son butin
	// comme d'habitude et déblaie la neige au passage.
	Covered    bool `json:"covered,omitempty"`
	Discovered bool `json:"discovered"` // fog of war: revealed once a hero has seen it (shared by all players)
}

// Hero is a controllable unit on the global map.
type Hero struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	X         int      `json:"x"`
	Y         int      `json:"y"`
	PA        int      `json:"pa"`
	MaxPA     int      `json:"maxPa"`
	HP        int      `json:"hp"`
	MaxHP     int      `json:"maxHp"`
	Stats     Stats    `json:"stats"`
	Class     string   `json:"class"`
	States    []string `json:"states"`
	Inventory []Item   `json:"inventory"`
	// Barres de competences (montent selon les actions, influencent les classes).
	Bars map[string]int `json:"bars"`
	// DrewWaterDay is the game.day on which this hero last drew a water ration at the
	// Well (0 = never). One ration per hero per in-game day (see TownAction "water").
	DrewWaterDay int `json:"drewWaterDay"`
	// DrewWaterCount : rations tirées CE jour-là. Le puits en donne une par héros et
	// par jour ; la Cuisine niveau 2 (« rations +1 ») en autorise une seconde — sans ce
	// compteur, cet effet du design restait du texte (voir dailyWaterAllowance).
	DrewWaterCount int `json:"drewWaterCount,omitempty"`
	// Order est la CONSIGNE PERMANENTE du héros (orders_standing.go) : ce qu'il fera
	// tout seul juste avant la prochaine vague si son joueur n'est pas revenu. Ne dure
	// qu'UNE vague, n'engage jamais de combat — c'est un filet, pas un pilote
	// automatique.
	Order     string `json:"order,omitempty"`
	OrderWave int    `json:"orderWave,omitempty"`
	// ForageAt est l'échéance de la prochaine FOUILLE AUTOMATIQUE (zéro = le héros
	// n'est pas installé à récolter). Posée par la première fouille — celle qui
	// coûte 1 PA — puis replanifiée toute seule par la simulation. Voir forage.go.
	ForageAt time.Time `json:"forageAt,omitzero"`
	// Goal* est le CAP d'un héros de joueur-IA : la case de récolte vers laquelle il
	// marche. Il faut le retenir d'un round à l'autre, sinon le bot rechoisit sa
	// destination à chaque pas et erre au lieu de voyager (voir bots.go
	// botGatherTarget). Sans effet sur un héros humain.
	GoalX   int  `json:"goalX,omitempty"`
	GoalY   int  `json:"goalY,omitempty"`
	HasGoal bool `json:"hasGoal,omitempty"`
	// ÉQUIPEMENT PORTÉ (equipment.go) : une ARME et un ÉQUIPEMENT, par nom d'objet.
	// L'objet QUITTE le sac tant qu'il est porté — sinon il serait déposé en Banque tout
	// en restant équipé, et une seule lame armerait la ville entière. Les bonus sont
	// PRÊTÉS à l'unité de combat, jamais greffés sur Stats (ils s'empileraient).
	Weapon string `json:"weapon,omitempty"`
	Gear   string `json:"gear,omitempty"`
	// ClassID identifies the hero's current class in the Classes catalog ("" while
	// "Sans classe"). ClassTier mirrors its tier (see ClassTier* consts). ClassBonuses
	// accumulates the stat bonuses already folded into Stats by EvolveHero, kept only
	// so the UI can show a "+N" next to each boosted attribute.
	ClassID      string `json:"classId"`
	ClassTier    int    `json:"classTier"`
	ClassBonuses Stats  `json:"classBonuses"`
}

// HasState reports whether the hero currently has the named state.
func (h *Hero) HasState(s string) bool {
	for _, st := range h.States {
		if st == s {
			return true
		}
	}
	return false
}

// AddState adds a state if not already present.
func (h *Hero) AddState(s string) {
	if !h.HasState(s) {
		h.States = append(h.States, s)
	}
}

// RemoveState removes a state if present.
func (h *Hero) RemoveState(s string) {
	out := h.States[:0]
	for _, st := range h.States {
		if st != s {
			out = append(out, st)
		}
	}
	h.States = out
}

// AddLoot merges a stack into the inventory.
func (h *Hero) AddLoot(it Item) {
	for i := range h.Inventory {
		if h.Inventory[i].Name == it.Name {
			h.Inventory[i].Qty += it.Qty
			return
		}
	}
	h.Inventory = append(h.Inventory, it)
}

// Monster is an enemy on the global map; it expands into combat units on engagement.
type Monster struct {
	ID         string `json:"id"`
	Species    string `json:"species"`
	Appearance string `json:"appearance,omitempty"` // monsters/ asset file (mob-*) for the client
	X          int    `json:"x"`
	Y          int    `json:"y"`
	HP         int    `json:"hp"`
	MaxHP      int    `json:"maxHp"`
	Stats      Stats  `json:"stats"`
	Count      int    `json:"count"` // how many creatures stand on the tile
}

// GameState is the full persisted state of one game (one cooperative session).
type GameState struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"` // lobby display name ("Partie de Guillaume")
	Seed int64  `json:"seed"`
	// ThemeID est la NATURE de cette expédition (theme.go) : le biome qui entoure la
	// ville, les noms des terrains, la peau des ruines. Tiré de la graine au worldgen
	// et jamais modifié ensuite. Vide = tempéré (parties d'avant les thèmes).
	ThemeID string `json:"themeId,omitempty"`
	// ThemeInfo est le catalogue de CE thème, posé par ClientView seulement (dérivé,
	// jamais persisté) : le client n'a pas à tenir une copie du catalogue qui
	// divergerait au premier ajout. (Le champ ne s'appelle pas `Theme` parce que
	// l'accesseur de jeu, lui, s'appelle g.Theme().)
	ThemeInfo *ThemeDef           `json:"theme,omitempty"`
	Width     int                 `json:"width"`
	Height    int                 `json:"height"`
	Tiles     []Tile              `json:"tiles"` // row-major, length Width*Height
	Heroes    []*Hero             `json:"heroes"`
	Monsters  map[string]*Monster `json:"monsters"`
	Day       int                 `json:"day"`
	Wave      int                 `json:"wave"`
	// Lobby / multiplayer (see lobby.go). A game is created in status "lobby" and only
	// becomes "active" once the host launches it with at least MinPlayers players.
	JoinCode   string `json:"joinCode,omitempty"`   // short shareable code to join the lobby
	Visibility string `json:"visibility,omitempty"` // "private" (default) | "public" (see lobby.go)
	// Solo marks a game created by POST /api/games/solo (one human + bots). It is
	// private like any other coded lobby, so visibility alone can't tell them apart —
	// the leaderboard ranks solo towns separately (see LeaderboardMode).
	Solo       bool      `json:"solo,omitempty"`
	MinPlayers int       `json:"minPlayers"`
	MaxPlayers int       `json:"maxPlayers"`
	Players    []*Player `json:"players"`
	CreatedAt  time.Time `json:"createdAt"`
	StartedAt  time.Time `json:"startedAt,omitzero"` // zero until the host launches the game
	// KickVotes tracks expulsion votes in PUBLIC lobbies: target player id -> voter
	// player ids. A strict majority of the other human players removes the target.
	KickVotes map[string][]string `json:"kickVotes,omitempty"`
	// Horde / wave scheduling (server-authoritative).
	WaveNumber int       `json:"waveNumber"`         // total waves resolved so far
	NextWaveAt time.Time `json:"nextWaveAt"`         // when the next wave hits the town
	LastBotAt  time.Time `json:"lastBotAt,omitzero"` // last lazy bot round (serverless catch-up, see bots.go)
	Status     string    `json:"status"`             // "lobby" | "active" | "gameover"
	// CatchUp dit au client que le monde N'EST PAS À JOUR : des vagues restent dues
	// que la requête n'a pas eu le budget de rejouer (game.RequestBudget — un joueur
	// attend sa réponse). Purement DÉRIVÉ et posé sur la seule copie envoyée au
	// client (ClientView) : rien n'est stocké, le champ ne sort jamais du payload.
	// Sans lui, le client sondait toutes les 20 s et voyait le rattrapage tomber une
	// vague à la fois, minuteur figé à 0 — voir CatchUpPending.
	CatchUp bool `json:"catchUp,omitempty"`
	// EscortAt dit à un joueur qui PATIENTE dans un salon public quand son expédition
	// partira quand même, avec une escorte de joueurs-IA (lobby.go
	// MaybeStartWithEscort). Dérivé, posé par ClientView seulement — jamais persisté.
	// Sans lui, le client devrait recopier le délai, et la copie finirait par diverger ;
	// et sans affichage, l'attente serait un mystère puis un départ inexpliqué.
	EscortAt time.Time `json:"escortAt,omitzero"`
	// Rev is the store revision this state was loaded at — persistence bookkeeping,
	// never serialized into the blob nor sent to clients (see store.SaveIfUnchanged).
	Rev      int64       `json:"-"`
	LastWave *WaveReport `json:"lastWave,omitempty"`
	// MonstersKilled counts every creature slain in this game (iso combat wins, map
	// skills, bot auto-resolves) — the leaderboard's "monstres tués par ville".
	MonstersKilled int `json:"monstersKilled"`
	// Contributions : ce que chaque joueur a apporté à CETTE ville (contribution.go).
	// Clé = playerID. Rendre la contribution visible est la récompense principale d'un
	// jeu coopératif ; le registre est volontairement NON trié par mérite.
	Contributions map[string]*Contribution `json:"contributions,omitempty"`
	Town          struct {
		Name    string `json:"name"` // generated town name (see townnames.go)
		X       int    `json:"x"`
		Y       int    `json:"y"`
		HP      int    `json:"hp"`
		MaxHP   int    `json:"maxHp"`
		Defense int    `json:"defense"` // bâtiments + garnison (voir GarrisonDefense)
		// Garnison : les héros présents dans les murs défendent (wave.go). Dérivés,
		// exposés pour que l'interface puisse détailler « d'où vient ma défense » —
		// c'est le seul terme que le joueur change en une action.
		Garrison      int             `json:"garrison"`      // têtes aux remparts
		GarrisonValue int             `json:"garrisonValue"` // ce qu'elles ajoutent, plafond compris
		Buildings     []*TownBuilding `json:"buildings"`
		Storage       []Item          `json:"storage"` // shared stash (the House/Bank)
		// WaterDrawnToday lists the in-town hero IDs who have already taken their daily
		// Well ration this game.day (derived; refreshed by Recompute). The Well "water"
		// action is limited to one ration per hero per day.
		WaterDrawnToday []string `json:"waterDrawnToday"`
		// Log is the town journal (Panel building): every action performed IN town —
		// gate toggles, well draws, bank deposits, builds/repairs, town crafts —
		// newest first, capped (see logTown). Shared by all players.
		Log []TownLogEntry `json:"log,omitempty"`
		// Chat is the players' messaging board (see chat.go): OLDEST FIRST (reading
		// order of a conversation, unlike Log), capped by chatCap. It NEVER reaches a
		// client through the game payload — ClientView blanks it and serves ChatCount
		// instead, because reading is gated per player (in town, or the Poste built).
		// The dedicated GET /town/chat route is the only way in.
		Chat []ChatMessage `json:"chat,omitempty"`
		// ChatCount is len(Chat), filled by ClientView only: it drives the unread pip
		// on the ✉️ button without leaking a single message.
		ChatCount int `json:"chatCount"`
		// Townhall resurrections: how many were performed today (daily allowance is
		// the Townhall's level; level 3 is unlimited AND free).
		ReviveDay    int `json:"reviveDay,omitempty"`
		RevivesToday int `json:"revivesToday,omitempty"`
		// Infirmerie : soins délivrés aujourd'hui (quota quotidien = niveau ; le
		// niveau 3 est illimité ET gratuit, comme le lit de la Mairie).
		HealDay    int `json:"healDay,omitempty"`
		HealsToday int `json:"healsToday,omitempty"`
		// L'ORDRE DU JOUR et la PRÉVISION de la prochaine vague (orders.go) — dérivés,
		// reconstruits par Recompute comme la défense. C'est ce qui donne un énoncé à
		// une session de cinq minutes : sans eux, le joueur arrive avec 18 PA devant un
		// jeu qui ne lui dit pas ce dont la ville a besoin.
		Orders   []TownOrder  `json:"orders"`
		Forecast WaveForecast `json:"forecast"`
		// Requests : le tableau d'affichage des besoins (requests.go). C'est la seule
		// sortie de la Banque vers un joueur, et elle exige d'être DEUX.
		Requests []*TownRequest `json:"requests,omitempty"`
		// Scouts : les JOUEURS montés à la Tour estimer la vague qui vient (orders.go).
		// Remis à zéro à chaque vague — la horde suivante est une autre horde.
		Scouts []string `json:"scouts,omitempty"`
		// LA FAVEUR DES DIEUX (mythic.go) : le compteur qu'alimentent les objets de
		// décoration fabriqués, et que le Temple dépense en bénédictions.
		Favor int `json:"favor"`
		// Blessings : les bénédictions EN COURS, chacune avec la dernière vague
		// qu'elle couvre. Persistées : elles doivent survivre à un redémarrage comme
		// tout le reste de l'état de la ville.
		Blessings []ActiveBlessing `json:"blessings,omitempty"`
		// Votes : le scrutin en cours au Temple, joueur -> dieu. Dépouillé et vidé à
		// la vague suivante (resolveBlessingVote).
		Votes map[string]string `json:"votes,omitempty"`
		// Dérivés (Recompute), pour que l'interface n'ait pas à recopier les nombres du
		// serveur : ce qu'un dieu coûte, et combien de bénédictions le Temple tient.
		FavorGoal     int `json:"favorGoal"`
		BlessingSlots int `json:"blessingSlots"`
	} `json:"town"`
	// ActiveCombat is the id of the combat in progress, if any.
	ActiveCombat string             `json:"activeCombat,omitempty"`
	Combats      map[string]*Combat `json:"combats,omitempty"`
	// Ruins are the biome-specific ruined buildings → dungeons (see ruins.go).
	Ruins map[string]*Ruin `json:"ruins,omitempty"`
	// RevealAll is a DEBUG flag: when set, ClientView stops redacting the fog and
	// sends the whole map (tiles marked discovered) — the real explored set is left
	// untouched, so clearing the flag restores the genuine fog. See fog.go.
	RevealAll bool `json:"revealAll,omitempty"`

	// simNow est l'INSTANT REJOUÉ pendant un rattrapage (AdvanceTo). Non sérialisé, à
	// dessein : hors rattrapage il vaut zéro et l'horloge retombe sur l'heure réelle.
	// Voir clock().
	simNow time.Time
}

// clock rend l'instant COURANT DU MONDE : l'instant rejoué quand un rattrapage est en
// cours (sim.go), l'heure réelle sinon. Toute échéance qu'une action POSE dans le futur
// doit partir d'ici et non de time.Now() — un rattrapage rejoue des instants passés, et
// une échéance calée sur « maintenant » y arrive systématiquement trop tard.
func (g *GameState) clock() time.Time {
	if g.simNow.IsZero() {
		return time.Now()
	}
	return g.simNow
}

// TileAt returns a pointer to the tile at (x,y), or nil if out of bounds.
func (g *GameState) TileAt(x, y int) *Tile {
	if x < 0 || y < 0 || x >= g.Width || y >= g.Height {
		return nil
	}
	return &g.Tiles[y*g.Width+x]
}

// HeroByID returns the hero with the given id, or nil.
func (g *GameState) HeroByID(id string) *Hero {
	for _, h := range g.Heroes {
		if h.ID == id {
			return h
		}
	}
	return nil
}
