package game

import "testing"

// LES GARDE-FOUS D'UN THÈME (theme.go, RETENTION-PLAN.md §8). Un thème est une PEAU et
// un BIAIS : tout ce qui suit vérifie qu'il ne devient jamais autre chose.

func TestPickThemeIsDeterministicAndSpread(t *testing.T) {
	// Même graine, même thème — comme tout le reste du worldgen (cf. rng.go).
	for _, seed := range []int64{1, 42, -7, 1754938201000000000} {
		a, b := PickTheme(seed), PickTheme(seed)
		if a.ID != b.ID {
			t.Fatalf("graine %d : deux tirages, deux thèmes (%s puis %s)", seed, a.ID, b.ID)
		}
	}
	// Des graines CONSÉCUTIVES (time.Now().UnixNano() en jeu) doivent se répartir :
	// sans mélange, trois parties créées à la suite tombaient sur le même thème.
	seen := map[string]int{}
	base := int64(1754938201000000000)
	for i := int64(0); i < 60; i++ {
		seen[PickTheme(base+i*1_000_000).ID]++
	}
	if len(seen) < len(Themes) {
		t.Errorf("60 graines consécutives ne couvrent que %d thèmes sur %d : %v", len(seen), len(Themes), seen)
	}
}

func TestUnknownThemeFallsBackToTempere(t *testing.T) {
	// Une partie enregistrée AVANT les thèmes n'a pas de ThemeID : elle doit continuer
	// de tourner, et elle est tempérée par construction.
	g := &GameState{}
	if th := g.Theme(); th == nil || th.ID != ThemeTempere {
		t.Fatalf("partie sans thème : %v, attendu %s", th, ThemeTempere)
	}
	if th := ThemeByID("licorne"); th.ID != ThemeTempere {
		t.Errorf("thème inconnu : %s, attendu le repli tempéré", th.ID)
	}
}

func TestTempereIsTheReferenceMap(t *testing.T) {
	// Le thème témoin ne biaise RIEN : c'est la carte d'avant les thèmes, celle dont
	// dépend tout l'équilibrage. S'il se met à mordre, la référence a bougé.
	if b := ThemeByID(ThemeTempere).Bias; b != 0 {
		t.Errorf("le thème tempéré doit être neutre, biais = %v", b)
	}
}

func TestBiomeLabelRenamesWithoutMovingTheBiome(t *testing.T) {
	g := &GameState{ThemeID: "desertique"}
	if got := g.BiomeLabel(BiomeForest); got != "Palmeraie" {
		t.Errorf("forêt en désert = %q, attendu Palmeraie", got)
	}
	// ⚠ le renommage est de la PRÉSENTATION : le biome, lui, ne bouge pas — c'est
	// toute la tenue du système (Terrains, Species.Biomes, ruinDefs sont indexés
	// dessus).
	if BiomeForest != 3 {
		t.Fatalf("l'identifiant du biome forêt a changé (%d) : tout le design est indexé dessus", BiomeForest)
	}
	tempere := &GameState{}
	if got := tempere.BiomeLabel(BiomeForest); got != "Forêt" {
		t.Errorf("forêt en tempéré = %q, attendu Forêt", got)
	}
}

// ⚠ UN THÈME RHABILLE, IL NE REDISTRIBUE PAS. Chaque ruine porte le plan d'une
// spécialité et une seule ; si un thème pouvait déplacer les tables de butin, un
// bâtiment deviendrait inatteignable selon le tirage — et le tirage, personne ne le
// choisit.
func TestAThemeOnlyReskinsRuins(t *testing.T) {
	for _, th := range Themes {
		for biome, skin := range th.RuinNames {
			if _, ok := ruinDefs[biome]; !ok {
				t.Errorf("thème %s : peau de ruine pour le biome %d, qui n'en a pas", th.ID, biome)
			}
			if skin.Name == "" || skin.Icon == "" {
				t.Errorf("thème %s, biome %d : peau incomplète %+v", th.ID, biome, skin)
			}
		}
	}
	// La structure elle-même l'interdit : RuinSkin ne porte QUE Name et Icon. Ce test
	// existe pour qu'on s'en souvienne en ajoutant un champ.
	var skin RuinSkin
	skin.Name, skin.Icon = "x", "y"
}

// Tout plan de bâtiment doit rester obtenable, quel que soit le thème — sinon un
// bâtiment du catalogue disparaît de certaines parties.
func TestEveryBuildingPlanDropsSomewhere(t *testing.T) {
	sources := map[string]bool{}
	for _, def := range ruinDefs {
		for _, d := range def.Loot {
			sources[d.Name] = true
		}
	}
	for _, td := range Terrains {
		for _, d := range td.Drops {
			sources[d.Name] = true
		}
	}
	for _, b := range DefaultBuildings() {
		plan := buildingPlanItem(b.ID)
		if plan == "" {
			continue // bâtiment de départ : pas de plan à trouver
		}
		if !sources[plan] {
			t.Errorf("%q ne tombe de NULLE PART : le bâtiment %s est inatteignable", plan, b.ID)
		}
	}
}

// LES ARMES D'UN THÈME (equipment.go + craft.go, lot 3).
//
// ⚠ RÈGLE : un thème donne un AUTRE CHEMIN vers une puissance qui existe déjà, jamais
// une puissance de plus. Ce test tient la règle : aucune arme de thème ne doit dépasser
// la meilleure arme ordinaire de son archétype.
func TestThemeWeaponsAreLateralNotStronger(t *testing.T) {
	themed := map[string]bool{"Khopesh de verre": true, "Harpon de givre": true}
	best := map[string]int{} // archétype -> meilleure force ORDINAIRE
	for name, e := range Equipment {
		if e.Weapon == "" || themed[name] {
			continue
		}
		if e.Force > best[e.Weapon] {
			best[e.Weapon] = e.Force
		}
	}
	for name := range themed {
		e, ok := Equipment[name]
		if !ok {
			t.Fatalf("%q n'est pas au catalogue d'équipement", name)
		}
		if e.Force > best[e.Weapon] {
			t.Errorf("%q donne %d de force, la meilleure arme ordinaire de son archétype en donne %d — un thème ne doit pas relever le plafond",
				name, e.Force, best[e.Weapon])
		}
		// …et elle doit être FORGEABLE : une arme sans recette n'existe pas.
		found := false
		for _, r := range Recipes {
			if r.Name == name {
				found = true
			}
		}
		if !found {
			t.Errorf("%q n'a aucune recette", name)
		}
	}
}

// Le matériau d'une arme de thème ne tombe QUE là où le thème le fournit : c'est ce qui
// la rend plausible sur sa carte sans qu'un seul `if theme ==` figure dans le craft.
func TestThemeWeaponMaterialComesFromItsLand(t *testing.T) {
	has := func(theme string, b Biome, item string) bool {
		g := &GameState{ThemeID: theme}
		td, _ := g.terrainFor(b)
		for _, d := range td.Drops {
			if d.Name == item {
				return true
			}
		}
		return false
	}
	if !has("desertique", BiomeSand, "Verre du désert") {
		t.Error("le verre des dunes doit tomber sur le sable désertique")
	}
	for _, theme := range []string{ThemeTempere, "nordique"} {
		if has(theme, BiomeSand, "Verre du désert") {
			t.Errorf("thème %s : le verre du désert ne devrait pas exister ici", theme)
		}
	}
	// Le givre, lui, vient de la NEIGE — présente partout mais rare hors du nord (voir
	// worldgen.snowCaps) : le harpon se forge donc surtout là où il a du sens.
	if !has(ThemeTempere, BiomeSnow, "Givre éternel") {
		t.Error("le givre éternel doit rester une trouvaille de neige, quel que soit le thème")
	}
}
