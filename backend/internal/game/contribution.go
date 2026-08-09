package game

// LE REGISTRE DE CONTRIBUTION — « ce que la ville te doit ».
//
// Réponse au trou T2 de RETENTION-PLAN.md. La ville a des PV, une défense, une banque ;
// le joueur a trois héros. Jusqu'ici personne ne pouvait dire ce que CHACUN avait fait,
// alors que dans un jeu coopératif être vu par le groupe est la récompense principale.
//
// ⚠ CADRAGE DÉLIBÉRÉ : c'est un registre, pas un classement. Les lignes sortent dans
// l'ORDRE D'ARRIVÉE des joueurs et jamais triées par mérite — trier, c'est instituer une
// compétition entre coéquipiers, et le jeu se vend sur la survie de groupe. Il n'y a pas
// non plus de total « meilleur joueur ». Ce qu'on montre, c'est ce que chacun a apporté.

import "sort"

// Contribution est ce qu'un joueur a apporté à cette ville.
type Contribution struct {
	PlayerID  string `json:"playerId"`
	Name      string `json:"name"`
	BuildPA   int    `json:"buildPa"`   // PA versés dans les chantiers
	Deposited int    `json:"deposited"` // objets rapportés à la Banque
	Slain     int    `json:"slain"`     // créatures abattues
	Repaired  int    `json:"repaired"`  // PV rendus aux remparts
	Crafted   int    `json:"crafted"`   // objets fabriqués
	Filled    int    `json:"filled"`    // requêtes de coéquipiers honorées (voir requests.go)
}

// Empty reports whether this player has yet to do anything worth recording.
func (c *Contribution) Empty() bool {
	return c.BuildPA == 0 && c.Deposited == 0 && c.Slain == 0 &&
		c.Repaired == 0 && c.Crafted == 0 && c.Filled == 0
}

// credit applique une contribution au propriétaire d'un héros. Sans propriétaire
// (parties héritées sans joueurs, « Test rapide »), c'est un no-op silencieux : le
// registre n'a de sens que s'il y a des gens à créditer.
func (g *GameState) credit(heroID string, f func(*Contribution)) {
	if heroID == "" {
		return
	}
	owner := g.OwnerOfHero(heroID)
	if owner == "" {
		return
	}
	if g.Contributions == nil {
		g.Contributions = map[string]*Contribution{}
	}
	c, ok := g.Contributions[owner]
	if !ok {
		c = &Contribution{PlayerID: owner}
		g.Contributions[owner] = c
	}
	if p := g.PlayerByID(owner); p != nil {
		c.Name = p.Name // le nom peut changer (reprise de compte) : on le rafraîchit
	}
	f(c)
}

// Ledger rend le registre dans l'ORDRE D'ARRIVÉE des joueurs — jamais trié par mérite
// (voir l'avertissement en tête de fichier). Les joueurs qui n'ont encore rien fait y
// figurent quand même : une ligne à zéro dit « il vient d'arriver », son absence
// dirait « il n'existe pas ».
func (g *GameState) Ledger() []Contribution {
	out := make([]Contribution, 0, len(g.Players))
	for _, p := range g.Players {
		c := g.Contributions[p.ID]
		if c == nil {
			out = append(out, Contribution{PlayerID: p.ID, Name: p.Name})
			continue
		}
		e := *c
		e.Name = p.Name
		out = append(out, e)
	}
	// Un joueur parti laisse sa trace : la ville lui doit toujours ce qu'il a fait.
	var orphans []Contribution
	known := map[string]bool{}
	for _, p := range g.Players {
		known[p.ID] = true
	}
	for id, c := range g.Contributions {
		if !known[id] && !c.Empty() {
			orphans = append(orphans, *c)
		}
	}
	sort.Slice(orphans, func(i, j int) bool { return orphans[i].PlayerID < orphans[j].PlayerID })
	return append(out, orphans...)
}
