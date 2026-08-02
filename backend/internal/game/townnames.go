package game

// Town name generator. Every generated world gets a French-flavored storybook town
// name (shown on the leaderboard and used to name server-created public games).
// Names combine a root + ending, with an occasional epithet, giving ~10k
// combinations — collisions across games are harmless (the game id stays the key).

import (
	"math/rand"
	"strings"
)

var townRoots = []string{
	"Clair", "Mont", "Val", "Bois", "Roche", "Aube", "Brume", "Fleur",
	"Pierre", "Vert", "Haut", "Gué", "Orme", "Loup", "Corbeau", "Lune",
	"Sauge", "Givre", "Braise", "Ronce", "Saule", "Grive", "Ambre", "Houx",
}

var townEndings = []string{
	"mont", "val", "bourg", "ville", "fort", "lac", "pré", "champ",
	"havre", "garde", "font", "combe", "loge", "terre",
}

var townEpithets = []string{
	"-sur-Brume", "-le-Vieux", "-les-Bois", "-sous-Lune", "-la-Forêt",
	"-du-Lac", "-les-Remparts", "-la-Vaillante",
}

// NewTownName returns a fresh town name like "Clairmont" or "Valbourg-sur-Brume".
func NewTownName() string {
	root := townRoots[rand.Intn(len(townRoots))]
	ending := townEndings[rand.Intn(len(townEndings))]
	for strings.EqualFold(root, ending) { // avoid "Montmont" / "Valval"
		ending = townEndings[rand.Intn(len(townEndings))]
	}
	name := root + ending
	if rand.Intn(3) == 0 { // one town in three gets an epithet
		name += townEpithets[rand.Intn(len(townEpithets))]
	}
	return name
}
