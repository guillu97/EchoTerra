package game

import "testing"

func TestMapSkillAddsToMonstersKilled(t *testing.T) {
	g, _ := newSkillTestGame()
	g.placePack("m1", 2, 2, 1, 3) // 1 HP each: the blast burns through the whole pack

	rep, err := g.CastMapSkill("h1", "stone-throw")
	if err != nil {
		t.Fatalf("cast failed: %v", err)
	}
	if rep.Slain == 0 {
		t.Fatal("expected the blast to slay at least one creature")
	}
	if g.MonstersKilled != rep.Slain {
		t.Fatalf("MonstersKilled = %d, want the report's slain count %d", g.MonstersKilled, rep.Slain)
	}
}

func TestCombatWonAddsPackToMonstersKilled(t *testing.T) {
	gs := &GameState{ID: "g1", Width: 8, Height: 8, Monsters: map[string]*Monster{}, Combats: map[string]*Combat{}}
	gs.Tiles = make([]Tile, 64)
	m := testMonster()
	m.Count = 5
	gs.Monsters[m.ID] = m
	gs.TileAt(m.X, m.Y).MonsterID = m.ID
	hero := testHero("Aldric", 5)
	hero.X, hero.Y = m.X, m.Y
	gs.Heroes = []*Hero{hero}

	c := &Combat{ID: "c1", GameID: gs.ID, TileX: m.X, TileY: m.Y, Status: "won",
		Units: []*CombatUnit{{ID: "u1", Side: "hero", RefID: hero.ID, HP: 12, MaxHP: 20}}}
	gs.Combats[c.ID] = c
	gs.ActiveCombat = c.ID

	gs.FinishCombat(c)

	if gs.MonstersKilled != 5 {
		t.Fatalf("MonstersKilled = %d, want the whole pack (5)", gs.MonstersKilled)
	}
}

func TestCombatLostAddsNothing(t *testing.T) {
	gs := &GameState{ID: "g1", Width: 8, Height: 8, Monsters: map[string]*Monster{}, Combats: map[string]*Combat{}}
	gs.Tiles = make([]Tile, 64)
	m := testMonster()
	gs.Monsters[m.ID] = m
	gs.TileAt(m.X, m.Y).MonsterID = m.ID
	hero := testHero("Aldric", 5)
	hero.X, hero.Y = m.X, m.Y
	gs.Heroes = []*Hero{hero}

	c := &Combat{ID: "c1", GameID: gs.ID, TileX: m.X, TileY: m.Y, Status: "lost",
		Units: []*CombatUnit{{ID: "u1", Side: "hero", RefID: hero.ID, HP: 0, MaxHP: 20}}}
	gs.Combats[c.ID] = c
	gs.ActiveCombat = c.ID

	gs.FinishCombat(c)

	if gs.MonstersKilled != 0 {
		t.Fatalf("a lost combat must not count kills, got %d", gs.MonstersKilled)
	}
}

func TestNewTownNameNotEmpty(t *testing.T) {
	for i := 0; i < 50; i++ {
		if n := NewTownName(); n == "" {
			t.Fatal("NewTownName returned an empty name")
		}
	}
}

// Le classement sépare trois natures de partie qui ne se comparent pas.
func TestLeaderboardMode(t *testing.T) {
	solo := &GameState{Solo: true, Visibility: VisibilityPrivate}
	if got := solo.LeaderboardMode(); got != ModeSolo {
		t.Fatalf("solo game classified %q", got)
	}
	pub := &GameState{Visibility: VisibilityPublic}
	if got := pub.LeaderboardMode(); got != ModePublic {
		t.Fatalf("public game classified %q", got)
	}
	priv := &GameState{Visibility: VisibilityPrivate, Players: []*Player{
		{ID: "p1", Name: "Guillaume"}, {ID: "p2", Name: "Neko"},
	}}
	if got := priv.LeaderboardMode(); got != ModePrivate {
		t.Fatalf("private multiplayer game classified %q", got)
	}
	// Legacy: no Solo flag, but the shape of a solo run (one human + bots).
	legacy := &GameState{Players: []*Player{
		{ID: "p1", Name: "Guillaume"}, {ID: "b1", Name: "Bot", Bot: true},
	}}
	if got := legacy.LeaderboardMode(); got != ModeSolo {
		t.Fatalf("legacy solo run classified %q", got)
	}
	// ⚠ RÈGLE CHANGÉE LE 2026-08-12, avec l'escorte de départ (lobby.go
	// MaybeStartWithEscort). Ce test affirmait « une partie publique reste publique même
	// avec un seul humain parmi des bots » — ce qui ne coûtait rien tant qu'une partie
	// publique ne POUVAIT PAS avoir de bots (AddBot les refusait, et les refuse
	// toujours aux joueurs). Depuis que le serveur fait partir un salon qui attend en
	// complétant l'équipage, le cas est réel : une expédition menée par UN humain et des
	// robots a la difficulté et la texture d'un run solo, et la ranger parmi les villes
	// tenues à plusieurs comparerait des choses qui n'ont rien à voir.
	//
	// Le mode est recalculé à CHAQUE écriture : l'expédition redevient « publique » à la
	// seconde où un deuxième humain embarque. L'étiquette suit donc la réalité du run,
	// ce qui est exactement ce qu'on lui demande.
	escorted := &GameState{Visibility: VisibilityPublic, Players: []*Player{
		{ID: "p1", Name: "Guillaume"}, {ID: "b1", Name: "Bot", Bot: true},
	}}
	if got := escorted.LeaderboardMode(); got != ModeSolo {
		t.Fatalf("expédition publique menée par un seul humain : %q, attendu solo", got)
	}
	// …et dès qu'un deuxième humain est là, c'est bien une expédition publique.
	escorted.Players = append(escorted.Players, &Player{ID: "p2", Name: "Neko"})
	if got := escorted.LeaderboardMode(); got != ModePublic {
		t.Fatalf("expédition publique à deux humains : %q, attendu public", got)
	}
}
