package game

// LE FROID — la contrainte de l'expédition nordique (theme.go).
//
// Deux faces d'une même idée : DEHORS la neige, DEDANS le feu.
//
//  1. LA NEIGE RECOUVRE LES CASES et interrompt la FOUILLE AUTOMATIQUE. C'est la face la
//     plus intéressante : elle répond au seul reproche qu'on puisse faire au campement
//     (forage.go), qui est de se jouer tout seul une fois posé. Une case couverte ne
//     produit plus rien tant qu'un héros n'est pas revenu la dégager — et la dégager,
//     c'est simplement la FOUILLER (la fouille manuelle rend son butin comme d'habitude
//     ET déblaie la neige). Le coût de la neige est donc l'INTERRUPTION, pas un impôt :
//     rien n'est perdu, il faut revenir jouer.
//     ⚠ elle ne bloque JAMAIS le déplacement et ne blesse personne (règle 5 : ne jamais
//     piéger un joueur absent — un héros posté doit toujours pouvoir rentrer).
//
//  2. LES FOYERS DE LA VILLE BRÛLENT DU BOIS, à chaque vague, pris sur la Banque. Le bois
//     qui chauffe est le bois qui bâtit : c'est la concurrence directe avec la défense
//     que réclame la règle 3, et elle est COLLECTIVE (règle 2) — personne ne se chauffe
//     tout seul. Foyer éteint, tout le monde gèle ; foyer allumé, seuls ceux qui passent
//     la vague dehors ET à découvert gèlent, parce que se CACHER (1 PA), c'est déjà
//     trouver un abri. Le dilemme de Hordes gagne ainsi une seconde raison de rentrer au
//     lieu d'une mécanique de plus.
//
// ⚠ PAS DE BÂTIMENT NEUF. « Le brasier » a été conçu puis écarté : un bâtiment demande un
// modèle voxel, une parcelle dans le plan de ville, une entrée au catalogue et trois
// niveaux de design — et `buildingModelKey` transforme un modèle manquant en bâtiment
// INVISIBLE et incliquable. Les foyers d'une ville sont une fiction que le journal et
// l'ordre du jour portent très bien, et la mécanique (dépenser du bois chaque nuit) est
// exactement la même.

const (
	// StateGele : le froid mordant. Comme la Soif, il se paie en PA et jamais en PV.
	StateGele = "Gelé"
	// coldPA : ce que coûte une nuit de gel au réveil suivant.
	coldPA = 2
	// hearthFuelPerWave : ce que la ville brûle par vague pour tenir le gel dehors.
	hearthFuelPerWave = 1
)

// hearthFuels : ce qui brûle, DANS CET ORDRE — on brûle d'abord ce qui ne sert à rien
// d'autre.
//
// ⚠ LES DÉBRIS EN PREMIER, et c'est le réglage qui a sauvé la mécanique. Mesuré avec le
// seul bois : les foyers étaient éteints 46 nuits sur 48, c'est-à-dire que la contrainte
// n'était plus un choix mais un impôt permanent — le bois part dans les chantiers à
// mesure qu'il rentre, et le thème a justement éloigné la forêt en enneigeant les
// abords. Les Débris, eux, ne servaient qu'à la Recyclerie : les brûler DÉCOUPLE le feu
// de l'économie de construction, donne une seconde vie à un objet de rebut, et rend la
// nuit tenable pour qui ramasse ce qui traîne. Le bois vient ensuite, le charbon en
// dernier — il est le nerf de l'acier, et une ville qui l'aurait brûlé se retrouverait
// sans portail de niveau 3 pour s'être chauffée.
var hearthFuels = []string{"Débris", "Bois", "Charbon"}

// burnHearth consomme le combustible de la nuit et rend `true` si les foyers tiennent.
// Ne fait rien (et rend true) hors d'un thème qui a froid : une contrainte de thème ne
// déborde jamais sur les autres cartes.
func (g *GameState) burnHearth() bool {
	if !g.Theme().Cold {
		return true
	}
	for _, fuel := range hearthFuels {
		if g.storageQty(fuel) >= hearthFuelPerWave {
			g.removeStorage(fuel, hearthFuelPerWave)
			return true
		}
	}
	return false
}

// applyCold pose (ou retire) le gel sur chaque héros. Appelée à chaque vague, AVANT que
// les héros dehors soient pris à partie : `attackHeroesOutside` consomme l'état Caché,
// et se cacher est justement ce qui abrite du froid.
func (g *GameState) applyCold(lit bool) {
	if !g.Theme().Cold {
		return
	}
	for _, h := range g.Heroes {
		if h.HP <= 0 {
			continue
		}
		inTown := h.X == g.Town.X && h.Y == g.Town.Y
		sheltered := lit && (inTown || h.HasState(StateCache))
		if sheltered {
			h.RemoveState(StateGele) // on se réchauffe
			continue
		}
		h.AddState(StateGele)
	}
}

// coldPenalty rend les PA en moins au réveil d'un héros gelé (0 sinon). Même forme que
// thirstPenalty : les deux se cumulent, et le plancher d'un PA de la régénération
// garantit qu'un héros transi n'est jamais immobilisé.
func coldPenalty(h *Hero) int {
	if h.HasState(StateGele) {
		return coldPA
	}
	return 0
}

// --- la neige qui recouvre -----------------------------------------------------------

// snowfallDivisor : une tuile sur ce nombre est recouverte à chaque vague. Réglé pour
// qu'une case donnée soit ensevelie environ une fois tous les quinze tours, c'est-à-dire
// assez pour qu'un campement soit interrompu une fois par jour ou deux — pas à chaque
// vague, sinon la fouille automatique n'existerait plus du tout.
const snowfallDivisor = 60

// snowmeltDivisor : une case enneigée sur ce nombre dégèle à chaque vague. Sans dégel
// la neige S'ACCUMULE indéfiniment — mesuré sans lui : 2787 cases couvertes en fin de
// partie, soit un quart de la carte gelé pour toujours, ce qui n'est plus une météo mais
// une amputation. Avec, la couverture trouve un équilibre (≈ snowmeltDivisor × la chute
// par vague) et le joueur voit la neige aller et venir.
const snowmeltDivisor = 8

// snowmelt fait fondre une partie de la neige au sol.
func (g *GameState) snowmelt() int {
	if !g.Theme().Snowfall {
		return 0
	}
	melted := 0
	for i := range g.Tiles {
		if !g.Tiles[i].Covered {
			continue
		}
		if randIntn(snowmeltDivisor) != 0 {
			continue
		}
		g.Tiles[i].Covered = false
		melted++
	}
	return melted
}

// snowfall recouvre quelques cases de neige fraîche. Balayage en ORDRE DE TUILE (règle
// « ordre d'itération = état » : deux instances qui rejouent la même vague doivent
// aboutir au même monde), tirage par le générateur du jeu.
func (g *GameState) snowfall() int {
	if !g.Theme().Snowfall {
		return 0
	}
	land := 0
	for _, t := range g.Tiles {
		if t.Biome.Walkable() {
			land++
		}
	}
	want := land / snowfallDivisor
	if want < 1 {
		want = 1
	}
	covered := 0
	for i := range g.Tiles {
		if covered >= want {
			break
		}
		t := &g.Tiles[i]
		x, y := i%g.Width, i/g.Width
		if t.Covered || !t.Biome.Walkable() || (x == g.Town.X && y == g.Town.Y) {
			continue
		}
		// Le tirage porte sur CHAQUE case, pas sur une liste : une carte de vingt
		// joueurs et une carte de solo doivent enneiger la même proportion.
		if randIntn(snowfallDivisor) != 0 {
			continue
		}
		t.Covered = true
		covered++
	}
	return covered
}
