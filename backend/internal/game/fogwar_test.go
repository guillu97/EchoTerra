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

// UNE EXPÉDITION, UNE CARTE (2026-08-19). La mémoire a été PERSONNELLE pendant trois
// jours ; la mesure et l'usage ont tranché contre. Ce qu'un coéquipier explore — humain
// ou joueur-IA — est acquis à toute la ville, qui partage déjà sa Banque, son Panneau et
// son journal.
func TestTheMapBelongsToTheExpedition(t *testing.T) {
	g, a, b := fogGame(t)
	for _, p := range []string{"pa", "pb"} {
		if !g.TileExplored(a.X, a.Y) || !g.TileExplored(b.X, b.Y) {
			t.Fatalf("%s : la carte de l'expédition porte ce que CHAQUE héros a vu", p)
		}
		if got := g.ClientViewFor(p).TileAt(b.X, b.Y); !got.Discovered || got.Biome == 0 {
			t.Fatalf("%s doit recevoir le TERRAIN vu par son coéquipier : %+v", p, got)
		}
	}
	// …et la VISION courante est l'union des deux : Ana voit ce que Bo éclaire, donc
	// les monstres qui l'entourent (c'est ce qui distingue le partage d'une simple
	// mise en commun des souvenirs).
	if got := g.ClientViewFor("pa").TileAt(b.X, b.Y); !got.Visible {
		t.Fatalf("la case sous un coéquipier VIVANT doit être éclairée : %+v", got)
	}
	// une case que TOUT LE MONDE a quittée redevient un souvenir : les trois états
	// survivent au partage.
	x, y := b.X, b.Y
	b.X, b.Y = a.X, a.Y
	g.RevealVision()
	if got := g.ClientViewFor("pa").TileAt(x, y); !got.Discovered || got.Visible {
		t.Fatalf("case quittée par tous : connue mais assombrie (%+v)", got)
	}
}

// …SAUF autour du BOURG, qui est le savoir commun de l'expédition. Sans ce partage,
// une survie collective n'aurait plus rien de collectif.
func TestTownKnowledgeIsShared(t *testing.T) {
	g, _, _ := fogGame(t)
	if !g.TileExplored(g.Town.X, g.Town.Y) {
		t.Fatal("le bourg est connu de tous")
	}
	for _, p := range []string{"pa", "pb"} {
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

// LES DEUX MIGRATIONS. Une partie enregistrée AVANT le bitset porte sa mémoire dans
// `Tile.Discovered` ; une partie enregistrée pendant les trois jours de mémoire PAR
// JOUEUR porte un bitset par joueur. Ni l'une ni l'autre ne doit repartir de zéro —
// des jours réels d'exploration disparaîtraient de l'écran.
func TestOldSavesKeepTheirExploration(t *testing.T) {
	g, _, _ := fogGame(t)
	g.Explored = nil // une partie enregistrée avant le bitset
	for i := range g.Tiles {
		g.Tiles[i].Discovered = true
	}
	g.RevealVision()
	if !g.TileExplored(28, 28) {
		t.Fatal("la mémoire de l'expédition doit être reprise à la migration")
	}
	// …et un joueur qui rejoint APRÈS reçoit la carte de la ville : c'est justement ce
	// que le partage change (il partait d'un écran noir).
	g.Players = append(g.Players, &Player{ID: "pc", Name: "Cy"})
	g.RevealVision()
	if got := g.ClientViewFor("pc").TileAt(28, 28); !got.Discovered {
		t.Fatalf("un joueur qui rejoint hérite de la carte de l'expédition : %+v", got)
	}
}

// Le REPLI des mémoires par joueur : l'UNION, jamais l'intersection — personne ne doit
// rendre une case qu'il connaissait — et les clés par joueur disparaissent, ce qui rend
// au blob JSON sa taille d'origine (un bitset au lieu de vingt).
func TestPerPlayerMemoriesAreFoldedIntoOne(t *testing.T) {
	g, _, _ := fogGame(t)
	g.Explored = map[string][]byte{"pa": make([]byte, (len(g.Tiles)+7)/8), "pb": make([]byte, (len(g.Tiles)+7)/8)}
	mark := func(key string, x, y int) {
		i := y*g.Width + x
		g.Explored[key][i/8] |= 1 << (i % 8)
	}
	mark("pa", 28, 28) // une case connue d'Ana seule
	mark("pb", 2, 27)  // une case connue de Bo seul
	g.RevealVision()

	if !g.TileExplored(28, 28) || !g.TileExplored(2, 27) {
		t.Fatal("le repli doit UNIR les mémoires : personne ne rend une case connue")
	}
	if len(g.Explored) != 1 {
		t.Fatalf("les clés par joueur doivent disparaître, il en reste %d", len(g.Explored))
	}
	before := len(g.Explored[""])
	g.RevealVision() // idempotent : elle tourne à CHAQUE Recompute
	if len(g.Explored) != 1 || len(g.Explored[""]) != before || !g.TileExplored(28, 28) {
		t.Fatal("la migration doit être idempotente et muette")
	}
}

// LES COÉQUIPIERS NE FLOTTENT PLUS DANS LA BRUME. Les héros étaient les seules entités
// jamais caviardées : on voyait des silhouettes se promener au-dessus de cases dont
// personne n'avait vu le terrain. Le partage rend la chose vraie par construction pour
// un VIVANT (il éclaire sa propre case) ; le garde-fou couvre les morts.
func TestNoHeroIsServedOnABlankTile(t *testing.T) {
	g, a, b := fogGame(t)
	served := func(viewer string, h *Hero) bool {
		for _, x := range g.ClientViewFor(viewer).Heroes {
			if x.ID == h.ID {
				return true
			}
		}
		return false
	}
	if !served("pa", b) {
		t.Fatal("un coéquipier VIVANT est sur une case éclairée : il doit être servi")
	}
	for _, v := range []string{"pa", "pb"} {
		cv := g.ClientViewFor(v)
		for _, h := range cv.Heroes {
			if !cv.TileAt(h.X, h.Y).Discovered {
				t.Fatalf("%s : %s est servi sur une case vierge", v, h.Name)
			}
		}
	}
	// un MORT tombé hors de vue ne voyage plus chez les autres…
	b.X, b.Y = 12, 12
	g.RevealVision()
	b.HP = 0
	b.X, b.Y = 27, 3 // hors de tout champ
	if served("pa", b) {
		t.Fatal("un héros mort hors de vue n'a rien à faire dans la vue d'un autre joueur")
	}
	// …mais MES morts me restent servis (fiche, résurrection).
	a.HP = 0
	a.X, a.Y = 27, 3
	if !served("pa", a) {
		t.Fatal("MES héros passent toujours, morts compris")
	}
}
