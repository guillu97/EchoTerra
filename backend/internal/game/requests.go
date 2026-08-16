package game

// LES REQUÊTES DU PANNEAU — « il me faut 3 Corde ».
//
// Réponse au trou T6 de RETENTION-PLAN.md : la réciprocité est la colle sociale la plus
// solide qui existe, et jusqu'ici rien dans le jeu ne permettait à un joueur de demander
// quoi que ce soit à un autre. Un joueur affiche un besoin, n'importe qui l'honore depuis
// la Banque, le journal note qui l'a fait.
//
// C'est aussi la PREMIÈRE SORTIE contrôlée de la Banque. Jusqu'ici le butin y entrait et
// n'en ressortait que par un craft ou un chantier : impossible de donner quoi que ce soit
// à quelqu'un. Passer par une requête plutôt que par un retrait libre est délibéré — un
// retrait libre serait une opération solitaire, alors qu'ici il faut être deux : un qui
// demande, un qui sert.
//
// Et c'est ASYNCHRONE, ce qui est tout l'intérêt sur un jeu joué en sessions de cinq
// minutes : on affiche son besoin, on ferme l'application, quelqu'un le sert pendant la
// nuit, on retrouve la marchandise dans son sac au réveil.

import (
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	requestFillPA  = 1  // servir un camarade est un travail, pas un clic
	requestMaxQty  = 20 // au-delà, ce n'est plus un service, c'est un déménagement
	requestsCap    = 12 // le Panneau reste lisible
	requestKeepFor = 3  // vagues pendant lesquelles une requête honorée reste affichée
)

// TownRequest est un besoin affiché au Panneau par un joueur.
type TownRequest struct {
	ID       string    `json:"id"`
	PlayerID string    `json:"playerId"`
	Author   string    `json:"author"`
	Item     string    `json:"item"`
	Qty      int       `json:"qty"`
	Wave     int       `json:"wave"` // vague à laquelle elle a été affichée
	At       time.Time `json:"at"`
	FilledBy string    `json:"filledBy,omitempty"` // nom de qui a servi ("" = ouverte)
	FilledAt time.Time `json:"filledAt,omitzero"`
}

// Open reports whether the request is still waiting for someone.
func (r *TownRequest) Open() bool { return r.FilledBy == "" }

// PostRequest affiche un besoin au Panneau. Un joueur n'a qu'UNE requête ouverte à la
// fois : le Panneau est un tableau d'affichage partagé, pas une liste de courses
// personnelle, et une file monopolisée par quelqu'un ne serait plus une demande d'aide.
func (g *GameState) PostRequest(playerID, item string, qty int) (*TownRequest, error) {
	p := g.PlayerByID(playerID)
	if p == nil {
		return nil, actionErr("joueur inconnu")
	}
	item = strings.TrimSpace(item)
	if item == "" {
		return nil, actionErr("que te faut-il ?")
	}
	if qty < 1 {
		qty = 1
	}
	if qty > requestMaxQty {
		qty = requestMaxQty
	}
	for _, r := range g.Town.Requests {
		if r.PlayerID == playerID && r.Open() {
			return nil, actionErr("tu as déjà une demande au Panneau — retire-la d'abord")
		}
	}
	r := &TownRequest{
		ID: uuid.NewString(), PlayerID: playerID, Author: p.Name,
		Item: item, Qty: qty, Wave: g.WaveNumber, At: time.Now(),
	}
	g.Town.Requests = append(g.Town.Requests, r)
	g.trimRequests()
	g.logTown("📌 %s demande %d %s au Panneau", p.Name, qty, item)
	return r, nil
}

// CancelRequest retire sa propre demande.
func (g *GameState) CancelRequest(playerID, requestID string) error {
	for i, r := range g.Town.Requests {
		if r.ID != requestID {
			continue
		}
		if r.PlayerID != playerID {
			return actionErr("cette demande n'est pas la tienne")
		}
		g.Town.Requests = append(g.Town.Requests[:i], g.Town.Requests[i+1:]...)
		return nil
	}
	return actionErr("demande introuvable")
}

// FillRequest honore la demande d'un camarade : le héros qui sert doit être EN VILLE,
// la marchandise sort de la Banque et va dans le sac du demandeur — même absent, même
// hors de la ville. C'est ce qui rend le geste asynchrone, donc jouable sur un jeu où
// l'on passe cinq minutes deux fois par jour.
func (g *GameState) FillRequest(requestID, heroID string) (*TownRequest, error) {
	h := g.HeroByID(heroID)
	if h == nil || h.HP <= 0 {
		return nil, actionErr("héros invalide")
	}
	if h.X != g.Town.X || h.Y != g.Town.Y {
		return nil, actionErrf("%s doit être en ville pour servir une demande", h.Name)
	}
	var req *TownRequest
	for _, r := range g.Town.Requests {
		if r.ID == requestID {
			req = r
			break
		}
	}
	if req == nil {
		return nil, actionErr("demande introuvable")
	}
	if !req.Open() {
		return nil, actionErrf("cette demande a déjà été honorée par %s", req.FilledBy)
	}
	if req.PlayerID == g.OwnerOfHero(heroID) {
		return nil, actionErr("se servir soi-même n'est pas rendre service")
	}
	if have := g.storageQty(req.Item); have < req.Qty {
		return nil, actionErrf("la Banque n'a que %d %s sur les %d demandés", have, Name(req.Item), req.Qty)
	}
	// Le destinataire : le premier héros VIVANT du demandeur, où qu'il soit.
	dest := g.firstLivingHeroOf(req.PlayerID)
	if dest == nil {
		return nil, actionErr("le demandeur n'a plus de héros en vie")
	}
	if h.PA < requestFillPA {
		return nil, actionErr("PA insuffisants")
	}
	h.PA -= requestFillPA
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	g.removeStorage(req.Item, req.Qty)
	dest.AddLoot(Item{Type: itemTypeOf(req.Item), Name: req.Item, Qty: req.Qty})
	req.FilledBy, req.FilledAt = h.Name, time.Now()
	g.credit(heroID, func(c *Contribution) { c.Filled++ })
	g.logTown("🤝 %s a servi la demande de %s (%d %s)", h.Name, req.Author, req.Qty, req.Item)
	return req, nil
}

// firstLivingHeroOf returns the player's first living hero, or nil.
func (g *GameState) firstLivingHeroOf(playerID string) *Hero {
	p := g.PlayerByID(playerID)
	if p == nil {
		return nil
	}
	for _, id := range p.HeroIDs {
		if h := g.HeroByID(id); h != nil && h.HP > 0 {
			return h
		}
	}
	return nil
}

// itemTypeOf retrouve la catégorie d'un objet dans les tables du design (terrains,
// recettes). Par défaut « objet » — le type ne sert qu'à l'affichage.
func itemTypeOf(name string) string {
	for _, td := range Terrains {
		for _, d := range td.Drops {
			if d.Name == name {
				return d.Type
			}
		}
	}
	for i := range Recipes {
		r := &Recipes[i]
		out := r.OutputName
		if out == "" {
			out = r.Name
		}
		if out == name {
			return r.OutputType
		}
		for _, ing := range r.Ingredients {
			if ing.Name == name {
				return ing.Type
			}
		}
	}
	return "objet"
}

// trimRequests borne le Panneau et fait le ménage : une demande honorée reste affichée
// quelques vagues (c'est la trace du service rendu, elle a de la valeur sociale), puis
// s'efface.
func (g *GameState) trimRequests() {
	kept := g.Town.Requests[:0]
	for _, r := range g.Town.Requests {
		if !r.Open() && g.WaveNumber-r.Wave > requestKeepFor {
			continue
		}
		kept = append(kept, r)
	}
	g.Town.Requests = kept
	if cap := g.requestsCapacity(); len(g.Town.Requests) > cap {
		g.Town.Requests = g.Town.Requests[len(g.Town.Requests)-cap:] // on garde les plus récentes
	}
}

// requestsCapacity : combien de demandes le Panneau affiche à la fois.
//
// À vingt joueurs, douze places se remplissent en une vague et les demandes les plus
// anciennes tombent avant d'avoir été vues — or une demande non vue est une demande non
// servie, et les requêtes sont la SEULE sortie de la Banque vers un joueur. Agrandir le
// panneau est donc un vrai gain collectif, et c'est ce que ses niveaux 2 et 3
// promettaient sans rien faire.
func (g *GameState) requestsCapacity() int {
	b := g.buildingByID("panel")
	if b == nil || !b.Built || b.Durability <= 0 {
		return requestsCap
	}
	return requestsCap + 6*(b.Level-1)
}
