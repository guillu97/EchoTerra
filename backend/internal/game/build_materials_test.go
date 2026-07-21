package game

import "testing"

// Garde-fou d'ÉCONOMIE : aucun bâtiment ne doit exiger un matériau qu'on ne peut
// jamais obtenir. Un matériau est « obtenable » s'il tombe d'une fouille de
// terrain, d'un pack de monstre vaincu, OU s'il se craft à partir d'ingrédients
// eux-mêmes obtenables (clôture transitive). La ville naissant sur l'herbe, on
// vérifie aussi que Bois et Pierre (matériaux de base) tombent bien sur l'herbe.
func TestEveryBuildingMaterialIsObtainable(t *testing.T) {
	obtainable := map[string]bool{}
	for _, td := range Terrains {
		for _, d := range td.Drops {
			obtainable[d.Name] = true
		}
	}
	for i := range Species {
		for _, d := range Species[i].Drops {
			obtainable[d.Name] = true
		}
	}
	// clôture par le craft, itérée jusqu'au point fixe
	for changed := true; changed; {
		changed = false
		for _, r := range Recipes {
			out := r.OutputName
			if out == "" {
				out = r.Name
			}
			if obtainable[out] {
				continue
			}
			all := true
			for _, ing := range r.Ingredients {
				if !obtainable[ing.Name] {
					all = false
					break
				}
			}
			if all {
				obtainable[out] = true
				changed = true
			}
		}
	}

	for id, bd := range BuildingDesigns {
		for lvl, ld := range bd.Levels {
			for _, m := range ld.Materials {
				if !obtainable[m.Name] {
					t.Errorf("bâtiment %q niv.%d exige %q — ni lootable ni craftable", id, lvl+1, m.Name)
				}
			}
		}
	}
}

// Spécialisation : la FORÊT donne le bois, la MONTAGNE la pierre (le worldgen les
// place près de la ville, cf. TestEnsureNearbyBiomes).
func TestForestYieldsWoodMountainYieldsStone(t *testing.T) {
	has := func(b Biome, name string) bool {
		for _, d := range Terrains[b].Drops {
			if d.Name == name {
				return true
			}
		}
		return false
	}
	if !has(BiomeForest, "Bois") {
		t.Error("la forêt doit donner du Bois")
	}
	if !has(BiomeMountain, "Pierre") {
		t.Error("la montagne doit donner de la Pierre")
	}
}

// ÉPUISEMENT : une case fraîche rend sa ressource ; une fois épuisée elle ne rend
// plus grand chose (surtout des débris), mais reste fouillable.
func TestTileDepletionYieldsMostlyDebris(t *testing.T) {
	g := &GameState{Width: 3, Height: 3, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 9)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: BiomeForest, Resources: 3}
	}
	g.Town.X, g.Town.Y = 0, 0
	h := &Hero{ID: "h", Name: "Test", X: 1, Y: 1, PA: 1, MaxPA: 6, Bars: map[string]int{}}
	g.Heroes = []*Hero{h}
	// vide les 3 ressources de la case
	for i := 0; i < 3; i++ {
		h.PA = 1
		if _, err := g.SearchTile("h"); err != nil {
			t.Fatalf("fouille riche %d: %v", i, err)
		}
	}
	if g.TileAt(1, 1).Resources != 0 {
		t.Fatalf("la case devrait être épuisée, reste %d", g.TileAt(1, 1).Resources)
	}
	// épuisée : encore fouillable, mais surtout des débris
	debris := 0
	for i := 0; i < 200; i++ {
		h.PA = 1
		it, err := g.SearchTile("h")
		if err != nil {
			t.Fatalf("fouille épuisée %d: %v", i, err)
		}
		if it.Name == "Débris" {
			debris++
		}
	}
	if debris < 100 {
		t.Fatalf("une case épuisée doit rendre surtout des débris, %d/200", debris)
	}
}
