package game

import (
	"math/rand"
	"time"
)

// Map-level state names used by the slice.
const (
	StateFatigue  = "Fatigue"
	StateSoif     = "Soif"
	StateTetanise = "Tétanisé"
	StateCache    = "Caché"
)

// depletedFindPct: chance (%) qu'une case ÉPUISÉE rende encore une vraie ressource
// (sinon des débris) — assez bas pour rendre les cases fraîches nettement meilleures.
const depletedFindPct = 25

// ActionError is a player-facing rejection of a map action.
type ActionError struct{ Msg string }

func (e ActionError) Error() string { return e.Msg }

// heroInCombat returns the ACTIVE combat this hero is fighting in (a hero unit
// still in battle), or nil. Map actions are blocked only for heroes actually in
// a combat — a combat NO LONGER freezes every other player (2026-07-20).
func (g *GameState) heroInCombat(heroID string) *Combat {
	for _, c := range g.Combats {
		if c.Status != "active" {
			continue
		}
		for _, u := range c.Units {
			if u.Side == "hero" && u.RefID == heroID && u.inBattle() {
				return c
			}
		}
	}
	return nil
}

// GateClosed reports whether the town gate blocks passage: a BUILT, closed gate
// seals the town — nobody walks in or out (Hordes-style: opening it is a town
// action, and an open gate contributes zero defense). No gate / unbuilt gate =
// a gap in the wall, free passage.
func (g *GameState) GateClosed() bool {
	for _, b := range g.Town.Buildings {
		if b.ID == "gate" {
			return b.Built && !b.Open
		}
	}
	return false
}

// MoveHero moves a hero by one orthogonal step, spending 1 PA.
func (g *GameState) MoveHero(heroID string, dx, dy int) error {
	if g.heroInCombat(heroID) != nil {
		return ActionError{"ce héros est en plein combat"}
	}
	h := g.HeroByID(heroID)
	if h == nil {
		return ActionError{"héros introuvable"}
	}
	if absI(dx)+absI(dy) != 1 {
		return ActionError{"déplacement invalide (une case orthogonale)"}
	}
	if h.HasState(StateTetanise) {
		return ActionError{h.Name + " est tétanisé et ne peut pas bouger"}
	}
	if h.PA <= 0 {
		return ActionError{h.Name + " n'a plus de point d'action"}
	}
	nx, ny := h.X+dx, h.Y+dy
	t := g.TileAt(nx, ny)
	if t == nil {
		return ActionError{"case inaccessible"}
	}
	if !t.Biome.Walkable() {
		// Eau SOUS LE BROUILLARD (exploration au contact) : le héros s'avance,
		// paie son PA et DÉCOUVRE l'eau… mais reste sur sa case. Une fois l'eau
		// connue, le client masque la destination et le serveur refuse gratis.
		if !t.Discovered {
			h.PA--
			h.Bars["athletisme"]++
			h.RemoveState("Caché") // il a bougé à découvert
			h.StopForaging()       // il a quitté son poste, même sans changer de case
			t.Discovered = true
			if h.PA == 0 {
				h.AddState(StateFatigue)
			}
			return nil
		}
		return ActionError{"case inaccessible"}
	}
	// A built, closed gate seals the town in BOTH directions.
	if g.GateClosed() {
		if nx == g.Town.X && ny == g.Town.Y {
			return ActionError{"la porte de la ville est fermée — impossible d'entrer"}
		}
		if h.X == g.Town.X && h.Y == g.Town.Y {
			return ActionError{"la porte de la ville est fermée — impossible de sortir"}
		}
	}
	h.X, h.Y = nx, ny
	h.PA--
	h.Bars["athletisme"]++
	h.RemoveState("Caché") // moving breaks concealment
	h.StopForaging()       // on ne récolte plus la case qu'on vient de quitter
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	return nil
}

// HideHero conceals a hero on their current tile. A hidden hero is skipped by the next
// wave's attack (concealment is then consumed). Costs 1 PA.
func (g *GameState) HideHero(heroID string) error {
	if g.heroInCombat(heroID) != nil {
		return ActionError{"ce héros est en plein combat"}
	}
	h := g.HeroByID(heroID)
	if h == nil {
		return ActionError{"héros introuvable"}
	}
	// Pointless AND confusing on the town tile: the wave already spares in-town
	// heroes, hiding is for the wilds.
	if h.X == g.Town.X && h.Y == g.Town.Y {
		return ActionError{"inutile de se cacher en ville — la ville protège déjà ses habitants"}
	}
	// A hero pinned by a pack (Tétanisé) can't slip away to hide: the monsters
	// hold them. Break free first (kill/thin the pack, or Escape).
	if h.HasState(StateTetanise) {
		return ActionError{h.Name + " est tétanisé — impossible de se cacher sous les griffes de la horde"}
	}
	if h.PA <= 0 {
		return ActionError{h.Name + " n'a plus de point d'action"}
	}
	h.PA--
	h.Bars["athletisme"]++
	h.AddState("Caché")
	h.StopForaging() // se terrer et fouiller bruyamment s'excluent
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	return nil
}

// EscapeHero retreats one step toward town; 25% chance to stumble (Blessé) and stay
// put. Costs 1 PA.
func (g *GameState) EscapeHero(heroID string) error {
	if g.heroInCombat(heroID) != nil {
		return ActionError{"ce héros est en plein combat"}
	}
	h := g.HeroByID(heroID)
	if h == nil {
		return ActionError{"héros introuvable"}
	}
	if h.PA <= 0 {
		return ActionError{h.Name + " n'a plus de point d'action"}
	}
	h.PA--
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	if rand.Intn(100) < 25 {
		h.AddState("Blessé") // stumbled
		return nil
	}
	dx, dy := 0, 0
	if g.Town.X > h.X {
		dx = 1
	} else if g.Town.X < h.X {
		dx = -1
	}
	if g.Town.Y > h.Y {
		dy = 1
	} else if g.Town.Y < h.Y {
		dy = -1
	}
	order := [][2]int{{dx, 0}, {0, dy}}
	if absI(g.Town.Y-h.Y) > absI(g.Town.X-h.X) {
		order = [][2]int{{0, dy}, {dx, 0}}
	}
	for _, d := range order {
		if d[0] == 0 && d[1] == 0 {
			continue
		}
		nx, ny := h.X+d[0], h.Y+d[1]
		// A closed gate also stops a retreating hero at the walls: the escape step
		// may not END on the town tile (retreat along the other axis instead).
		if g.GateClosed() && nx == g.Town.X && ny == g.Town.Y {
			continue
		}
		if t := g.TileAt(nx, ny); t != nil && t.Biome.Walkable() {
			h.X, h.Y = nx, ny
			h.RemoveState("Caché")
			h.StopForaging()
			break
		}
	}
	return nil
}

// SearchTile performs a fouille on the hero's current tile, spending 1 PA and
// possibly yielding loot whose type depends on the biome.
func (g *GameState) SearchTile(heroID string) (*Item, error) {
	if g.heroInCombat(heroID) != nil {
		return nil, ActionError{"ce héros est en plein combat"}
	}
	h := g.HeroByID(heroID)
	if h == nil {
		return nil, ActionError{"héros introuvable"}
	}
	if h.PA <= 0 {
		return nil, ActionError{h.Name + " n'a plus de point d'action"}
	}
	// A hero pinned by a pack (Tétanisé) fights for their life — no digging around.
	if h.HasState(StateTetanise) {
		return nil, ActionError{h.Name + " est tétanisé — impossible de fouiller sous les griffes de la horde"}
	}
	// The town tile is not searchable (its resources are zeroed at worldgen; town
	// loot lives in the Bank, not under the plaza).
	if h.X == g.Town.X && h.Y == g.Town.Y {
		return nil, ActionError{"rien à fouiller en ville — le stock est à la Banque"}
	}
	t := g.TileAt(h.X, h.Y)
	if t == nil {
		return nil, ActionError{"case invalide"}
	}
	td, ok := Terrains[t.Biome]
	if !ok || !td.Searchable {
		return nil, ActionError{"ce terrain n'a rien à fouiller"}
	}
	h.PA--
	h.Bars["collecte"]++
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	it := g.searchLoot(h, t, td)
	if it == nil {
		return nil, ActionError{"rien trouvé"}
	}
	// Le PA payé ici ouvre la FOUILLE AUTOMATIQUE : le héros reste sur place et
	// continue de fouiller tout seul (voir forage.go).
	h.ForageAt = time.Now().Add(ForageInterval())
	return it, nil
}

// searchLoot tire le butin d'une fouille et le range dans le sac : épuisement de
// la case, table pondérée du terrain, passifs de récolte des classes. Partagé par
// la fouille MANUELLE (qui paie 1 PA) et la fouille AUTOMATIQUE (gratuite) — les
// deux doivent rendre exactement la même chose.
func (g *GameState) searchLoot(h *Hero, t *Tile, td TerrainDef) *Item {
	// ÉPUISEMENT : une case n'est riche que `Resources` fouilles ; ensuite elle ne
	// rend plus grand chose — le plus souvent des débris, et seulement de temps en
	// temps une vraie ressource — ce qui pousse à explorer des cases fraîches.
	if t.Resources <= 0 {
		if rand.Intn(100) >= depletedFindPct {
			it := Item{Type: "objet", Name: "Débris", Qty: 1}
			h.AddLoot(it)
			return &it
		}
		// coup de chance : une dernière ressource traîne encore
	} else {
		t.Resources--
	}
	d := weightedDrop(td.Drops)
	if d == nil {
		return nil
	}
	it := Item{Type: d.Type, Name: d.Name, Qty: d.Qty}
	// Class harvest passives: Récupérateur carries +1 of anything it digs up;
	// Herboriste & Minéral guarantees +1 on plants and ores.
	if h.ClassID == "recuperateur" {
		it.Qty++
	}
	if h.ClassID == "herboriste" && (it.Type == "plante" || it.Type == "minerai") {
		it.Qty++
	}
	h.AddLoot(it)
	return &it
}

// RationPA is the action points a Ration d'eau restores when drunk on the map.
const RationPA = 6

// DrinkRation lets a hero drink a Ration d'eau FROM THEIR OWN BAG on the map to
// restore RationPA action points (capped at MaxPA), clearing Fatigue and Soif.
// It does not cost PA — it's the way to keep exploring once out of moves.
func (g *GameState) DrinkRation(heroID string) (*Hero, error) {
	if g.heroInCombat(heroID) != nil {
		return nil, ActionError{"ce héros est en plein combat"}
	}
	h := g.HeroByID(heroID)
	if h == nil {
		return nil, ActionError{"héros introuvable"}
	}
	if heroItemQty(h, "Ration d'eau") < 1 {
		return nil, ActionError{h.Name + " n'a pas de ration d'eau dans son sac"}
	}
	if h.PA >= h.MaxPA {
		return nil, ActionError{h.Name + " a déjà tous ses points d'action"}
	}
	removeHeroItem(h, "Ration d'eau", 1)
	h.PA += RationPA
	if h.PA > h.MaxPA {
		h.PA = h.MaxPA
	}
	h.RemoveState(StateFatigue)
	h.RemoveState(StateSoif)
	return h, nil
}

// Advance moves the game forward half a day: regenerate PA and clear fatigue.
// (In the real game this is driven by the wave scheduler at 13h/1h.)
func (g *GameState) Advance() {
	g.Wave++
	if g.Wave >= 2 {
		g.Wave = 0
		g.Day++
	}
	for _, h := range g.Heroes {
		h.PA = h.MaxPA
		h.RemoveState(StateFatigue)
		h.RemoveState(StateTetanise)
	}
}

// StartCombat engages the monster on the acting hero's tile. Every hero standing on
// that tile joins the fight — those of OTHER players are AI-driven until their
// owner joins the combat (starterID = the engaging player, "" in legacy games).
func (g *GameState) StartCombat(heroID, starterID string) (*Combat, error) {
	// Plusieurs combats peuvent tourner EN PARALLÈLE (chaque joueur engage le
	// sien) — on refuse seulement d'engager un héros DÉJÀ au combat.
	if g.heroInCombat(heroID) != nil {
		return nil, ActionError{"ce héros est déjà en plein combat"}
	}
	h := g.HeroByID(heroID)
	if h == nil {
		return nil, ActionError{"héros introuvable"}
	}
	t := g.TileAt(h.X, h.Y)
	if t == nil || t.MonsterID == "" {
		return nil, ActionError{"aucun ennemi sur cette case"}
	}
	m := g.Monsters[t.MonsterID]
	if m == nil {
		return nil, ActionError{"ennemi introuvable"}
	}
	var party []*Hero
	for _, hh := range g.Heroes {
		if hh.X == h.X && hh.Y == h.Y && hh.HP > 0 {
			party = append(party, hh)
		}
	}
	if len(party) == 0 {
		party = []*Hero{h}
	}
	c := NewCombat(g, party, m, starterID)
	if g.Combats == nil { // states from legacy rows/fixtures may lack the map
		g.Combats = map[string]*Combat{}
	}
	g.Combats[c.ID] = c
	g.ActiveCombat = c.ID
	if c.Status != "active" {
		g.FinishCombat(c)
	}
	return c, nil
}

// JoinCombat (multijoueur) : le joueur REJOINT le combat actif où figurent ses
// héros et en reprend le contrôle — jusqu'ici l'IA les jouait. Idempotent.
func (g *GameState) JoinCombat(combatID, playerID string) (*Combat, error) {
	c := g.Combats[combatID]
	if c == nil {
		return nil, ActionError{"combat introuvable"}
	}
	if c.Status != "active" {
		return nil, ActionError{"le combat est terminé"}
	}
	if g.PlayerByID(playerID) == nil {
		return nil, ActionError{"joueur inconnu — reconnecte-toi à la partie"}
	}
	mine := false
	for _, u := range c.Units {
		if u.Side == "hero" && u.OwnerID == playerID && u.inBattle() {
			mine = true
			break
		}
	}
	if !mine {
		return nil, ActionError{"aucun de tes héros ne participe à ce combat"}
	}
	c.AddParticipant(playerID)
	// le combat peut devenir PARTAGÉ (≥2 présents) alors qu'on est déjà en pause
	// sur un tour humain → armer le minuteur du tour courant (sinon il ne le serait
	// qu'au prochain changement de tour, laissant ce tour-ci sans limite).
	if u := c.CurrentUnit(); u != nil && u.Side == "hero" && !c.unitIsAuto(u) {
		c.armTurnTimer(u)
	}
	return c, nil
}

// FinishCombat writes a resolved combat's consequences back onto the world.
func (g *GameState) FinishCombat(c *Combat) {
	if c.Status == "active" {
		return
	}
	// Write hero HP back from their combat units.
	for _, u := range c.Units {
		if u.Side != "hero" {
			continue
		}
		if h := g.HeroByID(u.RefID); h != nil {
			h.HP = u.HP
			h.Bars["combat"]++
		}
	}

	switch c.Status {
	case "won":
		// Remove the defeated monster and reward the party: each hero draws one entry
		// from the species' weighted loot table (👹 Monstres). A Récupérateur's
		// "Récupération" passive nets an extra trophy on top.
		var sp *SpeciesDef
		if t := g.TileAt(c.TileX, c.TileY); t != nil {
			if m := g.Monsters[t.MonsterID]; m != nil {
				sp = SpeciesByName(m.Species)
				// Le pack entier tombe avec le combat : le compteur du classement
				// grandit de son effectif.
				slain := m.Count
				if slain < 1 {
					slain = 1
				}
				g.MonstersKilled += slain
			}
			delete(g.Monsters, t.MonsterID)
			t.MonsterID = ""
		}
		for _, u := range c.Units {
			if u.Side == "hero" {
				if h := g.HeroByID(u.RefID); h != nil {
					loot := Item{Type: "animal", Name: "Trophée de monstre", Qty: 1}
					if sp != nil {
						if d := weightedDrop(sp.Drops); d != nil {
							loot = Item{Type: d.Type, Name: d.Name, Qty: d.Qty}
						}
					}
					h.AddLoot(loot)
					items := []Item{loot}
					if h.ClassID == "recuperateur" {
						extra := Item{Type: "animal", Name: "Trophée de monstre", Qty: 1}
						h.AddLoot(extra)
						items = append(items, extra)
					}
					// Écran de victoire (lot C2) : le butin par héros est mémorisé
					// sur le combat pour que le client fasse un récapitulatif.
					c.Rewards = append(c.Rewards, CombatReward{HeroID: h.ID, HeroName: h.Name, Items: items})
				}
			}
		}
	case "lost":
		// Heroes retreat to town and are stabilized at 1 HP; the monster remains.
		for _, h := range g.Heroes {
			if h.X == c.TileX && h.Y == c.TileY {
				h.X, h.Y = g.Town.X, g.Town.Y
				if h.HP < 1 {
					h.HP = 1
				}
				h.AddState(StateTetanise)
			}
		}
	case "fled":
		// Fuite d'équipe (lot C3) : AUCUN butin, les héros restent sur la case
		// (PV écrits ci-dessus), et le pack CONSERVE ses pertes — les unités
		// tuées pendant le combat réduisent le pack, le PV de la créature de
		// tête est persisté (même sémantique que la boule de feu).
		if t := g.TileAt(c.TileX, c.TileY); t != nil {
			if m := g.Monsters[t.MonsterID]; m != nil {
				killed, aliveHP := 0, 0
				for _, u := range c.Units {
					if u.Side != "monster" {
						continue
					}
					if u.Alive() {
						if aliveHP == 0 {
							aliveHP = u.HP
						}
					} else {
						killed++
					}
				}
				m.Count -= killed
				if m.Count < 1 {
					m.Count = 1
				}
				if aliveHP > 0 {
					m.HP = aliveHP
				}
			}
		}
	}
	// Combats concurrents : ne nettoyer QUE ce combat. Il est retiré de la carte
	// (le client garde l'objet via la réponse d'action pour l'écran de fin).
	if g.ActiveCombat == c.ID {
		g.ActiveCombat = ""
	}
	delete(g.Combats, c.ID)
}
