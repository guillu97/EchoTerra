package game

import (
	"strings"
	"testing"
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
	if sieged.Horde <= calm.Horde {
		t.Fatalf("un siège doit alourdir la prévision : %d -> %d", calm.Horde, sieged.Horde)
	}
	if o, ok := kinds(g.Town.Orders)["threat"]; !ok || !o.Urgent || !strings.Contains(o.Text, "25") {
		t.Fatalf("la menace doit être annoncée, chiffrée et urgente : %+v", o)
	}

	// On dégage : la prévision retombe. C'est TOUT l'intérêt — le joueur voit que sortir
	// change le chiffre.
	delete(g.Monsters, m.ID)
	g.TileAt(m.X, m.Y).MonsterID = ""
	g.Recompute()
	if g.Town.Forecast.Horde != calm.Horde {
		t.Fatalf("dégager le siège doit rendre la prévision d'origine : %d vs %d",
			g.Town.Forecast.Horde, calm.Horde)
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
