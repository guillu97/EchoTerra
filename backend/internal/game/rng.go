package game

// LE HASARD DU JEU — et pourquoi il ne passe PAS par math/rand global.
//
// Depuis Go 1.24, `rand.Seed` est un NO-OP : le générateur global est semé
// aléatoirement au démarrage du processus et rien ne peut le rendre reproductible. Or
// deux endroits comptaient dessus, silencieusement, et depuis longtemps :
//
//   - `worldgen.newWorld` appelait `rand.Seed(seed)` — donc DEUX PARTIES DE MÊME GRAINE
//     ne donnaient pas la même carte. Le champ Seed du GameState mentait ;
//   - la simulation d'équilibrage appelait `rand.Seed(cfg.Seed)` — donc elle ne répondait
//     pas deux fois pareil à la même question, ce qui a coûté deux faux positifs et une
//     garde de non-régression rendue instable.
//
// Rien n'échouait bruyamment : c'est exactement le genre de bug qu'on ne trouve qu'en
// mesurant (ici, une sonde qui rejoue la même graine et diffe les mondes obtenus).
//
// Tout le paquet passe désormais par CE générateur, semable et protégé par un verrou —
// le générateur global de math/rand est thread-safe, un `*rand.Rand` nu ne l'est pas, et
// le battement peut faire avancer plusieurs parties en parallèle.

import (
	"math/rand"
	"sync"
	"time"
)

var (
	rngMu sync.Mutex
	rng   = rand.New(rand.NewSource(time.Now().UnixNano()))
)

// SeedRNG rend le hasard du jeu REPRODUCTIBLE. Réservé à la simulation d'équilibrage et
// aux tests : en production le générateur est semé à l'heure au démarrage.
func SeedRNG(seed int64) {
	rngMu.Lock()
	defer rngMu.Unlock()
	rng = rand.New(rand.NewSource(seed))
}

func randIntn(n int) int {
	if n <= 0 {
		return 0
	}
	rngMu.Lock()
	defer rngMu.Unlock()
	return rng.Intn(n)
}

func randFloat64() float64 {
	rngMu.Lock()
	defer rngMu.Unlock()
	return rng.Float64()
}
