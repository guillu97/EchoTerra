// Recettes procédurales des blocs voxel — JS PUR, zéro dépendance Node : ce module
// est importé par le générateur CLI (gen-blocks.mjs) ET, plus tard, par l'éditeur
// voxel du navigateur (réglages live, VOXEL-PLAN.md Phase 1b).
//
// Un bloc = grille dense Uint8Array indexée x + y*sx + z*sx*sy (z vers le HAUT),
// valeurs = indice de palette 1-based (0 = vide). Le cube "matière" occupe
// z ∈ [0, size) ; la marge au-dessus (HEADROOM) reçoit le décor qui dépasse
// (brins, cailloux, bosses) pour que les blocs empilés se raccordent sans trou :
// la surface nominale reste PLEINE et PLATE à z = size-1, le relief ne fait
// qu'ajouter des voxels au-dessus.
//
// La palette d'entrée vient de l'extraction des isotiles existants (gen-blocks) :
//   { top: [[r,g,b]...] clair→foncé, side: [[r,g,b]...], accents: [[r,g,b]...] }

export const HEADROOM = 6; // niveaux de décor au-dessus du cube (à l'échelle size=32)

// ---------------------------------------------------------------- utilitaires

// LCG déterministe (mêmes contraintes que drawCloudInto côté MapScene).
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// Bruit de valeur 2D PÉRIODIQUE (période = size) : deux blocs identiques posés
// côte à côte se raccordent exactement — le tuilage 3×3 de l'éditeur est propre.
function latticeVal(ix, iy, period, seed) {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = (h ^ (h >> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >> 16)) >>> 0) / 2 ** 32;
}
export function noise2(x, y, period, seed, octaves = 2) {
  let amp = 1, freqDiv = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const p = Math.max(2, Math.round(period / freqDiv));
    const gx = (x / period) * p, gy = (y / period) * p;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const v00 = latticeVal(x0, y0, p, seed + o * 101);
    const v10 = latticeVal(x0 + 1, y0, p, seed + o * 101);
    const v01 = latticeVal(x0, y0 + 1, p, seed + o * 101);
    const v11 = latticeVal(x0 + 1, y0 + 1, p, seed + o * 101);
    sum += amp * (v00 + (v10 - v00) * sx + ((v01 + (v11 - v01) * sx) - (v00 + (v10 - v00) * sx)) * sy);
    norm += amp;
    amp *= 0.5;
    freqDiv *= 0.5; // périodes plus courtes = détail plus fin
  }
  return sum / norm;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function shade([r, g, b], f) {
  return [Math.round(clamp01((r / 255) * f) * 255), Math.round(clamp01((g / 255) * f) * 255), Math.round(clamp01((b / 255) * f) * 255)];
}

// Grille + palette du bloc en construction. La palette du .vox est propre au
// bloc : on enregistre chaque couleur utilisée (dédupliquée) au fil de l'eau.
class Block {
  constructor(size) {
    this.sx = size; this.sy = size;
    this.sz = size + Math.max(2, Math.round((HEADROOM * size) / 32));
    this.size = size;
    this.data = new Uint8Array(this.sx * this.sy * this.sz);
    this.palette = []; // [[r,g,b]...] — indice .vox = position + 1
    this._colorKeys = new Map();
  }
  color(rgb) {
    const key = rgb[0] * 65536 + rgb[1] * 256 + rgb[2];
    let idx = this._colorKeys.get(key);
    if (idx === undefined) {
      if (this.palette.length >= 255) return this.palette.length; // sature, tant pis
      this.palette.push(rgb);
      idx = this.palette.length; // 1-based
      this._colorKeys.set(key, idx);
    }
    return idx;
  }
  set(x, y, z, rgb) {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return;
    this.data[x + y * this.sx + z * this.sx * this.sy] = this.color(rgb);
  }
  get(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return 0;
    return this.data[x + y * this.sx + z * this.sx * this.sy];
  }
}

// Choisit une nuance dans une rampe [clair→foncé] à partir d'un t ∈ [0,1].
// --- divisionnisme DANS LA DONNÉE VOXEL -------------------------------------
// Le shader (voxel/signacMaterial.ts) fait varier la teinte au rendu ; ici on la
// fait varier dans les VOXELS eux-mêmes, pour que la matière soit réellement
// colorée et pas seulement repeinte à l'affichage.
//
// La contrainte, c'est le greedy meshing : donner une teinte propre à CHAQUE
// voxel supprimerait la fusion des quads et ferait exploser les triangles. Mais
// les recettes quantifient déjà leurs tons en PALIERS, précisément pour que de
// grandes plages fusionnent (voir groundRecipe). On se greffe dessus : chaque
// PALIER reçoit sa propre teinte au lieu d'une simple variation de clarté. Les
// plages restent uniformes, la fusion est intacte — et la surface devient une
// mosaïque de couleurs franches au lieu d'un dégradé d'une seule teinte.
//
// DIV = 0 rend le comportement d'origine.
// 0.9 rendait la ville criarde : parcelles de terre au rouille, muraille au
// lilas bonbon. Le divisionnisme de Signac est LUMINEUX, pas saturé — la
// division doit rester une VIBRATION autour de la couleur locale.
export const DIV = 0.5; // amplitude du parti pris divisionniste (0..1)

function rgb2hsvArr([r, g, b]) {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === R) h = ((G - B) / d) % 6;
    else if (mx === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, mx ? d / mx : 0, mx];
}
function hsv2rgbArr([h, s, v]) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [R, G, B] = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i % 6];
  return [Math.round(R * 255), Math.round(G * 255), Math.round(B * 255)];
}

/**
 * Décale la teinte d'une couleur selon l'indice de PALIER `k` (entier), et
 * remonte la saturation. Deux paliers voisins deviennent deux couleurs pures
 * distinctes qui se recomposent à l'œil — le mélange optique divisionniste.
 */
export function divisionize(rgb, k, amount = DIV) {
  if (!amount) return rgb;
  const hsv = rgb2hsvArr(rgb);
  // suite déterministe, bien répartie sur le cercle chromatique mais courte :
  // on veut des voisins CONTRASTÉS, pas un arc-en-ciel qui détruit la lecture
  // Roue ANALOGUE-dominante. La première version montait à ±0.165 de teinte :
  // sur un vert d'herbe ça bascule dans l'ORANGE et le ROUGE, et la pelouse se
  // lisait comme un sous-bois d'automne. Signac ne fait pas ça — il divise
  // autour de la couleur locale (un vert devient vert-jaune / vert-bleu) et ne
  // réserve la complémentaire franche qu'à de rares touches d'accent.
  const wheel = [0, 0.030, -0.026, 0.052, -0.044, 0.017, -0.013];
  const kk = ((k % wheel.length) + wheel.length) % wheel.length;

  // QUASI-GRIS (la pierre des bâtiments, la neige) : leur teinte de base est
  // arbitraire et instable, donc la faire tourner ne divise rien — seule la
  // saturation agit, et tout part uniformément vers le sable. On leur ASSIGNE
  // à la place une teinte prise dans un accord froid/chaud alterné : mauve,
  // bleu, crème, rosé. C'est exactement le traitement du blanc chez Signac —
  // des touches pâles mais franchement colorées, jamais un aplat teinté.
  const GREY_HUES = [0.74, 0.60, 0.11, 0.95, 0.66, 0.08, 0.80]; // mauve/bleu/crème/rosé
  if (hsv[1] < 0.14) {
    hsv[0] = GREY_HUES[kk % GREY_HUES.length];
    hsv[1] = Math.min(0.19, hsv[1] + 0.13 * amount); // pâle : on teinte, on ne colorie pas
  } else {
    hsv[0] = (hsv[0] + wheel[kk] * amount + 1) % 1;
    hsv[1] = Math.min(1, hsv[1] + (1 - hsv[1]) * 0.17 * amount);
  }
  // la valeur vibre légèrement : c'est ce qui donne la matière peinte
  // Vibration de valeur discrète : à ±8 % chaque palier ressortait comme un
  // moucheté, ce qui bruite la surface au lieu de la faire vibrer.
  hsv[2] = Math.max(0, Math.min(1, hsv[2] * (1 + (kk % 2 ? 0.038 : -0.034) * amount)));
  return hsv2rgbArr(hsv);
}

function ramp(colors, t) {
  if (!colors.length) return [255, 0, 255];
  const i = Math.min(colors.length - 1, Math.max(0, Math.floor(t * colors.length)));
  return colors[i];
}

// ------------------------------------------------------------------- recettes

// Sol générique : socle "terre" (palette side) + couche de surface (palette top)
// + relief ADDITIF au-dessus de la surface + scatter (brins / fleurs / cailloux /
// étincelles). Sert grass, forest, sand, snow, dirt.
function groundRecipe(b, pal, rnd, seed, p) {
  const { size } = b;
  const surfDepth = Math.max(1, Math.round((p.surfaceDepth ?? 3) * size / 32));
  const bumpAmp = p.bump ?? 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // socle : strates légèrement bruitées + moucheture. Les tons sont
      // QUANTIFIÉS en paliers : de grandes plages d'une même couleur fusionnent
      // en grands rectangles au greedy meshing (≈3× moins de triangles) et le
      // rendu en aplats colle mieux au style storybook qu'un mouchetis.
      for (let z = 0; z < size - surfDepth; z++) {
        // aux petites tailles (LOD carte) les flancs restent en bandes UNIES :
        // chaque voxel distinct sur la coque coûte des rectangles au mesher
        const band = size >= 24
          ? Math.round(noise2(x + z * 3, y + z * 7, size, seed + 40, 1) * 3) / 3
          : Math.round((z / size) * 2) / 2;
        let c = divisionize(ramp(pal.side, 0.25 + 0.6 * band), Math.round(band * 3) + z % 2);
        if (size >= 24 && rnd() < 0.03) c = shade(c, 0.82); // caillou sombre incrusté
        b.set(x, y, z, c);
      }
      // couche de surface : nuance par bruit doux (taches d'herbe/sable), en paliers
      const tone = Math.round(noise2(x, y, size, seed, 2) * 4) / 4;
      for (let z = size - surfDepth; z < size; z++) {
        const deep = (size - 1 - z) / surfDepth; // 0 en surface
        b.set(x, y, z, divisionize(ramp(pal.top, clamp01(0.15 + 0.5 * tone + 0.25 * deep)), Math.round(tone * 4)));
      }
      // relief additif au-dessus (le cube reste plein → tuilage sans trous)
      const bump = Math.round(bumpAmp * clamp01(noise2(x + 100, y + 100, size, seed + 7, 2) * 1.4 - 0.55));
      for (let z = size; z < size + bump; z++) {
        b.set(x, y, z, divisionize(ramp(pal.top, clamp01(0.1 + 0.4 * tone)), Math.round(tone * 4) + 1));
      }
    }
  }
  // scatter — densités par voxel de surface, atténuées au LOD réduit (un voxel
  // de 16³ est 2× plus gros à l'écran : même densité = 2× plus de bruit visuel)
  const cells = size * size;
  const lod = Math.min(1, size / 32);
  const scatter = (density, fn) => {
    const n = Math.round(cells * density * lod);
    for (let i = 0; i < n; i++) fn(Math.floor(rnd() * size), Math.floor(rnd() * size));
  };
  const topAt = (x, y) => { let z = b.sz - 1; while (z > 0 && !b.get(x, y, z)) z--; return z; };
  scatter(p.blades ?? 0, (x, y) => { // brins d'herbe 1–3 voxels, nuance claire
    const h = 1 + Math.floor(rnd() * 3);
    const c = shade(ramp(pal.top, 0.08), 1.12);
    const zt = topAt(x, y);
    for (let k = 1; k <= h; k++) b.set(x, y, zt + k, c);
  });
  scatter(p.flowers ?? 0, (x, y) => { // fleur = tige + tête accent
    const c = pal.accents[Math.floor(rnd() * pal.accents.length)] ?? [235, 120, 140];
    const zt = topAt(x, y);
    b.set(x, y, zt + 1, shade(ramp(pal.top, 0.2), 1.05));
    b.set(x, y, zt + 2, c);
  });
  scatter(p.pebbles ?? 0, (x, y) => { // petit caillou 2×2
    const c = shade(ramp(pal.side, 0.35), 1.15);
    const zt = topAt(x, y);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) b.set(x + dx, y + dy, zt + 1, c);
  });
  scatter(p.sparkle ?? 0, (x, y) => { // étincelle neige/givre
    b.set(x, y, topAt(x, y) + 1, [246, 250, 255]);
  });
}

// Roche montagne : strates + relief plus marqué + fissures sombres en surface.
function rockRecipe(b, pal, rnd, seed, p) {
  groundRecipe(b, { ...pal, top: pal.side.length ? pal.side : pal.top, accents: [] }, rnd, seed, {
    surfaceDepth: 2, bump: p.bump ?? 2, pebbles: 0.01,
  });
  const { size } = b;
  // fissures : petites marches aléatoires sombres sur le dessus
  const cracks = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < cracks; i++) {
    let x = Math.floor(rnd() * size), y = Math.floor(rnd() * size);
    const len = 4 + Math.floor(rnd() * (size / 3));
    const dark = shade(ramp(pal.side, 0.8), 0.7);
    for (let k = 0; k < len; k++) {
      b.set(((x % size) + size) % size, ((y % size) + size) % size, size - 1, dark);
      if (rnd() < 0.5) x += rnd() < 0.5 ? 1 : -1; else y += rnd() < 0.5 ? 1 : -1;
    }
  }
}

// Eau : cube plein, plus sombre en profondeur, vaguelettes claires en surface.
function waterRecipe(b, pal, rnd, seed) {
  const { size } = b;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        const depth = 1 - z / (size - 1); // 1 au fond
        let c = ramp(pal.top, clamp01(0.15 + 0.65 * depth));
        if (z === size - 1) {
          // bandes de vagues diagonales périodiques + reflets
          const w = Math.sin(((x + y * 2) / size) * Math.PI * 4 + seed) * 0.5 + 0.5;
          const n = noise2(x, y, size, seed + 3, 1);
          if (w > 0.82) c = shade(ramp(pal.top, 0.06), 1.1);
          else if (n > 0.86) c = ramp(pal.top, 0.02);
        }
        b.set(x, y, z, c);
      }
    }
  }
}

// Pavés : cellules de Voronoï périodique sur le dessus (joints sombres),
// chaque pavé a sa nuance et bombe de +1 au centre.
function cobbleRecipe(b, pal, rnd, seed) {
  const { size } = b;
  const pts = [];
  const n = Math.max(6, Math.round((size * size) / 56));
  for (let i = 0; i < n; i++) pts.push([rnd() * size, rnd() * size, 0.3 + 0.6 * rnd()]);
  const nearest = (x, y) => {
    let bi = 0, bd = Infinity, sd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      // distance torique (périodique) pour un tuilage propre
      let dx = Math.abs(x - pts[i][0]); dx = Math.min(dx, size - dx);
      let dy = Math.abs(y - pts[i][1]); dy = Math.min(dy, size - dy);
      const d = dx * dx + dy * dy;
      if (d < bd) { sd = bd; bd = d; bi = i; } else if (d < sd) sd = d;
    }
    return { i: bi, edge: Math.sqrt(sd) - Math.sqrt(bd) };
  };
  const mortar = shade(ramp(pal.side, 0.45), 0.9); // joints fins et pas charbonneux
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size - 2; z++) {
        b.set(x, y, z, ramp(pal.side, 0.3 + 0.5 * noise2(x, y + z * 5, size, seed + 9, 1)));
      }
      const { i, edge } = nearest(x + 0.5, y + 0.5);
      const stone = shade(ramp(pal.top, 0.1 + 0.55 * pts[i][2]), 1.08); // pavés côté clair de la palette
      for (let z = size - 2; z < size; z++) b.set(x, y, z, edge < 0.8 ? mortar : stone);
      if (edge > 4.5) b.set(x, y, size, shade(stone, 1.06)); // léger bombé au centre seulement
    }
  }
}

// Briques : appareillage classique fonction de (x,y,z) — le motif émerge sur
// toutes les faces du cube ; joints de mortier clairs.
function brickRecipe(b, pal, rnd, seed) {
  const { size } = b;
  const courseH = Math.max(3, Math.round(size / 8)); // hauteur d'une assise
  const brickW = Math.max(6, Math.round(size / 4));
  const mortar = shade(ramp(pal.side, 0.15), 1.0);
  for (let z = 0; z < size; z++) {
    const course = Math.floor(z / courseH);
    const offset = (course % 2) * Math.floor(brickW / 2);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // pas de plan de mortier sur la toute dernière couche : la FACE DU HAUT
        // doit montrer l'appareillage, pas une dalle unie
        const jointZ = z % courseH === courseH - 1 && z !== size - 1;
        const jointX = (x + offset) % brickW === brickW - 1;
        const jointY = (y + offset) % brickW === brickW - 1;
        let c;
        if (jointZ || jointX || jointY) c = mortar;
        else {
          const bid = Math.floor((x + offset) / brickW) * 7 + Math.floor((y + offset) / brickW) * 13 + course * 31;
          c = ramp(pal.top, 0.2 + 0.6 * latticeVal(bid, course, 64, seed));
        }
        b.set(x, y, z, c);
      }
    }
  }
}

// Plancher : lames orientées x, nuance par lame, rainures sombres, socle bois.
function planksRecipe(b, pal, rnd, seed) {
  const { size } = b;
  const plankW = Math.max(4, Math.round(size / 6));
  const seam = shade(ramp(pal.top, 0.85), 0.7);
  for (let y = 0; y < size; y++) {
    const plank = Math.floor(y / plankW);
    const tone = 0.15 + 0.6 * latticeVal(plank, 0, 64, seed);
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size - 2; z++) {
        b.set(x, y, z, ramp(pal.side, 0.3 + 0.4 * noise2(x, y + z * 3, size, seed + 5, 1)));
      }
      const grain = noise2(x * 3, y, size, seed + plank, 1); // fil du bois le long de x
      let c = ramp(pal.top, clamp01(tone + 0.18 * (grain - 0.5)));
      if (y % plankW === plankW - 1) c = seam; // rainure entre lames
      const cut = latticeVal(Math.floor(x / (size / 2)) + plank * 3, plank, 8, seed + 2); // abouts décalés
      if (x === Math.floor(cut * size) % size) c = seam;
      for (let z = size - 2; z < size; z++) b.set(x, y, z, c);
    }
  }
}

// Brume (fog of war), SOMMET — refonte 2026-07-17 : plus un moutonnement de
// bosses mais un VOILE VELOUTÉ : dôme doux unique par bloc (les blocs voisins
// dessinent une houle régulière), dégradé vertical lavande→blanc, fines
// striures diagonales claires sur les flancs, rares motes lumineuses au sommet.
// S'empile sur `mistbase` (le mur de brume a gagné un niveau de hauteur).
function mistRecipe(b, pal, rnd, seed) {
  const { size } = b;
  const margin = b.sz - size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // dôme ample + respiration périodique (les blocs voisins font une houle)
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const dome = Math.max(0, 1 - (dx * dx + dy * dy) * 2.6);
      const n = noise2(x, y, size, seed + 5, 2);
      const extra = Math.round((dome * 0.9 + (n - 0.5) * 0.4) * margin);
      const top = size + Math.max(0, Math.min(margin - 1, extra));
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      // VOLUTES : bandes tourbillonnantes qui texturent LE DESSUS (c'est la
      // face qu'on voit — la v1 plate lisait comme du papier, vu sur capture)
      const swirl = noise2(x * 2 + y, y * 2 - x, size, seed + 17, 2);
      for (let z = 0; z < top; z++) {
        const t = clamp01(z / (size + margin));
        let c = ramp(pal.top, clamp01((1 - t) * 0.8 + (swirl - 0.5) * 0.55));
        if (edge && (x + y + z * 2) % 7 < 2) c = shade(c, 1.06); // striures de flanc
        if (z >= top - 1 && rnd() < 0.03) c = pal.accents[0] ?? c; // mote
        b.set(x, y, z, c);
      }
    }
  }
}

// Brume, BASE — le niveau inférieur du mur de brouillard : cube PLEIN au voile
// plus profond (indigo→lavande), mêmes striures de flanc, aucun décor de
// sommet (le bloc `mist` se pose dessus).
function mistBaseRecipe(b, pal, rnd, seed) {
  const { size } = b;
  void rnd;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise2(x, y, size, seed + 9, 2);
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      for (let z = 0; z < size; z++) {
        const t = z / size; // 0 bas → 1 haut
        let c = ramp(pal.top, clamp01(0.95 - t * 0.42 + (n - 0.5) * 0.1));
        if (edge && (x + y + z * 2) % 7 < 2) c = shade(c, 1.05);
        b.set(x, y, z, c);
      }
    }
  }
}

export const RECIPES = {
  ground: groundRecipe,
  rock: rockRecipe,
  water: waterRecipe,
  cobble: cobbleRecipe,
  brick: brickRecipe,
  planks: planksRecipe,
  mist: mistRecipe,
  mistbase: mistBaseRecipe,
};

// Point d'entrée unique (script CLI et éditeur navigateur).
// def: { recipe, params? } ; palette: { top[], side[], accents[] } ; size = D1 (32 défaut).
export function generateBlock(def, palette, { size = 32, seed = 1 } = {}) {
  const b = new Block(size);
  const rnd = makeRng(seed * 7919 + 17);
  const fn = RECIPES[def.recipe];
  if (!fn) throw new Error(`recette inconnue: ${def.recipe}`);
  fn(b, palette, rnd, seed, def.params ?? {});
  return { sx: b.sx, sy: b.sy, sz: b.sz, size: b.size, data: b.data, palette: b.palette };
}
