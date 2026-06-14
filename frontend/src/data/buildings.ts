// Layout/flavor config for the town buildings. Gameplay stats (level, durability,
// capacity, build progress) come from the backend (game.town.buildings, matched by id).

export interface BuildingLayout {
  id: string;
  name: string;
  icon: string; // emoji placeholder (swap for sprite later)
  blurb: string;
  primary: string; // label of the building's special "use" action ("" = none)
  x: number; // % position on the town canvas
  y: number;
}

export const TOWN_BUILDINGS: BuildingLayout[] = [
  { id: "townhall", name: "Townhall", icon: "🏛️", blurb: "Cœur de la ville. Lit : ressuscite un héros épuisé.", primary: "Revive hero", x: 44, y: 70 },
  { id: "well", name: "Well", icon: "💧", blurb: "Source d'eau de la ville.", primary: "Draw water", x: 30, y: 64 },
  { id: "bank", name: "Bank", icon: "🏦", blurb: "Stocke les ressources & matériaux communs.", primary: "Enter", x: 52, y: 52 },
  { id: "tower", name: "Tower", icon: "🗼", blurb: "Augmente vos dégâts contre la vague.", primary: "Evaluate attack", x: 64, y: 40 },
  { id: "workshop", name: "Workshop", icon: "🔨", blurb: "Menuiserie & forge — gère les constructions.", primary: "", x: 40, y: 44 },
  { id: "gate", name: "Gate", icon: "🚪", blurb: "Grande porte de la ville.", primary: "Open / Close", x: 22, y: 50 },
  { id: "wall", name: "Wall", icon: "🧱", blurb: "Muraille défensive.", primary: "", x: 16, y: 64 },
  { id: "kitchen", name: "Kitchen", icon: "🍳", blurb: "Feu de camp / cuisine.", primary: "Cook", x: 58, y: 66 },
  { id: "panel", name: "Panel", icon: "📋", blurb: "Journal, sondage, membres.", primary: "Journal", x: 72, y: 58 },
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
