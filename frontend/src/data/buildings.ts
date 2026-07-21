// Layout/flavor config for the town buildings. Gameplay stats (level, durability,
// capacity, build progress) come from the backend (game.town.buildings, matched by id).
import type { AssetKey } from "../assets";

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

// NOTE: the Home town visual is now an editor-authored map (src/data/town-map.json,
// rendered by components/TownMap.tsx with the editor's renderer) — the old
// hand-positioned iso platform (ISO_TOWN / ISO_TOWN_TILES / ISO_BUILDING_CELL) was
// removed with it. TOWN_BUILDINGS below remains the game-side catalog: names, icons,
// blurbs and modal metadata, matched to backend building ids.

// x/y are % positions WITHIN the building's island box (centered anchor). Buildings are
// spread across three islands: core (civic), ne (defense), sw (production).
export const TOWN_BUILDINGS: BuildingLayout[] = [
  // Core island — civic heart.
  { id: "townhall", name: "Townhall", icon: "🏛️", assetKey: "building-townhall", blurb: "Cœur de la ville. Lit : ressuscite un héros épuisé.", primary: "Revive hero", island: "core", x: 50, y: 40 },
  { id: "bank",     name: "Bank",     icon: "🏦",  assetKey: "building-bank",     blurb: "Stocke les ressources & matériaux communs.", primary: "Enter", island: "core", x: 32, y: 56 },
  { id: "panel",    name: "Panel",    icon: "📋",  assetKey: "building-panel",    blurb: "Journal, sondage, membres.", primary: "Journal", island: "core", x: 68, y: 56 },
  // NE island — defense outpost.
  { id: "wall",     name: "Wall",     icon: "🧱",  assetKey: "building-wall",     blurb: "Muraille défensive.", primary: "", island: "ne", x: 36, y: 38 },
  { id: "tower",    name: "Tower",    icon: "🗼",  assetKey: "building-tower",    blurb: "Augmente vos dégâts contre la vague.", primary: "Evaluate attack", island: "ne", x: 60, y: 40 },
  { id: "gate",     name: "Gate",     icon: "🚪",  assetKey: "building-gate",     blurb: "Grande porte de la ville.", primary: "Open / Close", island: "ne", x: 48, y: 60 },
  // SW island — production yard.
  { id: "well",     name: "Well",     icon: "💧",  assetKey: "building-well",     blurb: "Source d'eau de la ville.", primary: "Draw water", island: "sw", x: 36, y: 42 },
  { id: "workshop", name: "Workshop", icon: "🔨",  assetKey: "building-workshop", blurb: "Menuiserie & forge — gère les constructions.", primary: "", island: "sw", x: 62, y: 42 },
  { id: "kitchen",  name: "Kitchen",  icon: "🍳",  assetKey: "building-kitchen",  blurb: "Feu de camp / cuisine.", primary: "Cook", island: "sw", x: 50, y: 62 },
  { id: "recyclerie", name: "Recyclerie", icon: "♻️", assetKey: "building-workshop", blurb: "Recycle les débris ramassés en matériaux de construction (Bois/Pierre).", primary: "", island: "sw", x: 38, y: 62 },
];

export function buildingIcon(id: string): string {
  return TOWN_BUILDINGS.find((b) => b.id === id)?.icon ?? "🏚️";
}

export const NAV_TABS = [
  { id: "home", label: "Home", icon: "🏠" },
  { id: "map", label: "Map", icon: "🗺️" },
  { id: "stock", label: "Stock", icon: "🎒" },
  { id: "structure", label: "Structure", icon: "🏗️" },
  { id: "craft", label: "Craft", icon: "⚒️" },
] as const;
