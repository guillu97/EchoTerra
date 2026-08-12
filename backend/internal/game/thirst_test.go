package game

import "testing"

// LA SOIF (thirst.go) — la contrainte de l'expédition désertique.

// thirstGame monte une partie minimale sur un thème donné.
func thirstGame(theme string, heroes int) *GameState {
	g := &GameState{ThemeID: theme, Status: StatusActive, Day: 1, Width: 5, Height: 5}
	g.Tiles = make([]Tile, 25)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: BiomeGrass, Resources: 5}
	}
	g.Town.X, g.Town.Y = 2, 2
	g.Town.HP, g.Town.MaxHP = 100, 100
	for i := 0; i < heroes; i++ {
		g.Heroes = append(g.Heroes, &Hero{
			ID: string(rune('a' + i)), Name: "H", X: 2, Y: 2,
			PA: 6, MaxPA: 6, HP: 20, MaxHP: 20,
			Bars: map[string]int{},
		})
	}
	return g
}

func TestThirstOnlyBitesOnAThirstyTheme(t *testing.T) {
	for _, tc := range []struct {
		theme   string
		thirsty bool
	}{{ThemeTempere, false}, {"nordique", false}, {"desertique", true}} {
		g := thirstGame(tc.theme, 1)
		g.Day = 3 // le héros n'a jamais bu (DrewWaterDay 0)
		g.applyThirst()
		got := g.Heroes[0].HasState(StateSoif)
		if got != tc.thirsty {
			t.Errorf("thème %s : soif = %v, attendu %v", tc.theme, got, tc.thirsty)
		}
	}
}

func TestDrinkingTodayKeepsThirstAway(t *testing.T) {
	g := thirstGame("desertique", 2)
	g.Day = 4
	g.Heroes[0].DrewWaterDay = 3 // a bu pendant la journée qui s'achève
	g.Heroes[1].DrewWaterDay = 1 // pas depuis deux jours
	g.applyThirst()
	if g.Heroes[0].HasState(StateSoif) {
		t.Error("un héros qui a bu hier ne doit pas avoir soif")
	}
	if !g.Heroes[1].HasState(StateSoif) {
		t.Error("un héros qui n'a pas bu depuis deux jours doit avoir soif")
	}
}

// La soif se paie en PA, jamais en PV — elle ralentit, elle ne tue pas (règle 5 : ne
// jamais piéger un joueur absent).
func TestThirstCostsPointsNotBlood(t *testing.T) {
	g := thirstGame("desertique", 1)
	h := g.Heroes[0]
	h.AddState(StateSoif)
	hpBefore := h.HP
	if got := thirstPenalty(h); got != thirstPA {
		t.Fatalf("pénalité = %d, attendu %d", got, thirstPA)
	}
	if h.HP != hpBefore {
		t.Error("la soif ne doit pas coûter de PV")
	}
	h.RemoveState(StateSoif)
	if got := thirstPenalty(h); got != 0 {
		t.Errorf("sans soif la pénalité doit être nulle, %d", got)
	}
}

// ⚠ UN ASSOIFFÉ N'EST JAMAIS BLOQUÉ : il doit lui rester de quoi marcher jusqu'au
// puits, même avec un maximum de PA ridicule.
func TestAThirstyHeroAlwaysHasAPointLeft(t *testing.T) {
	g := thirstGame("desertique", 1)
	h := g.Heroes[0]
	h.MaxPA, h.PA = 2, 0
	h.AddState(StateSoif)
	g.WaveNumber, g.Wave = 1, 1
	g.NextWaveAt = g.clock()
	g.processWave(g.clock(), true)
	if h.PA < 1 {
		t.Errorf("un héros assoiffé se réveille avec %d PA — il ne peut plus rien faire", h.PA)
	}
}

// Le puits ne se remplit plus tout seul en désert : c'est ce qui force à ALLER
// CHERCHER l'eau plutôt qu'à l'attendre.
func TestDesertWellRefillsSlower(t *testing.T) {
	desert := thirstGame("desertique", 1).wellRefill()
	plain := thirstGame(ThemeTempere, 1).wellRefill()
	if desert >= plain {
		t.Errorf("recharge désert %d, tempéré %d — le désert doit être plus dur", desert, plain)
	}
	if plain != wellRefillDefault {
		t.Errorf("le thème témoin doit garder la recharge ordinaire (%d), il a %d", wellRefillDefault, plain)
	}
}

// L'oasis EST la palmeraie (le biome forêt) : le thème AJOUTE de l'eau à sa table sans
// jamais lui retirer son bois.
func TestThemeAddsWaterWithoutRemovingWood(t *testing.T) {
	g := thirstGame("desertique", 1)
	td, ok := g.terrainFor(BiomeForest)
	if !ok {
		t.Fatal("la palmeraie doit rester un terrain fouillable")
	}
	var water, wood bool
	for _, d := range td.Drops {
		if d.Name == WaterRation {
			water = true
		}
		if d.Name == "Bois" {
			wood = true
		}
	}
	if !water {
		t.Error("la palmeraie du désert doit rendre de l'eau")
	}
	if !wood {
		t.Error("⚠ un thème n'enlève JAMAIS rien : la palmeraie doit toujours donner du bois")
	}
	// …et la table du monde ordinaire n'est pas contaminée.
	plain, _ := thirstGame(ThemeTempere, 1).terrainFor(BiomeForest)
	for _, d := range plain.Drops {
		if d.Name == WaterRation {
			t.Error("la forêt tempérée ne doit pas rendre d'eau")
		}
	}
	// ⚠ la table SOURCE ne doit pas avoir été modifiée en place : terrainFor copie.
	for _, d := range Terrains[BiomeForest].Drops {
		if d.Name == WaterRation {
			t.Fatal("terrainFor a muté le catalogue global — toutes les parties boiraient")
		}
	}
}

// La contrainte doit être ANNONCÉE (règle 4) : sans ligne dans l'ordre du jour, une
// contrainte est une punition.
func TestThirstIsAnnouncedInTheOrders(t *testing.T) {
	g := thirstGame("desertique", 3)
	g.Town.Buildings = DefaultBuildings()
	for _, h := range g.Heroes {
		h.AddState(StateSoif)
	}
	found := false
	for _, o := range g.BuildOrders() {
		if o.Kind == "thirst" {
			found = true
		}
	}
	if !found {
		t.Error("l'ordre du jour doit annoncer la soif")
	}
	// …et se taire sur une carte qui n'a pas soif.
	plain := thirstGame(ThemeTempere, 3)
	plain.Town.Buildings = DefaultBuildings()
	for _, h := range plain.Heroes {
		h.AddState(StateSoif)
	}
	for _, o := range plain.BuildOrders() {
		if o.Kind == "thirst" {
			t.Error("pas de ligne de soif sur une carte tempérée")
		}
	}
}

// Un joueur-IA qui porte de quoi boire boit — sans quoi la contrainte ne serait qu'un
// impôt sur les bots, et la simulation d'équilibrage mesurerait autre chose que le jeu.
func TestABotDrinksWhenThirsty(t *testing.T) {
	g := thirstGame("desertique", 1)
	h := g.Heroes[0]
	h.AddState(StateSoif)
	h.AddLoot(Item{Type: "eau", Name: WaterRation, Qty: 1})
	if !g.botUseItem(h) {
		t.Fatal("un bot assoiffé avec une ration doit boire")
	}
	if h.HasState(StateSoif) {
		t.Error("boire doit retirer la Soif")
	}
}
