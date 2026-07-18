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
const GREEN = [134, 192, 108];
const PINK = [232, 164, 188];
const DEEP = [104, 168, 88];

async function main() {
  await mkdir(OUT_VOX, { recursive: true });
  await mkdir(OUT_PREVIEW, { recursive: true });
  const defs = [
    { id: "tree-green", make: (v) => tree(v === 1 ? DEEP : GREEN, 11 + v * 77) },
    { id: "tree-pink", make: (v) => tree(shade(PINK, 1 - v * 0.03), 31 + v * 77) },
    { id: "rock", make: (v) => rock(51 + v * 77) },
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
