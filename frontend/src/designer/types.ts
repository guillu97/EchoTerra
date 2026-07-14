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
}

export interface SkillDef {
  name: string;
  scope: "map" | "iso"; // pouvoir sur la carte du monde vs en combat isométrique
  pa: number; // cost when activated (0 = passif)
  desc: string;
  effects: string; // numbers/mechanics for the implementation
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

export interface DesignDoc {
  version: number;
  buildings: BuildingDef[];
  recipes: RecipeDef[];
  classes: HeroClassDef[];
}

export const emptyStats = (): StatsDef => ({
  force: 0,
  dexterite: 0,
  agilite: 0,
  endurance: 0,
  athletisme: 0,
  precision: 0,
});

// --- seeds: the CURRENT game data --------------------------------------------

const lvl = (pa: number, materials: MaterialCost[], effects: string): BuildingLevelDef => ({
  pa,
  materials,
  effects,
});
// Backend cost formula today: build = 2 PA + base materials; upgrade level L->L+1 =
// (2+L) PA + base materials × (L+1). Seeded for levels 1..3.
const seedLevels = (base: MaterialCost[], fx: [string, string, string]): BuildingLevelDef[] => [
  lvl(2, base.map((m) => ({ ...m })), fx[0]),
  lvl(3, base.map((m) => ({ ...m, qty: m.qty * 2 })), fx[1]),
  lvl(4, base.map((m) => ({ ...m, qty: m.qty * 3 })), fx[2]),
];

const seedBuildings = (): BuildingDef[] => [
  { id: "townhall", name: "Townhall", icon: "🏛️", blurb: "Cœur de la ville. Lit : ressuscite un héros épuisé.", startsBuilt: false, requires: [{ building: "workshop", level: 1 }], levels: seedLevels([{ name: "Bois", qty: 4 }, { name: "Pierre", qty: 2 }], ["débloque Ressusciter", "revive +1/jour", "revive gratuit"]) },
  { id: "well", name: "Well", icon: "💧", blurb: "Source d'eau de la ville (1 ration/héros/jour).", startsBuilt: true, requires: [], levels: seedLevels([{ name: "Pierre", qty: 2 }], ["capacité 50", "capacité 75", "capacité 112"]) },
  { id: "bank", name: "Bank", icon: "🏦", blurb: "Stocke les ressources & matériaux communs.", startsBuilt: true, requires: [], levels: seedLevels([{ name: "Bois", qty: 2 }], ["capacité 500", "capacité 750", "capacité 1125"]) },
  { id: "tower", name: "Tower", icon: "🗼", blurb: "Tour de guet : défense et évaluation de la horde.", startsBuilt: false, requires: [{ building: "wall", level: 1 }], levels: seedLevels([{ name: "Bois", qty: 2 }, { name: "Pierre", qty: 3 }], ["défense +6", "défense +9", "défense +12"]) },
  { id: "workshop", name: "Workshop", icon: "🔨", blurb: "Menuiserie & forge — gère les constructions et les crafts forge.", startsBuilt: true, requires: [], levels: seedLevels([{ name: "Bois", qty: 3 }], ["crafts forge", "coût PA chantiers -1", "recettes avancées"]) },
  { id: "gate", name: "Gate", icon: "🚪", blurb: "Porte de la ville : fermée = ville scellée (défense max), ouverte = passage libre.", startsBuilt: true, requires: [{ building: "wall", level: 1 }], levels: seedLevels([{ name: "Bois", qty: 2 }, { name: "Minerai de fer", qty: 1 }], ["défense +8 (fermée)", "défense +12", "défense +16"]) },
  { id: "wall", name: "Wall", icon: "🧱", blurb: "Muraille défensive.", startsBuilt: true, requires: [], levels: seedLevels([{ name: "Pierre", qty: 3 }], ["défense +10", "défense +15", "défense +20"]) },
  { id: "kitchen", name: "Kitchen", icon: "🍳", blurb: "Cuisine : débloque les crafts conso en ville.", startsBuilt: false, requires: [{ building: "well", level: 1 }], levels: seedLevels([{ name: "Bois", qty: 3 }], ["crafts cuisine", "rations +1", "banquets"]) },
  { id: "panel", name: "Panel", icon: "📋", blurb: "Panneau : journal de la ville, sondages, membres.", startsBuilt: true, requires: [], levels: seedLevels([{ name: "Bois", qty: 1 }], ["journal", "sondages", "statistiques"]) },
];

const seedRecipes = (): RecipeDef[] => [
  { id: "mapo_curry", name: "Mapo Curry", icon: "🍛", category: "conso", building: "kitchen", buildingLevel: 1, field: true, pa: 1, ingredients: [{ name: "Viande", qty: 2 }, { name: "Fleur", qty: 1 }], output: { type: "aliment", name: "Mapo Curry", qty: 1 }, effects: "Restaure la faim (+40)" },
  { id: "orange_juice", name: "Jus de fruit", icon: "🧃", category: "conso", building: "kitchen", buildingLevel: 1, field: true, pa: 1, ingredients: [{ name: "Fleur", qty: 2 }], output: { type: "aliment", name: "Jus de fruit", qty: 1 }, effects: "Désaltère (retire Soif)" },
  { id: "healing_potion", name: "Potion de soin", icon: "🧪", category: "potion", building: "kitchen", buildingLevel: 1, field: true, pa: 1, ingredients: [{ name: "Herbe médicinale", qty: 2 }], output: { type: "consommable", name: "Potion de soin", qty: 1 }, effects: "+8 PV, retire Blessé" },
  { id: "iron_blade", name: "Lame de fer", icon: "🗡️", category: "forge", building: "workshop", buildingLevel: 1, field: false, pa: 2, ingredients: [{ name: "Minerai de fer", qty: 2 }, { name: "Bois", qty: 1 }], output: { type: "arme", name: "Lame de fer", qty: 1 }, effects: "Arme : +3 force en combat" },
  { id: "wooden_totem", name: "Totem de bois", icon: "🗿", category: "deco", building: "workshop", buildingLevel: 1, field: false, pa: 1, ingredients: [{ name: "Bois", qty: 3 }], output: { type: "deco", name: "Totem de bois", qty: 1 }, effects: "Décoration (moral de la ville)" },
];

const seedClasses = (): HeroClassDef[] => [
  { id: "pionnier", name: "Pionnier", tier: 1, day: 2, requires: [], role: "Robuste et débrouillard, il ouvre la voie et affronte les obstacles de front.", bonuses: { ...emptyStats(), force: 5, endurance: 3 }, paBonus: 1, skills: [
    { name: "Poussée du Survivant", scope: "map", pa: 1, desc: "Force un passage là où les autres doivent contourner.", effects: "ignore 1 case bloquée" },
    { name: "Frappe de la mort qui tue", scope: "iso", pa: 2, desc: "Attaque puissante.", effects: "+5 dégâts" },
  ], appearance: { map: "char-builder", icon: "char-builder" } },
  { id: "chasseur", name: "Chasseur", tier: 1, day: 2, requires: [], role: "Traqueur précis qui trouve et élimine sa cible.", bonuses: { ...emptyStats(), dexterite: 5, agilite: 3, endurance: 2 }, paBonus: 1, skills: [
    { name: "Tir précis", scope: "map", pa: 1, desc: "Élimine un monstre affaibli sur sa case.", effects: "tue si PV pack ≤ 5" },
    { name: "Tir de zone", scope: "iso", pa: 2, desc: "Dégâts de zone.", effects: "+3 dégâts par case touchée" },
  ], appearance: { map: "char-archer", icon: "char-archer" } },
  { id: "eclaireur", name: "Éclaireur", tier: 1, day: 2, requires: [], role: "Discret et rapide, il voit loin et repère les dangers avant les autres.", bonuses: { ...emptyStats(), athletisme: 5, agilite: 3, endurance: 2 }, paBonus: 0, skills: [
    { name: "Observation Large", scope: "map", pa: 0, desc: "Vision étendue autour de lui.", effects: "+1 case de vision (passif)" },
    { name: "Éclairer", scope: "iso", pa: 0, desc: "Illumine 4 cases.", effects: "passif" },
  ], appearance: { map: "char-scout", icon: "char-scout" } },
  { id: "gardien", name: "Gardien", tier: 2, day: 4, requires: ["pionnier"], role: "Protecteur du groupe et du territoire : encaisse et sécurise les zones dangereuses.", bonuses: { ...emptyStats(), force: 5, endurance: 3 }, paBonus: 1, skills: [
    { name: "Rassure", scope: "map", pa: 0, desc: "Compte pour 3 héros face à une horde.", effects: "poids 3 dans le calcul Tétanisé (passif)" },
    { name: "Posture défensive", scope: "iso", pa: 1, desc: "Réduit les dégâts subis.", effects: "-50% dégâts jusqu'au prochain tour" },
  ], appearance: { map: "char-knight", icon: "char-knight" } },
  { id: "recuperateur", name: "Récupérateur", tier: 2, day: 4, requires: ["chasseur", "eclaireur"], role: "Récupère tout ce qui traîne : fragments, restes, débris, matériaux et objets tombés.", bonuses: { ...emptyStats(), athletisme: 5, agilite: 3, endurance: 2 }, paBonus: 1, skills: [
    { name: "Sac élargi", scope: "map", pa: 0, desc: "Transporte plus lors d'une fouille.", effects: "+1 ressource par fouille (passif)" },
    { name: "Récupération", scope: "iso", pa: 0, desc: "Butin supplémentaire sur les ennemis vaincus.", effects: "+1 trophée par victoire (passif)" },
  ], appearance: { map: "char-merchant", icon: "char-merchant" } },
  { id: "herboriste", name: "Herboriste & Minéral", tier: 2, day: 4, requires: ["eclaireur"], role: "Récolte les plantes, herbes rares et minerais simples.", bonuses: { ...emptyStats(), athletisme: 5, agilite: 3, endurance: 2 }, paBonus: 1, skills: [
    { name: "Récolte Délicate", scope: "map", pa: 0, desc: "Récolte assurée sur plantes et minéraux.", effects: "+1 ressource plante/minerai (passif)" },
    { name: "Résistance", scope: "iso", pa: 0, desc: "Résiste aux biomes hostiles.", effects: "immunisé froid/chaleur/toxique (passif)" },
  ], appearance: { map: "char-healer", icon: "char-healer" } },
];

export const DESIGN_DOC_VERSION = 1;

export function seedDoc(): DesignDoc {
  return { version: DESIGN_DOC_VERSION, buildings: seedBuildings(), recipes: seedRecipes(), classes: seedClasses() };
}
