import Phaser from "phaser";
import { DPR } from "./dpr";

// Next power of two ≥ n — mipmap-friendly texture sizes.
const pow2 = (n: number) => Math.pow(2, Math.ceil(Math.log2(Math.max(1, n))));

// Max texture size for a unit sprite (hero/monster). Generous vs the on-screen
// footprint so zoomed-in sprites stay crisp (content-cropped: every texel is
// character, no transparent margin — see shrinkTexture).
export const UNIT_TEX_SIZE = Math.min(1024, pow2(41 * 2.5 * DPR));
// The town building spans ~101 world px (TILE_W × 2.1).
export const TOWN_TEX_SIZE = Math.min(1024, pow2(101 * 2.5 * DPR));

// Opaque-content bounding box (alpha > 16), measured on a ≤256px copy for speed
// and mapped back with a 1px margin — same approach as MapScene's cube measure.
function opaqueBBox(src: HTMLImageElement): { left: number; top: number; sw: number; sh: number } | null {
  const nw = src.naturalWidth || src.width;
  const nh = src.naturalHeight || src.height;
  if (!nw || !nh) return null;
  const scale = Math.min(1, 256 / Math.max(nw, nh));
  const mw = Math.max(1, Math.round(nw * scale));
  const mh = Math.max(1, Math.round(nh * scale));
  const c = document.createElement("canvas");
  c.width = mw;
  c.height = mh;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, mw, mh);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, mw, mh).data;
  } catch {
    return null;
  }
  let left = mw, right = -1, top = mh, bottom = -1;
  for (let y = 0; y < mh; y++)
    for (let x = 0; x < mw; x++)
      if (data[(y * mw + x) * 4 + 3] > 16) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < 0) return null;
  const inv = 1 / scale;
  const L = Math.max(0, Math.floor(left * inv) - 1);
  const T = Math.max(0, Math.floor(top * inv) - 1);
  const R = Math.min(nw, Math.ceil((right + 1) * inv) + 1);
  const B = Math.min(nh, Math.ceil((bottom + 1) * inv) + 1);
  return { left: L, top: T, sw: R - L, sh: B - T };
}

// Downscale a freshly-loaded sprite to `maxDim` (longest side), replacing the
// texture under the same key. The generated unit PNGs are 1024² (~4 MiB of GPU
// memory EACH) but are displayed at ≤ ~40 world px — keeping the raw sources
// resident wasted ~45 MiB of VRAM for the map set alone. Idempotent: skips
// textures already backed by a canvas (= already shrunk) or already small.
// Callers must redraw any live Image using the key in the same task (no frame
// may render between remove and redraw).
//
// With `cropSquare`, the transparent margins are cut first: the content bbox is
// framed in a SQUARE (so square setDisplaySize calls don't distort), anchored at
// the content's BOTTOM (sprites are feet-anchored, origin 0.5/1). Every texel is
// then actual character — at equal display size the sprite reads bigger and
// noticeably sharper than the margin-padded original.
export function shrinkTexture(scene: Phaser.Scene, key: string, maxDim: number, cropSquare = false): void {
  if (!scene.textures.exists(key)) return;
  const src = scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  if (!(src instanceof HTMLImageElement)) return; // canvas source = already processed
  const w = src.naturalWidth || src.width;
  const h = src.naturalHeight || src.height;
  if (!w || !h) return;

  let sx = 0, sy = 0, sw = w, sh = h;
  if (cropSquare) {
    const bb = opaqueBBox(src);
    if (bb) {
      // Square window over the content: side = the larger content dimension,
      // horizontally centred, bottom-aligned on the content's feet.
      const side = Math.max(bb.sw, bb.sh);
      sx = Math.max(0, Math.min(w - side, bb.left + bb.sw / 2 - side / 2));
      sy = Math.max(0, bb.top + bb.sh - side);
      sw = Math.min(side, w - sx);
      sh = Math.min(side, h - sy);
    }
  }
  if (!cropSquare && Math.max(w, h) <= maxDim) return; // nothing to do
  const s = Math.min(1, maxDim / Math.max(sw, sh)); // never upscale the source
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sw * s));
  out.height = Math.max(1, Math.round(sh * s));
  const ctx = out.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
  scene.textures.remove(key);
  scene.textures.addCanvas(key, out);
}

export function shrinkUnitTextures(scene: Phaser.Scene, keys: readonly string[]): void {
  keys.forEach((k) => shrinkTexture(scene, k, UNIT_TEX_SIZE, true));
}
