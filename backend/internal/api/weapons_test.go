package api

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"echoterra/internal/game"
)

// LE CONTRAT QUE LE CLIENT CONSOMME (weapons.go + combatResponse).
//
// Ce que ça défend et qu'un test du paquet `game` ne peut pas voir : la
// technique de l'arme portée doit ARRIVER jusqu'au payload, avec son drapeau
// `weapon`, à l'indice que `skillIdx` désignera au retour. Client et serveur
// indexent la MÊME liste ; si les deux divergeaient, le joueur lancerait une
// autre capacité que celle qu'il a tapée — sans erreur, sans trace.
func TestCombatPayloadServesTheWeaponTechnique(t *testing.T) {
	// ⚠ ON SÈME. Ce test attend que la horde entre dans la fourchette de l'arc
	// (2-4 cases : le « Tir en cloche » ne vise pas au contact) — une issue tirée
	// aux dés : placement de l'arène, initiative, chemin choisi par l'IA. Sans
	// graine il échouait environ une fois sur quatre, sans que rien n'ait changé.
	// Même règle que seedForTest dans le paquet game.
	game.SeedRNG(20260811)
	t.Cleanup(func() { game.SeedRNG(time.Now().UnixNano()) })

	s := newTestServer(t)
	rec := postJSON(t, s, "/api/games", map[string]any{"width": 22, "height": 22, "seed": 20260811})
	var gs game.GameState
	if err := json.Unmarshal(rec.Body.Bytes(), &gs); err != nil {
		t.Fatal(err)
	}

	// On arme le héros et on lui colle un pack sur la case : le chemin de jeu
	// (forger, ramasser, marcher) n'apporte rien à CE contrat.
	loaded, err := s.store.Load(gs.ID)
	if err != nil {
		t.Fatal(err)
	}
	h := loaded.Heroes[0]
	// Les coéquipiers restent à l'écart : sinon ils entrent dans le combat et
	// l'unité ACTIVE (meilleure initiative) peut être un héros désarmé.
	for _, other := range loaded.Heroes[1:] {
		other.X, other.Y = h.X+3, h.Y+3
	}
	h.AddLoot(game.Item{Type: "arme", Name: "Arc sylvestre", Qty: 1})
	h.AddLoot(game.Item{Type: "arme", Name: "Lame de fer", Qty: 1})
	m := &game.Monster{ID: "mw", Species: "Slime Vorace", X: h.X, Y: h.Y, HP: 400, MaxHP: 400,
		Stats: game.Stats{Force: 1, Agilite: 1, Endurance: 12}, Count: 3}
	loaded.Monsters[m.ID] = m
	loaded.TileAt(h.X, h.Y).MonsterID = m.ID
	if err := s.store.Save(loaded); err != nil {
		t.Fatal(err)
	}

	if rec = postJSON(t, s, "/api/games/"+gs.ID+"/heroes/"+h.ID+"/equip",
		map[string]any{"item": "Arc sylvestre", "slot": "arme"}); rec.Code != http.StatusOK {
		t.Fatalf("equip: %d %s", rec.Code, rec.Body.String())
	}
	rec = postJSON(t, s, "/api/games/"+gs.ID+"/heroes/"+h.ID+"/combat/start", map[string]any{})
	if rec.Code != http.StatusOK {
		t.Fatalf("combat/start: %d %s", rec.Code, rec.Body.String())
	}

	type skillEntry struct {
		Idx     int            `json:"idx"`
		Skill   game.AttackDef `json:"skill"`
		Weapon  bool           `json:"weapon"`
		Targets []string       `json:"targets"`
		Self    bool           `json:"selfCast"`
		Est     map[string]any `json:"estimates"`
	}
	var resp struct {
		Combat  game.Combat `json:"combat"`
		Current struct {
			UnitID string       `json:"unitId"`
			Skills []skillEntry `json:"skills"`
			Swaps  []struct {
				Name      string `json:"name"`
				Kind      string `json:"kind"`
				Technique string `json:"technique"`
			} `json:"swaps"`
		} `json:"current"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}

	// L'unité porte son arme (la barre de combat l'affiche).
	var cur *game.CombatUnit
	for _, u := range resp.Combat.Units {
		if u.ID == resp.Current.UnitID {
			cur = u
		}
	}
	if cur == nil {
		t.Fatal("l'unité active devrait être servie")
	}
	if cur.WeaponName != "Arc sylvestre" || cur.WeaponKind != game.ArchBow || cur.Reach != 3 {
		t.Fatalf("l'unité doit porter son arme : %q / %q / portée %d", cur.WeaponName, cur.WeaponKind, cur.Reach)
	}

	// La technique FERME la liste et se signale comme venant de l'arme.
	if len(resp.Current.Skills) == 0 {
		t.Fatal("aucune compétence servie")
	}
	last := resp.Current.Skills[len(resp.Current.Skills)-1]
	if !last.Weapon || last.Skill.Name != "Tir en cloche" {
		t.Fatalf("la dernière compétence doit être la technique de l'arc : %+v", last)
	}
	if last.Idx != len(resp.Current.Skills)-1 {
		t.Fatalf("skillIdx doit indexer la liste servie : idx=%d len=%d", last.Idx, len(resp.Current.Skills))
	}
	for _, sk := range resp.Current.Skills[:len(resp.Current.Skills)-1] {
		if sk.Weapon {
			t.Fatalf("une compétence de CLASSE ne doit pas être marquée « arme » : %+v", sk)
		}
	}

	// L'autre arme du sac est proposée au changement, avec sa technique annoncée.
	if len(resp.Current.Swaps) != 1 || resp.Current.Swaps[0].Name != "Lame de fer" {
		t.Fatalf("la seconde arme du sac doit être proposée : %+v", resp.Current.Swaps)
	}
	if resp.Current.Swaps[0].Technique != "Fauchage" {
		t.Fatalf("le changement doit annoncer ce qu'il apporte : %+v", resp.Current.Swaps[0])
	}

	// Et l'indice envoyé au serveur joue BIEN cette technique-là.
	//
	// ⚠ au round 1 personne n'est à portée (héros et créatures naissent sur les
	// rangées OPPOSÉES d'une arène de 7) : on rend la main jusqu'à ce que la
	// horde arrive — c'est le déroulé réel d'un combat, pas un raccourci.
	fired := false
	for round := 0; round < 14 && !fired; round++ {
		rec = getJSON(t, s, "/api/games/"+gs.ID+"/combat/"+resp.Combat.ID, &resp)
		if rec.Code != http.StatusOK {
			t.Fatalf("getCombat: %d %s", rec.Code, rec.Body.String())
		}
		if resp.Combat.Status != "active" || len(resp.Current.Skills) == 0 {
			break
		}
		tech := resp.Current.Skills[len(resp.Current.Skills)-1]
		if !tech.Weapon {
			t.Fatalf("la technique d'arme doit rester en fin de liste : %+v", tech)
		}
		body := map[string]any{"unitId": resp.Current.UnitID, "action": "end"}
		if len(tech.Targets) > 0 {
			body = map[string]any{"unitId": resp.Current.UnitID, "action": "skill",
				"skillIdx": tech.Idx, "targetId": tech.Targets[0]}
			fired = true
		}
		rec = postJSON(t, s, "/api/games/"+gs.ID+"/combat/"+resp.Combat.ID+"/action", body)
		if rec.Code != http.StatusOK {
			t.Fatalf("action %v: %d %s", body["action"], rec.Code, rec.Body.String())
		}
	}
	if !fired {
		t.Fatal("la technique n'a jamais eu de cible en 14 tours — la portée servie est suspecte")
	}
	var after struct {
		Combat game.Combat `json:"combat"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &after); err != nil {
		t.Fatal(err)
	}
	used := false
	for _, l := range after.Combat.Log {
		if containsSub(l, "Tir en cloche") {
			used = true
		}
	}
	if !used {
		t.Fatalf("skillIdx devait jouer la technique de l'arme : %v", after.Combat.Log)
	}
}

func containsSub(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
