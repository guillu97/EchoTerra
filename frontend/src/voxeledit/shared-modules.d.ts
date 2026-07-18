// Types des modules JS PUR partagés avec le pipeline Node (scripts/voxel/) —
// l'éditeur les importe directement (même code qui tourne en CLI et en direct).

declare module "*/recipes.mjs" {
  export type RecipePalette = {
    top: number[][];
    side: number[][];
    accents: number[][];
  };
  export function generateBlock(
    def: { recipe: string; params?: Record<string, number> },
    palette: RecipePalette,
    opts?: { size?: number; seed?: number },
  ): {
    sx: number;
    sy: number;
    sz: number;
    size: number;
    data: Uint8Array;
    palette: [number, number, number][];
  };
  export const RECIPES: Record<string, unknown>;
  export const HEADROOM: number;
}

declare module "*/vox-format.mjs" {
  export function encodeVox(m: {
    sx: number;
    sy: number;
    sz: number;
    data: Uint8Array;
    palette: number[][];
  }): Uint8Array;
  export function decodeVox(b: Uint8Array): {
    sx: number;
    sy: number;
    sz: number;
    data: Uint8Array;
    palette: [number, number, number][];
  };
}
