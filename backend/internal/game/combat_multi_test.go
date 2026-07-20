package game

import "testing"

// Combat MULTIJOUEUR : les héros des joueurs absents sont joués par l'IA ;
// « Rejoindre le combat » rend au joueur le contrôle de SES unités.

// multiGame : partie à 2 joueurs (pA : 2 héros, pB : 1 héros), tous sur la case
// du monstre. Le monstre est costaud pour que le combat ne finisse pas tout seul.
func multiGame(t *testing.T) (*GameState, *Combat) {
	t.Helper()
	gs := &GameState{ID: "g1", Width: 8, Height: 8, Monsters: map[string]*Monster{}, Combats: map[string]*Combat{}}
	gs.Tiles = make([]Tile, 64)
	m := &Monster{ID: "m1", Species: "Slime Vorace", X: 3, Y: 3, HP: 60, MaxHP: 60,
		Stats: Stats{Force: 1, Agilite: 1, Endurance: 8}, Count: 2}
	gs.Monsters[m.ID] = m
	gs.TileAt(m.X, m.Y).MonsterID = m.ID
	mk := func(name string) *Hero {
		h := testHero(name, 4) // faibles : le combat dure
		h.X, h.Y = m.X, m.Y
		h.Stats.Endurance = 10 // encaisse : personne ne meurt pendant le test
		h.HP, h.MaxHP = 40, 40
		gs.Heroes = append(gs.Heroes, h)
		return h
	}
	a1, a2, b1 := mk("A1"), mk("A2"), mk("B1")
	gs.Players = []*Player{
		{ID: "pA", Name: "Alice", HeroIDs: []string{a1.ID, a2.ID}, Host: true},
		{ID: "pB", Name: "Bob", HeroIDs: []string{b1.ID}},
	}
	c, err := gs.StartCombat(a1.ID, "pA")
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	return gs, c
}

func unitOwner(c *Combat) string {
	if u := c.CurrentUnit(); u != nil {
		return u.OwnerID
	}
	return ""
}

func TestOtherPlayersUnitsAreAutoPlayed(t *testing.T) {
	_, c := multiGame(t)
	if !c.hasParticipant("pA") || c.hasParticipant("pB") {
		t.Fatalf("starter should be the only participant: %v", c.Participants)
	}
	// le combat inclut bien les 3 héros (dont celui de Bob)
	heroes := 0
	for _, u := range c.Units {
		if u.Side == "hero" {
			heroes++
			if u.OwnerID == "" {
				t.Fatalf("every hero unit must carry its owner")
			}
		}
	}
	if heroes != 3 {
		t.Fatalf("expected 3 hero units, got %d", heroes)
	}
	// sur 12 pauses de tour, le tour n'est JAMAIS rendu à une unité de Bob :
	// ses héros sont joués par l'IA entre les tours d'Alice.
	for i := 0; i < 12 && c.Status == "active"; i++ {
		cur := c.CurrentUnit()
		if cur == nil {
			break
		}
		if cur.Side != "hero" {
			t.Fatalf("pause should always be on a hero turn, got %s", cur.Name)
		}
		if cur.OwnerID != "pA" {
			t.Fatalf("turn handed to a non-participant unit (owner=%q)", cur.OwnerID)
		}
		if err := c.PlayerAction(cur.ID, "end", 0, 0, ""); err != nil {
			t.Fatalf("end: %v", err)
		}
	}
	// et l'IA a bien fait AGIR les héros de Bob (trace dans le log)
	acted := false
	for _, l := range c.Log {
		if contains(l, "B1") {
			acted = true
			break
		}
	}
	if !acted {
		t.Fatalf("Bob's hero should have been played by the AI: %v", c.Log)
	}
}

func TestJoinCombatTakesControl(t *testing.T) {
	gs, c := multiGame(t)
	if _, err := gs.JoinCombat(c.ID, "pB"); err != nil {
		t.Fatalf("join: %v", err)
	}
	if !c.hasParticipant("pB") {
		t.Fatalf("pB should now be a participant")
	}
	// en jouant des tours, on doit finir par tomber sur une pause appartenant à Bob
	sawBob := false
	for i := 0; i < 12 && c.Status == "active"; i++ {
		cur := c.CurrentUnit()
		if cur == nil || cur.Side != "hero" {
			break
		}
		if cur.OwnerID == "pB" {
			sawBob = true
			break
		}
		if err := c.PlayerAction(cur.ID, "end", 0, 0, ""); err != nil {
			t.Fatalf("end: %v", err)
		}
	}
	if !sawBob {
		t.Fatalf("after joining, Bob's unit turns must pause for his orders")
	}
}

func TestJoinCombatValidations(t *testing.T) {
	gs, c := multiGame(t)
	if _, err := gs.JoinCombat(c.ID, "ghost"); err == nil {
		t.Fatalf("unknown player must be rejected")
	}
	// un joueur sans héros dans le combat est refusé
	gs.Players = append(gs.Players, &Player{ID: "pC", Name: "Carl", HeroIDs: []string{"none"}})
	if _, err := gs.JoinCombat(c.ID, "pC"); err == nil {
		t.Fatalf("a player without units in the combat must be rejected")
	}
	// idempotent pour un participant déjà présent
	if _, err := gs.JoinCombat(c.ID, "pA"); err != nil {
		t.Fatalf("re-join should be idempotent: %v", err)
	}
}

func TestMultiSpawnStaysOnGrid(t *testing.T) {
	// 8 héros SANS propriétaire (aucune IA ne joue au spawn) : les 7 premiers se
	// répartissent la rangée du bas sans doublon, le 8e reste spectateur.
	gs := &GameState{ID: "g1", Width: 8, Height: 8, Monsters: map[string]*Monster{}, Combats: map[string]*Combat{}}
	gs.Tiles = make([]Tile, 64)
	m := testMonster()
	gs.Monsters[m.ID] = m
	gs.TileAt(m.X, m.Y).MonsterID = m.ID
	var party []*Hero
	for i := 0; i < 8; i++ {
		h := testHero(string(rune('A'+i)), 5)
		h.X, h.Y = m.X, m.Y
		gs.Heroes = append(gs.Heroes, h)
		party = append(party, h)
	}
	c := NewCombat(gs, party, m, "")
	seen := map[[2]int]bool{}
	heroes := 0
	for _, u := range c.Units {
		if u.Side != "hero" {
			continue
		}
		heroes++
		if u.X < 0 || u.X >= c.GridW || u.Y != c.GridH-1 {
			t.Fatalf("hero spawn off-grid: (%d,%d)", u.X, u.Y)
		}
		key := [2]int{u.X, u.Y}
		if seen[key] {
			t.Fatalf("two heroes on the same spawn cell %v", key)
		}
		seen[key] = true
	}
	if heroes != 7 {
		t.Fatalf("the arena row holds 7 heroes max, got %d", heroes)
	}
}
