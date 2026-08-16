package game

import "time"

// LE BROUILLARD DE GUERRE — trois états, et une mémoire PAR JOUEUR.
//
// CE QUE C'ÉTAIT. `Tile.Discovered` : un booléen PARTAGÉ par toute l'expédition, qui ne
// repassait jamais à faux. Une case vue une fois par n'importe qui restait acquise à
// tout le monde pour toujours, avec ses monstres visibles en permanence. Ce n'est pas
// un brouillard, c'est une carte qui se colorie.
//
// CE QUE C'EST MAINTENANT, et c'est le modèle de Warcraft III / StarCraft II :
//
//	FogHidden   — jamais vue. Noir. Rien n'en sort, pas même le biome.
//	FogExplored — vue autrefois, plus sous les yeux de personne. Le TERRAIN est
//	              rendu, ASSOMBRI ; ce qui bouge (monstres, héros des autres, ruines
//	              non encore repérées) n'est PAS servi : c'est un souvenir, pas une
//	              caméra.
//	FogVisible  — dans le champ de quelqu'un en ce moment. Tout est servi, tout est
//	              éclairé.
//
// ⚠ LA MÉMOIRE EST PAR JOUEUR (`GameState.Explored`, un bitset compact par identifiant
// de joueur). C'est la demande explicite : « ne révélant les cases qu'aux joueurs qui
// s'y trouvent ». Deux conséquences qu'il faut assumer plutôt que subir :
//   - un joueur qui rejoint en cours de partie arrive devant une carte noire. C'est le
//     prix de la règle ; le bourg et les tours la rouvrent aussitôt autour de lui.
//   - les joueurs-IA ont AUSSI leur propre mémoire (bots.go lit `PlayerKnows`), donc
//     ils ne profitent plus de l'exploration des autres. C'est ce qui rend la règle
//     honnête, et c'est mesuré par `cmd/balance`.
//
// ⚠ CE QUI RESTE PARTAGÉ, ET POURQUOI : le bourg et les TOURS. Une survie collective
// qui n'aurait aucune connaissance commune ne serait plus collective — et c'est
// exactement l'intérêt de la tour demandé dans la même phrase (« elle pourrait
// conserver la vision, supprimant le fog of war dans son rayon »). Ce qu'une tour
// éclaire est éclairé POUR TOUT LE MONDE et ne s'éteint jamais. Bâtir devient donc le
// moyen de transformer une exploration individuelle en savoir d'expédition.
//
// ⚠ `Tile.Discovered` SURVIT, avec un sens précis et réduit : « quelqu'un l'a vue un
// jour ». Il ne sert plus à décider ce qu'un joueur voit — c'est `PlayerKnows` qui le
// fait — mais il reste la mémoire de l'EXPÉDITION, et deux choses en dépendent
// légitimement : le relief ne peut arrêter que sur une case déjà vue (climb.go), et la
// simulation d'équilibrage compte les tuiles sorties du brouillard.

// FogState : ce qu'un joueur donné sait d'une case, à cet instant.
type FogState uint8

const (
	FogHidden   FogState = 0
	FogExplored FogState = 1
	FogVisible  FogState = 2
)

const (
	// Un héros voit la case où il est ET ses voisines. L'exploration AU CONTACT
	// (rayon 0, 2026-07-19) était trop serrée pour le jeu qu'on veut : avec une case
	// révélée par pas, une expédition ne trouve JAMAIS le biome dont elle a besoin.
	// Mesuré en simulation : 31 tuiles de montagne sur la carte, DEUX découvertes en
	// douze vagues — donc zéro pierre en banque, donc ni muraille améliorée ni ville
	// réparée, donc défaite garantie quoi que fassent les joueurs. Le rayon 1 garde le
	// brouillard signifiant (on ne voit pas loin) tout en rendant la prospection
	// possible ; l'Éclaireur conserve sa case d'avance par-dessus.
	heroSightRadius = 1 // rayon Chebyshev de base, avant Perception
	// mapSightPerPerception : une case de vision de plus tous les N points de
	// Perception. ⚠ RÉGLÉ SERRÉ, et volontairement : le rayon de vision de carte est
	// la valeur la plus dangereuse du jeu à toucher — à rayon 0, la mesure avait donné
	// DEUX tuiles de montagne découvertes en douze vagues, donc zéro pierre, donc
	// défaite arithmétique quoi que fassent les joueurs. À /4, un héros neuf (2 à 4 de
	// Perception) gagne 0 ou 1 case, et un Éclaireur évolué (7 à 9) en gagne deux.
	mapSightPerPerception = 4
	townSightRadius       = 3 // le bourg éclaire un anneau un peu plus large
)

// --- mémoire par joueur : un bit par case ------------------------------------
//
// ⚠ UN BITSET, PAS UN `[]bool`. Une carte de vingt joueurs fait 134² = 17 956 cases ;
// en `[]bool` le JSON de la seule mémoire pèserait ~90 ko PAR JOUEUR, soit près de
// deux mégaoctets par partie, réécrits à chaque vague. En bits c'est 2,2 ko par joueur.
// `[]byte` se sérialise en base64 par le paquet json, donc ça reste lisible et compact
// sans code de sérialisation à écrire.

// viewerKey rend la clé de mémoire d'un joueur. Une partie LEGACY (« Test rapide »,
// zéro joueur) n'a pas d'identifiant : tout le monde partage la clé vide, ce qui
// redonne exactement l'ancien comportement partagé sans cas particulier ailleurs.
func (g *GameState) viewerKey(playerID string) string {
	if len(g.Players) == 0 {
		return ""
	}
	return playerID
}

func (g *GameState) exploredBits(key string) []byte {
	if g.Explored == nil {
		g.Explored = map[string][]byte{}
	}
	need := (len(g.Tiles) + 7) / 8
	b := g.Explored[key]
	if len(b) < need {
		nb := make([]byte, need)
		copy(nb, b)
		b = nb
		g.Explored[key] = b
	}
	return b
}

// markExplored inscrit la case dans la mémoire de ce joueur.
func (g *GameState) markExplored(key string, idx int) {
	if idx < 0 || idx >= len(g.Tiles) {
		return
	}
	b := g.exploredBits(key)
	b[idx/8] |= 1 << (idx % 8)
}

// PlayerExplored : ce joueur a-t-il DÉJÀ vu cette case ?
func (g *GameState) PlayerExplored(playerID string, x, y int) bool {
	if x < 0 || y < 0 || x >= g.Width || y >= g.Height {
		return false
	}
	idx := y*g.Width + x
	b := g.Explored[g.viewerKey(playerID)]
	if idx/8 >= len(b) {
		return false
	}
	return b[idx/8]&(1<<(idx%8)) != 0
}

// PlayerKnows : ce joueur peut-il RAISONNER sur cette case (explorée ou visible) ?
// C'est la question que se posent les joueurs-IA — pas « est-ce que je la vois en ce
// moment », mais « est-ce que je sais ce qu'il y a là ».
func (g *GameState) PlayerKnows(playerID string, x, y int) bool {
	return g.PlayerExplored(playerID, x, y)
}

// --- vision courante ----------------------------------------------------------

// sightRadius rend le champ de vision d'un héros : base + PERCEPTION + Cartographe.
//
// ⚠ PLUS DE CAS PARTICULIER « ÉCLAIREUR ». Sa vision était un `if h.ClassID ==
// "eclaireur"` codé en dur ; elle vient maintenant de sa Perception 5, comme celle de
// tout le monde vient de la sienne. La classe cesse d'être une exception dans le moteur
// pour devenir un profil — et un héros qui porte l'Œil-de-lynx voit loin sans être
// éclaireur, ce qui est exactement ce qu'on attend d'un objet.
//
// ⚠ L'ÉQUIPEMENT COMPTE (heroGear) : les bonus ne sont prêtés qu'à l'unité de combat et
// ne touchent jamais `Hero.Stats`, donc hors combat il faut les rajouter à la main —
// même piège que le franchissement (climb.go).
func (g *GameState) sightRadius(h *Hero, mapperBonus int) int {
	w, gr := heroGear(h)
	perception := h.Stats.Perception + w.Perception + gr.Perception
	return heroSightRadius + perception/mapSightPerPerception + mapperBonus
}

// mapperBonus : ce que le Cartographe ajoute à la vision de chaque héros, et ce qu'il
// ajoute au rayon du bourg.
//
// LE CARTOGRAPHE (bâtiment de spécialité) : la ville dessine ce que ses héros
// rapportent, et chacun part avec une meilleure carte. Son dernier niveau relève aussi
// les abords du bourg. C'est l'axe « voir » — la carte d'une expédition de vingt fait
// 134², et sans lui on prospecte à l'aveugle une case à la fois.
func (g *GameState) mapperBonus() (heroes, town int) {
	c := g.buildingByID("cartographe")
	if c == nil || !c.Built || c.Durability <= 0 {
		return 0, 0
	}
	heroes = c.Level
	if heroes > 2 {
		heroes = 2 // le niveau 3 n'élargit plus la vision : il révèle les abords
	}
	if c.Level >= 3 {
		town = 2
	}
	return heroes, town
}

// eachCellInRadius appelle fn sur chaque case dans le rayon Chebyshev r.
func (g *GameState) eachCellInRadius(cx, cy, r int, fn func(idx, x, y int)) {
	for dy := -r; dy <= r; dy++ {
		for dx := -r; dx <= r; dx++ {
			x, y := cx+dx, cy+dy
			if x < 0 || y < 0 || x >= g.Width || y >= g.Height {
				continue
			}
			fn(y*g.Width+x, x, y)
		}
	}
}

// RevealVision met à jour la mémoire de chaque joueur à partir de ce que ses héros
// voient MAINTENANT, plus les sources PARTAGÉES (bourg, tours). Appelée depuis
// Recompute, donc après n'importe quelle action qui déplace un héros.
//
// ⚠ La mémoire est monotone (on n'oublie jamais une case explorée) ; c'est la VISION
// qui, elle, s'éteint quand on s'éloigne. Les deux ne doivent pas être confondues :
// c'est toute la différence entre « assombri » et « noir ».
func (g *GameState) RevealVision() {
	heroBonus, townBonus := g.mapperBonus()

	// 1. les sources PARTAGÉES vont dans la mémoire de TOUS les joueurs (et dans celle
	// de la partie legacy, clé vide) : le bourg et les tours sont le savoir commun de
	// l'expédition.
	keys := make([]string, 0, len(g.Players)+1)
	if len(g.Players) == 0 {
		keys = append(keys, "")
	} else {
		for _, p := range g.Players {
			keys = append(keys, p.ID)
		}
	}
	shared := func(cx, cy, r int) {
		g.eachCellInRadius(cx, cy, r, func(idx, x, y int) {
			g.Tiles[idx].Discovered = true
			for _, k := range keys {
				g.markExplored(k, idx)
			}
		})
	}
	// MIGRATION DES PARTIES D'AVANT LE BROUILLARD PAR JOUEUR. Une sauvegarde
	// existante porte des tuiles `Discovered` et AUCUN bitset : sans reprise, tous ses
	// joueurs se réveilleraient devant une carte noire et perdraient plusieurs jours
	// réels d'exploration. On sème donc une fois, à partir de la mémoire de
	// l'expédition. ⚠ Le test est `g.Explored == nil` — « personne n'a encore de
	// mémoire » — et pas « ce joueur-ci n'en a pas » : sinon un joueur qui rejoint en
	// cours de partie hériterait de l'exploration des autres, ce qui est exactement la
	// règle qu'on vient de supprimer.
	if g.Explored == nil {
		for _, k := range keys {
			for i := range g.Tiles {
				if g.Tiles[i].Discovered {
					g.markExplored(k, i)
				}
			}
		}
		g.exploredBits("") // au moins une clé : la carte n'est plus « jamais migrée »
	}
	shared(g.Town.X, g.Town.Y, townSightRadius+townBonus)
	for _, s := range g.sharedSightSources() {
		shared(s.x, s.y, s.r)
	}

	// 2. ce que voient les héros va dans la mémoire de LEUR joueur seulement.
	for _, h := range g.Heroes {
		if h.HP <= 0 {
			continue
		}
		key := g.viewerKey(g.OwnerOfHero(h.ID))
		r := g.sightRadius(h, heroBonus)
		g.eachCellInRadius(h.X, h.Y, r, func(idx, x, y int) {
			g.Tiles[idx].Discovered = true
			g.markExplored(key, idx)
		})
	}
}

// sightSource : un point qui éclaire un rayon.
type sightSource struct{ x, y, r int }

// sharedSightSources : ce qui éclaire POUR TOUT LE MONDE et EN PERMANENCE — la Tour de
// la ville et les tours de guet bâties sur les sommets (watchtower.go).
//
// ⚠ C'est le cœur de l'intérêt d'une tour : elle ne révèle pas seulement, elle
// CONSERVE. Une case dans le rayon d'une tour n'est jamais assombrie et ses monstres
// restent servis — c'est une caméra posée sur le monde, et c'est ce qui fait qu'on
// accepte d'aller la bâtir en haut d'une mesa.
func (g *GameState) sharedSightSources() []sightSource {
	var out []sightSource
	// La Tour du bourg : la demande dit « la tour de la ville, une fois construite,
	// aurait un effet similaire ». Son rayon suit son niveau.
	if b := g.buildingByID("tower"); b != nil && b.Built && b.Durability > 0 {
		out = append(out, sightSource{g.Town.X, g.Town.Y, townTowerSight(b.Level)})
	}
	for _, wt := range g.Watchtowers {
		if wt.Built {
			out = append(out, sightSource{wt.X, wt.Y, WatchtowerSight})
		}
	}
	return out
}

// townTowerSight : le rayon de veille de la Tour du bourg, par niveau.
func townTowerSight(level int) int {
	if level < 1 {
		level = 1
	}
	return 4 + 2*(level-1) // 4 · 6 · 8
}

// VisibleNow rend l'ensemble des cases ÉCLAIRÉES pour ce joueur en ce moment : ses
// héros vivants, le bourg, et toutes les tours (partagées).
//
// ⚠ Dérivé à chaque appel, jamais persisté : la visibilité est une fonction de l'état
// courant, et la mémoriser reviendrait à réinventer le bug qu'on corrige (une carte
// qui se colorie sans jamais s'éteindre).
func (g *GameState) VisibleNow(playerID string) []bool {
	vis := make([]bool, len(g.Tiles))
	heroBonus, townBonus := g.mapperBonus()
	light := func(cx, cy, r int) {
		g.eachCellInRadius(cx, cy, r, func(idx, x, y int) { vis[idx] = true })
	}
	light(g.Town.X, g.Town.Y, townSightRadius+townBonus)
	for _, s := range g.sharedSightSources() {
		light(s.x, s.y, s.r)
	}
	key := g.viewerKey(playerID)
	for _, h := range g.Heroes {
		if h.HP <= 0 {
			continue
		}
		// ⚠ en partie legacy (clé vide) TOUS les héros éclairent : il n'y a pas de
		// joueurs, donc pas de « mes » héros.
		if key != "" && g.OwnerOfHero(h.ID) != key {
			continue
		}
		light(h.X, h.Y, g.sightRadius(h, heroBonus))
	}
	return vis
}

// ClientView returns a copy of the state that is safe to send to players. Voir
// ClientViewFor : cette forme sans destinataire ne sert que les appels internes et
// les parties legacy.
func (g *GameState) ClientView() *GameState { return g.ClientViewFor("") }

// ClientViewFor rend la copie destinée à UN joueur : les cases qu'il n'a jamais vues
// sont vierges, celles dont il se souvient sans les voir gardent leur TERRAIN mais
// perdent ce qui bouge, la graine du worldgen est effacée (graine + générateur
// reconstruiraient toute la carte) et le fil de discussion est retiré. Le récepteur
// n'est PAS modifié — la persistance et toute la logique de jeu continuent de
// travailler sur l'état complet.
func (g *GameState) ClientViewFor(playerID string) *GameState {
	cp := *g
	cp.Seed = 0
	// La mémoire des AUTRES joueurs n'a rien à faire sur le réseau : c'est de la donnée
	// de serveur, et elle pèse (un bitset par joueur).
	cp.Explored = nil
	// Le catalogue du thème voyage avec la partie (dérivé, jamais persisté — le blob
	// est écrit depuis `g`, où le champ reste nil). Le client n'a donc rien à charger
	// pour afficher « ❄️ Nordique » ni pour nommer les terrains.
	cp.ThemeInfo = g.Theme()
	// Le retard restant : posé ICI et nulle part ailleurs, donc jamais persisté (le
	// blob est écrit depuis `g`, où le champ reste faux). Voir CatchUpPending.
	cp.CatchUp = g.CatchUpPending(time.Now())
	// Le compte à rebours de l'escorte (R4) : ce que le joueur qui attend a le droit de
	// savoir. Dérivé lui aussi, donc jamais écrit dans le blob.
	if g.IsPublic() && g.Status == StatusLobby && len(g.Players) < g.MinPlayers {
		if since := g.waitingSince(); !since.IsZero() {
			cp.EscortAt = since.Add(PublicEscortWait)
		}
	}
	// The messaging board never rides the game payload: who may READ it depends on
	// the requesting player (in town, or the Poste built — see chat.go) and this
	// function has no idea who is asking. Only the count survives, so the ✉️ button
	// can carry an unread pip without leaking a word. Content is served by the
	// dedicated, gated GET /town/chat. (cp.Town is a value copy — g is untouched.)
	cp.Town.ChatCount = len(g.Town.Chat)
	cp.Town.Chat = nil

	// DEBUG « lever le brouillard » : envoie TOUTE la carte, éclairée, sans toucher au
	// vrai jeu de tuiles explorées de `g` — désactiver le flag rend le brouillard réel.
	if g.RevealAll {
		cp.Tiles = make([]Tile, len(g.Tiles))
		for i, t := range g.Tiles {
			t.Discovered = true
			t.Visible = true
			cp.Tiles[i] = t
		}
		return &cp
	}

	vis := g.VisibleNow(playerID)
	cp.Tiles = make([]Tile, len(g.Tiles))
	for i, t := range g.Tiles {
		switch {
		case vis[i]:
			t.Discovered, t.Visible = true, true
			cp.Tiles[i] = t
		case g.PlayerExplored(playerID, i%g.Width, i/g.Width):
			// SOUVENIR : le terrain, et rien de vivant. ⚠ `MonsterID` doit tomber, sinon
			// le client afficherait un pack à un endroit où il n'est peut-être plus —
			// mentir sur une position est pire que ne rien dire.
			t.Visible = false
			t.MonsterID = ""
			cp.Tiles[i] = t
		default:
			// jamais vue : tuile vierge (Discovered et Visible restent faux)
		}
	}
	// Les monstres ne sont servis que sur une case VISIBLE — c'est la règle
	// Warcraft III, et c'est elle qui donne son prix à la tour : ce qu'elle éclaire,
	// on le voit VIVRE.
	cp.Monsters = make(map[string]*Monster, len(g.Monsters))
	for id, m := range g.Monsters {
		if idx := m.Y*g.Width + m.X; idx >= 0 && idx < len(vis) && vis[idx] {
			cp.Monsters[id] = m
		}
	}
	// Les ruines, elles, sont un élément de TERRAIN : une fois repérée, une ruine ne
	// se déplace pas, donc elle reste sur la carte de mémoire (contrairement aux
	// monstres). C'est la même distinction que WC3 fait entre un bâtiment et une unité.
	cp.Ruins = make(map[string]*Ruin, len(g.Ruins))
	for id, ru := range g.Ruins {
		if cp.Tiles[ru.Y*g.Width+ru.X].Discovered {
			cp.Ruins[id] = ru
		}
	}
	cp.Watchtowers = make(map[string]*Watchtower, len(g.Watchtowers))
	for id, wt := range g.Watchtowers {
		if cp.Tiles[wt.Y*g.Width+wt.X].Discovered {
			cp.Watchtowers[id] = wt
		}
	}
	return &cp
}
