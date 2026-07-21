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

// La ville naît sur l'herbe : les matériaux de base DOIVENT s'y fouiller, sinon
// le joueur ne peut jamais amorcer la moindre construction.
func TestGrassYieldsBasicBuildMaterials(t *testing.T) {
	has := func(b Biome, name string) bool {
		for _, d := range Terrains[b].Drops {
			if d.Name == name {
				return true
			}
		}
		return false
	}
	for _, name := range []string{"Bois", "Pierre"} {
		if !has(BiomeGrass, name) {
			t.Errorf("le terrain herbe (case de la ville) doit pouvoir donner %q", name)
		}
	}
}

// Bout en bout : fouiller de l'herbe finit par rendre Bois ET Pierre (les
// matériaux de base) — le joueur peut amorcer la construction depuis le départ.
func TestSearchingGrassYieldsBuildMaterials(t *testing.T) {
	g := &GameState{Width: 3, Height: 3, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 9)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: BiomeGrass, Resources: 9999}
	}
	g.Town.X, g.Town.Y = 0, 0
	h := &Hero{ID: "h", Name: "Test", X: 1, Y: 1, PA: 1, MaxPA: 6, Bars: map[string]int{}}
	g.Heroes = []*Hero{h}
	got := map[string]int{}
	for i := 0; i < 400; i++ {
		h.PA = 1
		it, err := g.SearchTile("h")
		if err != nil {
			t.Fatalf("fouille %d: %v", i, err)
		}
		got[it.Name]++
	}
	if got["Bois"] == 0 || got["Pierre"] == 0 {
		t.Fatalf("400 fouilles d'herbe doivent donner Bois ET Pierre, obtenu: %v", got)
	}
}
