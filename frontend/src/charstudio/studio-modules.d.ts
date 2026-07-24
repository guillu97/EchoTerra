// Types des recettes voxel personnages/monstres — JS pur partagé avec le
// pipeline Node (scripts/voxel/gen-characters.mjs / gen-monsters.mjs), importé
// directement par le Studio Personnages (même code CLI et navigateur).

declare module "*/char-recipe.mjs" {
  export type CharPalette = {
    skin: number[];
    hair: number[];
    outfit: number[];
    outfit2: number[];
    accent: number[];
  };
  export function shade(rgb: number[], f: number): number[];
  export const CHAR_SIZE: { sx: number; sy: number; sz: number };
  export const CHAR_FINE: number;
  export function generateCharacter(
    key: string,
    pal: CharPalette,
  ): {
    sx: number;
    sy: number;
    sz: number;
    size: number;
    data: Uint8Array;
    palette: [number, number, number][];
    parts: Uint8Array;
  };
}

declare module "*/monster-recipe.mjs" {
  export type MobPalette = { body: number[]; accent: number[] };
  export const MOB_SIZE: { sx: number; sy: number; sz: number };
  export const MOB_FINE: number;
  export const MONSTER_TEMPLATES: Record<string, unknown>;
  export function generateMonster(
    key: string,
    pal: MobPalette,
  ): {
    sx: number;
    sy: number;
    sz: number;
    size: number;
    data: Uint8Array;
    palette: [number, number, number][];
  };
}
