// Générateur des blocs voxel du jeu — Phase 0 du VOXEL-PLAN.
// SANS ComfyUI : les palettes sont EXTRAITES des isotiles existants (l'art
// direction DA est héritée, pas réinventée), les formes viennent des recettes
// procédurales (recipes.mjs, module partagé avec le futur éditeur navigateur).
//
//   node scripts/voxel/gen-blocks.mjs [--size 32] [--variants 3] [--only grass,stone] [--out 16]
//   --out écrit dans frontend/public/voxels/<out>/ (LOD : blocs 16³ de la carte
//   monde dans voxels/16/, les 32³ de près restant à la racine)
//
// Sorties :
//   frontend/public/voxels/<id>-v<k>.vox      modèles MagicaVoxel (retouchables)
//   asset-index/voxels/<id>.png               preview iso (variante 0)
//   asset-index/voxels/<id>-tiling.png        tuilage 2×2 + empilement (raccords)
//   asset-index/voxels/SHEET.png              contact sheet de tous les blocs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { generateBlock } from "./recipes.mjs";
import { encodeVox } from "./vox-format.mjs";
import { renderModel, renderTiling } from "./render-iso.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ISOTILES = path.join(ROOT, "frontend", "public", "assets", "isotiles");
const OUT_VOX = path.join(ROOT, "frontend", "public", "voxels");
const OUT_PREVIEW = path.join(ROOT, "asset-index", "voxels");

// Le catalogue Phase 0 : biomes du monde (mêmes ids que ISO_TILE_FILES de
// MapScene), la brume (fog of war) et les matériaux de la ville.
const BLOCKS = [
  { id: "water", src: "water", recipe: "water", params: {} },
  { id: "sand", src: "sand", recipe: "ground", params: { blades: 0, pebbles: 0.004, bump: 1, surfaceDepth: 5 } },
  { id: "grass", src: "grass", recipe: "ground", params: { blades: 0.03, flowers: 0.01, bump: 1 }, accentsFrom: "flowers" },
  { id: "forest", src: "forest", recipe: "ground", params: { blades: 0.05, flowers: 0.004, bump: 2 }, accentsFrom: "mushroom" },
  { id: "stone", src: "stone", recipe: "rock", params: { bump: 2 } },
  { id: "snow", src: "snow", recipe: "ground", params: { sparkle: 0.012, bump: 1, surfaceDepth: 4 } },
  { id: "mist", src: null, recipe: "mist", params: {} },
  { id: "dirt", src: "dirt", recipe: "ground", params: { pebbles: 0.008, bump: 1, surfaceDepth: 6 } },
  { id: "cobblestone", src: "cobblestone", recipe: "cobble", params: {} },
  { id: "brick", src: "brick", recipe: "brick", params: {} },
  { id: "woodfloor", src: "woodfloor", recipe: "planks", params: {} },
];

// Palette procédurale de la brume — les constantes MIST_* de MapScene.
const MIST_PALETTE = {
  top: [[244, 246, 255], [231, 234, 252], [205, 211, 242], [170, 177, 221], [141, 148, 196]],
  side: [[141, 148, 196]],
  accents: [[196, 186, 255]],
};

const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const sat = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// Quantifie les pixels opaques d'une région en clusters dominants.
function dominantColors(pixels, n, { minDist = 26, bySat = false } = {}) {
  const buckets = new Map(); // clé 5 bits/canal → {sum, count}
  for (const [r, g, b] of pixels) {
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let e = buckets.get(k);
    if (!e) buckets.set(k, (e = { r: 0, g: 0, b: 0, c: 0 }));
    e.r += r; e.g += g; e.b += b; e.c++;
  }
  let clusters = [...buckets.values()]
    .map((e) => ({ col: [Math.round(e.r / e.c), Math.round(e.g / e.c), Math.round(e.b / e.c)], c: e.c }))
    .sort((a, b) => b.c - a.c);
  if (bySat) clusters = clusters.filter((e) => sat(e.col) > 0.35 && e.c > 3).sort((a, b) => sat(b.col) - sat(a.col));
  const out = [];
  for (const { col } of clusters) {
    if (out.every((o) => dist2(o, col) > minDist * minDist)) out.push(col);
    if (out.length >= n) break;
  }
  return out.sort((a, b) => lum(b) - lum(a)); // clair → foncé
}

// Extrait { top, side } d'un isotile : face du haut = moitié haute du contenu
// opaque (le losange), flancs = moitié basse. Les couleurs DA sont héritées.
async function extractPalette(file) {
  const img = sharp(path.join(ISOTILES, `${file}.png`)).resize(160, 160, { fit: "inside" });
  const { data, info } = await img.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let top = height, bot = 0, left = width, right = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > 40) {
        if (y < top) top = y; if (y > bot) bot = y;
        if (x < left) left = x; if (x > right) right = x;
      }
    }
  }
  const split = top + (bot - top) * 0.42; // ~ hauteur du losange dans un cube 2:1
  const topPx = [], sidePx = [];
  for (let y = top; y <= bot; y++) {
    for (let x = left; x <= right; x++) {
      const o = (y * width + x) * channels;
      if (data[o + 3] < 220) continue;
      (y < split ? topPx : sidePx).push([data[o], data[o + 1], data[o + 2]]);
    }
  }
  return {
    top: dominantColors(topPx, 8),
    side: dominantColors(sidePx, 6),
    accentPool: [...topPx, ...sidePx],
  };
}

async function writePng(render, file) {
  await sharp(Buffer.from(render.rgba), { raw: { width: render.width, height: render.height, channels: 4 } })
    .png()
    .toFile(file);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
  const size = Number(opt("size", 32)); // D1 : 32 par défaut, paramétrable
  const variants = Number(opt("variants", 3));
  const only = opt("only", "")?.split(",").filter(Boolean);
  const sub = opt("out", "");
  const outVox = sub ? path.join(OUT_VOX, sub) : OUT_VOX;
  const outPreview = sub ? path.join(OUT_PREVIEW, sub) : OUT_PREVIEW;
  await mkdir(outVox, { recursive: true });
  await mkdir(outPreview, { recursive: true });

  const sheetTiles = [];
  for (const def of BLOCKS) {
    if (only?.length && !only.includes(def.id)) continue;
    let pal;
    if (!def.src) pal = MIST_PALETTE;
    else {
      const base = await extractPalette(def.src);
      let accents = [];
      if (def.accentsFrom) {
        const acc = await extractPalette(def.accentsFrom);
        accents = dominantColors(acc.accentPool, 4, { bySat: true, minDist: 40 });
      }
      pal = { top: base.top, side: base.side, accents };
      if (def.id === "water") {
        // l'isotile eau traîne des reflets verdâtres de berge — on ne garde que
        // les nuances où le bleu domine (la profondeur reste bleue, pas kaki)
        const blue = pal.top.filter(([r, g, b2]) => b2 >= g - 6 && b2 > r);
        if (blue.length >= 3) pal.top = blue;
      }
    }
    const models = [];
    for (let v = 0; v < variants; v++) {
      const model = generateBlock(def, pal, { size, seed: 42 + v * 1000 + def.id.length });
      models.push(model);
      await writeFile(path.join(outVox, `${def.id}-v${v}.vox`), encodeVox(model));
    }
    // previews : bloc seul (v0) + tuilage 2×2 mélangeant les variantes + pile de 2
    await writePng(renderModel(models[0], { s: 6 }), path.join(outPreview, `${def.id}.png`));
    const tiling = renderTiling(
      [
        { model: models[0], gx: 0, gy: 0, gz: 0 },
        { model: models[1 % models.length], gx: 1, gy: 0, gz: 0 },
        { model: models[2 % models.length], gx: 0, gy: 1, gz: 0 },
        { model: models[0], gx: 1, gy: 1, gz: 0 },
        { model: models[1 % models.length], gx: 1, gy: 1, gz: 1 }, // empilement (raccord vertical)
      ],
      { s: 3 },
    );
    await writePng(tiling, path.join(outPreview, `${def.id}-tiling.png`));
    sheetTiles.push(def.id);
    console.log(`✓ ${def.id} (${variants} variantes, palette ${pal.top.length}+${pal.side.length}+${pal.accents.length})`);
  }

  // Contact sheet : previews "bloc seul" en grille, étiquettes SVG.
  const CELL = 240, LABEL = 26;
  const cols = Math.min(4, sheetTiles.length);
  const rows = Math.ceil(sheetTiles.length / cols);
  const composites = [];
  for (let i = 0; i < sheetTiles.length; i++) {
    const id = sheetTiles[i];
    const x = (i % cols) * CELL, y = Math.floor(i / cols) * (CELL + LABEL);
    const img = await sharp(path.join(outPreview, `${id}.png`))
      .resize(CELL - 16, CELL - 16, { fit: "inside" })
      .toBuffer();
    composites.push({ input: img, left: x + 8, top: y + 8 });
    composites.push({
      input: Buffer.from(
        `<svg width="${CELL}" height="${LABEL}"><text x="50%" y="18" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#e8e4d8">${id}</text></svg>`,
      ),
      left: x,
      top: y + CELL - 8,
    });
  }
  await sharp({
    create: { width: cols * CELL, height: rows * (CELL + LABEL), channels: 4, background: { r: 43, g: 41, b: 51, alpha: 1 } },
  })
    .composite(composites)
    .png()
    .toFile(path.join(outPreview, "SHEET.png"));
  console.log(`Contact sheet → ${path.relative(ROOT, path.join(outPreview, "SHEET.png"))}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
