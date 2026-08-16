// Game-design data studio: JSON schemas for the buildings tech tree, the crafting
// catalog and the hero class tree. Authored in the designer UI, exported as JSON,
// then handed back to be implemented server-side. The seeds below mirror the
// CURRENT backend values (town.go / craft.go / classes.go) so the studio starts
// from the live game instead of a blank page.

export interface MaterialCost {
  name: string;
  qty: number;
}

export interface BuildingLevelDef {
  pa: number; // labour cost (action points)
  materials: MaterialCost[]; // taken from the Bank
  effects: string; // free text: what this level grants ("défense +6", "capacité +25"…)
}

export interface BuildingDef {
  id: string;
  name: string;
  icon: string; // emoji
  blurb: string;
  startsBuilt: boolean; // present at town creation (vs construction site)
  requires: { building: string; level: number }[]; // tech-tree prerequisites
  levels: BuildingLevelDef[]; // [0] = construction (niveau 1), then upgrades
}

export interface RecipeDef {
  id: string;
  name: string;
  icon: string;
  category: string; // conso | potion | forge | deco
  building: string; // required building id ("" = aucun)
  buildingLevel: number; // minimum level of that building
  field: boolean; // craftable outside town (campfire-style)
  pa: number;
  ingredients: MaterialCost[];
  output: { type: string; name: string; qty: number };
  effects: string; // what the item does when used/equipped
}

export interface StatsDef {
  force: number;
  dexterite: number;
  agilite: number;
  endurance: number;
  athletisme: number;
  precision: number;
  perception: number;
}

// One cell offset of a targeting/damage shape, relative to its anchor (the
// attacker for `targets`, the struck cell for `damage`) — GDD-style grids.
export interface GridCell {
  dx: number;
  dy: number;
}

// Iso-combat targeting helpers (Manhattan distance, like the combat engine).
export const manhattanCells = (min: number, max: number): GridCell[] => {
  const out: GridCell[] = [];
  for (let dy = -max; dy <= max; dy++)
    for (let dx = -max; dx <= max; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d >= min && d <= max) out.push({ dx, dy });
    }
  return out;
};

// An attack / combat ability with its GDD-style grids: `targets` = the cells the
// attacker can aim at (green grid), `damage` = the impact zone around the struck
// cell (red grid; empty = only the struck cell).
export interface AttackDef {
  name: string;
  kind: "base" | "special";
  pa: number;
  desc: string;
  effects: string; // dégâts, états infligés (Stun, Root…)
  targets: GridCell[];
  damage: GridCell[];
}

export interface SkillDef {
  name: string;
  scope: "map" | "iso"; // pouvoir sur la carte du monde vs en combat isométrique
  pa: number; // cost when activated (0 = passif)
  desc: string;
  effects: string; // numbers/mechanics for the implementation
  // Iso-combat grids (scope "iso" only): ciblage + zone de dégâts.
  targets?: GridCell[];
  damage?: GridCell[];
}

export interface HeroClassDef {
  id: string;
  name: string;
  tier: number; // 1 = intermédiaire, 2 = avancée
  day: number; // game.Day gate to evolve into it
  requires: string[]; // parent class ids (empty = reachable from "Sans classe")
  role: string;
  bonuses: StatsDef;
  paBonus: number;
  skills: SkillDef[];
  appearance: {
    map: string; // character asset file (char-*) used on the world map / combat
    icon: string; // character asset file used on the hero stats screen
  };
}

// One possible drop when searching a tile / looting a monster. `weight` is the
// draw weighting relative to the other drops of the same table (weight 2 = twice
// as likely as weight 1).
export interface ResourceDrop {
  type: string; // plante | animal | objet | minerai | eau | consommable…
  name: string;
  qty: number;
  weight: number;
}

// A TERRAIN (biome): walkability, worldgen richness and its search drop table.
export interface TerrainDef {
  id: string; // water | sand | grass | forest | mountain | snow
  name: string;
  icon: string;
  walkable: boolean;
  searchable: boolean;
  resourcesMin: number; // tile richness range at worldgen (number of searches)
  resourcesMax: number;
  drops: ResourceDrop[];
  notes: string;
}

// Canonical resource/item categories (a resource's `type`).
export const RESOURCE_CATEGORIES = [
  "objet",
  "minerai",
  "plante",
  "animal",
  "eau",
  "aliment",
  "consommable",
  "arme",
  "deco",
] as const;

// The RESOURCE catalog: every item that exists in the game — search loot, monster
// loot, construction materials, craft ingredients AND craft outputs. Everything
// else references these by name through dropdowns (no more free-text items).
export interface ResourceItemDef {
  id: string;
  name: string; // the in-game item name (matched by drops/costs/recipes)
  icon: string;
  type: string; // one of RESOURCE_CATEGORIES
  desc: string;
}

// A monster species: stats, where it spawns, what it drops when defeated.
export interface MonsterDef {
  id: string;
  name: string; // species (must match the game's Species strings)
  icon: string;
  appearance: string; // monster asset file (mob-*) for map & combat
  hp: number;
  stats: StatsDef;
  packMin: number; // pack size range at spawn (grows with waves/players)
  packMax: number;
  biomes: string[]; // biome ids where it can spawn
  attacks: AttackDef[]; // base attack + specials, with iso targeting/damage grids
  drops: ResourceDrop[]; // loot when the pack is defeated
  notes: string;
}

// Map-generation parameters (Perlin heightmap → biomes), previewed live in the
// designer and exported for the server implementation (worldgen.go).
export interface MapGenDef {
  seed: number;
  width: number;
  height: number;
  scale: number; // noise frequency (backend: 0.08) — smaller = larger landmasses
  octaves: number; // layered noise passes (backend: 3)
  persistence: number; // amplitude falloff per octave (backend: 0.5)
  maxHeight: number; // elevation levels (backend: 6)
  // Smoothing: max height difference between two orthogonal neighbours. 1 = very
  // gentle slopes (a level-6 mountain can never touch a level-0 plain).
  maxStep: number;
  // Ascending biome thresholds on the normalized height (snow = above mountain).
  thresholds: { water: number; sand: number; grass: number; forest: number; mountain: number };
  monsterPacks: number; // packs seeded at game start (solo baseline)
  packSizeMin: number;
  packSizeMax: number;
}

export interface DesignDoc {
  version: number;
  buildings: BuildingDef[];
  recipes: RecipeDef[];
  classes: HeroClassDef[];
  terrains: TerrainDef[]; // biomes (formerly exported as "resources")
  resources: ResourceItemDef[]; // the item catalog
  monsters: MonsterDef[];
  mapgen: MapGenDef;
}

export const emptyStats = (): StatsDef => ({
  force: 0,
  dexterite: 0,
  agilite: 0,
  endurance: 0,
  athletisme: 0,
  precision: 0,
  perception: 0,
});

// --- seeds: the CURRENT game data --------------------------------------------

const lvl = (pa: number, materials: MaterialCost[], effects: string): BuildingLevelDef => ({
  pa,
  materials,
  effects,
});
// Backend cost formula today (chantier flow): plan (1 PA) puis investissement — le
// niveau L exige basePA × L points d'action au total + matériaux de base × L.
// Seeded for levels 1..3 with each building's basePA (town.go buildPA).
const seedLevels = (basePA: number, base: MaterialCost[], fx: [string, string, string]): BuildingLevelDef[] => [
  lvl(basePA, base.map((m) => ({ ...m })), fx[0]),
  lvl(basePA * 2, base.map((m) => ({ ...m, qty: m.qty * 2 })), fx[1]),
  lvl(basePA * 3, base.map((m) => ({ ...m, qty: m.qty * 3 })), fx[2]),
];

const seedBuildings = (): BuildingDef[] => [
  { id: "townhall", name: "Townhall", icon: "🏛️", blurb: "Cœur de la ville. Lit : ressuscite un héros épuisé.", startsBuilt: false, requires: [{ building: "workshop", level: 1 }], levels: seedLevels(20, [{ name: "Bois", qty: 4 }, { name: "Pierre", qty: 2 }], ["débloque Ressusciter", "revive +1/jour", "revive gratuit"]) },
  { id: "well", name: "Well", icon: "💧", blurb: "Source d'eau de la ville (1 ration/héros/jour).", startsBuilt: true, requires: [], levels: seedLevels(10, [{ name: "Pierre", qty: 2 }], ["capacité 50", "capacité 75", "capacité 112"]) },
  { id: "bank", name: "Bank", icon: "🏦", blurb: "Stocke les ressources & matériaux communs.", startsBuilt: true, requires: [], levels: seedLevels(12, [{ name: "Bois", qty: 2 }], ["capacité 500", "capacité 750", "capacité 1125"]) },
  { id: "tower", name: "Tower", icon: "🗼", blurb: "Tour de guet : défense et évaluation de la horde.", startsBuilt: false, requires: [{ building: "wall", level: 1 }], levels: seedLevels(15, [{ name: "Bois", qty: 2 }, { name: "Pierre", qty: 3 }], ["défense +6", "défense +9", "défense +12"]) },
  { id: "workshop", name: "Workshop", icon: "🔨", blurb: "Menuiserie & forge — gère les constructions et les crafts forge.", startsBuilt: true, requires: [], levels: seedLevels(15, [{ name: "Bois", qty: 3 }], ["crafts forge", "coût PA chantiers -1", "recettes avancées"]) },
  { id: "gate", name: "Gate", icon: "🚪", blurb: "Porte de la ville : fermée = ville scellée (défense max), ouverte = passage libre.", startsBuilt: true, requires: [{ building: "wall", level: 1 }], levels: seedLevels(12, [{ name: "Bois", qty: 2 }, { name: "Minerai de fer", qty: 1 }], ["défense +8 (fermée)", "défense +12", "défense +16"]) },
  { id: "wall", name: "Wall", icon: "🧱", blurb: "Muraille défensive.", startsBuilt: true, requires: [], levels: seedLevels(15, [{ name: "Pierre", qty: 3 }], ["défense +10", "défense +15", "défense +20"]) },
  { id: "kitchen", name: "Kitchen", icon: "🍳", blurb: "Cuisine : débloque les crafts conso en ville.", startsBuilt: false, requires: [{ building: "well", level: 1 }], levels: seedLevels(12, [{ name: "Bois", qty: 3 }], ["crafts cuisine", "rations +1", "banquets"]) },
  { id: "panel", name: "Panel", icon: "📋", blurb: "Panneau : journal de la ville, sondages, membres.", startsBuilt: true, requires: [], levels: seedLevels(6, [{ name: "Bois", qty: 1 }], ["journal", "sondages", "statistiques"]) },
];

const seedRecipes = (): RecipeDef[] => [
  { id: "mapo_curry", name: "Mapo Curry", icon: "🍛", category: "conso", building: "kitchen", buildingLevel: 1, field: true, pa: 1, ingredients: [{ name: "Viande", qty: 2 }, { name: "Fleur", qty: 1 }], output: { type: "aliment", name: "Mapo Curry", qty: 1 }, effects: "Restaure la faim (+40)" },
  { id: "orange_juice", name: "Jus de fruit", icon: "🧃", category: "conso", building: "kitchen", buildingLevel: 1, field: true, pa: 1, ingredients: [{ name: "Fleur", qty: 2 }], output: { type: "aliment", name: "Jus de fruit", qty: 1 }, effects: "Désaltère (retire Soif)" },
  { id: "healing_potion", name: "Potion de soin", icon: "🧪", category: "potion", building: "kitchen", buildingLevel: 1, field: true, pa: 1, ingredients: [{ name: "Herbe médicinale", qty: 2 }], output: { type: "consommable", name: "Potion de soin", qty: 1 }, effects: "+8 PV, retire Blessé" },
  { id: "iron_blade", name: "Lame de fer", icon: "🗡️", category: "forge", building: "workshop", buildingLevel: 1, field: false, pa: 2, ingredients: [{ name: "Minerai de fer", qty: 2 }, { name: "Bois", qty: 1 }], output: { type: "arme", name: "Lame de fer", qty: 1 }, effects: "Arme : +3 force en combat" },
  { id: "wooden_totem", name: "Totem de bois", icon: "🗿", category: "deco", building: "workshop", buildingLevel: 1, field: false, pa: 1, ingredients: [{ name: "Bois", qty: 3 }], output: { type: "deco", name: "Totem de bois", qty: 1 }, effects: "Décoration (moral de la ville)" },
  { id: "recycle_wood", name: "Recyclage → Bois", icon: "♻️", category: "forge", building: "workshop", buildingLevel: 1, field: false, pa: 1, ingredients: [{ name: "Débris", qty: 3 }], output: { type: "objet", name: "Bois", qty: 1 }, effects: "Recycle 3 débris en 1 Bois" },
  { id: "recycle_stone", name: "Recyclage → Pierre", icon: "♻️", category: "forge", building: "workshop", buildingLevel: 1, field: false, pa: 1, ingredients: [{ name: "Débris", qty: 3 }], output: { type: "minerai", name: "Pierre", qty: 1 }, effects: "Recycle 3 débris en 1 Pierre" },
];

const seedClasses = (): HeroClassDef[] => [
  { id: "pionnier", name: "Pionnier", tier: 1, day: 2, requires: [], role: "Robuste et débrouillard, il ouvre la voie et affronte les obstacles de front.", bonuses: { ...emptyStats(), force: 5, athletisme: 3, endurance: 2 }, paBonus: 1, skills: [
    { name: "Poussée du Survivant", scope: "map", pa: 1, desc: "Force un passage là où les autres doivent contourner.", effects: "ignore 1 case bloquée" },
    { name: "Frappe de la mort qui tue", scope: "iso", pa: 2, desc: "Attaque puissante.", effects: "+5 dégâts", targets: manhattanCells(1, 1), damage: [] },
  ], appearance: { map: "char-builder", icon: "char-builder" } },
  { id: "chasseur", name: "Chasseur", tier: 1, day: 2, requires: [], role: "Traqueur précis qui trouve et élimine sa cible.", bonuses: { ...emptyStats(), dexterite: 5, precision: 3, endurance: 2 }, paBonus: 1, skills: [
    { name: "Tir précis", scope: "map", pa: 1, desc: "Élimine un monstre affaibli sur sa case.", effects: "tue si PV pack ≤ 5" },
    { name: "Tir de zone", scope: "iso", pa: 2, desc: "Dégâts de zone.", effects: "+3 dégâts par case touchée", targets: manhattanCells(2, 3), damage: [{ dx: 0, dy: 0 }, ...manhattanCells(1, 1)] },
  ], appearance: { map: "char-archer", icon: "char-archer" } },
  { id: "eclaireur", name: "Éclaireur", tier: 1, day: 2, requires: [], role: "Discret et rapide, il voit loin et repère les dangers avant les autres.", bonuses: { ...emptyStats(), perception: 5, agilite: 3, endurance: 2 }, paBonus: 0, skills: [
    { name: "Observation Large", scope: "map", pa: 0, desc: "Vision étendue autour de lui.", effects: "+1 case de vision (passif)" },
    { name: "Éclairer", scope: "iso", pa: 0, desc: "Illumine 4 cases.", effects: "passif" },
  ], appearance: { map: "char-scout", icon: "char-scout" } },
  { id: "gardien", name: "Gardien", tier: 2, day: 4, requires: ["pionnier"], role: "Protecteur du groupe et du territoire : encaisse et sécurise les zones dangereuses.", bonuses: { ...emptyStats(), endurance: 5, force: 5 }, paBonus: 1, skills: [
    { name: "Rassure", scope: "map", pa: 0, desc: "Compte pour 3 héros face à une horde.", effects: "poids 3 dans le calcul Tétanisé (passif)" },
    { name: "Posture défensive", scope: "iso", pa: 1, desc: "Réduit les dégâts subis.", effects: "-50% dégâts jusqu'au prochain tour", targets: [{ dx: 0, dy: 0 }], damage: [] },
  ], appearance: { map: "char-knight", icon: "char-knight" } },
  { id: "recuperateur", name: "Récupérateur", tier: 2, day: 4, requires: ["chasseur", "eclaireur"], role: "Récupère tout ce qui traîne : fragments, restes, débris, matériaux et objets tombés.", bonuses: { ...emptyStats(), athletisme: 5, endurance: 3, force: 2 }, paBonus: 1, skills: [
    { name: "Sac élargi", scope: "map", pa: 0, desc: "Transporte plus lors d'une fouille.", effects: "+1 ressource par fouille (passif)" },
    { name: "Récupération", scope: "iso", pa: 0, desc: "Butin supplémentaire sur les ennemis vaincus.", effects: "+1 trophée par victoire (passif)" },
  ], appearance: { map: "char-merchant", icon: "char-merchant" } },
  { id: "herboriste", name: "Herboriste & Minéral", tier: 2, day: 4, requires: ["eclaireur"], role: "Récolte les plantes, herbes rares et minerais simples.", bonuses: { ...emptyStats(), precision: 4, dexterite: 3, endurance: 3 }, paBonus: 1, skills: [
    { name: "Récolte Délicate", scope: "map", pa: 0, desc: "Récolte assurée sur plantes et minéraux.", effects: "+1 ressource plante/minerai (passif)" },
    { name: "Résistance", scope: "iso", pa: 0, desc: "Résiste aux biomes hostiles.", effects: "immunisé froid/chaleur/toxique (passif)" },
  ], appearance: { map: "char-healer", icon: "char-healer" } },
];

// Search loot mirrors actions.go lootForBiome (uniform draw → weight 1 each);
// richness mirrors worldgen (forest/grass 3–6 searches, others 1–3, water 0).
const drop = (type: string, name: string, qty = 1, weight = 1): ResourceDrop => ({ type, name, qty, weight });

// The item catalog: every item name used by the current game (loot tables, craft
// ingredients/outputs, construction materials, well ration, combat trophy).
const item = (id: string, name: string, icon: string, type: string, desc = ""): ResourceItemDef => ({ id, name, icon, type, desc });
const seedItems = (): ResourceItemDef[] => [
  item("bois", "Bois", "🪵", "objet", "Matériau de construction de base."),
  item("pierre", "Pierre", "🪨", "minerai", "Matériau de construction."),
  item("minerai-fer", "Minerai de fer", "⛓️", "minerai", "Minerai pour la forge."),
  item("debris", "Débris", "🧱", "objet", "Restes récupérés en fouille."),
  item("fleur", "Fleur", "🌸", "plante", "Plante commune des plaines."),
  item("herbe-medicinale", "Herbe médicinale", "🌿", "plante", "Base des potions de soin."),
  item("viande", "Viande", "🍖", "animal", "Nourriture crue."),
  item("peau", "Peau", "🟤", "animal", "Peau de bête (artisanat)."),
  item("trophee", "Trophée de monstre", "🏆", "animal", "Preuve de victoire sur un pack."),
  item("ration-eau", "Ration d'eau", "💧", "eau", "Une ration du puits — étanche la Soif."),
  item("mapo-curry", "Mapo Curry", "🍛", "aliment", "Plat cuisiné (craft)."),
  item("jus-fruit", "Jus de fruit", "🧃", "aliment", "Boisson (craft)."),
  item("potion-soin", "Potion de soin", "🧪", "consommable", "+8 PV, retire Blessé (craft)."),
  item("lame-fer", "Lame de fer", "🗡️", "arme", "Arme forgée : +3 force (craft)."),
  item("totem-bois", "Totem de bois", "🗿", "deco", "Décoration (craft)."),
];

const seedTerrains = (): TerrainDef[] => [
  { id: "water", name: "Eau", icon: "🌊", walkable: false, searchable: false, resourcesMin: 0, resourcesMax: 0, drops: [], notes: "Infranchissable. Rien à fouiller." },
  { id: "sand", name: "Sable", icon: "🏜️", walkable: true, searchable: true, resourcesMin: 3, resourcesMax: 6, drops: [drop("plante", "Fleur"), drop("animal", "Viande"), drop("objet", "Débris")], notes: "" },
  { id: "grass", name: "Plaine", icon: "🌾", walkable: true, searchable: true, resourcesMin: 3, resourcesMax: 6, drops: [drop("plante", "Fleur"), drop("animal", "Viande"), drop("objet", "Débris")], notes: "Biome de départ autour de la ville." },
  { id: "forest", name: "Forêt", icon: "🌲", walkable: true, searchable: true, resourcesMin: 3, resourcesMax: 6, drops: [drop("objet", "Bois", 1, 3), drop("plante", "Herbe médicinale"), drop("animal", "Peau")], notes: "Source principale de bois." },
  { id: "mountain", name: "Montagne", icon: "⛰️", walkable: true, searchable: true, resourcesMin: 2, resourcesMax: 4, drops: [drop("minerai", "Pierre"), drop("minerai", "Minerai de fer")], notes: "Source de pierre/fer." },
  { id: "snow", name: "Neige", icon: "❄️", walkable: true, searchable: true, resourcesMin: 2, resourcesMax: 4, drops: [drop("minerai", "Pierre"), drop("minerai", "Minerai de fer")], notes: "Source de pierre/fer." },
];

// Species mirror monsters.go (stats/PV/pack) and combat.go SkillFor (specials);
// defeat loot is today a single generic trophy (actions.go). Attack grids: base
// attacks are melee (4 orthogonal cells); the wind elemental's special reaches 3.
const melee = manhattanCells(1, 1);
const atk = (name: string, kind: "base" | "special", pa: number, desc: string, effects: string, targets: GridCell[], damage: GridCell[] = []): AttackDef => ({ name, kind, pa, desc, effects, targets, damage });

const seedMonsters = (): MonsterDef[] => [
  { id: "slime", name: "Slime Vorace", icon: "🟣", appearance: "mob-slime", hp: 9, stats: { ...emptyStats(), force: 2, agilite: 1, endurance: 4, precision: 2 }, packMin: 1, packMax: 2, biomes: ["sand", "grass", "forest", "mountain", "snow"], attacks: [
    atk("Coup gluant", "base", 1, "Attaque de mêlée.", "dégâts = force", melee),
    atk("Absorbe", "special", 1, "Régénère en absorbant sa cible.", "dégâts + soin égal aux dégâts infligés", melee),
  ], drops: [drop("animal", "Trophée de monstre")], notes: "" },
  { id: "goblin", name: "Goblin Pillard", icon: "👺", appearance: "mob-goblin", hp: 6, stats: { ...emptyStats(), force: 4, agilite: 4, endurance: 1, precision: 2 }, packMin: 1, packMax: 2, biomes: ["sand", "grass", "forest", "mountain", "snow"], attacks: [
    atk("Coup de dague", "base", 1, "Attaque de mêlée.", "dégâts = force", melee),
    atk("Tranche vicieuse", "special", 1, "Frappe sournoise en mêlée.", "dégâts +2", melee),
  ], drops: [drop("animal", "Trophée de monstre")], notes: "" },
  { id: "windelemental", name: "Elementaire de Vent", icon: "🌀", appearance: "mob-windelemental", hp: 10, stats: { ...emptyStats(), dexterite: 2, agilite: 3, endurance: 5, precision: 2 }, packMin: 1, packMax: 2, biomes: ["sand", "grass", "forest", "mountain", "snow"], attacks: [
    atk("Souffle", "base", 1, "Attaque de mêlée.", "dégâts = force", melee),
    atk("Colonne de Vent", "special", 1, "Colonne d'air à distance.", "dégâts + Stun", manhattanCells(1, 3)),
  ], drops: [drop("animal", "Trophée de monstre")], notes: "" },
];

// Defaults mirror the current worldgen.go (scale 0.08, 3 octaves, GDD thresholds,
// heightLevel = round(v×6)) plus the new smoothing knob.
const seedMapGen = (): MapGenDef => ({
  seed: 42,
  width: 22,
  height: 22,
  scale: 0.08,
  octaves: 3,
  persistence: 0.5,
  maxHeight: 6,
  maxStep: 1,
  thresholds: { water: 0.3, sand: 0.35, grass: 0.6, forest: 0.75, mountain: 0.9 },
  monsterPacks: 4,
  packSizeMin: 1,
  packSizeMax: 2,
});

export const DESIGN_DOC_VERSION = 1;

// Migrate older saved/imported docs in place: monsters used to carry a free-text
// `special` instead of the attacks list with targeting grids.
export function normalizeDoc(d: DesignDoc): DesignDoc {
  // "resources" used to hold the BIOMES (now "terrains"); the key now holds the
  // item catalog. Old docs/exports: biome-shaped entries carry `searchable`.
  const legacyResources = (d as { resources?: unknown[] }).resources;
  const looksLikeTerrains = Array.isArray(legacyResources) && legacyResources.some((r) => typeof (r as TerrainDef).searchable === "boolean");
  // Legacy data always wins over the seeded terrains (loadSavedDoc spreads seedDoc()
  // first, so d.terrains is an array even when the saved doc predates it).
  if (looksLikeTerrains) d.terrains = legacyResources as unknown as TerrainDef[];
  else if (!Array.isArray(d.terrains)) d.terrains = seedTerrains();
  if (!Array.isArray(d.resources) || looksLikeTerrains) d.resources = seedItems();
  d.monsters = (d.monsters ?? []).map((m) => {
    const legacy = m as MonsterDef & { special?: string };
    if (!Array.isArray(m.attacks)) {
      m.attacks = [
        atk("Attaque de base", "base", 1, "Attaque de mêlée.", "dégâts = force", manhattanCells(1, 1)),
        ...(legacy.special
          ? [atk("Spécial", "special", 1, legacy.special, "", manhattanCells(1, 1))]
          : []),
      ];
    }
    delete legacy.special;
    return m;
  });
  d.classes = (d.classes ?? []).map((c) => ({
    ...c,
    skills: (c.skills ?? []).map((s) => ({ targets: s.targets, damage: s.damage, ...s })),
  }));
  return d;
}

export function seedDoc(): DesignDoc {
  return {
    version: DESIGN_DOC_VERSION,
    buildings: seedBuildings(),
    recipes: seedRecipes(),
    classes: seedClasses(),
    terrains: seedTerrains(),
    resources: seedItems(),
    monsters: seedMonsters(),
    mapgen: seedMapGen(),
  };
}
