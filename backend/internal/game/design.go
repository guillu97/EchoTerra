package game

// design.go — the game-design data authored in the Studio de données (🧬) and handed
// back as JSON (echoterra-design-20260714). Terrains (search tables), monster species
// (stats, packs, spawn biomes, GDD attack grids, loot), building levels (materials,
// prerequisites, per-level effects) and the full recipe catalog all live here so the
// systems read DATA instead of hardcoded switches. Chantier PA costs intentionally
// stay in town.go buildPA (user decision: the design file's PA values are ignored).

// --- shared drop tables -------------------------------------------------------------

// DropDef is one weighted entry of a loot table (terrain search or monster kill).
type DropDef struct {
	Type   string `json:"type"`
	Name   string `json:"name"`
	Qty    int    `json:"qty"`
	Weight int    `json:"weight"` // draw weighting relative to the table's other rows
}

// weightedDrop draws one entry from a table (nil on an empty table).
func weightedDrop(drops []DropDef) *DropDef {
	total := 0
	for _, d := range drops {
		if d.Weight > 0 {
			total += d.Weight
		}
	}
	if total == 0 {
		return nil
	}
	roll := randIntn(total)
	for i := range drops {
		if drops[i].Weight <= 0 {
			continue
		}
		roll -= drops[i].Weight
		if roll < 0 {
			return &drops[i]
		}
	}
	return &drops[len(drops)-1]
}

// --- terrains -----------------------------------------------------------------------

// TerrainDef: per-biome worldgen richness and search drop table.
type TerrainDef struct {
	Searchable   bool
	ResourcesMin int
	ResourcesMax int
	Drops        []DropDef
}

// Terrains mirrors the ⛰️ Terrains tab. Mountain/snow use rarity tiers (stone common,
// silver/gold/frost rare).
var Terrains = map[Biome]TerrainDef{
	BiomeWater: {Searchable: false},
	// Spécialisation par biome (le worldgen garantit forêt + montagne proches de la
	// ville, cf. ensureNearbyBiomes) : l'herbe/le sable nourrissent, la FORÊT donne
	// le bois, la MONTAGNE/NEIGE la pierre et les minerais.
	BiomeSand: {Searchable: true, ResourcesMin: 3, ResourcesMax: 6, Drops: []DropDef{
		{"plante", "Fleur", 1, 1}, {"animal", "Viande", 1, 1}, {"objet", "Débris", 1, 1}, {"aliment", "Poisson", 1, 1},
		// Plans de chantier trouvables à la fouille. Les bâtiments SIMPLES (recyclerie,
		// cuisine, poste) ont des plans COMMUNS dans les biomes proches de la ville
		// (sable/prairie) ; les avancés (tour/mairie) restent modérés (forêt/montagne).
		{"objet", "Plan de la Recyclerie", 1, 3}, {"objet", "Plan de la Cuisine", 1, 1},
		{"objet", "Plan de la Poste", 1, 2},
	}},
	BiomeGrass: {Searchable: true, ResourcesMin: 3, ResourcesMax: 6, Drops: []DropDef{
		{"plante", "Fleur", 1, 1}, {"animal", "Viande", 1, 1}, {"objet", "Débris", 1, 1},
		{"plante", "Baie sauvage", 1, 2}, {"plante", "Fibre végétale", 1, 2},
		{"objet", "Plan de la Cuisine", 1, 3}, {"objet", "Plan de la Recyclerie", 1, 2},
		{"objet", "Plan de la Poste", 1, 3},
		// Les GRAINES ANCIENNES du Verger : une vieille friche en garde. Poids faible —
		// la source abondante reste la ferme en ruine — mais elles doivent exister hors
		// des ruines, sinon le Verger serait otage d'UN type de ruine sur la carte
		// (attrapé par TestEveryBuildingMaterialIsObtainable, qui ne compte que les
		// terrains, les monstres et le craft).
		{"plante", "Graines anciennes", 1, 1},
	}},
	BiomeForest: {Searchable: true, ResourcesMin: 3, ResourcesMax: 6, Drops: []DropDef{
		// la forêt est LA source de bois (poids fort) — le reste en appoint
		{"objet", "Bois", 1, 3}, {"plante", "Herbe médicinale", 1, 1}, {"animal", "Peau", 1, 1},
		{"plante", "Champignon", 1, 2}, {"plante", "Baie sauvage", 1, 1},
		{"objet", "Plan de la Mairie", 1, 1},
	}},
	// La montagne était le biome le plus PAUVRE (2-4 ressources) alors qu'elle porte
	// la matière dont la ville est faite : la pierre bâtit les murs ET répare les
	// remparts (TownRepairMaterial), et c'est déjà le biome le plus rare et le plus
	// loin. Ce double malus rendait la progression défensive impossible — mesuré : 4
	// pierres en banque à la vague 9, muraille bloquée au niveau 1, ville morte à la
	// vague 12. La carrière est donc aussi riche que la prairie, et la pierre pèse plus
	// lourd que les minerais rares dans son tirage.
	BiomeMountain: {Searchable: true, ResourcesMin: 3, ResourcesMax: 6, Drops: []DropDef{
		{"minerai", "Pierre", 2, 6}, {"minerai", "Minerai de fer", 1, 2}, {"minerai", "Charbon", 1, 2},
		{"minerai", "Minerai d'argent", 1, 1}, {"minerai", "Minerai d'or", 1, 1},
		{"objet", "Plan de la Tour", 1, 1},
	}},
	BiomeSnow: {Searchable: true, ResourcesMin: 3, ResourcesMax: 6, Drops: []DropDef{
		{"minerai", "Pierre", 2, 6}, {"minerai", "Minerai de fer", 1, 2},
		{"minerai", "Minerai d'argent", 1, 1}, {"minerai", "Givre éternel", 1, 1},
	}},
}

// --- attack grids (GDD-style) --------------------------------------------------------

// GridCell is one cell offset relative to the grid's anchor: the ATTACKER for a
// targeting grid, the STRUCK cell for a damage zone (which always includes it).
type GridCell struct {
	DX int `json:"dx"`
	DY int `json:"dy"`
}

func orthCells() []GridCell {
	return []GridCell{{0, -1}, {-1, 0}, {1, 0}, {0, 1}}
}
func ringCells() []GridCell {
	return append(orthCells(), GridCell{-1, -1}, GridCell{1, -1}, GridCell{-1, 1}, GridCell{1, 1})
}
func manhattanCells(min, max int) []GridCell {
	var out []GridCell
	for dy := -max; dy <= max; dy++ {
		for dx := -max; dx <= max; dx++ {
			d := absI(dx) + absI(dy)
			if d >= min && d <= max {
				out = append(out, GridCell{dx, dy})
			}
		}
	}
	return out
}
func lineCells(reach int) []GridCell {
	var out []GridCell
	for _, d := range [][2]int{{0, -1}, {0, 1}, {-1, 0}, {1, 0}} {
		for i := 1; i <= reach; i++ {
			out = append(out, GridCell{d[0] * i, d[1] * i})
		}
	}
	return out
}

// AttackDef is one combat ability with its GDD grids and structured effects (the
// Studio's free-text `effects` strings are encoded as fields the engine can apply).
type AttackDef struct {
	Name    string     `json:"name"`
	Kind    string     `json:"kind"` // "base" | "special"
	Desc    string     `json:"desc"`
	Targets []GridCell `json:"targets"` // aim cells, relative to the attacker; empty = self
	Damage  []GridCell `json:"damage"`  // impact zone around the struck cell (it is always included)

	DmgStat    string `json:"dmgStat,omitempty"`    // "force" | "dexterite" | "precision" | "" (no damage)
	DmgDiv     int    `json:"dmgDiv,omitempty"`     // damage divisor (2 = stat/2); 0/1 = full
	Bonus      int    `json:"bonus,omitempty"`      // flat damage bonus
	StunPct    int    `json:"stunPct,omitempty"`    // % chance to Stun each struck unit
	Root       bool   `json:"root,omitempty"`       // roots each struck unit (skips its next move)
	Absorb     bool   `json:"absorb,omitempty"`     // attacker heals half the damage dealt
	SelfShield bool   `json:"selfShield,omitempty"` // -50% damage taken until the attacker's next turn
	BuffAllies bool   `json:"buffAllies,omitempty"` // +2 force to adjacent allies
}

// maxReach is the farthest cell of the targeting grid (for AI approach).
func (a *AttackDef) maxReach() int {
	best := 0
	for _, c := range a.Targets {
		if d := absI(c.DX) + absI(c.DY); d > best {
			best = d
		}
	}
	return best
}

// inTargets reports whether (dx,dy) is one of the attack's aim cells.
func (a *AttackDef) inTargets(dx, dy int) bool {
	for _, c := range a.Targets {
		if c.DX == dx && c.DY == dy {
			return true
		}
	}
	return false
}

// --- monster species ------------------------------------------------------------------

// SpeciesDef is one monster species from the 👹 Monstres tab.
type SpeciesDef struct {
	ID         string
	Name       string // Monster.Species (display + save-compat key)
	Icon       string
	Appearance string // monsters/ asset file (mob-*)
	HP         int
	Stats      Stats
	PackMin    int
	PackMax    int
	Biomes     []Biome // spawn terrains
	Boss       bool    // spawns alone, gated to later waves
	Attacks    []AttackDef
	Drops      []DropDef // loot when the pack is defeated
}

var Species = []SpeciesDef{
	{
		ID: "slime", Name: "Slime Vorace", Icon: "🟣", Appearance: "mob-slime", HP: 9,
		Stats:   Stats{Force: 2, Agilite: 1, Endurance: 4, Precision: 2},
		PackMin: 1, PackMax: 2,
		Biomes: []Biome{BiomeSand, BiomeGrass, BiomeForest, BiomeMountain, BiomeSnow},
		Attacks: []AttackDef{
			{Name: "Attaque de base", Kind: "base", Desc: "Attaque de mêlée.", Targets: orthCells(), DmgStat: "force"},
			{Name: "Absorbe", Kind: "special", Desc: "Régénère en absorbant sa cible.", Targets: orthCells(), DmgStat: "force", Absorb: true},
		},
		Drops: []DropDef{{"animal", "Trophée de monstre", 1, 1}, {"animal", "Gelée de slime", 1, 2}},
	},
	{
		ID: "goblin", Name: "Goblin Pillard", Icon: "👺", Appearance: "mob-goblin", HP: 6,
		Stats:   Stats{Force: 4, Agilite: 4, Endurance: 1, Precision: 2},
		PackMin: 1, PackMax: 3,
		Biomes: []Biome{BiomeSand, BiomeGrass, BiomeForest, BiomeMountain, BiomeSnow},
		Attacks: []AttackDef{
			{Name: "Attaque de base", Kind: "base", Desc: "Attaque de mêlée.", Targets: orthCells(), DmgStat: "force"},
			{Name: "Tranche vicieuse", Kind: "special", Desc: "Entaille brutale.", Targets: orthCells(), DmgStat: "force", Bonus: 2},
		},
		Drops: []DropDef{{"animal", "Trophée de monstre", 1, 1}, {"minerai", "Minerai de fer", 1, 1}, {"animal", "Croc", 1, 2}},
	},
	{
		ID: "windelemental", Name: "Elementaire de Vent", Icon: "🌀", Appearance: "mob-windelemental", HP: 10,
		Stats:   Stats{Dexterite: 2, Agilite: 3, Endurance: 5, Precision: 2},
		PackMin: 1, PackMax: 3,
		Biomes: []Biome{BiomeSand, BiomeGrass, BiomeForest, BiomeMountain, BiomeSnow},
		Attacks: []AttackDef{
			{Name: "Attaque de base", Kind: "base", Desc: "Bourrasque proche.", Targets: manhattanCells(1, 2), DmgStat: "dexterite"},
			{Name: "Colonne de Vent", Kind: "special", Desc: "Colonne étourdissante (portée 3).", Targets: manhattanCells(1, 3), DmgStat: "dexterite", StunPct: 100},
		},
		Drops: []DropDef{{"animal", "Trophée de monstre", 1, 1}, {"aliment", "Poisson", 1, 1}, {"objet", "Essence de vent", 1, 1}},
	},
	{
		ID: "bat", Name: "Chauve souris", Icon: "🦇", Appearance: "mob-bat", HP: 8,
		Stats:   Stats{Force: 2, Agilite: 2, Endurance: 2, Precision: 2},
		PackMin: 1, PackMax: 6,
		Biomes: []Biome{BiomeMountain, BiomeForest},
		Attacks: []AttackDef{
			{Name: "Attaque de base", Kind: "base", Desc: "Morsure en piqué.", Targets: orthCells(), DmgStat: "force"},
		},
		Drops: []DropDef{{"animal", "Ailes", 1, 1}, {"animal", "Croc", 1, 1}, {"animal", "Viande", 1, 1}},
	},
	{
		ID: "harpie-prairie", Name: "Harpie de Prairie", Icon: "🪶", Appearance: "mob-ghost", HP: 7,
		Stats:   Stats{Force: 3, Dexterite: 2, Agilite: 5, Endurance: 1, Athletisme: 3, Precision: 3},
		PackMin: 1, PackMax: 3,
		Biomes: []Biome{BiomeGrass, BiomeSand},
		Attacks: []AttackDef{
			{Name: "Piqué d'Ailes", Kind: "base", Desc: "Plonge serres en avant.", Targets: orthCells(), DmgStat: "force"},
			{Name: "Tempête de Serres", Kind: "special", Desc: "Tourbillon lacérant tout autour d'elle.", Targets: ringCells(), Damage: orthCells(), DmgStat: "force"},
		},
		Drops: []DropDef{{"animal", "Plume de harpie", 1, 3}, {"animal", "Trophée de monstre", 1, 1}},
	},
	{
		ID: "dryade-corrompue", Name: "Dryade Corrompue", Icon: "🌳", Appearance: "mob-mushroomling", HP: 9,
		Stats:   Stats{Force: 3, Dexterite: 1, Agilite: 1, Endurance: 4, Precision: 3},
		PackMin: 1, PackMax: 2,
		Biomes: []Biome{BiomeForest},
		Attacks: []AttackDef{
			{Name: "Fouet de Racines", Kind: "base", Desc: "Racines frappant en croix autour de la case touchée.", Targets: orthCells(), Damage: orthCells(), DmgStat: "force"},
			{Name: "Lianes Étreignantes", Kind: "special", Desc: "Immobilise sa cible dans des lianes.", Targets: manhattanCells(1, 2), Root: true},
		},
		Drops: []DropDef{{"plante", "Sève de dryade", 1, 3}, {"objet", "Bois", 2, 2}, {"animal", "Trophée de monstre", 1, 1}},
	},
	{
		ID: "araignee-cristalline", Name: "Araignée Cristalline", Icon: "🕷️", Appearance: "mob-spider", HP: 8,
		Stats:   Stats{Force: 2, Dexterite: 4, Agilite: 3, Endurance: 2, Precision: 4},
		PackMin: 1, PackMax: 4,
		Biomes: []Biome{BiomeMountain, BiomeSnow},
		Attacks: []AttackDef{
			{Name: "Fil Tranchant", Kind: "base", Desc: "Fil de cristal coupant (distance).", Targets: manhattanCells(1, 3), DmgStat: "dexterite"},
			{Name: "Toile Paralysante", Kind: "special", Desc: "Toile qui englue la zone touchée.", Targets: manhattanCells(1, 2), Damage: orthCells(), Root: true},
		},
		Drops: []DropDef{{"objet", "Soie cristalline", 1, 3}, {"animal", "Trophée de monstre", 1, 1}},
	},
	{
		ID: "loup-garou", Name: "Loup-garou", Icon: "🐺", Appearance: "mob-wolf", HP: 12,
		Stats:   Stats{Force: 5, Agilite: 4, Endurance: 3, Athletisme: 2, Precision: 2},
		PackMin: 1, PackMax: 2,
		Biomes: []Biome{BiomeForest, BiomeGrass},
		Attacks: []AttackDef{
			{Name: "Morsure Sauvage", Kind: "base", Desc: "Morsure déchirante.", Targets: orthCells(), DmgStat: "force"},
			{Name: "Hurlement de Meute", Kind: "special", Desc: "Rend furieux les loups proches.", Targets: ringCells(), BuffAllies: true},
		},
		Drops: []DropDef{{"animal", "Fourrure maudite", 1, 2}, {"animal", "Croc", 1, 2}, {"animal", "Viande", 1, 1}},
	},
	{
		ID: "harpie-givre", Name: "Harpie de Givre", Icon: "❄️", Appearance: "mob-ghost", HP: 9,
		Stats:   Stats{Force: 3, Dexterite: 3, Agilite: 4, Endurance: 2, Athletisme: 2, Precision: 4},
		PackMin: 1, PackMax: 3,
		Biomes: []Biome{BiomeSnow, BiomeMountain},
		Attacks: []AttackDef{
			{Name: "Piqué d'Ailes", Kind: "base", Desc: "Plonge serres en avant.", Targets: orthCells(), DmgStat: "force"},
			{Name: "Colonne de Givre", Kind: "special", Desc: "Souffle glacial en colonne (portée 3).", Targets: manhattanCells(1, 3), DmgStat: "precision", Root: true},
		},
		Drops: []DropDef{{"animal", "Plume de harpie", 1, 2}, {"minerai", "Givre éternel", 1, 2}, {"animal", "Trophée de monstre", 1, 1}},
	},
	{
		ID: "roi-gobelin", Name: "Roi Gobelin sur Sanglier Géant", Icon: "👑", Appearance: "mob-orc", HP: 20,
		Stats:   Stats{Force: 6, Dexterite: 1, Agilite: 2, Endurance: 6, Athletisme: 2, Precision: 3},
		PackMin: 1, PackMax: 1, Boss: true,
		Biomes: []Biome{BiomeGrass, BiomeForest},
		Attacks: []AttackDef{
			{Name: "Charge du Sanglier", Kind: "base", Desc: "Charge en ligne droite (portée 3).", Targets: lineCells(3), DmgStat: "force"},
			{Name: "Piétinement du Croc", Kind: "special", Desc: "Piétinement circulaire, 50% d'étourdir.", Targets: ringCells(), Damage: orthCells(), DmgStat: "force", StunPct: 50},
			{Name: "Couronne de Bouclier", Kind: "special", Desc: "La garde royale fait bouclier (-50% dégâts subis 1 tour).", SelfShield: true},
		},
		Drops: []DropDef{{"deco", "Couronne du Roi Gobelin", 1, 3}, {"animal", "Défense de sanglier", 1, 3}, {"minerai", "Minerai de fer", 2, 1}},
	},
	{
		ID: "arbre-ancien", Name: "Arbre Vivant Ancien", Icon: "🌲", Appearance: "mob-mushroomling", HP: 25,
		Stats:   Stats{Force: 6, Endurance: 8, Precision: 2},
		PackMin: 1, PackMax: 1, Boss: true,
		Biomes: []Biome{BiomeForest},
		Attacks: []AttackDef{
			{Name: "Choc de Tronc", Kind: "base", Desc: "Branche-tronc abattue, 20% d'étourdir.", Targets: orthCells(), DmgStat: "force", StunPct: 20},
			{Name: "Racines Sinistres", Kind: "special", Desc: "Racines enserrant la zone.", Targets: manhattanCells(1, 2), Damage: orthCells(), DmgStat: "force", DmgDiv: 2, Root: true},
		},
		Drops: []DropDef{{"objet", "Cœur de chêne ancien", 1, 3}, {"objet", "Bois", 3, 2}},
	},
}

// SpeciesByName finds a species by its display name (Monster.Species).
func SpeciesByName(name string) *SpeciesDef {
	for i := range Species {
		if Species[i].Name == name {
			return &Species[i]
		}
	}
	return nil
}

// speciesForBiome lists the species allowed to spawn on a biome; bosses only when
// includeBosses is set (they enter the world with the later waves).
func speciesForBiome(b Biome, includeBosses bool) []*SpeciesDef {
	var out []*SpeciesDef
	for i := range Species {
		if Species[i].Boss && !includeBosses {
			continue
		}
		for _, sb := range Species[i].Biomes {
			if sb == b {
				out = append(out, &Species[i])
				break
			}
		}
	}
	return out
}

// --- building levels (tech tree) -------------------------------------------------------

// BuildingLevelDef: what one level of a building costs (materials — the chantier PA
// stay in buildPA) and grants (defense contribution / stock capacity).
type BuildingLevelDef struct {
	Materials []Item
	Effects   string
	Defense   int // defensive contribution at full durability (0 = not defensive)
	Capacity  int // stock capacity granted (Well rations, Bank slots); 0 = none
}

// BuildingRequire is one tech-tree prerequisite: the named building must be BUILT at
// this level (or higher) before the chantier's plan can be laid.
type BuildingRequire struct {
	Building string `json:"building"`
	Level    int    `json:"level"`
}

// BuildingDesign carries a building's tech-tree data. Levels[0] = construction to
// level 1, Levels[1] = upgrade to level 2, Levels[2] = upgrade to level 3 (max).
type BuildingDesign struct {
	Requires []BuildingRequire
	Levels   []BuildingLevelDef
}

// MaxBuildingLevel: the design defines three levels per building.
const MaxBuildingLevel = 3

var BuildingDesigns = map[string]BuildingDesign{
	"townhall": {
		Requires: []BuildingRequire{{"workshop", 1}},
		Levels: []BuildingLevelDef{
			{Materials: []Item{{"objet", "Bois", 4}, {"minerai", "Pierre", 2}}, Effects: "débloque Ressusciter"},
			{Materials: []Item{{"objet", "Bois", 8}, {"minerai", "Pierre", 4}, {"objet", "Planche", 2}}, Effects: "revive +1/jour"},
			{Materials: []Item{{"objet", "Bois", 12}, {"minerai", "Pierre", 6}, {"objet", "Cœur de chêne ancien", 1}}, Effects: "revive gratuit"},
		},
	},
	"well": {
		Levels: []BuildingLevelDef{
			{Materials: []Item{{"minerai", "Pierre", 2}}, Effects: "capacité 50", Capacity: 50},
			{Materials: []Item{{"minerai", "Pierre", 4}}, Effects: "capacité 75", Capacity: 75},
			{Materials: []Item{{"minerai", "Pierre", 6}, {"minerai", "Brique", 1}}, Effects: "capacité 112", Capacity: 112},
		},
	},
	"bank": {
		Levels: []BuildingLevelDef{
			{Materials: []Item{{"objet", "Bois", 2}}, Effects: "capacité 500", Capacity: 500},
			{Materials: []Item{{"objet", "Bois", 4}, {"objet", "Planche", 1}}, Effects: "capacité 750", Capacity: 750},
			{Materials: []Item{{"objet", "Bois", 6}, {"objet", "Planche", 2}}, Effects: "capacité 1125", Capacity: 1125},
		},
	},
	"tower": {
		Requires: []BuildingRequire{{"wall", 1}},
		Levels: []BuildingLevelDef{
			{Materials: []Item{{"objet", "Bois", 2}, {"minerai", "Pierre", 3}}, Effects: "défense +6", Defense: 6},
			{Materials: []Item{{"objet", "Bois", 4}, {"minerai", "Pierre", 6}, {"objet", "Corde", 1}}, Effects: "défense +9", Defense: 9},
			{Materials: []Item{{"objet", "Bois", 6}, {"minerai", "Pierre", 9}, {"objet", "Corde", 2}}, Effects: "défense +12", Defense: 12},
		},
	},
	"workshop": {
		Levels: []BuildingLevelDef{
			{Materials: []Item{{"objet", "Bois", 3}}, Effects: "crafts forge"},
			{Materials: []Item{{"objet", "Bois", 6}}, Effects: "coût PA chantiers -1"},
			{Materials: []Item{{"objet", "Bois", 9}, {"minerai", "Acier", 1}}, Effects: "recettes avancées"},
		},
	},
	"gate": {
		Levels: []BuildingLevelDef{
			{Materials: []Item{{"objet", "Bois", 2}, {"minerai", "Minerai de fer", 1}}, Effects: "défense +8 (fermée)", Defense: 8},
			{Materials: []Item{{"objet", "Bois", 4}, {"minerai", "Minerai de fer", 2}}, Effects: "défense +12", Defense: 12},
			{Materials: []Item{{"objet", "Bois", 6}, {"minerai", "Minerai de fer", 3}, {"minerai", "Acier", 1}}, Effects: "défense +16", Defense: 16},
		},
	},
	"wall": {
		Levels: []BuildingLevelDef{
			{Materials: []Item{{"minerai", "Pierre", 3}}, Effects: "défense +10", Defense: 10},
			{Materials: []Item{{"minerai", "Pierre", 6}}, Effects: "défense +15", Defense: 15},
			{Materials: []Item{{"minerai", "Pierre", 9}, {"minerai", "Brique", 2}}, Effects: "défense +20", Defense: 20},
		},
	},
	"kitchen": {
		Requires: []BuildingRequire{{"workshop", 1}},
		Levels: []BuildingLevelDef{
			{Materials: []Item{{"objet", "Bois", 3}}, Effects: "crafts cuisine"},
			{Materials: []Item{{"objet", "Bois", 6}}, Effects: "rations +1"},
			{Materials: []Item{{"objet", "Bois", 9}}, Effects: "banquets"},
		},
	},
	"panel": {
		Levels: []BuildingLevelDef{
			{Materials: []Item{{"objet", "Bois", 1}}, Effects: "journal"},
			{Materials: []Item{{"objet", "Bois", 2}}, Effects: "sondages"},
			{Materials: []Item{{"objet", "Bois", 3}}, Effects: "statistiques"},
		},
	},
	"recyclerie": {
		Requires: []BuildingRequire{{"workshop", 1}},
		Levels: []BuildingLevelDef{
			{Materials: []Item{{"objet", "Bois", 3}, {"minerai", "Pierre", 2}}, Effects: "débloque le recyclage des débris"},
			{Materials: []Item{{"objet", "Bois", 6}, {"minerai", "Pierre", 4}, {"objet", "Planche", 1}}, Effects: "recyclage plus efficace"},
			{Materials: []Item{{"objet", "Bois", 9}, {"minerai", "Pierre", 6}, {"minerai", "Brique", 1}}, Effects: "recyclage optimisé"},
		},
	},
	// Poste : le relais de courrier. Tant qu'elle n'est pas debout, on n'écrit à la
	// ville que depuis la ville (cf. chat.go / ChatAccess) ; une fois construite,
	// l'expédition reste jointe depuis le terrain. Le Panneau (déjà construit au
	// départ) est un prérequis thématique — il n'a jamais à être débloqué.
	"poste": {
		Requires: []BuildingRequire{{"panel", 1}},
		Levels: []BuildingLevelDef{
			{Materials: []Item{{"objet", "Bois", 3}, {"plante", "Fibre végétale", 2}}, Effects: "messagerie accessible depuis le terrain"},
			{Materials: []Item{{"objet", "Bois", 6}, {"objet", "Corde", 1}, {"objet", "Planche", 1}}, Effects: "courrier plus fiable"},
			{Materials: []Item{{"objet", "Bois", 9}, {"objet", "Planche", 2}, {"minerai", "Brique", 1}}, Effects: "relais permanent"},
		},
	},

	// ─── LES CINQ BÂTIMENTS DE SPÉCIALITÉ (2026-08-10) ─────────────────────────
	//
	// Pourquoi ils existent : une expédition de vingt construisait LES ONZE bâtiments du
	// catalogue (mesuré : 11 debout, 18 niveaux sur 33) — il n'y avait donc aucune
	// priorité à arbitrer, seulement une liste à dérouler. Un jeu de survie coopératif se
	// joue dans le choix « la ville peut avoir ceci OU cela cette semaine », pas dans
	// l'ordre de la liste.
	//
	// Chacun ouvre un AXE que rien d'autre ne couvre — soigner, voir, frapper, regarnir,
	// tenir plus nombreux — pour que l'arbitrage porte sur des choses incomparables et
	// non sur « lequel donne le plus de défense ». Tous plafonnent à trois niveaux comme
	// les autres.
	//
	// Ce qui les rend RARES : (1) un PRÉREQUIS qui demande d'avoir déjà investi ailleurs,
	// (2) leur plan tombe surtout des RUINES — finies sur une carte — et rarement de la
	// fouille ordinaire. On ne peut pas tout avoir ; c'est le sujet.
	"infirmerie": {
		Requires: []BuildingRequire{{"kitchen", 1}},
		Levels: []BuildingLevelDef{
			{Materials: []Item{{"objet", "Bois", 3}, {"plante", "Herbe médicinale", 2}}, Effects: "soigne 1 héros/jour"},
			{Materials: []Item{{"objet", "Bois", 6}, {"objet", "Cuir", 1}, {"plante", "Herbe médicinale", 3}}, Effects: "soigne 2 héros/jour"},
			{Materials: []Item{{"objet", "Bois", 9}, {"objet", "Planche", 2}, {"plante", "Sève de dryade", 1}}, Effects: "soins illimités et gratuits"},
		},
	},
	"cartographe": {
		Requires: []BuildingRequire{{"panel", 2}},
		Levels: []BuildingLevelDef{
			{Materials: []Item{{"objet", "Bois", 2}, {"plante", "Fibre végétale", 3}}, Effects: "vision des héros +1"},
			{Materials: []Item{{"objet", "Bois", 4}, {"objet", "Cuir", 2}, {"objet", "Corde", 1}}, Effects: "vision des héros +2"},
			{Materials: []Item{{"objet", "Bois", 6}, {"objet", "Planche", 2}, {"minerai", "Minerai d'argent", 1}}, Effects: "vision +2 et abords de la ville révélés"},
		},
	},
	"armurerie": {
		Requires: []BuildingRequire{{"workshop", 2}},
		Levels: []BuildingLevelDef{
			{Materials: []Item{{"minerai", "Minerai de fer", 3}, {"objet", "Bois", 2}}, Effects: "+1 force au combat"},
			{Materials: []Item{{"minerai", "Minerai de fer", 6}, {"minerai", "Acier", 1}, {"objet", "Cuir", 2}}, Effects: "+2 force au combat"},
			{Materials: []Item{{"minerai", "Minerai de fer", 9}, {"minerai", "Acier", 2}, {"minerai", "Minerai d'or", 1}}, Effects: "+3 force au combat"},
		},
	},
	"verger": {
		Requires: []BuildingRequire{{"well", 2}},
		Levels: []BuildingLevelDef{
			{Materials: []Item{{"plante", "Graines anciennes", 1}, {"objet", "Bois", 3}}, Effects: "regarnit 2 cases proches par vague"},
			{Materials: []Item{{"plante", "Graines anciennes", 2}, {"objet", "Bois", 6}, {"objet", "Corde", 1}}, Effects: "regarnit 4 cases proches par vague"},
			{Materials: []Item{{"plante", "Graines anciennes", 3}, {"objet", "Planche", 2}, {"objet", "Cœur de chêne ancien", 1}}, Effects: "regarnit 6 cases proches par vague"},
		},
	},
	"caserne": {
		Requires: []BuildingRequire{{"wall", 2}},
		Levels: []BuildingLevelDef{
			{Materials: []Item{{"objet", "Bois", 4}, {"minerai", "Pierre", 3}}, Effects: "garnison +4 au plafond"},
			{Materials: []Item{{"objet", "Bois", 8}, {"minerai", "Pierre", 6}, {"objet", "Cuir", 2}}, Effects: "garnison +8 au plafond"},
			{Materials: []Item{{"objet", "Bois", 12}, {"minerai", "Brique", 2}, {"minerai", "Acier", 1}}, Effects: "garnison +12 au plafond"},
		},
	},
}

// buildingLevelDef returns the design row for a building's given level (1-based),
// or nil when unknown / out of range.
func buildingLevelDef(id string, level int) *BuildingLevelDef {
	d, ok := BuildingDesigns[id]
	if !ok || level < 1 || level > len(d.Levels) {
		return nil
	}
	return &d.Levels[level-1]
}
