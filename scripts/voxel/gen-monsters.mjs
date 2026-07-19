// Génère les monstres voxel — couleurs (corps + accent) échantillonnées dans
// les PNG de créatures existants, silhouettes de monster-recipe.mjs.
//
//   node scripts/voxel/gen-monsters.mjs [--only mob-slime,mob-goblin]
//
// Sorties : frontend/public/voxels/chars/<mob-*>.vox + previews asset-index/voxels/chars/.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { generateMonster, MONSTER_TEMPLATES } from "./monster-recipe.mjs";
import { encodeVox } from "../../frontend/src/voxel/shared/vox-format.mjs";
import { renderModel } from "./render-iso.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MONSTERS = path.join(ROOT, "frontend", "public", "assets", "monsters");
const OUT_VOX = path.join(ROOT, "frontend", "public", "voxels", "chars");
const OUT_PREVIEW = path.join(ROOT, "asset-index", "voxels", "chars");

const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// corps = cluster dominant ; accent = cluster le plus couvrant NETTEMENT distinct
async function samplePalette(key) {
  const { data, info } = await sharp(path.join(MONSTERS, `${key}.png`))
    .resize(160, 160, { fit: "inside" })
    .raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const buckets = new Map();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * channels;
      if (data[o + 3] < 220) continue;
      const c = [data[o], data[o + 1], data[o + 2]];
      if (lum(c) < 20 || lum(c) > 245) continue; // ni traits noirs ni blancs purs
      const k = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
      let e = buckets.get(k);
      if (!e) buckets.set(k, (e = { r: 0, g: 0, b: 0, n: 0 }));
      e.r += c[0]; e.g += c[1]; e.b += c[2]; e.n++;
    }
  }
  const clusters = [...buckets.values()]
    .map((e) => ({ col: [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)], n: e.n }))
    .sort((a, b) => b.n - a.n);
  const body = clusters[0]?.col ?? [150, 150, 160];
  const accent = clusters.find((c) => dist2(c.col, body) > 90 * 90)?.col ?? [220, 180, 90];
  // boost de saturation (2026-07-19 « pas assez coloré ») — même recette que les héros
  const vivid = ([r, g, b], k = 1.4, lift = 1.04) => {
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const c = (v) => Math.max(0, Math.min(255, Math.round((gray + (v - gray) * k) * lift)));
    return [c(r), c(g), c(b)];
  };
  return { body: vivid(body), accent: vivid(accent, 1.5) };
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--only");
  const only = i >= 0 ? args[i + 1].split(",") : null;
  await mkdir(OUT_VOX, { recursive: true });
  await mkdir(OUT_PREVIEW, { recursive: true });
  for (const key of Object.keys(MONSTER_TEMPLATES)) {
    if (only && !only.includes(key)) continue;
    const pal = await samplePalette(key);
    const model = generateMonster(key, pal);
    await writeFile(path.join(OUT_VOX, `${key}.vox`), encodeVox(model));
    const r = renderModel(model, { s: 10 });
    await sharp(Buffer.from(r.rgba), { raw: { width: r.width, height: r.height, channels: 4 } })
      .png().toFile(path.join(OUT_PREVIEW, `${key}.png`));
    console.log(`✓ ${key} (corps ${pal.body} accent ${pal.accent})`);
  }
  console.log("OK — previews dans asset-index/voxels/chars/");
}

main().catch((e) => { console.error(e); process.exit(1); });
