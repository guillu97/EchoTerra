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

// Gabarits en coordonnées GROSSIÈRES 20×20×30, stockage FIN ×1.5 (30×30×45) —
// même principe que les personnages (Grid.fineScale). Les formes COURBES
// (ellipsoid, étages de sapin, disque de nénuphar) sont évaluées PAR VOXEL FIN
// → vraies surfaces lisses ; les traits/boîtes passent par le remplissage de
// cellule (proportions inchangées). ⚠ le jitter de teinte reste quantifié PAR
// CELLULE GROSSIÈRE (hachage de position, pas rnd par voxel fin) : un jitter
// par voxel fin ferait exploser le greedy meshing.
const SIZE = { sx: 20, sy: 20, sz: 30 };
const FINE = 1.5;
const fin = (g) => ({ sx: g.fsx, sy: g.fsy, sz: g.fsz, size: g.fsx, data: g.data, palette: g.palette });

// Boost de saturation GLOBAL (retour 2026-07-19 « pas assez coloré comme les
// images iso ») : chaque couleur est écartée de son gris — les quasi-neutres
// (neige, pierre) bougent à peine, les verts/roses/bleus retrouvent le punch
// des tuiles peintes. Appliqué à la palette de CHAQUE modèle à l'écriture.
function vividProp([r, g, b], k = 1.3, lift = 1.02) {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const c = (v) => Math.max(0, Math.min(255, Math.round((gray + (v - gray) * k) * lift)));
  return [c(r), c(g), c(b)];
}

function jitter3(x, y, z, salt) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177 + salt * 2246822519) >>> 0;
  h = ((h ^ (h >> 13)) * 1103515245) >>> 0;
  return ((h >>> 16) % 3) - 1; // −1 / 0 / +1
}

function ellipsoid(g, cx, cy, cz, rx, ry, rz, rgb, rnd, jitterRgb = 8) {
  const f = g.fs ?? 1;
  const salt = Math.floor(rnd() * 1e6); // une graine de teinte par ellipsoïde
  const fcx = (cx + 0.5) * f - 0.5, fcy = (cy + 0.5) * f - 0.5, fcz = (cz + 0.5) * f - 0.5;
  const frx = rx * f, fry = ry * f, frz = rz * f;
  for (let z = Math.floor(fcz - frz); z <= fcz + frz; z++) {
    for (let y = Math.floor(fcy - fry); y <= fcy + fry; y++) {
      for (let x = Math.floor(fcx - frx); x <= fcx + frx; x++) {
        const d = ((x - fcx) / frx) ** 2 + ((y - fcy) / fry) ** 2 + ((z - fcz) / frz) ** 2;
        if (d > 1) continue;
        const cxc = Math.floor(x / (f * 2)), cyc = Math.floor(y / (f * 2)), czc = Math.floor(z / (f * 2));
        const j = jitter3(cxc, cyc, czc, salt) * jitterRgb;
        g.setFine(x, y, z, [rgb[0] + j, rgb[1] + j, rgb[2] + j].map((v) => Math.max(0, Math.min(255, Math.round(v)))));
      }
    }
  }
}

// arbre-boule : tronc court + canopée en 2-3 sphères fondues, teinte plate
function tree(canopy, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  const trunk = [138, 106, 76];
  g.box(Math.round(cx) - 1, Math.round(cx) + 1, Math.round(cy) - 1, Math.round(cy) + 1, 0, 9, trunk);
  ellipsoid(g, cx, cy, 16.5, 7.8, 7.8, 8.2, canopy, rnd, 6);
  // deux excroissances pour casser la sphère parfaite
  ellipsoid(g, cx - 3.8 + rnd() * 7.6, cy - 3.8 + rnd() * 7.6, 20 + rnd() * 2.5, 4.3, 4.3, 4, shade(canopy, 1.06), rnd, 5);
  ellipsoid(g, cx - 3.8 + rnd() * 7.6, cy - 3.8 + rnd() * 7.6, 12.5 + rnd() * 2.5, 4, 4, 3.8, shade(canopy, 0.95), rnd, 5);
  return fin(g);
}

function rock(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  const base = [206, 200, 188];
  ellipsoid(g, cx, cy, 3, 5.8, 4.8, 4, base, rnd, 7);
  ellipsoid(g, cx + 3.8, cy + 2.5, 2, 3, 2.5, 2.5, shade(base, 0.93), rnd, 6);
  return fin(g);
}

// canopées densifiées (retour « moins pâle ») : verts feuillus, rose cerisier franc
// SAPIN : tronc + 3 étages coniques ; variante enneigée = pourtour des étages
// saupoudré de blanc (montagne/neige).
function pine(snowy, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
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
  // cônes évalués PAR VOXEL FIN (silhouette lisse), teinte par cellule grossière
  const f = g.fs, fcx = (cx + 0.5) * f - 0.5, fcy = (cy + 0.5) * f - 0.5;
  for (const { z0, z1, r } of tiers) {
    const salt = Math.floor(rnd() * 1e6);
    const zf0 = Math.round(z0 * f), zf1 = Math.round((z1 + 1) * f) - 1;
    for (let z = zf0; z <= zf1; z++) {
      const t = (z - zf0) / (zf1 - zf0);
      const rad = r * (1 - t * 0.85) * f;
      for (let y = Math.floor(fcy - rad); y <= fcy + rad; y++) {
        for (let x = Math.floor(fcx - rad); x <= fcx + rad; x++) {
          const d2 = ((x - fcx) / rad) ** 2 + ((y - fcy) / rad) ** 2;
          if (d2 > 1) continue;
          const rim = d2 > 0.55; // pourtour de l'étage
          const j = jitter3(Math.floor(x / (f * 2)), Math.floor(y / (f * 2)), Math.floor(z / (f * 2)), salt) * 6;
          let c = [needle[0] + j, needle[1] + j, needle[2] + j];
          if (snowy && rim && z < zf0 + f) c = snowC; // neige posée sur le bord bas de l'étage
          g.setFine(x, y, z, c.map((v) => Math.max(0, Math.min(255, Math.round(v)))));
        }
      }
    }
  }
  if (snowy) g.set(cx, cy, 27, snowC);
  return fin(g);
}

// TOUFFE D'HERBE : 5-7 brins fins de hauteurs variées, vert vif.
// `base` optionnel = teinte des brins (dune-grass la recolore vert-jaune sec).
function tuft(seed, base = [118, 186, 92]) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2, cy = SIZE.sy / 2;
  const n = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const bx = Math.round(cx - 4 + rnd() * 8);
    const by = Math.round(cy - 4 + rnd() * 8);
    const h = 4 + Math.floor(rnd() * 5);
    const tone = 0.9 + rnd() * 0.25;
    const c = [Math.round(base[0] * tone), Math.round(base[1] * tone), Math.round(base[2] * tone)];
    for (let z = 0; z < h; z++) g.set(bx + (z >= h - 1 && rnd() < 0.5 ? 1 : 0), by, z, c);
  }
  return fin(g);
}

// FLEURS : 3 tiges + têtes colorées (couleur par variante).
function flowers(head, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
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
  return fin(g);
}

// ROSEAUX : tiges hautes et fines, quenouille brune au sommet (bord d'eau).
function reed(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
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
  return fin(g);
}

// ============================================================================
// LOT D1 (WORLD-DETAILS-PLAN) : couverture par biome
// ============================================================================

// EAU — nénuphar : disque plat avec encoche, fleur rose sur certaines variantes
function lilypad(withFlower, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  const notch = rnd() * Math.PI * 2; // encoche du nénuphar
  // disque évalué PAR VOXEL FIN (bord lisse), une seule couche fine (pad mince)
  const f = g.fs, fcx = (cx + 0.5) * f - 0.5, fcy = (cy + 0.5) * f - 0.5;
  for (let y = 0; y < g.fsy; y++) {
    for (let x = 0; x < g.fsx; x++) {
      const dx = x - fcx, dy = y - fcy;
      const d = Math.hypot(dx, dy);
      if (d > 4.6 * f) continue;
      const a = Math.atan2(dy, dx);
      let da = Math.abs(a - notch);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < 0.5 && d > 1.5 * f) continue; // l'encoche
      const cxc = Math.floor(x / f), cyc = Math.floor(y / f);
      const tone = 0.95 + ((((cxc * 7 + cyc * 13 + seed) >>> 0) % 3) - 1) * 0.05;
      g.setFine(x, y, 0, [Math.round(112 * tone), Math.round(176 * tone), Math.round(102 * tone)]);
    }
  }
  if (withFlower) {
    g.box(Math.round(cx) - 1, Math.round(cx), Math.round(cy) - 1, Math.round(cy), 1, 1, [238, 176, 200]);
    g.set(cx, cy, 2, [246, 232, 160]);
  }
  return fin(g);
}

// EAU — rocher émergé cerclé d'écume
function waterRock(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  ellipsoid(g, cx, cy, 1.6, 3.4, 2.8, 2.6, [186, 178, 166], rnd, 7);
  for (let y = 0; y < SIZE.sy; y++) {
    for (let x = 0; x < SIZE.sx; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > 3.4 && d < 4.6 && rnd() < 0.7) g.set(x, y, 0, [226, 240, 248]); // écume
    }
  }
  return fin(g);
}

// EAU/SABLE — bois flotté : branche couchée fourchue
function driftwood(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cy = SIZE.sy / 2;
  const wood = [212, 192, 162];
  for (let x = 3; x < 16; x++) {
    g.box(x, x, cy - 1, cy, 0, x % 5 === 0 ? 2 : 1, shade(wood, 0.94 + rnd() * 0.1));
    if (x > 10) g.set(x, cy + (x - 10), 0, shade(wood, 0.9)); // la fourche
  }
  return fin(g);
}

// SABLE — coquillages + étoile de mer
function shells(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cols = [[238, 205, 210], [235, 176, 152], [244, 238, 224]];
  for (let i = 0; i < 3; i++) {
    const bx = 4 + Math.floor(rnd() * 12), by = 4 + Math.floor(rnd() * 12);
    ellipsoid(g, bx, by, 0.6, 1.4, 1.1, 1, cols[i % 3], rnd, 4);
  }
  // étoile de mer corail : croix de 5 voxels
  const sx0 = 4 + Math.floor(rnd() * 12), sy0 = 4 + Math.floor(rnd() * 12);
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) g.set(sx0 + dx, sy0 + dy, 0, [236, 146, 122]);
  return fin(g);
}

// SABLE — galets
function pebbleCluster(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  for (let i = 0; i < 4 + Math.floor(rnd() * 3); i++) {
    const bx = 4 + rnd() * 12, by = 4 + rnd() * 12, r = 1.2 + rnd() * 1.1;
    ellipsoid(g, bx, by, 0.7, r, r * 0.85, r * 0.7, [202, 196, 186], rnd, 6);
  }
  return fin(g);
}

// SABLE — algues échouées : cordon serpentant vert sombre
function kelp(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  let x = 3, y = 6 + Math.floor(rnd() * 8);
  const c = [96, 138, 92];
  for (let i = 0; i < 12; i++) {
    g.set(x, y, 0, shade(c, 0.9 + rnd() * 0.2));
    if (rnd() < 0.4) g.set(x, y + 1, 0, shade(c, 0.85)); // petites feuilles
    x += 1;
    y += rnd() < 0.5 ? (rnd() < 0.5 ? 1 : -1) : 0;
  }
  return fin(g);
}

// PRAIRIE — hautes herbes : patch dense de brins hauts
function tallgrass(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  for (let i = 0; i < 14 + Math.floor(rnd() * 5); i++) {
    const bx = Math.round(4 + rnd() * 12), by = Math.round(4 + rnd() * 12);
    const h = 6 + Math.floor(rnd() * 5);
    const tone = 0.85 + rnd() * 0.3;
    const c = [Math.round(122 * tone), Math.round(184 * tone), Math.round(96 * tone)];
    for (let z = 0; z < h; z++) g.set(bx + (z >= h - 2 && rnd() < 0.5 ? 1 : 0), by, z, z >= h - 1 ? shade(c, 1.15) : c);
  }
  return fin(g);
}

// PRAIRIE — buisson à baies
function berryBush(berry, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  ellipsoid(g, cx, cy, 3.4, 5.2, 5.2, 3.8, [116, 172, 96], rnd, 6);
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2, r = 3 + rnd() * 2;
    g.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3 + Math.floor(rnd() * 3), berry);
  }
  return fin(g);
}

// PRAIRIE — marguerite géante
function daisy(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = Math.round(SIZE.sx / 2), cy = Math.round(SIZE.sy / 2);
  const h = 7 + Math.floor(rnd() * 3);
  for (let z = 0; z < h; z++) g.set(cx, cy, z, [104, 160, 84]);
  g.set(cx - 1, cy, Math.round(h * 0.6), [96, 148, 78]); // feuille
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    g.set(cx + dx, cy + dy, h, [246, 244, 238]); // pétales
  }
  g.set(cx, cy, h, [244, 210, 110]); // cœur
  g.set(cx, cy, h + 1, [244, 210, 110]);
  return fin(g);
}

// PRAIRIE — souche + champignon
function stump(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  for (let z = 0; z < 4; z++) ellipsoid(g, cx, cy, z, 3, 3, 0.6, [138, 106, 76], rnd, 5);
  ellipsoid(g, cx, cy, 4, 2.6, 2.6, 0.5, [206, 180, 142], rnd, 4); // coupe claire
  g.set(cx + 2, cy - 2, 4, [226, 120, 110]); // mini champignon
  g.set(cx + 2, cy - 2, 5, [236, 146, 130]);
  return fin(g);
}

// FORÊT — champignon (chapeau coloré, pois optionnels)
function mushroomProp(cap, dots, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  g.box(Math.round(cx) - 1, Math.round(cx), Math.round(cy) - 1, Math.round(cy), 0, 3, [238, 228, 210]);
  ellipsoid(g, cx, cy, 4.4, 3.6, 3.6, 1.9, cap, rnd, 6);
  if (dots) for (let i = 0; i < 5; i++) g.set(cx - 2.5 + rnd() * 5, cy - 2.5 + rnd() * 5, 5 + Math.round(rnd()), [246, 244, 238]);
  return fin(g);
}

// FORÊT — fougère : arcs retombants
function fern(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = Math.round(SIZE.sx / 2), cy = Math.round(SIZE.sy / 2);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd();
    const ux = Math.cos(a), uy = Math.sin(a);
    for (let k = 0; k < 6; k++) {
      const z = k < 3 ? k + 1 : 4 - (k - 3); // monte puis retombe
      g.set(cx + ux * (1 + k * 0.8), cy + uy * (1 + k * 0.8), Math.max(0, z), [88, 148, 92]);
    }
  }
  return fin(g);
}

// FORÊT — tronc tombé moussu
function logFallen(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cy = SIZE.sy / 2 - 0.5;
  for (let x = 3; x < 16; x++) {
    ellipsoid(g, x, cy, 1.6, 0.6, 2.2, 1.8, [128, 100, 72], rnd, 5);
  }
  for (let x = 4; x < 15; x++) if (rnd() < 0.7) g.set(x, cy, 3, [110, 168, 96]); // mousse
  return fin(g);
}

// FORÊT — buisson dense
function bushDense(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  ellipsoid(g, cx - 1.5, cy, 2.8, 4.4, 4.2, 3.2, [96, 152, 84], rnd, 6);
  ellipsoid(g, cx + 2.5, cy + 1, 2.2, 3.2, 3, 2.6, [88, 144, 78], rnd, 6);
  return fin(g);
}

// MONTAGNE — éboulis
function scree(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  for (let i = 0; i < 6; i++) {
    const bx = 5 + rnd() * 10, by = 5 + rnd() * 10, r = 1 + rnd() * 1.4;
    ellipsoid(g, bx, by, 0.8, r, r * 0.9, r * 0.8, [196, 188, 176], rnd, 8);
  }
  return fin(g);
}

// MONTAGNE — cristaux inclinés par paire
function crystals(color, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = Math.round(SIZE.sx / 2), cy = Math.round(SIZE.sy / 2);
  const spike = (bx, by, h, lean) => {
    for (let z = 0; z < h; z++) {
      const off = Math.round(z * lean);
      const w = z > h - 3 ? 0 : 1; // pointe fine
      g.box(bx + off - w, bx + off, by - w, by, z, z, z === h - 1 ? shade(color, 1.25) : color);
    }
  };
  spike(cx - 2, cy, 6 + Math.floor(rnd() * 3), 0.18);
  spike(cx + 2, cy + 2, 4 + Math.floor(rnd() * 2), -0.22);
  return fin(g);
}

// MONTAGNE — cairn : pierres empilées
function cairn(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  const radii = [3, 2.4, 1.9, 1.4, 1];
  let z = 0;
  for (const r of radii) {
    ellipsoid(g, cx + (rnd() - 0.5), cy + (rnd() - 0.5), z + r * 0.5, r, r * 0.9, r * 0.62, [190, 182, 170], rnd, 7);
    z += Math.max(1, Math.round(r * 0.9));
  }
  return fin(g);
}

// MONTAGNE/NEIGE — arbre mort (givré en variante)
function deadTree(snowy, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = Math.round(SIZE.sx / 2), cy = Math.round(SIZE.sy / 2);
  const wood = [134, 116, 96];
  for (let z = 0; z < 13; z++) g.box(cx - 1, cx, cy - 1, cy, z, z, wood);
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2, z0 = 5 + Math.floor(rnd() * 6);
    for (let k = 1; k <= 4; k++) {
      const bx = cx + Math.round(Math.cos(a) * k), by = cy + Math.round(Math.sin(a) * k);
      g.set(bx, by, z0 + Math.floor(k / 2), wood);
      if (snowy) g.set(bx, by, z0 + Math.floor(k / 2) + 1, [238, 243, 249]);
    }
  }
  if (snowy) g.box(cx - 1, cx, cy - 1, cy, 13, 13, [238, 243, 249]);
  return fin(g);
}

// NEIGE — congère
function snowdrift(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  ellipsoid(g, cx, cy, 1.2, 5.4, 3.6, 2, [240, 244, 250], rnd, 3);
  ellipsoid(g, cx + 3, cy + 2, 0.8, 2.6, 2, 1.2, [234, 240, 247], rnd, 3);
  return fin(g);
}

// NEIGE — pics de glace
function iceSpikes(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = Math.round(SIZE.sx / 2), cy = Math.round(SIZE.sy / 2);
  const ice = [198, 224, 244];
  const spike = (bx, by, h, r) => {
    for (let z = 0; z < h; z++) {
      const rr = Math.max(0, r * (1 - z / h));
      g.box(bx - rr, bx + rr, by - rr, by + rr, z, z, z === h - 1 ? [236, 246, 252] : ice);
    }
  };
  spike(cx - 2, cy, 7 + Math.floor(rnd() * 3), 1.6);
  spike(cx + 2, cy + 2, 5, 1.2);
  spike(cx + 1, cy - 3, 4, 1);
  return fin(g);
}

// NEIGE — buisson givré
function frostBush(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  ellipsoid(g, cx, cy, 2.6, 4, 4, 3, [230, 238, 244], rnd, 4);
  for (let i = 0; i < 6; i++) g.set(cx - 3 + rnd() * 6, cy - 3 + rnd() * 6, 1 + Math.floor(rnd() * 3), [170, 200, 176]);
  return fin(g);
}

// ============================================================================
// LOT D2 : repères (landmarks) uniques par seed
// ============================================================================

// PRAIRIE — épouvantail
function scarecrow(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  void rnd;
  const cx = Math.round(SIZE.sx / 2), cy = Math.round(SIZE.sy / 2);
  const wood = [140, 112, 80];
  for (let z = 0; z < 12; z++) g.set(cx, cy, z, wood); // mât
  g.box(cx - 5, cx + 5, cy, cy, 8, 8, wood); // bras
  g.box(cx - 1, cx + 1, cy - 1, cy + 1, 9, 11, [226, 200, 150]); // tête sac
  g.set(cx - 1, cy - 1, 10, [60, 50, 44]); g.set(cx + 1, cy - 1, 10, [60, 50, 44]); // yeux
  g.box(cx - 2, cx + 2, cy - 2, cy + 2, 12, 12, [222, 186, 110]); // chapeau paille
  g.box(cx - 1, cx + 1, cy - 1, cy + 1, 13, 13, [214, 176, 100]);
  g.box(cx - 3, cx + 3, cy, cy, 5, 7, [186, 118, 96]); // tunique
  return fin(g);
}

// NEIGE — bonhomme de neige
function snowman(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  ellipsoid(g, cx, cy, 3, 4.4, 4.4, 3.6, [242, 246, 251], rnd, 2);
  ellipsoid(g, cx, cy, 8.6, 3.2, 3.2, 2.8, [238, 243, 249], rnd, 2);
  g.set(cx - 1, cy + 3, 9, [50, 46, 52]); g.set(cx + 1, cy + 3, 9, [50, 46, 52]); // yeux charbon
  g.set(cx, cy + 3, 8, [232, 140, 70]); g.set(cx, cy + 4, 8, [232, 140, 70]); // carotte
  g.box(cx - 6, cx - 4, cy, cy, 8, 9, [124, 96, 66]); // bras branches
  g.box(cx + 4, cx + 6, cy, cy, 8, 9, [124, 96, 66]);
  g.box(cx - 2, cx + 2, cy - 2, cy + 2, 11, 11, [70, 66, 78]); // chapeau
  g.box(cx - 1, cx + 1, cy - 1, cy + 1, 12, 13, [70, 66, 78]);
  return fin(g);
}

// RIVE — barque échouée
function boat(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  void rnd;
  const cy = Math.round(SIZE.sy / 2);
  const hull = [150, 116, 82];
  for (let x = 3; x < 17; x++) {
    const taper = x < 5 ? x - 3 : x > 14 ? 16 - x : 3;
    g.box(x, x, cy - taper, cy + taper, 0, 1, hull);
    g.box(x, x, cy - taper, cy - taper, 2, 3, shade(hull, 1.12)); // bordés
    g.box(x, x, cy + taper, cy + taper, 2, 3, shade(hull, 1.12));
  }
  g.box(8, 11, cy - 2, cy + 2, 2, 2, shade(hull, 0.85)); // banc
  return fin(g);
}

// MONTAGNE — menhir gravé
function menhir(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  for (let z = 0; z < 14; z++) {
    const r = 2.6 - z * 0.08;
    ellipsoid(g, cx + Math.sin(z * 0.4) * 0.4, cy, z + 0.5, r, r * 0.8, 0.7, [178, 170, 158], rnd, 6);
  }
  for (let z = 3; z < 11; z += 2) g.set(cx + 2, cy, z, [122, 186, 202]); // gravure accent
  return fin(g);
}

// SABLE — tortue
function turtle(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  ellipsoid(g, cx, cy, 1.8, 4, 3.2, 2.2, [110, 152, 102], rnd, 5);
  for (let i = 0; i < 5; i++) g.set(cx - 2 + rnd() * 4, cy - 1.5 + rnd() * 3, 3, [88, 126, 84]); // écailles
  ellipsoid(g, cx + 4.4, cy, 1.2, 1.4, 1.2, 1.1, [138, 172, 122], rnd, 3); // tête
  g.set(cx + 5, cy - 1, 1, [40, 44, 40]);
  for (const [dx, dy] of [[-3, -3], [-3, 3], [3, -3], [3, 3]]) ellipsoid(g, cx + dx, cy + dy, 0.6, 1.2, 1, 0.7, [126, 160, 112], rnd, 3);
  return fin(g);
}

// PRAIRIE — ruche sauvage sur souche
function beehive(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  for (let z = 0; z < 3; z++) ellipsoid(g, cx, cy, z, 2.6, 2.6, 0.6, [138, 106, 76], rnd, 4);
  for (let z = 0; z < 6; z++) {
    const r = 3.2 * Math.sin(((z + 1) / 7) * Math.PI) + 0.8;
    const band = z % 2 === 0 ? [226, 186, 108] : [206, 162, 88];
    ellipsoid(g, cx, cy, 3.5 + z, r, r, 0.6, band, rnd, 4);
  }
  g.set(cx, cy + 3, 5, [70, 58, 44]); // entrée
  g.set(cx + 3, cy + 2, 8, [240, 206, 90]); // abeilles
  g.set(cx - 3, cy - 2, 9, [240, 206, 90]);
  return fin(g);
}

// ============================================================================
// LOT D3 : vie ambiante — décorative, petite et éloignée des monstres.
// Les volants (papillons/mouettes/lucioles) cuisent leur ALTITUDE dans la
// recette (voxels en l'air) : un prop = un petit groupe qui flotte au-dessus
// de la tuile, aucun squelette/animation.
// ============================================================================

// PRAIRIE (jour) — 3 papillons en l'air, ailes en V + corps sombre
function butterflies(wing, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  for (let i = 0; i < 3; i++) {
    const bx = 4 + Math.floor(rnd() * 12), by = 4 + Math.floor(rnd() * 12);
    const z = 13 + Math.floor(rnd() * 8);
    const flap = rnd() < 0.5 ? 1 : 0; // battement figé différent par papillon
    g.set(bx - 1, by, z + flap, wing);
    g.set(bx + 1, by, z + flap, wing);
    g.set(bx, by, z, shade(wing, 0.72));
  }
  return fin(g);
}

// EAU (jour) — 2-3 mouettes : « V » blancs au-dessus de l'eau
function gulls(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const n = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const bx = 4 + Math.floor(rnd() * 12), by = 4 + Math.floor(rnd() * 12);
    const z = 18 + Math.floor(rnd() * 6);
    g.set(bx, by, z, [244, 246, 250]);
    g.set(bx - 1, by, z + 1, [236, 240, 246]);
    g.set(bx + 1, by, z + 1, [236, 240, 246]);
    g.set(bx - 2, by, z + 1, [190, 196, 206]); // bout d'aile gris
    g.set(bx + 2, by, z + 1, [190, 196, 206]);
  }
  return fin(g);
}

// FORÊT (crépuscule) — lucioles : motes jaune-vert (matériau self-lit côté carte)
function fireflies(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  for (let i = 0; i < 5 + Math.floor(rnd() * 2); i++) {
    const bx = 3 + Math.floor(rnd() * 14), by = 3 + Math.floor(rnd() * 14);
    const z = 5 + Math.floor(rnd() * 11);
    g.set(bx, by, z, rnd() < 0.5 ? [236, 250, 150] : [214, 240, 130]);
  }
  return fin(g);
}

// PRAIRIE/NEIGE (jour) — lapin assis (fourrure paramétrée : crème ou lièvre blanc)
function bunny(fur, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  ellipsoid(g, cx - 0.5, cy, 1.6, 2.4, 1.8, 1.7, fur, rnd, 4); // corps
  ellipsoid(g, cx + 2, cy, 3, 1.4, 1.2, 1.2, shade(fur, 1.05), rnd, 3); // tête
  g.box(cx + 2, cx + 2, cy - 1, cy - 1, 4, 6, shade(fur, 0.96)); // oreilles
  g.box(cx + 2, cx + 2, cy + 1, cy + 1, 4, 6, shade(fur, 0.96));
  g.set(cx + 3, cy, 3, [60, 54, 52]); // œil
  g.set(cx - 3, cy, 2, [248, 248, 250]); // queue pompon
  return fin(g);
}

// SABLE (jour) — crabe : corps rouge doux + pinces + yeux
function crab(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  const red = [226, 120, 104];
  ellipsoid(g, cx, cy, 1.2, 2.4, 1.8, 1.1, red, rnd, 5); // carapace
  ellipsoid(g, cx + 2.6, cy - 1.6, 1, 1, 0.9, 0.8, shade(red, 1.08), rnd, 3); // pinces
  ellipsoid(g, cx + 2.6, cy + 1.6, 1, 1, 0.9, 0.8, shade(red, 1.08), rnd, 3);
  for (const dy of [-2, 2]) for (const dx of [-1.5, 0, 1.5]) g.set(cx + dx, cy + dy, 0, shade(red, 0.85)); // pattes
  g.set(cx + 1, cy - 1, 3, [50, 46, 48]); // yeux sur la carapace
  g.set(cx + 1, cy + 1, 3, [50, 46, 48]);
  return fin(g);
}

// ============================================================================
// LOT D4 : effets — toile d'araignée, souffle de neige, aigle (la cascade et
// les veines de minerai sont côté terrain/shader, pas des props)
// ============================================================================

// FORÊT — toile d'araignée : voile triangulaire pâle suspendu (annonce
// l'Araignée Cristalline du GDD). Fils = voxels épars, pas de plein.
function web(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  void rnd;
  const cx = Math.round(SIZE.sx / 2), cy = Math.round(SIZE.sy / 2);
  const pale = [240, 242, 248];
  const top = 16, bot = 7, half = 5;
  for (let k = 0; k <= 9; k++) { // les deux fils du bord, de l'apex vers le bas
    const z = top - k, off = Math.round((k / 9) * half);
    g.set(cx - off, cy, z, pale);
    g.set(cx + off, cy, z, pale);
  }
  for (let x = -half; x <= half; x++) g.set(cx + x, cy, bot, shade(pale, 0.94)); // fil bas
  for (let x = -2; x <= 2; x++) g.set(cx + x, cy, Math.round((top + bot) / 2), shade(pale, 0.9)); // anneau
  g.set(cx, cy, top - 3, pale); // rayon central
  g.set(cx, cy, bot + 3, pale);
  g.set(cx + 1, cy, bot + 2, [216, 220, 230]); // l'araignée discrète
  return fin(g);
}

// NEIGE — souffle de neige : motes blanches dérivantes (figées, style diorama)
function snowMotes(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  for (let i = 0; i < 8 + Math.floor(rnd() * 3); i++) {
    const bx = 3 + Math.floor(rnd() * 14), by = 3 + Math.floor(rnd() * 14);
    const z = 5 + Math.floor(rnd() * 13);
    g.set(bx, by, z, rnd() < 0.5 ? [246, 248, 252] : [234, 240, 248]);
  }
  return fin(g);
}

// MONTAGNE — aigle : silhouette sombre en vol (REPÈRE, tournoie au tick solaire)
function eagleProp(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  void rnd;
  const cx = Math.round(SIZE.sx / 2), cy = Math.round(SIZE.sy / 2);
  const dark = [96, 80, 64];
  const z = 24;
  g.set(cx, cy, z, dark); // corps
  g.set(cx + 1, cy, z, shade(dark, 1.15)); // tête claire
  for (let k = 1; k <= 3; k++) { // ailes en V
    g.set(cx, cy - k, z + (k > 1 ? 1 : 0), dark);
    g.set(cx, cy + k, z + (k > 1 ? 1 : 0), dark);
  }
  g.set(cx - 1, cy, z, shade(dark, 0.9)); // queue
  return fin(g);
}

// ============================================================================
// RUINES (WORLD-DETAILS « au goût ») — pierre crème patinée, lore Echo Terra
// ============================================================================
const RUIN_STONE = [212, 202, 184];

// PRAIRIE — muret en ruine : segment bas ALIGNÉ (le scatter pose la rotation),
// hauteur irrégulière, brèches, un bloc tombé à côté
function ruinWall(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cy = Math.round(SIZE.sy / 2);
  for (let x = 2; x < 18; x++) {
    if (rnd() < 0.16) continue; // brèche
    const h = 2 + Math.floor(rnd() * 3);
    for (let z = 0; z < h; z++) g.box(x, x, cy - 1, cy, z, z, shade(RUIN_STONE, 0.9 + rnd() * 0.16));
  }
  g.box(5 + Math.floor(rnd() * 8), 6 + Math.floor(rnd() * 8), cy + 2, cy + 3, 0, 0, shade(RUIN_STONE, 0.88)); // bloc tombé
  return fin(g);
}

// TOUS BIOMES — colonne brisée sur socle + tambour tombé
function ruinColumn(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  g.box(Math.round(cx) - 2, Math.round(cx) + 2, Math.round(cy) - 2, Math.round(cy) + 2, 0, 0, shade(RUIN_STONE, 0.94)); // socle
  const brk = rnd() * Math.PI * 2; // direction de la cassure diagonale
  for (let y = Math.floor(cy) - 1; y <= cy + 1.5; y++) {
    for (let x = Math.floor(cx) - 1; x <= cx + 1.5; x++) {
      if (Math.hypot(x - cx, y - cy) > 1.7) continue;
      const top = 8 + Math.round(2.4 * Math.cos(Math.atan2(y - cy, x - cx) - brk));
      for (let z = 1; z <= top; z++) g.set(x, y, z, shade(RUIN_STONE, 0.92 + ((z % 3) * 0.04)));
    }
  }
  ellipsoid(g, cx + 4.5, cy + 2, 1, 1.6, 1.4, 1.2, shade(RUIN_STONE, 0.87), rnd, 5); // tambour tombé
  return fin(g);
}

// TOUS BIOMES — dalle gravée couchée (glyphes accent, écho du menhir)
function ruinSlab(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = Math.round(SIZE.sx / 2), cy = Math.round(SIZE.sy / 2);
  g.box(cx - 4, cx + 4, cy - 3, cy + 2, 0, 1, RUIN_STONE);
  for (let x = cx - 3; x <= cx + 3; x++) if ((x + seed) % 2 === 0) g.set(x, cy - 1, 1, shade(RUIN_STONE, 0.8)); // sillons
  g.set(cx - 2 + Math.floor(rnd() * 4), cy + 1, 1, [122, 186, 202]); // glyphe accent
  g.set(cx + 1, cy, 1, [122, 186, 202]);
  g.box(cx + 2, cx + 3, cy - 3, cy - 2, 2, 2, shade(RUIN_STONE, 0.9)); // coin fendu relevé
  return fin(g);
}

// TOUS BIOMES — arche à moitié effondrée : pilier + départ d'arc, l'autre en moignon
function ruinArch(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = Math.round(SIZE.sx / 2), cy = Math.round(SIZE.sy / 2);
  const stone = (k) => shade(RUIN_STONE, k);
  g.box(cx - 5, cx - 3, cy - 1, cy + 1, 0, 10, stone(0.95)); // pilier debout
  for (let k = 0; k < 4; k++) g.box(cx - 3 + k, cx - 2 + k, cy - 1, cy + 1, 10 + Math.min(k, 2), 11 + Math.min(k, 2), stone(1 + k * 0.02)); // départ d'arc
  g.box(cx + 3, cx + 5, cy - 1, cy + 1, 0, 3 + Math.floor(rnd() * 2), stone(0.9)); // moignon
  for (let i = 0; i < 6; i++) { // gravats entre les deux
    const bx = cx - 2 + Math.floor(rnd() * 5), by = cy - 2 + Math.floor(rnd() * 4);
    g.box(bx, bx + 1, by, by, 0, 0, stone(0.85 + rnd() * 0.1));
  }
  return fin(g);
}

// ============================================================================
// LA VILLE (carte du monde) : temple grec voxel — remplace le billboard PNG.
// Crépis à 3 degrés, colonnade périptère (6×2 + flancs), cella, entablement à
// triglyphes, comble en prisme à pentes ÉTAGÉES (arête le long de X) dont les
// pignons dessinent les frontons ; acrotères dorés. Symétrique dans sa grille
// → le mesher le centre pile sur la case.
// ============================================================================
function temple(seed) {
  const S = { sx: 26, sy: 18, sz: 22 };
  const g = new Grid(S.sx, S.sy, S.sz, FINE);
  const rnd = makeRng(seed);
  const marble = [243, 237, 222], shaft = [237, 229, 210];
  const roofC = [219, 143, 115], gold = [240, 202, 112], dark = [96, 84, 88];
  // cylindre plein évalué PAR VOXEL FIN (fûts de colonnes ronds)
  const cyl = (bx, by, z0, z1, r, rgb) => {
    const f = g.fs, fbx = (bx + 0.5) * f - 0.5, fby = (by + 0.5) * f - 0.5, fr = r * f;
    for (let z = Math.round(z0 * f); z <= Math.round((z1 + 1) * f) - 1; z++) {
      for (let y = Math.floor(fby - fr); y <= fby + fr; y++) {
        for (let x = Math.floor(fbx - fr); x <= fbx + fr; x++) {
          if (((x - fbx) / fr) ** 2 + ((y - fby) / fr) ** 2 <= 1) g.setFine(x, y, z, rgb);
        }
      }
    }
  };
  // crépis : 3 degrés
  g.box(1, 24, 1, 16, 0, 0, shade(marble, 0.9));
  g.box(2, 23, 2, 15, 1, 1, shade(marble, 0.96));
  g.box(3, 22, 3, 14, 2, 2, marble);
  // colonnade : 6 en façade avant/arrière + 1 au milieu de chaque flanc
  const cols = [];
  for (const x of [4.5, 7.9, 11.3, 14.7, 18.1, 21.5]) { cols.push([x, 4.4]); cols.push([x, 12.6]); }
  cols.push([4.5, 8.5], [21.5, 8.5]);
  for (const [bx, by] of cols) {
    g.box(bx - 1, bx + 1, by - 1, by + 1, 3, 3, shade(shaft, 0.95)); // base
    cyl(bx, by, 4, 9, 1.05, shaft); // fût rond
    g.box(bx - 1, bx + 1, by - 1, by + 1, 10, 10, shade(marble, 1.03)); // chapiteau
  }
  // cella (une nuance plus sombre, porte sombre côté fronton avant)
  g.box(8, 17, 6.5, 10.5, 3, 10, shade(marble, 0.88));
  g.box(11.7, 13.3, 6.5, 6.5, 3, 7, dark);
  // entablement + frise à triglyphes
  g.box(3.5, 22.5, 3.6, 14.4, 11, 12, marble);
  for (let x = 5; x <= 21; x += 2.6) {
    g.box(x, x + 0.8, 3.6, 3.6, 11, 12, shade(marble, 0.82));
    g.box(x, x + 0.8, 14.4, 14.4, 11, 12, shade(marble, 0.82));
  }
  // comble : prisme à pentes étagées (arête le long de X) — les colonnes de
  // voxels du dessus en tuiles, l'intérieur marbre = pignons/frontons aux bouts
  for (let y = 3; y <= 14; y++) {
    const d = Math.min(y - 3, 14 - y);
    const top = 13 + Math.floor(d * 0.85);
    for (let z = 13; z <= top; z++) {
      for (let x = 3.6; x <= 21.6; x++) {
        g.box(x, x, y, y, z, z, z === top ? shade(roofC, 0.94 + ((x | 0) % 2) * 0.08) : marble);
      }
    }
  }
  // acrotères dorés : bouts de l'arête + pointe du fronton avant
  const ridgeTop = 13 + Math.floor(5 * 0.85);
  g.set(4, 8.5, ridgeTop + 1, gold);
  g.set(21, 8.5, ridgeTop + 1, gold);
  g.set(12.5, 8.5, ridgeTop + 1, shade(gold, 1.08));
  void rnd;
  return fin(g);
}

const GREEN = [134, 192, 108];
const PINK = [232, 164, 188];
const DEEP = [104, 168, 88];
const FLOWER_HEADS = [[230, 116, 116], [240, 204, 110], [244, 240, 232]]; // rouge/jaune/blanc
const BERRIES = [[214, 88, 96], [150, 108, 196], [214, 88, 96]]; // rouge/violet/rouge
const MUSH_CAPS = [[226, 110, 100], [178, 136, 96], [232, 186, 100]]; // rouge à pois/brun/doré
const CRYSTAL_COLS = [[188, 150, 224], [140, 180, 228], [200, 160, 232]]; // violet/bleu/violet
const WINGS = [[244, 244, 250], [244, 214, 110], [150, 190, 240]]; // blanc/jaune/bleu

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
    // LOT D1 — couverture par biome (WORLD-DETAILS-PLAN 2026-07-18)
    { id: "lilypad", make: (v) => lilypad(v > 0, 201 + v * 77) },
    { id: "water-rock", make: (v) => waterRock(211 + v * 77) },
    { id: "driftwood", make: (v) => driftwood(221 + v * 77) },
    { id: "shells", make: (v) => shells(231 + v * 77) },
    { id: "pebbles", make: (v) => pebbleCluster(241 + v * 77) },
    { id: "kelp", make: (v) => kelp(251 + v * 77) },
    { id: "dune-grass", make: (v) => tuft(261 + v * 77, [176, 178, 108]) },
    { id: "tallgrass", make: (v) => tallgrass(271 + v * 77) },
    { id: "berry-bush", make: (v) => berryBush(BERRIES[v % 3], 281 + v * 77) },
    { id: "daisy", make: (v) => daisy(291 + v * 77) },
    { id: "stump", make: (v) => stump(301 + v * 77) },
    { id: "mushroom", make: (v) => mushroomProp(MUSH_CAPS[v % 3], v === 0, 311 + v * 77) },
    { id: "fern", make: (v) => fern(321 + v * 77) },
    { id: "log", make: (v) => logFallen(331 + v * 77) },
    { id: "bush-dense", make: (v) => bushDense(341 + v * 77) },
    { id: "scree", make: (v) => scree(351 + v * 77) },
    { id: "crystal", make: (v) => crystals(CRYSTAL_COLS[v % 3], 361 + v * 77) },
    { id: "cairn", make: (v) => cairn(371 + v * 77) },
    { id: "dead-tree", make: (v) => deadTree(false, 381 + v * 77) },
    { id: "snowdrift", make: (v) => snowdrift(391 + v * 77) },
    { id: "ice-spike", make: (v) => iceSpikes(401 + v * 77) },
    { id: "frost-tree", make: (v) => deadTree(true, 411 + v * 77) },
    { id: "frost-bush", make: (v) => frostBush(421 + v * 77) },
    // LOT D2 — repères uniques par seed
    { id: "scarecrow", make: (v) => scarecrow(501 + v * 77) },
    { id: "snowman", make: (v) => snowman(511 + v * 77) },
    { id: "boat", make: (v) => boat(521 + v * 77) },
    { id: "menhir", make: (v) => menhir(531 + v * 77) },
    { id: "turtle", make: (v) => turtle(541 + v * 77) },
    { id: "beehive", make: (v) => beehive(551 + v * 77) },
    // LOT D3 — vie ambiante (jour/nuit sur le cycle solaire)
    { id: "butterfly", make: (v) => butterflies(WINGS[v % 3], 601 + v * 77) },
    { id: "gull", make: (v) => gulls(611 + v * 77) },
    { id: "firefly", make: (v) => fireflies(621 + v * 77) },
    { id: "rabbit", make: (v) => bunny([224, 208, 184], 631 + v * 77) },
    { id: "hare", make: (v) => bunny([238, 242, 248], 641 + v * 77) },
    { id: "crab", make: (v) => crab(651 + v * 77) },
    // LOT D4 — effets
    { id: "web", make: (v) => web(661 + v * 77) },
    { id: "snow-motes", make: (v) => snowMotes(671 + v * 77) },
    { id: "eagle", make: (v) => eagleProp(681 + v * 77) },
    // RUINES éparses (lore) + muret d'ancienne ferme
    { id: "temple", make: (v) => temple(801 + v * 77) },
    { id: "ruin-wall", make: (v) => ruinWall(701 + v * 77) },
    { id: "ruin-column", make: (v) => ruinColumn(711 + v * 77) },
    { id: "ruin-slab", make: (v) => ruinSlab(721 + v * 77) },
    { id: "ruin-arch", make: (v) => ruinArch(731 + v * 77) },
  ];
  for (const d of defs) {
    for (let v = 0; v < 3; v++) {
      const model = d.make(v);
      model.palette = model.palette.map((c) => vividProp(c));
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
