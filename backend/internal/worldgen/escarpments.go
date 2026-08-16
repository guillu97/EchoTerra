package worldgen

// LES ESCARPEMENTS — le relief cesse d'être décoratif.
//
// LE TROU. `Tile.Height` était commenté « cosmetic elevation on the global map », et
// c'était exact : `MoveHero` acceptait n'importe quel pas orthogonal vers une case
// praticable, quelle que soit la dénivellation. Pire, la carte ne POUVAIT pas porter
// de falaise : `smoothLevels` (genMaxStep 1) garantit que deux voisines ne diffèrent
// jamais de plus d'un niveau. Poser une règle d'escalade sur cette carte-là n'aurait
// rien bloqué du tout — la règle aurait existé sans jamais s'appliquer.
//
// ⚠ TROIS APPROCHES ONT ÉTÉ ESSAYÉES ET MESURÉES AVANT CELLE-CI. Elles sont écrites
// ici parce qu'aucune ne se laisse deviner à la lecture du code : les trois semblaient
// correctes, et les trois donnaient une carte où l'athlétisme n'ouvrait rien.
//
//  1. RELEVER UNE PARTIE DE LA BORDURE des massifs (60 % des tuiles de rive). Produit
//     bien des marches de 2 — 685 sur une carte 60² — mais **détour médian 0**. Une
//     bordure dont 40 % des cases restent basses est une passoire : on entre par la
//     case d'à côté, donc on ne fait jamais le tour.
//  2. RELEVER LE MASSIF ENTIER (composante connexe de biome montagne/neige).
//     Négligeable : **0,05 % de la carte** hors d'atteinte. La raison ne se voit qu'à
//     la mesure — dans ce générateur un biome HAUT n'est presque jamais un relief
//     HAUT. `biomeFromLevel` ne rend « montagne » qu'au niveau 5 sur 6, or
//     `smoothLevels` rabote les sommets (c'est déjà pourquoi la neige n'existait pas
//     avant `snowCaps`) : il reste une SIXAINE de tuiles de relief authentique par
//     carte 60². Les ~340 autres tuiles de biome haut viennent d'`ensureNearbyBiomes`
//     et d'`applyThemeBias`, qui changent le biome SANS toucher à la hauteur. Escarper
//     « la montagne » revenait à escarper une plaine peinte en gris.
//  3. RELEVER DES DISQUES DE +1, rive adoucie au tirage. Deux fuites, encore 0,00 % :
//     chaque tuile écartée du bord restait à son altitude et touchait le plateau d'un
//     côté, la plaine de l'autre — c'était donc un col ; et surtout, un disque posé sur
//     une PENTE a toujours un côté amont où le +1 le met à FLEUR du terrain voisin.
//     Une élévation uniforme sur un sol qui ne l'est pas ne produit pas une marche
//     uniforme.
//
// CE QUE FAIT CETTE PASSE. Elle taille de vraies MESAS, à sommet plat et à pied
// nivelé — la seule construction qui donne une marche CONSTANTE :
//
//	sommet  = base + 2   (plat : aucune marche à l'intérieur)
//	pied    = base       (l'anneau tout autour, nivelé)
//	falaise = 2 exactement, sur tout le pourtour
//
// Deux, et pas trois : c'est le nombre qui fait tout. Une marche de 2 est
// infranchissable pour un héros ordinaire (climb.go : 1 + athlétisme/5, et aucun héros
// neuf n'atteint 5) et franchissable par un grimpeur — classe d'exploration, ou
// simplement Bottes cloutées. À 3 plus personne ne monterait et la mesa serait un
// décor ; à 1 tout le monde monterait et il n'y aurait pas de règle.
//
// Une partie des mesas reçoit des RAMPES à `base+1` — deux marches de 1, que tout le
// monde gravit. Les autres restent SCELLÉES : on n'y accède qu'en grimpant. C'est là
// que « des zones inaccessibles si pas assez de stats » se produit vraiment.
//
// ⚠ LE RELIEF, PAS LE BIOME. Une mesa ne change AUCUN biome — ni le sien, ni celui de
// personne. C'est ce qui rend la fonctionnalité sûre : les tables de fouille, les
// biomes d'apparition des espèces, `ensureNearbyBiomes` et la liste de courses des
// bots (qui cherche littéralement « Bois » et « Pierre ») voient exactement la carte
// qu'ils voyaient avant. Une prairie relevée reste une prairie — simplement, elle est
// en hauteur.
//
// ⚠ UNE MESA EST UNE POCHE, JAMAIS UN MUR. Elle est convexe et entourée d'un anneau
// praticable : le reste de la carte se contourne sans elle. C'est ce qui autorise à en
// sceller quelques-unes sans risquer de couper une région du monde. Ce qu'on perd tant
// qu'on ne grimpe pas, ce sont ses ressources et ce qui s'y trouve — pas un passage.

import (
	"math"
	"math/rand"

	"echoterra/internal/game"
)

const (
	// plateauPerTiles : une mesa par tranche de surface praticable. C'est le bouton
	// qui décide de la part de carte gardée en hauteur.
	plateauPerTiles = 420
	plateauMinR     = 3
	plateauMaxR     = 6
	// plateauTownKeepOut : pas de falaise sur le pas de la porte. Le bourg doit
	// pouvoir sortir dans toutes les directions dès la première vague.
	plateauTownKeepOut = 9
	// plateauMinTiles : en dessous, la mesa ne vaut pas la peine — trop petite pour
	// qu'en faire le tour se sente, trop petite pour porter quoi que ce soit.
	plateauMinTiles = 9
	// colsPerTiles : une rampe par tranche de tuiles de sommet, en plus de la première.
	colsPerTiles = 40
	// sealedPlateauPct : la part des mesas SANS aucune rampe. ⚠ C'est ce réglage, et
	// rien d'autre, qui répond à « des zones inaccessibles si pas assez de stats » :
	// tant que chaque hauteur gardait un passage, tout restait atteignable par un
	// détour et la statistique n'ouvrait rien.
	sealedPlateauPct = 45
)

var orthDirs = [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}

// carveEscarpments taille les mesas. Renvoie le nombre de tuiles de sommet posées
// (la sonde de mesure et les tests le lisent).
func carveEscarpments(gs *game.GameState, rng *rand.Rand) int {
	walkable := 0
	for i := range gs.Tiles {
		if gs.Tiles[i].Biome.Walkable() {
			walkable++
		}
	}
	want := walkable / plateauPerTiles
	if want < 1 {
		want = 1
	}
	used := make([]bool, len(gs.Tiles)) // sommet OU pied déjà pris : jamais deux fois
	used[gs.Town.Y*gs.Width+gs.Town.X] = true

	total := 0
	// On tente bien plus souvent qu'on ne veut de mesas : beaucoup de tirages tombent
	// sur un terrain trop accidenté et sont refusés (voir tryMesa). Les essais sont
	// bornés — mieux vaut une mesa de moins que boucler sur une carte très aquatique.
	for tries, made := 0, 0; tries < want*20 && made < want; tries++ {
		if n := tryMesa(gs, rng, used); n > 0 {
			total += n
			made++
		}
	}
	openStarterPasses(gs)
	return total
}

// tryMesa tente UNE mesa. Renvoie le nombre de tuiles de sommet, ou 0 si le tirage est
// refusé (bord de carte, eau, mesa voisine, ou pied trop pentu).
func tryMesa(gs *game.GameState, rng *rand.Rand, used []bool) int {
	w, h := gs.Width, gs.Height
	cx, cy := rng.Intn(w), rng.Intn(h)
	if t := gs.TileAt(cx, cy); t == nil || !t.Biome.Walkable() {
		return 0
	}
	if maxW(absW(cx-gs.Town.X), absW(cy-gs.Town.Y)) < plateauTownKeepOut {
		return 0
	}
	r := plateauMinR + rng.Intn(plateauMaxR-plateauMinR+1)
	// RIVE IRRÉGULIÈRE MAIS FERMÉE : le rayon varie par SECTEUR (huit octants) et non
	// par tuile. ⚠ Un tirage par tuile perce le bord, et chaque trou est un col — la
	// fuite mesurée de l'approche 3. Un rayon par secteur donne une silhouette tout
	// aussi irrégulière, dont la frontière reste une courbe fermée.
	var sector [8]int
	for k := range sector {
		sector[k] = rng.Intn(3) - 1
	}
	inside := func(dx, dy int) bool {
		oct := 0
		if dx != 0 || dy != 0 {
			oct = int(math.Atan2(float64(dy), float64(dx))/(math.Pi/4)+8.5) % 8
		}
		re := r + sector[oct]
		if re < 2 {
			re = 2
		}
		return dx*dx+dy*dy <= re*re
	}

	var top []int
	for dy := -r - 1; dy <= r+1; dy++ {
		for dx := -r - 1; dx <= r+1; dx++ {
			x, y := cx+dx, cy+dy
			if x < 0 || y < 0 || x >= w || y >= h || !inside(dx, dy) {
				continue
			}
			i := y*w + x
			// ⚠ jamais l'eau (ça casserait le trait de côte que tout le générateur
			// suppose), jamais une tuile déjà prise par une autre mesa : deux sommets
			// mitoyens produiraient une marche que personne ne franchit.
			if !gs.Tiles[i].Biome.Walkable() || used[i] {
				return 0
			}
			top = append(top, i)
		}
	}
	if len(top) < plateauMinTiles {
		return 0
	}
	inTop := map[int]bool{}
	for _, i := range top {
		inTop[i] = true
	}
	// LE PIED : l'anneau praticable qui entoure le sommet. C'est son nivellement qui
	// rend la falaise CONSTANTE.
	footSet := map[int]bool{}
	for _, i := range top {
		ix, iy := i%w, i/w
		for _, d := range orthDirs {
			nx, ny := ix+d[0], iy+d[1]
			if nx < 0 || ny < 0 || nx >= w || ny >= h {
				return 0 // une mesa qui touche le bord de carte n'a pas de pied complet
			}
			ni := ny*w + nx
			if inTop[ni] {
				continue
			}
			if !gs.Tiles[ni].Biome.Walkable() || used[ni] {
				return 0 // pied incomplet (eau, autre mesa) : on renonce à ce tirage
			}
			footSet[ni] = true
		}
	}
	if len(footSet) == 0 {
		return 0
	}
	// La base : la hauteur la plus fréquente au pied. ⚠ On REFUSE le tirage si le pied
	// s'écarte de plus d'un niveau de cette base — niveler une pente entière créerait,
	// à l'EXTÉRIEUR de l'anneau, la marche de 3 que plus personne ne franchit. C'est
	// pour ça qu'on tente vingt fois plus de mesas qu'on n'en veut.
	freq := map[int]int{}
	for i := range footSet {
		freq[gs.Tiles[i].Height]++
	}
	base, best := 0, -1
	for hgt, n := range freq {
		if n > best || (n == best && hgt < base) {
			base, best = hgt, n
		}
	}
	for i := range footSet {
		if absW(gs.Tiles[i].Height-base) > 1 {
			return 0
		}
	}

	// Application : sommet plat à base+2, pied nivelé à base — falaise de 2 exactement
	// sur tout le pourtour.
	for i := range footSet {
		gs.Tiles[i].Height = base
		used[i] = true
	}
	for _, i := range top {
		gs.Tiles[i].Height = base + 2
		used[i] = true
	}

	// LES RAMPES : une tuile de sommet touchant le pied redescend à base+1, ce qui
	// fait deux marches de 1. Une mesa scellée n'en reçoit aucune.
	if rng.Intn(100) >= sealedPlateauPct {
		var rim []int
		for _, i := range top {
			ix, iy := i%w, i/w
			for _, d := range orthDirs {
				if footSet[(iy+d[1])*w+ix+d[0]] {
					rim = append(rim, i)
					break
				}
			}
		}
		ramps := 1 + len(top)/colsPerTiles
		for k := 0; k < ramps && len(rim) > 0; k++ {
			j := rng.Intn(len(rim))
			gs.Tiles[rim[j]].Height = base + 1
			rim = append(rim[:j], rim[j+1:]...)
		}
	}
	return len(top)
}

// openStarterPasses garantit qu'une expédition NEUVE atteint du BOIS et de la PIERRE —
// les deux matériaux sans lesquels aucun chantier ne démarre.
//
// ⚠ VOLONTAIREMENT ÉTROIT. Garantir l'accès à CHAQUE hauteur annulerait la
// fonctionnalité (essayé, mesuré : détour médian 0, 0 % d'inaccessible) ; une mesa
// lointaine DOIT pouvoir exiger un grimpeur. Le joueur n'est jamais coincé pour autant :
// les Bottes cloutées se forgent au premier niveau d'atelier avec du cuir, de la corde
// et un minerai.
//
// En pratique ce filet ne se déclenche presque jamais — les mesas se posent à distance
// du bourg et `ensureNearbyBiomes` y a déjà placé bois et pierre. Il existe pour les
// cartes où une mesa tombe pile sur le gisement garanti : cas rare, mais fatal. C'est
// la famine déjà mesurée deux fois dans l'histoire de ce projet (quota de biomes
// absolu, puis rayon indexé sur la taille de carte) ; on ne la remet pas en place pour
// une histoire de relief.
func openStarterPasses(gs *game.GameState) {
	// La boucle : raboter un chemin peut, par ricochet, en casser un autre (le
	// nivellement déplace des tuiles qui appartiennent aussi au voisinage d'ailleurs).
	// On re-vérifie donc après chaque passe, avec une borne dure.
	for round := 0; round < 8; round++ {
		d1 := distancesFrom(gs, 1)
		// ⚠ LE BOIS, PUIS LA PIERRE — et la pierre se lit sur DEUX biomes. C'est
		// exactement la règle d'`ensureNearbyBiomes`, qui remplit son quota avec de la
		// montagne OU de la neige : mesuré, une carte nordique 40² peut ne contenir
		// ZÉRO tuile de biome montagne et n'en être pas moins pourvue en pierre (le
		// sol gelé en donne depuis que sa table a été réglée). Ne chercher que la
		// montagne faisait donc échouer la garantie sur une carte parfaitement saine.
		groups := [][]game.Biome{
			{game.BiomeForest},
			{game.BiomeMountain, game.BiomeSnow},
		}
		var missing []game.Biome
		for _, grp := range groups {
			ok := false
			for _, b := range grp {
				if reachesBiome(gs, d1, b) {
					ok = true
					break
				}
			}
			if !ok {
				missing = grp
				break
			}
		}
		if missing == nil {
			return
		}
		target := nearestOfAny(gs, distancesFrom(gs, 2), missing)
		if target < 0 {
			return // hors d'atteinte même en grimpant : ce n'est pas une falaise
		}
		// ⚠ ON RABOTE DU BOURG VERS LA CIBLE, jamais l'inverse. Un premier jet
		// remontait le chemin de la cible vers le bourg en ajustant chaque tuile sur
		// son PARENT — mais le parent était ensuite ajusté à son tour sur le sien, ce
		// qui défaisait la correction précédente. Mesuré : le filet ne rattrapait rien
		// (carte 40², graine 2, montagne hors d'atteinte). En partant du bourg, chaque
		// tuile s'aligne sur un parent DÉJÀ définitif.
		prev := bfsPrev(gs, 2)
		var path []int
		for i := target; i >= 0; i = prev[i] {
			path = append(path, i)
		}
		for k := len(path) - 2; k >= 0; k-- {
			p, i := path[k+1], path[k]
			if d := gs.Tiles[i].Height - gs.Tiles[p].Height; d > 1 {
				gs.Tiles[i].Height = gs.Tiles[p].Height + 1
			} else if d < -1 {
				gs.Tiles[i].Height = gs.Tiles[p].Height - 1
			}
		}
		// Raboter une tuile peut l'éloigner de ses AUTRES voisines : on rétablit
		// l'invariant « jamais plus de 2 » sur toute la carte. Cette relaxation ne
		// fait qu'ABAISSER, donc elle ne peut que rendre le monde plus praticable — et
		// elle laisse les mesas intactes, qui dominent leur pied d'exactement 2.
		clampSteps(gs, 2)
	}
}

// clampSteps abaisse les tuiles qui dépassent de plus de `maxStep` leur voisine la
// plus basse, jusqu'à stabilité. Même algorithme que le lissage du générateur
// (`smoothLevels`), avec un pas différent.
func clampSteps(gs *game.GameState, maxStep int) {
	w, h := gs.Width, gs.Height
	for changed, guard := true, 0; changed && guard < 64; guard++ {
		changed = false
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				i := y*w + x
				if !gs.Tiles[i].Biome.Walkable() {
					continue
				}
				minN := 1 << 30
				for _, d := range orthDirs {
					nx, ny := x+d[0], y+d[1]
					if nx < 0 || ny < 0 || nx >= w || ny >= h {
						continue
					}
					if n := gs.Tiles[ny*w+nx]; n.Biome.Walkable() && n.Height < minN {
						minN = n.Height
					}
				}
				if minN < 1<<30 && gs.Tiles[i].Height > minN+maxStep {
					gs.Tiles[i].Height = minN + maxStep
					changed = true
				}
			}
		}
	}
}

// reachesBiome : le parcours atteint-il au moins une tuile de ce biome ?
func reachesBiome(gs *game.GameState, dist []int, want game.Biome) bool {
	for i, t := range gs.Tiles {
		if t.Biome == want && dist[i] > 0 {
			return true
		}
	}
	return false
}

// nearestOfAny : la tuile la plus proche du bourg parmi ces biomes (−1 si aucune
// n'est atteignable, ce qui arrive légitimement quand le biome est absent de la carte).
func nearestOfAny(gs *game.GameState, dist []int, want []game.Biome) int {
	best, bestD := -1, 1<<30
	for i, t := range gs.Tiles {
		if dist[i] <= 0 || dist[i] >= bestD {
			continue
		}
		for _, b := range want {
			if t.Biome == b {
				best, bestD = i, dist[i]
				break
			}
		}
	}
	return best
}

// distancesFrom : distance en pas depuis le bourg, en ne franchissant que des marches
// ≤ climb. −1 = hors d'atteinte.
//
// ⚠ La marche se juge en valeur ABSOLUE, comme `GameState.TooSteep` : une descente
// vertigineuse arrête autant qu'une montée, sinon ce parcours promettrait des chemins
// que le jeu refuse ensuite.
func distancesFrom(gs *game.GameState, climb int) []int {
	w, h := gs.Width, gs.Height
	d := make([]int, len(gs.Tiles))
	for i := range d {
		d[i] = -1
	}
	start := gs.Town.Y*w + gs.Town.X
	d[start] = 0
	queue := []int{start}
	for len(queue) > 0 {
		c := queue[0]
		queue = queue[1:]
		cx, cy := c%w, c/w
		ct := &gs.Tiles[c]
		for _, dd := range orthDirs {
			nx, ny := cx+dd[0], cy+dd[1]
			if nx < 0 || ny < 0 || nx >= w || ny >= h {
				continue
			}
			ni := ny*w + nx
			nt := &gs.Tiles[ni]
			if d[ni] >= 0 || !nt.Biome.Walkable() || absW(nt.Height-ct.Height) > climb {
				continue
			}
			d[ni] = d[c] + 1
			queue = append(queue, ni)
		}
	}
	return d
}

// bfsPrev : le prédécesseur de chaque tuile dans le parcours en largeur depuis le
// bourg (pour remonter un chemin). −1 = bourg ou hors d'atteinte.
func bfsPrev(gs *game.GameState, climb int) []int {
	w, h := gs.Width, gs.Height
	prev := make([]int, len(gs.Tiles))
	seen := make([]bool, len(gs.Tiles))
	for i := range prev {
		prev[i] = -1
	}
	start := gs.Town.Y*w + gs.Town.X
	seen[start] = true
	queue := []int{start}
	for len(queue) > 0 {
		c := queue[0]
		queue = queue[1:]
		cx, cy := c%w, c/w
		ct := &gs.Tiles[c]
		for _, dd := range orthDirs {
			nx, ny := cx+dd[0], cy+dd[1]
			if nx < 0 || ny < 0 || nx >= w || ny >= h {
				continue
			}
			ni := ny*w + nx
			nt := &gs.Tiles[ni]
			if seen[ni] || !nt.Biome.Walkable() || absW(nt.Height-ct.Height) > climb {
				continue
			}
			seen[ni] = true
			prev[ni] = c
			queue = append(queue, ni)
		}
	}
	return prev
}
