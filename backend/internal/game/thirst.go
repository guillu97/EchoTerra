package game

// LA SOIF — la contrainte de l'expédition désertique (theme.go).
//
// ⚠ CE FICHIER N'INVENTE RIEN : il ALLUME. `StateSoif` existait, la boisson le retirait
// (DrinkRation, TownAction "water"), le Jus de fruit et l'Élixir de givre aussi, les
// joueurs-IA le consultaient — et **aucun code de jeu ne le posait**, jamais. Tout le
// sous-système de l'eau — les rations du puits, Hero.DrewWaterDay, les capacités par
// niveau (50/75/112), la recharge entre deux vagues, et jusqu'à l'effet « rations +1 »
// de la Cuisine niveau 2 — pendait donc à un état qui n'arrivait jamais, et le puits
// n'était qu'un distributeur gratuit de +6 PA.
//
// Trois décisions de cadrage, toutes issues des six règles de RETENTION-PLAN.md §8 :
//
//  1. LA SOIF SE PAIE EN PA, PAS EN PV. Elle ralentit, elle ne tue pas — c'est ce qui
//     l'empêche de piéger un joueur absent (règle 5), et les PA sont la vraie monnaie
//     d'une journée, donc la perte se sent immédiatement.
//  2. ELLE FRAPPE AU CHANGEMENT DE JOUR, pas à chaque vague. « Un héros qui n'a pas bu
//     de la journée » est une phrase que le joueur peut se dire ; « qui n'a pas bu
//     depuis la dernière vague » n'en est pas une, et punirait deux fois par jour.
//  3. ELLE EST ANNONCÉE (règle 4) : l'ordre du jour la porte dès qu'un héros a soif.
//
// WaterRation est le nom de l'objet « eau » — ⚠ une CHAÎNE de jeu, jamais traduite ni
// renommée par un thème (town.go la produit, items.go lui donne ses effets, les bots la
// cherchent).
const WaterRation = "Ration d'eau"

const (
	// thirstPA : ce que coûte une journée sans boire, au réveil suivant. Deux PA sur
	// six — un tiers de la journée, assez pour qu'on aille chercher de l'eau, pas assez
	// pour qu'une soirée manquée soit perdue.
	thirstPA = 2
	// wellRefillDefault : la recharge naturelle du puits entre deux vagues, hors thème
	// désertique (voir ThemeDef.WellRefill).
	wellRefillDefault = 10
)

// applyThirst pose la Soif sur les héros qui n'ont pas bu du jour qui vient de
// s'achever. Appelée par processWave au moment EXACT où le jour bascule, donc une fois
// par jour de jeu et jamais deux.
//
// Ne fait rien hors d'un thème qui a soif : la règle « un thème est une peau et un
// biais » n'interdit pas une contrainte, elle interdit qu'elle déborde sur les autres
// cartes.
func (g *GameState) applyThirst() {
	if !g.Theme().Thirst {
		return
	}
	for _, h := range g.Heroes {
		if h.HP <= 0 {
			continue
		}
		// DrewWaterDay porte le jour de la dernière gorgée. Le jour vient d'être
		// incrémenté : avoir bu « hier » (g.Day-1) suffit, c'est la journée qu'on
		// solde. Un héros qui n'a jamais bu (0) a soif dès le premier jour révolu.
		if h.DrewWaterDay < g.Day-1 {
			h.AddState(StateSoif)
		}
	}
}

// thirstPenalty rend les PA en moins au réveil d'un héros assoiffé (0 sinon). Appliqué
// à la régénération de la vague — pas à la volée, sinon boire APRÈS coup ne rendrait
// rien et la ration n'aurait plus d'intérêt.
func thirstPenalty(h *Hero) int {
	if h.HasState(StateSoif) {
		return thirstPA
	}
	return 0
}

// wellRefill rend la recharge du puits entre deux vagues pour ce thème.
func (g *GameState) wellRefill() int {
	if n := g.Theme().WellRefill; n > 0 {
		return n
	}
	return wellRefillDefault
}

// terrainFor rend la table de fouille d'un biome, ENRICHIE des trouvailles propres au
// thème (ThemeDef.ExtraDrops). Toute lecture de Terrains qui décide de ce qu'on TROUVE
// doit passer par ici — la fouille manuelle, la fouille automatique, et la liste de
// courses des joueurs-IA, sinon les bots ignoreraient l'eau de la palmeraie et
// mourraient de soif sur une carte qui en porte.
//
// ⚠ AJOUTE, n'enlève jamais : un thème ne peut pas couper une ville de son bois ni de
// sa pierre.
func (g *GameState) terrainFor(b Biome) (TerrainDef, bool) {
	td, ok := Terrains[b]
	if !ok {
		return td, false
	}
	extra := g.Theme().ExtraDrops[b]
	if len(extra) == 0 {
		return td, true
	}
	drops := make([]DropDef, 0, len(td.Drops)+len(extra))
	drops = append(drops, td.Drops...)
	drops = append(drops, extra...)
	td.Drops = drops
	return td, true
}
