// Plan de la ville — GÉNÉRÉ, plus dessiné à la main.
//
// Avant, l'onglet Ville rendait `data/town-map.json`, une carte de l'éditeur de
// 54×59 (575 cellules, 1167 blocs). Elle posait trois problèmes de fond :
//
//   1. Elle ne contenait que 8 des 10 bâtiments du jeu : `wall` et `kitchen`
//      n'avaient AUCUN emplacement, donc ils étaient invisibles et intouchables
//      depuis la Ville — alors que la muraille est construite, s'abîme et
//      compte dans la défense.
//   2. Le terrain était un plateau de grès (346 sandstone, 106 sand, 80 redsand,
//      ZÉRO bloc d'herbe) : un désert, pas un village.
//   3. Les bâtiments étaient posés par des décalages en PIXELS d'éditeur (l'un
//      d'eux valait 726px, soit ~24 tuiles de dérive) et leurs rotations
//      d'auteur étaient ignorées au rendu — d'où une dispersion arbitraire.
//
// Ici, le plan est une FONCTION de l'état de jeu : un village fortifié compact,
// muraille sur le pourtour, portail face caméra, place centrale autour du puits.
// Chaque bâtiment du serveur a sa parcelle, donc tout ce qui existe se voit.

export type TownPlot = {
  bid: string; // id de bâtiment côté serveur
  x: number;
  y: number;
  /** Emprise visée, en CELLULES (le modèle est mis à l'échelle pour la remplir). */
  cells: number;
  /** Rotation additionnelle autour de Y, en radians. */
  rot?: number;
  /** Porte la pastille DOM. La muraille a beaucoup de segments et UNE pastille. */
  primary?: boolean;
  /** Hauteur de pose, en unités monde (le sol n'est plus plat — cf. terrasses). */
  gy?: number;
};

export type TownCellItem = { x: number; y: number; level: number; block: string };
export type TownDecor = {
  x: number;
  y: number;
  prop: string;
  /** Emprise au SOL visée, en cellules. */
  scale: number;
  /** Plafond de HAUTEUR, en cellules. Sans lui, un prop étroit et haut mis à
   *  l'échelle sur son empreinte part au plafond (cf. fitScale). */
  hmax?: number;
  /** Hauteur de pose, en unités monde. */
  gy: number;
  /** Rotation imposée (mobilier de rue, clôtures). Sinon quart de tour par position. */
  rot?: number;
  /** Variante imposée. Sinon dérivée de la position. */
  variant?: number;
};
/** Maison de remplissage : aucun rôle de jeu, elle fait le TISSU du bourg. */
export type TownHouse = {
  x: number;
  y: number;
  /** Id de prop voxel (`house` / `house2` / `house3`). */
  prop: string;
  variant: number;
  cells: number;
  rot: number;
  /** Hauteur de pose, en unités monde. */
  gy: number;
};

export type TownLayout = {
  size: number;
  /** Niveau sur lequel se posent bâtiments, héros et décor. */
  groundLevel: number;
  terrain: TownCellItem[];
  blocks: string[];
  plots: TownPlot[];
  houses: TownHouse[];
  decor: TownDecor[];
  heroSlots: { x: number; y: number; lvl: number }[];
  center: number;
};

// ============================================================================
// EDORAS (2026-07-29) — le bourg n'est plus un damier sur un plateau, c'est un
// TERTRE.
//
// Les références (Edoras du Seigneur des Anneaux : le plan large du film et les
// dioramas) tiennent en quatre traits, et aucun des quatre n'existait ici :
//   1. une **butte isolée** au milieu de la plaine, aux flancs rocheux — pas un
//      plateau carré posé à plat ;
//   2. une **enceinte OVALE** qui épouse le pied de la butte, en palissade,
//      sans un seul angle droit ;
//   3. **une seule route**, qui monte en LACET du portail jusqu'au sommet ; tout
//      le reste n'est que sentes entre les maisons. Pas de grille de rues ;
//   4. la grande salle **SEULE au sommet**, tout le tissu bâti agrippé aux
//      pentes en dessous — c'est la silhouette entière du lieu.
//
// D'où une géométrie POLAIRE : les bâtiments sont posés en (rayon, angle) le
// long de la route, la hauteur ne dépend que du rayon, et l'enceinte est
// l'ellipse elle-même. Plus aucune coordonnée n'est choisie sur une grille —
// c'est ce qui supprime d'un coup l'aspect « plan d'urbanisme ».
const SIZE = 25;
const LAST = SIZE - 1;
const CENTRE = LAST / 2;
/** Demi-axes de la butte, en cellules. Ovale : plus large que profond. */
const RX = 11.4;
const RY = 9.8;
/** Paliers du pied au sommet. */
const HILL = 4;
const GROUND = 1; // socle mince : c'est le tertre qui pose la ville, pas un socle

/**
 * Rayon elliptique NORMALISÉ (0 au sommet, 1 au pied de l'enceinte), avec un
 * léger lobage angulaire. Le lobage est une somme de sinus de l'angle, donc
 * continu et dérivable : les courbes de niveau ondulent sans jamais se briser,
 * et une butte parfaitement circulaire aurait l'air tournée au tour.
 */
const radial = (x: number, y: number): number => {
  const dx = (x - CENTRE) / RX, dy = (y - CENTRE) / RY;
  const r = Math.hypot(dx, dy);
  if (r < 1e-6) return 0;
  const a = Math.atan2(dy, dx);
  // ⚠ L'amplitude s'éteint près du sommet (`fade`). Deux raisons : le replat
  // sommital doit rester net, et surtout la dérivée ANGULAIRE explose quand
  // r → 0 (un pas d'une cellule y balaie un grand angle), ce qui produirait des
  // marches de deux paliers au centre.
  const fade = Math.min(1, r / 0.32);
  // Lobage FORT : une butte n'est pas un cône de révolution. À 0,05
  // d'amplitude, les courbes de niveau restaient des ellipses homothétiques et
  // le tertre se lisait comme un gâteau à étages.
  const lobe = 1 + fade * (0.115 * Math.sin(2 * a + 1.1) + 0.075 * Math.sin(3 * a - 0.4) + 0.045 * Math.sin(5 * a + 2.2));
  // Gauchissement qui dépend AUSSI du rayon : sans lui, toutes les courbes de
  // niveau sont la même forme mise à l'échelle, et l'œil lit immédiatement des
  // anneaux emboîtés. Ici chaque palier a son propre contour.
  const warp = fade * (0.045 * Math.sin(4 * a + 5.5 * r) + 0.03 * Math.sin(7 * a - 3.5 * r));
  return r * lobe + warp;
};

/** Cellules qui portent du terrain : la butte + une frange de plaine. */
const PLAIN_EDGE = 1.12;
const onGround = (x: number, y: number) => radial(x, y) <= PLAIN_EDGE;
/** Ligne de l'enceinte. */
const RAMPART = 1.0;

/**
 * Hauteur du tertre. Fonction du seul rayon, donc strictement décroissante du
 * sommet vers le pied : aucune cuvette, aucune plaque isolée n'est possible.
 * Un palier tous les ~2,4 cellules → toutes les marches valent 1.
 */
const SUMMIT_FLAT = 0.24; // rayon du replat sommital
const hillLevel = (x: number, y: number): number => {
  // ⚠ Le sommet est un REPLAT, pas une pointe. Sans lui, l'emprise de la
  // grande salle (5 cellules) touchait des cellules plus basses et se faisait
  // creuser au minimum : le creusement rasait le sommet et la butte plafonnait
  // deux paliers plus bas. Le replat fait exactement la taille de la salle.
  const u = Math.max(0, Math.min(1, (0.93 - radial(x, y)) / (0.93 - SUMMIT_FLAT)));
  // Profil en PUISSANCE < 1 : la butte monte vite au pied (flancs rocheux
  // escarpés, comme sous Edoras) puis s'adoucit sur les pentes hautes, là où
  // sont les maisons. Un profil linéaire donnerait la même pente partout et
  // enterrerait les maisons du bas.
  return Math.max(0, Math.min(HILL, Math.floor(Math.pow(u, 0.85) * (HILL + 0.75))));
};

// --- la route en lacet -------------------------------------------------------
// Un seul chemin, du portail au sommet, sur ~1,3 tour. Les bâtiments s'y
// accrochent, les maisons le bordent : c'est la seule structure du plan.
const GATE_ANGLE = Math.PI / 2; // le portail plein sud (vers la caméra)
const ROAD_TURNS = 1.15 * Math.PI * 2;
const ROAD_R0 = 0.95;

/** Point de la route au paramètre `t` (0 = portail, 1 = sommet). */
function roadAt(t: number): { x: number; y: number; ang: number; r: number } {
  const r = ROAD_R0 * Math.pow(1 - t, 0.82);
  const ang = GATE_ANGLE - t * ROAD_TURNS;
  return { x: CENTRE + r * RX * Math.cos(ang), y: CENTRE + r * RY * Math.sin(ang), ang, r };
}

/** Cellules de la route, et le `t` de chacune (pour la largeur et les abords). */
function traceRoad(): Map<string, number> {
  const cells = new Map<string, number>();
  // ⚠ La route s'ARRÊTE avant le sommet. Poussée jusqu'à t = 1, son rayon tend
  // vers 0 : des centaines d'échantillons tombent sur les mêmes cellules et
  // toute l'esplanade de la grande salle se retrouvait en terre battue.
  const STEPS = 900, T_END = 0.9;
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * T_END;
    const p = roadAt(t);
    // La route est large en bas (l'entrée charretière) et se réduit à une sente
    // en haut, devant la salle : c'est ce qui donne la perspective de montée.
    // ⚠ Élargie jusqu'à t = 0,35, elle balayait le tiers inférieur de la butte
    // en terre battue : à ce paramètre le rayon ne décroît presque pas, donc un
    // stamp 3×3 y couvre une bande énorme.
    const w = t < 0.1 ? 1 : 0;
    for (let dy = -w; dy <= w; dy++)
      for (let dx = -w; dx <= w; dx++) {
        const cx = Math.round(p.x) + dx, cy = Math.round(p.y) + dy;
        if (cx < 0 || cy < 0 || cx > LAST || cy > LAST) continue;
        const k = `${cx},${cy}`;
        if (!cells.has(k)) cells.set(k, t);
      }
  }
  return cells;
}

// --- les parcelles, en POLAIRE ----------------------------------------------
// La salle est au sommet, seule. Les six autres bâtiments s'échelonnent sur la
// pente, à des rayons et des angles choisis pour border la route sans se gêner
// (dégagements deux à deux vérifiés : somme des demi-emprises).
type PolarPlot = { bid: string; r: number; deg: number; cells: number };
const POLAR: PolarPlot[] = [
  { bid: "townhall", r: 0.0, deg: 0, cells: 5.0 }, // Meduseld, au sommet
  { bid: "panel", r: 0.30, deg: 118, cells: 2.1 },
  { bid: "well", r: 0.34, deg: 258, cells: 2.3 },
  { bid: "bank", r: 0.60, deg: 28, cells: 3.6 },
  { bid: "workshop", r: 0.60, deg: 196, cells: 3.6 },
  { bid: "recyclerie", r: 0.66, deg: 112, cells: 3.6 },
  { bid: "kitchen", r: 0.70, deg: 312, cells: 3.6 },
];

const polarXY = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: CENTRE + r * RX * Math.cos(a), y: CENTRE + r * RY * Math.sin(a) };
};

/**
 * Azimut pour qu'une façade regarde VERS L'AVAL (vers la plaine). Sur un
 * tertre, toutes les maisons tournent le dos à la montée : c'est ce qui fait
 * qu'une butte habitée se lit d'un coup d'œil.
 *
 * Les modèles ont leur porte côté −Z ; une rotation θ autour de Y envoie
 * (0,0,−1) sur (−sin θ, −cos θ), d'où `atan2(−ox, −oy)` pour viser la direction
 * sortante (ox, oy). ⚠ le renderer ajoute π aux PARCELLES (pas aux maisons) :
 * les appelants côté parcelle retranchent π.
 */
const downhillAzimuth = (x: number, y: number): number => {
  const ox = x - CENTRE, oy = y - CENTRE;
  if (Math.hypot(ox, oy) < 1e-6) return 0;
  return Math.atan2(-ox, -oy);
};

// --- enceinte ----------------------------------------------------------------
// Une PALISSADE ovale, posée par segments tangents. Le modèle `bld-wall` est un
// bandeau long : mis à l'échelle sur 4,4 cellules il monte à ~2 — assez pour
// ceindre la butte sans masquer les pentes.
const WALL_SEG = 4.4;
const WALL_COUNT = 16;
/** Demi-ouverture du portail, en radians d'angle paramétrique. */
const GATE_GAP = 0.26;

// Hachage déterministe (pas de Math.random : le bourg doit être identique d'une
// session à l'autre, et d'un joueur à l'autre).
// ⚠ `Math.imul`, pas `*` : `n * 1274126177` dépasse 2^53 et l'arrondi flottant
// DÉTRUIT les bits de poids faible — précisément ceux que `>>> 0` conserve.
const hash = (x: number, y: number) => {
  let n = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
  n = (n ^ (n >>> 13)) >>> 0;
  return Math.imul(n, 1274126177) >>> 0;
};

// --- maisons de remplissage --------------------------------------------------
// ⚠ ORDRE VOLONTAIRE : la reprise ci-dessous essaie les modèles SUIVANTS quand
// le tiré au sort ne rentre pas, donc un grand modèle déverse ses refus sur son
// voisin de droite. Rangés par taille, le plus petit récupérait tout. Les
// gabarits sont donc entrelacés.
const HOUSE_MODELS: { prop: string; variant: number; cells: number }[] = [
  { prop: "house", variant: 0, cells: 2.6 }, // chaumière
  { prop: "house2", variant: 0, cells: 3.8 }, // grange longue et basse
  { prop: "house3", variant: 0, cells: 2.6 }, // remise en appentis
  { prop: "house", variant: 1, cells: 2.6 }, // maison à étage
  { prop: "house2", variant: 1, cells: 2.8 }, // échoppe
  { prop: "house3", variant: 1, cells: 2.8 }, // maison à tourelle
  { prop: "house", variant: 2, cells: 3.0 }, // maison peinte
  { prop: "house2", variant: 2, cells: 2.4 }, // maison étroite
  { prop: "house3", variant: 2, cells: 3.0 }, // maison à terrasse
];

/**
 * Le tissu bâti, accroché aux PENTES.
 *
 * Deux règles portent tout l'aspect « Edoras » :
 *   - rien entre le sommet et la salle (`rad >= SUMMIT_FREE`) : la grande salle
 *     doit être seule là-haut, c'est la silhouette du lieu ;
 *   - toutes les façades regardent l'AVAL. Sur une butte, les maisons suivent
 *     la courbe de niveau et tournent le dos à la montée — c'est ce qui fait
 *     lire un tertre habité au premier coup d'œil.
 */
const SUMMIT_FREE = 0.26;
const BUILD_EDGE = 0.94;

function placeHouses(plots: TownPlot[], road: Map<string, number>): TownHouse[] {
  const houses: TownHouse[] = [];
  const clearOfPlots = (x: number, y: number, r: number) =>
    plots.every((p) => p.bid === "wall" || Math.hypot(x - p.x, y - p.y) >= p.cells / 2 + r - 0.15);
  const farFromHouses = (x: number, y: number, r: number) =>
    houses.every((h) => Math.hypot(h.x - x, h.y - y) >= (h.cells / 2 + r) * 0.82);
  const isRoad = (x: number, y: number) => road.has(`${x},${y}`);
  const nearRoad = (x: number, y: number) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => isRoad(x + dx, y + dy));
  const nextTo = (x: number, y: number) => houses.some((h) => Math.hypot(h.x - x, h.y - y) < 3.4);

  //   0. le long de la ROUTE ;  1. en GRAPPE ;  2. le reste des pentes.
  const admit = [88, 72, 40];
  for (const pass of [0, 1, 2]) {
    for (let y = 1; y < LAST; y++) {
      for (let x = 1; x < LAST; x++) {
        const rad = radial(x, y);
        if (rad > BUILD_EDGE || rad < SUMMIT_FREE || isRoad(x, y)) continue;
        if (pass === 0 && !nearRoad(x, y)) continue;
        if (pass === 1 && !nextTo(x, y)) continue;
        const h = hash(x * 11 + 7, y * 17 + 3);
        if (h % 100 >= admit[pass]) continue;
        // Le modèle donne l'emprise, donc il se choisit AVANT le test de place,
        // avec reprise sur les suivants : sinon les grands gabarits sont
        // recalés bien plus souvent et la parcelle est perdue.
        const start = (h >>> 4) % HOUSE_MODELS.length;
        let m: (typeof HOUSE_MODELS)[number] | null = null;
        let cells = 0;
        for (let k = 0; k < HOUSE_MODELS.length; k++) {
          const cand = HOUSE_MODELS[(start + k) % HOUSE_MODELS.length];
          const c = cand.cells * (0.9 + (((h >>> 26) % 100) / 100) * 0.2);
          if (clearOfPlots(x, y, c / 2) && farFromHouses(x, y, c / 2)) { m = cand; cells = c; break; }
        }
        if (!m) continue;
        houses.push({
          x: x + (((h >>> 8) % 1000) / 1000 - 0.5) * 0.5,
          y: y + (((h >>> 18) % 1000) / 1000 - 0.5) * 0.5,
          prop: m.prop,
          variant: m.variant,
          cells,
          rot: downhillAzimuth(x, y) + (((h % 1000) / 1000 - 0.5) * 0.26),
          gy: 0, // posé plus bas, une fois le tertre calculé
        });
      }
    }
  }
  return houses;
}

/**
 * Hauteur du tertre, emprises CREUSÉES au niveau le plus bas qu'elles touchent.
 * On ne remonte jamais : un bâtiment mord dans le talus côté amont — ce que
 * fait une maison sur une butte — et ne peut donc jamais flotter.
 * `-1` = hors terrain (au-delà de la frange de plaine).
 */
function buildHill(cuts: { x: number; y: number; r: number }[]): number[] {
  const lvl = new Array(SIZE * SIZE).fill(-1);
  const idx = (x: number, y: number) => y * SIZE + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x <= LAST && y <= LAST;
  for (let y = 0; y <= LAST; y++)
    for (let x = 0; x <= LAST; x++) if (onGround(x, y)) lvl[idx(x, y)] = hillLevel(x, y);

  for (const c of cuts) {
    const cx = Math.round(c.x), cy = Math.round(c.y);
    // Rayon de creusement volontairement SERRÉ (un cran de moins que l'emprise) :
    // creuser large descend jusqu'à une cellule lointaine et rabote la pente.
    const r = Math.max(1, Math.round(c.r) - 1);
    let lo = HILL;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (inside(cx + dx, cy + dy) && lvl[idx(cx + dx, cy + dy)] >= 0)
          lo = Math.min(lo, lvl[idx(cx + dx, cy + dy)]);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (inside(cx + dx, cy + dy) && lvl[idx(cx + dx, cy + dy)] >= 0) lvl[idx(cx + dx, cy + dy)] = lo;
  }

  // Filet de sécurité : deux emprises creusées côte à côte peuvent laisser une
  // marche de 2. On ne fait que DESCENDRE — remonter recréerait des bosses.
  for (let pass = 0; pass < SIZE; pass++) {
    let changed = false;
    for (let y = 0; y <= LAST; y++)
      for (let x = 0; x <= LAST; x++) {
        if (lvl[idx(x, y)] < 0) continue;
        let lo = HILL;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
          if (inside(x + dx, y + dy) && lvl[idx(x + dx, y + dy)] >= 0) lo = Math.min(lo, lvl[idx(x + dx, y + dy)]);
        if (lvl[idx(x, y)] > lo + 1) { lvl[idx(x, y)] = lo + 1; changed = true; }
      }
    if (!changed) break;
  }
  return lvl;
}

export function buildTownLayout(): TownLayout {
  const terrain: TownCellItem[] = [];
  const blocks = new Set<string>();
  const push = (x: number, y: number, level: number, block: string) => {
    terrain.push({ x, y, level, block });
    blocks.add(block);
  };

  const plots: TownPlot[] = [];
  const road = traceRoad();
  const isRoad = (x: number, y: number) => road.has(`${x},${y}`);

  // --- enceinte : palissade OVALE, par segments tangents --------------------
  for (let i = 0; i < WALL_COUNT; i++) {
    const a = (i / WALL_COUNT) * Math.PI * 2;
    const d = Math.atan2(Math.sin(a - GATE_ANGLE), Math.cos(a - GATE_ANGLE));
    if (Math.abs(d) < GATE_GAP) continue; // l'ouverture du portail
    const x = CENTRE + RAMPART * RX * Math.cos(a);
    const y = CENTRE + RAMPART * RY * Math.sin(a);
    // tangente à l'ellipse : (−RX sin a, RY cos a). L'axe long du modèle est X,
    // qui part sur (cos θ, −sin θ) — d'où θ = atan2(−ty, tx). Le renderer
    // ajoute π aux parcelles, on le retranche ici.
    const tx = -RX * Math.sin(a), ty = RY * Math.cos(a);
    plots.push({ bid: "wall", x, y, cells: WALL_SEG, rot: Math.atan2(-ty, tx) - Math.PI });
  }
  const wallLabel = plots.find((p) => p.bid === "wall");
  if (wallLabel) wallLabel.primary = true;

  // portail plein sud, face caméra ; tour de guet sur l'enceinte
  const gateXY = { x: CENTRE + RAMPART * RX * Math.cos(GATE_ANGLE), y: CENTRE + RAMPART * RY * Math.sin(GATE_ANGLE) };
  plots.push({ bid: "gate", x: gateXY.x, y: gateXY.y, cells: 3.4, rot: 0, primary: true });
  const towerA = (335 * Math.PI) / 180;
  const towerXY = { x: CENTRE + RAMPART * RX * Math.cos(towerA), y: CENTRE + RAMPART * RY * Math.sin(towerA) };
  plots.push({
    bid: "tower", x: towerXY.x, y: towerXY.y, cells: 3.2,
    rot: downhillAzimuth(towerXY.x, towerXY.y) - Math.PI, primary: true,
  });

  // --- parcelles, en polaire ------------------------------------------------
  for (const p of POLAR) {
    const { x, y } = polarXY(p.r, p.deg);
    // La grande salle regarde le portail ; tout le reste regarde l'aval.
    const az = p.r < 0.05 ? Math.PI : downhillAzimuth(x, y);
    plots.push({ bid: p.bid, x, y, cells: p.cells, rot: az - Math.PI, primary: true });
  }

  const houses = placeHouses(plots, road);

  // --- le tertre ------------------------------------------------------------
  // ⚠ SEULS les gros bâtiments creusent leur terrasse. Faire creuser aussi les
  // ~28 maisons érodait la butte : chacune descend au minimum de son emprise,
  // et de proche en proche le tertre s'aplatissait de deux paliers. Les maisons
  // se contentent donc de SE POSER au minimum de leur emprise — elles mordent
  // dans le talus côté amont, ce qui est précisément ce que fait une maison sur
  // une butte, et le terrain reste une fonction propre.
  const lvl = buildHill(
    plots.filter((p) => p.bid !== "wall" && p.cells >= 3).map((p) => ({ x: p.x, y: p.y, r: p.cells / 2 })),
  );
  const levelAt = (x: number, y: number) => {
    const v = lvl[y * SIZE + x];
    return v === undefined || v < 0 ? 0 : v;
  };
  /** Hauteur de pose : le MINIMUM de l'emprise, jamais le centre — sinon un
   *  coin aval flotte au-dessus du vide. */
  const groundAt = (x: number, y: number, cells = 0) => {
    const r = Math.max(0, Math.round(cells / 2) - 1);
    const cx = Math.round(x), cy = Math.round(y);
    let lo = HILL;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) lo = Math.min(lo, levelAt(cx + dx, cy + dy));
    return lo + GROUND;
  };

  // Terre battue sous les parcelles : elle matérialise le lot tant que le site
  // n'est pas lancé, sinon un chantier non commencé est un carré d'herbe.
  const plotGround = new Set<string>();
  for (const p of POLAR) {
    const { x, y } = polarXY(p.r, p.deg);
    const cx = Math.round(x), cy = Math.round(y);
    const r = Math.max(0, Math.round(p.cells / 2) - 1);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) plotGround.add(`${cx + dx},${cy + dy}`);
  }

  // --- sol ------------------------------------------------------------------
  for (let y = 0; y <= LAST; y++) {
    for (let x = 0; x <= LAST; x++) {
      const lv = lvl[y * SIZE + x];
      if (lv < 0) continue; // hors du tertre : rien, la ville est une ÎLE
      const rad = radial(x, y);
      // Le redent d'un palier est un affleurement ROCHEUX : c'est ce qui donne
      // à la butte ses flancs escarpés, et c'est exactement ce qu'on voit sous
      // Edoras. En terre nue, une marche se lit comme un défaut de terrain.
      const exposed = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx > LAST || ny > LAST) return true;
        const nv = lvl[ny * SIZE + nx];
        return nv < 0 || nv < lv;
      });
      // Le redent d'un palier est HERBEUX par défaut, rocheux par endroits :
      // tout en pierre, les paliers traçaient des anneaux gris concentriques et
      // la butte se lisait comme un gâteau. Les affleurements se concentrent au
      // pied, là où les flancs sont escarpés — comme sous Edoras.
      const rocky = exposed && (hash(x * 3 + 5, y * 3 + 7) % 100) < 22 + 34 * Math.min(1, rad / 0.9);
      for (let k = 0; k <= lv; k++)
        push(x, y, k, k === lv ? (rocky ? "stone" : exposed ? "grass" : "dirt") : "dirt");
      const surface = isRoad(x, y)
        ? "dirt" // la route en lacet, terre battue
        : rad > RAMPART
          ? "fallgrass" // la plaine sèche au-delà de l'enceinte
          : rad < SUMMIT_FREE
            ? "stone" // le replat dallé de la grande salle
            : plotGround.has(`${x},${y}`)
              ? "dirt"
              : "grass";
      push(x, y, lv + 1, surface);
    }
  }
  for (const p of plots) p.gy = groundAt(p.x, p.y, p.cells);
  for (const h of houses) h.gy = groundAt(h.x, h.y, h.cells);

  // --- décor + emplacements des héros --------------------------------------
  const decor: TownDecor[] = [];
  const heroSlots: { x: number; y: number; lvl: number }[] = [];
  const DECOR = ["tree-green", "bush-dense", "flowers", "grass-tuft", "daisy", "fern"];
  const CLUTTER = ["street-cart", "street-stall", "street-furniture"];
  const occupied = new Set<string>();
  for (const h of houses) occupied.add(`${Math.round(h.x)},${Math.round(h.y)}`);
  for (const p of plots) {
    const r = Math.max(1, Math.round(p.cells / 2) - 1);
    const cx = Math.round(p.x), cy = Math.round(p.y);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) occupied.add(`${cx + dx},${cy + dy}`);
  }
  const nearRoad = (x: number, y: number) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isRoad(x + dx, y + dy));

  for (let y = 1; y < LAST; y++) {
    for (let x = 1; x < LAST; x++) {
      const rad = radial(x, y);
      if (rad > PLAIN_EDGE || lvl[y * SIZE + x] < 0) continue;
      if (occupied.has(`${x},${y}`) || isRoad(x, y)) continue;
      const h = hash(x, y);
      const az = downhillAzimuth(x, y);
      // Hors de l'enceinte : la plaine. Quelques bosquets, rien d'urbain.
      if (rad > RAMPART) {
        if (h % 100 < 26) {
          const prop = h % 3 === 0 ? "tree-green" : "grass-tuft";
          decor.push({ x, y, prop, scale: prop === "tree-green" ? 1.4 : 0.9, hmax: prop === "tree-green" ? 3.4 : undefined, gy: groundAt(x, y) });
        }
        continue;
      }
      // Le replat du sommet reste NU : la grande salle doit y être seule.
      if (rad < SUMMIT_FREE) continue;
      if (nearRoad(x, y) && h % 100 < 20) {
        decor.push({ x, y, prop: "pine", scale: 1.1, hmax: 4.2, gy: groundAt(x, y) });
        continue;
      }
      if (nearRoad(x, y)) {
        if (h % 100 < 44) {
          decor.push({ x, y, prop: CLUTTER[(h >>> 6) % CLUTTER.length], scale: 0.95, hmax: 1.7, rot: az, gy: groundAt(x, y) });
          continue;
        }
        if (h % 100 < 66) {
          // Clôtures : un module = une cellule, donc deux cellules voisines
          // donnent un linéaire continu ; matière tirée par ÎLOT.
          decor.push({
            x, y, prop: "fence", variant: hash(Math.floor(x / 4) + 1, Math.floor(y / 4) + 2) % 3,
            scale: 1.02, hmax: 0.8, rot: az + Math.PI / 2, gy: groundAt(x, y),
          });
          continue;
        }
      }
      if (h % 100 < 46) {
        const prop = DECOR[(h >>> 3) % DECOR.length];
        const big = prop === "tree-green";
        decor.push({ x, y, prop, scale: big ? 1.3 : 0.85, hmax: big ? 3.2 : undefined, gy: groundAt(x, y) });
      } else {
        heroSlots.push({ x, y, lvl: groundAt(x, y) });
      }
    }
  }
  // Les héros se rassemblent devant la grande salle : les cases hautes d'abord.
  heroSlots.sort((a, b) => radial(a.x, a.y) - radial(b.x, b.y));

  return {
    size: SIZE,
    groundLevel: GROUND,
    terrain,
    blocks: [...blocks],
    plots,
    houses,
    decor,
    heroSlots,
    center: CENTRE,
  };
}


/** Props de décor à précharger, en plus des `bld-*`. `house` = les 3 maisons. */
export const TOWN_DECOR_PROPS = [
  "tree-green", "bush-dense", "flowers", "grass-tuft", "daisy", "fern", "pine",
  "house", "house2", "house3",
  "street-cart", "street-stall", "street-furniture", "fence",
];

// --- pont vers le rendu 2D « Classique » ------------------------------------
// Le mode de secours (components/TownMap.tsx) dessine un `MapDoc` de l'éditeur.
// Plutôt que de lui laisser l'ancienne carte d'auteur — qui n'avait que 8
// bâtiments sur un plateau de grès —, on lui fabrique le MÊME plan que la vue
// voxel. Une seule source de vérité pour la ville, deux rendus.

/** Sprite de l'éditeur pour un bâtiment. `recyclerie` n'a pas d'art dédié. */
export const BUILDING_SPRITE: Record<string, string> = {
  townhall: "townhall",
  bank: "bank",
  workshop: "workshop",
  kitchen: "kitchen",
  recyclerie: "bld-warehouse",
  well: "well",
  panel: "panel",
  gate: "gate",
  tower: "tower",
  wall: "wall",
};

/** Sprite → id de bâtiment (l'inverse, pour les hotspots du rendu 2D). */
export const SPRITE_TO_BUILDING: Record<string, string> = Object.fromEntries(
  Object.entries(BUILDING_SPRITE).map(([bid, file]) => [file, bid]),
);

type DocCell = { blocks: ({ cat: string; file: string } | null)[]; height: number };
type DocPlacement = {
  id: string;
  cx: number;
  cy: number;
  asset: { cat: string; file: string };
  scale?: number;
};

/**
 * Le plan du village au format `MapDoc` de l'éditeur, pour le renderer 2D.
 * Les segments de muraille sont laissés de côté : le sprite iso `wall` ne se
 * raccorde pas proprement en 2D et une cinquantaine de copies écraserait le
 * dessin. La muraille reste représentée par le sol de pierre du pourtour.
 */
export function townDoc(): {
  version: number;
  gridW: number;
  gridH: number;
  cells: DocCell[];
  layers: { id: string; name: string; kind: "ground" | "object"; visible: boolean; placements: DocPlacement[] }[];
} {
  const l = buildTownLayout();
  const cells: DocCell[] = Array.from({ length: l.size * l.size }, () => ({ blocks: [], height: 0 }));
  for (const t of l.terrain) {
    const c = cells[t.y * l.size + t.x];
    while (c.blocks.length <= t.level) c.blocks.push(null);
    c.blocks[t.level] = { cat: "isotiles", file: t.block };
    c.height = Math.max(c.height, t.level);
  }

  const placements: DocPlacement[] = [];
  // ⚠ COORDONNÉES ENTIÈRES OBLIGATOIRES. Le renderer 2D range les placements
  // dans un seau par cellule (`isoRender.ts` : clé `"${cx},${cy}"`) et les
  // ressort en parcourant les cellules, donc avec des entiers. Une coordonnée
  // fractionnaire — et le plan en produit désormais partout (implantation
  // organique des parcelles, décalage des maisons) — ne retombe JAMAIS sur une
  // clé existante : l'objet n'est simplement jamais dessiné. C'est ce qui avait
  // vidé la ville de tous ses bâtiments en mode « Classique ». Le sub-pixel est
  // un raffinement de la vue voxel ; ici on arrondit.
  //
  // Les maisons passent en premier : le renderer respecte l'ordre de la liste
  // dans une même cellule, et un toit de maison ne doit pas couvrir un bâtiment
  // cliquable. Sprites iso équivalents aux trois modèles voxel.
  const HOUSE_SPRITE: Record<string, string[]> = {
    house: ["bld-cottage", "bld-house", "bld-house-blue"],
    house2: ["bld-barn", "bld-market", "bld-house-large"],
    house3: ["bld-logcabin", "bld-roundhouse", "bld-house-stone"],
  };
  for (const [i, h] of l.houses.entries()) {
    placements.push({
      id: `house-${i}`,
      cx: Math.round(h.x),
      cy: Math.round(h.y),
      asset: { cat: "buildings", file: (HOUSE_SPRITE[h.prop] ?? HOUSE_SPRITE.house)[h.variant % 3] },
      scale: h.cells / 2.6,
    });
  }
  for (const p of l.plots) {
    if (p.bid === "wall") continue;
    const file = BUILDING_SPRITE[p.bid];
    if (!file) continue;
    placements.push({
      id: `plot-${p.bid}`,
      cx: Math.round(p.x),
      cy: Math.round(p.y),
      asset: { cat: "buildings", file },
      scale: p.cells / 2.2, // les sprites iso sont cadrés ~2 tuiles de large
    });
  }

  return {
    version: 1,
    gridW: l.size,
    gridH: l.size,
    cells,
    layers: [
      { id: "sol", name: "Sol", kind: "ground", visible: true, placements: [] },
      { id: "bat", name: "Bâtiments", kind: "object", visible: true, placements },
    ],
  };
}
