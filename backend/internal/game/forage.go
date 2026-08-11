package game

import "time"

// FOUILLE AUTOMATIQUE (2026-08-02).
//
// Fouiller coûte 1 PA — et ce PA n'achète plus une trouvaille, il achète une
// INSTALLATION : le héros reste sur sa case et continue de la fouiller tout
// seul, gratuitement, tant qu'il ne bouge pas. Sur un jeu asynchrone joué sur
// plusieurs jours réels, c'est ce qui donne un intérêt au fait de POSTER un
// héros quelque part au lieu de brûler ses 6 PA d'un coup et de fermer l'onglet.
//
// Ce n'est pas un revenu gratuit pour autant, et c'est ce qui rend la mécanique
// tenable sans plafond de sac : la case s'épuise (ensuite ~75 % de Débris), un
// héros posté HORS DES MURS se fait frapper par chaque vague, et transformer les
// Débris en matériaux coûte 1 PA à la Recyclerie. Camper est un pari.
//
// ⚠ La récolte doit tourner SANS JOUEUR CONNECTÉ : c'est donc une troisième
// horloge de la simulation (`AdvanceTo`, sim.go), entrelacée avec les vagues et
// les rounds de bots, et non un minuteur côté client.

// ForageInterval est la cadence d'une fouille automatique.
//
// Exprimée en fraction de l'intervalle de VAGUE plutôt qu'en minutes fixes : le
// rythme du jeu est réglé par `ECHOTERRA_WAVE_SECONDS` (10 min en dev, 6 h en
// déploiement), et une constante en minutes aurait donné 72 trouvailles entre
// deux vagues en réel — la fouille manuelle n'aurait plus servi à rien. Un
// sixième de vague donne SIX trouvailles par période, exactement les 6 PA d'un
// héros : poster un héros vaut à peu près une journée de fouille à la main.
func ForageInterval() time.Duration {
	d := WaveInterval / 6
	if d < time.Second {
		d = time.Second // garde-fou : un WaveInterval minuscule (tests) ne doit pas boucler
	}
	return d
}

// StopForaging interrompt la récolte d'un héros. Appelé par tout ce qui rompt
// l'installation : bouger, s'échapper, se cacher, entrer en combat, tomber.
func (h *Hero) StopForaging() {
	h.ForageAt = time.Time{}
}

// Foraging indique si le héros est installé à fouiller.
func (h *Hero) Foraging() bool { return !h.ForageAt.IsZero() }

// canForage vérifie que la récolte peut CONTINUER. Les conditions sont celles de
// la fouille manuelle, moins le PA : vivant, pas tétanisé (on ne creuse pas sous
// les griffes de la horde), pas en plein combat, sur un terrain fouillable et
// hors de la ville.
func (g *GameState) canForage(h *Hero) bool {
	if h == nil || h.HP <= 0 || !h.Foraging() {
		return false
	}
	if h.HasState(StateTetanise) {
		return false
	}
	if g.heroInCombat(h.ID) != nil {
		return false
	}
	if h.X == g.Town.X && h.Y == g.Town.Y {
		return false
	}
	t := g.TileAt(h.X, h.Y)
	if t == nil {
		return false
	}
	td, ok := g.terrainFor(t.Biome)
	return ok && td.Searchable
}

// nextForage renvoie le héros dont la fouille automatique est due le plus tôt,
// et son échéance. Les héros qui ne peuvent plus récolter sont désinstallés au
// passage (c'est le seul endroit qui l'observe : un héros tétanisé par une vague
// ne repasse par aucune action).
func (g *GameState) nextForage() (*Hero, time.Time) {
	var best *Hero
	var at time.Time
	for _, h := range g.Heroes {
		if !h.Foraging() {
			continue
		}
		if !g.canForage(h) {
			h.StopForaging()
			continue
		}
		if best == nil || h.ForageAt.Before(at) {
			best, at = h, h.ForageAt
		}
	}
	return best, at
}

// forageOnce joue UNE fouille automatique et replanifie la suivante. Le butin est
// exactement celui d'une fouille manuelle (searchLoot) — seul le PA change.
func (g *GameState) forageOnce(h *Hero) {
	t := g.TileAt(h.X, h.Y)
	if t == nil {
		h.StopForaging()
		return
	}
	td, ok := g.terrainFor(t.Biome)
	if !ok {
		h.StopForaging()
		return
	}
	g.searchLoot(h, t, td)
	h.Bars["collecte"]++
	h.ForageAt = h.ForageAt.Add(ForageInterval())
}
