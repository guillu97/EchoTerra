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

/** Sols de la ville, en codes de « biome » compris par SmoothTerrain. */
export const SOIL = { GRASS: 6, DIRT: 7, PLAIN: 8, PAVED: 9 } as const;
/** Une cellule du terrain : sol + hauteur de palier. */
export type TownField = { biome: number; height: number; discovered: true };
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
  /** Champ de terrain (SIZE×SIZE, ligne par ligne) — rendu en colonnes fines
   *  par `SmoothTerrain`, plus en cubes d'une tuile. */
  field: TownField[];
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
/** Paliers du pied au sommet.
 *  À 4, la butte était un MESA : quatre terrasses très larges, un sommet plat
 *  immense, une silhouette de gâteau. Les références montrent un dôme qui
 *  DOMINE le bâti. À 6 paliers pour le même rayon, chaque marche ne fait plus
 *  que ~1,6 cellule de large, la pente se lit comme continue, et la butte monte
 *  à deux fois la hauteur d'une maison. ⚠ au-delà, la pente dépasse une marche
 *  par cellule au pied et l'adoucissement recreuse le talus. */
const HILL = 6;
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
const PLAIN_EDGE = 1.14;
const onGround = (x: number, y: number) => radial(x, y) <= PLAIN_EDGE;
/** Ligne de l'enceinte. */
const RAMPART = 1.0;

/**
 * Point du CONTOUR `radial(...) === target` le long du rayon paramétrique `a`.
 *
 * ⚠ Indispensable : `radial()` applique un lobage de ±23 %, donc un point posé
 * sur l'ellipse GÉOMÉTRIQUE (k = 1) a un rayon LOBÉ compris entre 0,77 et 1,24.
 * Le portail et les pans de palissade y étaient posés tels quels : là où le lobe
 * pousse vers l'extérieur, ils tombaient au-delà de `PLAIN_EDGE`, c'est-à-dire
 * hors du terrain — la porte VOLAIT littéralement dans les airs. Une bissection
 * sur k les recale sur le contour réel.
 */
function contourPoint(a: number, target: number): { x: number; y: number } {
  let lo = 0.2, hi = 2.4;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (radial(CENTRE + mid * RX * Math.cos(a), CENTRE + mid * RY * Math.sin(a)) < target) lo = mid;
    else hi = mid;
  }
  const k = (lo + hi) / 2;
  return { x: CENTRE + k * RX * Math.cos(a), y: CENTRE + k * RY * Math.sin(a) };
}

/**
 * Hauteur du tertre. Fonction du seul rayon, donc strictement décroissante du
 * sommet vers le pied : aucune cuvette, aucune plaque isolée n'est possible.
 * Un palier tous les ~2,4 cellules → toutes les marches valent 1.
 */
const SUMMIT_FLAT = 0.17; // replat sommital : juste l'assise de la salle
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
// 0,85 tour, pas 1,15 : au-delà la route fait le tour complet du tertre et
// souligne chaque courbe de niveau au lieu de le gravir. Sur les dioramas elle
// monte d'un seul côté, en deux ou trois lacets.
const ROAD_TURNS = 0.85 * Math.PI * 2;
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
  // La Poste occupe le secteur resté vide entre la Banque (28°) et la
  // Recyclerie (112°) — un relais se pose au bord de la route, pas au sommet.
  { bid: "poste", r: 0.64, deg: 70, cells: 3.2 },
  // LES CINQ BÂTIMENTS DE SPÉCIALITÉ (backend design.go) : placés PLUS BAS sur la
  // pente que le noyau civique, dans les secteurs restés vides. Ce sont des annexes,
  // pas le cœur du bourg — et aucune ville ne les aura tous, donc leurs parcelles sont
  // le plus souvent des chantiers ou de l'herbe nue.
  { bid: "infirmerie", r: 0.74, deg: 154, cells: 3.4 },
  { bid: "cartographe", r: 0.74, deg: 236, cells: 3.0 },
  { bid: "caserne", r: 0.78, deg: 278, cells: 3.6 },
  { bid: "armurerie", r: 0.78, deg: 350, cells: 3.4 },
  { bid: "verger", r: 0.80, deg: 92, cells: 3.2 },
];

/**
 * MODÈLE VOXEL utilisé pour une parcelle. Par défaut `bld-<id>`.
 *
 * ⚠ ART PROVISOIRE : les cinq bâtiments de spécialité n'ont pas encore leur propre
 * modèle (`scripts/voxel/` les génère par recette, ce qui reste à faire). Ils
 * EMPRUNTENT donc celui d'un voisin plausible. Sans cette table le rendu ferait
 * `if (!geom) continue` et le bâtiment serait INVISIBLE — donc impossible à cliquer,
 * alors qu'il est bel et bien construit et qu'il agit.
 */
const BLD_MODEL: Record<string, string> = {
  infirmerie: "bld-townhall",
  cartographe: "bld-panel",
  armurerie: "bld-workshop",
  caserne: "bld-tower",
  verger: "bld-kitchen",
};

/** Clé du modèle voxel d'un bâtiment (emprunt compris, cf. BLD_MODEL). */
export const buildingModelKey = (bid: string): string => BLD_MODEL[bid] ?? `bld-${bid}`;

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
/** Largeur de l'ouverture réservée au portail, en cellules d'ARC. */
const GATE_OPENING = 2.9; // < largeur du portail : les pans mordent dedans

/**
 * Positions des segments de palissade, réparties par LONGUEUR D'ARC.
 *
 * ⚠ Elles l'étaient par angle paramétrique (16 pas de 2π/16), ce qui est faux
 * sur une ellipse : l'arc parcouru par pas vaut `√(RX²sin²a + RY²cos²a)·Δa`,
 * soit 3,85 cellules près des extrémités du grand axe mais 4,48 aux pôles —
 * au-delà de la longueur du segment (4,4). Il s'ouvrait donc des JOURS dans la
 * palissade, précisément là où se trouve le portail.
 *
 * On tabule l'arc cumulé, on réserve l'ouverture du portail, et on pave le
 * reste à pas constant : les deux pans viennent buter exactement de part et
 * d'autre de l'ouverture, et le recouvrement est uniforme partout.
 */
function palisadeAngles(): { ang: number }[] {
  const N = 1440;
  const arc = new Float64Array(N + 1);
  const at = (i: number) => {
    const pt = contourPoint((i / N) * Math.PI * 2, RAMPART);
    return [pt.x, pt.y];
  };
  for (let i = 1; i <= N; i++) {
    const [x0, y0] = at(i - 1), [x1, y1] = at(i);
    arc[i] = arc[i - 1] + Math.hypot(x1 - x0, y1 - y0);
  }
  const total = arc[N];
  const angleAt = (sTarget: number) => {
    let s = sTarget % total;
    if (s < 0) s += total;
    let lo = 0, hi = N;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arc[mid] <= s) lo = mid; else hi = mid; }
    const t = (s - arc[lo]) / Math.max(1e-9, arc[hi] - arc[lo]);
    return ((lo + t) / N) * Math.PI * 2;
  };
  // arc du portail (angle → arc, par recherche linéaire grossière puis affinage)
  let gateS = 0, best = Infinity;
  for (let i = 0; i <= N; i++) {
    const d = Math.abs(((i / N) * Math.PI * 2) - GATE_ANGLE);
    if (d < best) { best = d; gateS = arc[i]; }
  }
  const span = total - GATE_OPENING; // longueur à paver
  const n = Math.max(6, Math.ceil(span / (WALL_SEG * 0.93)));
  const step = span / n;
  const out: { ang: number }[] = [];
  for (let k = 0; k < n; k++) out.push({ ang: angleAt(gateS + GATE_OPENING / 2 + step * (k + 0.5)) });
  return out;
}

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
        // BIAIS DE FLANC. Sur le plan large du film, les maisons couvrent un
        // seul versant et le reste de la butte est une pente d'herbe nue. Une
        // densité constante tout autour donne une couronne — l'inverse de la
        // lecture cherchée.
        const a = Math.atan2((y - CENTRE) / RY, (x - CENTRE) / RX);
        const face = 0.32 + 0.68 * Math.max(0, Math.cos(a - 2.0));
        if (h % 100 >= admit[pass] * face) continue;
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

  // TERRASSE PLATE sous chaque emprise, au niveau de SA cellule centrale.
  //
  // ⚠ C'était un creusement au MINIMUM de l'emprise. Sur un terrain rendu en
  // gros cubes d'une tuile, ça passait ; depuis que le tertre est rastérisé en
  // colonnes fines, la pente varie continûment et le minimum d'une emprise de
  // 3,6 cellules tombe jusqu'à ~1,8 unité sous son centre : les bâtiments se
  // retrouvaient ENTERRÉS jusqu'à la moitié côté amont.
  //
  // Aplanir au niveau du centre règle les deux symptômes d'un coup : plus rien
  // n'est enterré, et plus rien ne flotte non plus (le portail, posé au pied du
  // rempart entre butte et plaine, prenait le niveau de la plaine et se
  // retrouvait en l'air côté butte). Le redent du pad se rend tout seul comme
  // un mur de soutènement — ce qu'est une plate-forme de maison sur un coteau.
  //
  // Aucun risque d'érosion en cascade, contrairement au creusement au minimum :
  // certaines cellules montent, d'autres descendent, rien ne se propage.
  // ⚠ Chaque emprise s'aplanit au niveau de SA cellule centrale, et rien de
  // plus. Deux variantes essayées et rejetées :
  //   - aplanir au MINIMUM de l'emprise : le minimum d'une emprise de 3,6
  //     cellules tombe ~1,8 unité sous son centre sur la pente, donc les
  //     bâtiments s'enterraient jusqu'à mi-hauteur ;
  //   - ADOPTER le niveau d'une terrasse voisine déjà posée (pour que les
  //     maisons serrées partagent une assise) : ça CHAÎNE. Une terrasse du pied,
  //     à 0, se propageait de voisin en voisin jusqu'au sommet et rabotait toute
  //     la butte.
  // Les emprises voisines se recouvrent donc et s'écrasent partiellement ; c'est
  // la POSE qui s'en accommode, en lisant la hauteur au cœur de l'objet et non
  // sur tout son pourtour (cf. `groundUnder` dans VoxelTownView).
  for (const c of cuts) {
    const cx = Math.round(c.x), cy = Math.round(c.y);
    if (!inside(cx, cy) || lvl[idx(cx, cy)] < 0) continue;
    const v = lvl[idx(cx, cy)];
    const r = Math.max(1, Math.round(c.r));
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (inside(cx + dx, cy + dy) && lvl[idx(cx + dx, cy + dy)] >= 0) lvl[idx(cx + dx, cy + dy)] = v;
  }

  // ⚠ PAS de passe d'adoucissement ici. Elle ne savait que DESCENDRE, donc elle
  // rabotait les terrasses qu'on vient de poser. Une marche de deux paliers au
  // bord d'un pad n'est pas un défaut : le terrain lissé la rend comme un mur,
  // et c'est exactement le mur de soutènement attendu.
  return lvl;
}

export function buildTownLayout(): TownLayout {
  const plots: TownPlot[] = [];
  const road = traceRoad();
  const isRoad = (x: number, y: number) => road.has(`${x},${y}`);

  // --- enceinte : palissade OVALE, segments tangents répartis par ARC -------
  for (const { ang: a } of palisadeAngles()) {
    const { x, y } = contourPoint(a, RAMPART);
    // Tangente au CONTOUR (différence finie sur le contour lobé, pas la tangente
    // analytique de l'ellipse : le lobe la fait tourner). L'axe long du modèle
    // est X, qui part sur (cos θ, −sin θ) — d'où θ = atan2(−ty, tx). Le renderer
    // ajoute π aux parcelles, on le retranche ici.
    const p0 = contourPoint(a - 0.02, RAMPART), p1 = contourPoint(a + 0.02, RAMPART);
    const tx = p1.x - p0.x, ty = p1.y - p0.y;
    plots.push({ bid: "wall", x, y, cells: WALL_SEG, rot: Math.atan2(-ty, tx) - Math.PI });
  }
  const wallLabel = plots.find((p) => p.bid === "wall");
  if (wallLabel) wallLabel.primary = true;

  // portail plein sud, face caméra ; tour de guet sur l'enceinte
  const gateXY = contourPoint(GATE_ANGLE, RAMPART);
  plots.push({ bid: "gate", x: gateXY.x, y: gateXY.y, cells: 3.4, rot: 0, primary: true });
  const towerA = (335 * Math.PI) / 180;
  const towerXY = contourPoint(towerA, RAMPART);
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
  // // Palissade COMPRISE : un pan posé sur la pente du rempart sans terrasse s'enterre.
  const lvl = buildHill(plots.filter((p) => p.cells >= 3).map((p) => ({ x: p.x, y: p.y, r: p.cells / 2 })));
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
  // Un CHAMP (sol + hauteur), pas une pile de cubes : le rendu passe par
  // `SmoothTerrain`, qui rastérise en colonnes de 1/10 de tuile. Les gros blocs
  // d'une tuile faisaient un escalier grossier — c'est tout le point du
  // changement.
  const field: TownField[] = [];
  for (let y = 0; y <= LAST; y++) {
    for (let x = 0; x <= LAST; x++) {
      const lv = Math.max(0, lvl[y * SIZE + x]);
      const rad = radial(x, y);
      const biome = isRoad(x, y)
        ? SOIL.DIRT // la route en lacet
        : rad > RAMPART
          ? SOIL.PLAIN // la plaine sèche, jusqu'au bord du monde
          : rad < SUMMIT_FREE
            ? SOIL.PAVED // l'esplanade de la grande salle
            : plotGround.has(`${x},${y}`)
              ? SOIL.DIRT
              : SOIL.GRASS;
      field.push({ biome, height: lv, discovered: true });
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
    field,
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
