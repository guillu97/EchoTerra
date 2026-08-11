package game

// LES EXPÉDITIONS THÉMATIQUES — une carte qui a un caractère.
//
// Réponse au trou R5 de RETENTION-PLAN.md : rien ne distinguait l'expédition n°4 de la
// n°1. Toutes les parties sortaient du même worldgen, avec les mêmes six biomes, les
// mêmes cinq ruines et la même ville de chaume. Au bout de trois expéditions la carte
// n'avait plus rien à raconter.
//
// ⚠ LE PRINCIPE QUI REND LA CHOSE TENABLE : un thème est une PEAU et un BIAIS, jamais
// un jeu différent. Les six biomes gardent leurs identifiants (0..5) et surtout leur
// RÔLE ÉCONOMIQUE — le biome 3 est celui qui donne le bois, le biome 4 celui qui donne
// la pierre. Le thème change ce qu'ils sont à l'écran et dans le texte, et dans quelles
// PROPORTIONS ils entourent la ville.
//
// Ce n'est pas une prudence de principe, c'est ce que le code impose : Terrains (tables
// de fouille), Species.Biomes (apparitions), ruinDefs (une ruine et un plan de
// spécialité par biome), ensureNearbyBiomes (le gisement garanti) et botShoppingList
// (qui cherche littéralement « Bois » et « Pierre ») sont tous indexés par biome. Un
// thème « désert » qui SUPPRIMERAIT la forêt ne serait pas un thème : ce serait une
// partie sans bois, donc sans chantier, donc une défaite arithmétique — le piège est
// déjà mesuré deux fois dans les commentaires de worldgen.biomeQuota.
//
// La palmeraie du désert EST le biome forêt. D'où la règle corollaire :
//
// ⚠ LE RENOMMAGE EST DE LA PRÉSENTATION. Item.Name ne change JAMAIS (buildMaterials,
// les 26 recettes, botShoppingList et les tests lisent ces chaînes) ; Ruin.Type non plus
// (le client en dérive son modèle voxel). Seuls les LIBELLÉS changent.

// ThemeDef décrit une nature d'expédition. Sérialisable tel quel : le client le reçoit
// dans le payload de partie (ClientView) et par GET /api/themes, plutôt que de tenir sa
// propre copie du catalogue qui divergerait au premier ajout.
type ThemeDef struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Emoji   string `json:"emoji"`
	Tagline string `json:"tagline"`

	// Dominant est le biome qui ENTOURE LA VILLE — pas la carte entière. Le biais
	// décroît avec la distance (voir worldgen.applyThemeBias) : au loin, la carte
	// redevient elle-même, avec ses montagnes, ses forêts et ses lacs. C'est voulu :
	// la variété devient lointaine, donc elle se mérite, et le thème devient un
	// moteur d'exploration.
	Dominant Biome `json:"dominant"`
	// Bias est la probabilité de conversion AU CENTRE (0 = aucun biais : c'est le cas
	// du thème Tempéré, qui est la carte d'aujourd'hui et sert de référence
	// d'équilibrage).
	Bias float64 `json:"-"`

	// --- LA CONTRAINTE DU THÈME -----------------------------------------------------
	//
	// Un thème qui ne serait qu'une palette s'userait en deux expéditions. Chacun porte
	// donc UNE contrainte de survie : quelque chose que cette terre exige et qu'aucune
	// autre n'exige. Six règles l'encadrent (RETENTION-PLAN.md §8) — elle branche un
	// système qui EXISTE, elle est collective et se règle en ville, elle se paie en PA
	// ou en matériaux (donc en concurrence avec la défense), elle est annoncée par
	// l'ordre du jour, elle ne piège jamais un joueur absent, et elle passe le plancher
	// de survie sur toute la plage d'effectifs.

	// Thirst : les héros ont SOIF (thirst.go). C'est la contrainte désertique, et elle
	// ne construit rien : elle ALLUME un sous-système entier qui dormait. `StateSoif`
	// était déclaré, retiré par la boisson, par le Jus de fruit, par l'Élixir de givre,
	// consulté par les bots — et POSÉ PAR PERSONNE. Le puits, ses rations, sa capacité
	// par niveau, sa recharge et jusqu'à l'effet « rations +1 » de la Cuisine niveau 2
	// pendaient à un état qui n'arrivait jamais.
	Thirst bool `json:"thirst,omitempty"`
	// WellRefill remplace la recharge naturelle du puits entre deux vagues (0 = la
	// valeur ordinaire, wellRefillDefault). En désert elle est basse : c'est ce qui
	// force à ALLER CHERCHER l'eau au lieu d'attendre qu'elle revienne.
	WellRefill int `json:"wellRefill,omitempty"`
	// ExtraDrops ajoute des trouvailles à la table de fouille d'un biome. ⚠ AJOUTE :
	// un thème n'enlève jamais rien à un terrain, sinon il pourrait couper une ville de
	// son bois ou de sa pierre. En désert, la Palmeraie (le biome forêt) rend aussi de
	// l'eau : l'oasis est là où sont les palmiers, et comme le thème a justement
	// éloigné les palmiers de la ville, l'eau devient un voyage. Le même biome porte
	// alors le bois ET l'eau : une destination disputée, ce qui est le but.
	ExtraDrops map[Biome][]DropDef `json:"-"`

	// BiomeNames renomme les terrains à l'écran. Clé = biome, valeur = libellé.
	BiomeNames map[Biome]string `json:"biomeNames,omitempty"`
	// RuinNames rhabille les ruines-donjons. ⚠ le TYPE et la table de BUTIN restent
	// ceux du biome (ruins.go) : chaque ruine porte le plan d'une spécialité, et un
	// thème qui déplacerait ces plans rendrait des bâtiments inatteignables selon le
	// tirage. Un thème rhabille, il ne redistribue pas.
	RuinNames map[Biome]RuinSkin `json:"-"`
}

// RuinSkin est le nom et l'icône d'une ruine sous un thème donné.
type RuinSkin struct {
	Name string
	Icon string
}

// ThemeTempere est l'identifiant du thème de référence (la carte d'avant les thèmes).
const ThemeTempere = "tempere"

// Themes est le catalogue. L'ordre est stable : c'est celui du tirage.
var Themes = []ThemeDef{
	{
		ID:      ThemeTempere,
		Name:    "Tempéré",
		Emoji:   "🌿",
		Tagline: "Prairies, forêts et pluies fines — la terre que tout le monde connaît.",
		// Aucun biais : le monde tel que le bruit de Perlin le rend. C'est le témoin
		// dont dépend tout l'équilibrage.
		Dominant: BiomeGrass,
		Bias:     0,
	},
	{
		ID:       "nordique",
		Name:     "Nordique",
		Emoji:    "❄️",
		Tagline:  "Le gel tient la plaine et la nuit tombe tôt. On bâtit entre deux congères.",
		Dominant: BiomeSnow,
		Bias:     0.72,
		BiomeNames: map[Biome]string{
			BiomeWater:    "Eaux noires",
			BiomeSand:     "Grève de galets",
			BiomeGrass:    "Lande gelée",
			BiomeForest:   "Taïga",
			BiomeMountain: "Fjord rocheux",
			BiomeSnow:     "Névé",
		},
		RuinNames: map[Biome]RuinSkin{
			BiomeSand:     {"Drakkar échoué", "⛵"},
			BiomeGrass:    {"Longue maison abandonnée", "🏚️"},
			BiomeForest:   {"Sanctuaire runique", "🗿"},
			BiomeMountain: {"Mine effondrée", "⛏️"},
			BiomeSnow:     {"Tour de glace", "🗼"},
		},
	},
	{
		ID:       "desertique",
		Name:     "Désertique",
		Emoji:    "🏜️",
		Tagline:  "Ici l'eau se compte. Le puits fait la loi, et l'oasis est loin.",
		Dominant: BiomeSand,
		Bias:     0.72,
		// LA CONTRAINTE : l'eau. Boire une fois par jour, ou traîner la Soif.
		Thirst:     true,
		WellRefill: 4, // contre 10 ailleurs : le puits ne se remplit plus tout seul
		ExtraDrops: map[Biome][]DropDef{
			// La palmeraie EST l'oasis. Poids fort : c'est la raison d'y aller, et le
			// thème l'a mise loin.
			BiomeForest: {{"eau", "Ration d'eau", 1, 4}},
			// Une gorgée trouvée dans les dunes, rarement : de quoi rentrer, pas de quoi
			// s'installer.
			BiomeSand: {{"eau", "Ration d'eau", 1, 1}},
		},
		BiomeNames: map[Biome]string{
			BiomeWater:    "Oasis",
			BiomeSand:     "Dunes",
			BiomeGrass:    "Steppe aride",
			BiomeForest:   "Palmeraie",
			BiomeMountain: "Falaise de grès",
			BiomeSnow:     "Désert de sel",
		},
		RuinNames: map[Biome]RuinSkin{
			BiomeSand:     {"Pyramide ensablée", "🔺"},
			BiomeGrass:    {"Sphinx enseveli", "🗿"},
			BiomeForest:   {"Temple de la palmeraie", "🏛️"},
			BiomeMountain: {"Mine de grès", "⛏️"},
			BiomeSnow:     {"Tour de sel", "🗼"},
		},
	},
}

// ThemeByID rend le thème demandé, ou le thème tempéré si l'identifiant est vide ou
// inconnu. ⚠ jamais nil : une partie enregistrée avant les thèmes (ThemeID vide) doit
// continuer de tourner, et elle est tempérée par construction.
func ThemeByID(id string) *ThemeDef {
	for i := range Themes {
		if Themes[i].ID == id {
			return &Themes[i]
		}
	}
	return &Themes[0]
}

// PickTheme tire le thème d'une carte À PARTIR DE SA GRAINE — donc même graine, même
// thème, comme tout le reste du worldgen (cf. rng.go : rand.Seed est un no-op depuis
// Go 1.24, et compter dessus faisait mentir la promesse « même graine, même monde »).
//
// Le thème est un TIRAGE, jamais une récompense : on ne le débloque pas, on tombe
// dessus. C'est ce qui préserve l'égalité entre un vétéran et un débutant (même règle
// que les mémoriaux et les titres, RETENTION-PLAN.md P5/P7).
func PickTheme(seed int64) *ThemeDef {
	n := int64(len(Themes))
	if n == 0 {
		return nil
	}
	// Un mélange simple de la graine : les graines consécutives (time.UnixNano) ne
	// doivent pas donner trois fois le même thème d'affilée.
	h := uint64(seed) * 0x9e3779b97f4a7c15
	h ^= h >> 29
	return &Themes[int(h%uint64(n))]
}

// Theme rend le thème de cette partie (jamais nil, voir ThemeByID).
func (g *GameState) Theme() *ThemeDef {
	return ThemeByID(g.ThemeID)
}

// BiomeLabel rend le nom du terrain SOUS CE THÈME — « Taïga » plutôt que « Forêt ».
// C'est la seule façon dont un thème change un texte : le biome, lui, ne bouge pas.
func (g *GameState) BiomeLabel(b Biome) string {
	if names := g.Theme().BiomeNames; names != nil {
		if s, ok := names[b]; ok && s != "" {
			return s
		}
	}
	return b.Label()
}
