package game

// LE BROUILLARD À TROIS ÉTATS, LA MÉMOIRE PAR JOUEUR, ET LES TOURS.
//
// Ce que ces tests défendent, et qu'aucun test ne défendait avant : qu'une case
// quittée REDEVIENNE sombre (c'était le cœur de la demande — « assombri, non
// illuminé »), que ce qu'un joueur a exploré n'appartienne qu'à lui, et qu'une tour
// fasse exactement ce pour quoi on la bâtit : garder la lumière allumée.

import "testing"

// fogGame : une carte assez grande pour que le bourg n'éclaire pas tout, deux joueurs
// d'un héros chacun.
func fogGame(t *testing.T) (*GameState, *Hero, *Hero) {
	t.Helper()
	SeedRNG(4)
	g := &GameState{ID: "g", Width: 30, Height: 30, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 900)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: BiomeGrass, Height: 3, Resources: 3}
	}
	g.Town.X, g.Town.Y = 1, 1
	a := NewStarterHero(0, "Ana", 20, 20)
	b := NewStarterHero(1, "Bo", 5, 25)
	g.Heroes = []*Hero{a, b}
	g.Players = []*Player{
		{ID: "pa", Name: "Ana", HeroIDs: []string{a.ID}},
		{ID: "pb", Name: "Bo", HeroIDs: []string{b.ID}},
	}
	g.RevealVision()
	return g, a, b
}

// LE CŒUR DE LA DEMANDE : une case qu'on quitte n'est plus ÉCLAIRÉE, mais elle reste
// CONNUE. Trois états, pas deux.
func TestLeavingATileDarkensItWithoutForgettingIt(t *testing.T) {
	g, a, _ := fogGame(t)
	x, y := a.X, a.Y

	if got := g.ClientViewFor("pa").TileAt(x, y); !got.Discovered || !got.Visible {
		t.Fatalf("la case sous le héros doit être éclairée : %+v", got)
	}
	// il s'en va très loin
	a.X, a.Y = 26, 4
	g.RevealVision()
	got := g.ClientViewFor("pa").TileAt(x, y)
	if !got.Discovered {
		t.Fatal("une case explorée ne doit JAMAIS être oubliée")
	}
	if got.Visible {
		t.Fatal("une case quittée doit s'assombrir — c'est toute la différence entre le souvenir et la vue")
	}
	if got.Biome == 0 {
		t.Fatal("le TERRAIN d'un souvenir doit rester servi : c'est ce qu'on dessine en sombre")
	}
}

// Ce qui BOUGE n'est servi que sur une case éclairée : un monstre mémorisé serait un
// mensonge sur sa position.
func TestMonstersOnlyTravelOnLitTiles(t *testing.T) {
	g, a, _ := fogGame(t)
	m := &Monster{ID: "m", Species: "Slime", X: a.X, Y: a.Y, HP: 5, MaxHP: 5, Count: 2}
	g.Monsters["m"] = m
	g.TileAt(m.X, m.Y).MonsterID = "m"
	g.RevealVision()
	if _, ok := g.ClientViewFor("pa").Monsters["m"]; !ok {
		t.Fatal("un monstre sur une case éclairée doit être servi")
	}
	a.X, a.Y = 4, 26 // le héros s'éloigne : la case retombe dans le souvenir
	g.RevealVision()
	cv := g.ClientViewFor("pa")
	if _, ok := cv.Monsters["m"]; ok {
		t.Fatal("un monstre hors de vue ne doit plus être servi")
	}
	if cv.TileAt(m.X, m.Y).MonsterID != "" {
		t.Fatal("le monsterId doit tomber aussi : mentir sur une position est pire que se taire")
	}
}

// LA MÉMOIRE EST PERSONNELLE : ce qu'Ana a exploré, Bo ne le sait pas.
func TestExplorationIsPerPlayer(t *testing.T) {
	g, a, _ := fogGame(t)
	if !g.PlayerExplored("pa", a.X, a.Y) {
		t.Fatal("Ana doit connaître la case où elle se trouve")
	}
	if g.PlayerExplored("pb", a.X, a.Y) {
		t.Fatal("Bo ne doit RIEN savoir d'une case qu'il n'a jamais vue")
	}
	if got := g.ClientViewFor("pb").TileAt(a.X, a.Y); got.Discovered || got.Biome != 0 {
		t.Fatalf("la vue de Bo doit être vierge là-bas : %+v", got)
	}
}

// …SAUF autour du BOURG, qui est le savoir commun de l'expédition. Sans ce partage,
// une survie collective n'aurait plus rien de collectif.
func TestTownKnowledgeIsShared(t *testing.T) {
	g, _, _ := fogGame(t)
	for _, p := range []string{"pa", "pb"} {
		if !g.PlayerExplored(p, g.Town.X, g.Town.Y) {
			t.Fatalf("%s doit connaître le bourg", p)
		}
		if got := g.ClientViewFor(p).TileAt(g.Town.X, g.Town.Y); !got.Visible {
			t.Fatalf("%s doit VOIR le bourg : %+v", p, got)
		}
	}
}

// LA TOUR DE GUET : elle garde la lumière allumée, pour tout le monde, sans personne
// sur place. C'est exactement ce pour quoi on la bâtit.
func TestWatchtowerKeepsTheLightOn(t *testing.T) {
	g, _, _ := fogGame(t)
	tx, ty := 15, 6
	id := "wt"
	g.Watchtowers = map[string]*Watchtower{id: {ID: id, X: tx, Y: ty, BuildPA: WatchtowerPA, Sight: WatchtowerSight}}
	g.Tiles[ty*g.Width+tx].TowerID = id

	g.RevealVision()
	if got := g.ClientViewFor("pa").TileAt(tx, ty); got.Discovered {
		t.Fatal("un CHANTIER n'éclaire rien : c'est la tour BÂTIE qui voit")
	}
	g.Watchtowers[id].Built = true
	g.RevealVision()
	for _, p := range []string{"pa", "pb"} {
		got := g.ClientViewFor(p).TileAt(tx, ty)
		if !got.Visible {
			t.Fatalf("%s : la tour doit garder sa case éclairée sans personne dessus (%+v)", p, got)
		}
		// et son PANORAMA, jusqu'au bord de son rayon
		if edge := g.ClientViewFor(p).TileAt(tx+WatchtowerSight, ty); !edge.Visible {
			t.Fatalf("%s : le panorama doit porter jusqu'à %d cases", p, WatchtowerSight)
		}
		if beyond := g.ClientViewFor(p).TileAt(tx+WatchtowerSight+1, ty); beyond.Visible {
			t.Fatalf("%s : le panorama ne doit pas dépasser son rayon", p)
		}
	}
}

// LA TOUR DE LA VILLE fait la même chose, une fois construite — la demande le dit
// explicitement. Sans elle, la ville ne voit qu'à trois cases.
func TestTownTowerWidensAndKeepsVision(t *testing.T) {
	g, _, _ := fogGame(t)
	g.Town.Buildings = DefaultBuildings()
	// une case HORS de la veille de base (3) mais DANS celle de la Tour niveau 1 (4)
	far := townSightRadius + 1
	if got := g.ClientViewFor("pa").TileAt(g.Town.X+far, g.Town.Y); got.Visible {
		t.Fatal("sans Tour, la ville ne voit pas si loin")
	}
	b := g.buildingByID("tower")
	if b == nil {
		t.Fatal("le catalogue doit porter la Tour")
	}
	b.Built, b.Level, b.Durability = true, 1, 100
	g.RevealVision()
	if got := g.ClientViewFor("pa").TileAt(g.Town.X+far, g.Town.Y); !got.Visible {
		t.Fatalf("la Tour bâtie doit élargir la veille du bourg (%+v)", got)
	}
}

// Une sauvegarde d'AVANT le brouillard par joueur ne doit pas repartir de zéro : des
// jours réels d'exploration disparaîtraient de l'écran.
func TestOldSavesKeepTheirExploration(t *testing.T) {
	g, _, _ := fogGame(t)
	g.Explored = nil // une partie enregistrée avant la fonctionnalité
	for i := range g.Tiles {
		g.Tiles[i].Discovered = true
	}
	g.RevealVision()
	if !g.PlayerExplored("pa", 28, 28) {
		t.Fatal("la mémoire de l'expédition doit être reprise à la migration")
	}
	// …mais un joueur qui rejoint APRÈS part bien d'une carte noire.
	g.Players = append(g.Players, &Player{ID: "pc", Name: "Cy"})
	g.RevealVision()
	if g.PlayerExplored("pc", 28, 28) {
		t.Fatal("un joueur qui rejoint en cours de partie n'hérite pas de l'exploration des autres")
	}
}
