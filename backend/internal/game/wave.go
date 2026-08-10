package game

import (
	"sort"
	"time"
)

// WaveInterval is the real-time delay between two horde waves (set from main via env).
var WaveInterval = 10 * time.Minute

// isDefensive reports whether a building contributes defense (per the design's
// building levels: wall/gate/tower carry a Defense value).
func isDefensive(id string) bool {
	lv := buildingLevelDef(id, 1)
	return lv != nil && lv.Defense > 0
}

// WaveHit records a durability/HP change applied to a building or hero during a wave.
type WaveHit struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Delta int    `json:"delta"` // negative
}

// WaveReport summarizes the outcome of one wave for the UI.
type WaveReport struct {
	Wave            int       `json:"wave"`
	Day             int       `json:"day"`
	HordePower      int       `json:"hordePower"`
	Defense         int       `json:"defense"`
	TownDamage      int       `json:"townDamage"`
	TownHPAfter     int       `json:"townHpAfter"`
	BuildingsHit    []WaveHit `json:"buildingsHit"`
	HeroesHit       []WaveHit `json:"heroesHit"`
	MonstersSpawned int       `json:"monstersSpawned"`
	MonstersSpent   int       `json:"monstersSpent"` // creatures broken on the walls during the assault
	At              time.Time `json:"at"`
	GameOver        bool      `json:"gameOver"`
}

// TownDefense computes the city's defense from its defensive buildings, scaled by
// durability (a broken wall barely protects).
// buildingDefense is one building's contribution to the town defense (0 if it isn't a
// defensive building, isn't built, or — for the Gate — is left open).
func buildingDefense(b *TownBuilding) int {
	if !b.Built {
		return 0
	}
	level := b.Level
	if level > MaxBuildingLevel {
		level = MaxBuildingLevel
	}
	lv := buildingLevelDef(b.ID, level)
	if lv == nil || lv.Defense == 0 {
		return 0
	}
	if b.ID == "gate" && b.Open {
		return 0
	}
	ratio := 1.0
	if b.MaxDurability > 0 {
		ratio = float64(b.Durability) / float64(b.MaxDurability)
	}
	return int(float64(lv.Defense) * ratio)
}

// buildingsDefense is what the STONE alone holds — walls, closed gate, tower.
func (g *GameState) buildingsDefense() int {
	def := 0
	for _, b := range g.Town.Buildings {
		def += buildingDefense(b)
	}
	return def
}

// LA GARNISON — les murs se tiennent, ils ne tiennent pas tout seuls.
//
// Pourquoi ce terme existe : la défense d'une ville était une pure fonction de ses
// BÂTIMENTS, plafonnée à 48 (muraille 20 + portail 16 + tour 12), qu'on soit trois
// héros ou soixante — pendant que la pression de la horde, elle, suit l'expédition
// (hordeScale). Mesuré : médianes de survie 15 · 14 · 14 · 16 · 17 · 19 vagues pour
// 1 · 2 · 4 · 8 · 12 · 20 joueurs. Vingt joueurs allaient à peine plus loin qu'un
// seul, et deux ou quatre allaient MOINS LOIN — ils héritaient d'une horde plus dure
// sans aucun moyen de bâtir plus haut. Un renfort ne servait à rien derrière le mur.
//
// Un héros présent dans les murs à l'instant où la horde frappe DÉFEND. C'est ce qui
// fait qu'une expédition nombreuse va plus loin, et c'est le dilemme de Hordes rendu à
// sa forme la plus simple : chaque héros rentré défend mais ne récolte pas ce tour-là.
//
// ⚠ PLAFONNÉ PAR LA PIERRE. La garnison ne peut pas dépasser ce que les bâtiments
// tiennent déjà : on ne défend que le rempart qu'on a bâti, et sans ce plafond
// soixante héros massés en ville rendraient la construction — donc le jeu — inutile.
// Le portail ouvert vaut 0 : il abaisse aussi le plafond, parce qu'une brèche ne se
// tient pas à mains nues.
func garrisonWeight(h *Hero) int {
	switch {
	case h.ClassID == "gardien":
		return 3 // sa raison d'être : il compte déjà pour trois face à un pack
	case h.ClassTier >= 1:
		return 2
	}
	return 1
}

// GarrisonDefense rend le nombre de héros aux remparts et ce qu'ils y ajoutent.
func (g *GameState) GarrisonDefense() (heroes, value int) {
	raw := 0
	for _, h := range g.HeroesInTown() {
		if h.HP <= 0 {
			continue
		}
		heroes++
		raw += garrisonWeight(h)
	}
	// LA CASERNE (bâtiment de spécialité) relève le PLAFOND sans donner un point de
	// défense par elle-même : c'est l'axe « tenir plus nombreux ». Une ville qui la bâtit
	// choisit d'employer ses gens plutôt que d'empiler de la pierre — et une expédition
	// de vingt en tire beaucoup plus qu'un solo, ce qui est exactement le but.
	cap := g.buildingsDefense()
	if c := g.buildingByID("caserne"); c != nil && c.Built && c.Durability > 0 {
		cap += casernePerLevel * c.Level
	}
	if raw > cap {
		raw = cap
	}
	return heroes, raw
}

// casernePerLevel : ce qu'un niveau de Caserne ajoute au PLAFOND de la garnison.
const casernePerLevel = 4

func (g *GameState) TownDefense() int {
	_, garrison := g.GarrisonDefense()
	return g.buildingsDefense() + garrison
}

// Recompute refreshes derived fields (town defense, hero "Tétanisé", building costs,
// Bank usage). Safe anytime.
func (g *GameState) Recompute() {
	g.backfillBuildings()
	g.Town.Garrison, g.Town.GarrisonValue = g.GarrisonDefense()
	g.Town.Defense = g.buildingsDefense() + g.Town.GarrisonValue
	g.recomputeTetanise()
	g.RevealVision() // grow the shared fog-of-war reveal set from current positions
	// Which in-town heroes have already drawn their daily water ration.
	drawn := g.Town.WaterDrawnToday[:0]
	for _, h := range g.HeroesInTown() {
		if h.DrewWaterDay == g.Day {
			drawn = append(drawn, h.ID)
		}
	}
	g.Town.WaterDrawnToday = drawn
	total := 0
	for _, it := range g.Town.Storage {
		total += it.Qty
	}
	for _, b := range g.Town.Buildings {
		b.Cost = g.buildingCost(b)
		b.Requires = BuildingDesigns[b.ID].Requires
		b.Defense = buildingDefense(b)
		if b.ID == "bank" {
			b.Capacity = total // the Bank's "contents" = the town storage
		}
	}
	// EN DERNIER : l'ordre du jour lit les coûts qu'on vient de recalculer (matériaux
	// manquants, plans, chantiers). Le placer plus haut le ferait travailler sur les
	// coûts de la vague précédente.
	g.trimRequests()
	g.Town.Forecast = g.Forecast()
	g.Town.Orders = g.BuildOrders()
}

// backfillBuildings adds any building the catalog gained since a game was created.
// DefaultBuildings() only ever runs at worldgen, so a town saved before a building
// existed would never see it — buildingByID returns nil forever and the site is
// simply missing from the Structure tab. Appending the missing entries AT THEIR
// PRISTINE STATE (a construction site) makes every new building reach games in
// flight. Existing buildings are never touched and never reordered.
func (g *GameState) backfillBuildings() {
	have := make(map[string]bool, len(g.Town.Buildings))
	for _, b := range g.Town.Buildings {
		have[b.ID] = true
	}
	for _, def := range DefaultBuildings() {
		if !have[def.ID] {
			g.Town.Buildings = append(g.Town.Buildings, def)
		}
	}
}

// heroesPerPack: how many monsters one hero can "hold" before being overwhelmed.
// GDD: joueurs requis = monstres ÷ 4. A Gardien (advanced class) counts for 3 heroes.
const heroesPerPack = 4

// gardienWeight returns how many "heroes" a hero counts as when holding back a pack.
func gardienWeight(h *Hero) int {
	if h.ClassID == "gardien" {
		return 3
	}
	return 1
}

// recomputeTetanise sets/clears the "Tétanisé" state: a hero is stuck (no movement)
// when standing on a tile with 2+ monsters and there aren't enough heroes to hold the
// pack (effectivePlayers < ceil(monsters / heroesPerPack)).
func (g *GameState) recomputeTetanise() {
	type key struct{ x, y int }
	players := map[key]int{}
	for _, h := range g.Heroes {
		if h.HP > 0 {
			players[key{h.X, h.Y}] += gardienWeight(h)
		}
	}
	for _, h := range g.Heroes {
		stuck := false
		if h.HP > 0 {
			if t := g.TileAt(h.X, h.Y); t != nil && t.MonsterID != "" {
				if m := g.Monsters[t.MonsterID]; m != nil && m.Count >= 2 {
					required := (m.Count + heroesPerPack - 1) / heroesPerPack
					if players[key{h.X, h.Y}] < required {
						stuck = true
					}
				}
			}
		}
		if stuck {
			h.AddState(StateTetanise)
		} else {
			h.RemoveState(StateTetanise)
		}
	}
}

// LA PUISSANCE DE LA HORDE — ce que les joueurs peuvent y changer.
//
// Elle a deux termes, et la distinction est TOUT le design :
//
//	pression  — un plancher qui monte avec les vagues, quoi qu'on fasse. Le monde se
//	            dégrade ; on ne gagne pas, on tient plus ou moins longtemps.
//	assaut    — les créatures RÉELLEMENT massées aux abords de la ville au moment où
//	            la horde frappe. Ce terme-là, on le fait baisser en tuant.
//
// Avant, la puissance était une pure fonction du numéro de vague : nettoyer les
// approches ne retirait pas un seul point de dégâts, donc le combat ne servait qu'au
// butin. Une expédition de vingt joueurs ne pouvait pas non plus aller plus loin qu'un
// solo — le plafond de défense (muraille + portail + tour) est le même à trois héros
// qu'à soixante, donc l'arithmétique garantissait l'inverse de ce qu'on veut. En liant
// l'assaut aux packs présents, l'effectif se convertit enfin en survie : plus de héros,
// plus de packs abattus avant qu'ils n'atteignent les murs, moins de dégâts.
//
// Les packs qui ont porté l'assaut s'y brisent (spendAssaultingPacks) : ils frappent
// une fois, et le calcul se fait AVANT qu'ils ne soient retirés.
const (
	hordeBase        = 6 // pression de départ
	hordeGrowth      = 2 // pression ajoutée par vague (plancher incompressible)
	assaultRadius    = 2 // rayon de Chebyshev où un pack « touche » la ville
	assaultPerAttack = 1 // dégâts apportés par créature massée aux abords
)

// besiegingCreatures compte les créatures massées dans le rayon d'assaut de la ville.
// C'est la partie de la horde que les joueurs contrôlent : chacune abattue (combat,
// compétence de carte) est un point de puissance en moins à la prochaine vague.
func (g *GameState) besiegingCreatures() int {
	n := 0
	for _, m := range g.Monsters {
		if m == nil {
			continue
		}
		if absI(m.X-g.Town.X) <= assaultRadius && absI(m.Y-g.Town.Y) <= assaultRadius {
			n += m.Count
		}
	}
	return n
}

// hordeScale pondère la PRESSION (pas l'assaut) par la taille de l'expédition. Elle
// reste douce : le gros de la difficulté d'une grande partie vient désormais du nombre
// de packs semés sur une carte plus grande, donc de l'assaut — que les joueurs peuvent
// combattre. On compte les héros TOTAUX (morts inclus), sinon perdre des héros
// allégerait la horde.
// expeditionTeams: le nombre d'équipes de l'expédition, morts inclus — sinon perdre
// des héros allégerait la horde. Un joueur qui rejoint en cours de partie (fenêtre
// d'accueil des parties publiques) le fait monter, et le niveau avec.
func (g *GameState) expeditionTeams() int {
	teams := len(g.Heroes) / HeroesPerPlayer
	if teams < 1 {
		teams = 1
	}
	return teams
}

// hordeKnee : au-delà de ce nombre d'équipes, la pression de la horde ne suit plus
// l'expédition au même rythme.
//
// Pourquoi un genou et pas une droite : la CAPACITÉ d'une ville sature. Sa défense
// vaut au plus deux fois ce que ses bâtiments tiennent (garnison plafonnée, cf.
// GarrisonDefense), et ces bâtiments ont les mêmes trois niveaux qu'on soit trois
// héros ou soixante. Une pression strictement proportionnelle finissait donc par
// dépasser un plafond qui, lui, ne bougeait pas : mesuré, une expédition de vingt
// tombait à la vague 20 quand une de douze tenait jusqu'à 21 — l'inverse de la règle
// qu'on veut (plus nombreux = plus loin). Au-delà du genou, une équipe de plus apporte
// donc encore de la difficulté, mais à taux réduit.
const hordeKnee = 8

func (g *GameState) hordeScale() float64 {
	teams := float64(g.expeditionTeams())
	if teams > hordeKnee {
		teams = hordeKnee + (teams-hordeKnee)*0.6
	}
	return (6 + teams) / 10.0
}

// hordePower assemble les deux termes pour la vague qui frappe maintenant.
func hordePower(waveNumber int, scale float64, besieging int) int {
	pressure := float64(hordeBase+waveNumber*hordeGrowth) * scale
	p := int(pressure) + besieging*assaultPerAttack + randIntn(4)
	if p < 1 {
		p = 1
	}
	return p
}

// ProcessWave resolves a single horde assault on the town. It does NOT schedule the
// next wave — callers (ForceWave / CatchUpWaves) own NextWaveAt.
func (g *GameState) ProcessWave(now time.Time) {
	g.processWave(now, false)
}

// processWave resolves a single horde assault. When safeTown is true (dev cheat
// "pass the wave without town damage"), the town HP and every building's
// durability are left untouched — the wave still advances (day/wave counters,
// PA regen, migration, fresh spawns) so it behaves like a harmless skip.
func (g *GameState) processWave(now time.Time, safeTown bool) {
	if g.Status != "active" {
		return
	}
	g.WaveNumber++
	g.Wave++
	if g.Wave >= 2 {
		g.Wave = 0
		g.Day++
	}

	besieging := g.besiegingCreatures()
	power := hordePower(g.WaveNumber, g.hordeScale(), besieging)
	defense := g.TownDefense()

	// Slices INITIALISÉES : nil se sérialise en `null`, pas en `[]`, et le client
	// lit `buildingsHit.length` — une vague qui n'abîme rien (le cas courant) lui
	// faisait donc lever une TypeError. Le type annoncé est un tableau : qu'il en
	// soit toujours un.
	r := &WaveReport{
		Wave: g.WaveNumber, Day: g.Day, HordePower: power, Defense: defense, At: now,
		BuildingsHit: []WaveHit{}, HeroesHit: []WaveHit{},
	}

	if !safeTown {
		// Defensive structures absorb the blow, wearing down in the process.
		absorbed := power
		if absorbed > defense {
			absorbed = defense
		}
		g.wearDefensiveBuildings(absorbed, r)

		// Whatever the defenses can't stop hits the town (and some buildings).
		overflow := power - defense
		if overflow < 0 {
			overflow = 0
		}
		if overflow > 0 {
			g.Town.HP -= overflow
			if g.Town.HP < 0 {
				g.Town.HP = 0
			}
			r.TownDamage = overflow
			g.damageRandomBuildings(overflow, r)
		}
	}
	r.TownHPAfter = g.Town.HP

	// LES CONSIGNES, au dernier moment : un joueur absent a laissé une intention, elle
	// s'exécute juste avant que la horde frappe — donc après que la ville a encaissé,
	// mais avant que les héros dehors soient pris à partie.
	g.runStandingOrders()

	// Heroes caught outside the walls are attacked individually.
	g.attackHeroesOutside(g.WaveNumber, r)

	// A new half-day begins: surviving heroes recover their action points.
	for _, h := range g.Heroes {
		if h.HP > 0 {
			h.PA = h.MaxPA
			h.RemoveState(StateFatigue)
			h.RemoveState(StateTetanise)
		}
	}

	// Les observateurs de la tour valaient pour LA vague qui vient de frapper : la
	// suivante est une autre horde, et il faudra remonter voir.
	g.Town.Scouts = nil

	// LE VERGER (bâtiment de spécialité) regarnit quelques cases autour de la ville.
	// C'est l'axe « durer » : CLAUDE.md le dit depuis longtemps, ce qui borne vraiment
	// une longue partie n'est pas l'arithmétique de la horde mais l'ÉPUISEMENT DE LA
	// CARTE — les cases proches se vident, les héros marchent de plus en plus loin, et
	// la ville s'étrangle sans que rien ne l'ait attaquée.
	g.regrowOrchard()

	// The Well slowly refills between waves.
	if w := g.buildingByID("well"); w != nil && w.Built && w.Capacity < w.MaxCapacity {
		w.Capacity += 10
		if w.Capacity > w.MaxCapacity {
			w.Capacity = w.MaxCapacity
		}
	}

	// The packs that reached the walls THROW THEMSELVES AT THEM and are spent: that is
	// what the assault this report describes actually is. Without it nothing ever
	// removed a pack that finished its migration, so the ring around the town silted up
	// wave after wave — measured: 130 packs and 660 creatures by wave 12, the town
	// completely encircled, heroes unable to walk home with their load and the horde
	// growing whether or not anyone fought it. The wave's damage is hordePower either
	// way; this only stops the map from turning to concrete.
	r.MonstersSpent = g.spendAssaultingPacks()

	// Surviving packs close in on the town by one step before the fresh horde spawns.
	g.migrateMonstersTowardTown()

	// The horde grows: new monsters appear on the map (far out, then they migrate in).
	r.MonstersSpawned = g.spawnWaveMonsters(g.WaveNumber)

	if g.Town.HP <= 0 {
		g.Status = "gameover"
		r.GameOver = true
	}

	g.LastWave = r
	g.Recompute()
}

// ForceWave triggers a wave immediately (used by the dev "advance" endpoint).
func (g *GameState) ForceWave(now time.Time) {
	if g.Status != "active" {
		return
	}
	g.ProcessWave(now)
	g.NextWaveAt = now.Add(WaveInterval)
}

// ForceWaveSafe triggers a wave immediately WITHOUT any town damage (dev cheat):
// the horde advances, spawns and migrates, but the town HP and buildings are spared.
func (g *GameState) ForceWaveSafe(now time.Time) {
	if g.Status != "active" {
		return
	}
	g.processWave(now, true)
	g.NextWaveAt = now.Add(WaveInterval)
}

// CatchUpWaves processes every wave whose time has passed, WITHOUT running the bot
// players. C'est le rattrapage des vagues seul ; le rattrapage complet (vagues ET
// joueurs-IA, entrelacés dans l'ordre) est AdvanceTo (sim.go) — c'est lui qu'utilisent
// le battement et les requêtes. Renvoie true si l'état a changé.
func (g *GameState) CatchUpWaves(now time.Time) bool {
	return g.AdvanceTo(now, SimBudget{Waves: RequestBudget.Waves}).Changed
}

func (g *GameState) wearDefensiveBuildings(absorbed int, r *WaveReport) {
	if absorbed <= 0 {
		return
	}
	var def []*TownBuilding
	for _, b := range g.Town.Buildings {
		if isDefensive(b.ID) && b.Built && b.Durability > 0 {
			def = append(def, b)
		}
	}
	if len(def) == 0 {
		return
	}
	per := absorbed / (len(def) * 2)
	if per < 1 {
		per = 1
	}
	for _, b := range def {
		before := b.Durability
		b.Durability -= per
		if b.Durability < 0 {
			b.Durability = 0
		}
		if b.Durability != before {
			r.BuildingsHit = append(r.BuildingsHit, WaveHit{b.ID, b.Name, b.Durability - before})
		}
	}
}

func (g *GameState) damageRandomBuildings(overflow int, r *WaveReport) {
	var others []*TownBuilding
	for _, b := range g.Town.Buildings {
		if !isDefensive(b.ID) && b.Built && b.Durability > 0 {
			others = append(others, b)
		}
	}
	if len(others) == 0 {
		return
	}
	hits := 1 + overflow/15
	for i := 0; i < hits; i++ {
		b := others[randIntn(len(others))]
		before := b.Durability
		b.Durability -= 5 + randIntn(10)
		if b.Durability < 0 {
			b.Durability = 0
		}
		if b.Durability != before {
			r.BuildingsHit = append(r.BuildingsHit, WaveHit{b.ID, b.Name, b.Durability - before})
		}
	}
}

func (g *GameState) attackHeroesOutside(waveNumber int, r *WaveReport) {
	for _, h := range g.Heroes {
		if h.HP <= 0 || (h.X == g.Town.X && h.Y == g.Town.Y) {
			continue // dead or safely in town
		}
		if h.HasState("Caché") {
			h.RemoveState("Caché") // concealment saves them this wave, then fades
			continue
		}
		dmg := 3 + waveNumber + randIntn(4)
		if t := g.TileAt(h.X, h.Y); t != nil && t.MonsterID != "" {
			dmg += 4 // monsters already on the hero's tile pile on
		}
		before := h.HP
		h.HP -= dmg
		if h.HP < 0 {
			h.HP = 0
		}
		h.AddState("Blessé")
		r.HeroesHit = append(r.HeroesHit, WaveHit{h.ID, h.Name, h.HP - before})
	}
}

// bossWaveThreshold: bosses (Roi Gobelin, Arbre Vivant Ancien) only join the spawn
// pool once the horde has grown for a few waves.
const bossWaveThreshold = 4

func (g *GameState) spawnWaveMonsters(waveNumber int) int {
	// Le nombre de packs posés croît SANS PLAFOND avec la vague (retour : la horde
	// doit scaler à l'infini). En pratique la saturation des tuiles praticables borne
	// naturellement le nombre de packs ; la taille des packs, elle, grandit sans borne
	// (spawnWeightedPack) — c'est ce qui rend l'intensification réellement infinie.
	// Le renfort par vague ne dépend PAS de l'effectif, et c'est délibéré. L'expédition
	// pèse déjà sur la horde à deux endroits (la pression via hordeScale, le semis
	// initial via SeedStartingMonsters) ; l'y faire peser une troisième fois aplatissait
	// entièrement l'avantage du nombre — mesuré, la courbe de survie devenait plate de 1
	// à 20 joueurs. Et sur un jeu coopératif, accueillir quelqu'un ne doit pas empirer la
	// situation de ceux qui sont déjà là : une arrivée apporte trois héros contre environ
	// un point de pression, donc elle AIDE, ce qui est le seul réglage acceptable pour
	// une fenêtre d'accueil.
	count := 4 + waveNumber
	includeBosses := waveNumber >= bossWaveThreshold
	// Apparition PONDÉRÉE (loin de la ville / près des ruines / croissant par vague) —
	// voir spawnChance/spawnWeightedPack. Les nouveaux packs naissent au loin puis
	// se rapprochent vague après vague (migrateMonstersTowardTown).
	spawned := 0
	for i := 0; i < count; i++ {
		if g.spawnWeightedPackWithin(waveNumber, includeBosses, hordeFrontRadius) {
			spawned++
		}
	}
	return spawned
}

// spendAssaultingPacks removes the packs standing ON the town's doorstep (the eight
// tiles around it): they are the ones that just charged the walls, and the assault
// consumes them. Packs held in an active combat are left alone — they belong to that
// fight. Returns how many creatures were spent.
//
// This is the horde's only natural attrition. It bounds the standing population near
// the town (each wave clears at most the ring) without touching the growth of the
// horde further out, so the pressure keeps rising while the approaches stay walkable.
func (g *GameState) spendAssaultingPacks() int {
	busy := map[[2]int]bool{}
	for _, c := range g.Combats {
		if c.Status == "active" {
			busy[[2]int{c.TileX, c.TileY}] = true
		}
	}
	spent := 0
	for id, m := range g.Monsters {
		if m == nil || busy[[2]int{m.X, m.Y}] {
			continue
		}
		if absI(m.X-g.Town.X) > assaultRadius || absI(m.Y-g.Town.Y) > assaultRadius {
			continue // not at the walls yet
		}
		if t := g.TileAt(m.X, m.Y); t != nil && t.MonsterID == id {
			t.MonsterID = ""
		}
		spent += m.Count
		delete(g.Monsters, id)
	}
	return spent
}

// migrateMonstersTowardTown fait AVANCER chaque pack survivant d'un pas vers la
// ville à chaque vague (règle : les monstres non tués se rapprochent). Un pack en
// plein combat reste sur place. Les monstres n'occupent jamais la case ville
// elle-même — ils encerclent ses abords. Quand le pas vers la ville est BLOQUÉ par
// un autre pack (aucune case libre plus proche), les deux packs **fusionnent** : ils
// se retrouvent sur la même case et forment un seul pack plus gros (le groupe le plus
// nombreux impose son espèce), ce qui consolide la horde à mesure qu'elle converge.
func (g *GameState) migrateMonstersTowardTown() {
	busy := map[[2]int]bool{} // cases d'un combat actif : ne pas déplacer/fusionner leurs monstres
	for _, c := range g.Combats {
		if c.Status == "active" {
			busy[[2]int{c.TileX, c.TileY}] = true
		}
	}
	// Snapshot des IDs : on supprime des packs (fusion) en cours de route, et chaque
	// pack ne joue qu'UNE fois par vague (acted) — un survivant de fusion ne rebouge pas.
	//
	// L'ordre est TRIÉ, pas celui de la map : deux packs qui se disputent la même case
	// fusionnent différemment selon qui avance en premier, donc l'ordre d'itération
	// aléatoire de Go rendait une vague non reproductible. C'est faux pour un jeu dont
	// toute l'architecture est « rejouer le temps écoulé » (sim.go) — deux instances
	// rejouant la même période doivent aboutir au même monde — et ça rendait la
	// simulation d'équilibrage incapable de répondre deux fois pareil à la même graine
	// (mesuré : même seed, chute vague 13 ou vague 19 selon le tirage).
	// Trié par POSITION, pas par identifiant : les id sont des UUID tirés au hasard, donc
	// les trier ne fixe rien. Une case ne porte qu'un pack (Tile.MonsterID), donc (Y,X)
	// est un ordre total et stable d'une exécution à l'autre.
	ids := make([]string, 0, len(g.Monsters))
	for id := range g.Monsters {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		a, b := g.Monsters[ids[i]], g.Monsters[ids[j]]
		if a.Y != b.Y {
			return a.Y < b.Y
		}
		return a.X < b.X
	})
	acted := map[string]bool{}
	for _, id := range ids {
		m := g.Monsters[id]
		if m == nil || acted[id] || busy[[2]int{m.X, m.Y}] {
			continue
		}
		dx, dy := signI(g.Town.X-m.X), signI(g.Town.Y-m.Y)
		if dx == 0 && dy == 0 {
			continue
		}
		var mergeInto *Monster // premier pack rencontré sur un pas praticable vers la ville
		moved := false
		for _, step := range [][2]int{{dx, dy}, {dx, 0}, {0, dy}} {
			if step[0] == 0 && step[1] == 0 {
				continue
			}
			nx, ny := m.X+step[0], m.Y+step[1]
			if nx == g.Town.X && ny == g.Town.Y {
				continue // s'agglutiner autour, pas SUR la ville
			}
			t := g.TileAt(nx, ny)
			if t == nil || !t.Biome.Walkable() {
				continue
			}
			if t.MonsterID == "" {
				// case libre : on avance dessus (priorité à l'étalement vers la ville).
				if old := g.TileAt(m.X, m.Y); old != nil && old.MonsterID == m.ID {
					old.MonsterID = ""
				}
				m.X, m.Y = nx, ny
				t.MonsterID = m.ID
				moved = true
				break
			}
			// case occupée par un AUTRE pack (pas en combat) : candidat à la fusion.
			if mergeInto == nil {
				if other := g.Monsters[t.MonsterID]; other != nil && other.ID != m.ID &&
					!acted[other.ID] && !busy[[2]int{other.X, other.Y}] {
					mergeInto = other
				}
			}
		}
		if moved {
			acted[m.ID] = true
			continue
		}
		// Aucune case libre plus proche : si un pas vers la ville butait sur un pack,
		// les deux fusionnent (le mobile disparaît dans le pack cible resté en place).
		if mergeInto != nil {
			g.mergePacks(mergeInto, m)
			acted[mergeInto.ID] = true
			acted[m.ID] = true
		}
	}
}

// mergePacks fusionne le pack `gone` (qui avançait) DANS le pack `keep` (déjà en
// place, sur sa case) : les effectifs s'additionnent et le groupe le PLUS NOMBREUX
// impose son espèce/apparence/stats/PV au pack fusionné. `gone` est retiré de la
// carte et du registre.
func (g *GameState) mergePacks(keep, gone *Monster) {
	if gone.Count > keep.Count {
		keep.Species = gone.Species
		keep.Appearance = gone.Appearance
		keep.Stats = gone.Stats
		keep.HP = gone.HP
		keep.MaxHP = gone.MaxHP
	}
	keep.Count += gone.Count
	if old := g.TileAt(gone.X, gone.Y); old != nil && old.MonsterID == gone.ID {
		old.MonsterID = ""
	}
	delete(g.Monsters, gone.ID)
}

// orchardRadius : la portée du Verger. Volontairement COURTE — il nourrit les abords du
// bourg, il ne remet pas la carte à neuf. Aller chercher loin reste le métier des héros.
const orchardRadius = 4

// regrowOrchard rend une ressource à quelques cases fouillables proches de la ville, en
// commençant par les plus PAUVRES : un verger sert à rouvrir des cases mortes, pas à
// engraisser celles qui donnent encore.
func (g *GameState) regrowOrchard() {
	b := g.buildingByID("verger")
	if b == nil || !b.Built || b.Durability <= 0 {
		return
	}
	budget := 2 * b.Level
	type cell struct{ x, y, res int }
	var cands []cell
	for dy := -orchardRadius; dy <= orchardRadius; dy++ {
		for dx := -orchardRadius; dx <= orchardRadius; dx++ {
			x, y := g.Town.X+dx, g.Town.Y+dy
			if x == g.Town.X && y == g.Town.Y {
				continue // la case ville n'est pas fouillable
			}
			t := g.TileAt(x, y)
			if t == nil || !t.Biome.Walkable() {
				continue
			}
			if td, ok := Terrains[t.Biome]; !ok || !td.Searchable {
				continue
			}
			if t.Resources >= orchardCap {
				continue
			}
			cands = append(cands, cell{x, y, t.Resources})
		}
	}
	// Tri par pauvreté puis par POSITION : l'ordre doit être total et stable, sinon deux
	// instances rejouant la même vague ne regarniraient pas les mêmes cases (cf. la règle
	// « ordre d'itération = état » de CLAUDE.md).
	sort.Slice(cands, func(i, j int) bool {
		if cands[i].res != cands[j].res {
			return cands[i].res < cands[j].res
		}
		if cands[i].y != cands[j].y {
			return cands[i].y < cands[j].y
		}
		return cands[i].x < cands[j].x
	})
	for i := 0; i < len(cands) && i < budget; i++ {
		if t := g.TileAt(cands[i].x, cands[i].y); t != nil {
			t.Resources++
		}
	}
}

// orchardCap : le Verger ne pousse pas une case au-delà de ce seuil — il ressuscite les
// cases mortes, il ne fabrique pas une mine inépuisable au pied des murs.
const orchardCap = 4
