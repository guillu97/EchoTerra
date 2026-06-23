package game

// Fog of war. Tiles start hidden and are permanently revealed once a hero has seen
// them; the revealed set lives on GameState (one shared world) so every player sees
// the same explored map. The town and its immediate surroundings start revealed.
//
// Reveal is monotonic (Discovered only flips false->true) and recomputed from the
// current hero positions on every Recompute(), so it captures movement from any
// action (move, escape, combat retreat) without each action needing to know about fog.

const (
	heroSightRadius = 2 // Chebyshev radius a hero reveals around itself
	townSightRadius = 3 // the town reveals a slightly wider ring at the start
)

// revealAround marks every in-bounds tile within Chebyshev radius r of (cx,cy) as discovered.
func (g *GameState) revealAround(cx, cy, r int) {
	for dy := -r; dy <= r; dy++ {
		for dx := -r; dx <= r; dx++ {
			if t := g.TileAt(cx+dx, cy+dy); t != nil {
				t.Discovered = true
			}
		}
	}
}

// RevealVision re-reveals the fog around the town and every living hero. Called from
// Recompute so the explored set grows as heroes move.
func (g *GameState) RevealVision() {
	g.revealAround(g.Town.X, g.Town.Y, townSightRadius)
	for _, h := range g.Heroes {
		if h.HP > 0 {
			g.revealAround(h.X, h.Y, heroSightRadius)
		}
	}
}
