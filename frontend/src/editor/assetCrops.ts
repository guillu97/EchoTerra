// Per-ASSET source crop overrides (cat/file → CropRect). Distinct from a placement's
// own crop: this re-frames the source image everywhere the asset is used — ground
// cubes, objects, palette — so slightly-misframed iso tiles (e.g. brick) can be
// normalized once. Persisted in localStorage. Kept as a standalone module (not the
// zustand store) so the renderer/exporter can read it without import cycles.

import type { CropRect } from "./types";
import { assetUrlFor } from "./assetIndex";
import { loadImage } from "./imageCache";
import { metricsFor } from "./spriteMetrics";

const LS_KEY = "echoterra:editor:assetCrops";

function load(): Record<string, CropRect> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, CropRect>;
  } catch {
    /* ignore */
  }
  return {};
}

let crops: Record<string, CropRect> = load();

export const cropKey = (cat: string, file: string) => `${cat}/${file}`;

export function getAssetCrop(cat: string, file: string): CropRect | undefined {
  return crops[cropKey(cat, file)];
}

export function setAssetCrop(cat: string, file: string, crop: CropRect | undefined) {
  const key = cropKey(cat, file);
  if (crop) crops[key] = crop;
  else delete crops[key];
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(crops));
  } catch {
    /* quota / disabled */
  }
}

export function allAssetCrops(): Record<string, CropRect> {
  return crops;
}

// Auto-detect the tight opaque content box of an asset's source image → CropRect.
// This frames the block fully (no transparent margin). Optional padding (fraction) to
// avoid clipping anti-aliased edges.
export async function detectContentCrop(
  cat: string,
  file: string,
  pad = 0,
): Promise<CropRect | undefined> {
  const url = assetUrlFor(cat, file);
  if (!url) return undefined;
  try {
    const img = await loadImage(url);
    const m = metricsFor(img);
    if (!m) return undefined;
    const x = Math.max(0, m.fLeft - pad);
    const y = Math.max(0, m.fTop - pad);
    const w = Math.min(1 - x, m.fRight - m.fLeft + pad * 2);
    const h = Math.min(1 - y, m.fBottom - m.fTop + pad * 2);
    if (w <= 0.02 || h <= 0.02) return undefined;
    return { x, y, w, h };
  } catch {
    return undefined;
  }
}

// Replace the whole map (used by JSON import).
export function setAllAssetCrops(map: Record<string, CropRect>) {
  crops = { ...map };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(crops));
  } catch {
    /* ignore */
  }
}
