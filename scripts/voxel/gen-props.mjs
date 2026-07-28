// Props voxel du style diorama (arbres-boules verts/roses, rochers) — la moitié
// du charme de la référence. 3 variantes par prop → /voxels/props/<id>-v<k>.vox
// (le format attendu par BlockLibrary côté client).
//
//   node scripts/voxel/gen-props.mjs

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { Grid, shade as shadeBase } from "../../frontend/src/voxel/shared/char-recipe.mjs";
import { makeRng, divisionize } from "../../frontend/src/voxel/shared/recipes.mjs";

// DIVISIONNISME DES PROPS (arbres, bâtiments, rochers…).
//
// Les recettes distinguent déjà leurs plans par `shade(couleur, facteur)` : un
// facteur par bande de feuillage, par pan de mur, par strate de rocher. Ces
// bandes sont uniformes — c'est ce qui les fait fusionner au greedy meshing.
// On se greffe exactement dessus : le FACTEUR devient l'indice de touche, si
// bien que chaque bande reçoit sa propre TEINTE en plus de sa clarté. La
// silhouette et la fusion des quads ne bougent pas ; la matière, elle, devient
// colorée — un pin cesse d'être un dégradé de vert pour devenir un assemblage
// de verts, de bleus et de violets, comme les pins de Signac.
function shade(rgb, f) {
  return divisionize(shadeBase(rgb, f), Math.round(f * 7));
}
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
  // v3 : ESPLANADE dallée TOUT AUTOUR du temple (anneau sur les 4 côtés),
  // allée claire côté entrée, colonnes votives dorées aux 4 coins. Le temple
  // est centré dans la grille → centré sur la case ville.
  const S = { sx: 30, sy: 30, sz: 24 };
  const g = new Grid(S.sx, S.sy, S.sz, FINE);
  const rnd = makeRng(seed);
  const marble = [243, 237, 222], shaft = [237, 229, 210];
  const roofC = [219, 143, 115], gold = [240, 202, 112], dark = [96, 84, 88];
  const paving = [228, 216, 194];
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
  // ESPLANADE : dallage damier sur TOUTE la grille, bordure sombre au pourtour,
  // allée centrale claire du bord avant jusqu'aux degrés
  for (let y = 1; y <= 28; y++) {
    for (let x = 1; x <= 28; x++) {
      const border = y === 1 || y === 28 || x === 1 || x === 28;
      const path = x >= 13.5 && x <= 16.5 && y <= 8;
      const checker = ((x + y) | 0) % 2 === 0 ? 1 : 0.94;
      const tone = border ? 0.84 : path ? 1.06 : checker;
      g.box(x, x, y, y, 0, 0, shade(paving, tone));
    }
  }
  // colonnes votives dorées aux 4 coins de l'esplanade
  for (const [bx, by] of [[3.5, 3.5], [26.5, 3.5], [3.5, 26.5], [26.5, 26.5]]) {
    cyl(bx, by, 1, 4, 0.7, shaft);
    g.set(bx, by, 5, gold); // flamme votive
  }
  // crépis : 3 degrés posés sur l'esplanade (escalier sur tout le pourtour)
  g.box(5, 24, 7, 22, 0, 0, shade(marble, 0.9));
  g.box(6, 23, 8, 21, 1, 1, shade(marble, 0.96));
  g.box(7, 22, 9, 20, 2, 2, marble);
  // colonnade élancée : 6 en façades avant (y≈10.4) / arrière (y≈18.6) + flancs
  const cols = [];
  for (const x of [8.3, 10.8, 13.3, 15.7, 18.2, 20.7]) { cols.push([x, 10.4]); cols.push([x, 18.6]); }
  cols.push([8.3, 14.5], [20.7, 14.5]);
  for (const [bx, by] of cols) {
    g.box(bx - 0.9, bx + 0.9, by - 0.9, by + 0.9, 3, 3, shade(shaft, 0.95)); // base
    cyl(bx, by, 4, 11, 0.95, shaft); // fût rond, 8 unités de haut
    g.box(bx - 0.9, bx + 0.9, by - 0.9, by + 0.9, 12, 12, shade(marble, 1.03)); // chapiteau
  }
  // cella, porte sombre FACE À L'ALLÉE (côté y bas)
  g.box(10.8, 18.2, 12, 17, 3, 12, shade(marble, 0.88));
  g.box(13.7, 15.3, 12, 12, 3, 8, dark);
  // entablement fin + frise à triglyphes
  g.box(7.3, 21.7, 9.6, 19.4, 13, 13.8, marble);
  for (let x = 8.6, k = 0; x <= 20.4; x += 2.35, k++) {
    g.box(x, x + 0.7, 9.6, 9.6, 13, 13.8, shade(marble, 0.82));
    g.box(x, x + 0.7, 19.4, 19.4, 13, 13.8, shade(marble, 0.82));
  }
  // comble : prisme à pentes étagées (arête le long de X), pignons = frontons
  for (let y = 8.6; y <= 20.4; y++) {
    const d = Math.min(y - 8.6, 20.4 - y);
    const top = 15 + Math.floor(d * 0.8);
    for (let z = 15; z <= top; z++) {
      for (let x = 6.8, xe = 22.2; x <= xe; x++) {
        g.box(x, x, y, y, z, z, z === top ? shade(roofC, 0.94 + ((x | 0) % 2) * 0.08) : marble);
      }
    }
  }
  // acrotères dorés aux bouts de l'arête + pointe du fronton
  const ridgeTop = 15 + Math.floor(5.9 * 0.8);
  g.set(7.5, 14.5, ridgeTop + 1, gold);
  g.set(21.5, 14.5, ridgeTop + 1, gold);
  g.set(14.5, 14.5, ridgeTop + 1, shade(gold, 1.08));
  void rnd;
  return fin(g);
}

// OLIVIER : tronc noueux (segments décalés), feuillage ARGENTÉ en petites
// boules aplaties — planté en couronne autour du temple (et nulle part ailleurs)
function olive(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const cx = SIZE.sx / 2 - 0.5, cy = SIZE.sy / 2 - 0.5;
  const bark = [124, 106, 82];
  const leaf = [152, 172, 128]; // vert-de-gris olivier
  // tronc noueux : segments empilés avec petits décalages
  let tx = cx, ty = cy;
  for (let z = 0; z < 8; z += 2) {
    g.box(tx - 0.8, tx + 0.8, ty - 0.8, ty + 0.8, z, z + 2, shade(bark, 0.92 + (z % 4) * 0.03));
    tx += Math.round(rnd() * 2 - 1) * 0.9;
    ty += Math.round(rnd() * 2 - 1) * 0.9;
  }
  // feuillage : 4-5 boules aplaties argentées, jamais une sphère unique
  ellipsoid(g, cx, cy, 10.5, 4.6, 4.6, 3, leaf, rnd, 7);
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2, r = 2.5 + rnd() * 1.8;
    ellipsoid(g, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 9 + rnd() * 4, 2.6, 2.6, 1.9,
      shade(leaf, 0.92 + rnd() * 0.2), rnd, 6);
  }
  return fin(g);
}

// ============================================================================
// SITES DE RUINES-DONJONS (gameplay 2026-07-19) : un bâtiment en ruine par
// biome. Variante 0 = ENSEVELI (gravats devant l'entrée), 1-2 = DÉBLAYÉ
// (entrée sombre ouverte + lueur dorée du trésor) — la carte choisit la
// variante selon l'état serveur `ruin.cleared`, pas au hasard.
// ============================================================================
const RUBBLE = [172, 164, 152];
const GLOW = [255, 214, 110];
const DOORDARK = [52, 46, 54];

// gravats devant/onto l'entrée (état enseveli)
function buryEntrance(g, rnd, cx, cy, spread = 3) {
  for (let i = 0; i < 6; i++) {
    const bx = cx - spread + rnd() * spread * 2, by = cy - spread / 2 + rnd() * spread;
    ellipsoid(g, bx, by, 0.9, 1.2 + rnd(), 1 + rnd() * 0.8, 0.9 + rnd() * 0.6, shade(RUBBLE, 0.9 + rnd() * 0.2), rnd, 6);
  }
}
// entrée de donjon ouverte : bouche sombre + lueur du trésor
function openEntrance(g, x0, x1, y, z1) {
  g.box(x0, x1, y, y, 0, z1, DOORDARK);
  g.set((x0 + x1) / 2, y, 1, GLOW);
}

// PRAIRIE — ferme abandonnée : murs en L écroulés + poutres effondrées
function siteFerme(cleared, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const wall = [204, 188, 160], wood = [138, 106, 76];
  for (let x = 4; x <= 15; x++) if (rnd() < 0.8) g.box(x, x, 14, 14.8, 0, 2 + Math.floor(rnd() * 3), shade(wall, 0.9 + rnd() * 0.15));
  for (let y = 6; y <= 14; y++) if (rnd() < 0.8) g.box(4, 4.8, y, y, 0, 2 + Math.floor(rnd() * 3), shade(wall, 0.9 + rnd() * 0.15));
  for (let i = 0; i < 3; i++) { // poutres tombées en travers
    const x0 = 6 + rnd() * 6, y0 = 7 + rnd() * 5;
    for (let k = 0; k < 6; k++) g.set(x0 + k, y0 + k * 0.4, Math.max(0, 2 - k * 0.5), wood);
  }
  if (cleared) openEntrance(g, 8.6, 10.4, 14, 2); else buryEntrance(g, rnd, 9.5, 12);
  return fin(g);
}

// SABLE — épave ensablée : coque inclinée + mât brisé
function siteEpave(cleared, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const hull = [146, 112, 80];
  for (let x = 3; x <= 16; x++) {
    const taper = x < 6 ? x - 3 : x > 13 ? 16 - x : 3;
    const lift = Math.max(0, (x - 8) * 0.5); // proue soulevée (échouée)
    g.box(x, x, 10 - taper, 10 + taper, Math.floor(lift), Math.floor(lift) + 2, shade(hull, 0.92 + (x % 3) * 0.05));
    if (taper >= 2) {
      g.box(x, x, 10 - taper, 10 - taper, Math.floor(lift) + 3, Math.floor(lift) + 4, shade(hull, 1.1)); // bordés
      g.box(x, x, 10 + taper, 10 + taper, Math.floor(lift) + 3, Math.floor(lift) + 4, shade(hull, 1.1));
    }
  }
  g.box(9, 10, 9.5, 10.5, 4, 9, shade(hull, 0.85)); // mât brisé
  g.set(10, 10, 10, shade(hull, 0.8));
  ellipsoid(g, 6, 10, 0.8, 4, 3.4, 1, [226, 196, 138], rnd, 5); // langue de sable
  if (cleared) openEntrance(g, 11.6, 13.4, 7.4, 3); else buryEntrance(g, rnd, 12.5, 8, 2.5);
  return fin(g);
}

// FORÊT — sanctuaire englouti : arche moussue + colonnes + dalle
function siteSanctuaire(cleared, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const stone = [206, 198, 180], moss = [110, 168, 96];
  g.box(4, 6, 8, 10, 0, 8, shade(stone, 0.95)); // pilier gauche
  g.box(13, 15, 8, 10, 0, 8, shade(stone, 0.92)); // pilier droit
  g.box(4, 15, 8, 10, 9, 10.5, stone); // linteau
  for (let x = 4; x <= 15; x++) if (rnd() < 0.5) g.set(x, 8, 11, moss); // mousse sur le linteau
  g.box(6, 13, 12, 16, 0, 0.8, shade(stone, 0.85)); // dalle gravée derrière
  g.set(8, 14, 1, [122, 186, 202]); g.set(11, 13, 1, [122, 186, 202]); // glyphes
  ellipsoid(g, 16.5, 13, 1.4, 1.6, 1.4, 1.4, shade(stone, 0.88), rnd, 5); // tambour tombé
  if (cleared) openEntrance(g, 8.6, 10.9, 9, 7); else buryEntrance(g, rnd, 9.7, 7);
  return fin(g);
}

// MONTAGNE — mine effondrée : butte rocheuse + portail boisé
function siteMine(cleared, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const rock = [178, 166, 148], wood = [126, 96, 66];
  ellipsoid(g, 10, 13.8, 3.4, 7, 4.4, 4.6, rock, rnd, 7); // la butte (derrière le portail)
  g.box(7.6, 8.4, 8, 8.8, 0, 5, wood); // portail : montants + linteau
  g.box(11.6, 12.4, 8, 8.8, 0, 5, wood);
  g.box(7.6, 12.4, 8, 8.8, 5, 5.8, shade(wood, 1.08));
  g.set(6.5, 8.5, 0, [212, 176, 96]); // wagonnet d'or renversé (accroche)
  if (cleared) openEntrance(g, 8.8, 11.2, 8.4, 4); else buryEntrance(g, rnd, 10, 7);
  return fin(g);
}

// NEIGE — tour gelée : fût cylindrique brisé en diagonale, givré
function siteTour(cleared, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const stone = [196, 204, 216], ice = [222, 236, 246];
  const f = g.fs, fcx = 10 * f, fcy = 11 * f, fr = 4.2 * f;
  for (let z = 0; z < Math.round(16 * f); z++) {
    const brk = 10 * f + Math.round(5 * f * Math.sin(z * 0.1)); // cassure diagonale
    for (let y = Math.floor(fcy - fr); y <= fcy + fr; y++) {
      for (let x = Math.floor(fcx - fr); x <= fcx + fr; x++) {
        const d = ((x - fcx) / fr) ** 2 + ((y - fcy) / fr) ** 2;
        if (d > 1 || d < 0.55) continue; // anneau (tour creuse)
        if (z > brk && x > fcx) continue; // pan effondré
        g.setFine(x, y, z, shade(z % 6 < 3 ? stone : ice, 0.94 + ((x + y) % 2) * 0.06));
      }
    }
  }
  ellipsoid(g, 14.5, 8, 1, 2.6, 2, 1.4, ice, rnd, 4); // blocs effondrés
  if (cleared) openEntrance(g, 9, 11, 6.9, 4); else buryEntrance(g, rnd, 10, 5.5);
  return fin(g);
}

// ============================================================================
// BÂTIMENTS DE LA VILLE (Home voxel, 2026-07-19) — chaque bâtiment existe en
// 3 ÉTATS choisis par sa DURABILITÉ réelle : v0 intact, v1 abîmé (~35 % de
// dégâts), v2 en ruine (~68 %). La dégradation est une PASSE PROCÉDURALE
// partagée : morsures sphériques qui visent d'abord le toit, bords carbonisés,
// gravats au pied — le même bâtiment s'effondre progressivement.
// ============================================================================
// STONE_W était un quasi-blanc (222,212,196) : sur dix modèles, presque toutes
// les surfaces sont cette pierre-là, d'où des bâtiments délavés. Passé à une
// pierre calcaire CHAUDE — assez claire pour rester lumineuse sous le Lambert
// (qui, lui, ajoute son ombrage à celui déjà cuit par le mesher), mais avec
// enfin une couleur. Le toit passe à une vraie terre cuite.
const STONE_W = [212, 193, 163], WOOD_W = [176, 136, 92], ROOF_W = [206, 118, 88];
const THATCH = [222, 186, 110], DARK_W = [66, 58, 62], CHAR = [116, 106, 98];
// Accents COLORÉS. Sans eux, banque / portail / tour / muraille — c'est-à-dire
// l'essentiel de ce qu'on voit en début de partie — n'étaient QUE de la pierre :
// la ville paraissait délavée quoi qu'on fasse à l'éclairage ou à la teinte de
// la pierre elle-même. Chaque bâtiment reçoit désormais une couleur propre, à
// la manière d'un bourg où chaque métier a ses tuiles et son enseigne.
const ROOF_SLATE = [86, 116, 138]; // ardoise bleue — banque (bâtiment de prestige)
const ROOF_TILE = [198, 104, 78]; // tuile — portail, tour
const TRIM_GOLD = [226, 184, 96];
const PAINT_TEAL = [96, 156, 156];

// cylindre plein module (fûts, tours rondes) — coords grossières, tracé fin
function cylAt(g, bx, by, z0, z1, r, rgb) {
  const f = g.fs, fbx = (bx + 0.5) * f - 0.5, fby = (by + 0.5) * f - 0.5, fr = r * f;
  for (let z = Math.round(z0 * f); z <= Math.round((z1 + 1) * f) - 1; z++) {
    for (let y = Math.floor(fby - fr); y <= fby + fr; y++) {
      for (let x = Math.floor(fbx - fr); x <= fbx + fr; x++) {
        if (((x - fbx) / fr) ** 2 + ((y - fby) / fr) ** 2 <= 1) g.setFine(x, y, z, rgb);
      }
    }
  }
}

// toit à deux pentes étagées, arête le long de X (même langage que le temple)
function prismRoof(g, x0, x1, y0, y1, z0, rgb, over = 1) {
  for (let y = y0 - over; y <= y1 + over; y++) {
    const d = Math.min(y - (y0 - over), y1 + over - y);
    const top = z0 + Math.floor(d * 0.8);
    for (let z = z0; z <= top; z++) {
      for (let x = x0 - over; x <= x1 + over; x++) {
        g.box(x, x, y, y, z, z, z === top ? shade(rgb, 0.94 + ((x | 0) % 2) * 0.08) : shade([236, 228, 210], 0.98));
      }
    }
  }
}

// PASSE DE DÉGÂTS : ratio 0 = intact ; ~0.35 = abîmé ; ~0.68 = ruine.
// Morsures sphériques (70 % visent le haut — le toit part d'abord), pourtours
// carbonisés, gravats au pied. Opère sur les voxels FINS du modèle fini.
function damagePass(g, ratio, seed, noLumps = false) {
  if (ratio <= 0) return;
  const rnd = makeRng(seed);
  const { fsx, fsy, fsz } = g;
  const at = (x, y, z) => g.data[x + y * fsx + z * fsx * fsy];
  const clear = (x, y, z) => { g.data[x + y * fsx + z * fsx * fsy] = 0; };
  const occ = [];
  let maxZ = 1;
  for (let z = 0; z < fsz; z++) for (let y = 0; y < fsy; y++) for (let x = 0; x < fsx; x++)
    if (at(x, y, z)) { occ.push([x, y, z]); if (z > maxZ) maxZ = z; }
  if (!occ.length) return;
  const high = occ.filter(([, , z]) => z >= maxZ * 0.45);
  const bites = Math.round(3 + ratio * 10);
  for (let i = 0; i < bites; i++) {
    const pool = rnd() < 0.7 && high.length ? high : occ;
    const [cx, cy, cz] = pool[(rnd() * pool.length) | 0];
    const r = (1.6 + rnd() * 2.6) * (0.7 + ratio);
    for (let z = Math.max(0, Math.floor(cz - r)); z <= Math.min(fsz - 1, cz + r); z++) {
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(fsy - 1, cy + r); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(fsx - 1, cx + r); x++) {
          const d = Math.hypot(x - cx, y - cy, z - cz);
          if (d <= r) clear(x, y, z);
          else if (d <= r + 1.6 && at(x, y, z) && rnd() < 0.3) g.setFine(x, y, z, shade(CHAR, 0.9 + rnd() * 0.2));
        }
      }
    }
  }
  // Gravats au pied (coords grossières pour l'ellipsoïde partagé), CONTENUS
  // dans l'emprise du bâtiment.
  //
  // ⚠ Ils étaient semés sur toute la grille 20×20, quelle que soit la forme du
  // modèle. Sur un bâtiment compact ça passait ; sur le REMPART — un bandeau
  // qui n'occupe que 5 unités de profondeur sur 30 — les gravats triplaient la
  // profondeur de la boîte englobante. Comme la vue Ville met le modèle à
  // l'échelle sur son emprise au sol, la muraille en ruine (et elle démarre à
  // 20/100 de durabilité, donc c'est CETTE variante qu'on voit en début de
  // partie) devenait un pavé massif au lieu d'un mur écroulé.
  if (noLumps) return; // vantaux animés : pas de débris épars sur la grille
  const f = g.fs;
  let mnx = fsx, mxx = 0, mny = fsy, mxy = 0;
  for (const [x, y] of occ) {
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
  }
  const [cx0, cx1, cy0, cy1] = [mnx / f, mxx / f, mny / f, mxy / f];
  const lumps = Math.round(2 + ratio * 4);
  for (let i = 0; i < lumps; i++) {
    const bx = cx0 + rnd() * (cx1 - cx0), by = cy0 + rnd() * (cy1 - cy0);
    ellipsoid(g, bx, by, 0.7, 1 + rnd() * 1.2, 0.9 + rnd(), 0.8, shade(RUBBLE, 0.92 + rnd() * 0.16), rnd, 6);
  }
}

// --- les 9 bâtiments + le chantier -----------------------------------------
function bldWell(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed); void rnd;
  const cx = 9.5, cy = 9.5;
  const f = g.fs;
  for (let z = 0; z < Math.round(3 * f); z++) { // margelle en anneau
    for (let y = 0; y < g.fsy; y++) for (let x = 0; x < g.fsx; x++) {
      const d = Math.hypot(x - (cx + 0.5) * f + 0.5, y - (cy + 0.5) * f + 0.5) / f;
      if (d >= 3 && d <= 4.4) g.setFine(x, y, z, shade(STONE_W, 0.92 + (((x + y + z) | 0) % 3) * 0.05));
      else if (d < 3 && z === Math.round(f)) g.setFine(x, y, z, [92, 182, 214]); // l'eau
    }
  }
  g.box(cx - 4.4, cx - 3.6, cy - 0.5, cy + 0.5, 3, 7, WOOD_W); // montants
  g.box(cx + 3.6, cx + 4.4, cy - 0.5, cy + 0.5, 3, 7, WOOD_W);
  prismRoof(g, cx - 4, cx + 4, cy - 1.4, cy + 1.4, 8, ROOF_W, 0);
  g.set(cx, cy, 5, [212, 176, 96]); // seau doré
  return g;
}

function bldPanel(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed); void rnd;
  g.box(6, 6.8, 9.5, 10.3, 0, 6, WOOD_W);
  g.box(13.2, 14, 9.5, 10.3, 0, 6, WOOD_W);
  g.box(5, 15, 9.6, 10.2, 3, 6.5, shade(WOOD_W, 1.12)); // le tableau
  g.box(6.5, 9, 9.5, 9.5, 4, 5.8, [246, 242, 230]); // affiches
  g.box(10.5, 13, 9.5, 9.5, 3.6, 5.4, [246, 242, 230]);
  g.set(7, 9.4, 5.9, [214, 88, 96]); // punaise rouge
  g.box(4.8, 15.2, 9.5, 10.3, 6.6, 7, shade(ROOF_W, 1.02)); // petit auvent
  return g;
}

function bldBank(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed); void rnd;
  g.box(3, 17, 6, 14, 0, 7, shade(STONE_W, 0.97)); // corps de pierre
  for (const x of [4.5, 9.5, 14.5]) g.box(x, x + 1, 5.4, 6, 0, 7, shade(STONE_W, 1.06)); // pilastres
  g.box(8.8, 11.2, 5.4, 6, 0, 5, DARK_W); // porte
  g.box(2.4, 17.6, 5.2, 14.6, 7, 7.9, TRIM_GOLD); // bandeau doré de corniche
  g.box(2.4, 17.6, 5.2, 14.6, 7.9, 8.4, shade(STONE_W, 1.04)); // corniche
  prismRoof(g, 3, 17, 5.8, 14.2, 8.4, ROOF_SLATE); // toit d'ardoise BLEUE
  cylAt(g, 10, 5.2, 8.6, 10.6, 1.3, [240, 202, 112]); // enseigne : pièce d'or
  g.set(10, 5.2, 9.6, shade([240, 202, 112], 1.15));
  return g;
}

function bldWorkshop(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed); void rnd;
  g.box(3, 16, 7, 14, 0, 6, shade(WOOD_W, 1.02)); // atelier bois
  for (const x of [3.5, 9.5, 15.5]) g.box(x, x + 0.6, 6.6, 7, 0, 6, shade(DARK_W, 1.6)); // colombages
  g.box(5.5, 12.5, 6.4, 7, 0, 5, DARK_W); // grande ouverture
  prismRoof(g, 3.5, 15.5, 7.5, 13.5, 7, THATCH);
  g.box(13.5, 15, 8.5, 10, 7, 11, shade(STONE_W, 0.88)); // cheminée
  g.box(17, 18.4, 9, 10.4, 0, 1.2, DARK_W); // enclume dehors
  g.box(17.3, 18.1, 9.3, 10.1, 1.2, 2, shade(DARK_W, 1.5));
  return g;
}

// GATE : la maçonnerie SEULE (tours + arche + bannière). Les deux vantaux sont
// des modèles SÉPARÉS (bld-gate-door-l/-r), rendus et ANIMÉS par VoxelTownView
// autour de leurs gonds → la porte s'ouvre/se ferme selon l'état serveur `open`.
function bldGate(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed); void rnd;
  for (const x0 of [2, 14]) { // deux tours carrées
    g.box(x0, x0 + 4, 7.5, 12.5, 0, 10, shade(STONE_W, 0.95 + (x0 % 3) * 0.02));
    for (let x = x0; x <= x0 + 4; x += 2) g.box(x, x + 1, 7.5, 12.5, 10, 11, STONE_W); // créneaux
  }
  g.box(6, 14, 8, 12, 6, 9, shade(STONE_W, 1.02)); // arche
  for (const x0 of [2, 14]) prismRoof(g, x0 - 0.4, x0 + 4.4, 7.1, 12.9, 11, ROOF_TILE); // toits de tuile
  g.box(8.6, 11.4, 7.85, 8.05, 9, 11.2, PAINT_TEAL); // bannière, plus large
  g.box(8.6, 11.4, 7.8, 8.05, 10.8, 11.2, TRIM_GOLD); // galon doré
  return g;
}

// Un vantail (leaf) construit dans la grille PLEINE du portail (mêmes SIZE/FINE),
// afin de partager exactement le repère de `bldGate` une fois meshé : posé au
// même transform que la maçonnerie, il tombe pile dans l'ouverture. `side` −1 =
// gauche (gond à x=6), +1 = droite (gond à x=14). Les gonds servent de pivot à
// l'animation d'ouverture (voir GATE_HINGE dans VoxelTownView).
//
// Battants HAUTS (z 0→9, ~toute la hauteur des tours) et au FRONT de l'ouverture
// (y≈8) : posés au fond de l'arche et bas, ils étaient masqués par les tours en
// vue iso → la fermeture ne se voyait pas. Hauts + à l'avant + swing large vers
// l'avant, le mouvement est net même dézoomé.
function bldGateDoor(side, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed); void rnd;
  const wood = shade(WOOD_W, side < 0 ? 1.0 : 0.9);
  const x0 = side < 0 ? 6 : 10, x1 = side < 0 ? 10 : 14; // se rejoignent à x=10
  g.box(x0, x1, 7.7, 8.7, 0, 9, wood); // battant haut, au front, fin en profondeur
  // planches verticales : rainures sombres sur la face avant
  for (let x = x0 + 1; x < x1; x += 1.4) g.box(x, x + 0.15, 7.5, 7.7, 0, 9, shade(DARK_W, 1.3));
  // ferrures horizontales (bandes de fer)
  for (const z of [1.5, 7.5]) g.box(x0, x1, 7.5, 8.8, z, z + 0.5, shade(DARK_W, 1.5));
  // heurtoir/poignée doré près du battant central
  g.box(side < 0 ? 9.3 : 10.4, side < 0 ? 9.7 : 10.7, 7.4, 7.7, 4.5, 5.2, [212, 176, 96]);
  return g;
}

function bldTower(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed); void rnd;
  cylAt(g, 9.5, 9.5, 0, 13, 3.6, shade(STONE_W, 0.96));
  cylAt(g, 9.5, 9.5, 13, 14, 4.2, STONE_W); // encorbellement
  const f = g.fs, fcx = 10 * f - 0.5, fcy = 10 * f - 0.5;
  for (let a = 0; a < 8; a++) { // créneaux en couronne
    const ang = (a / 8) * Math.PI * 2;
    const bx = Math.round(fcx + Math.cos(ang) * 3.9 * f), by = Math.round(fcy + Math.sin(ang) * 3.9 * f);
    for (let dz = 0; dz < Math.round(1.6 * f); dz++)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        g.setFine(bx + dx, by + dy, Math.round(14.2 * f) + dz, STONE_W);
  }
  g.box(9, 10.5, 6.2, 6.6, 8, 10, DARK_W); // meurtrière
  g.box(9, 10.5, 6.2, 6.6, 3, 5, DARK_W);
  // toiture conique en TUILE : sans elle la tour n'était qu'un fût de pierre
  for (let i = 0; i < 5; i++) cylAt(g, 9.5, 9.5, 15.8 + i * 0.9, 16.7 + i * 0.9, 3.4 - i * 0.62, shade(ROOF_TILE, 1 - i * 0.03));
  g.set(9.5, 9.5, 20.6, [214, 88, 96]); // fanion
  return g;
}

function bldTownhall(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed); void rnd;
  g.box(3, 16, 7, 14.5, 0, 8, shade(STONE_W, 1.0)); // corps
  g.box(8.6, 11.4, 6.5, 7, 0, 5.6, DARK_W); // grande porte
  g.box(4.5, 6, 6.6, 7, 3, 5, [122, 186, 202]); // vitraux
  g.box(13, 14.5, 6.6, 7, 3, 5, [122, 186, 202]);
  prismRoof(g, 3.5, 15.5, 7.5, 14, 9, ROOF_W);
  g.box(8, 12, 8.5, 12.5, 9, 15, shade(STONE_W, 1.03)); // beffroi
  prismRoof(g, 8.4, 11.6, 9.2, 11.8, 16, ROOF_W, 0);
  g.set(10, 10.5, 14, [240, 202, 112]); // cloche dorée
  g.box(9.6, 10.4, 10.2, 10.8, 12.6, 13.4, DARK_W); // baie de la cloche
  return g;
}

function bldKitchen(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed); void rnd;
  g.box(4, 15, 7.5, 14, 0, 5.6, shade(THATCH, 0.7)); // murs torchis
  g.box(7.6, 10, 7.1, 7.5, 0, 4.6, DARK_W); // porte
  g.box(12, 13.6, 7.1, 7.5, 2.4, 4.2, [122, 186, 202]); // fenêtre
  prismRoof(g, 4.5, 14.5, 8, 13.5, 6.2, ROOF_W);
  g.box(12.6, 14.6, 11, 13, 6, 11.5, shade(STONE_W, 0.9)); // grosse cheminée
  g.box(12.9, 14.3, 11.3, 12.7, 11.5, 12, DARK_W);
  cylAt(g, 4.6, 5.4, 0, 1.4, 1.1, DARK_W); // marmite dehors
  g.set(4.6, 5.4, 2, [214, 88, 96]); // feu
  return g;
}

function bldRecyclerie(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed); void rnd;
  g.box(4, 15, 7, 14, 0, 5.5, shade(WOOD_W, 0.98)); // hangar bois
  for (const x of [4.4, 9.5, 14.6]) g.box(x, x + 0.6, 6.6, 7, 0, 5.5, shade(DARK_W, 1.5)); // colombages
  g.box(6, 13, 6.4, 7, 0, 4.4, DARK_W); // grande ouverture
  prismRoof(g, 3.6, 15.4, 7.4, 13.6, 5.5, shade([90, 156, 96], 1.0)); // toit VERT (recyclage)
  g.box(9, 11, 6.4, 6.7, 4.6, 5.4, [120, 205, 130]); // symbole ♻ clair sur le pignon
  g.box(15.6, 17.2, 8.2, 9.7, 0, 1.9, shade([120, 160, 120], 1.0)); // bac de tri vert
  g.box(15.9, 16.9, 8.5, 9.4, 1.9, 2.2, DARK_W);
  g.box(15.5, 17.3, 10.4, 12, 0, 1.4, shade(STONE_W, 0.82)); // tas de gravats
  g.box(2.6, 4.2, 10.4, 12, 0, 1.2, shade(WOOD_W, 0.8)); // palettes empilées
  g.set(10, 8, 6, [212, 176, 96]); // panneau doré
  return g;
}

function bldWall(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed); void rnd;
  g.box(1, 18.5, 8.5, 11.5, 0, 6, shade(STONE_W, 0.95));
  for (let x = 1.5; x <= 18; x += 2.4) g.box(x, x + 1.2, 8.5, 11.5, 6, 7.2, STONE_W); // merlons
  g.box(1, 18.5, 9.2, 10.8, 6, 6.4, shade(STONE_W, 1.05)); // chemin de ronde
  // couvertine d'ARDOISE : le rempart fait tout le tour de la ville, en pierre
  // nue il traçait un large liseré beige uniforme autour du bourg.
  g.box(1, 18.5, 8.4, 9.2, 5.7, 6.2, shade(ROOF_SLATE, 0.95));
  g.box(1, 18.5, 10.8, 11.6, 5.7, 6.2, shade(ROOF_SLATE, 0.88));
  return g;
}

// ============================================================================
// MAISONS DE BOURG (2026-07-28) — remplissage, aucune fonction de jeu.
//
// Le village avait dix bâtiments espacés sur une pelouse : chaque parcelle se
// lisait isolément, jamais comme une ville. Dans la référence, ce qui fait la
// silhouette n'est pas le bâtiment remarquable, c'est la MASSE des toits
// serrés autour de lui — la mairie ne se détache que parce qu'elle dépasse
// d'un tissu de maisons.
//
// Deux règles tenues par les trois modèles :
//   1. le TOIT porte la couleur et occupe ~la moitié de la hauteur ; les murs
//      sont bas, clairs et discrets. C'est l'inverse de nos bâtiments de jeu,
//      où la pierre domine — et c'est pour ça qu'ils paraissaient ternes ;
//   2. la silhouette déborde (auvent, encorbellement, cheminée) — un pavé
//      coiffé d'un prisme se lit comme un bloc, pas comme une maison.
//
// ⚠ Convention du fichier : une recette renvoie `fin(g)` OU la `Grid` selon
// qu'elle est enregistrée seule ou dans le bloc `bld-*` (qui applique `fin`
// APRÈS `damagePass`). Passer une Grid déjà « finie » à `damagePass` indexe un
// buffer avec les mauvaises dimensions et rend des dalles flottantes.
const PLASTER = [236, 216, 182];
const PAINT_ROSE = [214, 146, 136];

// Toit à UNE pente (appentis, remises). L'arête haute est en y0.
function shedRoof(g, x0, x1, y0, y1, z0, rise, rgb, over = 0.8) {
  const steps = Math.max(2, Math.round((y1 - y0) / 0.9));
  for (let k = 0; k < steps; k++) {
    const ya = y0 + ((y1 - y0) * k) / steps, yb = y0 + ((y1 - y0) * (k + 1)) / steps;
    const z = z0 - (rise * k) / steps;
    g.box(x0 - over, x1 + over, ya, yb, z - 0.5, z, shade(rgb, 0.94 + (k % 2) * 0.08));
  }
}

function house(kind, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const wobble = () => 0.94 + rnd() * 0.12;

  if (kind === 0) {
    // Chaumière trapue : soubassement de pierre, torchis, grande toiture de
    // tuile très débordante — le toit fait plus de la moitié de la hauteur.
    g.box(6, 14, 7, 13, 0, 1, shade(STONE_W, 0.84)); // soubassement
    g.box(6, 14, 7, 13, 1, 4.4, shade(PLASTER, wobble()));
    g.box(9.2, 10.8, 6.6, 7, 1, 3.8, DARK_W); // porte
    g.box(6.8, 8.1, 6.6, 7, 2.3, 3.6, [122, 186, 202]); // fenêtres
    g.box(11.9, 13.2, 6.6, 7, 2.3, 3.6, [122, 186, 202]);
    // Toit de CHAUME : la troisième couverture du bourg. Avec trois maisons qui
    // portent chaume / terre cuite / ardoise, le tissu se lit comme un village
    // bâti par plusieurs mains — trois toits de la même tuile faisaient motif.
    prismRoof(g, 6.4, 13.6, 7.4, 12.6, 4.6, shade(THATCH, 0.96), 1.5);
    g.box(11.6, 13, 10.6, 12, 4.4, 9.6, shade(STONE_W, 0.9)); // cheminée
    g.box(11.9, 12.7, 10.9, 11.7, 9.6, 10, DARK_W);
    g.box(6.6, 8.2, 6.2, 6.6, 0, 0.6, shade(WOOD_W, 0.88)); // banc devant la porte
  } else if (kind === 1) {
    // Maison à étage en ENCORBELLEMENT : le premier déborde du rez, colombages
    // apparents. C'est le débord qui donne l'ombre portée et la lecture « rue ».
    g.box(6.6, 13.4, 7.6, 12.4, 0, 3.6, shade(STONE_W, 0.98)); // rez de pierre
    g.box(9.2, 10.8, 7.2, 7.6, 0, 3, DARK_W); // porte
    g.box(6, 14, 7, 13, 3.6, 7, shade(PLASTER, wobble())); // étage en surplomb
    g.box(6, 14, 6.9, 7, 3.4, 3.9, shade(WOOD_W, 0.86)); // sablière
    for (const x of [6.1, 8.3, 11.6, 13.7]) g.box(x, x + 0.5, 6.9, 7, 3.9, 7, shade(DARK_W, 1.5)); // colombages
    g.box(9.2, 10.8, 6.9, 7, 4.7, 6.1, [122, 186, 202]); // fenêtre d'étage
    prismRoof(g, 6, 14, 7.2, 12.8, 7.2, ROOF_W, 1.3);
    g.box(6.4, 7.6, 8.2, 9.4, 7, 11.6, shade(STONE_W, 0.88)); // cheminée
    g.box(6.7, 7.3, 8.5, 9.1, 11.6, 12, DARK_W);
  } else {
    // Petite maison PEINTE avec auvent de toile : c'est elle qui met la couleur
    // franche dans le tissu (rose/tuile), et l'auvent casse le prisme.
    const wall = rnd() < 0.5 ? PAINT_TEAL : PAINT_ROSE;
    g.box(7, 13, 7.8, 12.6, 0, 0.8, shade(STONE_W, 0.84));
    g.box(7, 13, 7.8, 12.6, 0.8, 4.2, shade(wall, wobble()));
    g.box(9.4, 10.6, 7.4, 7.8, 0.8, 3.6, shade(WOOD_W, 1.12)); // porte bois
    g.box(7.3, 8.6, 7.4, 7.8, 2, 3.4, [246, 240, 218]); // fenêtres à volets clairs
    g.box(11.4, 12.7, 7.4, 7.8, 2, 3.4, [246, 240, 218]);
    prismRoof(g, 6.6, 13.4, 7.6, 12.8, 4.4, ROOF_SLATE, 1.2);
    g.box(6.6, 13.4, 6.1, 7.5, 3.9, 4.3, shade(TRIM_GOLD, 0.96)); // auvent de toile
    for (const x of [6.8, 13]) g.box(x, x + 0.5, 6.2, 6.7, 0, 3.9, shade(WOOD_W, 0.94)); // poteaux
    g.box(7.4, 8.4, 6.2, 7, 0, 1.3, shade(ROOF_TILE, 1.05)); // cageot à l'étal
  }
  return fin(g);
}

// --- deuxième famille : les silhouettes qui ne sont PAS un pavé + un prisme ---
// Trois maisons ne suffisaient pas à faire une ville : à vingt exemplaires, le
// même volume répété se lit comme un motif, quelle que soit la rotation. Ces
// six-là changent d'EMPRISE (longue et basse, étroite et haute, en L) et de
// registre (bardage, arcade, terrasse), pas seulement de couleur.
function house2(kind, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const wobble = () => 0.94 + rnd() * 0.12;

  if (kind === 0) {
    // GRANGE : longue et basse, bardage bois à colombages, porte charretière.
    // Son intérêt est l'emprise — 2× plus large que profonde, elle casse les
    // alignements de maisons carrées.
    g.box(4, 16, 7, 13, 0, 1, shade(STONE_W, 0.84)); // solin
    g.box(4, 16, 7, 13, 1, 4.2, shade(WOOD_W, wobble()));
    for (const x of [4.3, 7.4, 12.6, 15.7]) g.box(x, x + 0.6, 6.7, 7, 1, 4.2, shade(DARK_W, 1.45));
    g.box(9, 11, 6.7, 7, 1, 3.8, DARK_W); // porte charretière
    g.box(5.3, 6.3, 6.7, 7, 2.4, 3.4, [122, 186, 202]);
    g.box(13.7, 14.7, 6.7, 7, 2.4, 3.4, [122, 186, 202]);
    prismRoof(g, 4.4, 15.6, 7.4, 12.6, 4.4, ROOF_TILE, 1.3);
    g.box(2.6, 3.8, 9.2, 11, 0, 2, shade(THATCH, 0.92)); // bottes de paille dehors
  } else if (kind === 1) {
    // ÉCHOPPE : rez-de-chaussée ouvert en arcade, étage peint en surplomb,
    // auvent et étal sur la rue. C'est la maison « de commerce » du bourg.
    g.box(6, 14, 7.5, 13, 0, 0.8, shade(STONE_W, 0.86));
    g.box(6, 14, 7.5, 13, 0.8, 3.4, shade(DARK_W, 1.15)); // fond d'échoppe, dans l'ombre
    for (const x of [6, 8.9, 11.8, 13.4]) g.box(x, x + 0.9, 7.5, 8.2, 0.8, 3.4, shade(STONE_W, 0.98)); // piles
    g.box(6, 14, 7.5, 13, 3.4, 3.9, shade(STONE_W, 1.02)); // linteau + plancher
    g.box(5.6, 14.4, 7, 13.2, 3.9, 7, shade(PAINT_ROSE, wobble())); // étage en surplomb
    g.box(8.6, 11.4, 6.9, 7, 4.7, 6.2, [246, 240, 218]); // fenêtre d'étage
    prismRoof(g, 5.6, 14.4, 7.2, 13, 7.2, ROOF_W, 1.2);
    g.box(5.2, 14.8, 5.8, 7.4, 3.4, 3.8, shade(TRIM_GOLD, 0.96)); // auvent de toile
    g.box(6.2, 8.4, 5.9, 7.2, 0, 1.4, shade(ROOF_TILE, 1.06)); // étal
    g.box(12.6, 13.4, 6.5, 6.9, 1.8, 3, shade(TRIM_GOLD, 1.0)); // enseigne
  } else {
    // MAISON ÉTROITE à deux étages avec balcon : la verticale du tissu. C'est
    // elle qui empêche le bourg d'être une nappe uniforme de toits bas.
    g.box(7, 13, 8, 12, 0, 1, shade(STONE_W, 0.84));
    g.box(7, 13, 8, 12, 1, 4.4, shade(PLASTER, wobble()));
    g.box(9.4, 10.6, 7.6, 8, 1, 3.8, shade(WOOD_W, 1.1)); // porte
    g.box(7, 13, 8, 12, 4.4, 8, shade(PLASTER, 0.95));
    g.box(6.6, 13.4, 7.4, 8, 4.4, 4.8, shade(WOOD_W, 0.9)); // plancher du balcon
    for (let x = 6.8; x < 13.4; x += 1.1) g.box(x, x + 0.35, 7.4, 7.6, 4.8, 5.6, shade(WOOD_W, 1.16)); // balustres
    g.box(9.2, 10.8, 7.9, 8, 5.4, 7.2, [122, 186, 202]); // porte-fenêtre
    prismRoof(g, 6.8, 13.2, 8.2, 11.8, 8.2, ROOF_SLATE, 1.1);
    g.box(11.6, 12.6, 9.4, 10.6, 8, 12, shade(STONE_W, 0.9)); // cheminée
    g.box(11.9, 12.3, 9.7, 10.3, 12, 12.4, DARK_W);
  }
  return fin(g);
}

function house3(kind, seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const wobble = () => 0.94 + rnd() * 0.12;

  if (kind === 0) {
    // REMISE en appentis : petite, toit à UNE pente. Elle se glisse en fond de
    // parcelle et donne des toits bas entre deux maisons — l'irrégularité de
    // hauteur, c'est ce qui fait un tissu et pas une rangée.
    g.box(7, 13, 8.6, 12, 0, 0.7, shade(STONE_W, 0.84));
    g.box(7, 13, 8.6, 12, 0.7, 3.2, shade(WOOD_W, wobble()));
    g.box(9.4, 10.6, 8.2, 8.6, 0.7, 2.9, DARK_W); // porte
    shedRoof(g, 6.8, 13.2, 8.2, 12.4, 4.2, 1.5, shade(THATCH, 0.95));
    g.box(13.2, 14.2, 9, 11, 0, 1.6, shade(WOOD_W, 0.86)); // tas de bûches
  } else if (kind === 1) {
    // MAISON À TOURELLE : corps carré + tourelle ronde coiffée d'un cône. Le
    // seul volume COURBE du tissu — il accroche l'œil au milieu des prismes.
    g.box(6.5, 13, 8, 12.5, 0, 1, shade(STONE_W, 0.86));
    g.box(6.5, 13, 8, 12.5, 1, 5, shade(PLASTER, wobble()));
    g.box(9, 10.4, 7.6, 8, 1, 3.9, DARK_W);
    g.box(11.2, 12.4, 7.6, 8, 2.6, 4.1, [122, 186, 202]);
    prismRoof(g, 6.5, 13, 8.4, 12.1, 5.2, ROOF_TILE, 1.1);
    cylAt(g, 13.2, 9.8, 0, 7.6, 2.1, shade(STONE_W, 0.94)); // tourelle
    for (let k = 0; k < 5; k++) cylAt(g, 13.2, 9.8, 7.6 + k * 0.7, 8.2 + k * 0.7, 2.3 - k * 0.42, shade(ROOF_SLATE, 0.94 + k * 0.03));
    g.set(13.2, 9.8, 11.2, TRIM_GOLD); // épi de faîtage
    g.box(12.6, 13.8, 7.9, 8.2, 3.4, 4.4, [122, 186, 202]); // meurtrière
  } else {
    // MAISON BASSE À TERRASSE : murs chaulés, toit PLAT bordé d'un parapet,
    // escalier extérieur. Aucun prisme — c'est le contre-exemple qui prouve que
    // le bourg n'a pas été bâti d'un seul geste.
    const wall = rnd() < 0.5 ? [240, 232, 214] : shade(PAINT_TEAL, 1.12);
    g.box(6.5, 13.5, 8, 12.5, 0, 0.8, shade(STONE_W, 0.84));
    g.box(6.5, 13.5, 8, 12.5, 0.8, 4.6, shade(wall, wobble()));
    g.box(6.2, 13.8, 7.7, 12.8, 4.6, 5.1, shade(STONE_W, 1.02)); // dalle débordante
    // ⚠ Le sol de la terrasse doit être CHAUD et occupé. Laissé en pierre pâle
    // et cerné d'un parapet haut, il se lisait — vu de la caméra dimétrique,
    // qui plonge — comme un bassin d'eau claire : on croyait à une piscine.
    g.box(6.6, 13.4, 8.1, 12.4, 5.1, 5.35, shade(ROOF_TILE, 0.92)); // tomettes
    g.box(6.2, 13.8, 7.7, 8.1, 5.1, 5.7, shade(wall, 0.96)); // parapet, plus bas
    g.box(6.2, 13.8, 12.4, 12.8, 5.1, 5.7, shade(wall, 0.96));
    g.box(6.2, 6.6, 7.7, 12.8, 5.1, 5.7, shade(wall, 0.96));
    g.box(13.4, 13.8, 7.7, 12.8, 5.1, 5.7, shade(wall, 0.96));
    g.box(9.2, 10.6, 7.6, 8, 0.8, 3.8, shade(WOOD_W, 1.12)); // porte
    g.box(7, 8.2, 7.6, 8, 2, 3.4, [246, 240, 218]);
    for (let k = 0; k < 6; k++) g.box(13.8, 15, 8.4 + k * 0.5, 8.9 + k * 0.5, 0, 0.8 + k * 0.75, shade(STONE_W, 0.9)); // escalier extérieur
    // Pergola sur UNE PARTIE de la terrasse : elle casse le plan horizontal et
    // donne de l'ombre. Elle ne doit couvrir ni toute la surface ni monter trop
    // haut — essayée pleine et à z 7,4, elle se lisait comme un second toit
    // posé en lévitation au-dessus du premier.
    for (const [px, py] of [[7.1, 8.5], [7.1, 11.3], [10.3, 8.5], [10.3, 11.3]])
      g.box(px, px + 0.5, py, py + 0.5, 5.3, 6.5, shade(WOOD_W, 0.9));
    g.box(6.9, 11, 8.3, 11.9, 6.5, 6.8, shade(TRIM_GOLD, 0.9)); // toile tendue
    g.box(12.2, 13.2, 9.4, 11, 5.3, 6, shade([104, 150, 96], 1.0)); // jardinière
    g.box(7.6, 8.6, 11.8, 12.3, 5.3, 5.9, shade(ROOF_TILE, 1.08)); // jarres
  }
  return fin(g);
}

function bldChantier(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  for (const [bx, by] of [[4, 6], [15, 6], [4, 13], [15, 13]]) g.box(bx, bx + 0.8, by, by + 0.8, 0, 9, WOOD_W); // poteaux
  for (const z of [3, 6, 9]) { // traverses
    g.box(4, 15.8, 6, 6.6, z, z + 0.5, shade(WOOD_W, 1.1));
    g.box(4, 15.8, 13, 13.6, z, z + 0.5, shade(WOOD_W, 1.1));
  }
  for (let x = 4; x <= 15.5; x += 1.4) g.box(x, x + 1, 6, 13.6, 6, 6.4, shade(WOOD_W, 0.92 + (x % 2) * 0.1)); // plateforme
  ellipsoid(g, 9.5, 9.5, 1.2, 3.4, 2.8, 1.4, shade(STONE_W, 0.9), rnd, 7); // tas de pierres
  g.box(17.4, 18.2, 9.5, 10.3, 0, 12, WOOD_W); // mât de grue
  g.box(11, 18.2, 9.6, 10.2, 12, 12.6, shade(WOOD_W, 1.08)); // flèche
  for (let z = 8; z < 12; z++) g.set(11.4, 9.9, z, [200, 190, 170]); // corde
  g.set(11.4, 9.9, 7.4, [212, 176, 96]); // crochet
  return g;
}
// NUAGE (ciel de la carte et de la ville) : amas de bulles aplaties, ventre
// PLAT teinté lavande — solide (pas d'alpha), le style diorama assume.
function cloudProp(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const bx = 4.5 + rnd() * 11, by = 7 + rnd() * 6, r = 2.6 + rnd() * 2.8;
    ellipsoid(g, bx, by, 3.4 + rnd() * 0.8, r, r * 0.78, 1.7 + rnd() * 1.3, [248, 250, 255], rnd, 2);
  }
  // ventre plat : on rase sous z=2 et on teinte la couche du dessous
  const zCut = Math.round(2 * g.fs);
  const under = g.color([224, 230, 244]);
  for (let y = 0; y < g.fsy; y++) {
    for (let x = 0; x < g.fsx; x++) {
      for (let z = 0; z < zCut; z++) g.data[x + y * g.fsx + z * g.fsx * g.fsy] = 0;
      if (g.data[x + y * g.fsx + zCut * g.fsx * g.fsy]) g.data[x + y * g.fsx + zCut * g.fsx * g.fsy] = under;
    }
  }
  return fin(g);
}

// COMBAT (C1) — ronces : touffe d'épines sombre, traversable mais piquante
function brambles(seed) {
  const g = new Grid(SIZE.sx, SIZE.sy, SIZE.sz, FINE);
  const rnd = makeRng(seed);
  const dark = [74, 88, 62];
  for (let i = 0; i < 8; i++) {
    const bx = 5 + rnd() * 10, by = 5 + rnd() * 10;
    const h = 3 + Math.floor(rnd() * 3);
    for (let z = 0; z < h; z++) {
      g.set(bx + Math.round(Math.sin(z * 1.7 + i) * 1.2), by + Math.round(Math.cos(z * 1.3 + i)), z, shade(dark, 0.9 + rnd() * 0.2));
    }
    if (rnd() < 0.7) g.set(bx, by, h, [150, 70, 80]); // pointe épineuse
  }
  ellipsoid(g, 9.5, 9.5, 1.2, 4.5, 4, 1.4, shade(dark, 0.85), rnd, 7);
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
    { id: "olive", make: (v) => olive(811 + v * 77) },
    // bâtiments de la VILLE : v0 intact, v1 abîmé, v2 en ruine — la vue Home
    // choisit la variante selon la DURABILITÉ réelle du bâtiment
    ...[
      ["bld-well", bldWell], ["bld-panel", bldPanel], ["bld-bank", bldBank],
      ["bld-workshop", bldWorkshop], ["bld-gate", bldGate], ["bld-tower", bldTower],
      ["bld-townhall", bldTownhall], ["bld-kitchen", bldKitchen], ["bld-wall", bldWall],
      ["bld-recyclerie", bldRecyclerie],
    ].map(([id, mk], bi) => ({
      id,
      make: (v) => {
        const g = mk(1001 + bi * 31);
        damagePass(g, v === 0 ? 0 : v === 1 ? 0.35 : 0.68, 2001 + bi * 31 + v * 7);
        return fin(g);
      },
    })),
    // vantaux du portail (séparés → animés autour des gonds par VoxelTownView) ;
    // 3 variantes de DÉGÂTS comme le portail, mais SANS gravats épars (noLumps)
    ...[["bld-gate-door-l", -1], ["bld-gate-door-r", 1]].map(([id, side], di) => ({
      id,
      make: (v) => {
        const g = bldGateDoor(side, 1401 + di * 31);
        damagePass(g, v === 0 ? 0 : v === 1 ? 0.35 : 0.68, 2401 + di * 31 + v * 7, true);
        return fin(g);
      },
    })),
    { id: "bld-chantier", make: () => fin(bldChantier(1101)) },
    // maisons de remplissage du bourg — 9 modèles distincts (3 ids × 3), pas
    // des états de dégâts : le tissu bâti a besoin de silhouettes variées
    { id: "house", make: (v) => house(v, 1501 + v * 77) },
    { id: "house2", make: (v) => house2(v, 1601 + v * 77) },
    { id: "house3", make: (v) => house3(v, 1701 + v * 77) },
    { id: "cloud", make: (v) => cloudProp(1201 + v * 77) },
    { id: "brambles", make: (v) => brambles(1301 + v * 77) },
    // sites de ruines-donjons : v0 = enseveli, v1-2 = déblayé (choix par ÉTAT serveur)
    { id: "site-ferme", make: (v) => siteFerme(v > 0, 901) },
    { id: "site-epave", make: (v) => siteEpave(v > 0, 911) },
    { id: "site-sanctuaire", make: (v) => siteSanctuaire(v > 0, 921) },
    { id: "site-mine", make: (v) => siteMine(v > 0, 931) },
    { id: "site-tour", make: (v) => siteTour(v > 0, 941) },
    { id: "ruin-wall", make: (v) => ruinWall(701 + v * 77) },
    { id: "ruin-column", make: (v) => ruinColumn(711 + v * 77) },
    { id: "ruin-slab", make: (v) => ruinSlab(721 + v * 77) },
    { id: "ruin-arch", make: (v) => ruinArch(731 + v * 77) },
  ];
  // Filtre CLI : `node scripts/voxel/gen-props.mjs house bld-wall` ne régénère
  // que ces ids. Sans argument, tout est régénéré (comportement historique).
  // Les seeds sont fixes, donc régénérer tout est idempotent — mais ça écrit
  // 216 fichiers et noie la revue du diff.
  const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith("--")));
  for (const d of defs) {
    if (only.size && !only.has(d.id)) continue;
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
