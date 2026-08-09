package game

// Fog of war. Tiles start hidden and are permanently revealed once a hero has seen
// them; the revealed set lives on GameState (one shared world) so every player sees
// the same explored map. The town and its immediate surroundings start revealed.
//
// Reveal is monotonic (Discovered only flips false->true) and recomputed from the
// current hero positions on every Recompute(), so it captures movement from any
// action (move, escape, combat retreat) without each action needing to know about fog.

const (
	// Un héros voit la case où il est ET ses voisines. L'exploration AU CONTACT
	// (rayon 0, 2026-07-19) était trop serrée pour le jeu qu'on veut : avec une case
	// révélée par pas, une expédition ne trouve JAMAIS le biome dont elle a besoin.
	// Mesuré en simulation : 31 tuiles de montagne sur la carte, DEUX découvertes en
	// douze vagues — donc zéro pierre en banque, donc ni muraille améliorée ni ville
	// réparée, donc défaite garantie quoi que fassent les joueurs. Le rayon 1 garde le
	// brouillard signifiant (on ne voit pas loin) tout en rendant la prospection
	// possible ; l'Éclaireur conserve sa case d'avance par-dessus.
	heroSightRadius      = 1 // rayon Chebyshev révélé par un héros normal
	eclaireurSightRadius = 2 // passif Éclaireur : voit une case plus loin
	townSightRadius      = 3 // the town reveals a slightly wider ring at the start
)

// revealAround marks every in-bounds tile within Chebyshev radius r of (cx,cy) as discovered.
func (g *GameState) revealAround(cx, cy, r int) {
	for dy := -r; dy <= r; dy++ {
		for dx := -r; dx <= r; dx++ {
			if t := g.TileAt(cx+dx, cy+dy); t != nil {
				t.Discovered = true
			}
		}
	}
}

// RevealVision re-reveals the fog around the town and every living hero. Called from
// Recompute so the explored set grows as heroes move.
func (g *GameState) RevealVision() {
	g.revealAround(g.Town.X, g.Town.Y, townSightRadius)
	for _, h := range g.Heroes {
		if h.HP > 0 {
			r := heroSightRadius
			// Éclaireur "Observation Large": voit une case à l'avance (passif).
			if h.ClassID == "eclaireur" {
				r = eclaireurSightRadius
			}
			g.revealAround(h.X, h.Y, r)
		}
	}
}

// ClientView returns a copy of the state that is safe to send to players: tiles no
// hero has discovered are blanked (their biome/height/resources/monster would leak
// through the HTTP payload even though the client hides them), monsters standing on
// undiscovered tiles are omitted, the worldgen seed is zeroed (seed + generator
// would reconstruct the whole map) and the chat board is stripped. The receiver is
// NOT modified — persistence and all game logic keep operating on the full state.
func (g *GameState) ClientView() *GameState {
	cp := *g
	cp.Seed = 0
	// The messaging board never rides the game payload: who may READ it depends on
	// the requesting player (in town, or the Poste built — see chat.go) and this
	// function has no idea who is asking. Only the count survives, so the ✉️ button
	// can carry an unread pip without leaking a word. Content is served by the
	// dedicated, gated GET /town/chat. (cp.Town is a value copy — g is untouched.)
	cp.Town.ChatCount = len(g.Town.Chat)
	cp.Town.Chat = nil
	// DEBUG « lever le brouillard » : envoie TOUTE la carte (tuiles marquées
	// découvertes) sans toucher au vrai jeu de tuiles explorées de `g` — désactiver
	// le flag rend le brouillard réel. Monstres/ruines suivent (tout est visible).
	if g.RevealAll {
		cp.Tiles = make([]Tile, len(g.Tiles))
		for i, t := range g.Tiles {
			t.Discovered = true
			cp.Tiles[i] = t
		}
		return &cp
	}
	cp.Tiles = make([]Tile, len(g.Tiles))
	for i, t := range g.Tiles {
		if t.Discovered {
			cp.Tiles[i] = t
		}
		// else: zero Tile — Discovered stays false, everything else is blank
	}
	cp.Monsters = make(map[string]*Monster, len(g.Monsters))
	for id, m := range g.Monsters {
		if t := g.TileAt(m.X, m.Y); t != nil && t.Discovered {
			cp.Monsters[id] = m
		}
	}
	// ruines : mêmes règles que les monstres — invisibles tant que la tuile est
	// sous la brume (la tuile vierge a déjà perdu son ruinId)
	cp.Ruins = make(map[string]*Ruin, len(g.Ruins))
	for id, ru := range g.Ruins {
		if t := g.TileAt(ru.X, ru.Y); t != nil && t.Discovered {
			cp.Ruins[id] = ru
		}
	}
	return &cp
}
