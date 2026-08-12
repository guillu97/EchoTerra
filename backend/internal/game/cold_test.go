package game

import "testing"

// LE FROID (cold.go) — la contrainte de l'expédition nordique.

func coldGame(theme string, heroes int) *GameState {
	g := thirstGame(theme, heroes) // même échafaudage minimal
	g.Town.Buildings = DefaultBuildings()
	return g
}

func TestColdOnlyBitesOnAColdTheme(t *testing.T) {
	for _, tc := range []struct {
		theme  string
		frozen bool
	}{{ThemeTempere, false}, {"desertique", false}, {"nordique", true}} {
		g := coldGame(tc.theme, 1)
		g.Heroes[0].X, g.Heroes[0].Y = 0, 0 // dehors, à découvert
		g.applyCold(false)                  // foyers éteints
		if got := g.Heroes[0].HasState(StateGele); got != tc.frozen {
			t.Errorf("thème %s : gelé = %v, attendu %v", tc.theme, got, tc.frozen)
		}
	}
}

// Foyers ÉTEINTS : tout le monde gèle, y compris dans les murs — c'est ce qui fait de la
// corvée de bois une affaire collective et non un souci de baroudeur.
func TestAnUnlitHearthFreezesEveryone(t *testing.T) {
	g := coldGame("nordique", 2)
	g.Heroes[1].X, g.Heroes[1].Y = 0, 0 // l'un dehors, l'autre en ville
	g.applyCold(false)
	for _, h := range g.Heroes {
		if !h.HasState(StateGele) {
			t.Errorf("foyers éteints : %s devrait geler (en ville : %v)", h.ID, h.X == g.Town.X)
		}
	}
}

// Foyers ALLUMÉS : les murs abritent, et se CACHER aussi — se cacher, c'est déjà avoir
// trouvé un abri, et ça réutilise une mécanique existante plutôt que d'en ajouter une.
func TestALitHearthShelterTownAndHiddenHeroes(t *testing.T) {
	g := coldGame("nordique", 3)
	inTown, hidden, exposed := g.Heroes[0], g.Heroes[1], g.Heroes[2]
	hidden.X, hidden.Y = 0, 0
	hidden.AddState(StateCache)
	exposed.X, exposed.Y = 4, 4
	for _, h := range g.Heroes {
		h.AddState(StateGele) // tous gelés de la veille
	}
	g.applyCold(true)
	if inTown.HasState(StateGele) {
		t.Error("un héros rentré près du feu doit se réchauffer")
	}
	if hidden.HasState(StateGele) {
		t.Error("un héros caché est à l'abri du froid")
	}
	if !exposed.HasState(StateGele) {
		t.Error("un héros dehors et à découvert gèle même quand la ville a du feu")
	}
}

// ⚠ ON BRÛLE D'ABORD CE QUI NE SERT À RIEN D'AUTRE. Sans cet ordre, le feu mangeait le
// bois des chantiers et restait éteint 46 nuits sur 48 : la contrainte n'était plus un
// choix, mais un impôt permanent.
func TestTheHearthBurnsJunkBeforeTimber(t *testing.T) {
	g := coldGame("nordique", 1)
	g.addStorage(Item{Type: "objet", Name: "Débris", Qty: 1})
	g.addStorage(Item{Type: "objet", Name: "Bois", Qty: 5})
	g.addStorage(Item{Type: "minerai", Name: "Charbon", Qty: 5})
	if !g.burnHearth() {
		t.Fatal("avec du combustible, les foyers doivent tenir")
	}
	if g.storageQty("Débris") != 0 {
		t.Error("les Débris devaient partir en premier")
	}
	if g.storageQty("Bois") != 5 || g.storageQty("Charbon") != 5 {
		t.Errorf("bois %d, charbon %d : rien d'autre ne devait brûler", g.storageQty("Bois"), g.storageQty("Charbon"))
	}
	g.burnHearth() // plus de débris : c'est au bois d'y passer
	if g.storageQty("Bois") != 4 {
		t.Errorf("le bois devait suivre les débris, il en reste %d", g.storageQty("Bois"))
	}
}

func TestAnEmptyBankLeavesTheHearthDark(t *testing.T) {
	g := coldGame("nordique", 1)
	if g.burnHearth() {
		t.Error("sans combustible, les foyers ne peuvent pas tenir")
	}
	// …et une carte sans froid ne brûle jamais rien.
	plain := coldGame(ThemeTempere, 1)
	plain.addStorage(Item{Type: "objet", Name: "Bois", Qty: 3})
	if !plain.burnHearth() {
		t.Error("un thème sans froid n'a pas de foyers à tenir")
	}
	if plain.storageQty("Bois") != 3 {
		t.Error("⚠ une contrainte de thème ne déborde JAMAIS sur les autres cartes")
	}
}

// La neige n'interrompt QUE la fouille automatique. La fouille manuelle rend son butin
// comme d'habitude et déblaie la case : le coût de la neige est de devoir revenir, pas
// une ressource perdue.
func TestSnowStopsTheCampNotTheHero(t *testing.T) {
	g := coldGame("nordique", 1)
	h := g.Heroes[0]
	h.X, h.Y = 1, 1
	tile := g.TileAt(1, 1)
	tile.Covered = true
	h.ForageAt = g.clock() // installé à récolter
	if g.canForage(h) {
		t.Error("une case enneigée ne se récolte pas toute seule")
	}
	if _, err := g.SearchTile(h.ID); err != nil {
		t.Fatalf("la fouille manuelle doit rester possible : %v", err)
	}
	if tile.Covered {
		t.Error("fouiller doit déblayer la neige")
	}
	if !g.canForage(h) {
		t.Error("une fois déblayée, la case se récolte de nouveau")
	}
}

// La neige TOMBE et FOND. Sans dégel elle s'accumulait indéfiniment — mesuré : un quart
// de la carte gelé pour toujours, ce qui n'est plus une météo mais une amputation.
func TestSnowFallsAndMelts(t *testing.T) {
	g := coldGame("nordique", 1)
	g.Width, g.Height = 20, 20
	g.Tiles = make([]Tile, 400)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: BiomeGrass, Resources: 3}
	}
	g.Town.X, g.Town.Y = 10, 10
	SeedRNG(7)
	total := 0
	for i := 0; i < 30; i++ {
		g.snowmelt()
		total += g.snowfall()
	}
	covered := 0
	for _, tl := range g.Tiles {
		if tl.Covered {
			covered++
		}
	}
	if total == 0 {
		t.Fatal("il doit neiger sur une carte nordique")
	}
	if covered >= total {
		t.Errorf("la neige doit fondre : %d cases couvertes pour %d chutes cumulées", covered, total)
	}
	// La case ville n'est jamais ensevelie (on ne bloque pas le seul refuge).
	if g.TileAt(g.Town.X, g.Town.Y).Covered {
		t.Error("la ville ne se couvre pas de neige")
	}
	// …et rien de tout ça n'arrive ailleurs.
	plain := coldGame(ThemeTempere, 1)
	if n := plain.snowfall(); n != 0 {
		t.Errorf("il ne neige pas sur une carte tempérée (%d cases)", n)
	}
}

// Soif ET gel peuvent se cumuler ; le plancher d'un PA tient quand même.
func TestFrozenAndThirstyStillWakesUpAble(t *testing.T) {
	g := coldGame("nordique", 1)
	h := g.Heroes[0]
	h.MaxPA, h.PA = 3, 0
	h.AddState(StateGele)
	h.AddState(StateSoif)
	if coldPenalty(h)+thirstPenalty(h) < h.MaxPA {
		t.Skip("le cumul ne dépasse pas le maximum : ce test n'a rien à défendre")
	}
	g.WaveNumber, g.Wave = 1, 1
	g.NextWaveAt = g.clock()
	g.processWave(g.clock(), true)
	if h.PA < 1 {
		t.Errorf("un héros transi et assoiffé se réveille avec %d PA", h.PA)
	}
}

// La contrainte doit être ANNONCÉE (règle 4).
func TestColdIsAnnouncedInTheOrders(t *testing.T) {
	g := coldGame("nordique", 2)
	found := false
	for _, o := range g.BuildOrders() {
		if o.Kind == "cold" {
			found = true
		}
	}
	if !found {
		t.Error("banque vide : l'ordre du jour doit annoncer que la ville va geler")
	}
	plain := coldGame("desertique", 2)
	for _, o := range plain.BuildOrders() {
		if o.Kind == "cold" {
			t.Error("pas de ligne de froid sur une carte qui n'a pas froid")
		}
	}
}
