package game

// L'ATHLÉTISME DÉCIDE DE CE QU'ON ESCALADE — en combat ET sur la carte.
//
// L'audit du 2026-08-16 avait rendu la statistique vivante dans l'arène (climbLimit)
// mais le monde, lui, restait parfaitement plat à la marche : `MoveHero` acceptait
// n'importe quel pas orthogonal sur une case praticable, quelle que soit la falaise.
// Une carte peut désormais avoir des ESCARPEMENTS (worldgen `carveEscarpments`) qu'un
// héros ordinaire ne franchit pas : il doit faire le tour, ou emmener quelqu'un — ou
// quelque chose — qui grimpe.
//
// ⚠ UNE SEULE STATISTIQUE, UN SEUL DIVISEUR, DEUX PLANCHERS. La formule est
// `plancher + athlétisme/climbPerAthletisme` des deux côtés, pour que le joueur
// n'ait qu'une règle à apprendre. Les planchers diffèrent, et c'est délibéré :
//
//   - ARÈNE, plancher 2 — une arène est un espace clos de 7×7 dont on ne sort pas.
//     Y être bloqué par le relief serait une punition arbitraire (et les terrasses
//     de montagne montent à 3). C'est la valeur qui était codée en dur avant :
//     personne ne perd rien.
//   - CARTE, plancher 1 — le monde a des détours PAR CONSTRUCTION (les escarpements
//     laissent des cols) et la carte se parcourt sur plusieurs jours réels. Un mur
//     qu'on contourne y est une décision, pas une impasse.
//
// ⚠ LA HORDE NE GRIMPE PAS, ELLE IGNORE. `migrateMonstersTowardTown` (wave.go) ne
// regarde que la praticabilité du biome, pas le relief, et ça doit RESTER ainsi — ce
// n'est pas un oubli. Une falaise est une énigme posée au joueur, pas un affaiblisse-
// ment de la pression : gater la migration reviendrait à ce que certaines graines
// offrent un rempart naturel et d'autres non, donc à rendre la difficulté dépendante
// du tirage du terrain. La courbe de survie est réglée à la mesure (`cmd/balance`) et
// on ne la fait pas bouger par un effet de bord de décor.
//
// ⚠ L'ÉQUIPEMENT COMPTE SUR LA CARTE AUSSI. Les bonus d'équipement ne sont PRÊTÉS
// qu'à l'unité de combat (equipment.go) et ne touchent jamais `Hero.Stats` — donc
// hors combat il faut les rajouter explicitement, sinon des bottes de grimpeur ne
// feraient rien là où elles ont le plus de sens : sur la falaise.

// climbPerAthletisme : points d'athlétisme pour un niveau de franchissement de plus.
//
// Calibré sur les valeurs RÉELLES du jeu et pas au hasard : les quatre blocs de
// départ (lobby.go `starterStats`) donnent 2, 3, 3 et 4 d'athlétisme — donc à 5,
// AUCUN héros neuf ne franchit un escarpement, ce qui rend la falaise lisible dès
// la première partie. Les trois classes qui portent `Athletisme: 5` (éclaireur,
// récupérateur, herboriste — celles-là mêmes dont la statistique ne servait à rien)
// passent à 7-9 et grimpent : c'est leur identité de terrain, enfin visible.
const climbPerAthletisme = 5

const (
	arenaClimbBase = 2 // cf. ci-dessus : jamais moins que l'ancienne valeur en dur
	mapClimbBase   = 1
)

// climbFrom : la formule partagée. Un seul endroit où elle s'écrit.
func climbFrom(athletisme, base int) int {
	if athletisme < 0 {
		athletisme = 0
	}
	return base + athletisme/climbPerAthletisme
}

// heroAthletisme : l'athlétisme EFFECTIF d'un héros sur la carte, équipement compris.
func heroAthletisme(h *Hero) int {
	if h == nil {
		return 0
	}
	w, g := heroGear(h)
	return h.Stats.Athletisme + w.Athletisme + g.Athletisme
}

// HeroClimb rend l'écart de hauteur qu'un héros franchit d'un pas sur la CARTE.
// Exporté : le client en a besoin pour n'afficher que les pas réellement possibles
// (VoxelMapView) — et la fiche de personnage pour l'annoncer.
func HeroClimb(h *Hero) int { return climbFrom(heroAthletisme(h), mapClimbBase) }

// TooSteep : le pas de (fx,fy) vers (tx,ty) dépasse ce que ce héros escalade.
//
// ⚠ SYMÉTRIQUE (valeur absolue), comme en combat : une descente vertigineuse bloque
// autant qu'une montée. On pourrait plaider qu'on saute plus bas qu'on ne grimpe,
// mais une règle asymétrique produit la pire interface qui soit — « j'y suis allé et
// je ne peux plus revenir ». Le joueur doit pouvoir lire une falaise dans les deux
// sens.
//
// ⚠ Une case NON DÉCOUVERTE ne bloque jamais : `ClientView` la sert vierge (hauteur
// 0), donc le client ne peut pas prédire l'issue — et le serveur ne doit pas refuser
// pour une raison que le joueur n'avait aucun moyen de voir. L'exploration au contact
// reste la règle (le pas est payé, la case est révélée).
func (g *GameState) TooSteep(h *Hero, fx, fy, tx, ty int) bool {
	from, to := g.TileAt(fx, fy), g.TileAt(tx, ty)
	if from == nil || to == nil || !to.Discovered {
		return false
	}
	return absI(to.Height-from.Height) > HeroClimb(h)
}
