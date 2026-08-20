package game

// LA PERCEPTION — la septième statistique, et la seule qui décide de ce qu'on VOIT.
//
// Ce que ces tests défendent :
//  1. qu'elle porte la vision sur les DEUX surfaces (carte et arène) — c'est sa
//     justification d'exister, sinon un simple réglage aurait suffi ;
//  2. que la Précision, elle, soit redevenue MONO-USAGE (le critique) — c'est le
//     reproche qui a déclenché ce lot ;
//  3. que les six classes aient enfin des profils DISTINCTS (elles n'en portaient que
//     trois, l'Éclaireur étant le clone chiffré de l'Herboriste).

import "testing"

// LA PERCEPTION PORTE LES DEUX VISIONS. Une statistique qui ne servirait qu'en combat
// n'aurait pas mérité une septième ligne sur la fiche de personnage.
func TestPerceptionDrivesBothSights(t *testing.T) {
	g := &GameState{ID: "g", Width: 21, Height: 21, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 441)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: BiomeGrass}
	}
	g.Town.X, g.Town.Y = 0, 0 // loin du héros : sa vue ne doit rien au bourg
	h := NewStarterHero(0, "Ava", 12, 12)
	h.Stats.Perception = 0
	g.Heroes = []*Hero{h}

	// CARTE
	g.RevealVision()
	if !g.TileExplored(13, 12) {
		t.Fatal("un héros voit toujours ses voisines immédiates")
	}
	if g.TileExplored(14, 12) {
		t.Fatal("sans perception, il ne voit pas à deux cases")
	}
	h.Stats.Perception = 4 // 1 + 4/4 = rayon 2
	g.RevealVision()
	if !g.TileExplored(14, 12) {
		t.Fatal("la perception doit élargir le rayon de brouillard levé")
	}

	// ARÈNE
	u := &CombatUnit{Stats: Stats{Perception: 0}}
	base := u.sight()
	u.Stats.Perception = 9
	if u.sight() <= base {
		t.Fatalf("la perception doit élargir la portée d'œil en combat : %d -> %d", base, u.sight())
	}
}

// LA PRÉCISION EST REDEVENUE MONO-USAGE. C'est le correctif du reproche : « frapper
// juste » et « savoir ce qu'il y a là » sont deux idées, pas une.
func TestPrecisionNoLongerBuysSight(t *testing.T) {
	u := &CombatUnit{Stats: Stats{}}
	base := u.sight()
	u.Stats.Precision = 30
	if u.sight() != base {
		t.Fatalf("la précision ne doit plus rien changer à la vue : %d -> %d", base, u.sight())
	}
	// …mais elle achète toujours le critique.
	if u.critPct() == 0 {
		t.Fatal("la précision doit continuer d'acheter le coup critique")
	}
}

// L'ŒIL-DE-LYNX est l'objet de la vision — sur la CARTE aussi, où l'équipement n'est
// pas dans `Hero.Stats` et doit donc être rajouté explicitement (le piège déjà
// rencontré avec les Bottes cloutées).
func TestLynxEyeWidensMapSight(t *testing.T) {
	g := &GameState{ID: "g", Width: 21, Height: 21, Monsters: map[string]*Monster{}}
	g.Tiles = make([]Tile, 441)
	for i := range g.Tiles {
		g.Tiles[i] = Tile{Biome: BiomeGrass}
	}
	g.Town.X, g.Town.Y = 0, 0
	h := NewStarterHero(0, "Ava", 12, 12)
	h.Stats.Perception = 1
	g.Heroes = []*Hero{h}
	g.RevealVision()
	if g.TileExplored(14, 12) {
		t.Fatal("préalable : sans l'objet, il ne voit pas à deux cases")
	}
	h.AddLoot(Item{Type: "arme", Name: "Œil-de-lynx", Qty: 1})
	if _, err := g.Equip(h.ID, "Œil-de-lynx"); err != nil {
		t.Fatalf("équiper : %v", err)
	}
	g.RevealVision()
	if !g.TileExplored(14, 12) {
		t.Fatal("l'Œil-de-lynx doit élargir la vision de CARTE (l'équipement n'est pas dans Hero.Stats)")
	}
}

// LES SIX PROFILS SONT DISTINCTS. Le catalogue portait six classes pour TROIS blocs :
// Pionnier == Gardien, et Éclaireur == Récupérateur == Herboriste. Choisir sa classe
// n'engageait donc rien de mesurable.
func TestEveryClassHasItsOwnStatProfile(t *testing.T) {
	seen := map[Stats]string{}
	for _, c := range Classes {
		if other, dup := seen[c.Bonuses]; dup {
			t.Fatalf("%s et %s portent le MÊME bloc de statistiques %+v — choisir entre elles n'engage rien",
				other, c.Name, c.Bonuses)
		}
		seen[c.Bonuses] = c.Name
	}
}

// …et différencier ne doit pas HIÉRARCHISER : toutes valent le même nombre de points.
func TestClassBonusesAreWorthTheSame(t *testing.T) {
	total := func(s Stats) int {
		return s.Force + s.Dexterite + s.Agilite + s.Endurance + s.Athletisme + s.Precision + s.Perception
	}
	want := total(Classes[0].Bonuses)
	for _, c := range Classes {
		if got := total(c.Bonuses); got != want {
			t.Fatalf("%s vaut %d points quand %s en vaut %d — une classe ne doit pas être un meilleur choix dans l'absolu",
				c.Name, got, Classes[0].Name, want)
		}
	}
}

// L'ÉCLAIREUR EST L'ŒIL, et ça se voit dans les chiffres — c'était tout l'enjeu de la
// septième statistique.
func TestScoutOwnsPerception(t *testing.T) {
	var best string
	bestVal := -1
	for _, c := range Classes {
		if c.Bonuses.Perception > bestVal {
			bestVal, best = c.Bonuses.Perception, c.ID
		}
	}
	if best != "eclaireur" || bestVal == 0 {
		t.Fatalf("la classe la plus perceptive devrait être l'Éclaireur, c'est %q (%d)", best, bestVal)
	}
}
