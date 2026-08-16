package game

import (
	"fmt"

	"github.com/google/uuid"
)

// LA TOUR DE GUET — la vue panoramique, et la seule façon de garder ce qu'on a vu.
//
// LE PROBLÈME QU'ELLE RÉSOUT. Depuis que le brouillard s'éteint derrière les héros
// (fog.go), la carte d'une expédition est une lampe torche : on voit une case autour
// de soi, et tout ce qu'on quitte retombe dans le souvenir gris. Explorer une carte de
// 134² à six points d'action par vague devient un travail sans mémoire vive. La tour
// est la réponse : un point du monde qui reste ALLUMÉ, pour tout le monde et pour
// toujours.
//
// OÙ ELLE SE BÂTIT, ET POURQUOI ÇA COMPTE. Sur les SOMMETS — les points culminants du
// relief. Depuis les mesas (worldgen/escarpments.go), un sommet est justement ce qu'un
// héros ordinaire ne peut PAS atteindre : il faut de l'athlétisme, ou des Bottes
// cloutées. Les deux systèmes s'emboîtent donc sans qu'on ait rien inventé pour ça —
// la récompense d'un plateau scellé, c'est le belvédère qu'on peut y poser, et la
// raison de forger des bottes devient visible sur la carte.
//
// ⚠ ELLE N'EST PAS UN BÂTIMENT DE VILLE. Les `TownBuilding` vivent dans les murs,
// partagent le pool de PA de la ville, se réparent, se font frapper par les vagues.
// Une tour de guet est un objet du MONDE, comme une ruine : elle a une case, elle se
// bâtit là où on est, et la horde ne s'y intéresse pas. Elle réutilise donc le modèle
// des ruines (chantier collectif à points d'action partagés) et surtout PAS celui des
// bâtiments — greffer une parcelle hors-les-murs sur `town.go` aurait contaminé le
// calcul de défense, l'ordre du jour, l'usure et le plan de la ville.
//
// ⚠ CE QU'ELLE NE FAIT PAS : aucune défense, aucun point d'action, aucun stockage.
// Elle ne donne QUE de la vision. Une tour qui ferait deux choses obligerait à
// arbitrer entre elles, alors que tout son intérêt est d'être un choix simple :
// est-ce que ce coin du monde vaut qu'on aille y voir en permanence ?

const (
	// WatchtowerSight : le rayon éclairé en permanence. Large — c'est un panorama, pas
	// une lanterne. Trois fois la vue d'un héros posté au même endroit.
	WatchtowerSight = 6
	// WatchtowerPA : les points d'action COLLECTIFS du chantier. Cher : c'est un
	// investissement d'expédition, et il se fait loin du bourg, sur un sommet qu'il
	// faut d'abord pouvoir atteindre.
	WatchtowerPA = 14
	// watchtowerSitesPerTiles : un site candidat par tranche de surface praticable.
	watchtowerSitesPerTiles = 900
	// watchtowerMinFromTown : les sites naissent loin du bourg. Une tour posée à côté
	// de la ville n'apprendrait rien — le bourg éclaire déjà ses abords.
	watchtowerMinFromTown = 12
	// watchtowerMinApart : deux belvédères ne se marchent pas dessus.
	watchtowerMinApart = 10
)

// WatchtowerMaterials : ce qu'il faut en Banque pour ouvrir le chantier. Consommé à
// l'achèvement, comme les chantiers de la ville.
//
// ⚠ DU BOIS ET DE LA PIERRE, rien de rare. La difficulté d'une tour de guet est de
// MONTER là-haut et d'y dépenser quatorze points d'action collectifs, pas de trouver
// un matériau exotique : lui ajouter de l'acier la ferait entrer en concurrence avec
// le portail niveau 3, c'est-à-dire avec la survie, et personne ne choisirait jamais
// la vue.
var WatchtowerMaterials = []Item{
	{Type: "objet", Name: "Bois", Qty: 6},
	{Type: "minerai", Name: "Pierre", Qty: 4},
}

// Watchtower : un belvédère, bâti ou en chantier, posé sur un sommet.
type Watchtower struct {
	ID         string `json:"id"`
	X          int    `json:"x"`
	Y          int    `json:"y"`
	Height     int    `json:"height"` // l'altitude du sommet : ce qui justifie la vue
	Built      bool   `json:"built"`
	PaInvested int    `json:"paInvested"`
	BuildPA    int    `json:"buildPa"`
	Sight      int    `json:"sight"`
	// Materials : ce que le chantier réclame, servi au client pour qu'il puisse
	// l'afficher à côté de la Banque sans recopier la table.
	Materials []Item `json:"materials"`
}

// SeedWatchtowerSites sème les SITES candidats : les sommets du relief, loin du bourg
// et espacés entre eux. Déterministe (il ne lit que la carte), donc deux instances qui
// rejouent la même graine posent les mêmes belvédères.
//
// ⚠ UN SOMMET, PAS UNE MONTAGNE. Le critère est topographique — une case dont AUCUNE
// voisine orthogonale n'est plus haute — et pas le biome. C'est délibéré : depuis
// l'audit du relief on sait que dans ce générateur « biome montagne » ne veut pas dire
// « point haut » (les gisements garantis et le biais de thème peignent des montagnes
// plates). Un belvédère doit dominer ; seule la hauteur le dit.
func (g *GameState) SeedWatchtowerSites() {
	if g.Watchtowers == nil {
		g.Watchtowers = map[string]*Watchtower{}
	}
	walkable := 0
	for i := range g.Tiles {
		if g.Tiles[i].Biome.Walkable() {
			walkable++
		}
	}
	want := walkable / watchtowerSitesPerTiles
	if want < 1 {
		want = 1
	}
	// Les sommets, du plus haut au plus bas. L'ordre est TOTAL et stable (hauteur,
	// puis position) : l'ordre d'itération d'une map ne doit jamais décider du monde.
	type cand struct{ x, y, h int }
	var cands []cand
	for y := 0; y < g.Height; y++ {
		for x := 0; x < g.Width; x++ {
			t := g.TileAt(x, y)
			if t == nil || !t.Biome.Walkable() {
				continue
			}
			if maxI(absI(x-g.Town.X), absI(y-g.Town.Y)) < watchtowerMinFromTown {
				continue
			}
			summit := true
			for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
				if n := g.TileAt(x+d[0], y+d[1]); n != nil && n.Biome.Walkable() && n.Height > t.Height {
					summit = false
					break
				}
			}
			if summit {
				cands = append(cands, cand{x, y, t.Height})
			}
		}
	}
	// tri décroissant par hauteur, puis (y,x) pour la stabilité
	for i := 1; i < len(cands); i++ {
		for j := i; j > 0; j-- {
			a, b := cands[j-1], cands[j]
			if a.h > b.h || (a.h == b.h && (a.y < b.y || (a.y == b.y && a.x < b.x))) {
				break
			}
			cands[j-1], cands[j] = cands[j], cands[j-1]
		}
	}
	placed := 0
	for _, c := range cands {
		if placed >= want {
			break
		}
		tooClose := false
		for _, wt := range g.Watchtowers {
			if maxI(absI(wt.X-c.x), absI(wt.Y-c.y)) < watchtowerMinApart {
				tooClose = true
				break
			}
		}
		if tooClose {
			continue
		}
		id := uuid.NewString()
		g.Watchtowers[id] = &Watchtower{
			ID: id, X: c.x, Y: c.y, Height: c.h,
			BuildPA: WatchtowerPA, Sight: WatchtowerSight, Materials: WatchtowerMaterials,
		}
		g.Tiles[c.y*g.Width+c.x].TowerID = id
		placed++
	}
}

// WatchtowerAt rend le belvédère (bâti ou en chantier) posé sur cette case.
func (g *GameState) WatchtowerAt(x, y int) *Watchtower {
	t := g.TileAt(x, y)
	if t == nil || t.TowerID == "" {
		return nil
	}
	return g.Watchtowers[t.TowerID]
}

// BuildWatchtower investit des points d'action collectifs dans le belvédère de la case
// du héros. Mêmes règles qu'un chantier de ruine : plusieurs joueurs cumulent, et la
// progression est partagée.
//
// ⚠ LES MATÉRIAUX SONT EXIGÉS À L'INVESTISSEMENT et consommés à l'ACHÈVEMENT, comme
// les chantiers de la ville (town.go) : sans cette règle, une expédition ouvrirait
// dix chantiers qu'elle ne peut pas finir et bloquerait sa propre Banque.
func (g *GameState) BuildWatchtower(heroID string, points int) (*Watchtower, error) {
	if g.heroInCombat(heroID) != nil {
		return nil, ActionError{"ce héros est en plein combat"}
	}
	h := g.HeroByID(heroID)
	if h == nil || h.HP <= 0 {
		return nil, ActionError{"héros introuvable"}
	}
	if h.HasState(StateTetanise) {
		return nil, ActionError{h.Name + " est tétanisé"}
	}
	wt := g.WatchtowerAt(h.X, h.Y)
	if wt == nil {
		return nil, ActionError{"aucun sommet à bâtir ici"}
	}
	if wt.Built {
		return nil, ActionError{"la tour de guet est déjà debout"}
	}
	if h.PA <= 0 {
		return nil, ActionError{h.Name + " n'a plus de point d'action"}
	}
	if missing := g.missingWatchtowerMaterials(); missing != "" {
		return nil, ActionError{"il manque " + missing + " en Banque"}
	}
	if points < 1 {
		points = 1
	}
	if rest := wt.BuildPA - wt.PaInvested; points > rest {
		points = rest
	}
	if points > h.PA {
		points = h.PA
	}
	h.PA -= points
	wt.PaInvested += points
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	g.credit(heroID, func(c *Contribution) { c.BuildPA += points })
	if wt.PaInvested >= wt.BuildPA {
		for _, it := range WatchtowerMaterials {
			g.removeStorage(it.Name, it.Qty)
		}
		wt.Built = true
		g.logTown(fmt.Sprintf("%s achève une tour de guet en (%d,%d) — la vue y est désormais acquise.", h.Name, wt.X, wt.Y))
	}
	return wt, nil
}

// missingWatchtowerMaterials rend une liste lisible de ce qui manque ("" = tout est là).
func (g *GameState) missingWatchtowerMaterials() string {
	out := ""
	for _, need := range WatchtowerMaterials {
		if have := g.storageQty(need.Name); have < need.Qty {
			if out != "" {
				out += ", "
			}
			out += fmt.Sprintf("%s %d/%d", need.Name, have, need.Qty)
		}
	}
	return out
}

func maxI(a, b int) int {
	if a > b {
		return a
	}
	return b
}
