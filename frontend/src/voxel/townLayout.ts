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

// 21×21. Historique : 15 (parcelles jointives, bourg riquiqui) → 19 (de la rue
// entre les bâtiments) → 21. Le dernier cran sert la DENSITÉ : à 19, les dix
// parcelles fonctionnelles et leurs dégagements mangeaient ~250 des 289
// cellules intérieures, et il ne restait de place que pour 14 maisons de
// remplissage — dont la moitié collée au rempart, donc masquée par lui. Deux
// anneaux de plus rendent un vrai tissu bâti possible. Le cadrage suit, sinon
// agrandir la grille ne fait que rapetisser les bâtiments.
const SIZE = 21;
const LAST = SIZE - 1;
const CENTRE = (SIZE - 1) / 2;
const GROUND = 1; // socle d'un bloc : à deux, la tranche sombre sous la ville
// prenait une bande d'écran pour rien — le relief des terrasses suffit désormais
// à poser le bourg.

// Parcelles intérieures. Coordonnées choisies pour que rien ne se chevauche et
// que la silhouette se lise depuis la caméra dimétrique : la Mairie au fond au
// centre (c'est le plus haut), les ateliers en couronne, le puits sur la place.
// ⚠ Toutes ces positions tiennent compte de la CEINTURE (isPath ci-dessous) :
// aucune emprise ne doit chevaucher la rue, sinon le dallage ressort sous un
// bâtiment. Les dégagements deux à deux sont vérifiés (somme des demi-emprises).
const INTERIOR: TownPlot[] = [
  { bid: "townhall", x: 10, y: 6, cells: 4.4, primary: true }, // fond de place
  { bid: "bank", x: 6, y: 6, cells: 3.6, primary: true }, // îlot nord-ouest
  { bid: "workshop", x: 14, y: 6, cells: 3.6, primary: true }, // îlot nord-est
  { bid: "kitchen", x: 6, y: 15, cells: 3.6, primary: true }, // îlot sud-ouest
  { bid: "recyclerie", x: 14, y: 15, cells: 3.6, primary: true }, // îlot sud-est
  { bid: "well", x: 10, y: 10, cells: 2.3, primary: true }, // au centre de la place
  { bid: "panel", x: 7, y: 12, cells: 2.1, primary: true }, // à l'angle de la place
];

const GATE_X = CENTRE; // portail au milieu de la face avant (y = LAST)
const GATE_HALF = 1.7; // demi-ouverture, en cellules
const TOWER_CORNER = { x: LAST, y: 0 }; // tour sur le coin arrière-droit

// RAMPART (corrigé 2026-07-28).
//
// `bld-wall` est un BANDEAU : long de ~17,5 cellules dans sa grille pour 7,2 de
// haut. Le modèle est mis à l'échelle sur son emprise au SOL — donc sur sa
// longueur. À 2,1 cellules de long (la valeur d'origine, choisie pour poser un
// segment toutes les 2 cases), sa hauteur tombait mécaniquement à **0,9
// cellule** : une bordure de jardin autour d'un bourg dont les maisons font
// 3 cellules de haut. Ça ne se lisait pas comme une fortification, et ça
// expliquait le liseré de cailloux gris qui cernait la ville.
//
// Le segment mesure 5 cellules de long, ce qui lui donne ~2,2 de haut : assez
// pour dominer les maisons (3 cellules avec leur toit… non : elles montent à
// 3,1, donc le rempart arrive à leur gouttière) sans manger la vue. Essayé à
// 8,3 (≈3,7 de haut) : en projection dimétrique le pan avant occultait le tiers
// du bourg — une fortification ne doit pas cacher ce qu'elle protège.
const WALL_SEG = 5;

/**
 * Centres des segments pavant `[a, b]`. Le pas est plus court que le segment,
 * donc les pans se RECOUVRENT : un jour entre deux se voit immédiatement.
 */
const tileWall = (a: number, b: number): number[] => {
  const n = Math.max(1, Math.ceil((b - a) / WALL_SEG));
  const step = (b - a) / n;
  return Array.from({ length: n }, (_, k) => a + step * (k + 0.5));
};

// --- HIÉRARCHIE DES VOIES ----------------------------------------------------
//
// Une ville ne se lit pas à ses bâtiments mais à son RÉSEAU : une place, une
// avenue qui y mène depuis la porte, des rues de desserte, des ruelles de terre
// entre les fonds de parcelle. Toutes les voies au même gabarit et au même
// pavage, c'était un damier — l'inverse de l'effet cherché.
//
// Quatre rangs, du plus large au plus étroit, chacun avec SON matériau :
//   place  5×5 pavée     — le cœur, autour du puits
//   avenue 3 de large    — de la porte à la place, pavée (l'axe d'arrivée)
//   ceinture + traverse  — 1 et 2 de large, calcaire clair (desserte)
//   ruelles              — 1 de large, terre battue (fonds de parcelle)
const RING_ST = 3; // distance de la ceinture au rempart
const SQUARE_R = 2; // demi-côté de la place (5×5)
const ALLEY_AT = [6, LAST - 6]; // abscisses/ordonnées des ruelles transversales

const isSquare = (x: number, y: number) =>
  Math.abs(x - CENTRE) <= SQUARE_R && Math.abs(y - CENTRE) <= SQUARE_R;
/** Avenue d'arrivée : 3 cellules de large, de la place au portail. */
const isAvenue = (x: number, y: number) =>
  Math.abs(x - GATE_X) <= 1 && y >= CENTRE + SQUARE_R && y <= LAST - 1;
/** Desserte : ceinture intérieure + traverse est-ouest (2 de large). */
const isLane = (x: number, y: number) =>
  ((x === RING_ST || x === LAST - RING_ST) && y >= RING_ST && y <= LAST - RING_ST) ||
  ((y === RING_ST || y === LAST - RING_ST) && x >= RING_ST && x <= LAST - RING_ST) ||
  ((y === CENTRE - 1 || y === CENTRE) && x >= RING_ST && x <= LAST - RING_ST);
/** Ruelles de terre : elles traversent la bande entre la ceinture et le rempart
 *  et coupent la rangée de maisons du pourtour en îlots. Sans elles, cette
 *  bande fait un ruban continu de toits tout autour du bourg. */
const isAlley = (x: number, y: number) =>
  (ALLEY_AT.includes(x) && ((y >= 1 && y <= RING_ST) || (y >= LAST - RING_ST && y <= LAST - 1))) ||
  (ALLEY_AT.includes(y) && ((x >= 1 && x <= RING_ST) || (x >= LAST - RING_ST && x <= LAST - 1)));

const isPath = (x: number, y: number) => isAvenue(x, y) || isLane(x, y) || isAlley(x, y);

/**
 * Azimut pour qu'une FAÇADE regarde la voie la plus proche.
 *
 * Les modèles ont leur porte du côté −Z (petits y du gabarit) ; une rotation θ
 * autour de Y envoie (0,0,−1) sur (−sin θ, −cos θ), d'où `atan2(−dx, −dy)`.
 * Sans ça les maisons prenaient une orientation au quart de tour tirée au sort :
 * on voyait des pignons aveugles donner sur la place et des portes s'ouvrir sur
 * un mur. Une ville, ce sont des façades qui regardent la rue.
 */
const faceStreet = (x: number, y: number): number | null => {
  let bx = 0, by = 0, bd = Infinity;
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      if (!dx && !dy) continue;
      if (!isPath(x + dx, y + dy) && !isSquare(x + dx, y + dy)) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bx = dx; by = dy; }
    }
  return bd === Infinity ? null : Math.atan2(-bx, -by);
};

const isRing = (x: number, y: number) => x === 0 || y === 0 || x === LAST || y === LAST;

// Hachage déterministe (pas de Math.random : le bourg doit être identique d'une
// session à l'autre, et d'un joueur à l'autre).
// ⚠ `Math.imul`, pas `*` : `n * 1274126177` dépasse 2^53 et l'arrondi flottant
// DÉTRUIT les bits de poids faible — précisément ceux que `>>> 0` conserve. Le
// tirage du modèle de maison (`% 9`) tombait de ce fait toujours dans le même
// tiers du catalogue : trois modèles sur neuf n'apparaissaient jamais.
const hash = (x: number, y: number) => {
  let n = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
  n = (n ^ (n >>> 13)) >>> 0;
  return Math.imul(n, 1274126177) >>> 0;
};

// IMPLANTATION ORGANIQUE (2026-07-28).
//
// Sur les références, deux bâtiments voisins ne sont jamais parallèles ni
// alignés au cordeau : les faîtes partent de quelques degrés de travers et les
// façades avancent ou reculent d'un demi-pas. Nos parcelles étaient posées à la
// cellule pile, toutes à la même orientation — ça se lisait comme un plan
// d'urbanisme, pas comme un bourg qui a poussé.
//
// Le décalage reste FAIBLE (±7,5° et ±0,22 cellule) : au-delà, les emprises se
// chevauchent et les pastilles DOM se marchent dessus. Muraille, portail et
// tour en sont exclus — eux DOIVENT rester d'équerre, c'est une fortification.
const organic = (p: TownPlot): TownPlot => {
  const h = hash(p.x * 3 + 1, p.y * 5 + 2);
  return {
    ...p,
    x: p.x + (((h >>> 8) % 1000) / 1000 - 0.5) * 0.44,
    y: p.y + (((h >>> 18) % 1000) / 1000 - 0.5) * 0.44,
    rot: (p.rot ?? 0) + ((h % 1000) / 1000 - 0.5) * 0.26,
  };
};

// --- maisons de remplissage --------------------------------------------------
// Le bourg comptait dix bâtiments espacés sur une pelouse. Ce qui manquait
// n'était pas la taille (elle a déjà été portée à 19×19) mais la DENSITÉ : dans
// la référence, les bâtiments remarquables ne se détachent que parce qu'ils
// dépassent d'un tissu de toits serrés. Ces maisons n'ont aucun rôle de jeu et
// ne sont pas cliquables — elles remplissent les îlots laissés libres.
// NEUF modèles. Trois ne suffisaient pas : à vingt exemplaires, le même volume
// répété fait motif quelle que soit l'orientation. `cells` est l'emprise au SOL
// visée — elle est calibrée MODÈLE PAR MODÈLE d'après le rapport hauteur/largeur
// mesuré du `.vox`, parce que `fitScale` met à l'échelle sur l'emprise : donner
// la même valeur à tous écraserait la grange (large et basse) et rabougrirait la
// maison étroite. Les hauteurs obtenues s'échelonnent de 1,5 (remise) à 3,7
// (maison de ville à balcon) — c'est cette irrégularité qui fait un tissu.
// ⚠ ORDRE VOLONTAIRE : la reprise ci-dessous essaie les modèles SUIVANTS quand
// le tiré au sort ne rentre pas, donc un grand modèle déverse ses refus sur son
// voisin de droite. Rangés par taille, le plus petit récupérait tout : la maison
// étroite faisait 9 exemplaires sur 25. Les gabarits sont donc entrelacés.
const HOUSE_MODELS: { prop: string; variant: number; cells: number }[] = [
  { prop: "house", variant: 0, cells: 2.6 }, // chaumière, toit de chaume
  { prop: "house2", variant: 0, cells: 3.8 }, // grange longue et basse
  { prop: "house3", variant: 0, cells: 2.6 }, // remise en appentis
  { prop: "house", variant: 1, cells: 2.6 }, // maison à étage en encorbellement
  { prop: "house2", variant: 1, cells: 2.8 }, // échoppe à arcade
  { prop: "house3", variant: 1, cells: 2.8 }, // maison à tourelle
  { prop: "house", variant: 2, cells: 3.0 }, // maison peinte à auvent
  { prop: "house2", variant: 2, cells: 2.4 }, // maison étroite à balcon
  { prop: "house3", variant: 2, cells: 3.0 }, // maison basse à terrasse
];

function placeHouses(plots: TownPlot[]): TownHouse[] {
  const houses: TownHouse[] = [];
  // Dégagement EUCLIDIEN, pas Chebyshev : en Chebyshev une cellule en diagonale
  // compte pour 1 alors qu'elle est à 1,41, et on perdait tout un anneau de
  // parcelles constructibles autour de chaque bâtiment.
  const clearOfPlots = (x: number, y: number, r: number) =>
    plots.every((p) => p.bid === "wall" || Math.hypot(x - p.x, y - p.y) >= p.cells / 2 + r - 0.15);
  // Deux maisons se serrent, mais ne s'interpénètrent pas : le seuil suit leurs
  // deux emprises (une grange de 3,8 a besoin de plus d'air qu'une remise).
  const farFromHouses = (x: number, y: number, r: number) =>
    houses.every((h) => Math.hypot(h.x - x, h.y - y) >= (h.cells / 2 + r) * 0.82);
  const onStreet = (x: number, y: number) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isPath(x + dx, y + dy) || isSquare(x + dx, y + dy));
  const nextTo = (x: number, y: number) => houses.some((h) => Math.hypot(h.x - x, h.y - y) < 3.4);

  // Trois passes, dans cet ordre — c'est l'ordre qui fait le tissu :
  //   0. front de RUE : les façades bordent d'abord les voies ;
  //   1. GRAPPE : on s'accroche à une maison déjà posée, ce qui produit des
  //      rangées et des îlots plutôt qu'un semis régulier ;
  //   2. le reste, avec une probabilité basse — quelques fonds de jardin.
  const admit = [84, 64, 28];
  for (const pass of [0, 1, 2]) {
    for (let y = 2; y <= LAST - 2; y++) {
      for (let x = 2; x <= LAST - 2; x++) {
        if (x < 2 || y < 2 || x > LAST - 2 || y > LAST - 2) continue;
        if (isPath(x, y) || isSquare(x, y)) continue;
        if (pass === 0 && !onStreet(x, y)) continue;
        if (pass === 1 && !nextTo(x, y)) continue;
        const h = hash(x * 11 + 7, y * 17 + 3);
        if (h % 100 >= admit[pass]) continue;
        // Le modèle donne l'emprise, donc il se choisit AVANT le test de place.
        // On part du modèle tiré au sort et on essaie les suivants tant que ça
        // ne rentre pas : sinon les grands modèles (la grange fait 3,8) sont
        // rejetés bien plus souvent que les petits, et la parcelle est perdue
        // alors qu'une remise y tenait. Sans cette reprise, la grange et la
        // remise n'apparaissaient quasiment jamais.
        const start = (h >>> 4) % HOUSE_MODELS.length;
        let m: (typeof HOUSE_MODELS)[number] | null = null;
        let cells = 0;
        for (let k = 0; k < HOUSE_MODELS.length; k++) {
          const cand = HOUSE_MODELS[(start + k) % HOUSE_MODELS.length];
          const c = cand.cells * (0.9 + (((h >>> 26) % 100) / 100) * 0.2);
          if (clearOfPlots(x, y, c / 2) && farFromHouses(x, y, c / 2)) { m = cand; cells = c; break; }
        }
        if (!m) continue;
        // Façade sur la rue la plus proche ; si la parcelle ne voit aucune voie
        // (fond de jardin), on retombe sur un quart de tour.
        const face = faceStreet(x, y);
        houses.push({
          x: x + (((h >>> 8) % 1000) / 1000 - 0.5) * 0.5,
          y: y + (((h >>> 18) % 1000) / 1000 - 0.5) * 0.5,
          prop: m.prop,
          variant: m.variant,
          cells,
          rot: (face ?? (h % 4) * (Math.PI / 2)) + (((h % 1000) / 1000 - 0.5) * 0.22),
          gy: 0, // posé plus bas, une fois le relief calculé
        });
      }
    }
  }
  return houses;
}

// --- RELIEF : le bourg est bâti à FLANC DE COTEAU ----------------------------
//
// Le plateau était rigoureusement horizontal, et c'est ce qui le faisait lire
// comme un plateau de jeu plutôt que comme un lieu : tous les toits au même
// niveau, toutes les ombres identiques, aucune ligne d'horizon interne. Aucune
// quantité de maisons ne rattrape ça.
//
// Le terrain monte donc du portail (au sud, en bas) vers la mairie (au nord, en
// haut), en trois paliers. Conséquences voulues : la mairie domine réellement,
// l'avenue GRIMPE vers la place, et les redents entre paliers font des murs de
// soutènement qui découpent le tissu.
//
// Deux contraintes tiennent tout le reste :
//   1. le rempart et son pied restent au niveau 0 — un segment de 5 cellules à
//      cheval sur une marche laisserait un jour sous la muraille ;
//   2. toute emprise bâtie est APLANIE au niveau de son centre, sinon un coin
//      de bâtiment flotte ou s'enfonce.
const TERRACE_MAX = 2;

function buildTerraces(flatten: { x: number; y: number; r: number }[]): number[] {
  const lvl = new Array(SIZE * SIZE).fill(0);
  const idx = (x: number, y: number) => y * SIZE + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x <= LAST && y <= LAST;
  const wallDist = (x: number, y: number) => Math.min(x, y, LAST - x, LAST - y);

  for (let y = 0; y <= LAST; y++)
    for (let x = 0; x <= LAST; x++) {
      if (wallDist(x, y) <= 1) continue; // pied du rempart : plat
      const slope = ((LAST - y) / LAST) * 2.7 - 0.35;
      // Bruit à DEUX échelles. En bruit blanc par cellule, la courbe de niveau
      // part en dents de scie d'une cellule et l'adoucissement la ramène à une
      // droite : on retombe sur des bandes. La composante grossière (une valeur
      // par bloc de 3×3) fait de vrais lobes, la fine casse juste leur bord.
      const coarse = ((hash(Math.floor(x / 3) * 17 + 5, Math.floor(y / 3) * 23 + 9) % 1000) / 1000 - 0.5) * 1.5;
      const fine = ((hash(x * 5 + 3, y * 7 + 11) % 1000) / 1000 - 0.5) * 0.5;
      const noise = coarse + fine;
      lvl[idx(x, y)] = Math.max(0, Math.min(TERRACE_MAX, Math.floor(slope + noise)));
    }

  // Aplanissement des emprises + limitation des marches à 1, en alternance :
  // aplanir crée des marches de 2, adoucir défait l'aplanissement. Trois tours
  // suffisent à converger, et on termine PAR l'aplanissement — c'est lui qui ne
  // doit pas être négociable.
  const flattenPlots = () => {
    for (const f of flatten) {
      const cx = Math.round(f.x), cy = Math.round(f.y);
      if (!inside(cx, cy)) continue;
      const v = lvl[idx(cx, cy)];
      // `round`, pas `ceil` : à `ceil` la mairie aplanissait un plateau de 7×7
      // pour une emprise de 4,4, et chaque maison son carré de 5×5 — le coteau
      // devenait un empilement de terrasses rectangulaires.
      const r = Math.max(1, Math.round(f.r) - 1);
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (inside(cx + dx, cy + dy) && wallDist(cx + dx, cy + dy) > 1) lvl[idx(cx + dx, cy + dy)] = v;
    }
  };
  const soften = () => {
    for (let pass = 0; pass < SIZE; pass++) {
      let changed = false;
      for (let y = 0; y <= LAST; y++)
        for (let x = 0; x <= LAST; x++) {
          let lo = TERRACE_MAX;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
            if (inside(x + dx, y + dy)) lo = Math.min(lo, lvl[idx(x + dx, y + dy)]);
          if (lvl[idx(x, y)] > lo + 1) { lvl[idx(x, y)] = lo + 1; changed = true; }
        }
      if (!changed) break;
    }
  };
  for (let k = 0; k < 3; k++) { soften(); flattenPlots(); }
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
  const occupied = new Set<string>();
  // ⚠ La parcelle porte maintenant des coordonnées FRACTIONNAIRES (implantation
  // organique) : l'emprise réservée se calcule sur la cellule arrondie.
  const claim = (p: TownPlot) => {
    const r = Math.ceil(p.cells / 2);
    const cx = Math.round(p.x), cy = Math.round(p.y);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) occupied.add(`${cx + dx},${cy + dy}`);
    plots.push(p);
  };

  // --- rempart --------------------------------------------------------------
  // La muraille est UN bâtiment côté serveur (une durabilité, une pastille) mais
  // plusieurs segments à l'écran. Les faces gauche et droite pivotent d'un quart
  // de tour pour se raccorder aux coins. La face du portail reçoit deux pans qui
  // viennent buter de part et d'autre de l'ouverture.
  for (const c of tileWall(-0.5, LAST + 0.5)) {
    plots.push({ bid: "wall", x: c, y: 0, cells: WALL_SEG, rot: 0 });
    plots.push({ bid: "wall", x: 0, y: c, cells: WALL_SEG, rot: Math.PI / 2 });
    plots.push({ bid: "wall", x: LAST, y: c, cells: WALL_SEG, rot: Math.PI / 2 });
  }
  // Face du portail : on pave séparément à gauche et à droite de l'ouverture.
  for (const c of [...tileWall(-0.5, GATE_X - GATE_HALF), ...tileWall(GATE_X + GATE_HALF, LAST + 0.5)])
    plots.push({ bid: "wall", x: c, y: LAST, cells: WALL_SEG, rot: 0 });
  // La tour de guet n'INTERROMPT plus le rempart : elle l'enjambe au coin, comme
  // une vraie tour d'angle. L'ancienne exclusion y creusait un trou.
  //
  // Une seule pastille pour tout le rempart, posée au milieu de la face gauche
  // (bien visible, à l'écart du portail).
  const wallLabel = plots.find((p) => p.bid === "wall" && p.x === 0 && p.y === LAST / 2)
    ?? plots.find((p) => p.bid === "wall");
  if (wallLabel) wallLabel.primary = true;

  // Portail et tour restent d'équerre : ils font partie de la fortification.
  claim({ bid: "gate", x: GATE_X, y: LAST, cells: 3.2, primary: true });
  claim({ bid: "tower", x: TOWER_CORNER.x, y: TOWER_CORNER.y, cells: 3.2, primary: true });
  for (const p of INTERIOR) claim(organic(p));

  // Emprise en terre battue sous chaque parcelle intérieure : invisible sous un
  // bâtiment construit, elle matérialise la PARCELLE RÉSERVÉE tant que le site
  // n'est pas lancé — sinon un site non commencé est un carré d'herbe anonyme.
  // ⚠ Serrée sur l'emprise RÉELLE (un anneau de moins qu'avant) : à
  // `floor(cells/2)` la mairie posait un carré de terre de 5×5 pour un bâtiment
  // de 4,4 — le pourtour brun débordait de tous les bâtiments construits et
  // faisait lire le bourg comme un chantier.
  // ⚠ PAS de liseré pavé autour (essayé, retiré) : entre la place, l'avenue, la
  // ceinture, la traverse et sept liserés de parcelle, le sol du bourg était
  // presque intégralement en pierre pâle. Vu de la caméra, ça tirait tout vers
  // le gris — et c'est le vert et la terre qui donnent la vie. La terre battue
  // de la parcelle suffit à la marquer.
  const plotGround = new Set<string>();
  for (const p of INTERIOR) {
    const r = Math.max(0, Math.round(p.cells / 2) - 1);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) plotGround.add(`${p.x + dx},${p.y + dy}`);
  }

  // --- maisons de remplissage ----------------------------------------------
  // Elles se posent AVANT le sol : elles occupent des cellules (ni arbre ni
  // héros ne doit y atterrir) ET leur emprise doit être aplanie par le relief.
  const houses = placeHouses(plots);
  for (const h of houses) occupied.add(`${Math.round(h.x)},${Math.round(h.y)}`);

  // --- relief ---------------------------------------------------------------
  const terr = buildTerraces([
    ...INTERIOR.map((p) => ({ x: p.x, y: p.y, r: p.cells / 2 })),
    { x: GATE_X, y: LAST, r: 1.6 },
    ...houses.map((h) => ({ x: h.x, y: h.y, r: h.cells / 2 })),
  ]);
  const levelAt = (x: number, y: number) => terr[y * SIZE + x] ?? 0;
  /** Hauteur de pose d'un objet, en unités monde (socle + surface du palier). */
  const groundAt = (x: number, y: number) => levelAt(Math.round(x), Math.round(y)) + GROUND;

  // --- sol ------------------------------------------------------------------
  for (let y = 0; y <= LAST; y++) {
    for (let x = 0; x <= LAST; x++) {
      const lv = levelAt(x, y);
      // Le REDENT d'un palier est un mur de soutènement : on le maçonne dès
      // qu'un voisin est plus bas. En terre nue, une marche d'une cellule se
      // lit comme un défaut de terrain, pas comme un ouvrage.
      const exposed = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
        ([dx, dy]) =>
          x + dx >= 0 && y + dy >= 0 && x + dx <= LAST && y + dy <= LAST && levelAt(x + dx, y + dy) < lv,
      );
      for (let k = 0; k <= lv; k++) push(x, y, k, exposed && k === lv ? "limestone" : "dirt");
      // Un matériau PAR RANG de voie : c'est ce qui fait lire la hiérarchie.
      // Tout en cobblestone, la place et une ruelle de fond de jardin avaient
      // exactement le même aspect, donc le réseau ne se voyait pas.
      const surface = isRing(x, y)
        ? "stone"
        : isSquare(x, y) || isAvenue(x, y)
          ? "cobblestone" // cœur + axe d'arrivée
          : isLane(x, y)
            ? "limestone" // desserte, calcaire clair
            : isAlley(x, y)
              ? "dirt" // ruelle de terre battue
              : plotGround.has(`${x},${y}`)
                ? "dirt"
                  : "grass";
      push(x, y, lv + 1, surface);
    }
  }
  for (const p of plots) p.gy = groundAt(p.x, p.y);
  for (const h of houses) h.gy = groundAt(h.x, h.y);

  // --- décor + emplacements des héros --------------------------------------
  // Déterministe (pas de Math.random : le rendu doit être identique d'une session
  // à l'autre, et `Math.random` est de toute façon proscrit dans les scripts).

  const decor: TownDecor[] = [];
  const heroSlots: { x: number; y: number; lvl: number }[] = [];
  const DECOR = ["tree-green", "bush-dense", "flowers", "grass-tuft", "daisy", "fern"];
  const CLUTTER = ["street-cart", "street-stall", "street-furniture"];
  const nearStreet = (x: number, y: number) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isPath(x + dx, y + dy) || isSquare(x + dx, y + dy));
  for (let y = 1; y < LAST; y++) {
    for (let x = 1; x < LAST; x++) {
      if (occupied.has(`${x},${y}`) || isPath(x, y) || isSquare(x, y)) continue;
      const h = hash(x, y);
      // CYPRÈS de bord de rue : dans la référence, ce sont les seuls éléments
      // qui montent franchement au-dessus des toits, et c'est eux qui donnent le
      // rythme vertical d'un bourg méditerranéen. Un pin étroit et haut joue le
      // rôle sans nouvel asset. Il DOIT dépasser les maisons (3,1 cellules) et
      // rester sous la mairie (5,6), qui garde le point haut : d'où un plafond
      // de hauteur explicite plutôt que le plafond par défaut du décor.
      if (nearStreet(x, y) && h % 100 < 22) {
        decor.push({ x, y, prop: "pine", scale: 1.1, hmax: 4.2, gy: groundAt(x, y) });
        continue;
      }
      // MOBILIER DE RUE et CLÔTURES — la trace des gens.
      //
      // Une ville dense mais vide de charrettes, d'étals, de linge et de
      // barrières reste une maquette : les volumes sont justes et rien n'y
      // habite. Ces props ne changent pas la silhouette, ils la peuplent, et
      // ils sont ce qui manquait le plus pour que le bourg soit JOLI et pas
      // seulement correct.
      if (nearStreet(x, y)) {
        const face = faceStreet(x, y) ?? 0;
        if (h % 100 < 44) {
          decor.push({
            x, y, prop: CLUTTER[(h >>> 6) % CLUTTER.length],
            scale: 0.95, hmax: 1.7, rot: face, gy: groundAt(x, y),
          });
          continue;
        }
        // Clôture de limite de parcelle, ALIGNÉE sur la rue : le modèle fait
        // exactement une cellule, donc deux cellules voisines donnent un
        // linéaire continu. La matière est tirée par ÎLOT (hachage grossier) —
        // alterner bois/pierre/haie d'une cellule à l'autre ferait un patchwork.
        if (h % 100 < 66) {
          decor.push({
            x, y, prop: "fence", variant: hash(Math.floor(x / 4) + 1, Math.floor(y / 4) + 2) % 3,
            scale: 1.02, hmax: 0.8, rot: face, gy: groundAt(x, y),
          });
          continue;
        }
      }
      // VÉGÉTATION. Le taux était descendu à 14 % « pour que la ville ne
      // disparaisse pas sous les arbres » — à l'époque où il n'y avait rien
      // d'autre sur les cellules libres. Depuis, les maisons occupent le
      // terrain et c'est le VERT qui manque : sans lui, le bourg n'est qu'une
      // masse de pierre et de tuile. Les fonds de parcelle sont d'ailleurs
      // l'endroit naturel des jardins.
      if (h % 100 < 52) {
        const prop = DECOR[(h >>> 3) % DECOR.length];
        const big = prop === "tree-green";
        decor.push({ x, y, prop, scale: big ? 1.3 : 0.85, hmax: big ? 3.2 : undefined, gy: groundAt(x, y) });
      } else {
        heroSlots.push({ x, y, lvl: groundAt(x, y) });
      }
    }
  }
  // Les héros se rassemblent volontiers sur la place : on met ces cases en tête.
  heroSlots.sort((a, b) => {
    const c = CENTRE;
    const da = Math.abs(a.x - c) + Math.abs(a.y - (CENTRE + 2));
    const db = Math.abs(b.x - c) + Math.abs(b.y - (CENTRE + 2));
    return da - db;
  });

  return {
    size: SIZE,
    groundLevel: GROUND,
    terrain,
    blocks: [...blocks],
    plots,
    houses,
    decor,
    heroSlots,
    center: (SIZE - 1) / 2,
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
