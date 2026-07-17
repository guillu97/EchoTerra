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
import { makeRng } from "./recipes.mjs";
import { encodeVox } from "./vox-format.mjs";
import { renderModel } from "./render-iso.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_VOX = path.join(ROOT, "frontend", "public", "voxels", "props");
const OUT_PREVIEW = path.join(ROOT, "asset-index", "voxels", "props");

const SIZE = { sx: 16, sy: 16, sz: 24 };

function ellipsoid(g, cx, cy, cz, rx, ry, rz, rgb, rnd, jitterRgb = 8) {
  for (let z = Math.floor(cz - rz); z <= cz + rz; z++) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
        if (d > 1) continue;
        const j = (rnd() - 0.5) * 2 * jitterRgb;
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
  g.box(Math.round(cx) - 1, Math.round(cx), Math.round(cy) - 1, Math.round(cy), 0, 7, trunk);
  ellipsoid(g, cx, cy, 13, 6.2, 6.2, 6.5, canopy, rnd, 6);
  // deux excroissances pour casser la sphère parfaite
  ellipsoid(g, cx - 3 + rnd() * 6, cy - 3 + rnd() * 6, 16 + rnd() * 2, 3.4, 3.4, 3.2, shade(canopy, 1.06), rnd, 5);
  ellipsoid(g, cx - 3 + rnd() * 6, cy - 3 + rnd() * 6, 10 + rnd() * 2, 3.2, 3.2, 3, shade(canopy, 0.95), rnd, 5);
  return { ...SIZE, size: SIZE.sx, data: g.data, palette: g.palette };
}

function rock(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  const base = [206, 200, 188];
  ellipsoid(g, cx, cy, 2.4, 4.6, 3.8, 3.2, base, rnd, 7);
  ellipsoid(g, cx + 3, cy + 2, 1.6, 2.4, 2, 2, shade(base, 0.93), rnd, 6);
  return { ...SIZE, size: SIZE.sx, data: g.data, palette: g.palette };
}

const GREEN = [176, 214, 160];
const PINK = [232, 198, 210];
const DEEP = [148, 194, 138];

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
