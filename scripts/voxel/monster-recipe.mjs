// Gabarits voxel des MONSTRES (Phase 5 suite) — JS pur, grille partagée avec
// le gabarit héros. Un gabarit par silhouette (blob, fantôme, tourbillon,
// champignon, chauve-souris, araignée, quadrupède, gobelinoïde) ; les couleurs
// (corps/accent) viennent du PNG du monstre (gen-monsters échantillonne).
// Face à +y, comme les héros.

import { Grid, shade } from "./char-recipe.mjs";

export const MOB_SIZE = { sx: 22, sy: 18, sz: 24 };

function ellipsoid(g, cx, cy, cz, rx, ry, rz, rgb, jitter = 0) {
  for (let z = Math.floor(cz - rz); z <= cz + rz; z++) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
        if (d <= 1 + jitter * (Math.sin(x * 3.1 + z * 1.7) * 0.5)) g.set(x, y, z, rgb);
      }
    }
  }
}

function eyes(g, cx, frontY, z, gap = 3, rgb = [24, 20, 30]) {
  g.box(cx - gap, cx - gap + 1, frontY, frontY, z, z + 1, rgb);
  g.box(cx + gap - 1, cx + gap, frontY, frontY, z, z + 1, rgb);
  g.set(cx - gap + 1, frontY, z + 1, [245, 245, 250]);
  g.set(cx + gap, frontY, z + 1, [245, 245, 250]);
}

// --- gabarits (chaque fn : (g, {body, accent}) sur la grille MOB_SIZE) -------

function blob(g, { body, accent }) { // slime : dôme gélatineux + reflet
  const { sx, sy } = g;
  const cx = sx / 2 - 0.5, cy = sy / 2 - 0.5;
  ellipsoid(g, cx, cy, 4, 8, 7, 6, body, 0.15);
  ellipsoid(g, cx, cy, 8, 5.5, 4.5, 4, shade(body, 1.12));
  g.box(Math.round(cx) - 5, Math.round(cx) - 3, Math.round(cy), Math.round(cy) + 1, 9, 10, [250, 252, 255]); // reflet
  eyes(g, Math.round(cx), Math.round(cy + 6), 5);
  void accent;
}

function ghost(g, { body, accent }) { // harpie/fantôme : voile à festons, flotte
  const { sx, sy } = g;
  const cx = sx / 2 - 0.5, cy = sy / 2 - 0.5;
  ellipsoid(g, cx, cy, 13, 6.5, 5.5, 7, body);
  for (let z = 3; z <= 9; z++) { // jupe évasée à festons
    const r = 6.5 - (z - 3) * 0.2;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = ((x - cx) / r) ** 2 + ((y - cy) / r) ** 2;
        const scallop = Math.sin(Math.atan2(y - cy, x - cx) * 5) > 0.4 && z < 5;
        if (d <= 1 && d > 0.45 && !scallop) g.set(x, y, z, shade(body, 0.92));
      }
    }
  }
  eyes(g, Math.round(cx), Math.round(cy + 5), 13);
  g.set(Math.round(cx), Math.round(cy + 5), 10, accent); // pendentif
}

function vortex(g, { body, accent }) { // élémentaire : tourbillon étagé
  const { sx, sy, sz } = g;
  const cx = sx / 2 - 0.5, cy = sy / 2 - 0.5;
  for (let z = 1; z < sz - 4; z++) {
    const t = z / (sz - 4);
    const r = 2.5 + 6 * t;
    const a0 = z * 0.55;
    for (let k = 0; k < 3; k++) {
      const a = a0 + (k * Math.PI * 2) / 3;
      for (let s = -1; s <= 1; s++) {
        const x = cx + Math.cos(a + s * 0.18) * r;
        const y = cy + Math.sin(a + s * 0.18) * r * 0.8;
        g.set(x, y, z, shade(body, 0.85 + 0.3 * t));
      }
    }
    if (z % 4 === 0) g.set(cx + Math.cos(a0) * (r + 1), cy + Math.sin(a0) * (r + 1), z, accent);
  }
  ellipsoid(g, cx, cy, sz - 6, 4, 3.5, 3, shade(body, 1.15));
  eyes(g, Math.round(cx), Math.round(cy + 3), sz - 7, 2);
}

function shroom(g, { body, accent }) { // dryade/champignon : pied + chapeau à pois
  const { sx, sy } = g;
  const cx = sx / 2 - 0.5, cy = sy / 2 - 0.5;
  ellipsoid(g, cx, cy, 5, 5, 4.5, 5.5, body);
  eyes(g, Math.round(cx), Math.round(cy + 4), 6, 2);
  ellipsoid(g, cx, cy, 12, 9, 8, 4.5, accent);
  for (const [dx, dy] of [[-5, -2], [4, -4], [0, 3], [-3, 4], [6, 2]]) {
    g.box(Math.round(cx + dx), Math.round(cx + dx) + 1, Math.round(cy + dy), Math.round(cy + dy) + 1, 14, 15, [246, 242, 232]);
  }
}

function bat(g, { body, accent }) { // chauve-souris : corps haut + ailes déployées
  const { sx, sy } = g;
  const cx = sx / 2 - 0.5, cy = sy / 2 - 0.5;
  ellipsoid(g, cx, cy, 14, 3.5, 3, 4, body);
  eyes(g, Math.round(cx), Math.round(cy + 3), 14, 2);
  g.box(Math.round(cx) - 3, Math.round(cx) - 2, Math.round(cy) - 1, Math.round(cy), 18, 20, body); // oreilles
  g.box(Math.round(cx) + 2, Math.round(cx) + 3, Math.round(cy) - 1, Math.round(cy), 18, 20, body);
  for (let i = 0; i < 8; i++) { // ailes en éventail
    const drop = Math.floor(i * i * 0.12);
    g.box(Math.round(cx) - 4 - i, Math.round(cx) - 4 - i, Math.round(cy) - 1, Math.round(cy) + 1, 13 - drop, 16 - drop, shade(accent, 0.9));
    g.box(Math.round(cx) + 4 + i, Math.round(cx) + 4 + i, Math.round(cy) - 1, Math.round(cy) + 1, 13 - drop, 16 - drop, shade(accent, 0.9));
  }
}

function spider(g, { body, accent }) { // araignée cristalline : abdomen + 8 pattes
  const { sx, sy } = g;
  const cx = sx / 2 - 0.5, cy = sy / 2 - 0.5;
  ellipsoid(g, cx, cy - 3, 8, 6, 5, 5, body);
  ellipsoid(g, cx, cy + 4, 7, 3.5, 3, 3, shade(body, 1.1));
  eyes(g, Math.round(cx), Math.round(cy + 7), 7, 2);
  g.set(cx, cy - 3, 13, accent); // pointe cristal
  g.set(cx, cy - 3, 14, accent);
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 4; i++) {
      const y0 = Math.round(cy - 5 + i * 3);
      for (let k = 0; k < 6; k++) { // patte : monte puis descend
        const x = Math.round(cx + side * (5 + k));
        const z = k < 3 ? 8 + k : 11 - (k - 3) * 3.5;
        g.set(x, y0, Math.max(0, Math.round(z)), shade(body, 0.75));
      }
    }
  }
}

function beast(g, { body, accent }) { // loup-garou : quadrupède ramassé
  const { sx, sy } = g;
  const cx = sx / 2 - 0.5, cy = sy / 2 - 0.5;
  ellipsoid(g, cx, cy - 1, 9, 5, 7, 4.5, body); // corps allongé en profondeur
  for (const [dy, dxs] of [[-5, [-3, 2]], [4, [-3, 2]]]) { // 4 pattes
    for (const dx of dxs) g.box(Math.round(cx + dx), Math.round(cx + dx) + 1, Math.round(cy + dy), Math.round(cy + dy) + 1, 0, 8, shade(body, 0.85));
  }
  ellipsoid(g, cx, cy + 6, 13, 4, 3.5, 3.5, body); // tête
  g.box(Math.round(cx) - 1, Math.round(cx), Math.round(cy) + 9, Math.round(cy) + 10, 11, 12, shade(body, 1.1)); // museau
  g.box(Math.round(cx) - 3, Math.round(cx) - 2, Math.round(cy) + 5, Math.round(cy) + 6, 16, 18, body); // oreilles
  g.box(Math.round(cx) + 1, Math.round(cx) + 2, Math.round(cy) + 5, Math.round(cy) + 6, 16, 18, body);
  eyes(g, Math.round(cx), Math.round(cy + 8), 13, 2, accent);
  for (let k = 0; k < 5; k++) g.set(cx, cy - 8 - k * 0.4, 10 + k, shade(body, 0.9)); // queue
}

function goblinoid(g, { body, accent }, big = false) { // gobelin / orc
  const { sx, sy } = g;
  const cx = Math.floor(sx / 2), cy = Math.floor(sy / 2);
  const s = big ? 1.25 : 1;
  g.box(cx - 3, cx + 2, cy - 2, cy + 1, 0, 3, shade(body, 0.7)); // jambes
  g.roundedBox(cx - Math.round(4 * s), cx + Math.round(3 * s), cy - 3, cy + 2, 3, Math.round(9 * s), shade(accent, 0.9)); // torse (pagne/armure)
  g.roundedBox(cx - 5, cx + 4, cy - 3, cy + 3, Math.round(9 * s), Math.round(9 * s) + 9, body); // tête
  g.box(cx - 8, cx - 6, cy - 1, cy, Math.round(9 * s) + 4, Math.round(9 * s) + 6, body); // grandes oreilles
  g.box(cx + 5, cx + 7, cy - 1, cy, Math.round(9 * s) + 4, Math.round(9 * s) + 6, body);
  eyes(g, cx, cy + 3, Math.round(9 * s) + 4, 3, [180, 30, 30]);
  if (big) { // défenses d'orc
    g.set(cx - 2, cy + 3, Math.round(9 * s) + 1, [240, 236, 220]);
    g.set(cx + 1, cy + 3, Math.round(9 * s) + 1, [240, 236, 220]);
  }
  for (let z = 0; z <= Math.round(12 * s); z++) g.set(cx + 8, cy, z, [122, 88, 54]); // gourdin
  ellipsoid(g, cx + 8, cy, Math.round(13 * s), 2, 2, 2.5, shade([122, 88, 54], 0.85));
}

export const MONSTER_TEMPLATES = {
  "mob-slime": blob,
  "mob-ghost": ghost,
  "mob-windelemental": vortex,
  "mob-mushroomling": shroom,
  "mob-bat": bat,
  "mob-spider": spider,
  "mob-wolf": beast,
  "mob-goblin": (g, pal) => goblinoid(g, pal, false),
  "mob-orc": (g, pal) => goblinoid(g, pal, true),
};

export function generateMonster(key, pal) {
  const { sx, sy, sz } = MOB_SIZE;
  const g = new Grid(sx, sy, sz);
  const fn = MONSTER_TEMPLATES[key];
  if (!fn) throw new Error(`gabarit inconnu: ${key}`);
  fn(g, pal);
  return { sx, sy, sz, size: sx, data: g.data, palette: g.palette };
}
