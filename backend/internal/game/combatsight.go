package game

// LA VISION EN COMBAT — on ne frappe que ce qu'on voit.
//
// LE TROU. L'arène servait TOUT : chaque unité connaissait la position exacte de
// chaque ennemi, à travers les piliers, dès le premier round. La ligne de vue existait
// déjà (`hasLOS`) mais ne servait qu'aux TIRS : on ne pouvait pas tirer derrière un
// rocher, on savait quand même exactement qui s'y cachait. Il n'y avait donc aucune
// approche, aucune embuscade, et rien à gagner à contourner.
//
// LA RÈGLE. Chaque unité a une PORTÉE DE VISION (`Sight`) et voit une case si elle est
// dans ce rayon ET que la ligne de vue est dégagée. Une unité est connue de son camp
// adverse dès qu'UN de ses membres la voit — la vision est mise en commun, comme dans
// n'importe quel jeu de tactique : trois héros forment un champ, pas trois lucarnes.
//
// LA STATISTIQUE : **la PERCEPTION** (game.go).
//
// ⚠ CE FUT D'ABORD LA PRÉCISION, ET C'ÉTAIT UNE ERREUR. L'argument était qu'une
// statistique peut faire deux choses — l'Endurance porte les PV ET la réduction,
// l'Agilité le déplacement ET l'initiative. Mais dans ces deux cas c'est UNE idée vue
// sous deux angles ; « frapper juste » et « savoir ce qu'il y a là » sont deux idées
// différentes, et les coller ensemble tenait de la rhétorique. La Perception ne fait
// qu'UNE chose — jusqu'où je vois — mais elle la fait sur les DEUX surfaces du jeu :
// le rayon de brouillard levé sur la carte (fog.go) et la portée d'œil dans l'arène.
//
// ⚠ L'ÉCLAIREUR LA PORTE (Perception 5), et c'est ce qui lui donne enfin une identité
// chiffrée : il était jusque-là le clone statistique du Récupérateur et de
// l'Herboriste. Sa capacité « Éclairer » reste par-dessus — elle désigne une zone que
// même sa vue n'atteint pas — parce qu'une classe se joue autant qu'elle se chiffre.
//
// ⚠ LA RÈGLE EST SYMÉTRIQUE. Les monstres ne ciblent que ce qu'ils voient, avec la même
// formule. Une vision que seul le joueur subirait ne serait pas une règle mais un
// handicap — c'est exactement ce qu'on a écrit pour les recharges, et ça vaut ici.
//
// ⚠ ON NE PEUT PAS SE BLOQUER. Une unité qui ne voit RIEN avance quand même vers
// l'ennemi le plus proche (elle l'entend, disons) : sans cette soupape, deux camps
// aveugles resteraient plantés à se regarder jusqu'à la limite de rounds, ce qui n'est
// pas une tension mais une panne.

const (
	// combatSightBase : ce que voit une unité sans aucune précision. L'arène fait 7×7
	// (9×9 pour un boss), donc un rayon de 3 couvre déjà l'essentiel d'un côté : le
	// brouillard mord surtout au premier round et derrière les obstacles, ce qui est
	// exactement l'endroit où on le veut. Plus bas, le combat deviendrait un
	// tâtonnement ; c'est un jeu qu'on joue deux fois par jour, pas un roguelike.
	combatSightBase = 3
	// combatSightPerPerception : un point de portée tous les N points de perception.
	combatSightPerPerception = 3
	// spotRounds : combien de rounds une unité désignée par « Éclairer » reste
	// visible pour toute l'équipe, où qu'elle soit.
	spotRounds = 2
	// eclairerRadius : le rayon révélé par « Éclairer », autour de la case visée.
	eclairerRadius = 2
)

// Sight rend la portée de vision de l'unité.
func (u *CombatUnit) sight() int {
	s := combatSightBase + u.Stats.Perception/combatSightPerPerception
	if s < 1 {
		s = 1
	}
	return s
}

// canSee : cette unité distingue-t-elle celle-là ? Rayon de vision (Chebyshev — on
// voit aussi loin en diagonale, sinon le champ de vision serait un losange, qui se lit
// mal sur une grille) ET ligne de vue dégagée.
//
// ⚠ Le contact voit TOUJOURS : deux unités adjacentes se voient quoi qu'il arrive, même
// si le tracé de Bresenham rase un pilier. Sans cette exception, une unité collée à un
// rocher pouvait devenir invisible pour celle qui la touchait — et l'attaque de mêlée
// aurait été refusée sur une case qu'on occupe.
func (c *Combat) canSee(from, target *CombatUnit) bool {
	for _, a := range from.footprint() {
		for _, b := range target.footprint() {
			d := maxI(absI(b[0]-a[0]), absI(b[1]-a[1]))
			if d <= 1 {
				return true
			}
			if d <= from.sight() && c.hasLOS(a[0], a[1], b[0], b[1]) {
				return true
			}
		}
	}
	return false
}

// VisibleTo : l'unité `target` est-elle connue du camp `side` ? Vision MISE EN COMMUN
// (un allié qui la voit la révèle à tous) plus le marquage d'« Éclairer ».
func (c *Combat) VisibleTo(side string, target *CombatUnit) bool {
	if target == nil {
		return false
	}
	if target.Side == side {
		return true // on se voit toujours soi-même et ses alliés
	}
	if target.Spotted > 0 {
		return true // désigné par l'Éclaireur
	}
	for _, u := range c.Units {
		if u.Side == side && u.inBattle() && c.canSee(u, target) {
			return true
		}
	}
	return false
}

// tickSpots fait retomber les marquages d'« Éclairer » d'un round.
func (c *Combat) tickSpots() {
	for _, u := range c.Units {
		if u.Spotted > 0 {
			u.Spotted--
		}
	}
}

// spotArea marque toutes les unités adverses autour de (x,y) — l'effet d'« Éclairer ».
func (c *Combat) spotArea(caster *CombatUnit, x, y, r int) int {
	n := 0
	for _, o := range c.Units {
		if !o.inBattle() || o.Side == caster.Side {
			continue
		}
		for _, b := range o.footprint() {
			if maxI(absI(b[0]-x), absI(b[1]-y)) <= r {
				o.Spotted = spotRounds
				n++
				break
			}
		}
	}
	return n
}

// visibleEnemies rend les ennemis que ce camp distingue.
func (c *Combat) visibleEnemies(u *CombatUnit) []*CombatUnit {
	var out []*CombatUnit
	for _, o := range c.Units {
		if o.inBattle() && o.Side != u.Side && c.VisibleTo(u.Side, o) {
			out = append(out, o)
		}
	}
	return out
}

// SightView rend une COPIE du combat caviardée pour un camp : les unités adverses
// qu'il ne distingue pas sont retirées, ainsi que leur place dans l'ordre du tour.
//
// ⚠ ON RETIRE, ON NE MASQUE PAS. Servir une unité avec un drapeau « cachée » laisserait
// sa position dans le payload : n'importe qui lisant le réseau la verrait, et le
// brouillard ne serait qu'un effet d'affichage. La règle du serveur autoritatif est la
// même que sur la carte — ce que le joueur n'a pas le droit de savoir ne sort pas.
//
// ⚠ L'ORDRE DU TOUR garde les unités cachées : le retirer changerait les numéros de
// tour affichés et trahirait leur nombre. On garde donc `Order` intact et le client
// ignore simplement les identifiants qu'il ne connaît pas (la barre d'initiative le
// fait déjà pour les unités mortes).
func (c *Combat) SightView(side string) *Combat {
	cp := *c
	cp.Units = make([]*CombatUnit, 0, len(c.Units))
	for _, u := range c.Units {
		if u.Side == side || !u.inBattle() || c.VisibleTo(side, u) {
			cp.Units = append(cp.Units, u)
		}
	}
	return &cp
}
