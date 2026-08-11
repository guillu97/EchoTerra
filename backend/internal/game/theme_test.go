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
		seen[PickTheme(base + i*1_000_000).ID]++
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
