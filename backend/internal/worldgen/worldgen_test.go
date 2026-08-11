package worldgen

import (
	"testing"

	"echoterra/internal/game"
)

func TestGenerateTilesDeterministic(t *testing.T) {
	a, _ := GenerateTiles(20, 20, 42)
	b, _ := GenerateTiles(20, 20, 42)
	if len(a) != 400 || len(b) != 400 {
		t.Fatalf("expected 400 tiles, got %d/%d", len(a), len(b))
	}
	for i := range a {
		if a[i].Biome != b[i].Biome {
			t.Fatalf("non-deterministic biome at %d: %v vs %v", i, a[i].Biome, b[i].Biome)
		}
	}
}

// Le BOIS et la PIERRE doivent être atteignables près de la ville sur TOUTE graine et
// sous TOUT thème — sinon les matériaux de base sont hors de portée et la partie est
// perdue d'avance (voir ensureNearbyBiomes).
//
// ⚠ « pierre » = montagne OU NEIGE, comme dans le code : les deux biomes rendent de la
// Pierre (Terrains) et ensureNearbyBiomes les compte ensemble. Exiger une MONTAGNE
// nommément, c'était confondre la ressource avec l'un de ses deux gisements — et le
// test tombait dès qu'une carte nordique servait la même pierre sous la neige.
//
// ⚠ le thème est BALAYÉ ici : il déplace les biomes autour de la ville, donc c'est
// exactement la garantie qu'il pourrait casser. La garantie l'emporte sur le thème.
func TestEnsureNearbyBiomes(t *testing.T) {
	const R = 10
	for _, theme := range []string{"tempere", "nordique", "desertique"} {
		for seed := int64(1); seed <= 30; seed++ {
			gs := NewGame(60, 60, seed, WithTheme(theme))
			near := func(bs ...game.Biome) bool {
				for dy := -R; dy <= R; dy++ {
					for dx := -R; dx <= R; dx++ {
						x, y := gs.Town.X+dx, gs.Town.Y+dy
						if x < 0 || y < 0 || x >= gs.Width || y >= gs.Height {
							continue
						}
						for _, b := range bs {
							if gs.TileAt(x, y).Biome == b {
								return true
							}
						}
					}
				}
				return false
			}
			if !near(game.BiomeForest) {
				t.Fatalf("thème %s, seed %d: aucune forêt (bois) à portée de la ville", theme, seed)
			}
			if !near(game.BiomeMountain, game.BiomeSnow) {
				t.Fatalf("thème %s, seed %d: aucune source de pierre à portée de la ville", theme, seed)
			}
		}
	}
}

func TestNewGameHasTownAndHeroes(t *testing.T) {
	gs := NewGame(24, 24, 7)
	if len(gs.Heroes) != 3 {
		t.Fatalf("expected 3 heroes, got %d", len(gs.Heroes))
	}
	town := gs.TileAt(gs.Town.X, gs.Town.Y)
	if town == nil || !town.Biome.Walkable() {
		t.Fatalf("town must be on a walkable tile")
	}
	for _, h := range gs.Heroes {
		if h.X != gs.Town.X || h.Y != gs.Town.Y {
			t.Fatalf("heroes must spawn on the town")
		}
	}
	if len(gs.Monsters) == 0 {
		t.Fatalf("expected at least one monster seeded")
	}
}

func TestBiomeThresholds(t *testing.T) {
	cases := []struct {
		v    float64
		want game.Biome
	}{
		{0.1, game.BiomeWater},
		{0.32, game.BiomeSand},
		{0.5, game.BiomeGrass},
		{0.7, game.BiomeForest},
		{0.8, game.BiomeMountain},
		{0.95, game.BiomeSnow},
	}
	for _, c := range cases {
		if got := biomeFromLevel(int(c.v*float64(genMaxHeight) + 0.5)); got != c.want {
			t.Errorf("biomeFromLevel(%v)=%v want %v", c.v, got, c.want)
		}
	}
}

func TestNewLobbyStartsEmptyAndUnscheduled(t *testing.T) {
	gs := NewLobby(22, 22, 42, "Partie test", 2, 4)
	if gs.Status != game.StatusLobby {
		t.Fatalf("status = %q, want lobby", gs.Status)
	}
	if len(gs.Heroes) != 0 || len(gs.Players) != 0 {
		t.Fatalf("a fresh lobby must have no heroes/players, got %d/%d", len(gs.Heroes), len(gs.Players))
	}
	if gs.JoinCode == "" || len(gs.JoinCode) != 5 {
		t.Fatalf("join code missing/malformed: %q", gs.JoinCode)
	}
	if !gs.NextWaveAt.IsZero() {
		t.Fatal("no wave must be scheduled before launch")
	}
	if gs.MinPlayers != 2 || gs.MaxPlayers != 4 {
		t.Fatalf("min/max players = %d/%d, want 2/4", gs.MinPlayers, gs.MaxPlayers)
	}
}

func TestNewLobbyClampsPlayerBounds(t *testing.T) {
	gs := NewLobby(10, 10, 1, "x", 9, 0) // min > default max, max unset
	if gs.MaxPlayers != 4 || gs.MinPlayers != 4 {
		t.Fatalf("bounds not clamped: min=%d max=%d", gs.MinPlayers, gs.MaxPlayers)
	}
}

// The design's "lissage": no tile may stand more than genMaxStep above an
// orthogonal neighbour (a level-6 mountain can never touch a level-0 plain).
func TestSmoothingLimitsNeighbourSteps(t *testing.T) {
	const w, h = 60, 60
	tiles, _ := GenerateTiles(w, h, 42)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			cur := tiles[y*w+x].Height
			for _, d := range [][2]int{{1, 0}, {0, 1}} {
				nx, ny := x+d[0], y+d[1]
				if nx >= w || ny >= h {
					continue
				}
				n := tiles[ny*w+nx].Height
				diff := cur - n
				if diff < 0 {
					diff = -diff
				}
				if diff > genMaxStep {
					t.Fatalf("tiles (%d,%d)=%d et (%d,%d)=%d diffèrent de %d (> %d)", x, y, cur, nx, ny, n, diff, genMaxStep)
				}
			}
		}
	}
}

// --- thèmes d'expédition -------------------------------------------------------------

// « Dominant » veut dire AUTOUR DE LA VILLE, pas partout : le biais décroît avec la
// distance, et au loin la carte redevient elle-même. C'est ce qui fait de la variété
// une chose qui se mérite plutôt qu'un monde monochrome.
func TestThemeDominatesNearTownAndFadesAway(t *testing.T) {
	count := func(gs *game.GameState, b game.Biome, from, to int) int {
		n := 0
		for i, tl := range gs.Tiles {
			x, y := i%gs.Width, i/gs.Width
			d := cheb(x-gs.Town.X, y-gs.Town.Y)
			if d >= from && d <= to && tl.Biome == b {
				n++
			}
		}
		return n
	}
	for _, tc := range []struct {
		theme string
		biome game.Biome
	}{{"nordique", game.BiomeSnow}, {"desertique", game.BiomeSand}} {
		for seed := int64(1); seed <= 5; seed++ {
			gs := NewGame(60, 60, seed, WithTheme(tc.theme))
			near := count(gs, tc.biome, 0, 8)     // 17×17 = 289 tuiles
			far := count(gs, tc.biome, 26, 1<<30) // la couronne extérieure
			plain := NewGame(60, 60, seed, WithTheme("tempere"))
			if near <= count(plain, tc.biome, 0, 8) {
				t.Errorf("%s seed %d : le biome dominant n'entoure pas la ville (%d tuiles)", tc.theme, seed, near)
			}
			// …et il ne dévore pas le lointain : au-delà du rayon, la carte est celle
			// du monde ordinaire, à quelques tuiles près.
			if far > count(plain, tc.biome, 26, 1<<30)+40 {
				t.Errorf("%s seed %d : le thème déborde jusqu'au bout de la carte (%d tuiles au loin)", tc.theme, seed, far)
			}
		}
	}
}

// ⚠ AUCUN BIOME PRÉSENT NE PEUT DISPARAÎTRE : SeedRuins pose une ruine par biome
// présent et chaque ruine porte le plan d'une spécialité. Noyer un biome sous le sable
// ferait disparaître un bâtiment de la partie, selon un tirage que personne ne choisit.
func TestThemeNeverWipesOutABiome(t *testing.T) {
	for _, theme := range []string{"nordique", "desertique"} {
		for seed := int64(1); seed <= 8; seed++ {
			plain := NewGame(60, 60, seed, WithTheme("tempere"))
			themed := NewGame(60, 60, seed, WithTheme(theme))
			before, after := map[game.Biome]int{}, map[game.Biome]int{}
			for _, tl := range plain.Tiles {
				before[tl.Biome]++
			}
			for _, tl := range themed.Tiles {
				after[tl.Biome]++
			}
			for b := game.Biome(1); b <= 5; b++ {
				if before[b] == 0 {
					continue
				}
				if after[b] == 0 {
					t.Errorf("thème %s, seed %d : le biome %d a disparu (%d tuiles avant)", theme, seed, b, before[b])
				}
			}
			// La conséquence qui compte vraiment : les ruines restent au complet.
			if len(themed.Ruins) < len(plain.Ruins) {
				t.Errorf("thème %s, seed %d : %d ruines contre %d sans thème", theme, seed, len(themed.Ruins), len(plain.Ruins))
			}
		}
	}
}

// La neige a le droit d'exister — elle n'existait PAS (le lissage plafonne le relief au
// niveau 5, la neige exigeait le niveau 6). Sa Tour gelée, donc le Plan de la Caserne
// qu'elle est seule à donner, étaient inatteignables sur toutes les cartes du jeu.
func TestSnowExistsOnEveryMap(t *testing.T) {
	for _, side := range []int{40, 60, 100} {
		for seed := int64(1); seed <= 6; seed++ {
			gs := NewGame(side, side, seed, WithTheme("tempere"))
			snow := 0
			for _, tl := range gs.Tiles {
				if tl.Biome == game.BiomeSnow {
					snow++
				}
			}
			if snow == 0 {
				t.Errorf("carte %d² seed %d : aucune tuile de neige — la Tour gelée ne peut pas naître", side, seed)
			}
			if _, ok := gs.Ruins["ruin-tour"]; !ok {
				t.Errorf("carte %d² seed %d : pas de Tour gelée, donc pas de Plan de la Caserne", side, seed)
			}
		}
	}
}

func cheb(dx, dy int) int {
	if dx < 0 {
		dx = -dx
	}
	if dy < 0 {
		dy = -dy
	}
	if dy > dx {
		return dy
	}
	return dx
}
