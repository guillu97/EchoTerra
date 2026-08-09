package game

import (
	"testing"
	"time"
)

// twoPlayerTown stages a started town with two players, both teams in town.
func twoPlayerTown(t *testing.T) (*GameState, *Player, *Player) {
	t.Helper()
	g := grassLobby(1, 8)
	now := time.Now()
	a, err := g.AddPlayer("Ana", now)
	if err != nil {
		t.Fatal(err)
	}
	b, err := g.AddPlayer("Bo", now)
	if err != nil {
		t.Fatal(err)
	}
	if err := g.StartGame(a.ID, now); err != nil {
		t.Fatal(err)
	}
	for id, m := range g.Monsters { // un plateau propre
		if tl := g.TileAt(m.X, m.Y); tl != nil {
			tl.MonsterID = ""
		}
		delete(g.Monsters, id)
	}
	g.Recompute()
	return g, a, b
}

// Le geste complet : Ana demande, Bo sert depuis la Banque, la marchandise arrive dans
// le sac d'Ana — même si Ana n'est pas là. C'est ce qui le rend jouable sur un jeu où
// l'on passe cinq minutes deux fois par jour.
func TestARequestIsFilledFromTheBankIntoTheAskersBag(t *testing.T) {
	g, ana, bo := twoPlayerTown(t)
	g.addStorage(Item{Type: "objet", Name: "Corde", Qty: 5})

	req, err := g.PostRequest(ana.ID, "Corde", 3)
	if err != nil {
		t.Fatal(err)
	}
	if !req.Open() {
		t.Fatal("une demande fraîche est ouverte")
	}

	// Ana s'en va : le service doit marcher en son absence.
	asker := g.HeroByID(ana.HeroIDs[0])
	asker.X, asker.Y = g.Town.X+3, g.Town.Y

	filler := g.HeroByID(bo.HeroIDs[0])
	paBefore := filler.PA
	if _, err := g.FillRequest(req.ID, filler.ID); err != nil {
		t.Fatalf("Bo doit pouvoir servir : %v", err)
	}
	if got := heroItemQty(asker, "Corde"); got != 3 {
		t.Fatalf("la marchandise doit atterrir dans le sac du demandeur, got %d", got)
	}
	if got := g.storageQty("Corde"); got != 2 {
		t.Fatalf("la Banque doit être débitée : reste %d, want 2", got)
	}
	if filler.PA != paBefore-requestFillPA {
		t.Fatalf("servir est un travail : PA %d -> %d", paBefore, filler.PA)
	}
	if req.Open() || req.FilledBy != filler.Name {
		t.Fatalf("la demande doit porter le nom de qui l'a servie : %+v", req)
	}
	// Et le service est crédité au registre — c'est le point de tout ceci.
	var filled int
	for _, c := range g.Ledger() {
		if c.PlayerID == bo.ID {
			filled = c.Filled
		}
	}
	if filled != 1 {
		t.Fatalf("le service rendu doit figurer au registre, got %d", filled)
	}
}

// Se servir soi-même n'est pas rendre service — ce serait un retrait libre de la
// Banque déguisé, et le tout est justement de devoir être DEUX.
func TestAPlayerCannotFillTheirOwnRequest(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	g.addStorage(Item{Type: "objet", Name: "Corde", Qty: 5})
	req, err := g.PostRequest(ana.ID, "Corde", 2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := g.FillRequest(req.ID, ana.HeroIDs[0]); err == nil {
		t.Fatal("se servir soi-même doit être refusé")
	}
	if g.storageQty("Corde") != 5 {
		t.Fatal("un refus ne doit rien débiter")
	}
}

// Une demande à la fois : le Panneau est un tableau partagé, pas une liste de courses.
func TestOneOpenRequestPerPlayer(t *testing.T) {
	g, ana, _ := twoPlayerTown(t)
	if _, err := g.PostRequest(ana.ID, "Corde", 2); err != nil {
		t.Fatal(err)
	}
	if _, err := g.PostRequest(ana.ID, "Pierre", 4); err == nil {
		t.Fatal("une seconde demande ouverte doit être refusée")
	}
	// Retirée, on peut en poster une autre.
	if err := g.CancelRequest(ana.ID, g.Town.Requests[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := g.PostRequest(ana.ID, "Pierre", 4); err != nil {
		t.Fatalf("après retrait, une nouvelle demande doit passer : %v", err)
	}
}

// On ne sert pas ce que la Banque n'a pas, et un refus ne coûte rien.
func TestFillingNeedsTheGoodsAndCostsNothingWhenRefused(t *testing.T) {
	g, ana, bo := twoPlayerTown(t)
	g.addStorage(Item{Type: "objet", Name: "Corde", Qty: 1})
	req, _ := g.PostRequest(ana.ID, "Corde", 3)

	filler := g.HeroByID(bo.HeroIDs[0])
	pa := filler.PA
	if _, err := g.FillRequest(req.ID, filler.ID); err == nil {
		t.Fatal("servir sans la marchandise doit être refusé")
	}
	if filler.PA != pa || g.storageQty("Corde") != 1 {
		t.Fatal("un refus ne consomme ni PA ni marchandise")
	}

	// Il faut aussi être EN VILLE : la Banque ne se téléporte pas.
	g.addStorage(Item{Type: "objet", Name: "Corde", Qty: 5})
	filler.X, filler.Y = g.Town.X+2, g.Town.Y
	if _, err := g.FillRequest(req.ID, filler.ID); err == nil {
		t.Fatal("servir depuis le terrain doit être refusé")
	}
}

// Une demande honorée reste affichée quelques vagues — c'est la trace du service
// rendu, elle a de la valeur sociale — puis s'efface.
func TestFilledRequestsLingerThenFade(t *testing.T) {
	g, ana, bo := twoPlayerTown(t)
	g.addStorage(Item{Type: "objet", Name: "Corde", Qty: 5})
	req, _ := g.PostRequest(ana.ID, "Corde", 2)
	if _, err := g.FillRequest(req.ID, bo.HeroIDs[0]); err != nil {
		t.Fatal(err)
	}

	g.WaveNumber = req.Wave + requestKeepFor
	g.Recompute()
	if len(g.Town.Requests) != 1 {
		t.Fatal("la trace du service doit rester visible quelques vagues")
	}
	g.WaveNumber = req.Wave + requestKeepFor + 1
	g.Recompute()
	if len(g.Town.Requests) != 0 {
		t.Fatalf("puis s'effacer, got %+v", g.Town.Requests)
	}
}
