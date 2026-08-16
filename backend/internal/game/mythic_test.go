package game

import (
	"strings"
	"testing"
	"time"
)

// mythicGame monte une ville jouable pour les tests de faveur : un joueur, un héros en
// ville, un Temple debout au niveau demandé, et de quoi fabriquer.
func mythicGame(t *testing.T, themeID string, templeLevel int) (*GameState, *Hero, string) {
	t.Helper()
	g := &GameState{ID: "g", Status: StatusActive, Width: 5, Height: 5, ThemeID: themeID}
	g.Tiles = make([]Tile, 25)
	g.Monsters = map[string]*Monster{}
	g.Town.X, g.Town.Y = 2, 2
	g.Town.HP, g.Town.MaxHP = 100, 100
	g.Town.Buildings = DefaultBuildings()
	h := &Hero{ID: "h1", Name: "Gui", X: 2, Y: 2, HP: 10, MaxHP: 10, PA: 6, MaxPA: 6}
	g.Heroes = []*Hero{h}
	g.Players = []*Player{{ID: "p1", Name: "Gui", HeroIDs: []string{"h1"}}}
	if templeLevel > 0 {
		b := g.buildingByID("temple")
		b.Built, b.Level = true, templeLevel
		b.Durability, b.MaxDurability = 90, 90
	}
	g.Recompute()
	return g, h, "p1"
}

// UN PANTHÉON PAR THÈME, et le grec par défaut : c'est la terre de référence, donc celle
// des parties enregistrées avant que les thèmes existent.
func TestEachThemeHasItsPantheon(t *testing.T) {
	want := map[string]string{"": "olympe", ThemeTempere: "olympe", "nordique": "asgard", "desertique": "duat"}
	for themeID, pantheonID := range want {
		g := &GameState{ThemeID: themeID}
		if got := g.Pantheon().ID; got != pantheonID {
			t.Errorf("thème %q : panthéon %q, attendu %q", themeID, got, pantheonID)
		}
	}
	for _, th := range Themes {
		if th.Pantheon == nil {
			t.Fatalf("le thème %s n'a pas de panthéon", th.ID)
		}
	}
}

// LA RÈGLE DES THÈMES : un panthéon est une PEAU. Les trois servent les mêmes trois
// domaines, donc aucun tirage de carte ne donne de meilleurs dieux qu'un autre — même
// contrat que TestThemeWeaponsAreLateralNotStronger pour les armes.
func TestPantheonsAreLateralNotStronger(t *testing.T) {
	want := []string{DomainRampart, DomainHarvest, DomainBlade}
	for _, p := range Pantheons {
		if len(p.Gods) != len(want) {
			t.Fatalf("%s : %d dieux, attendu %d", p.ID, len(p.Gods), len(want))
		}
		for i, dom := range want {
			if p.Gods[i].Domain != dom {
				t.Errorf("%s : dieu %d sert %q, attendu %q", p.ID, i, p.Gods[i].Domain, dom)
			}
		}
		if p.Favor == "" || p.Temple == "" {
			t.Errorf("%s : il manque l'icône de faveur ou le nom du temple", p.ID)
		}
	}
}

// LA DÉCO VERSE DE LA FAVEUR — c'est ce qui remplace le « moral de la ville » qui n'a
// jamais existé. Et elle la verse en dépensant du BOIS, donc en concurrence avec les murs.
func TestCraftingDecoGrantsFavor(t *testing.T) {
	g, h, _ := mythicGame(t, ThemeTempere, 0)
	g.addStorage(Item{Type: "objet", Name: "Bois", Qty: 3})
	if _, err := g.Craft("wooden_totem", h.ID); err != nil {
		t.Fatalf("craft: %v", err)
	}
	if g.Town.Favor != 3 {
		t.Fatalf("faveur %d, attendu 3", g.Town.Favor)
	}
	if g.storageQty("Bois") != 0 {
		t.Errorf("le bois n'a pas été consommé : %d restants", g.storageQty("Bois"))
	}
	// Une recette ordinaire ne verse rien : seule l'offrande orne la ville.
	g.addStorage(Item{Type: "objet", Name: "Bois", Qty: 2})
	h.PA = 6
	if _, err := g.Craft("plank", h.ID); err != nil {
		t.Fatalf("craft planche: %v", err)
	}
	if g.Town.Favor != 3 {
		t.Errorf("une planche a versé de la faveur (%d)", g.Town.Favor)
	}
}

// TOUTE RECETTE DE DÉCO DOIT VERSER DE LA FAVEUR. C'est la garde contre l'oubli : une
// recette ajoutée à la catégorie sans son champ Favor serait exactement le « moral de la
// ville » d'avant — un objet qu'on paie et qui ne fait rien.
func TestEveryDecoRecipePaysFavor(t *testing.T) {
	n := 0
	for _, r := range Recipes {
		if r.Category != "deco" {
			if r.Favor != 0 {
				t.Errorf("%s n'est pas une déco mais verse %d faveur", r.ID, r.Favor)
			}
			continue
		}
		n++
		if r.Favor <= 0 {
			t.Errorf("la déco %s ne verse aucune faveur", r.ID)
		}
	}
	if n < 3 {
		t.Fatalf("%d recettes de déco : trop peu pour que la faveur soit une économie", n)
	}
}

// SANS TEMPLE, PAS DE SCRUTIN. La faveur peut monter, elle ne s'échange contre rien.
func TestVoteNeedsATemple(t *testing.T) {
	g, _, pid := mythicGame(t, ThemeTempere, 0)
	g.Town.Favor = 100
	if err := g.VoteBlessing(pid, "zeus"); err == nil {
		t.Fatal("le vote a été accepté sans Temple")
	}
}

// UN DIEU D'UN AUTRE PANTHÉON N'EST PAS APPELABLE : une ville nordique ne prie pas Râ.
func TestVoteRejectsAForeignGod(t *testing.T) {
	g, _, pid := mythicGame(t, "nordique", 1)
	if err := g.VoteBlessing(pid, "ra"); err == nil {
		t.Fatal("Râ a été accepté dans une ville nordique")
	}
	if err := g.VoteBlessing(pid, "thor"); err != nil {
		t.Fatalf("Thor refusé dans une ville nordique : %v", err)
	}
}

// LE CŒUR DU SYSTÈME : on vote, et ça s'applique DÈS LA VAGUE D'APRÈS — la première
// vague que la bénédiction couvre est celle qui tombe après le scrutin.
func TestBlessingAppliesFromTheNextWave(t *testing.T) {
	g, _, pid := mythicGame(t, ThemeTempere, 1)
	g.Town.Favor = BlessingCost
	before := g.TownDefense()
	if err := g.VoteBlessing(pid, "zeus"); err != nil {
		t.Fatalf("vote: %v", err)
	}
	// Tant que la vague n'est pas tombée, rien n'a changé : le scrutin n'est pas
	// dépouillé, et la défense affichée reste honnête.
	if g.TownDefense() != before {
		t.Fatalf("la défense a bougé avant le dépouillement (%d → %d)", before, g.TownDefense())
	}
	g.ProcessWave(time.Now())
	if len(g.Town.Blessings) != 1 || g.Town.Blessings[0].GodID != "zeus" {
		t.Fatalf("Zeus n'a pas répondu : %+v", g.Town.Blessings)
	}
	if g.Town.Favor != 0 {
		t.Errorf("la faveur n'a pas été dépensée : %d", g.Town.Favor)
	}
	if len(g.Town.Votes) != 0 {
		t.Errorf("le scrutin n'a pas été clos : %v", g.Town.Votes)
	}
	// On lit la défense DU RAPPORT : celle mesurée au moment de l'assaut. La relire
	// après coup donnerait une valeur plus basse — la muraille s'est usée en encaissant.
	if got := g.LastWave.Defense; got != before+blessingRampart {
		t.Errorf("défense de la vague %d, attendu %d", got, before+blessingRampart)
	}
}

// SANS LA FAVEUR REQUISE, LE SCRUTIN N'ABOUTIT PAS — et les voix restent posées pour le
// dépouillement suivant : un joueur qui vote la veille ne perd pas sa voix.
func TestVoteWaitsForEnoughFavor(t *testing.T) {
	g, _, pid := mythicGame(t, ThemeTempere, 1)
	g.Town.Favor = BlessingCost - 1
	if err := g.VoteBlessing(pid, "zeus"); err != nil {
		t.Fatalf("vote: %v", err)
	}
	g.ProcessWave(time.Now())
	if len(g.Town.Blessings) != 0 {
		t.Fatalf("un dieu a répondu sans la faveur requise")
	}
	if len(g.Town.Votes) != 1 {
		t.Fatalf("la voix a été perdue : %v", g.Town.Votes)
	}
	g.Town.Favor = BlessingCost
	g.ProcessWave(time.Now())
	if len(g.Town.Blessings) != 1 {
		t.Fatalf("la voix reportée n'a rien donné : %+v", g.Town.Blessings)
	}
}

// UNE BÉNÉDICTION EXPIRE : la faveur est une monnaie qui tourne, pas un palier franchi
// une fois. Sans expiration une ville accumulerait les boons jusqu'à devenir imprenable.
func TestBlessingExpires(t *testing.T) {
	g, _, pid := mythicGame(t, ThemeTempere, 1)
	g.Town.Favor = BlessingCost
	if err := g.VoteBlessing(pid, "demeter"); err != nil {
		t.Fatalf("vote: %v", err)
	}
	g.ProcessWave(time.Now()) // vague 1 : invocation — elle couvre CETTE vague-ci
	for g.WaveNumber < BlessingWaves {
		if !g.hasBlessing(DomainHarvest) {
			t.Fatalf("la bénédiction a disparu dès la vague %d", g.WaveNumber)
		}
		g.ProcessWave(time.Now())
	}
	if !g.hasBlessing(DomainHarvest) {
		t.Fatalf("la bénédiction s'est éteinte avant sa dernière vague (%d)", BlessingWaves)
	}
	g.ProcessWave(time.Now()) // la vague de trop
	if g.hasBlessing(DomainHarvest) {
		t.Fatalf("la bénédiction n'a pas expiré après %d vagues", BlessingWaves)
	}
}

// LE NIVEAU DU TEMPLE = LE NOMBRE DE BÉNÉDICTIONS SIMULTANÉES. C'est son seul effet, et
// il doit être réel : un niveau qu'on paie en bois et en PA ne peut pas être du texte.
func TestTempleLevelIsTheNumberOfSlots(t *testing.T) {
	g, _, pid := mythicGame(t, ThemeTempere, 1)
	g.Town.Favor = BlessingCost * 3
	if err := g.VoteBlessing(pid, "zeus"); err != nil {
		t.Fatalf("vote: %v", err)
	}
	g.ProcessWave(time.Now())
	if err := g.VoteBlessing(pid, "ares"); err != nil {
		t.Fatalf("vote 2: %v", err)
	}
	g.ProcessWave(time.Now())
	if len(g.Town.Blessings) != 1 {
		t.Fatalf("un Temple niveau 1 tient %d bénédictions", len(g.Town.Blessings))
	}
	// On monte le Temple : la place se libère et la voix en attente aboutit.
	g.buildingByID("temple").Level = 2
	g.ProcessWave(time.Now())
	if len(g.Town.Blessings) != 2 {
		t.Fatalf("un Temple niveau 2 tient %d bénédictions, attendu 2", len(g.Town.Blessings))
	}
}

// LE DÉPOUILLEMENT EST DÉTERMINISTE, ex æquo compris : l'ordre du panthéon départage.
// Sans ça, deux instances rejouant la même période appelleraient deux dieux différents —
// et toute l'architecture repose sur « rejouer le temps donne le même monde » (sim.go).
func TestTallyIsDeterministicOnTies(t *testing.T) {
	first := ""
	for try := 0; try < 20; try++ {
		g, _, _ := mythicGame(t, ThemeTempere, 1)
		g.Players = []*Player{{ID: "p1"}, {ID: "p2"}, {ID: "p3"}}
		g.Town.Favor = BlessingCost
		// Trois voix, trois dieux : parfaitement à égalité.
		for i, god := range []string{"ares", "demeter", "zeus"} {
			if err := g.VoteBlessing([]string{"p1", "p2", "p3"}[i], god); err != nil {
				t.Fatalf("vote: %v", err)
			}
		}
		g.ProcessWave(time.Now())
		if len(g.Town.Blessings) != 1 {
			t.Fatalf("aucun dieu élu")
		}
		got := g.Town.Blessings[0].GodID
		if first == "" {
			first = got
		} else if got != first {
			t.Fatalf("ex æquo départagé au hasard : %q puis %q", first, got)
		}
	}
}

// LA MOISSON SE VOIT DANS LE SAC, et elle se CUMULE avec le passif de classe : ce sont
// deux sources différentes, et vingt faveurs doivent se voir même chez un Récupérateur.
func TestHarvestBlessingAddsToEveryFind(t *testing.T) {
	g, h, _ := mythicGame(t, ThemeTempere, 1)
	td := TerrainDef{Searchable: true, Drops: []DropDef{{"objet", "Bois", 1, 1}}}
	tile := &Tile{Biome: BiomeForest, Resources: 5}
	plain := g.searchLoot(h, tile, td)
	g.Town.Blessings = []ActiveBlessing{{GodID: "demeter", Domain: DomainHarvest, UntilWave: 99}}
	blessed := g.searchLoot(h, tile, td)
	if blessed.Qty != plain.Qty+blessingHarvestQty {
		t.Fatalf("trouvaille bénie %d, attendu %d", blessed.Qty, plain.Qty+blessingHarvestQty)
	}
}

// LA LAME EST PRÊTÉE À L'UNITÉ, JAMAIS GREFFÉE SUR LE HÉROS. Greffée, elle s'empilerait à
// chaque combat et survivrait à l'expiration de la faveur — le piège déjà documenté pour
// l'Armurerie et l'équipement.
func TestBladeBlessingIsLentNotGrafted(t *testing.T) {
	g, h, _ := mythicGame(t, ThemeTempere, 1)
	h.Stats.Force = 5
	h.X, h.Y = 1, 1
	g.Town.Blessings = []ActiveBlessing{{GodID: "ares", Domain: DomainBlade, UntilWave: 99}}
	m := &Monster{ID: "m1", Species: "slime", X: 1, Y: 1, HP: 10, MaxHP: 10, Count: 1}
	g.Monsters["m1"] = m
	g.TileAt(1, 1).MonsterID = "m1"
	c := NewCombat(g, []*Hero{h}, m, "")
	var unit *CombatUnit
	for _, u := range c.Units {
		if u.RefID == h.ID {
			unit = u
		}
	}
	if unit == nil {
		t.Fatal("le héros n'est pas dans l'arène")
	}
	if unit.Stats.Force != 5+blessingBladeForce {
		t.Errorf("force au combat %d, attendu %d", unit.Stats.Force, 5+blessingBladeForce)
	}
	if h.Stats.Force != 5 {
		t.Errorf("la bénédiction a été GREFFÉE sur le héros (force %d)", h.Stats.Force)
	}
}

// L'ORDRE DU JOUR ANNONCE LE SCRUTIN. Une bénédiction qui s'invoque à la vague suivante
// doit se savoir AVANT : personne n'ouvre le Temple deux fois par jour au cas où.
func TestOrdersAnnounceAnOpenBallot(t *testing.T) {
	g, _, _ := mythicGame(t, ThemeTempere, 1)
	g.Town.Favor = BlessingCost
	g.Recompute()
	found := false
	for _, o := range g.Town.Orders {
		if o.Kind == "temple" && strings.Contains(o.Text, "peut appeler un dieu") {
			found = true
		}
	}
	if !found {
		t.Fatalf("l'ordre du jour ne dit pas que le Temple peut appeler un dieu : %+v", g.Town.Orders)
	}
}

// LE TEMPLE EST ATTEIGNABLE : son plan tombe de la fouille ordinaire, pas seulement des
// ruines. Un pilier de jeu que la moitié des parties n'atteindrait jamais n'en est pas un.
func TestTemplePlanDropsFromOrdinaryGround(t *testing.T) {
	plan := buildingPlanItem("temple")
	if plan == "" {
		t.Fatal("le Temple n'a pas de plan")
	}
	found := 0
	for biome, td := range Terrains {
		for _, d := range td.Drops {
			if d.Name == plan {
				found++
				_ = biome
			}
		}
	}
	if found < 2 {
		t.Fatalf("« %s » ne tombe que de %d terrain(s) : trop rare pour un pilier", plan, found)
	}
}
