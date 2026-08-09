// Command balance plays Echo Terra games headlessly and prints how they went.
//
//	go -C backend run ./cmd/balance                    # 5 seeds × 4 joueurs-IA × 20 vagues
//	go -C backend run ./cmd/balance -seeds 20 -waves 30
//	go -C backend run ./cmd/balance -players 1 -detail  # la courbe vague par vague
//	go -C backend run ./cmd/balance -sweep              # 1→6 joueurs, pour voir le scaling
//
// The point is to answer « le jeu est-il jouable ? » without playing it: how far a
// town survives, whether the bots build/repair/close the gate, how fast the map is
// picked clean, and whether the horde outruns everything.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"

	"echoterra/internal/balance"
)

func main() {
	seeds := flag.Int("seeds", 5, "nombre de graines simulées")
	seed0 := flag.Int64("seed", 1, "première graine")
	players := flag.Int("players", 4, "joueurs-IA (3 héros chacun)")
	waves := flag.Int("waves", 20, "vagues à simuler")
	size := flag.Int("size", 0, "taille de carte (0 = défaut worldgen)")
	detail := flag.Bool("detail", false, "afficher la courbe vague par vague de chaque partie")
	sweep := flag.Bool("sweep", false, "balayer 1→6 joueurs-IA au lieu d'une seule config")
	asJSON := flag.Bool("json", false, "sortie JSON (rapports complets)")
	flag.Parse()

	configs := []int{*players}
	if *sweep {
		configs = []int{1, 2, 3, 4, 5, 6}
	}

	var all []balance.Report
	for _, p := range configs {
		var reports []balance.Report
		for i := 0; i < *seeds; i++ {
			reports = append(reports, balance.Run(balance.Config{
				Seed: *seed0 + int64(i), Width: *size, Height: *size, Players: p, Waves: *waves,
			}))
		}
		all = append(all, reports...)
		if *asJSON {
			continue
		}
		fmt.Printf("\n\033[1m=== %d joueur(s)-IA · %d héros · %d graines · %d vagues visées ===\033[0m\n",
			p, p*3, *seeds, *waves)
		for _, r := range reports {
			fmt.Printf("  seed %-4d %s\n", r.Config.Seed, r.Verdict())
			if *detail {
				fmt.Print(r.Table())
			}
		}
		fmt.Print(summary(reports, *waves))
	}

	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(all)
	}
}

// summary aggregates a batch of runs: the survival rate is the headline, the median
// death wave says how brutal the failure is, and the averages say whether the town
// was actually progressing before it fell.
func summary(reports []balance.Report, target int) string {
	if len(reports) == 0 {
		return ""
	}
	survived, deaths := 0, []int{}
	var hp, def, lvl, killed, res, evolved float64
	for _, r := range reports {
		last := r.Last()
		if r.Survived() {
			survived++
		} else {
			deaths = append(deaths, r.DiedAt)
		}
		hp += float64(last.TownHP)
		def += float64(last.Defense)
		lvl += float64(last.LevelSum)
		killed += float64(last.MonstersKilled)
		res += float64(last.ResourcesLeft)
		evolved += float64(last.HeroesEvolved)
	}
	n := float64(len(reports))
	out := fmt.Sprintf("  \033[1m→ %d/%d survivent à %d vagues\033[0m", survived, len(reports), target)
	if len(deaths) > 0 {
		sort.Ints(deaths)
		out += fmt.Sprintf(" · chutes aux vagues %v (médiane %d)", deaths, deaths[len(deaths)/2])
	}
	out += fmt.Sprintf("\n     moyennes en fin de run : PV %.0f · défense %.0f · niveaux cumulés %.1f · héros évolués %.1f · tués %.0f · ressources restantes %.0f\n",
		hp/n, def/n, lvl/n, evolved/n, killed/n, res/n)
	return out
}
