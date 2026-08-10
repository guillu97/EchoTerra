package game

import (
	"testing"
	"time"
)

// LES CINQ BÂTIMENTS DE SPÉCIALITÉ (2026-08-10).
//
// Pourquoi ils existent : une expédition de vingt construisait LES ONZE bâtiments du
// catalogue — il n'y avait aucune priorité à arbitrer, seulement une liste à dérouler.
// Chacun ouvre un axe que rien d'autre ne couvre (soigner, voir, frapper, regarnir,
// tenir plus nombreux), plafonne à trois niveaux comme les autres, et ne s'obtient
// qu'avec un plan de RUINE — donc aucune ville ne peut tous les avoir.

// specialty stages a town with the given specialty built at `level`.
func specialty(t *testing.T, id string, level int) (*GameState, *Player) {
	t.Helper()
	g, ana, _ := twoPlayerTown(t)
	b := g.buildingByID(id)
	if b == nil {
		t.Fatalf("bâtiment %q absent du catalogue", id)
	}
	b.Built, b.Level, b.Durability = true, level, b.MaxDurability
	g.Recompute()
	return g, ana
}

// L'INFIRMERIE — elle bouche un TROU : rien ne rendait de PV à un héros. Une vague
// frappe 3 + son numéro, un combat perdu renvoie à 1 PV, et la seule remise en état du
// jeu était de MOURIR puis d'être ressuscité. Un héros abîmé le restait toute la partie.
func TestInfirmaryHealsAWoundedHeroInTown(t *testing.T) {
	g, ana := specialty(t, "infirmerie", 1)
	h := g.HeroByID(ana.HeroIDs[0])
	h.HP = 1
	h.AddState("Blessé")

	if err := g.TownAction("infirmerie", "heal", 1, h.ID); err != nil {
		t.Fatal(err)
	}
	want := 1 + infirmaryHeal
	if want > h.MaxHP {
		want = h.MaxHP // le soin ne dépasse pas les PV maximum
	}
	if h.HP != want {
		t.Fatalf("PV attendus %d, obtenus %d (max %d)", want, h.HP, h.MaxHP)
	}
	if h.HasState("Blessé") {
		t.Fatal("le soin doit retirer Blessé")
	}
	// QUOTA QUOTIDIEN = NIVEAU (comme le lit de la Mairie) : sinon une infirmerie de
	// niveau 1 remettrait toute une expédition à neuf chaque jour.
	other := g.HeroByID(ana.HeroIDs[1])
	other.HP = 5
	if err := g.TownAction("infirmerie", "heal", 1, h.ID); err == nil {
		t.Fatal("le quota du jour est épuisé, le second soin doit être refusé")
	}
	g.Day++
	if err := g.TownAction("infirmerie", "heal", 1, h.ID); err != nil {
		t.Fatalf("un nouveau jour rouvre le service : %v", err)
	}
}

func TestInfirmaryRefusesWhenNobodyIsHurt(t *testing.T) {
	g, ana := specialty(t, "infirmerie", 1)
	h := g.HeroByID(ana.HeroIDs[0])
	if err := g.TownAction("infirmerie", "heal", 1, h.ID); err == nil {
		t.Fatal("personne de blessé : ne pas gaspiller le PA ni le quota")
	}
}

// LE CARTOGRAPHE — l'axe « voir ». La carte d'une expédition de vingt fait 134² et le
// rayon de vision d'un héros vaut 1 : sans lui on prospecte à l'aveugle.
func TestCartographerWidensEveryHerosSight(t *testing.T) {
	count := func(g *GameState) int {
		n := 0
		for i := range g.Tiles {
			if g.Tiles[i].Discovered {
				n++
			}
		}
		return n
	}
	// ⚠ MISE EN SCÈNE : un héros LOIN de la ville. Tous les héros naissent sur la case
	// ville, dont le rayon de vue (townSightRadius) engloberait celui d'un héros — le
	// bonus serait invisible sans que rien ne soit cassé.
	stage := func(level int) *GameState {
		g, ana := specialty(t, "cartographe", level)
		if level == 0 {
			g.buildingByID("cartographe").Built = false
		}
		h := g.HeroByID(ana.HeroIDs[0])
		h.X, h.Y = g.Town.X+6, g.Town.Y+6 // carte 15², loin de l'aura du bourg
		for i := range g.Tiles {
			g.Tiles[i].Discovered = false
		}
		g.Recompute()
		return g
	}
	base := count(stage(0))
	g := stage(2)
	if count(g) <= base {
		t.Fatalf("le Cartographe doit élargir la vision : %d découvertes contre %d", count(g), base)
	}
}

// L'ARMURERIE — l'axe « frapper », et le SEUL bâtiment dont l'effet sort des murs.
func TestArmoryArmsTheHeroesForCombat(t *testing.T) {
	g, ana := specialty(t, "armurerie", 2)
	h := g.HeroByID(ana.HeroIDs[0])
	force := h.Stats.Force

	m := NewMonster("Slime Vorace", h.X, h.Y)
	c := NewCombat(g, []*Hero{h}, m, h.ID)
	var unit *CombatUnit
	for _, u := range c.Units {
		if u.RefID == h.ID {
			unit = u
		}
	}
	if unit == nil {
		t.Fatal("le héros doit être dans l'arène")
	}
	if unit.Stats.Force != force+2 {
		t.Fatalf("Armurerie niveau 2 : force %d attendue, obtenue %d", force+2, unit.Stats.Force)
	}
	// …et la statistique du héros SUR LA CARTE n'est pas modifiée : l'arme est prêtée,
	// pas greffée (sinon elle s'empilerait à chaque combat).
	if h.Stats.Force != force {
		t.Fatalf("la force du héros hors combat ne doit pas bouger : %d", h.Stats.Force)
	}
	// Une armurerie en ruine ne forge plus.
	g.buildingByID("armurerie").Durability = 0
	if g.armoryBonus() != 0 {
		t.Fatal("un atelier détruit ne doit rien apporter")
	}
}

// LE VERGER — l'axe « durer ». Ce qui borne vraiment une longue partie n'est pas
// l'arithmétique de la horde mais l'ÉPUISEMENT DE LA CARTE.
func TestOrchardRegrowsTheNearestExhaustedTiles(t *testing.T) {
	g, _ := specialty(t, "verger", 1)
	for i := range g.Tiles {
		g.Tiles[i].Resources = 0
	}
	rich := g.TileAt(g.Town.X+1, g.Town.Y)
	rich.Resources = orchardCap // déjà au plafond : à ne pas engraisser

	g.ForceWave(time.Now())

	regrown := 0
	for dy := -orchardRadius; dy <= orchardRadius; dy++ {
		for dx := -orchardRadius; dx <= orchardRadius; dx++ {
			if tl := g.TileAt(g.Town.X+dx, g.Town.Y+dy); tl != nil && tl.Resources > 0 && tl != rich {
				regrown++
			}
		}
	}
	if regrown == 0 {
		t.Fatal("le Verger doit rendre des ressources aux cases proches")
	}
	if rich.Resources > orchardCap {
		t.Fatalf("une case déjà au plafond ne doit pas grossir : %d", rich.Resources)
	}
	// Il ne remet pas la carte à neuf : rien ne repousse au loin.
	if far := g.TileAt(g.Town.X+orchardRadius+3, g.Town.Y); far != nil && far.Resources > 0 {
		t.Fatal("le Verger n'a pas la portée de toute la carte")
	}
}

// LA CASERNE — l'axe « tenir plus nombreux » : elle relève le PLAFOND de la garnison
// sans donner un point de défense par elle-même.
func TestBarracksRaisesTheGarrisonCeilingOnly(t *testing.T) {
	g, _ := specialty(t, "caserne", 0)
	g.buildingByID("caserne").Built = false
	// Une foule, pour saturer le plafond.
	for i := 0; i < 40; i++ {
		g.Heroes = append(g.Heroes, &Hero{ID: NewJoinCode() + string(rune('a'+i%26)),
			Name: "Renfort", X: g.Town.X, Y: g.Town.Y, HP: 10, MaxHP: 10, Bars: map[string]int{}})
	}
	g.Recompute()
	walls, before := g.buildingsDefense(), g.Town.GarrisonValue
	if before != walls {
		t.Fatalf("staging: la garnison doit saturer au niveau des murs (%d vs %d)", before, walls)
	}

	b := g.buildingByID("caserne")
	b.Built, b.Level, b.Durability = true, 2, b.MaxDurability
	g.Recompute()
	if g.buildingsDefense() != walls {
		t.Fatal("la Caserne ne doit PAS ajouter de défense de pierre — elle emploie des gens")
	}
	if g.Town.GarrisonValue != before+2*casernePerLevel {
		t.Fatalf("plafond attendu %d, obtenu %d", before+2*casernePerLevel, g.Town.GarrisonValue)
	}
}

// ⚠ AUCUNE VILLE NE PEUT TOUT AVOIR — c'est le sujet de ces bâtiments. Leurs plans ne
// tombent QUE des ruines, une spécialité par biome : les débloquer tous demanderait de
// déblayer une ruine dans CHAQUE biome de la carte.
func TestSpecialtyPlansComeOnlyFromRuinsOnePerBiome(t *testing.T) {
	specialties := []string{"infirmerie", "cartographe", "armurerie", "verger", "caserne"}
	fromRuin := map[string]int{}
	for _, def := range ruinDefs {
		for _, d := range def.Loot {
			fromRuin[d.Name]++
		}
	}
	for _, id := range specialties {
		plan := buildingPlanItem(id)
		if plan == "" {
			t.Fatalf("%s doit exiger un plan", id)
		}
		if n := fromRuin[plan]; n != 1 {
			t.Errorf("%q doit tomber d'UNE seule sorte de ruine, trouvé %d", plan, n)
		}
		// …et jamais d'une fouille de terrain ordinaire : ce serait rendre gratuit ce
		// qui doit se mériter en explorant.
		for b, td := range Terrains {
			for _, d := range td.Drops {
				if d.Name == plan {
					t.Errorf("%q ne doit pas tomber du biome %d", plan, b)
				}
			}
		}
		// Chacun exige d'avoir déjà investi ailleurs : le second verrou.
		if len(BuildingDesigns[id].Requires) == 0 {
			t.Errorf("%s doit avoir un prérequis d'arbre techno", id)
		}
	}
}

// Ils restent à TROIS niveaux comme tout le reste — la règle du jeu, pas une exception.
func TestEverySpecialtyHasExactlyThreeLevels(t *testing.T) {
	for _, id := range []string{"infirmerie", "cartographe", "armurerie", "verger", "caserne"} {
		d, ok := BuildingDesigns[id]
		if !ok {
			t.Fatalf("%s absent du design", id)
		}
		if len(d.Levels) != MaxBuildingLevel {
			t.Errorf("%s : %d niveaux, %d attendus", id, len(d.Levels), MaxBuildingLevel)
		}
		for i, lv := range d.Levels {
			if len(lv.Materials) == 0 || lv.Effects == "" {
				t.Errorf("%s niveau %d : matériaux ou effet manquant", id, i+1)
			}
		}
	}
}
