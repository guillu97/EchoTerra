// Layout/flavor config for the town buildings. Gameplay stats (level, durability,
// capacity, build progress) come from the backend (game.town.buildings, matched by id).
import type { AssetKey } from "../assets";

// PV de ville rendus par point d'action à l'action « repair » des remparts. Miroir de
// game.TownRepairHP (backend/internal/game/town.go) — garder les deux d'accord.
export const TOWN_REPAIR_HP = 5;

export interface BuildingLayout {
  id: string;
  name: string;
  icon: string; // emoji fallback (shown when the generated asset isn't available)
  assetKey: AssetKey; // key into the asset registry (scripts/generate-assets.mjs)
  blurb: string;
  primary: string; // label of the building's special "use" action ("" = none)
  island: string; // which island it sits on (see ISLANDS)
  x: number; // % position WITHIN its island box (centered anchor)
  y: number;
}

// The town is an archipelago of floating islands linked by bridges. Each island is a
// positioned box (% center in the .town container, px size); buildings are % children
// of their island. Tune these freely — positions are intentionally data-driven.
export interface IslandDef {
  id: string;
  x: number; // % center within .town
  y: number;
  size: number; // px (width = height, square island art)
}

// Positions are % of a SQUARE archipelago stage (so bridge angles compute correctly).
export const ISLANDS: IslandDef[] = [
  { id: "core", x: 50, y: 50, size: 240 }, // civic heart (center, largest)
  { id: "ne", x: 81, y: 31, size: 150 }, // defense outpost (up-right)
  { id: "sw", x: 19, y: 69, size: 150 }, // production yard (down-left)
];

// Bridges connect island pairs (drawn rotated/scaled between their centers).
export const BRIDGES: [string, string][] = [
  ["core", "ne"],
  ["core", "sw"],
];

// Building size as a fraction of its island's size (so satellites get smaller sprites).
export const BUILDING_SCALE = 0.34;

// NOTE: le rendu VOXEL de la ville (le défaut) génère son plan dans
// `voxel/townLayout.ts` à partir de l'état de jeu — il ne lit plus
// `src/data/town-map.json`. Ce fichier ne sert plus qu'au rendu « Classique »
// de secours (`components/TownMap.tsx`). TOWN_BUILDINGS reste le catalogue
// côté jeu : noms, icônes, descriptions et métadonnées de modale, appariés aux
// ids de bâtiment du backend.

// x/y are % positions WITHIN the building's island box (centered anchor). Buildings are
// spread across three islands: core (civic), ne (defense), sw (production).
export const TOWN_BUILDINGS: BuildingLayout[] = [
  // Core island — civic heart.
  { id: "townhall", name: "Mairie", icon: "🏛️", assetKey: "building-townhall", blurb: "Cœur de la ville. Lit : ressuscite un héros épuisé.", primary: "Ressusciter un héros", island: "core", x: 50, y: 40 },
  { id: "bank",     name: "Banque",   icon: "🏦",  assetKey: "building-bank",     blurb: "Stocke les ressources & matériaux communs.", primary: "Entrer", island: "core", x: 32, y: 56 },
  { id: "panel",    name: "Panneau",  icon: "📋",  assetKey: "building-panel",    blurb: "Journal, sondage, membres.", primary: "Journal", island: "core", x: 68, y: 56 },
  // NE island — defense outpost.
  { id: "wall",     name: "Muraille", icon: "🧱",  assetKey: "building-wall",     blurb: "Muraille défensive.", primary: "", island: "ne", x: 36, y: 38 },
  { id: "tower",    name: "Tour",     icon: "🗼",  assetKey: "building-tower",    blurb: "Augmente vos dégâts contre la vague.", primary: "Évaluer l'attaque", island: "ne", x: 60, y: 40 },
  { id: "gate",     name: "Portail",  icon: "🚪",  assetKey: "building-gate",     blurb: "Grande porte de la ville.", primary: "Ouvrir / Fermer", island: "ne", x: 48, y: 60 },
  // SW island — production yard.
  { id: "well",     name: "Puits",    icon: "💧",  assetKey: "building-well",     blurb: "Source d'eau de la ville.", primary: "Puiser de l'eau", island: "sw", x: 36, y: 42 },
  { id: "workshop", name: "Atelier",  icon: "🔨",  assetKey: "building-workshop", blurb: "Menuiserie & forge — gère les constructions.", primary: "", island: "sw", x: 62, y: 42 },
  { id: "kitchen",  name: "Cuisine",  icon: "🍳",  assetKey: "building-kitchen",  blurb: "Feu de camp / cuisine.", primary: "Cuisiner", island: "sw", x: 50, y: 62 },
  { id: "recyclerie", name: "Recyclerie", icon: "♻️", assetKey: "building-workshop", blurb: "Recycle les débris ramassés en matériaux de construction (Bois/Pierre).", primary: "", island: "sw", x: 38, y: 62 },
  { id: "poste",    name: "Poste",     icon: "📮",  assetKey: "building-panel",    blurb: "Relais de courrier. Tant qu'elle n'est pas debout, on n'écrit à la ville que DEPUIS la ville.", primary: "Messagerie", island: "core", x: 50, y: 72 },
];

export function buildingIcon(id: string): string {
  return TOWN_BUILDINGS.find((b) => b.id === id)?.icon ?? "🏚️";
}

// Nom AFFICHÉ d'un bâtiment. Le serveur renvoie des noms anglais ("Kitchen",
// "Tower"…) hérités du prototype ; ils ne servent qu'à l'affichage (toute la
// logique passe par l'id), donc on les traduit ici plutôt que dans le backend —
// ça évite de migrer les parties déjà enregistrées.
export function buildingName(id: string, fallback?: string): string {
  return TOWN_BUILDINGS.find((b) => b.id === id)?.name ?? fallback ?? id;
}

// Barre du bas. L'ordre place volontairement la CARTE au milieu : c'est l'écran
// principal du jeu, et il est rendu en bouton central surélevé (voir BottomNav).
// Libellés en français — le reste de l'app l'est, ces cinq-là ne l'étaient pas.
export const NAV_TABS = [
  { id: "home", label: "Ville", icon: "🏠" },
  { id: "stock", label: "Sac", icon: "🎒" },
  { id: "map", label: "Carte", icon: "🗺️" },
  { id: "structure", label: "Bâtir", icon: "🏗️" },
  { id: "craft", label: "Atelier", icon: "⚒️" },
] as const;
