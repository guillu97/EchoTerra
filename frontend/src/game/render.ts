import { Biome } from "../api/types";

// --- Palette ---------------------------------------------------------------
// Placeholder art = flat colors. Swapping to generated sprites later only means
// loading textures keyed by biome/class/species instead of these fills.

export const BIOME_COLORS: Record<Biome, number> = {
  [Biome.Water]: 0x1f4ea1,
  [Biome.Sand]: 0xc9b87a,
  [Biome.Grass]: 0x4f9a44,
  [Biome.Forest]: 0x2e7d32,
  [Biome.Mountain]: 0x8d8d8d,
  [Biome.Snow]: 0xeaf2f6,
};

export const BIOME_NAMES: Record<Biome, string> = {
  [Biome.Water]: "Eau",
  [Biome.Sand]: "Sable",
  [Biome.Grass]: "Plaine",
  [Biome.Forest]: "Forêt",
  [Biome.Mountain]: "Montagne",
  [Biome.Snow]: "Neige",
};

export const HERO_COLOR = 0x3da5ff;
export const HERO_COLOR_SELECTED = 0x7cd0ff;
export const MONSTER_COLOR = 0xe2533b;

// A stable color per monster species, for placeholder tokens.
export function speciesColor(species: string): number {
  switch (species) {
    case "Goblin Pillard":
      return 0x6aa84f;
    case "Elementaire de Vent":
      return 0x9fc5e8;
    default:
      return 0xc06bd6; // Slime Vorace
  }
}

export function darken(color: number, factor: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

// --- Isometric projection --------------------------------------------------

export const ISO = { tileW: 46, tileH: 24, elev: 13 };

export function isoProject(x: number, y: number, height: number, originX: number, originY: number) {
  const sx = originX + (x - y) * (ISO.tileW / 2);
  const sy = originY + (x + y) * (ISO.tileH / 2) - height * ISO.elev;
  return { sx, sy };
}

// Diamond (top face) points relative to the projected tile center.
export function diamondPoints(): number[] {
  const hw = ISO.tileW / 2;
  const hh = ISO.tileH / 2;
  return [0, -hh, hw, 0, 0, hh, -hw, 0];
}
