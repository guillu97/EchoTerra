// Client-side map generation preview for the designer's 🌍 Génération tab.
// Mirrors the SHAPE of worldgen.go (layered Perlin → normalized heightmap →
// thresholds → biomes, resources by biome, monster packs ringed around the town)
// with two designer-only additions: parameterized knobs and SMOOTHING (no tile may
// differ from an orthogonal neighbour by more than maxStep height levels).
// The JS Perlin isn't bit-identical to Go's aquilax/go-perlin — the preview shows
// the same STYLE of world; the exported parameters drive the real implementation.

import type { TerrainDef, MapGenDef, MonsterDef } from "./types";

export interface GeneratedPack {
  x: number;
  y: number;
  species: string;
  count: number;
}

export interface GeneratedMap {
  w: number;
  h: number;
  biome: Uint8Array; // 0 water 1 sand 2 grass 3 forest 4 mountain 5 snow
  level: Uint8Array; // smoothed elevation 0..maxHeight
  resources: Uint8Array;
  town: { x: number; y: number };
  packs: GeneratedPack[];
}

// Canonical biome ids, index-aligned with the game's Biome enum.
export const BIOME_IDS = ["water", "sand", "grass", "forest", "mountain", "snow"] as const;

// --- deterministic PRNG + Perlin ------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePerlin(rnd: () => number) {
  const perm = new Uint8Array(512);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const grad = (h: number, x: number, y: number) => {
    switch (h & 3) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      default: return -x - y;
    }
  };
  return (x: number, y: number): number => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    return lerp(
      lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
      lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
      v,
    ); // ≈ [-1, 1]
  };
}

// --- generation -------------------------------------------------------------------

export function generateMap(
  def: MapGenDef,
  resourceDefs: TerrainDef[],
  monsterDefs: MonsterDef[],
): GeneratedMap {
  const w = Math.max(6, def.width);
  const h = Math.max(6, def.height);
  const rnd = mulberry32(def.seed || 1);
  const noise = makePerlin(rnd);

  // 1) layered noise, min-max normalized to [0,1] so thresholds span the full range.
  const nv = new Float64Array(w * h);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      let amp = 1;
      let freq = def.scale;
      for (let o = 0; o < Math.max(1, def.octaves); o++) {
        v += noise(x * freq, y * freq) * amp;
        amp *= def.persistence;
        freq *= 2;
      }
      nv[y * w + x] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  const span = hi - lo || 1;
  for (let i = 0; i < nv.length; i++) nv[i] = (nv[i] - lo) / span;

  // 2) elevation levels, then SMOOTH: iteratively lower any tile that towers more
  // than maxStep above its lowest orthogonal neighbour. Lowering-only relaxation
  // converges and guarantees |Δh| ≤ maxStep everywhere — a level-6 mountain can no
  // longer touch a level-0 plain.
  const level = new Uint8Array(w * h);
  for (let i = 0; i < nv.length; i++) level[i] = Math.round(nv[i] * def.maxHeight);
  const step = Math.max(1, def.maxStep);
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let low = Infinity;
        if (x > 0) low = Math.min(low, level[i - 1]);
        if (x < w - 1) low = Math.min(low, level[i + 1]);
        if (y > 0) low = Math.min(low, level[i - w]);
        if (y < h - 1) low = Math.min(low, level[i + w]);
        const cap = low + step;
        if (level[i] > cap) {
          level[i] = cap;
          changed = true;
        }
      }
  }

  // 3) biomes from the SMOOTHED normalized elevation (so biome transitions follow
  // the gentle slopes), resources from the designer's per-biome tables.
  const t = def.thresholds;
  const biome = new Uint8Array(w * h);
  const resources = new Uint8Array(w * h);
  const resByBiome = BIOME_IDS.map((id) => resourceDefs.find((r) => r.id === id));
  for (let i = 0; i < nv.length; i++) {
    const v = def.maxHeight > 0 ? level[i] / def.maxHeight : 0;
    const b = v < t.water ? 0 : v < t.sand ? 1 : v < t.grass ? 2 : v < t.forest ? 3 : v < t.mountain ? 4 : 5;
    biome[i] = b;
    const rd = resByBiome[b];
    if (rd && rd.searchable && rd.resourcesMax > 0)
      resources[i] = rd.resourcesMin + Math.floor(rnd() * (rd.resourcesMax - rd.resourcesMin + 1));
  }

  // 4) town: walkable (grass-preferred) tile closest to the centre — like findTown.
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  let town = { x: cx, y: cy };
  let best = Infinity;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const b = biome[y * w + x];
      if (b === 0) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2 + (b === 2 ? 0 : 1000); // prefer grass
      if (d < best) {
        best = d;
        town = { x, y };
      }
    }
  resources[town.y * w + town.x] = 0; // the town tile is not searchable

  // 5) monster packs: rings around town (like SeedStartingMonsters), on walkable
  // tiles whose biome is allowed for at least one species from the Monsters tab.
  const packs: GeneratedPack[] = [];
  const canSpawn = (b: number) => monsterDefs.filter((m) => m.biomes.includes(BIOME_IDS[b]));
  let speciesIdx = 0;
  for (let radius = 2; radius <= Math.max(w, h) && packs.length < def.monsterPacks; radius++) {
    for (let dy = -radius; dy <= radius && packs.length < def.monsterPacks; dy++)
      for (let dx = -radius; dx <= radius && packs.length < def.monsterPacks; dx++) {
        if (Math.abs(dx) + Math.abs(dy) !== radius) continue;
        const x = town.x + dx;
        const y = town.y + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const b = biome[y * w + x];
        if (b === 0 || (x === town.x && y === town.y)) continue;
        if (packs.some((p) => p.x === x && p.y === y)) continue;
        const options = canSpawn(b);
        if (options.length === 0) continue;
        const m = options[speciesIdx++ % options.length];
        const count = m.packMin + Math.floor(rnd() * Math.max(1, m.packMax - m.packMin + 1));
        packs.push({ x, y, species: m.name, count });
      }
  }

  return { w, h, biome, level, resources, town, packs };
}
