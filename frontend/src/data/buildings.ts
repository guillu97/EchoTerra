// Layout/flavor config for the town buildings. Gameplay stats (level, durability,
// capacity, build progress) come from the backend (game.town.buildings, matched by id).
import type { AssetKey } from "../assets";
import { t } from "../i18n";
import type { TKey } from "../i18n";

// Tailles de salon proposées à la création. Le maximum reflète
// worldgen.MaxPlayersPerGame côté serveur (20 équipes de 3 = 60 héros) ; la carte est
// générée à la taille du salon, donc choisir 20 ne fait pas jouer 20 joueurs à l'étroit.
export const LOBBY_SIZES = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20];

// PV de ville rendus par point d'action à l'action « repair » des remparts. Miroir de
// game.TownRepairHP (backend/internal/game/town.go) — garder les deux d'accord.
export const TOWN_REPAIR_HP = 5;

// ⚠ PLUS DE `name` / `blurb` / `primary` ICI : ces trois textes sont LUS PAR UN
// JOUEUR, donc ils vivent dans les huit langues (`i18n/locales/*`, clés
// `building.<id>.name|blurb|primary`) et se lisent par les fonctions du bas de
// ce fichier. L'`id`, lui, ne bouge JAMAIS — c'est ce que le serveur, les bots
// et les modèles voxel connaissent.
export interface BuildingLayout {
  id: string;
  icon: string; // emoji fallback (shown when the generated asset isn't available)
  assetKey: AssetKey; // key into the asset registry (scripts/generate-assets.mjs)
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
  { id: "townhall", icon: "🏛️", assetKey: "building-townhall", island: "core", x: 50, y: 40 },
  { id: "bank",       icon: "🏦",  assetKey: "building-bank",     island: "core", x: 32, y: 56 },
  { id: "panel",     icon: "📋",  assetKey: "building-panel",    island: "core", x: 68, y: 56 },
  // NE island — defense outpost.
  { id: "wall",     icon: "🧱",  assetKey: "building-wall",     island: "ne", x: 36, y: 38 },
  { id: "tower",        icon: "🗼",  assetKey: "building-tower",    island: "ne", x: 60, y: 40 },
  { id: "gate",      icon: "🚪",  assetKey: "building-gate",     island: "ne", x: 48, y: 60 },
  // SW island — production yard.
  { id: "well",        icon: "💧",  assetKey: "building-well",     island: "sw", x: 36, y: 42 },
  { id: "workshop",  icon: "🔨",  assetKey: "building-workshop", island: "sw", x: 62, y: 42 },
  { id: "kitchen",   icon: "🍳",  assetKey: "building-kitchen",  island: "sw", x: 50, y: 62 },
  { id: "recyclerie", icon: "♻️", assetKey: "building-workshop", island: "sw", x: 38, y: 62 },
  { id: "poste",        icon: "📮",  assetKey: "building-panel",    island: "core", x: 50, y: 72 },
  // LES CINQ BÂTIMENTS DE SPÉCIALITÉ (backend design.go). Chacun ouvre un axe que rien
  // d'autre ne couvre, et leur plan ne tombe QUE d'une ruine — un biome, une spécialité.
  // Aucune ville ne peut tous les avoir : c'est là qu'est le choix.
  { id: "infirmerie",   icon: "🏥", assetKey: "building-townhall", island: "core", x: 30, y: 72 },
  { id: "cartographe", icon: "🗺️", assetKey: "building-panel",    island: "core", x: 70, y: 72 },
  { id: "armurerie",     icon: "⚔️", assetKey: "building-workshop", island: "ne", x: 30, y: 62 },
  { id: "caserne",         icon: "🛡️", assetKey: "building-wall",     island: "ne", x: 66, y: 62 },
  { id: "verger",           icon: "🌱", assetKey: "building-kitchen",  island: "sw", x: 62, y: 62 },
  // LE TEMPLE (backend mythic.go) : le pilier mythique. Son NOM change avec le panthéon
  // (« Hof des Ases », « Temple de Râ ») — celui-ci est le générique, et l'écran du
  // Temple affiche le nom propre servi par le serveur.
  { id: "temple",           icon: "🏛️", assetKey: "building-townhall", island: "core", x: 50, y: 24 },
];

export function buildingIcon(id: string): string {
  return TOWN_BUILDINGS.find((b) => b.id === id)?.icon ?? "🏚️";
}

// Nom AFFICHÉ d'un bâtiment. Le serveur renvoie des noms anglais ("Kitchen",
// "Tower"…) hérités du prototype ; ils ne servent qu'à l'affichage (toute la
// logique passe par l'id), donc on les traduit ici plutôt que dans le backend —
// ça évite de migrer les parties déjà enregistrées.
//
// ⚠ On ne demande la clé que si le bâtiment est AU CATALOGUE : `t()` sur une
// clé inconnue rendrait la clé elle-même (« building.xyz.name »), ce qu'un
// joueur lirait comme un bug. Un id inconnu retombe donc sur ce que le serveur
// a envoyé, puis sur l'id.
export function buildingName(id: string, fallback?: string): string {
  if (TOWN_BUILDINGS.some((b) => b.id === id)) return t(`building.${id}.name` as TKey);
  return fallback ?? id;
}

/** Ce que le bâtiment fait, en une phrase — pour la modale de la ville. */
export function buildingBlurb(id: string): string {
  return TOWN_BUILDINGS.some((b) => b.id === id) ? t(`building.${id}.blurb` as TKey) : "";
}

/** Le libellé de son action principale (« Puiser de l'eau »), "" si aucune. */
export function buildingPrimary(id: string): string {
  return TOWN_BUILDINGS.some((b) => b.id === id) ? t(`building.${id}.primary` as TKey) : "";
}

// Barre du bas. L'ordre place volontairement la CARTE au milieu : c'est l'écran
// principal du jeu, et il est rendu en bouton central surélevé (voir BottomNav).
// ⚠ le LIBELLÉ n'est pas ici mais dans les huit langues (`nav.<id>`) : la barre
// le lit par `t()` au rendu, sinon changer de langue ne changerait pas les
// onglets (ce tableau est évalué une seule fois, au chargement du module).
export const NAV_TABS = [
  { id: "home", icon: "🏠" },
  { id: "stock", icon: "🎒" },
  { id: "map", icon: "🗺️" },
  { id: "structure", icon: "🏗️" },
  { id: "craft", icon: "⚒️" },
] as const;
