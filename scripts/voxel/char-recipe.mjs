// Gabarit CHIBI voxel paramétré (Phase 5 du VOXEL-PLAN) — JS pur, partagé
// (CLI gen-characters.mjs aujourd'hui, éditeur navigateur demain).
//
// Grille 20(x, largeur) × 12(y, profondeur) × 30(z, hauteur). Le personnage
// FAIT FACE à +y (le sud du monde) : au rendu, rotation.y = azimut caméra →
// le modèle tourne réellement avec la caméra (consigne persos étape 2).
// Proportions chibi : grosse tête (≈ moitié de la hauteur), corps trapu.
//
// palette: { skin, hair, outfit, outfit2, accent } — [r,g,b] extraits du PNG
// de la classe (gen-characters échantillonne des zones du sprite).

export function shade([r, g, b], f) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return [c(r), c(g), c(b)];
}

// Grille voxel des gabarits. `fineScale` > 1 = SUR-ÉCHANTILLONNAGE (retour
// « trop pixelisé ») : les gabarits restent écrits en coordonnées GROSSIÈRES
// (sx/sy/sz), le stockage se fait en voxels fins (fsx/fsy/fsz = ×fineScale) —
// chaque cellule grossière remplit son pavé de voxels fins, les proportions ne
// bougent pas, la définition monte.
export class Grid {
  constructor(sx, sy, sz, fineScale = 1) {
    this.fs = fineScale;
    this.sx = sx; this.sy = sy; this.sz = sz; // dims GROSSIÈRES (pour les gabarits)
    this.fsx = Math.round(sx * fineScale);
    this.fsy = Math.round(sy * fineScale);
    this.fsz = Math.round(sz * fineScale);
    this.data = new Uint8Array(this.fsx * this.fsy * this.fsz);
    this.palette = [];
    this._keys = new Map();
  }
  color(rgb) {
    const k = rgb[0] * 65536 + rgb[1] * 256 + rgb[2];
    let i = this._keys.get(k);
    if (i === undefined) { this.palette.push(rgb); i = this.palette.length; this._keys.set(k, i); }
    return i;
  }
  /** voxel FIN brut (indexation directe) */
  setFine(x, y, z, rgb) {
    if (x < 0 || y < 0 || z < 0 || x >= this.fsx || y >= this.fsy || z >= this.fsz) return;
    this.data[x + y * this.fsx + z * this.fsx * this.fsy] = this.color(rgb);
  }
  /** bornes fines [début, fin] d'une cellule grossière */
  cell(c) {
    return [Math.round(c * this.fs), Math.round((c + 1) * this.fs) - 1];
  }
  set(x, y, z, rgb) {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    const [x0, x1] = this.cell(x), [y0, y1] = this.cell(y), [z0, z1] = this.cell(z);
    for (let zf = z0; zf <= z1; zf++) for (let yf = y0; yf <= y1; yf++) for (let xf = x0; xf <= x1; xf++) this.setFine(xf, yf, zf, rgb);
  }
  box(bx0, bx1, by0, by1, bz0, bz1, rgb) {
    const [x0] = this.cell(bx0), [, x1] = this.cell(bx1);
    const [y0] = this.cell(by0), [, y1] = this.cell(by1);
    const [z0] = this.cell(bz0), [, z1] = this.cell(bz1);
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.setFine(x, y, z, rgb);
  }
  // boîte aux coins verticaux rognés (lecture "rondouillarde" chibi)
  roundedBox(x0, x1, y0, y1, z0, z1, rgb) {
    this.box(x0, x1, y0, y1, z0, z1, rgb);
    const [zf0] = this.cell(z0), [, zf1] = this.cell(z1);
    for (const [cx, cy] of [[x0, y0], [x0, y1], [x1, y0], [x1, y1]]) {
      const [cx0, cx1] = this.cell(cx), [cy0, cy1] = this.cell(cy);
      for (let z = zf0; z <= zf1; z++) {
        for (let y = cy0; y <= cy1; y++) {
          for (let x = cx0; x <= cx1; x++) {
            if (x >= 0 && y >= 0 && z >= 0 && x < this.fsx && y < this.fsy && z < this.fsz) {
              this.data[x + y * this.fsx + z * this.fsx * this.fsy] = 0;
            }
          }
        }
      }
    }
  }
}

export const CHAR_SIZE = { sx: 20, sy: 12, sz: 30 }; // coordonnées des gabarits
export const CHAR_FINE = 1.5; // sur-échantillonnage (30×18×45 stockés)

// accessoires par classe — `key` = fichier char-* du jeu
const ACCESSORIES = {
  "char-scout": "cape",
  "char-builder": "casque",
  "char-archer": "arc",
  "char-knight": "heaume",
  "char-merchant": "sac",
  "char-healer": "capuche",
  "char-wizard": "chapeau",
};

export function generateCharacter(key, pal) {
  const { sx, sy, sz } = CHAR_SIZE;
  const g = new Grid(sx, sy, sz, CHAR_FINE);
  const cx = Math.floor(sx / 2); // 10
  const cy = Math.floor(sy / 2); // 6
  const { skin, hair, outfit, outfit2, accent } = pal;
  const boot = shade(outfit2, 0.6);

  // jambes courtes (bottes)
  g.box(cx - 4, cx - 2, cy - 2, cy + 1, 0, 4, shade(outfit, 0.8));
  g.box(cx + 1, cx + 3, cy - 2, cy + 1, 0, 4, shade(outfit, 0.8));
  g.box(cx - 4, cx - 2, cy - 2, cy + 2, 0, 1, boot);
  g.box(cx + 1, cx + 3, cy - 2, cy + 2, 0, 1, boot);

  // corps trapu (tunique + ceinture accent)
  g.roundedBox(cx - 5, cx + 4, cy - 3, cy + 2, 5, 12, outfit);
  g.box(cx - 5, cx + 4, cy - 3, cy + 2, 6, 6, accent); // ceinture
  g.box(cx - 3, cx + 2, cy + 2, cy + 2, 8, 11, outfit2); // plastron/tablier côté face

  // bras le long du corps, mains peau
  g.box(cx - 7, cx - 6, cy - 2, cy + 1, 5, 11, shade(outfit, 0.9));
  g.box(cx + 5, cx + 6, cy - 2, cy + 1, 5, 11, shade(outfit, 0.9));
  g.box(cx - 7, cx - 6, cy - 2, cy + 1, 4, 4, skin);
  g.box(cx + 5, cx + 6, cy - 2, cy + 1, 4, 4, skin);

  // GROSSE tête chibi
  g.roundedBox(cx - 6, cx + 5, cy - 4, cy + 3, 13, 24, skin);
  // chevelure : calotte + arrière + mèches
  g.roundedBox(cx - 6, cx + 5, cy - 4, cy + 3, 22, 25, hair);
  g.box(cx - 6, cx + 5, cy - 4, cy - 3, 15, 24, hair); // nuque
  g.box(cx - 6, cx - 6, cy - 4, cy + 3, 19, 24, hair);
  g.box(cx + 5, cx + 5, cy - 4, cy + 3, 19, 24, hair);
  // yeux (face = +y), reflet blanc
  const eyeZ = 17;
  g.box(cx - 3, cx - 2, cy + 3, cy + 3, eyeZ, eyeZ + 1, [30, 26, 34]);
  g.box(cx + 1, cx + 2, cy + 3, cy + 3, eyeZ, eyeZ + 1, [30, 26, 34]);
  g.set(cx - 2, cy + 3, eyeZ + 1, [240, 240, 250]);
  g.set(cx + 2, cy + 3, eyeZ + 1, [240, 240, 250]);
  // joues
  g.set(cx - 4, cy + 3, 15, shade(skin, 1.12));
  g.set(cx + 4, cy + 3, 15, shade(skin, 1.12));

  // accessoire de classe
  const acc = ACCESSORIES[key];
  const metal = [168, 172, 186];
  const wood = [122, 88, 54];
  if (acc === "cape") {
    g.box(cx - 5, cx + 4, cy - 5, cy - 4, 5, 12, accent); // cape dans le dos
  } else if (acc === "casque") {
    g.box(cx - 6, cx + 5, cy - 4, cy + 3, 22, 25, accent); // casque de chantier
    g.box(cx - 6, cx + 5, cy + 3, cy + 4, 21, 22, accent); // visière
  } else if (acc === "arc") {
    for (let z = 4; z <= 20; z++) {
      const bend = Math.round(2 * Math.sin(((z - 4) / 16) * Math.PI));
      g.set(cx + 8, cy - 1 + bend, z, wood); // arc courbé au flanc droit
    }
    g.box(cx - 8, cx - 7, cy - 3, cy - 2, 8, 16, wood); // carquois dos gauche
  } else if (acc === "heaume") {
    g.roundedBox(cx - 6, cx + 5, cy - 4, cy + 3, 20, 25, metal); // heaume
    g.box(cx - 6, cx + 5, cy + 3, cy + 3, 20, 21, shade(metal, 0.7));
    g.box(cx - 1, cx + 0, cy + 3, cy + 4, 22, 25, accent); // cimier
    for (let z = 2; z <= 14; z++) g.set(cx + 8, cy, z, metal); // épée au flanc
    g.box(cx + 7, cx + 9, cy, cy, 5, 5, wood); // garde
  } else if (acc === "sac") {
    g.roundedBox(cx - 4, cx + 3, cy - 7, cy - 4, 6, 13, wood); // gros sac à dos
    g.box(cx - 4, cx + 3, cy - 7, cy - 4, 9, 9, accent); // sangle
  } else if (acc === "capuche") {
    g.roundedBox(cx - 6, cx + 5, cy - 4, cy + 3, 21, 26, accent); // capuche
    g.box(cx - 6, cx + 5, cy - 4, cy - 2, 14, 25, accent);
    for (let z = 2; z <= 22; z++) g.set(cx - 8, cy + 1, z, wood); // bâton
    g.set(cx - 8, cy + 1, 23, accent); // gemme
  } else if (acc === "chapeau") {
    g.box(cx - 7, cx + 6, cy - 5, cy + 4, 22, 23, accent); // large bord
    g.box(cx - 4, cx + 3, cy - 3, cy + 2, 24, 26, accent);
    g.box(cx - 2, cx + 1, cy - 2, cy + 1, 27, 28, accent); // pointe
    for (let z = 2; z <= 22; z++) g.set(cx + 8, cy + 1, z, wood); // bâton
    g.set(cx + 8, cy + 1, 23, [126, 220, 255]); // gemme
  }

  return { sx: g.fsx, sy: g.fsy, sz: g.fsz, size: g.fsx, data: g.data, palette: g.palette };
}
