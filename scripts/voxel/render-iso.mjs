// Rendu logiciel isométrique d'un modèle voxel — JS pur, zéro GPU, zéro dépendance.
// Sert aux previews/contact sheets de gen-blocks (encodés en PNG via sharp par
// l'appelant) : c'est l'outil de VALIDATION du style en session, sans navigateur.
//
// Projection dimétrique 2:1 (la même lecture que les tuiles iso du jeu) :
//   sx = (x - y) * s        sy = (x + y) * s/2 - z * s
// Faces visibles : dessus (voisin z+1 vide), droite (+x vide), gauche (+y vide).
// Peintre : tri par profondeur x+y+z croissante.

function shade([r, g, b], f) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return [c(r), c(g), c(b)];
}

// model: { sx, sy, sz, data, palette } ; s = pixels par voxel (pair).
// Retourne { width, height, rgba: Uint8Array RGBA }.
export function renderModel(model, { s = 6, bg = null } = {}) {
  const { sx, sy, sz, data, palette } = model;
  const width = (sx + sy) * s + 2;
  const height = sz * s + ((sx + sy) * s) / 2 + 3;
  const ox = sy * s + 1; // origine écran du voxel (0,0,0), centre de son losange du dessus
  // ancré depuis le HAUT : le losange du voxel le plus haut (z = sz-1) affleure y=1,
  // et le bas du bloc (front (sx-1, sy-1, 0) + flanc) tient dans la hauteur calculée
  const oy = (sz - 1) * s + s / 2 + 1;
  const img = new Uint8Array(width * height * 4);
  if (bg) {
    for (let i = 0; i < width * height; i++) {
      img[i * 4] = bg[0]; img[i * 4 + 1] = bg[1]; img[i * 4 + 2] = bg[2]; img[i * 4 + 3] = 255;
    }
  }
  const put = (px, py, [r, g, b]) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const o = (py * width + px) * 4;
    img[o] = r; img[o + 1] = g; img[o + 2] = b; img[o + 3] = 255;
  };
  const at = (x, y, z) =>
    x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : data[x + y * sx + z * sx * sy];

  // Masques de faces précalculés pour l'échelle s (coordonnées relatives au
  // centre du losange du dessus).
  const top = [], right = [], left = [];
  for (let r = 0; r < s; r++) {
    for (let c = 0; c < 2 * s; c++) {
      const cx = c + 0.5 - s, cy = r + 0.5 - s / 2;
      if (Math.abs(cx) + 2 * Math.abs(cy) <= s) top.push([c - s, r - s / 2]);
    }
  }
  for (let c = 0; c < s; c++) {
    const topEdgeR = s / 2 - (c + 1) / 2; // arête bas-droite du losange
    for (let r = 0; r < s; r++) right.push([c, Math.round(topEdgeR + r)]);
    const topEdgeL = (c + 1) / 2;
    for (let r = 0; r < s; r++) left.push([c - s, Math.round(topEdgeL + r)]);
  }

  // Collecte des voxels de surface puis peintre.
  const surf = [];
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        const v = at(x, y, z);
        if (!v) continue;
        const t = !at(x, y, z + 1), rr = !at(x + 1, y, z), ll = !at(x, y + 1, z);
        if (t || rr || ll) surf.push(x + y * 4096 + z * 16777216); // encode (12 bits chacun suffit)
      }
    }
  }
  surf.sort((a, b) => {
    const ax = a & 4095, ay = (a >> 12) & 4095, az = a >> 24;
    const bx = b & 4095, by = (b >> 12) & 4095, bz = b >> 24;
    return ax + ay + az - (bx + by + bz) || az - bz;
  });
  for (const key of surf) {
    const x = key & 4095, y = (key >> 12) & 4095, z = key >> 24;
    const col = palette[at(x, y, z) - 1] ?? [255, 0, 255];
    const cx = ox + (x - y) * s;
    const cy = oy + ((x + y) * s) / 2 - z * s;
    // léger dégradé vertical pour garder la lecture "peinte" (pas de vraie lumière)
    const lift = 1 + (z / Math.max(1, sz)) * 0.08;
    if (!at(x, y, z + 1)) { const c = shade(col, 1.0 * lift); for (const [dx, dy] of top) put(cx + dx, Math.round(cy + dy), c); }
    if (!at(x + 1, y, z)) { const c = shade(col, 0.62 * lift); for (const [dx, dy] of right) put(cx + dx, Math.round(cy + dy), c); }
    if (!at(x, y + 1, z)) { const c = shade(col, 0.8 * lift); for (const [dx, dy] of left) put(cx + dx, Math.round(cy + dy), c); }
  }
  return { width, height, rgba: img };
}

// Rend une grille de blocs (tuilage) — placements: [{model, gx, gy, gz}] en
// unités de bloc ; utile pour vérifier raccords 3×3 et empilements.
export function renderTiling(models, { s = 4 } = {}) {
  // Fusionne dans une grande grille voxel puis rend d'un coup (peintre global).
  const size = models[0].model.size ?? models[0].model.sx;
  const maxGX = Math.max(...models.map((m) => m.gx)) + 1;
  const maxGY = Math.max(...models.map((m) => m.gy)) + 1;
  const maxGZ = Math.max(...models.map((m) => m.gz)) + 1;
  const SX = maxGX * size, SY = maxGY * size;
  const SZ = maxGZ * size + Math.max(...models.map((m) => m.model.sz - size));
  const data = new Uint8Array(SX * SY * SZ);
  const palette = [];
  const palMap = new Map();
  for (const { model, gx, gy, gz } of models) {
    // re-mappe la palette du modèle dans la palette globale
    const remap = model.palette.map((c) => {
      const k = c[0] * 65536 + c[1] * 256 + c[2];
      let i = palMap.get(k);
      if (i === undefined) { palette.push(c); i = palette.length; palMap.set(k, i); }
      return i;
    });
    for (let z = 0; z < model.sz; z++) {
      for (let y = 0; y < model.sy; y++) {
        for (let x = 0; x < model.sx; x++) {
          const v = model.data[x + y * model.sx + z * model.sx * model.sy];
          if (!v) continue;
          const X = gx * size + x, Y = gy * size + y, Z = gz * size + z;
          if (X < SX && Y < SY && Z < SZ) data[X + Y * SX + Z * SX * SY] = remap[v - 1];
        }
      }
    }
  }
  return renderModel({ sx: SX, sy: SY, sz: SZ, data, palette }, { s });
}
