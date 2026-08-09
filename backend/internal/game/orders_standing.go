package game

// LES CONSIGNES PERMANENTES — le filet, pas le pilote automatique.
//
// Réponse au trou T4 de RETENTION-PLAN.md. Les PA non dépensés sont PERDUS (h.PA =
// h.MaxPA à chaque vague, jamais cumulés) et un héros resté dehors encaisse
// 3 + numéro de vague. Un joueur qui saute une soirée revient donc à des héros blessés
// et une journée de travail évaporée — disproportionné pour un jeu explicitement conçu
// autour de deux sessions de cinq minutes par jour pendant une semaine.
//
// Une consigne se pose avant de fermer l'application et s'exécute AU DERNIER MOMENT,
// juste avant que la horde frappe. La fouille automatique (forage.go) avait déjà
// prouvé que le principe marche ; ceci l'étend aux deux gestes qui sauvent une absence.
//
// ⚠ TROIS BORNES DÉLIBÉRÉES, parce que la limite entre « filet » et « le jeu se joue
// tout seul » est exactement là :
//
//  1. une consigne ne dure QU'UNE vague — il faut revenir pour la reposer ;
//  2. elle n'engage JAMAIS de combat, ne fouille pas, ne bâtit pas — un joueur présent
//     fait strictement mieux, sinon on aurait résolu la rétention en supprimant le jeu ;
//  3. elle dépense les PA en aveugle, sans arbitrer comme le ferait un humain.

import "fmt"

// Les consignes qu'un héros peut recevoir.
const (
	OrderNone    = ""
	OrderShelter = "shelter" // se cacher avant la vague
	OrderReturn  = "return"  // rentrer en ville et y déposer son sac
)

// ValidOrder reports whether the string names a standing order.
func ValidOrder(o string) bool {
	return o == OrderNone || o == OrderShelter || o == OrderReturn
}

// OrderLabel rend le libellé d'une consigne (journal, interface).
func OrderLabel(o string) string {
	switch o {
	case OrderShelter:
		return "se cacher avant la vague"
	case OrderReturn:
		return "rentrer et déposer"
	}
	return "aucune"
}

// SetHeroOrder pose (ou retire) la consigne d'un héros. Gratuit : c'est une intention,
// pas une action — ce qu'elle coûte se paiera au moment de l'exécuter.
func (g *GameState) SetHeroOrder(heroID, order string) error {
	if !ValidOrder(order) {
		return ActionError{"consigne inconnue"}
	}
	h := g.HeroByID(heroID)
	if h == nil || h.HP <= 0 {
		return ActionError{"héros invalide"}
	}
	h.Order = order
	h.OrderWave = g.WaveNumber
	return nil
}

// runStandingOrders exécute les consignes juste avant que la horde frappe, puis les
// efface : une consigne vaut pour UNE vague, il faut revenir pour la reposer.
func (g *GameState) runStandingOrders() {
	for _, h := range g.Heroes {
		order := h.Order
		h.Order, h.OrderWave = OrderNone, 0 // consommée, quoi qu'il advienne
		if order == OrderNone || h.HP <= 0 || h.PA <= 0 {
			continue
		}
		if h.X == g.Town.X && h.Y == g.Town.Y {
			continue // déjà à l'abri : rien à faire
		}
		if h.HasState(StateTetanise) {
			// Cloué : ni fuir ni se cacher. La consigne ne peut rien, et surtout elle
			// ne va pas engager un combat à la place du joueur.
			g.logTown(fmt.Sprintf("⚠️ %s est tétanisé — sa consigne n'a pas pu s'appliquer", h.Name))
			continue
		}
		switch order {
		case OrderShelter:
			if !h.HasState(StateCache) {
				_ = g.HideHero(h.ID)
			}
		case OrderReturn:
			// ON NE PART QUE SI L'ON PEUT ARRIVER. Marcher sans pouvoir atteindre les
			// murs, c'est brûler ses PA pour finir à découvert — le même piège que les
			// bots ont connu : le dernier point doit rester disponible pour se cacher.
			// Rentrer était l'intention ; survivre était le but.
			dist := absI(g.Town.X-h.X) + absI(g.Town.Y-h.Y)
			if dist > h.PA {
				if !h.HasState(StateCache) {
					_ = g.HideHero(h.ID)
				}
				break
			}
			for h.PA > 0 && (h.X != g.Town.X || h.Y != g.Town.Y) {
				if !g.stepHomeOnce(h) {
					break // chemin coupé (pack, porte close) : on se rabat ci-dessous
				}
			}
			if h.X == g.Town.X && h.Y == g.Town.Y {
				if len(h.Inventory) > 0 {
					_, _ = g.DepositHeroLoot([]string{h.ID})
				}
			} else if h.PA > 0 && !h.HasState(StateCache) {
				_ = g.HideHero(h.ID)
			}
		}
	}
}

// stepHomeOnce avance d'une case vers la ville. Renvoie false quand aucun pas n'est
// possible (eau, pack, porte close) — l'appelant se rabat alors sur la dissimulation.
func (g *GameState) stepHomeOnce(h *Hero) bool {
	dirs := [][2]int{{signI(g.Town.X - h.X), 0}, {0, signI(g.Town.Y - h.Y)}}
	if absI(g.Town.Y-h.Y) > absI(g.Town.X-h.X) {
		dirs[0], dirs[1] = dirs[1], dirs[0]
	}
	for _, d := range dirs {
		if d[0] == 0 && d[1] == 0 {
			continue
		}
		nx, ny := h.X+d[0], h.Y+d[1]
		t := g.TileAt(nx, ny)
		if t == nil || !t.Biome.Walkable() || t.MonsterID != "" {
			continue
		}
		if err := g.MoveHero(h.ID, d[0], d[1]); err == nil {
			return true
		}
	}
	return false
}
