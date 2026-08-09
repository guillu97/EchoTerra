package game

// L'ORDRE DU JOUR ET LA PRÉVISION DE VAGUE.
//
// Réponse aux trous T3 et T5 de RETENTION-PLAN.md. Le problème n'est pas que le joueur
// manque d'options : c'est qu'en arrivant avec ses 18 PA, le jeu ne lui dit RIEN de ce
// dont la ville a besoin. L'information existe déjà — matériaux manquants, packs dans
// l'anneau, bâtiments abîmés, plans en attente — mais elle est éparpillée sur trois
// onglets, et pour une session de cinq minutes deux fois par jour, cette reconstitution
// EST le coût d'entrée.
//
// Tout ici est DÉRIVÉ : aucune donnée nouvelle, aucun stockage, rien à migrer.
// Recompute() reconstruit ces champs à chaque fois, comme la défense ou le Tétanisé.

import "fmt"

// TownOrder est une ligne de l'ordre du jour : ce que la ville demande, maintenant.
type TownOrder struct {
	Kind string `json:"kind"` // threat | gate | repair | material | plan | chantier | wear
	Icon string `json:"icon"`
	Text string `json:"text"`
	// Urgent marque ce qui coûte des PV À LA PROCHAINE VAGUE, par opposition à ce qui
	// prépare les suivantes. Le client peut en faire un accent visuel.
	Urgent bool `json:"urgent"`
}

// WaveForecast est ce que la prochaine vague fera si personne ne bouge.
//
// Elle n'est calculable que depuis que la puissance de la horde dérive des créatures
// réellement massées aux abords (wave.go) : avec une formule du numéro de vague, ce
// chiffre n'aurait rien appris au joueur et surtout, il n'aurait pas été ACTIONNABLE.
// Ici, dégager deux packs change la prévision sous ses yeux — c'est ce qui transforme
// « je me connecterai un jour » en « il faut que je sorte avant ce soir ».
type WaveForecast struct {
	Horde     int  `json:"horde"`     // estimation (le tirage aléatoire reste inconnu)
	Defense   int  `json:"defense"`   // ce que la ville oppose en l'état
	Besieging int  `json:"besieging"` // créatures dans l'anneau — LE levier
	Damage    int  `json:"damage"`    // PV attendus en moins
	Fatal     bool `json:"fatal"`     // la ville n'y survivrait pas
}

// Forecast estime la prochaine vague à partir de l'état courant.
func (g *GameState) Forecast() WaveForecast {
	besieging := g.besiegingCreatures()
	// Même formule que hordePower, sans le terme aléatoire : on annonce une estimation,
	// pas une promesse. Mieux vaut un « ~34 » honnête qu'un chiffre faussement exact.
	horde := int(float64(hordeBase+(g.WaveNumber+1)*hordeGrowth)*g.hordeScale()) + besieging*assaultPerAttack
	def := g.TownDefense()
	dmg := horde - def
	if dmg < 0 {
		dmg = 0
	}
	return WaveForecast{
		Horde: horde, Defense: def, Besieging: besieging,
		Damage: dmg, Fatal: dmg >= g.Town.HP,
	}
}

// townOrdersCap borne l'ordre du jour. Au-delà de quatre lignes ce n'est plus un ordre
// du jour, c'est un rapport — et un rapport ne se lit pas en cinq minutes.
const townOrdersCap = 4

// BuildOrders compose l'ordre du jour, du plus urgent au plus préparatoire. L'ordre des
// blocs EST la priorité : ce qui coûte des PV à la prochaine vague passe avant ce qui
// prépare les suivantes.
func (g *GameState) BuildOrders() []TownOrder {
	if g.Status != StatusActive {
		return []TownOrder{}
	}
	out := make([]TownOrder, 0, townOrdersCap)
	add := func(kind, icon, text string, urgent bool) {
		if len(out) < townOrdersCap {
			out = append(out, TownOrder{Kind: kind, Icon: icon, Text: text, Urgent: urgent})
		}
	}
	f := g.Forecast()

	// 1. La menace, chiffrée. C'est la ligne qui donne envie de jouer maintenant.
	switch {
	case f.Fatal:
		add("threat", "☠️", fmt.Sprintf("%d créatures aux portes — la prochaine vague emporterait la ville (~%d contre %d de défense)",
			f.Besieging, f.Horde, f.Defense), true)
	case f.Besieging > 0:
		add("threat", "⚔️", fmt.Sprintf("%d créatures dans l'anneau — la vague frappera à ~%d contre %d de défense (−%d PV)",
			f.Besieging, f.Horde, f.Defense, f.Damage), true)
	case f.Damage > 0:
		add("threat", "🌊", fmt.Sprintf("Abords dégagés — la vague ne coûtera que %d PV", f.Damage), false)
	default:
		add("threat", "🛡️", "Abords dégagés — la ville encaissera la prochaine vague sans une égratignure", false)
	}

	// 2. Le portail ouvert : la plus grosse fuite de défense du jeu, et la moins chère
	// à colmater (1 PA).
	if b := g.buildingByID("gate"); b != nil && b.Built && b.Open {
		add("gate", "🚪", fmt.Sprintf("Le portail est OUVERT — le fermer rend %d de défense", buildingLevelDefense(b)), true)
	}

	// 3. Les remparts de la ville, quand elle saigne et qu'on a de quoi la soigner.
	if g.Town.HP < g.Town.MaxHP {
		stone := g.storageQty(TownRepairMaterial)
		missing := g.Town.MaxHP - g.Town.HP
		if stone > 0 {
			add("repair", "🧱", fmt.Sprintf("La ville est à %d/%d PV — %d %s en Banque, soit %d PV à relever",
				g.Town.HP, g.Town.MaxHP, stone, TownRepairMaterial, minInt(stone*TownRepairHP, missing)), g.Town.HP*2 < g.Town.MaxHP)
		} else {
			add("repair", "🧱", fmt.Sprintf("La ville est à %d/%d PV et il n'y a plus de %s pour relever les remparts",
				g.Town.HP, g.Town.MaxHP, TownRepairMaterial), true)
		}
	}

	// 4. Un chantier ouvert qui attend des bras — de la main-d'œuvre déjà engagée.
	for _, b := range g.Town.Buildings {
		if !b.UnderConstruction {
			continue
		}
		if miss := g.missingFor(b.Cost.Materials); miss != "" {
			add("chantier", "⏸", fmt.Sprintf("Chantier de %s en pause — il manque %s", b.Name, miss), false)
		} else {
			add("chantier", "🏗️", fmt.Sprintf("Chantier de %s : %d/%d PA investis", b.Name, b.PaInvested, b.Cost.PA), false)
		}
		break // un seul rappel de chantier : l'ordre du jour n'est pas un inventaire
	}

	// 5. Ce qui manque pour la prochaine amélioration DÉFENSIVE — le progrès qui compte.
	for _, id := range botDefensiveOrder {
		b := g.buildingByID(id)
		if b == nil || !b.Built || b.UnderConstruction || b.Level >= MaxBuildingLevel {
			continue
		}
		if miss := g.missingFor(b.Cost.Materials); miss != "" {
			add("material", "⛏️", fmt.Sprintf("%s niveau %d : il manque %s", b.Name, b.Level+1, miss), false)
			break
		}
	}

	// 6. Un plan trouvé qu'on peut poser tout de suite, ou un site qui attend le sien.
	for _, b := range g.Town.Buildings {
		if b.Built || b.UnderConstruction {
			continue
		}
		plan := b.Cost.Plan
		if plan == "" {
			continue
		}
		if g.storageQty(plan) > 0 {
			add("plan", "📐", fmt.Sprintf("« %s » est en Banque — le chantier de %s peut s'ouvrir", plan, b.Name), false)
			break
		}
	}

	// 7. Une défense usée : la défense est proportionnelle à la durabilité, donc un mur
	// à 60 % est 40 % de sa protection jetée.
	for _, id := range botDefensiveOrder {
		b := g.buildingByID(id)
		if b != nil && b.Built && b.MaxDurability > 0 && b.Durability*10 < b.MaxDurability*7 {
			add("wear", "🔧", fmt.Sprintf("%s à %d%% — chaque PA de réparation rend de la défense",
				b.Name, 100*b.Durability/b.MaxDurability), false)
			break
		}
	}
	return out
}

// missingFor décrit ce qui manque en Banque pour cette liste de matériaux (« 6 Pierre,
// 2 Brique »), ou "" si tout est là.
func (g *GameState) missingFor(mats []Item) string {
	s := ""
	for _, m := range mats {
		if short := m.Qty - g.storageQty(m.Name); short > 0 {
			if s != "" {
				s += ", "
			}
			s += fmt.Sprintf("%d %s", short, m.Name)
		}
	}
	return s
}

// buildingLevelDefense : ce qu'un bâtiment défendrait à sa durabilité actuelle s'il
// n'était pas neutralisé (portail ouvert). Sert à chiffrer ce qu'on récupère en le
// fermant.
func buildingLevelDefense(b *TownBuilding) int {
	lv := buildingLevelDef(b.ID, b.Level)
	if lv == nil || b.MaxDurability == 0 {
		return 0
	}
	return lv.Defense * b.Durability / b.MaxDurability
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
