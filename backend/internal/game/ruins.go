package game

// Ruines-donjons (2026-07-19) : des bâtiments en ruine SPÉCIFIQUES AU BIOME
// sont semés sur la carte à la génération. Gameplay Hordes-like en deux temps :
//   1. DÉBLAYER — chantier collectif en PA (comme la construction : chaque héros
//      sur la case investit des PA, le cumul est partagé entre joueurs) ;
//   2. EXPLORER — une fois déblayée, la ruine devient un DONJON à charges :
//      2 PA par fouille, tirage pondéré d'une table de butin RARE propre au
//      type (matériaux de craft avancés, objets rares, plans anciens), jusqu'à
//      épuisement des charges.
//
// Les ruines vivent dans GameState.Ruins (clé = id) et la tuile porte RuinID.
// Le fog serveur les caviarde comme les monstres (voir fog.go ClientView).

import (
	"fmt"
	"math/rand"
	"strings"
)

const (
	ruinExplorePA = 2 // coût d'une fouille de donjon
	ruinCharges   = 4 // trésors par donjon (puis « épuisé »)
)

// Ruin is one ruined building on a tile — a shared clearing site, then a dungeon.
type Ruin struct {
	ID         string `json:"id"`
	Type       string `json:"type"` // ferme | epave | sanctuaire | mine | tour | memorial
	Name       string `json:"name"`
	Icon       string `json:"icon"`
	X          int    `json:"x"`
	Y          int    `json:"y"`
	ClearPA    int    `json:"clearPa"`    // PA collectifs requis pour déblayer
	PaInvested int    `json:"paInvested"` // progression partagée
	Cleared    bool   `json:"cleared"`
	Charges    int    `json:"charges"` // fouilles restantes une fois déblayée
	// MÉMORIAL : une ruine qui fut la ville de quelqu'un d'autre (voir Memorial et
	// SeedMemorialRuins). Vides pour les ruines ordinaires.
	FellAtWave int      `json:"fellAtWave,omitempty"`
	Defenders  []string `json:"defenders,omitempty"`
}

// Memorial est le souvenir d'une ville TOMBÉE, tel qu'il voyage jusqu'aux cartes
// suivantes. Il vient du classement, qui conserve déjà tout ce qu'il faut et survit à
// la suppression de la partie (store.FallenTowns).
type Memorial struct {
	TownName  string   `json:"townName"`
	Wave      int      `json:"wave"`
	Defenders []string `json:"defenders"`
}

// memorialRuin décrit ce qu'on trouve dans les décombres d'une ville : ce qu'elle
// avait accumulé et n'a pas eu le temps de dépenser. La table est délibérément faite
// de MATÉRIAUX DE CONSTRUCTION — c'est un legs utile, pas un trésor magique : une
// expédition récupère les pierres d'une autre.
var memorialLoot = []DropDef{
	{"minerai", "Pierre", 3, 3},
	{"objet", "Bois", 3, 3},
	{"objet", "Planche", 2, 2},
	{"minerai", "Brique", 1, 2},
	{"objet", "Corde", 1, 2},
	{"minerai", "Acier", 1, 1},
	{"objet", "Relique sculptée", 1, 1},
}

const (
	memorialClearPA = 10 // déblayer les décombres d'une ville : plus lourd qu'une ferme
	memorialCharges = 5
)

// Epitaph rend l'inscription d'un mémorial (vide pour une ruine ordinaire).
func (r *Ruin) Epitaph() string {
	if r.FellAtWave <= 0 {
		return ""
	}
	if len(r.Defenders) == 0 {
		return fmt.Sprintf("Tombée à la vague %d. Nul ne se souvient de ses défenseurs.", r.FellAtWave)
	}
	return fmt.Sprintf("Tombée à la vague %d, défendue par %s.", r.FellAtWave, joinNames(r.Defenders))
}

// joinNames écrit « Ana, Bo et Zoé ».
func joinNames(names []string) string {
	switch len(names) {
	case 0:
		return ""
	case 1:
		return names[0]
	}
	return strings.Join(names[:len(names)-1], ", ") + " et " + names[len(names)-1]
}

// SeedMemorialRuins sème sur la carte les ruines de villes RÉELLEMENT tombées avant
// celle-ci — nom, dernière vague, défenseurs, et de quoi bâtir dans les décombres.
//
// C'est la réponse au trou de rétention principal (RETENTION-PLAN.md, T1) : une partie
// dure sept à neuf jours réels puis se termine par une défaite, et jusqu'ici elle ne
// laissait qu'une ligne de classement. Ici, la ville que vous avez tenue neuf jours
// devient un lieu sur la carte de quelqu'un d'autre. Le monde finit construit par les
// échecs de la communauté, ce qui est précisément le thème du jeu.
//
// ⚠ Aucun transfert de PUISSANCE entre parties : ce qu'on récupère, ce sont des
// matériaux ordinaires, accessibles à n'importe qui passant par là. Une progression qui
// rendrait les vétérans plus forts casserait l'égalité qui fait tenir une survie de
// groupe, et ferait des nouveaux venus des joueurs de seconde classe.
//
// Déterministe pour une graine donnée, et appelée APRÈS SeedRuins (elle ne pose rien
// sur une tuile déjà occupée).
func (g *GameState) SeedMemorialRuins(fallen []Memorial) int {
	if len(fallen) == 0 {
		return 0
	}
	if g.Ruins == nil {
		g.Ruins = map[string]*Ruin{}
	}
	want := memorialCount(g.Width * g.Height)
	if want > len(fallen) {
		want = len(fallen)
	}
	rng := rand.New(rand.NewSource(g.Seed ^ 0x4d656d6f)) // "Memo"

	// Candidates : terre ferme, loin de la ville (on ne bute pas dessus au réveil),
	// libre de monstre et de ruine. Balayage en ordre de tuile = déterministe.
	var cand []int
	for i, t := range g.Tiles {
		if !t.Biome.Walkable() || t.MonsterID != "" || t.RuinID != "" {
			continue
		}
		x, y := i%g.Width, i/g.Width
		if cheb(x-g.Town.X, y-g.Town.Y) < memorialMinDistance {
			continue
		}
		cand = append(cand, i)
	}
	placed := 0
	for _, m := range fallen {
		if placed >= want || len(cand) == 0 {
			break
		}
		k := rng.Intn(len(cand))
		i := cand[k]
		cand = append(cand[:k], cand[k+1:]...) // une ville par case
		id := fmt.Sprintf("ruin-memorial-%d", placed)
		g.Ruins[id] = &Ruin{
			ID: id, Type: "memorial", Icon: "🏚️",
			Name:       "Ruines de " + m.TownName,
			X:          i % g.Width,
			Y:          i / g.Width,
			ClearPA:    memorialClearPA,
			Charges:    memorialCharges,
			FellAtWave: m.Wave,
			Defenders:  append([]string(nil), m.Defenders...),
		}
		g.Tiles[i].RuinID = id
		placed++
	}
	return placed
}

// memorialCount : combien de villes mortes hantent une carte de cette taille. Une
// grande carte (vingt joueurs) en porte plusieurs, une petite une seule — la densité
// de souvenirs suit la densité de tout le reste.
func memorialCount(area int) int {
	n := 1 + area/6000
	if n > 4 {
		n = 4
	}
	return n
}

// memorialMinDistance : un mémorial est un VOYAGE, pas un décor de banlieue.
const memorialMinDistance = 6

// ruinDef describes one biome-specific ruin type and its dungeon loot table.
type ruinDef struct {
	Type    string
	Name    string
	Icon    string
	ClearPA int
	Loot    []DropDef
}

// ⚠ CHAQUE RUINE PORTE LE PLAN D'UNE SPÉCIALITÉ, ET UNE SEULE (2026-08-10). Les cinq
// bâtiments de spécialité (Infirmerie, Cartographe, Armurerie, Verger, Caserne) ne
// s'obtiennent QUE par ici : un biome = une spécialité, donc les débloquer tous
// demanderait de déblayer une ruine dans CHAQUE biome de la carte. C'est le mécanisme
// de rareté qui force à choisir : une ville ne peut pas tout avoir, et ce qu'elle aura
// dépend de où son expédition est allée. Les ruines sont finies (une par biome présent),
// et un donjon n'a que quelques charges.
//
// ruinDefs maps each biome to its ruin type. Water (0) has none.
var ruinDefs = map[Biome]ruinDef{
	1: {Type: "epave", Name: "Épave ensablée", Icon: "⛵", ClearPA: 8, Loot: []DropDef{
		{"objet", "Corde", 2, 3},
		{"objet", "Perle nacrée", 1, 2},
		{"minerai", "Minerai d'argent", 1, 2},
		{"aliment", "Rhum de contrebande", 1, 2},
		{"objet", "Plan de la Recyclerie", 1, 2}, // épave de récupération → recyclerie
		{"objet", "Plan du Cartographe", 1, 2},   // cartes marines dans l'épave → cartographe
	}},
	2: {Type: "ferme", Name: "Ferme abandonnée", Icon: "🏚️", ClearPA: 8, Loot: []DropDef{
		{"objet", "Planche", 2, 3},
		{"objet", "Corde", 1, 3},
		{"plante", "Graines anciennes", 1, 2},
		{"minerai", "Acier", 1, 1},
		{"objet", "Plan de la Cuisine", 1, 2}, // ferme/moulin → cuisine
		{"objet", "Plan de la Poste", 1, 2},   // relais de poste sur la route → poste
		{"objet", "Plan du Verger", 1, 2},     // vergers et semences de la ferme → verger
	}},
	3: {Type: "sanctuaire", Name: "Sanctuaire englouti", Icon: "🗿", ClearPA: 10, Loot: []DropDef{
		{"plante", "Herbe médicinale", 1, 3},
		{"objet", "Relique sculptée", 1, 2},
		{"objet", "Bois", 3, 2},
		{"objet", "Cœur de chêne ancien", 1, 1},
		{"objet", "Plan de la Mairie", 1, 2},    // sanctuaire civique → mairie
		{"objet", "Plan de la Poste", 1, 1},     // scriptorium du sanctuaire → poste
		{"objet", "Plan de l'Infirmerie", 1, 2}, // herboristerie du sanctuaire → infirmerie
		{"objet", "Plan du Temple", 1, 3},       // un sanctuaire enseigne comment on en bâtit un
	}},
	4: {Type: "mine", Name: "Mine effondrée", Icon: "⛏️", ClearPA: 12, Loot: []DropDef{
		{"minerai", "Minerai de fer", 2, 3},
		{"minerai", "Charbon", 2, 3},
		{"minerai", "Minerai d'argent", 1, 2},
		{"minerai", "Acier", 1, 1},
		{"objet", "Plan de la Recyclerie", 1, 1}, // mine industrielle → recyclerie
		{"objet", "Plan de l'Armurerie", 1, 2},   // forge de la mine → armurerie
	}},
	5: {Type: "tour", Name: "Tour gelée", Icon: "🗼", ClearPA: 12, Loot: []DropDef{
		{"minerai", "Givre éternel", 1, 3},
		{"objet", "Grimoire gelé", 1, 2},
		{"minerai", "Minerai d'argent", 1, 2},
		{"aliment", "Élixir de givre", 1, 1},
		{"objet", "Plan de la Tour", 1, 2},    // tour → tour
		{"objet", "Plan de la Caserne", 1, 2}, // garnison de la tour → caserne
	}},
}

// SeedRuins places one ruin per eligible biome present on the map (deterministic
// for a given seed: candidates are scanned in tile order and drawn with a local
// PRNG seeded from the world seed). Called once at worldgen; idempotent-guarded.
func (g *GameState) SeedRuins() {
	if g.Ruins == nil {
		g.Ruins = map[string]*Ruin{}
	}
	if len(g.Ruins) > 0 {
		return
	}
	rng := rand.New(rand.NewSource(g.Seed ^ 0x52756e73)) // "Runs"
	for biome := Biome(1); biome <= 5; biome++ {
		def, ok := ruinDefs[biome]
		if !ok {
			continue
		}
		// candidates: right biome, no monster, away from town (Chebyshev ≥ 3)
		var cand []int
		for i, t := range g.Tiles {
			x, y := i%g.Width, i/g.Width
			dx, dy := x-g.Town.X, y-g.Town.Y
			if dx < 0 {
				dx = -dx
			}
			if dy < 0 {
				dy = -dy
			}
			cheb := dx
			if dy > cheb {
				cheb = dy
			}
			if t.Biome == biome && t.MonsterID == "" && t.RuinID == "" && cheb >= 3 {
				cand = append(cand, i)
			}
		}
		if len(cand) == 0 {
			continue
		}
		i := cand[rng.Intn(len(cand))]
		id := fmt.Sprintf("ruin-%s", def.Type)
		// Le THÈME rhabille la ruine (« Pyramide ensablée » plutôt qu'« Épave
		// ensablée ») — mais ni son TYPE, dont le client dérive son modèle voxel, ni
		// sa table de butin, qui porte le plan d'une spécialité. Un thème rhabille,
		// il ne redistribue pas : sinon un bâtiment deviendrait inatteignable selon
		// le tirage (test TestEveryThemeGrantsEveryPlan).
		name, icon := def.Name, def.Icon
		if skin, ok := g.Theme().RuinNames[biome]; ok {
			if skin.Name != "" {
				name = skin.Name
			}
			if skin.Icon != "" {
				icon = skin.Icon
			}
		}
		g.Ruins[id] = &Ruin{
			ID: id, Type: def.Type, Name: name, Icon: icon,
			X: i % g.Width, Y: i / g.Width,
			ClearPA: def.ClearPA, Charges: ruinCharges,
		}
		g.Tiles[i].RuinID = id
	}
}

// ruinUnderHero validates the shared preconditions of both ruin actions and
// returns the hero + the ruin standing on their tile.
func (g *GameState) ruinUnderHero(heroID string) (*Hero, *Ruin, error) {
	if g.heroInCombat(heroID) != nil {
		return nil, nil, ActionError{"ce héros est en plein combat"}
	}
	h := g.HeroByID(heroID)
	if h == nil {
		return nil, nil, ActionError{"héros introuvable"}
	}
	if h.HasState(StateTetanise) {
		return nil, nil, ActionError{h.Name + " est tétanisé — impossible de travailler sous les griffes de la horde"}
	}
	t := g.TileAt(h.X, h.Y)
	if t == nil || t.RuinID == "" {
		return nil, nil, ActionError{"aucune ruine sur cette case"}
	}
	ru := g.Ruins[t.RuinID]
	if ru == nil {
		return nil, nil, ActionError{"ruine introuvable"}
	}
	return h, ru, nil
}

// ClearRuin invests the hero's PA into clearing the rubble (collective, like a
// construction site). Returns the ruin so the client can show progress.
func (g *GameState) ClearRuin(heroID string, points int) (*Ruin, error) {
	h, ru, err := g.ruinUnderHero(heroID)
	if err != nil {
		return nil, err
	}
	if ru.Cleared {
		return nil, ActionError{ru.Name + " est déjà déblayée"}
	}
	if h.PA <= 0 {
		return nil, ActionError{h.Name + " n'a plus de point d'action"}
	}
	if points < 1 {
		points = 1
	}
	if remaining := ru.ClearPA - ru.PaInvested; points > remaining {
		points = remaining
	}
	if points > h.PA {
		points = h.PA
	}
	h.PA -= points
	ru.PaInvested += points
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	if ru.PaInvested >= ru.ClearPA {
		ru.Cleared = true
	}
	return ru, nil
}

// ExploreRuin draws one rare treasure from a cleared dungeon (2 PA, limited charges).
func (g *GameState) ExploreRuin(heroID string) (*Item, error) {
	h, ru, err := g.ruinUnderHero(heroID)
	if err != nil {
		return nil, err
	}
	if !ru.Cleared {
		return nil, ActionError{ru.Name + " est encore ensevelie — il faut d'abord la déblayer"}
	}
	if ru.Charges <= 0 {
		return nil, ActionError{ru.Name + " est épuisée — plus rien à y trouver"}
	}
	if h.PA < ruinExplorePA {
		return nil, ActionError{fmt.Sprintf("explorer coûte %d PA", ruinExplorePA)}
	}
	// La table de butin vient du TYPE de ruine, pas du biome : un mémorial peut se
	// dresser sur n'importe quelle terre, et ce qu'on y trouve sont les matériaux d'une
	// ville morte, pas les curiosités du terrain qui l'entoure.
	loot := memorialLoot
	if ru.Type != "memorial" {
		def, ok := ruinDefs[g.TileAt(h.X, h.Y).Biome]
		if !ok {
			return nil, ActionError{"donjon corrompu"}
		}
		loot = def.Loot
	}
	h.PA -= ruinExplorePA
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	ru.Charges--
	d := weightedDrop(loot)
	if d == nil {
		return nil, ActionError{"rien trouvé"}
	}
	it := Item{Type: d.Type, Name: d.Name, Qty: d.Qty}
	// Récupérateur : +1 sur les trouvailles (même passif que les trophées)
	if h.ClassID == "recuperateur" {
		it.Qty++
	}
	h.AddLoot(it)
	return &it, nil
}
