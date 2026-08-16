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

// TownOrder est une ligne de l'ordre du jour : ce que la ville demande, maintenant.
type TownOrder struct {
	Kind string `json:"kind"` // threat | gate | repair | material | plan | chantier | wear
	Icon string `json:"icon"`
	Text string `json:"text"`
	// Key/Args : le gabarit français et ses substitutions, pour que le client redise la
	// ligne dans SA langue (i18n.go). L'ordre du jour est recalculé par Recompute et
	// STOCKÉ dans l'état — il est donc écrit par n'importe quelle requête, y compris le
	// battement qui n'a aucun joueur derrière lui, et relu par toute la ville.
	Key  string `json:"key,omitempty"`
	Args []any  `json:"args,omitempty"`
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
	// La horde est annoncée en FOURCHETTE, jamais en chiffre exact : on l'estime, on
	// ne la lit pas dans un registre. La largeur de la fourchette est ce que la ville
	// a GAGNÉ — par sa tour de guet et par les gens qui sont montés observer.
	Min       int `json:"min"`
	Max       int `json:"max"`
	Defense   int `json:"defense"`   // ce que la ville oppose en l'état
	Besieging int `json:"besieging"` // créatures dans l'anneau — LE levier, et observable
	DamageMin int `json:"damageMin"` // PV attendus en moins, au mieux
	DamageMax int `json:"damageMax"` // …et au pire

	Fatal  bool `json:"fatal"`  // même au mieux, la ville n'y survit pas
	AtRisk bool `json:"atRisk"` // au pire, elle n'y survit pas

	// D'où vient la précision : le niveau de la tour de guet, et le nombre de joueurs
	// montés estimer CETTE vague. Le client les affiche pour que le progrès se voie.
	Precision int `json:"precision"` // 0-100
	Tower     int `json:"tower"`     // niveau de la Tour (0 = pas de tour)
	Scouts    int `json:"scouts"`    // joueurs ayant estimé cette vague
}

// LA PRÉCISION SE MÉRITE, et elle se mérite À PLUSIEURS.
//
//	towerSpread    — sans tour de guet, la ville devine (±50 %). Chaque niveau de Tour
//	                 resserre la fourchette : c'est le rôle d'une tour, et jusqu'ici
//	                 elle ne servait qu'à ajouter de la défense.
//	scoutFactor    — chaque JOUEUR monté estimer la vague resserre encore. Distinct par
//	                 joueur, pas par héros : ce qu'on récompense, c'est que plusieurs
//	                 personnes se soient donné la peine, pas qu'une seule ait trois
//	                 héros. C'est une manœuvre collective, comme le reste du jeu.
//	minSpread      — un plancher : même à vingt observateurs sur une tour de niveau 3,
//	                 la horde garde sa part d'imprévu.
const (
	baseForecastSpread = 0.50
	scoutFactor        = 0.70
	minForecastSpread  = 0.05
	scoutPA            = 2 // monter observer coûte du temps
)

// towerSpread : le facteur d'incertitude apporté par la tour de guet.
func towerSpread(level int) float64 {
	switch {
	case level >= 3:
		return 0.28
	case level == 2:
		return 0.42
	case level == 1:
		return 0.60
	}
	return 1.0 // pas de tour : on devine
}

// forecastSpread combine la tour et les observateurs.
func (g *GameState) forecastSpread() (spread float64, tower, scouts int) {
	if b := g.buildingByID("tower"); b != nil && b.Built {
		tower = b.Level
	}
	scouts = len(g.Town.Scouts)
	spread = baseForecastSpread * towerSpread(tower)
	for i := 0; i < scouts; i++ {
		spread *= scoutFactor
	}
	if spread < minForecastSpread {
		spread = minForecastSpread
	}
	return spread, tower, scouts
}

// Forecast estime la prochaine vague à partir de l'état courant.
func (g *GameState) Forecast() WaveForecast {
	besieging := g.besiegingCreatures()
	// Même formule que hordePower, sans son terme aléatoire : on estime, on ne promet
	// pas. La fourchette autour de cette valeur est ce que la ville a gagné.
	center := int(float64(hordeBase+(g.WaveNumber+1)*hordeGrowth)*g.hordeScale()) + besieging*assaultPerAttack
	spread, tower, scouts := g.forecastSpread()
	margin := int(float64(center)*spread + 0.5)
	if margin < 1 {
		margin = 1
	}
	lo, hi := center-margin, center+margin
	if lo < 0 {
		lo = 0
	}
	def := g.TownDefense()
	dmgLo, dmgHi := lo-def, hi-def
	if dmgLo < 0 {
		dmgLo = 0
	}
	if dmgHi < 0 {
		dmgHi = 0
	}
	return WaveForecast{
		Min: lo, Max: hi, Defense: def, Besieging: besieging,
		DamageMin: dmgLo, DamageMax: dmgHi,
		Fatal:     dmgLo >= g.Town.HP,
		AtRisk:    dmgHi >= g.Town.HP,
		Precision: int(100*(1-spread) + 0.5),
		Tower:     tower, Scouts: scouts,
	}
}

// ScoutWave : un héros monte à la tour de guet estimer la horde qui approche.
//
// C'est une manœuvre COLLECTIVE — chaque joueur qui s'y colle resserre la fourchette
// pour TOUT LE MONDE, et chacun ne compte qu'une fois par vague. Sur un jeu où l'on
// passe cinq minutes deux fois par jour, c'est une action qui a du sens même seule :
// deux PA, et l'expédition entière y voit plus clair.
func (g *GameState) ScoutWave(heroID string) (WaveForecast, error) {
	h := g.HeroByID(heroID)
	if h == nil || h.HP <= 0 {
		return WaveForecast{}, actionErr("héros invalide")
	}
	b := g.buildingByID("tower")
	if b == nil || !b.Built {
		return WaveForecast{}, actionErr("il faut une Tour de guet pour observer la horde")
	}
	if h.X != g.Town.X || h.Y != g.Town.Y {
		return WaveForecast{}, actionErrf("%s doit être en ville pour monter à la tour", h.Name)
	}
	owner := g.OwnerOfHero(heroID)
	if owner == "" {
		owner = heroID // parties héritées sans joueurs : le héros compte pour lui-même
	}
	for _, id := range g.Town.Scouts {
		if id == owner {
			return WaveForecast{}, actionErr("ton équipe a déjà observé cette vague — laisse la place aux autres")
		}
	}
	if h.PA < scoutPA {
		return WaveForecast{}, actionErrf("observer coûte %d PA", scoutPA)
	}
	h.PA -= scoutPA
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	g.Town.Scouts = append(g.Town.Scouts, owner)
	g.Recompute() // la fourchette se resserre immédiatement, pour tout le monde
	g.logTown("🔭 %s a observé la horde depuis la Tour (%d observateur(s), précision %d%%)",
		h.Name, len(g.Town.Scouts), g.Town.Forecast.Precision)
	return g.Town.Forecast, nil
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
	add := func(kind, icon string, urgent bool, key string, args ...any) {
		if len(out) < townOrdersCap {
			m := newMsg(key, args...)
			out = append(out, TownOrder{Kind: kind, Icon: icon, Text: m.Text, Key: m.Key, Args: m.Args, Urgent: urgent})
		}
	}
	f := g.Forecast()

	// 1. La menace, chiffrée. C'est la ligne qui donne envie de jouer maintenant.
	// ⚠ la fourchette « %d à %d » était composée à part puis versée dans un %s : une
	// sous-phrase française sans clé, donc intraduisible. Les bornes sont désormais des
	// arguments comme les autres.
	switch {
	case f.Fatal:
		add("threat", "☠️", true, "%d créatures aux portes — la prochaine vague (%d à %d contre %d de défense) emporterait la ville",
			f.Besieging, f.Min, f.Max, f.Defense)
	case f.AtRisk:
		add("threat", "⚠️", true, "%d créatures aux portes — la vague est estimée entre %d et %d : au pire, la ville tombe",
			f.Besieging, f.Min, f.Max)
	case f.Besieging > 0:
		add("threat", "⚔️", true, "%d créatures dans l'anneau — vague estimée entre %d et %d contre %d de défense (−%d à −%d PV)",
			f.Besieging, f.Min, f.Max, f.Defense, f.DamageMin, f.DamageMax)
	case f.DamageMax > 0:
		add("threat", "🌊", false, "Abords dégagés — la vague coûterait entre %d et %d PV", f.DamageMin, f.DamageMax)
	default:
		add("threat", "🛡️", false, "Abords dégagés — la ville encaissera la prochaine vague sans une égratignure")
	}
	// La tour de guet : ce qu'on gagnerait à monter observer. C'est une action
	// collective, donc l'ordre du jour la propose à tout le monde.
	if f.Tower == 0 {
		add("scout", "🔭", false, "Sans Tour de guet, la horde ne s'estime qu'à vue de nez — la bâtir affinerait chaque prévision")
	} else if f.Precision < 90 {
		add("scout", "🔭", false, "Tour niveau %d · %d observateur(s) · prévision fiable à %d%% — chaque joueur qui monte resserre la fourchette",
			f.Tower, f.Scouts, f.Precision)
	}

	// 1-bis. LA SOIF (thème désertique) : une contrainte de thème doit être ANNONCÉE,
	// sinon c'est une punition (RETENTION-PLAN.md §8, règle 4). On dit qui a soif ET où
	// se trouve l'eau, parce que sur cette carte elle ne coule pas de source.
	if g.Theme().Thirst {
		thirsty := 0
		for _, h := range g.Heroes {
			if h.HP > 0 && h.HasState(StateSoif) {
				thirsty++
			}
		}
		if thirsty > 0 {
			well := g.buildingByID("well")
			switch {
			case well != nil && well.Built && well.Capacity > 0:
				add("thirst", "💧", thirsty > len(g.Heroes)/2, "%d héros ont soif (−%d PA par jour) — le puits tient encore %d rations",
					thirsty, thirstPA, well.Capacity)
			default:
				add("thirst", "💧", true, "%d héros ont soif (−%d PA par jour) et le puits est à sec — il faut rapporter de l'eau",
					thirsty, thirstPA)
			}
		}
	}

	// 1-ter. LE FROID (thème nordique, cold.go) : les foyers brûlent du bois chaque
	// nuit. On DIT combien de nuits il reste, parce que c'est la seule façon d'arbitrer
	// entre chauffer et bâtir avant que la ville ne gèle.
	if g.Theme().Cold {
		fuel := 0
		for _, f := range hearthFuels {
			fuel += g.storageQty(f)
		}
		frozen := 0
		for _, h := range g.Heroes {
			if h.HP > 0 && h.HasState(StateGele) {
				frozen++
			}
		}
		switch {
		case fuel == 0:
			add("cold", "🔥", true, "Plus rien à brûler : la ville gèlera cette nuit (−%d PA pour tout le monde) — il faut rapporter du bois",
				coldPA)
		case fuel <= 3:
			add("cold", "🔥", true, "Les foyers n'ont plus que %d nuits de bois — le gel coûte %d PA par héros",
				fuel, coldPA)
		case frozen > 0:
			add("cold", "🥶", false, "%d héros ont pris le gel dehors (−%d PA) — les murs et la cachette abritent, le reste non",
				frozen, coldPA)
		}
	}

	// 2. Le portail ouvert : la plus grosse fuite de défense du jeu, et la moins chère
	// à colmater (1 PA).
	if b := g.buildingByID("gate"); b != nil && b.Built && b.Open {
		add("gate", "🚪", true, "Le portail est OUVERT — le fermer rend %d de défense", buildingLevelDefense(b))
	}

	// 3. Les remparts de la ville, quand elle saigne et qu'on a de quoi la soigner.
	if g.Town.HP < g.Town.MaxHP {
		stone := g.storageQty(TownRepairMaterial)
		missing := g.Town.MaxHP - g.Town.HP
		if stone > 0 {
			add("repair", "🧱", g.Town.HP*2 < g.Town.MaxHP, "La ville est à %d/%d PV — %d %s en Banque, soit %d PV à relever",
				g.Town.HP, g.Town.MaxHP, stone, Name(TownRepairMaterial), minInt(stone*TownRepairHP, missing))
		} else {
			add("repair", "🧱", true, "La ville est à %d/%d PV et il n'y a plus de %s pour relever les remparts",
				g.Town.HP, g.Town.MaxHP, Name(TownRepairMaterial))
		}
	}

	// 4. Un chantier ouvert qui attend des bras — de la main-d'œuvre déjà engagée.
	for _, b := range g.Town.Buildings {
		if !b.UnderConstruction {
			continue
		}
		if miss := g.missingFor(b.Cost.Materials); len(miss) > 0 {
			add("chantier", "⏸", false, "Chantier de %s en pause — il manque %s", Name(b.Label()), miss)
		} else {
			add("chantier", "🏗️", false, "Chantier de %s : %d/%d PA investis", Name(b.Label()), b.PaInvested, b.Cost.PA)
		}
		break // un seul rappel de chantier : l'ordre du jour n'est pas un inventaire
	}

	// 5. Ce qui manque pour la prochaine amélioration DÉFENSIVE — le progrès qui compte.
	for _, id := range botDefensiveOrder {
		b := g.buildingByID(id)
		if b == nil || !b.Built || b.UnderConstruction || b.Level >= MaxBuildingLevel {
			continue
		}
		if miss := g.missingFor(b.Cost.Materials); len(miss) > 0 {
			add("material", "⛏️", false, "%s niveau %d : il manque %s", Name(b.Label()), b.Level+1, miss)
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
			add("plan", "📐", false, "« %s » est en Banque — le chantier de %s peut s'ouvrir", Name(plan), Name(b.Label()))
			break
		}
	}

	// 7. Une défense usée : la défense est proportionnelle à la durabilité, donc un mur
	// à 60 % est 40 % de sa protection jetée.
	for _, id := range botDefensiveOrder {
		b := g.buildingByID(id)
		if b != nil && b.Built && b.MaxDurability > 0 && b.Durability*10 < b.MaxDurability*7 {
			add("wear", "🔧", false, "%s à %d%% — chaque PA de réparation rend de la défense",
				Name(b.Label()), 100*b.Durability/b.MaxDurability)
			break
		}
	}
	return out
}

// missingFor rend ce qui manque en Banque pour cette liste de matériaux, ou nil si tout
// est là.
//
// ⚠ elle rendait une PHRASE (« 6 Pierre, 2 Brique »). Composée ici, cette phrase
// arrivait au client en un bloc où ni les noms d'objets ni la virgule n'avaient plus de
// clé : intraduisible. Elle rend maintenant la liste, et c'est le client qui la met en
// forme (i18n.go, ItemList).
func (g *GameState) missingFor(mats []Item) ItemList {
	var miss ItemList
	for _, m := range mats {
		if short := m.Qty - g.storageQty(m.Name); short > 0 {
			miss = append(miss, Item{Type: m.Type, Name: m.Name, Qty: short})
		}
	}
	return miss
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
