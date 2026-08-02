package game

import (
	"testing"
	"time"
)

// newForageGame : un héros sur une prairie fouillable, hors de la ville.
func newForageGame(resources int) (*GameState, *Hero) {
	g := &GameState{Width: 5, Height: 5, Monsters: map[string]*Monster{}, Status: StatusActive}
	g.Tiles = make([]Tile, 25)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: BiomeGrass, Resources: resources, Discovered: true}
	}
	g.Town.X, g.Town.Y = 0, 0
	g.Town.HP, g.Town.MaxHP = 100, 100
	g.Town.Buildings = DefaultBuildings()
	g.Day = 1
	h := &Hero{
		ID: "h1", Name: "Cael", X: 2, Y: 2, HP: 10, MaxHP: 10, PA: 6, MaxPA: 6,
		States: []string{}, Bars: map[string]int{}, Inventory: []Item{},
	}
	g.Heroes = []*Hero{h}
	// Vague repoussée très loin : ces tests portent sur l'horloge de RÉCOLTE, et
	// une vague qui tombe au milieu blesserait le héros / le tétaniserait (donc
	// l'interromprait) — un aléa qui n'a rien à voir avec ce qu'on mesure. Le
	// rattrapage respectant l'ordre chronologique, une vague due avec un budget de
	// vagues nul stopperait aussi les fouilles postérieures.
	g.NextWaveAt = time.Now().Add(1000 * WaveInterval)
	g.LastBotAt = time.Now()
	return g, h
}

// La première fouille coûte 1 PA ET installe le héros : c'est ce PA qui est
// facturé, pas la trouvaille.
func TestSearchStartsForaging(t *testing.T) {
	g, h := newForageGame(5)
	if h.Foraging() {
		t.Fatal("un héros ne récolte pas avant d'avoir fouillé")
	}
	if _, err := g.SearchTile("h1"); err != nil {
		t.Fatalf("SearchTile: %v", err)
	}
	if h.PA != 5 {
		t.Fatalf("la fouille manuelle coûte 1 PA, PA = %d", h.PA)
	}
	if !h.Foraging() {
		t.Fatal("la fouille doit installer la récolte automatique")
	}
	if d := time.Until(h.ForageAt); d > ForageInterval()+time.Second || d < ForageInterval()-time.Second {
		t.Fatalf("prochaine récolte dans %v, attendu ~%v", d, ForageInterval())
	}
}

// La récolte automatique ne coûte AUCUN PA — c'est tout l'intérêt du PA payé
// d'avance — et elle est rejouée par la simulation, donc sans joueur connecté.
func TestForagingCostsNoPAAndRunsInSimulation(t *testing.T) {
	g, h := newForageGame(50) // large : on veut compter les fouilles, pas l'épuisement
	if _, err := g.SearchTile("h1"); err != nil {
		t.Fatalf("SearchTile: %v", err)
	}
	paAfterSearch := h.PA
	itemsAfterSearch := totalQty(h.Inventory)

	// 3 intervalles plus tard, la simulation doit avoir joué 3 fouilles.
	res := g.AdvanceTo(time.Now().Add(3*ForageInterval()), SimBudget{Waves: 0, BotRounds: 0, Forages: 10})
	if res.Forages != 3 {
		t.Fatalf("fouilles automatiques jouées = %d, attendu 3", res.Forages)
	}
	if !res.Changed {
		t.Fatal("la récolte doit marquer l'état comme changé (il faut persister)")
	}
	if h.PA != paAfterSearch {
		t.Fatalf("la récolte automatique ne doit RIEN coûter : PA %d -> %d", paAfterSearch, h.PA)
	}
	if got := totalQty(h.Inventory) - itemsAfterSearch; got < 3 {
		t.Fatalf("3 fouilles doivent rapporter au moins 3 objets, +%d", got)
	}
	if !h.Foraging() {
		t.Fatal("la récolte continue tant que le héros ne bouge pas")
	}
}

func totalQty(inv []Item) int {
	n := 0
	for _, it := range inv {
		n += it.Qty
	}
	return n
}

// Tout ce qui rompt l'installation l'interrompt.
func TestForagingStopsOnMoveHideEscape(t *testing.T) {
	for _, c := range []struct {
		name string
		act  func(g *GameState) error
	}{
		{"déplacement", func(g *GameState) error { return g.MoveHero("h1", 1, 0) }},
		{"se cacher", func(g *GameState) error { return g.HideHero("h1") }},
		{"s'échapper", func(g *GameState) error { return g.EscapeHero("h1") }},
	} {
		t.Run(c.name, func(t *testing.T) {
			g, h := newForageGame(5)
			if _, err := g.SearchTile("h1"); err != nil {
				t.Fatalf("SearchTile: %v", err)
			}
			if err := c.act(g); err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}
			if h.Foraging() {
				t.Fatalf("%s doit interrompre la récolte", c.name)
			}
		})
	}
}

// Un héros tétanisé ne creuse pas sous les griffes de la horde : la récolte
// s'éteint d'elle-même à la première échéance (aucune action ne repasse par lui).
func TestForagingStopsWhenPinnedOrDown(t *testing.T) {
	g, h := newForageGame(5)
	if _, err := g.SearchTile("h1"); err != nil {
		t.Fatalf("SearchTile: %v", err)
	}
	h.AddState(StateTetanise)
	g.AdvanceTo(time.Now().Add(2*ForageInterval()), SimBudget{Forages: 10})
	if h.Foraging() {
		t.Fatal("un héros tétanisé doit être désinstallé")
	}

	g2, h2 := newForageGame(5)
	if _, err := g2.SearchTile("h1"); err != nil {
		t.Fatalf("SearchTile: %v", err)
	}
	h2.HP = 0
	g2.AdvanceTo(time.Now().Add(2*ForageInterval()), SimBudget{Forages: 10})
	if h2.Foraging() {
		t.Fatal("un héros à terre doit être désinstallé")
	}
}

// Le budget borne le travail d'un appel, et le reste est repris ensuite : les
// horloges ne doivent PAS avoir sauté au-delà de ce qui a été joué.
func TestForagingRespectsBudgetAndResumes(t *testing.T) {
	g, h := newForageGame(50)
	if _, err := g.SearchTile("h1"); err != nil {
		t.Fatalf("SearchTile: %v", err)
	}
	target := time.Now().Add(10 * ForageInterval())
	res := g.AdvanceTo(target, SimBudget{Forages: 4})
	if res.Forages != 4 || res.Done {
		t.Fatalf("budget non respecté : %d fouilles, Done=%v", res.Forages, res.Done)
	}
	res2 := g.AdvanceTo(target, SimBudget{Forages: 100})
	if res2.Forages != 6 {
		t.Fatalf("la reprise doit jouer les 6 fouilles restantes, %d jouées", res2.Forages)
	}
	if !res2.Done {
		t.Fatal("le rattrapage devrait être terminé")
	}
	_ = h
}

// Une partie oubliée longtemps ne doit pas déverser des milliers d'objets : le
// plafond de retard s'applique aussi à la récolte.
func TestForagingIsCappedByBacklog(t *testing.T) {
	g, h := newForageGame(500)
	if _, err := g.SearchTile("h1"); err != nil {
		t.Fatalf("SearchTile: %v", err)
	}
	// Le héros récoltait il y a trois jours ; le rattrapage ne doit couvrir que la
	// fenêtre (CatchUpMaxBacklog), pas les trois jours.
	h.ForageAt = time.Now().Add(-72 * time.Hour)
	now := time.Now()
	max := int(CatchUpMaxBacklog/ForageInterval()) + 2
	total := 0
	for i := 0; i < 40; i++ { // plusieurs appels : le budget d'un seul ne suffit pas
		r := g.AdvanceTo(now, SimBudget{Waves: 100, BotRounds: 100, Forages: 500})
		total += r.Forages
		if r.Done {
			break
		}
	}
	if total > max {
		t.Fatalf("%d fouilles rejouées, le plafond de retard en autorise %d au plus", total, max)
	}
}

// La fouille reste possible sur une case ÉPUISÉE : elle ne rend le plus souvent
// que des Débris, mais elle n'est jamais refusée — c'est la boucle de la
// Recyclerie (le client désactivait le bouton, rendant ce mode inatteignable).
func TestSearchAllowedOnDepletedTile(t *testing.T) {
	g, h := newForageGame(0) // case déjà épuisée
	it, err := g.SearchTile("h1")
	if err != nil {
		t.Fatalf("fouiller une case épuisée doit rester possible : %v", err)
	}
	if it == nil {
		t.Fatal("une fouille sur case épuisée doit rendre quelque chose (Débris au pire)")
	}
	if h.PA != 5 {
		t.Fatalf("elle coûte toujours 1 PA, PA = %d", h.PA)
	}
	if !h.Foraging() {
		t.Fatal("elle installe la récolte comme une fouille normale")
	}
}

// L'intervalle suit la cadence des VAGUES : six fouilles par période, comme les
// six PA d'un héros. Une constante en minutes aurait donné 72 trouvailles entre
// deux vagues en déploiement réel (vagues de 6 h).
func TestForageIntervalFollowsWaveInterval(t *testing.T) {
	saved := WaveInterval
	defer func() { WaveInterval = saved }()
	WaveInterval = 6 * time.Hour
	if got := ForageInterval(); got != time.Hour {
		t.Fatalf("ForageInterval = %v, attendu 1h pour des vagues de 6h", got)
	}
	WaveInterval = 10 * time.Minute
	if got := ForageInterval(); got != 100*time.Second {
		t.Fatalf("ForageInterval = %v, attendu 100s pour des vagues de 10 min", got)
	}
}
