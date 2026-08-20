package game

import "time"

// LE BROUILLARD DE GUERRE — trois états, et la carte d'une EXPÉDITION.
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
// ⚠⚠ LA MÉMOIRE EST CELLE DE L'EXPÉDITION (2026-08-19, seconde décision). Elle a été
// PAR JOUEUR pendant trois jours — « ne révélant les cases qu'aux joueurs qui s'y
// trouvent » — et la mesure a tranché contre : sur une partie solo de 10 vagues,
// l'humain connaissait 49 cases quand son équipe en avait découvert 132, et il voyait
// les silhouettes de ses coéquipiers se promener dans sa brume. Un premier correctif a
// versé l'exploration des joueurs-IA au pot commun ; l'utilisateur a tranché pour la
// règle entière : « les humains d'une même expédition doivent partager aussi ».
//
// UNE EXPÉDITION, UNE CARTE. Tout ce qu'un héros de la ville voit — de qui qu'il soit,
// humain ou joueur-IA — entre dans la mémoire commune, et la vision courante est
// l'UNION des champs de tous les héros vivants, plus le bourg et les tours. Ce qui se
// défend : cette ville partage déjà sa Banque, son Panneau, sa messagerie, son journal
// et son registre ; lui refuser sa carte était la seule chose qu'elle ne mettait pas en
// commun. Et le brouillard ne perd rien à devenir collectif — il garde ses TROIS ÉTATS,
// qui sont la vraie trouvaille de la refonte : une case que TOUT LE MONDE a quittée
// s'assombrit et cesse de servir ce qui bouge.
//
// ⚠ CE QUE ÇA RÈGLE, en plus du rapport : un joueur qui rejoint en cours de partie
// reçoit la carte de la ville au lieu d'un écran noir, et un coéquipier n'est jamais
// dessiné au-dessus d'une case dont personne n'a vu le terrain.
//
// ⚠ LES TOURS GARDENT LEUR RAISON D'ÊTRE : elles n'éclairent pas « pour tout le monde »
// (c'est devenu le cas de tout le monde), elles éclairent SANS PERSONNE SUR PLACE et
// ne s'éteignent jamais. C'est la seule façon de garder une case VISIBLE — donc ses
// monstres servis — quand l'expédition est ailleurs.
//
// ⚠ `Tile.Discovered` et le bitset disent maintenant la même chose ; le bitset reste
// parce qu'il est ce que la vue client interroge case par case, et `Tile.Discovered`
// parce que climb.go et la simulation d'équilibrage le lisent.

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

// --- la mémoire de l'expédition : un bit par case -----------------------------
//
// ⚠ UN BITSET, PAS UN `[]bool`. Une carte de vingt joueurs fait 134² = 17 956 cases ;
// en `[]bool` le JSON de la seule mémoire pèserait ~90 ko, réécrits à chaque vague. En
// bits c'est 2,2 ko. `[]byte` se sérialise en base64 par le paquet json, donc ça reste
// lisible et compact sans code de sérialisation à écrire. (Au temps de la mémoire par
// joueur, c'est ce choix qui évitait deux mégaoctets par partie ; il reste le bon.)

// expeditionKey : l'UNIQUE clé de la mémoire. Le champ reste une map pour une seule
// raison — lire sans conversion les sauvegardes écrites quand la mémoire était par
// joueur, repliées une fois par `foldMemories` — et pour qu'un retour en arrière ne
// coûte pas une migration de plus.
const expeditionKey = ""

func (g *GameState) exploredBits() []byte {
	if g.Explored == nil {
		g.Explored = map[string][]byte{}
	}
	need := (len(g.Tiles) + 7) / 8
	b := g.Explored[expeditionKey]
	if len(b) < need {
		nb := make([]byte, need)
		copy(nb, b)
		b = nb
		g.Explored[expeditionKey] = b
	}
	return b
}

// markExplored inscrit la case dans la mémoire de l'expédition.
func (g *GameState) markExplored(idx int) {
	if idx < 0 || idx >= len(g.Tiles) {
		return
	}
	b := g.exploredBits()
	b[idx/8] |= 1 << (idx % 8)
}

// TileExplored : l'expédition a-t-elle DÉJÀ vu cette case ? C'est la question que
// posent la vue client (pour servir un souvenir) et les joueurs-IA (pour savoir où
// aller) — pas « est-ce que je la vois en ce moment », mais « est-ce qu'on sait ce
// qu'il y a là ».
func (g *GameState) TileExplored(x, y int) bool {
	if x < 0 || y < 0 || x >= g.Width || y >= g.Height {
		return false
	}
	idx := y*g.Width + x
	b := g.Explored[expeditionKey]
	if idx/8 >= len(b) {
		return false
	}
	return b[idx/8]&(1<<(idx%8)) != 0
}

// migrateMemory rattrape les DEUX générations de sauvegardes antérieures. Appelée
// depuis RevealVision, donc à chaque Recompute : elle doit être idempotente et muette.
//
//  1. AVANT LE BITSET (`Explored == nil`) : la mémoire vivait dans `Tile.Discovered`.
//     Sans reprise, une partie en cours perdrait des jours réels d'exploration.
//  2. MÉMOIRE PAR JOUEUR (des clés autres que la clé d'expédition) : on fusionne tous
//     les bitsets — l'union, jamais l'intersection : personne ne doit RENDRE une case
//     qu'il connaissait — puis on supprime les clés par joueur, ce qui rend au blob JSON
//     sa taille d'origine (un bitset au lieu de vingt).
func (g *GameState) migrateMemory() {
	if g.Explored == nil {
		g.Explored = map[string][]byte{}
		bits := g.exploredBits()
		for i := range g.Tiles {
			if g.Tiles[i].Discovered {
				bits[i/8] |= 1 << (i % 8)
			}
		}
		return
	}
	if len(g.Explored) == 1 {
		if _, only := g.Explored[expeditionKey]; only {
			return
		}
	}
	bits := g.exploredBits()
	for k, b := range g.Explored {
		if k == expeditionKey {
			continue
		}
		for i := range b {
			if i < len(bits) {
				bits[i] |= b[i]
			}
		}
		delete(g.Explored, k)
	}
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

// RevealVision met à jour la mémoire de l'expédition à partir de ce que ses héros
// voient MAINTENANT, plus le bourg et les tours. Appelée depuis Recompute, donc après
// n'importe quelle action qui déplace un héros.
//
// ⚠ La mémoire est monotone (on n'oublie jamais une case explorée) ; c'est la VISION
// qui, elle, s'éteint quand tout le monde s'éloigne. Les deux ne doivent pas être
// confondues : c'est toute la différence entre « assombri » et « noir ».
func (g *GameState) RevealVision() {
	heroBonus, townBonus := g.mapperBonus()
	g.migrateMemory()

	reveal := func(cx, cy, r int) {
		g.eachCellInRadius(cx, cy, r, func(idx, x, y int) {
			g.Tiles[idx].Discovered = true
			g.markExplored(idx)
		})
	}
	reveal(g.Town.X, g.Town.Y, townSightRadius+townBonus)
	for _, s := range g.sharedSightSources() {
		reveal(s.x, s.y, s.r)
	}
	// ⚠ TOUS les héros, sans regarder à qui ils sont : c'est ça, « une expédition, une
	// carte ». Un héros MORT n'éclaire rien (il n'est plus là pour regarder), mais ce
	// qu'il a vu de son vivant reste acquis.
	for _, h := range g.Heroes {
		if h.HP <= 0 {
			continue
		}
		reveal(h.X, h.Y, g.sightRadius(h, heroBonus))
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

// VisibleNow rend l'ensemble des cases ÉCLAIRÉES en ce moment : les héros vivants de
// l'expédition, le bourg, et toutes les tours.
//
// ⚠ Dérivé à chaque appel, jamais persisté : la visibilité est une fonction de l'état
// courant, et la mémoriser reviendrait à réinventer le bug qu'on corrige (une carte
// qui se colorie sans jamais s'éteindre).
func (g *GameState) VisibleNow() []bool {
	vis := make([]bool, len(g.Tiles))
	heroBonus, townBonus := g.mapperBonus()
	light := func(cx, cy, r int) {
		g.eachCellInRadius(cx, cy, r, func(idx, x, y int) { vis[idx] = true })
	}
	light(g.Town.X, g.Town.Y, townSightRadius+townBonus)
	for _, s := range g.sharedSightSources() {
		light(s.x, s.y, s.r)
	}
	for _, h := range g.Heroes {
		if h.HP <= 0 {
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
	// Le bitset n'a rien à faire sur le réseau : c'est de la donnée de serveur, et le
	// client reçoit la même information sous une forme qu'il sait dessiner (les deux
	// drapeaux `discovered` / `visible` par tuile).
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

	vis := g.VisibleNow()
	cp.Tiles = make([]Tile, len(g.Tiles))
	for i, t := range g.Tiles {
		switch {
		case vis[i]:
			t.Discovered, t.Visible = true, true
			cp.Tiles[i] = t
		case g.TileExplored(i%g.Width, i/g.Width):
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
	// LES COÉQUIPIERS NE FLOTTENT PLUS DANS LA BRUME. Les héros étaient les SEULES
	// entités jamais caviardées : on voyait donc les silhouettes des autres joueurs se
	// promener au-dessus de cases dont personne n'avait vu le terrain — un personnage
	// posé sur du vide blanc, ce qu'un rapport de jeu a montré en capture.
	//
	// ⚠ Depuis que la carte est celle de l'expédition, un héros VIVANT est toujours sur
	// une case éclairée (il l'éclaire lui-même) : ce filtre ne retire donc plus que les
	// MORTS tombés hors de vue — que le client ne dessine pas, mais qui voyageaient
	// quand même. Il reste la garantie, en un endroit, qu'aucun personnage ne peut être
	// servi sur une case vierge.
	// ⚠ MES héros passent toujours : ce sont eux que je joue, morts compris (la fiche
	// et la résurrection en ont besoin).
	if playerID != "" {
		served := make([]*Hero, 0, len(g.Heroes))
		for _, h := range g.Heroes {
			idx := h.Y*g.Width + h.X
			known := idx >= 0 && idx < len(cp.Tiles) && cp.Tiles[idx].Discovered
			if known || g.OwnerOfHero(h.ID) == playerID {
				served = append(served, h)
			}
		}
		cp.Heroes = served
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
