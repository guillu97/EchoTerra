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
)

const (
	ruinExplorePA = 2 // coût d'une fouille de donjon
	ruinCharges   = 4 // trésors par donjon (puis « épuisé »)
)

// Ruin is one ruined building on a tile — a shared clearing site, then a dungeon.
type Ruin struct {
	ID         string `json:"id"`
	Type       string `json:"type"` // ferme | epave | sanctuaire | mine | tour
	Name       string `json:"name"`
	Icon       string `json:"icon"`
	X          int    `json:"x"`
	Y          int    `json:"y"`
	ClearPA    int    `json:"clearPa"`    // PA collectifs requis pour déblayer
	PaInvested int    `json:"paInvested"` // progression partagée
	Cleared    bool   `json:"cleared"`
	Charges    int    `json:"charges"` // fouilles restantes une fois déblayée
}

// ruinDef describes one biome-specific ruin type and its dungeon loot table.
type ruinDef struct {
	Type    string
	Name    string
	Icon    string
	ClearPA int
	Loot    []DropDef
}

// ruinDefs maps each biome to its ruin type. Water (0) has none.
var ruinDefs = map[Biome]ruinDef{
	1: {Type: "epave", Name: "Épave ensablée", Icon: "⛵", ClearPA: 8, Loot: []DropDef{
		{"objet", "Corde", 2, 3},
		{"objet", "Perle nacrée", 1, 2},
		{"minerai", "Minerai d'argent", 1, 2},
		{"aliment", "Rhum de contrebande", 1, 2},
		{"objet", "Plan ancien : phare", 1, 1},
	}},
	2: {Type: "ferme", Name: "Ferme abandonnée", Icon: "🏚️", ClearPA: 8, Loot: []DropDef{
		{"objet", "Planche", 2, 3},
		{"objet", "Corde", 1, 3},
		{"plante", "Graines anciennes", 1, 2},
		{"minerai", "Acier", 1, 1},
		{"objet", "Plan ancien : moulin", 1, 1},
	}},
	3: {Type: "sanctuaire", Name: "Sanctuaire englouti", Icon: "🗿", ClearPA: 10, Loot: []DropDef{
		{"plante", "Herbe médicinale", 1, 3},
		{"objet", "Relique sculptée", 1, 2},
		{"objet", "Bois", 3, 2},
		{"objet", "Cœur de chêne ancien", 1, 1},
		{"objet", "Plan ancien : autel", 1, 1},
	}},
	4: {Type: "mine", Name: "Mine effondrée", Icon: "⛏️", ClearPA: 12, Loot: []DropDef{
		{"minerai", "Minerai de fer", 2, 3},
		{"minerai", "Charbon", 2, 3},
		{"minerai", "Minerai d'argent", 1, 2},
		{"minerai", "Acier", 1, 1},
		{"objet", "Plan ancien : forge", 1, 1},
	}},
	5: {Type: "tour", Name: "Tour gelée", Icon: "🗼", ClearPA: 12, Loot: []DropDef{
		{"minerai", "Givre éternel", 1, 3},
		{"objet", "Grimoire gelé", 1, 2},
		{"minerai", "Minerai d'argent", 1, 2},
		{"aliment", "Élixir de givre", 1, 1},
		{"objet", "Plan ancien : observatoire", 1, 1},
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
		g.Ruins[id] = &Ruin{
			ID: id, Type: def.Type, Name: def.Name, Icon: def.Icon,
			X: i % g.Width, Y: i / g.Width,
			ClearPA: def.ClearPA, Charges: ruinCharges,
		}
		g.Tiles[i].RuinID = id
	}
}

// ruinUnderHero validates the shared preconditions of both ruin actions and
// returns the hero + the ruin standing on their tile.
func (g *GameState) ruinUnderHero(heroID string) (*Hero, *Ruin, error) {
	if g.ActiveCombat != "" {
		return nil, nil, ActionError{"un combat est en cours"}
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
	def, ok := ruinDefs[g.TileAt(h.X, h.Y).Biome]
	if !ok {
		return nil, ActionError{"donjon corrompu"}
	}
	h.PA -= ruinExplorePA
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	ru.Charges--
	d := weightedDrop(def.Loot)
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
