// Props voxel du style diorama (arbres-boules verts/roses, rochers) — la moitié
// du charme de la référence. 3 variantes par prop → /voxels/props/<id>-v<k>.vox
// (le format attendu par BlockLibrary côté client).
//
//   node scripts/voxel/gen-props.mjs

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { Grid, shade } from "./char-recipe.mjs";
import { makeRng } from "../../frontend/src/voxel/shared/recipes.mjs";
import { encodeVox } from "../../frontend/src/voxel/shared/vox-format.mjs";
import { renderModel } from "./render-iso.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_VOX = path.join(ROOT, "frontend", "public", "voxels", "props");
const OUT_PREVIEW = path.join(ROOT, "asset-index", "voxels", "props");

// ×1.25 (retour « trop pixelisé ») : canopées plus fines — 24³ essayé mais
// 2415 arbres × ~2.7k tris = 13 M au banc plein monde, 20³ est le compromis
const SIZE = { sx: 20, sy: 20, sz: 30 };

function ellipsoid(g, cx, cy, cz, rx, ry, rz, rgb, rnd, jitterRgb = 8) {
  for (let z = Math.floor(cz - rz); z <= cz + rz; z++) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
        if (d > 1) continue;
        // jitter QUANTIFIÉ en 3 teintes (−j / 0 / +j) : un jitter par voxel
        // faisait exploser le greedy meshing (~2 k tris/arbre × 2 400 arbres)
        const j = (((rnd() * 3) | 0) - 1) * jitterRgb;
        g.set(x, y, z, [rgb[0] + j, rgb[1] + j, rgb[2] + j].map((v) => Math.max(0, Math.min(255, Math.round(v)))));
      }
    }
  }
}

// arbre-boule : tronc court + canopée en 2-3 sphères fondues, teinte plate
function tree(canopy, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  const trunk = [138, 106, 76];
  g.box(Math.round(cx) - 1, Math.round(cx) + 1, Math.round(cy) - 1, Math.round(cy) + 1, 0, 9, trunk);
  ellipsoid(g, cx, cy, 16.5, 7.8, 7.8, 8.2, canopy, rnd, 6);
  // deux excroissances pour casser la sphère parfaite
  ellipsoid(g, cx - 3.8 + rnd() * 7.6, cy - 3.8 + rnd() * 7.6, 20 + rnd() * 2.5, 4.3, 4.3, 4, shade(canopy, 1.06), rnd, 5);
  ellipsoid(g, cx - 3.8 + rnd() * 7.6, cy - 3.8 + rnd() * 7.6, 12.5 + rnd() * 2.5, 4, 4, 3.8, shade(canopy, 0.95), rnd, 5);
  return { ...SIZE, size: SIZE.sx, data: g.data, palette: g.palette };
}

function rock(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  const base = [206, 200, 188];
  ellipsoid(g, cx, cy, 3, 5.8, 4.8, 4, base, rnd, 7);
  ellipsoid(g, cx + 3.8, cy + 2.5, 2, 3, 2.5, 2.5, shade(base, 0.93), rnd, 6);
  return { ...SIZE, size: SIZE.sx, data: g.data, palette: g.palette };
}

// canopées densifiées (retour « moins pâle ») : verts feuillus, rose cerisier franc
// SAPIN : tronc + 3 étages coniques ; variante enneigée = pourtour des étages
// saupoudré de blanc (montagne/neige).
function pine(snowy, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  const trunk = [116, 88, 62];
  const needle = snowy ? [96, 138, 112] : [84, 146, 96];
  const snowC = [238, 243, 249];
  g.box(Math.round(cx) - 1, Math.round(cx), Math.round(cy) - 1, Math.round(cy), 0, 5, trunk);
  const tiers = [
    { z0: 4, z1: 10, r: 7.2 },
    { z0: 10, z1: 16, r: 5.4 },
    { z0: 16, z1: 22, r: 3.6 },
    { z0: 22, z1: 27, r: 2.0 },
  ];
  for (const { z0, z1, r } of tiers) {
    for (let z = z0; z <= z1; z++) {
      const t = (z - z0) / (z1 - z0);
      const rad = r * (1 - t * 0.85);
      for (let y = Math.floor(cy - rad); y <= cy + rad; y++) {
        for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
          const d2 = ((x - cx) / rad) ** 2 + ((y - cy) / rad) ** 2;
          if (d2 > 1) continue;
          const rim = d2 > 0.55; // pourtour de l'étage
          const j = (((rnd() * 3) | 0) - 1) * 6;
          let c = [needle[0] + j, needle[1] + j, needle[2] + j];
          if (snowy && rim && z === z0) c = snowC; // neige posée sur le bord bas de l'étage
          g.set(x, y, z, c.map((v) => Math.max(0, Math.min(255, Math.round(v)))));
        }
      }
    }
  }
  if (snowy) g.set(cx, cy, 27, snowC);
  return { ...SIZE, size: SIZE.sx, data: g.data, palette: g.palette };
}

// TOUFFE D'HERBE : 5-7 brins fins de hauteurs variées, vert vif.
function tuft(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2, cy = SIZE.sy / 2;
  const n = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const bx = Math.round(cx - 4 + rnd() * 8);
    const by = Math.round(cy - 4 + rnd() * 8);
    const h = 4 + Math.floor(rnd() * 5);
    const tone = 0.9 + rnd() * 0.25;
    const c = [Math.round(118 * tone), Math.round(186 * tone), Math.round(92 * tone)];
    for (let z = 0; z < h; z++) g.set(bx + (z >= h - 1 && rnd() < 0.5 ? 1 : 0), by, z, c);
  }
  return { ...SIZE, size: SIZE.sx, data: g.data, palette: g.palette };
}

// FLEURS : 3 tiges + têtes colorées (couleur par variante).
function flowers(head, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2, cy = SIZE.sy / 2;
  const stem = [104, 160, 84];
  for (let i = 0; i < 3; i++) {
    const bx = Math.round(cx - 3 + rnd() * 6);
    const by = Math.round(cy - 3 + rnd() * 6);
    const h = 3 + Math.floor(rnd() * 3);
    for (let z = 0; z < h; z++) g.set(bx, by, z, stem);
    g.box(bx - 1, bx, by - 1, by, h, h + 1, head);
    g.set(bx, by, h + 1, [246, 232, 160]); // cœur
  }
  return { ...SIZE, size: SIZE.sx, data: g.data, palette: g.palette };
}

// ROSEAUX : tiges hautes et fines, quenouille brune au sommet (bord d'eau).
function reed(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2, cy = SIZE.sy / 2;
  const n = 4 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const bx = Math.round(cx - 3 + rnd() * 6);
    const by = Math.round(cy - 3 + rnd() * 6);
    const h = 12 + Math.floor(rnd() * 6);
    const tone = 0.92 + rnd() * 0.16;
    const c = [Math.round(168 * tone), Math.round(178 * tone), Math.round(128 * tone)];
    for (let z = 0; z < h; z++) g.set(bx, by, z, c);
    g.box(bx, bx, by, by, h, h + 2, [124, 92, 60]); // quenouille
  }
  return { ...SIZE, size: SIZE.sx, data: g.data, palette: g.palette };
}

const GREEN = [134, 192, 108];
const PINK = [232, 164, 188];
const DEEP = [104, 168, 88];
const FLOWER_HEADS = [[230, 116, 116], [240, 204, 110], [244, 240, 232]]; // rouge/jaune/blanc

async function main() {
  await mkdir(OUT_VOX, { recursive: true });
  await mkdir(OUT_PREVIEW, { recursive: true });
  const defs = [
    { id: "tree-green", make: (v) => tree(v === 1 ? DEEP : GREEN, 11 + v * 77) },
    { id: "tree-pink", make: (v) => tree(shade(PINK, 1 - v * 0.03), 31 + v * 77) },
    { id: "rock", make: (v) => rock(51 + v * 77) },
    // détails par terrain (2026-07-17) : montagne/neige/prairie/rives
    { id: "pine", make: (v) => pine(false, 61 + v * 77) },
    { id: "pine-snow", make: (v) => pine(true, 71 + v * 77) },
    { id: "grass-tuft", make: (v) => tuft(81 + v * 77) },
    { id: "flowers", make: (v) => flowers(FLOWER_HEADS[v % 3], 91 + v * 77) },
    { id: "reed", make: (v) => reed(101 + v * 77) },
  ];
  for (const d of defs) {
    for (let v = 0; v < 3; v++) {
      const model = d.make(v);
      await writeFile(path.join(OUT_VOX, `${d.id}-v${v}.vox`), encodeVox(model));
      if (v === 0) {
        const r = renderModel(model, { s: 10 });
        await sharp(Buffer.from(r.rgba), { raw: { width: r.width, height: r.height, channels: 4 } })
          .png().toFile(path.join(OUT_PREVIEW, `${d.id}.png`));
      }
    }
    console.log(`✓ ${d.id} ×3`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
