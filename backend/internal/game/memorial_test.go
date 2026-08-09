package game

import (
	"strings"
	"testing"
)

// memorialWorld stages a plain grass map with a town at the centre.
func memorialWorld(side int, seed int64) *GameState {
	g := &GameState{Width: side, Height: side, Seed: seed, Monsters: map[string]*Monster{}, Day: 1}
	g.Tiles = make([]Tile, side*side)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: BiomeGrass, Resources: 3}
	}
	g.Town.X, g.Town.Y = side/2, side/2
	g.Town.HP, g.Town.MaxHP = 100, 100
	g.Town.Buildings = DefaultBuildings()
	return g
}

func sampleFallen() []Memorial {
	return []Memorial{
		{TownName: "Clairmont", Wave: 19, Defenders: []string{"Ana", "Bo", "Zoé"}},
		{TownName: "Valbourg", Wave: 12, Defenders: []string{"Kim"}},
		{TownName: "Ormefont", Wave: 8},
	}
}

// Une ville tombée devient un LIEU sur les cartes suivantes : son nom, sa dernière
// vague, ses défenseurs. C'est la réponse au trou de rétention principal — une partie
// dure sept à neuf jours réels et se termine par une défaite ; jusqu'ici elle ne
// laissait qu'une ligne de classement.
func TestFallenTownsBecomeRuinsOnLaterMaps(t *testing.T) {
	g := memorialWorld(40, 7)
	if n := g.SeedMemorialRuins(sampleFallen()); n < 1 {
		t.Fatalf("au moins un mémorial doit être posé, got %d", n)
	}
	var found *Ruin
	for _, r := range g.Ruins {
		if r.Type == "memorial" {
			found = r
			break
		}
	}
	if found == nil {
		t.Fatal("aucune ruine de type mémorial")
	}
	if !strings.HasPrefix(found.Name, "Ruines de ") {
		t.Fatalf("le mémorial doit porter le nom de la ville, got %q", found.Name)
	}
	if found.FellAtWave <= 0 {
		t.Fatal("le mémorial doit retenir la vague qui l'a emportée")
	}
	// La tuile pointe bien vers lui, et il est assez loin pour être un voyage.
	if tl := g.TileAt(found.X, found.Y); tl == nil || tl.RuinID != found.ID {
		t.Fatal("la tuile doit porter le RuinID du mémorial")
	}
	if d := cheb(found.X-g.Town.X, found.Y-g.Town.Y); d < memorialMinDistance {
		t.Fatalf("un mémorial est un voyage, pas un décor de banlieue : distance %d", d)
	}
}

// L'épitaphe est ce qui porte l'émotion — elle doit nommer les gens.
func TestMemorialEpitaphNamesItsDefenders(t *testing.T) {
	r := &Ruin{FellAtWave: 19, Defenders: []string{"Ana", "Bo", "Zoé"}}
	got := r.Epitaph()
	for _, want := range []string{"19", "Ana", "Bo", "Zoé", " et "} {
		if !strings.Contains(got, want) {
			t.Fatalf("épitaphe %q : il y manque %q", got, want)
		}
	}
	// Une ville dont on ne sait plus rien garde une inscription, pas un blanc.
	lonely := (&Ruin{FellAtWave: 8}).Epitaph()
	if lonely == "" || !strings.Contains(lonely, "8") {
		t.Fatalf("une ville sans défenseurs connus garde une épitaphe, got %q", lonely)
	}
	// Une ruine ORDINAIRE n'en a pas.
	if plain := (&Ruin{Type: "ferme"}).Epitaph(); plain != "" {
		t.Fatalf("une ruine ordinaire n'a pas d'épitaphe, got %q", plain)
	}
}

// Deux mémoriaux ne se posent jamais sur la même case, et ils n'écrasent pas les
// ruines de biome semées avant eux.
func TestMemorialsDoNotCollide(t *testing.T) {
	g := memorialWorld(120, 3)
	g.SeedRuins()
	before := len(g.Ruins)
	n := g.SeedMemorialRuins(sampleFallen())
	if n < 2 {
		t.Fatalf("une grande carte doit porter plusieurs mémoriaux, got %d", n)
	}
	if len(g.Ruins) != before+n {
		t.Fatalf("les mémoriaux doivent s'AJOUTER aux ruines de biome : %d -> %d (+%d posés)",
			before, len(g.Ruins), n)
	}
	seen := map[[2]int]string{}
	for _, r := range g.Ruins {
		k := [2]int{r.X, r.Y}
		if other, dup := seen[k]; dup {
			t.Fatalf("deux ruines sur la case (%d,%d) : %s et %s", r.X, r.Y, other, r.ID)
		}
		seen[k] = r.ID
		if tl := g.TileAt(r.X, r.Y); tl == nil || tl.RuinID != r.ID {
			t.Fatalf("la tuile de %s ne pointe pas vers elle", r.ID)
		}
	}
}

// Même graine, même monde : le placement des mémoriaux ne doit pas dépendre du hasard
// d'exécution (toute l'architecture repose sur « rejouer le temps écoulé »).
func TestMemorialPlacementIsDeterministic(t *testing.T) {
	place := func() []string {
		g := memorialWorld(60, 42)
		g.SeedMemorialRuins(sampleFallen())
		var out []string
		for _, r := range g.Ruins {
			out = append(out, r.Name)
		}
		return out
	}
	a, b := place(), place()
	if len(a) != len(b) || len(a) == 0 {
		t.Fatalf("placements de tailles différentes : %v vs %v", a, b)
	}
}

// Ce qu'on récupère dans une ville morte, ce sont ses MATÉRIAUX — pas de la puissance.
// Une progression entre parties casserait l'égalité qui fait tenir une survie de
// groupe et ferait des nouveaux venus des joueurs de seconde classe.
func TestMemorialLootIsPlainBuildingMaterial(t *testing.T) {
	if len(memorialLoot) == 0 {
		t.Fatal("un mémorial doit donner quelque chose")
	}
	staples := 0
	for _, d := range memorialLoot {
		if d.Name == "Pierre" || d.Name == "Bois" || d.Name == "Planche" {
			staples += d.Weight
		}
		if strings.Contains(strings.ToLower(d.Name), "plan de") {
			t.Fatalf("pas de plan de bâtiment dans un mémorial : %q (ce serait un raccourci de progression)", d.Name)
		}
	}
	if staples < 6 {
		t.Fatalf("le legs d'une ville doit être surtout des matériaux de construction (poids %d)", staples)
	}
}
