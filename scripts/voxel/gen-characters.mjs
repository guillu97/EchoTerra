// Génère les personnages voxel des classes de héros (Phase 5) — SANS ComfyUI :
// les couleurs (peau/cheveux/tenue/accent) sont ÉCHANTILLONNÉES PAR ZONES dans
// les PNG chibi existants (frontend/public/assets/characters/char-*.png), le
// gabarit vient de char-recipe.mjs.
//
//   node scripts/voxel/gen-characters.mjs [--only char-knight,char-wizard]
//
// Sorties : frontend/public/voxels/chars/<key>.vox + previews asset-index/voxels/chars/.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { generateCharacter } from "./char-recipe.mjs";
import { encodeVox } from "./vox-format.mjs";
import { renderModel } from "./render-iso.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHARS = path.join(ROOT, "frontend", "public", "assets", "characters");
const OUT_VOX = path.join(ROOT, "frontend", "public", "voxels", "chars");
const OUT_PREVIEW = path.join(ROOT, "asset-index", "voxels", "chars");

const KEYS = ["char-scout", "char-builder", "char-archer", "char-knight", "char-merchant", "char-healer", "char-wizard"];

const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const sat = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };

// Boost de saturation (retour : héros « boueux » sur la carte) : écarte la
// couleur de son gris + petite pointe de luminosité — la peau n'y passe PAS.
function vivid([r, g, b], k = 1.45, lift = 1.06) {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const c = (v) => Math.max(0, Math.min(255, Math.round((gray + (v - gray) * k) * lift)));
  return [c(r), c(g), c(b)];
}

// Couleur dominante d'une zone (fractions du bbox du contenu opaque).
function zoneColor(px, bbox, fx0, fx1, fy0, fy1, filter = () => true) {
  const buckets = new Map();
  const x0 = bbox.left + bbox.w * fx0, x1 = bbox.left + bbox.w * fx1;
  const y0 = bbox.top + bbox.h * fy0, y1 = bbox.top + bbox.h * fy1;
  for (const p of px) {
    if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
    const c = [p.r, p.g, p.b];
    if (!filter(c)) continue;
    const k = ((p.r >> 4) << 8) | ((p.g >> 4) << 4) | (p.b >> 4);
    let e = buckets.get(k);
    if (!e) buckets.set(k, (e = { r: 0, g: 0, b: 0, n: 0 }));
    e.r += p.r; e.g += p.g; e.b += p.b; e.n++;
  }
  let best = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  return best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : null;
}

async function samplePalette(key) {
  const { data, info } = await sharp(path.join(CHARS, `${key}.png`))
    .resize(200, 200, { fit: "inside" })
    .raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const px = [];
  let top = height, bot = 0, left = width, right = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * channels;
      if (data[o + 3] < 200) continue;
      px.push({ x, y, r: data[o], g: data[o + 1], b: data[o + 2] });
      if (y < top) top = y; if (y > bot) bot = y;
      if (x < left) left = x; if (x > right) right = x;
    }
  }
  const bbox = { left, top, w: right - left, h: bot - top };
  const skinLike = (c) => c[0] > 150 && c[0] >= c[1] && c[1] >= c[2] * 0.85 && sat(c) < 0.55 && lum(c) > 120;
  // zones : cheveux = bande haute ; peau = visage (chibi → tête ≈ moitié haute) ;
  // tenue = torse ; accent = couleur la plus saturée du sprite entier
  const hair = zoneColor(px, bbox, 0.25, 0.75, 0.02, 0.14) ?? [90, 70, 60];
  const skin = zoneColor(px, bbox, 0.3, 0.7, 0.2, 0.4, skinLike) ?? [236, 198, 166];
  const outfit = zoneColor(px, bbox, 0.25, 0.75, 0.52, 0.75, (c) => !skinLike(c)) ?? [90, 110, 150];
  const outfit2 = zoneColor(px, bbox, 0.25, 0.75, 0.78, 0.95, (c) => !skinLike(c)) ?? [70, 80, 100];
  // accent : cluster saturé le plus couvrant
  const satBuckets = new Map();
  for (const p of px) {
    const c = [p.r, p.g, p.b];
    if (sat(c) < 0.45 || lum(c) < 40) continue;
    const k = ((p.r >> 4) << 8) | ((p.g >> 4) << 4) | (p.b >> 4);
    let e = satBuckets.get(k);
    if (!e) satBuckets.set(k, (e = { r: 0, g: 0, b: 0, n: 0 }));
    e.r += p.r; e.g += p.g; e.b += p.b; e.n++;
  }
  let acc = null;
  for (const e of satBuckets.values()) if (!acc || e.n > acc.n) acc = e;
  const accent = acc ? [Math.round(acc.r / acc.n), Math.round(acc.g / acc.n), Math.round(acc.b / acc.n)] : [200, 90, 70];
  return { skin, hair: vivid(hair), outfit: vivid(outfit), outfit2: vivid(outfit2), accent: vivid(accent, 1.55) };
}

async function writePng(render, file) {
  await sharp(Buffer.from(render.rgba), { raw: { width: render.width, height: render.height, channels: 4 } })
    .png().toFile(file);
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--only");
  const only = i >= 0 ? args[i + 1].split(",") : null;
  await mkdir(OUT_VOX, { recursive: true });
  await mkdir(OUT_PREVIEW, { recursive: true });
  const done = [];
  for (const key of KEYS) {
    if (only && !only.includes(key)) continue;
    const pal = await samplePalette(key);
    const model = generateCharacter(key, pal);
    await writeFile(path.join(OUT_VOX, `${key}.vox`), encodeVox(model));
    await writePng(renderModel(model, { s: 10 }), path.join(OUT_PREVIEW, `${key}.png`));
    done.push(key);
    console.log(`✓ ${key} (peau ${pal.skin} cheveux ${pal.hair} tenue ${pal.outfit} accent ${pal.accent})`);
  }
  // contact sheet
  const CELL = 220, LABEL = 24;
  const cols = Math.min(4, done.length);
  const rows = Math.ceil(done.length / cols);
  const composites = [];
  for (let k = 0; k < done.length; k++) {
    const img = await sharp(path.join(OUT_PREVIEW, `${done[k]}.png`)).resize(CELL - 14, CELL - 14, { fit: "inside" }).toBuffer();
    composites.push({ input: img, left: (k % cols) * CELL + 7, top: Math.floor(k / cols) * (CELL + LABEL) + 7 });
    composites.push({
      input: Buffer.from(`<svg width="${CELL}" height="${LABEL}"><text x="50%" y="16" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#e8e4d8">${done[k]}</text></svg>`),
      left: (k % cols) * CELL,
      top: Math.floor(k / cols) * (CELL + LABEL) + CELL - 8,
    });
  }
  await sharp({ create: { width: cols * CELL, height: rows * (CELL + LABEL), channels: 4, background: { r: 43, g: 41, b: 51, alpha: 1 } } })
    .composite(composites).png().toFile(path.join(OUT_PREVIEW, "SHEET.png"));
  console.log("Contact sheet → asset-index/voxels/chars/SHEET.png");
}

main().catch((e) => { console.error(e); process.exit(1); });
