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

// ── Isometric town (POC) ─────────────────────────────────────────────────────
// The Home is an isometric tile platform; buildings sit on grid cells. Screen pos of
// cell (gx,gy) is the standard iso projection — same math as the combat scene:
//   sx = (gx - gy) * ISO_TOWN.tileW / 2
//   sy = (gx + gy) * ISO_TOWN.tileH / 2
// Tune these knobs to fit the generated cube art; they're intentionally data-driven.
// Base sizes are defined at a reference container width (refWidth). At runtime every
// size/spacing is multiplied by (containerWidth / refWidth), so the whole iso platform
// scales with the screen resolution. Edit these base values to retune proportions.
export const ISO_TOWN = {
  refWidth: 430, // reference container width the base sizes below are tuned for
  tileW: 46, // iso step width (px) between columns
  tileH: 23, // iso step height (px) between rows
  cube: 74, // display size (px) of a cube tile image (square)
  cubeAnchorY: 0.4, // where the cube's top-diamond centre sits within its square image
  build: 124, // display size (px) of a building sprite (≈ a 2x2-tile footprint)
  center: 3.5, // grid centre ((gridSize-1)/2) used to centre the platform on screen
};

export type IsoTileKind = "grass" | "stone" | "water" | "sand" | "forest" | "snow" | "bridge";
export interface IsoTile { gx: number; gy: number; kind: IsoTileKind }

const ISO_GRID = 8; // 8x8 platform (projects to a diamond)

// Grassy rim, stone plaza in the centre.
export const ISO_TOWN_TILES: IsoTile[] = (() => {
  const tiles: IsoTile[] = [];
  for (let gy = 0; gy < ISO_GRID; gy++) {
    for (let gx = 0; gx < ISO_GRID; gx++) {
      const plaza = gx >= 3 && gx <= 4 && gy >= 3 && gy <= 4;
      tiles.push({ gx, gy, kind: plaza ? "stone" : "grass" });
    }
  }
  return tiles;
})();

// Each building stands on a 2x2 footprint, anchored at the shared corner of 4 tiles
// (half-integer cell). 9 buildings on the inner 6x6, leaving a 1-tile grassy rim.
export const ISO_BUILDING_CELL: Record<string, { gx: number; gy: number }> = {
  tower: { gx: 1.5, gy: 1.5 },
  kitchen: { gx: 3.5, gy: 1.5 },
  wall: { gx: 5.5, gy: 1.5 },
  workshop: { gx: 1.5, gy: 3.5 },
  townhall: { gx: 3.5, gy: 3.5 },
  bank: { gx: 5.5, gy: 3.5 },
  panel: { gx: 1.5, gy: 5.5 },
  well: { gx: 3.5, gy: 5.5 },
  gate: { gx: 5.5, gy: 5.5 },
};

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
