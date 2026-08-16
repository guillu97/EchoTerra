package game

import "fmt"

// LA FAVEUR DES DIEUX — le pilier mythique d'une expédition.
//
// D'où ça vient : le catalogue de craft porte une catégorie « déco » dont les deux
// recettes annonçaient « moral de la ville » depuis le premier jour. Le moral n'existe
// nulle part dans le code (§9 de CLAUDE.md le liste encore comme un reste de design non
// implémenté), donc fabriquer un totem produisait un objet qui allait dormir en Banque
// et n'agissait sur rien. C'était la dernière grande promesse en texte du catalogue.
//
// Elle est remplacée par quelque chose qu'une ville peut VOULOIR : orner le bourg
// attire le regard des dieux. Chaque objet de décoration fabriqué verse de la FAVEUR
// (le compteur ⚡ à la Age of Mythology) ; quand la ville en a assez, ses joueurs VOTENT
// au Temple pour la bénédiction qu'ils appellent, et elle s'applique dès la vague
// suivante.
//
// LES QUATRE RÈGLES QUI TIENNENT LE SYSTÈME
//
//  1. LA FAVEUR SE PAIE EN MATÉRIAUX DE CONSTRUCTION. Un totem coûte du bois, une stèle
//     de la pierre — exactement ce que réclament la muraille, les remparts et (au nord)
//     les foyers. La ferveur est donc en CONCURRENCE avec la défense, jamais une
//     ressource parallèle qu'on ramasserait en plus. C'est la même règle que les
//     contraintes de thème (RETENTION-PLAN.md §8).
//
//  2. UNE BÉNÉDICTION EXPIRE. Elle couvre BlessingWaves vagues puis s'éteint : la faveur
//     est une monnaie qui tourne, pas un palier qu'on franchit une fois. Sans expiration
//     une ville accumulerait les boons jusqu'à devenir imprenable, et le compteur
//     n'aurait plus rien à dire passé la vague 10.
//
//  3. ON VOTE, ON NE DÉCIDE PAS SEUL. C'est une ville qui appelle un dieu (même esprit
//     que VoteKick dans lobby.go) : chaque joueur pose une voix, le dépouillement a lieu
//     au moment où la vague tombe. Dans un jeu asynchrone où l'on passe cinq minutes par
//     jour, l'intervalle entre deux vagues EST le temps du scrutin.
//
//  4. UN PANTHÉON EST UNE PEAU, PAS UN DÉSÉQUILIBRE. Les trois thèmes servent les MÊMES
//     trois domaines (rempart, moisson, lame) sous des noms différents — grec par
//     défaut, nordique au nord, égyptien au sud. Exactement la règle des armes de thème
//     (equipment.go) : un thème donne un autre chemin vers une puissance qui existe
//     déjà, jamais une puissance de plus. Un thème se TIRE, personne ne le choisit :
//     s'il pouvait être plus fort, ce serait une punition au hasard.

// LES JOUEURS-IA N'Y TOUCHENT PAS, ET C'EST DÉLIBÉRÉ. Ils bâtissent le Temple comme
// n'importe quel site dont le plan est en Banque (mesuré : sans effet sur le plancher de
// survie), mais ils ne fabriquent pas d'offrandes — le bois qu'elles coûtent est déjà le
// matériau le plus disputé du jeu, et CLAUDE.md a mesuré deux fois qu'élargir le craft
// des bots coûtait des vagues — et surtout ils NE VOTENT PAS : à vingt robots contre un
// humain, leurs voix décideraient du dieu à sa place. Un scrutin est une institution
// humaine ; une ville sans joueur n'appelle personne.
//
// Les trois DOMAINES. Un dieu en sert exactement un, et chaque pantheon en a trois —
// donc le vote arbitre toujours entre « tenir », « récolter » et « frapper ».
const (
	DomainRampart = "rempart" // la ville encaisse mieux
	DomainHarvest = "moisson" // la terre rend davantage
	DomainBlade   = "lame"    // les héros frappent plus fort
)

// God est une divinité du pantheon d'une expédition.
type God struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon"`
	// Domain est ce que la bénédiction FAIT (voir Domain*). Deux dieux du même domaine
	// dans deux pantheons différents ont rigoureusement le même effet.
	Domain string `json:"domain"`
	// Boon est la phrase que lit le joueur avant de voter — l'effet en clair, pas la
	// légende. La légende, c'est Tagline.
	Boon    string `json:"boon"`
	Tagline string `json:"tagline"`
}

// Pantheon est le panthéon d'un thème : son temple, son icône de faveur et ses dieux.
type Pantheon struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Favor est l'icône du compteur. Elle change avec le pays (comme les cultures d'Age
	// of Mythology) : la foudre chez les Grecs, le marteau au nord, l'ânkh au sud. Ça
	// évite accessoirement de confondre la faveur avec les PA, qui portent déjà ⚡.
	Favor string `json:"favor"`
	// Temple est le nom du bâtiment sous ce thème. ⚠ l'ID du bâtiment reste « temple »
	// partout : c'est un nom d'affichage, comme les libellés de biome (theme.go).
	Temple string `json:"temple"`
	Gods   []God  `json:"gods"`
}

// PantheonOlympe — le pantheon GREC, celui du thème tempéré, donc celui de la carte de
// référence. C'est le pantheon par défaut : une partie d'avant les thèmes (ThemeID vide)
// est tempérée par construction, donc grecque.
var PantheonOlympe = &Pantheon{
	ID: "olympe", Name: "Olympe", Favor: "⚡", Temple: "Temple d'Olympe",
	Gods: []God{
		{ID: "zeus", Name: "Zeus", Icon: "⚡", Domain: DomainRampart,
			Boon: "La foudre garde les murs", Tagline: "Le maître de l'orage tient la porte avec vous."},
		{ID: "demeter", Name: "Déméter", Icon: "🌾", Domain: DomainHarvest,
			Boon: "La terre rend davantage", Tagline: "Là où elle passe, même la pierre a du grain."},
		{ID: "ares", Name: "Arès", Icon: "🗡️", Domain: DomainBlade,
			Boon: "Les héros frappent plus fort", Tagline: "Il ne protège personne. Il rend les coups."},
	},
}

// PantheonAsgard — le pantheon NORDIQUE. Thor tient les murs, Loki remplit les sacs,
// Odin arme les bras : les trois dieux demandés, sur les trois domaines du jeu.
var PantheonAsgard = &Pantheon{
	ID: "asgard", Name: "Ásgard", Favor: "🔨", Temple: "Hof des Ases",
	Gods: []God{
		{ID: "thor", Name: "Thor", Icon: "🔨", Domain: DomainRampart,
			Boon: "La foudre garde les murs", Tagline: "Mjöllnir tombe sur ce qui touche la palissade."},
		{ID: "loki", Name: "Loki", Icon: "🦊", Domain: DomainHarvest,
			Boon: "La terre rend davantage", Tagline: "Il ne donne rien. Il prend ailleurs, pour vous."},
		{ID: "odin", Name: "Odin", Icon: "🐦‍⬛", Domain: DomainBlade,
			Boon: "Les héros frappent plus fort", Tagline: "Le Père de tout regarde qui se bat, et s'en souvient."},
	},
}

// PantheonDuat — le pantheon ÉGYPTIEN, celui du désert. Râ garde la ville, Osiris fait
// reverdir, Sekhmet arme la main.
var PantheonDuat = &Pantheon{
	ID: "duat", Name: "Douat", Favor: "☥", Temple: "Temple de Râ",
	Gods: []God{
		{ID: "ra", Name: "Râ", Icon: "🌞", Domain: DomainRampart,
			Boon: "La foudre garde les murs", Tagline: "Le disque ne se couche pas sur une ville qui l'honore."},
		{ID: "osiris", Name: "Osiris", Icon: "🌱", Domain: DomainHarvest,
			Boon: "La terre rend davantage", Tagline: "Ce qui est mort sous le sable remonte pour vous."},
		{ID: "sekhmet", Name: "Sekhmet", Icon: "🦁", Domain: DomainBlade,
			Boon: "Les héros frappent plus fort", Tagline: "La lionne ne défend pas la ville : elle la venge."},
	},
}

// Pantheons est le catalogue, dans l'ordre des thèmes.
var Pantheons = []*Pantheon{PantheonOlympe, PantheonAsgard, PantheonDuat}

// Les nombres du système. Ils sont ici, ensemble, parce que c'est l'économie entière :
// combien coûte un dieu, combien de temps il reste, et ce qu'il donne.
const (
	// BlessingCost : la faveur qu'il faut avoir accumulée pour qu'un scrutin puisse
	// aboutir. Vingt, c'est-à-dire six ou sept totems — donc une vingtaine de bois qui
	// ne sont pas allés dans la muraille.
	BlessingCost = 20
	// BlessingWaves : combien de vagues une bénédiction couvre, celle de son invocation
	// comprise. Quatre = deux jours de jeu : assez pour qu'elle change une nuit
	// difficile, trop peu pour qu'on l'oublie.
	BlessingWaves = 4

	// blessingRampart : ce que le domaine « rempart » ajoute à la défense de la ville.
	// ⚠ AJOUTÉ HORS DU PLAFOND DE GARNISON (voir TownDefense) : le plafond dit « on ne
	// défend que le rempart qu'on a bâti », or une bénédiction n'est pas de la pierre.
	// La faire entrer dans le plafond l'aurait rendue invisible dans une ville qui a
	// déjà du monde aux créneaux, c'est-à-dire précisément quand on l'invoque.
	blessingRampart = 8
	// blessingHarvestQty : ce que le domaine « moisson » ajoute à CHAQUE trouvaille —
	// fouille manuelle comme fouille automatique. Même barème que le passif du
	// Récupérateur : +1, et il se cumule avec lui (deux sources différentes).
	blessingHarvestQty = 1
	// blessingBladeForce : ce que le domaine « lame » prête aux héros en combat iso.
	// ⚠ PRÊTÉ à l'unité, jamais greffé sur Hero.Stats — même règle que l'Armurerie et
	// que l'équipement : greffé, il s'empilerait à chaque combat.
	blessingBladeForce = 2
)

// ActiveBlessing est une bénédiction en cours. `UntilWave` est le numéro de la DERNIÈRE
// vague qu'elle couvre : on compare à WaveNumber, jamais à une heure — le monde avance
// par vagues rejouées (sim.go), et une échéance en temps réel ne survivrait pas à un
// rattrapage.
type ActiveBlessing struct {
	GodID     string `json:"godId"`
	Name      string `json:"name"`
	Icon      string `json:"icon"`
	Domain    string `json:"domain"`
	UntilWave int    `json:"untilWave"`
}

// GodTally est le dépouillement d'un dieu, tel que l'interface l'affiche.
type GodTally struct {
	GodID string `json:"godId"`
	Votes int    `json:"votes"`
}

// Pantheon rend le panthéon de cette expédition (jamais nil : le thème tempéré, et donc
// toute partie d'avant les thèmes, est grec).
func (g *GameState) Pantheon() *Pantheon {
	if p := g.Theme().Pantheon; p != nil {
		return p
	}
	return PantheonOlympe
}

// GodByID rend le dieu de CE panthéon portant cet identifiant, ou nil. On ne cherche
// jamais dans les autres panthéons : une ville nordique ne prie pas Râ.
func (g *GameState) GodByID(id string) *God {
	p := g.Pantheon()
	for i := range p.Gods {
		if p.Gods[i].ID == id {
			return &p.Gods[i]
		}
	}
	return nil
}

// templeBuilding rend le Temple s'il est DEBOUT et en état de servir. Une ruine ne
// consacre rien (même convention que la Poste pour le courrier ou l'Armurerie pour la
// forge : durabilité à zéro = le bâtiment ne fait plus son office).
func (g *GameState) templeBuilding() *TownBuilding {
	b := g.buildingByID("temple")
	if b == nil || !b.Built || b.Durability <= 0 {
		return nil
	}
	return b
}

// BlessingSlots : combien de bénédictions la ville peut tenir EN MÊME TEMPS. C'est
// l'effet des niveaux du Temple, et le seul — une, deux, puis trois.
//
// Pourquoi cet axe : il ne rend pas les boons plus forts (ce qui aurait fait du Temple
// niveau 3 une pièce obligatoire), il rend le CHOIX moins douloureux. Une ville niveau 1
// doit trancher entre tenir et récolter ; une ville niveau 3 peut faire les deux, et
// elle l'a payé en bois, en pierre et en PA.
func (g *GameState) BlessingSlots() int {
	b := g.templeBuilding()
	if b == nil {
		return 0
	}
	return b.Level
}

// grantFavor verse de la faveur à la ville et l'écrit au journal. Passe par ici plutôt
// que par `g.Town.Favor +=` : c'est le seul endroit où la faveur naît, donc le seul à
// tenir si un jour elle vient d'ailleurs que de la déco.
func (g *GameState) grantFavor(n int, who, what string) {
	if n <= 0 {
		return
	}
	g.Town.Favor += n
	p := g.Pantheon()
	g.logTown(fmt.Sprintf("%s %s a orné la ville de %s — la faveur des dieux monte de %d (%d/%d)",
		p.Favor, who, what, n, g.Town.Favor, BlessingCost))
}

// hasBlessing dit si un domaine est actuellement béni.
func (g *GameState) hasBlessing(domain string) bool {
	for _, b := range g.Town.Blessings {
		if b.Domain == domain {
			return true
		}
	}
	return false
}

// blessingRampartDefense : la défense que le domaine « rempart » ajoute à la ville.
func (g *GameState) blessingRampartDefense() int {
	if g.hasBlessing(DomainRampart) {
		return blessingRampart
	}
	return 0
}

// blessingHarvestBonus : ce que le domaine « moisson » ajoute à une trouvaille.
func (g *GameState) blessingHarvestBonus() int {
	if g.hasBlessing(DomainHarvest) {
		return blessingHarvestQty
	}
	return 0
}

// blessingBladeBonus : la force que le domaine « lame » prête à un héros au combat.
func (g *GameState) blessingBladeBonus() int {
	if g.hasBlessing(DomainBlade) {
		return blessingBladeForce
	}
	return 0
}

// VoteBlessing pose (ou change) la voix d'un joueur pour le dieu qu'il veut appeler.
// Gratuit : un vote est une décision, pas un travail — et le faire payer en PA aurait
// donné le dernier mot au joueur le plus riche, ce qui est l'inverse d'un scrutin.
//
// `godID` vide RETIRE sa voix. Le dépouillement, lui, n'a lieu qu'à la vague suivante
// (resolveBlessingVote) : c'est ce qui laisse à toute la ville le temps de se prononcer
// dans un jeu où chacun passe cinq minutes par jour.
func (g *GameState) VoteBlessing(playerID, godID string) error {
	if g.templeBuilding() == nil {
		return ActionError{"il faut un Temple debout pour appeler un dieu"}
	}
	if playerID == "" {
		return ActionError{"seul un joueur de cette ville peut voter"}
	}
	if g.PlayerByID(playerID) == nil && len(g.Players) > 0 {
		return ActionError{"seul un joueur de cette ville peut voter"}
	}
	if godID == "" {
		if g.Town.Votes != nil {
			delete(g.Town.Votes, playerID)
		}
		return nil
	}
	god := g.GodByID(godID)
	if god == nil {
		return ActionError{"ce dieu n'est pas de ce panthéon"}
	}
	if g.hasBlessing(god.Domain) {
		return ActionError{god.Name + " veille déjà sur la ville"}
	}
	if g.Town.Votes == nil {
		g.Town.Votes = map[string]string{}
	}
	g.Town.Votes[playerID] = godID
	return nil
}

// BlessingTally dépouille les voix, DANS L'ORDRE DU PANTHÉON.
//
// ⚠ l'ordre n'est pas cosmétique : c'est lui qui départage les ex æquo, et il doit être
// le même à chaque rejeu. Parcourir la map des voix et garder « le meilleur vu » aurait
// donné un vainqueur dépendant de l'ordre d'itération de Go, c'est-à-dire aléatoire —
// or toute l'architecture repose sur « rejouer la même période donne le même monde »
// (sim.go, et les deux fuites de déterminisme déjà corrigées le 2026-08-09).
func (g *GameState) BlessingTally() []GodTally {
	p := g.Pantheon()
	out := make([]GodTally, len(p.Gods))
	for i, god := range p.Gods {
		out[i] = GodTally{GodID: god.ID}
	}
	for _, godID := range g.Town.Votes {
		for i := range out {
			if out[i].GodID == godID {
				out[i].Votes++
			}
		}
	}
	return out
}

// resolveBlessingVote dépouille le scrutin et invoque le vainqueur. Appelée EN HAUT de
// processWave, avant que la puissance de la horde et la défense soient calculées : la
// bénédiction votée pendant l'intervalle s'applique donc « dès la vague d'après », et
// la première vague qu'elle protège est celle qui tombe.
//
// Ne fait rien tant qu'il manque une des quatre conditions : un Temple debout, la faveur
// requise, une place libre, et au moins une voix. Aucun quorum : dans une expédition où
// la moitié des joueurs dort, exiger la majorité des inscrits reviendrait à ne jamais
// rien invoquer.
func (g *GameState) resolveBlessingVote() {
	if g.templeBuilding() == nil || g.Town.Favor < BlessingCost {
		return
	}
	if len(g.Town.Blessings) >= g.BlessingSlots() {
		return
	}
	tally := g.BlessingTally()
	best := -1
	for i := range tally {
		if tally[i].Votes > 0 && (best < 0 || tally[i].Votes > tally[best].Votes) {
			best = i
		}
	}
	if best < 0 {
		return
	}
	god := g.GodByID(tally[best].GodID)
	if god == nil || g.hasBlessing(god.Domain) {
		// Le domaine a pu être béni entre-temps par un autre scrutin : les voix
		// restent posées, elles vaudront pour le prochain dépouillement.
		return
	}
	g.Town.Favor -= BlessingCost
	g.Town.Blessings = append(g.Town.Blessings, ActiveBlessing{
		GodID: god.ID, Name: god.Name, Icon: god.Icon, Domain: god.Domain,
		UntilWave: g.WaveNumber + BlessingWaves - 1,
	})
	g.Town.Votes = nil // le scrutin est clos : la ville revote pour le suivant
	g.logTown(fmt.Sprintf("%s %s répond à l'appel de la ville — %s (%d vagues)",
		god.Icon, god.Name, god.Boon, BlessingWaves))
}

// expireBlessings retire les bénédictions dont la dernière vague est passée. Appelée en
// haut de processWave, juste après l'incrément de WaveNumber et AVANT le dépouillement :
// une place qui se libère est immédiatement disponible pour le scrutin en cours.
func (g *GameState) expireBlessings() {
	if len(g.Town.Blessings) == 0 {
		return
	}
	kept := g.Town.Blessings[:0]
	for _, b := range g.Town.Blessings {
		if b.UntilWave >= g.WaveNumber {
			kept = append(kept, b)
			continue
		}
		g.logTown(fmt.Sprintf("%s La faveur de %s s'est retirée de la ville", b.Icon, b.Name))
	}
	g.Town.Blessings = kept
}
