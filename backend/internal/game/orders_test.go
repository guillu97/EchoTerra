package game

import (
	"strings"
	"testing"
	"time"
)

func ordersGame() *GameState {
	g := memorialWorld(21, 4)
	g.Status = StatusActive
	g.Heroes = []*Hero{NewStarterHero(0, "A", g.Town.X, g.Town.Y)}
	g.Recompute()
	return g
}

func kinds(orders []TownOrder) map[string]TownOrder {
	m := map[string]TownOrder{}
	for _, o := range orders {
		m[o.Kind] = o
	}
	return m
}

// L'ordre du jour ne doit JAMAIS être vide : une session qui commence par un écran
// muet est une session qu'on remet à plus tard. Même une ville tranquille reçoit une
// ligne — « les abords sont dégagés » est une information.
func TestOrdersAreNeverEmptyOnAnActiveTown(t *testing.T) {
	g := ordersGame()
	if len(g.Town.Orders) == 0 {
		t.Fatal("une ville active doit toujours avoir un ordre du jour")
	}
	if len(g.Town.Orders) > townOrdersCap {
		t.Fatalf("l'ordre du jour ne doit pas dépasser %d lignes, got %d", townOrdersCap, len(g.Town.Orders))
	}
	for _, o := range g.Town.Orders {
		if o.Text == "" || o.Icon == "" || o.Kind == "" {
			t.Fatalf("ligne incomplète : %+v", o)
		}
	}
}

// La menace est chiffrée ET actionnable : les créatures massées aux abords entrent dans
// la puissance de la vague, donc les compter, c'est dire au joueur ce que sortir lui
// rapporterait.
func TestForecastCountsTheSiegeAndDropsWhenItIsCleared(t *testing.T) {
	g := ordersGame()
	calm := g.Forecast()

	m := NewMonster("Slime Vorace", g.Town.X+1, g.Town.Y+1)
	m.Count = 25
	g.Monsters[m.ID] = m
	g.TileAt(m.X, m.Y).MonsterID = m.ID
	g.Recompute()

	sieged := g.Town.Forecast
	if sieged.Besieging != 25 {
		t.Fatalf("assiégeants comptés = %d, want 25", sieged.Besieging)
	}
	if sieged.Min <= calm.Min {
		t.Fatalf("un siège doit alourdir la prévision : %d -> %d", calm.Min, sieged.Min)
	}
	if o, ok := kinds(g.Town.Orders)["threat"]; !ok || !o.Urgent || !strings.Contains(o.Text, "25") {
		t.Fatalf("la menace doit être annoncée, chiffrée et urgente : %+v", o)
	}

	// On dégage : la prévision retombe. C'est TOUT l'intérêt — le joueur voit que sortir
	// change le chiffre.
	delete(g.Monsters, m.ID)
	g.TileAt(m.X, m.Y).MonsterID = ""
	g.Recompute()
	if g.Town.Forecast.Min != calm.Min || g.Town.Forecast.Max != calm.Max {
		t.Fatalf("dégager le siège doit rendre la prévision d'origine : %d-%d vs %d-%d",
			g.Town.Forecast.Min, g.Town.Forecast.Max, calm.Min, calm.Max)
	}
}

// Le portail ouvert est la plus grosse fuite de défense du jeu et la moins chère à
// colmater : il doit être dit, et chiffré.
func TestOpenGateIsCalledOutWithWhatItCosts(t *testing.T) {
	g := ordersGame()
	gate := g.buildingByID("gate")
	gate.Open = true
	g.Recompute()

	o, ok := kinds(g.Town.Orders)["gate"]
	if !ok {
		t.Fatal("un portail ouvert doit figurer à l'ordre du jour")
	}
	if !o.Urgent || !strings.Contains(o.Text, "OUVERT") {
		t.Fatalf("il doit être marqué urgent et sans ambiguïté : %+v", o)
	}
	if buildingLevelDefense(gate) <= 0 {
		t.Fatal("on doit pouvoir chiffrer ce que fermer rapporterait")
	}

	gate.Open = false
	g.Recompute()
	if _, still := kinds(g.Town.Orders)["gate"]; still {
		t.Fatal("portail fermé : la ligne doit disparaître")
	}
}

// Ce qui manque est nommé en toutes lettres — c'est la liste de courses de la session.
func TestOrdersNameTheMissingMaterial(t *testing.T) {
	g := ordersGame()
	g.Town.HP = g.Town.MaxHP // pas de ligne « remparts » pour ne pas saturer le cap
	g.Recompute()

	o, ok := kinds(g.Town.Orders)["material"]
	if !ok {
		t.Fatalf("la muraille niveau 2 réclame de la Pierre : ça doit se voir. Orders: %+v", g.Town.Orders)
	}
	if !strings.Contains(o.Text, TownRepairMaterial) {
		t.Fatalf("le matériau manquant doit être nommé : %q", o.Text)
	}

	// Une fois la Banque pourvue, la ligne s'efface.
	g.addStorage(Item{Type: "minerai", Name: "Pierre", Qty: 99})
	g.Recompute()
	if o, still := kinds(g.Town.Orders)["material"]; still && strings.Contains(o.Text, "Pierre") {
		t.Fatalf("Banque pourvue : la ligne matériau doit disparaître, got %q", o.Text)
	}
}

// Une ville qui va mourir à la prochaine vague doit le DIRE. C'est le seul message qui
// justifie de réveiller quelqu'un.
func TestAFatalWaveIsAnnouncedAsSuch(t *testing.T) {
	g := ordersGame()
	g.Town.HP = 5
	m := NewMonster("Slime Vorace", g.Town.X+1, g.Town.Y)
	m.Count = 200
	g.Monsters[m.ID] = m
	g.TileAt(m.X, m.Y).MonsterID = m.ID
	g.Recompute()

	if !g.Town.Forecast.Fatal {
		t.Fatalf("la prévision doit être fatale : %+v", g.Town.Forecast)
	}
	o := kinds(g.Town.Orders)["threat"]
	if !strings.Contains(o.Text, "emporterait") {
		t.Fatalf("le message doit être sans équivoque : %q", o.Text)
	}
}

// Un salon n'a pas d'ordre du jour : rien n'a commencé.
func TestNoOrdersBeforeTheGameStarts(t *testing.T) {
	g := ordersGame()
	g.Status = StatusLobby
	g.Recompute()
	if len(g.Town.Orders) != 0 {
		t.Fatalf("un salon n'a pas d'ordre du jour, got %+v", g.Town.Orders)
	}
}

// buildTower stands the watchtower up at the given level.
func buildTower(g *GameState, level int) {
	b := g.buildingByID("tower")
	b.Built, b.Level = true, level
	b.Durability, b.MaxDurability = 100, 100
	g.Recompute()
}

// LA PRÉCISION SE MÉRITE. Sans tour de guet on devine ; chaque niveau resserre la
// fourchette. C'est ce qui donne à la Tour un rôle au-delà de ses points de défense.
func TestTowerLevelsNarrowTheForecast(t *testing.T) {
	g := ordersGame()
	// Une vague avancée : à une horde de cinq, ±50 % et ±5 % donnent la même fourchette
	// ENTIÈRE, et le mécanisme n'a rien à montrer. Ce n'est pas un défaut — une vague
	// de début de partie est trivialement prévisible — mais ça ne se teste pas là.
	g.WaveNumber = 14
	g.Recompute()
	blind := g.Forecast()
	if blind.Tower != 0 {
		t.Fatal("staging: pas de tour au départ")
	}
	width := func(f WaveForecast) int { return f.Max - f.Min }

	prev := width(blind)
	for lvl := 1; lvl <= MaxBuildingLevel; lvl++ {
		buildTower(g, lvl)
		f := g.Town.Forecast
		if f.Tower != lvl {
			t.Fatalf("niveau de tour rapporté = %d, want %d", f.Tower, lvl)
		}
		if w := width(f); w >= prev {
			t.Fatalf("la tour niveau %d doit resserrer la fourchette : %d -> %d", lvl, prev, w)
		} else {
			prev = w
		}
	}
	if g.Town.Forecast.Precision <= blind.Precision {
		t.Fatalf("la précision annoncée doit monter avec la tour : %d -> %d",
			blind.Precision, g.Town.Forecast.Precision)
	}
	// La vraie valeur reste TOUJOURS dans la fourchette — une estimation qui ment ne
	// vaut rien.
	f := g.Town.Forecast
	if f.Min > f.Max || f.Min < 0 {
		t.Fatalf("fourchette incohérente : %+v", f)
	}
}

// …et elle se mérite À PLUSIEURS : chaque JOUEUR monté observer resserre la fourchette
// pour TOUT LE MONDE. C'est une manœuvre collective, comme le reste du jeu.
func TestEachScoutingPlayerNarrowsItForEveryone(t *testing.T) {
	g, ana, bo := twoPlayerTown(t)
	g.WaveNumber = 14 // cf. TestTowerLevelsNarrowTheForecast : une horde qui a de la marge
	buildTower(g, 1)
	width := func() int { return g.Town.Forecast.Max - g.Town.Forecast.Min }

	alone := width()
	if _, err := g.ScoutWave(ana.HeroIDs[0]); err != nil {
		t.Fatalf("Ana doit pouvoir observer : %v", err)
	}
	oneScout := width()
	if oneScout >= alone {
		t.Fatalf("un observateur doit resserrer : %d -> %d", alone, oneScout)
	}

	// La même ÉQUIPE ne compte qu'une fois : ce qu'on récompense, c'est que plusieurs
	// PERSONNES s'y collent, pas qu'une seule ait trois héros.
	if _, err := g.ScoutWave(ana.HeroIDs[1]); err == nil {
		t.Fatal("un second héros de la même équipe ne doit pas compter")
	}
	if width() != oneScout {
		t.Fatal("un doublon ne doit rien changer")
	}

	if _, err := g.ScoutWave(bo.HeroIDs[0]); err != nil {
		t.Fatalf("Bo doit pouvoir observer à son tour : %v", err)
	}
	if width() >= oneScout {
		t.Fatalf("un second JOUEUR doit resserrer encore : %d -> %d", oneScout, width())
	}
	if g.Town.Forecast.Scouts != 2 {
		t.Fatalf("observateurs comptés = %d, want 2", g.Town.Forecast.Scouts)
	}
}

// Sans tour, on ne monte nulle part ; et il faut être en ville.
func TestScoutingNeedsAStandingTowerAndPresence(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	if _, err := g.ScoutWave(ana.HeroIDs[0]); err == nil {
		t.Fatal("observer sans Tour doit être refusé")
	}
	buildTower(g, 1)
	h := g.HeroByID(ana.HeroIDs[0])
	h.X, h.Y = g.Town.X+3, g.Town.Y
	if _, err := g.ScoutWave(h.ID); err == nil {
		t.Fatal("observer depuis le terrain doit être refusé")
	}
	h.X, h.Y = g.Town.X, g.Town.Y
	pa := h.PA
	if _, err := g.ScoutWave(h.ID); err != nil {
		t.Fatal(err)
	}
	if h.PA != pa-scoutPA {
		t.Fatalf("observer coûte %d PA : %d -> %d", scoutPA, pa, h.PA)
	}
}

// Les observateurs valaient pour LA vague qui vient de frapper : la suivante est une
// autre horde, il faut remonter voir.
func TestScoutsResetOnEveryWave(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	buildTower(g, 2)
	if _, err := g.ScoutWave(ana.HeroIDs[0]); err != nil {
		t.Fatal(err)
	}
	if len(g.Town.Scouts) != 1 {
		t.Fatal("staging")
	}
	g.ForceWave(time.Now())
	if len(g.Town.Scouts) != 0 {
		t.Fatalf("les observateurs doivent être remis à zéro, got %v", g.Town.Scouts)
	}
	if _, err := g.ScoutWave(ana.HeroIDs[0]); err != nil {
		t.Fatalf("on doit pouvoir réobserver la vague suivante : %v", err)
	}
}
