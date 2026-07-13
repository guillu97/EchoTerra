import Phaser from "phaser";
import { DPR } from "./dpr";

// Next power of two ≥ n — mipmap-friendly texture sizes.
const pow2 = (n: number) => Math.pow(2, Math.ceil(Math.log2(Math.max(1, n))));

// Max on-screen footprint of a unit sprite (hero/monster): ~41 world px
// (TILE_W × 0.85) at the map's max camera zoom (2.5) × DPR device pixels.
export const UNIT_TEX_SIZE = Math.min(1024, pow2(41 * 2.5 * DPR));
// The town building spans ~101 world px (TILE_W × 2.1).
export const TOWN_TEX_SIZE = Math.min(1024, pow2(101 * 2.5 * DPR));

// Downscale a freshly-loaded sprite to `maxDim` (longest side), replacing the
// texture under the same key. The generated unit PNGs are 1024² (~4 MiB of GPU
// memory EACH) but are displayed at ≤ ~40 world px — keeping the raw sources
// resident wasted ~45 MiB of VRAM for the map set alone. Idempotent: skips
// textures already backed by a canvas (= already shrunk) or already small.
// Callers must redraw any live Image using the key in the same task (no frame
// may render between remove and redraw).
export function shrinkTexture(scene: Phaser.Scene, key: string, maxDim: number): void {
  if (!scene.textures.exists(key)) return;
  const src = scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  if (!(src instanceof HTMLImageElement)) return; // canvas source = already processed
  const w = src.naturalWidth || src.width;
  const h = src.naturalHeight || src.height;
  if (!w || !h || Math.max(w, h) <= maxDim) return;
  const s = maxDim / Math.max(w, h);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(w * s));
  out.height = Math.max(1, Math.round(h * s));
  const ctx = out.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, out.width, out.height);
  scene.textures.remove(key);
  scene.textures.addCanvas(key, out);
}

export function shrinkUnitTextures(scene: Phaser.Scene, keys: readonly string[]): void {
  keys.forEach((k) => shrinkTexture(scene, k, UNIT_TEX_SIZE));
}
