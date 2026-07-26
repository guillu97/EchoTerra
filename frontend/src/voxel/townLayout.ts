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
};

export type TownCellItem = { x: number; y: number; level: number; block: string };
export type TownDecor = { x: number; y: number; prop: string; scale: number };

export type TownLayout = {
  size: number;
  /** Niveau sur lequel se posent bâtiments, héros et décor. */
  groundLevel: number;
  terrain: TownCellItem[];
  blocks: string[];
  plots: TownPlot[];
  decor: TownDecor[];
  heroSlots: { x: number; y: number; lvl: number }[];
  center: number;
};

const SIZE = 15; // 15×15 : assez grand pour dix parcelles lisibles, assez petit
const LAST = SIZE - 1; //        pour tenir à l'écran sans dézoomer à outrance.
const GROUND = 2; // deux blocs d'épaisseur → le village repose sur un socle

// Parcelles intérieures. Coordonnées choisies pour que rien ne se chevauche et
// que la silhouette se lise depuis la caméra dimétrique : la Mairie au fond au
// centre (c'est le plus haut), les ateliers en couronne, le puits sur la place.
const INTERIOR: TownPlot[] = [
  { bid: "townhall", x: 7, y: 3, cells: 3.6, primary: true },
  { bid: "bank", x: 3, y: 4, cells: 3.0, primary: true },
  { bid: "workshop", x: 11, y: 4, cells: 3.0, primary: true },
  { bid: "kitchen", x: 3, y: 8, cells: 3.0, primary: true },
  { bid: "recyclerie", x: 11, y: 8, cells: 3.0, primary: true },
  { bid: "well", x: 7, y: 7, cells: 1.9, primary: true },
  { bid: "panel", x: 10, y: 11, cells: 1.7, primary: true },
];

const GATE_X = 7; // portail au milieu de la face avant (y = LAST)
const TOWER_CORNER = { x: LAST, y: 0 }; // tour sur le coin arrière-droit

// Place du village : dallage autour du puits.
const isSquare = (x: number, y: number) => x >= 6 && x <= 8 && y >= 6 && y <= 8;
// Allée du portail vers la place, puis traverse est-ouest.
const isPath = (x: number, y: number) =>
  (x === GATE_X && y >= 6 && y <= LAST - 1) || (y === 7 && x >= 3 && x <= 11);

const isRing = (x: number, y: number) => x === 0 || y === 0 || x === LAST || y === LAST;

export function buildTownLayout(): TownLayout {
  const terrain: TownCellItem[] = [];
  const blocks = new Set<string>();
  const push = (x: number, y: number, level: number, block: string) => {
    terrain.push({ x, y, level, block });
    blocks.add(block);
  };

  const plots: TownPlot[] = [];
  const occupied = new Set<string>();
  const claim = (p: TownPlot) => {
    const r = Math.ceil(p.cells / 2);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) occupied.add(`${p.x + dx},${p.y + dy}`);
    plots.push(p);
  };

  // --- muraille : un segment par cellule du pourtour ------------------------
  // La muraille est UN bâtiment côté serveur (une durabilité, une pastille) mais
  // plusieurs dizaines de segments à l'écran. Les segments des faces gauche et
  // droite pivotent d'un quart de tour pour se raccorder aux coins.
  // Un segment TOUS LES DEUX pas, large de deux cellules : un segment par
  // cellule donnait une rangée de petites pierres isolées plutôt qu'un rempart.
  for (let i = 0; i <= LAST; i += 2) {
    for (const [x, y, rot] of [
      [i, 0, 0],
      [i, LAST, 0],
      [0, i, Math.PI / 2],
      [LAST, i, Math.PI / 2],
    ] as const) {
      if (Math.abs(x - GATE_X) <= 1 && y === LAST) continue; // l'ouverture du portail
      if (Math.abs(x - TOWER_CORNER.x) <= 1 && Math.abs(y - TOWER_CORNER.y) <= 1) continue; // la tour
      // 2.1 plutôt que 2 : les segments se recouvrent d'un cheveu, sinon un
      // liseré de fond apparaît entre eux à certains zooms.
      plots.push({ bid: "wall", x, y, cells: 2.1, rot });
    }
  }
  // Une seule pastille pour toute la muraille, posée au milieu de la face avant
  // gauche (bien visible, à l'écart du portail).
  const wallLabel = plots.find((p) => p.bid === "wall" && p.x === 0 && p.y === 10)
    ?? plots.find((p) => p.bid === "wall");
  if (wallLabel) wallLabel.primary = true;

  claim({ bid: "gate", x: GATE_X, y: LAST, cells: 2.6, primary: true });
  claim({ bid: "tower", x: TOWER_CORNER.x, y: TOWER_CORNER.y, cells: 2.6, primary: true });
  for (const p of INTERIOR) claim(p);

  // Emprise en terre battue sous chaque parcelle intérieure : invisible sous un
  // bâtiment construit, elle matérialise la PARCELLE RÉSERVÉE tant que le site
  // n'est pas lancé — sinon un site non commencé est un carré d'herbe anonyme.
  const plotGround = new Set<string>();
  for (const p of INTERIOR) {
    const r = Math.floor(p.cells / 2);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) plotGround.add(`${p.x + dx},${p.y + dy}`);
  }

  // --- sol ------------------------------------------------------------------
  for (let y = 0; y <= LAST; y++) {
    for (let x = 0; x <= LAST; x++) {
      push(x, y, 0, "dirt"); // socle
      const surface = isRing(x, y)
        ? "stone"
        : isSquare(x, y) || isPath(x, y)
          ? "cobblestone"
          : plotGround.has(`${x},${y}`)
            ? "dirt"
            : "grass";
      push(x, y, 1, surface);
    }
  }

  // --- décor + emplacements des héros --------------------------------------
  // Déterministe (pas de Math.random : le rendu doit être identique d'une session
  // à l'autre, et `Math.random` est de toute façon proscrit dans les scripts).
  const decor: TownDecor[] = [];
  const heroSlots: { x: number; y: number; lvl: number }[] = [];
  const hash = (x: number, y: number) => {
    let n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    n = (n ^ (n >>> 13)) >>> 0;
    return (n * 1274126177) >>> 0;
  };
  const DECOR = ["tree-green", "bush-dense", "flowers", "grass-tuft", "daisy", "fern"];
  for (let y = 1; y < LAST; y++) {
    for (let x = 1; x < LAST; x++) {
      if (occupied.has(`${x},${y}`) || isPath(x, y) || isSquare(x, y)) continue;
      const h = hash(x, y);
      // ~1 cellule libre sur 4 reçoit un prop ; le reste accueille les héros.
      if (h % 100 < 26) {
        const prop = DECOR[h % DECOR.length];
        const big = prop === "tree-green";
        decor.push({ x, y, prop, scale: big ? 1.5 : 0.9 });
      } else {
        heroSlots.push({ x, y, lvl: GROUND });
      }
    }
  }
  // Les héros se rassemblent volontiers sur la place : on met ces cases en tête.
  heroSlots.sort((a, b) => {
    const c = (SIZE - 1) / 2;
    const da = Math.abs(a.x - c) + Math.abs(a.y - 8);
    const db = Math.abs(b.x - c) + Math.abs(b.y - 8);
    return da - db;
  });

  return {
    size: SIZE,
    groundLevel: GROUND,
    terrain,
    blocks: [...blocks],
    plots,
    decor,
    heroSlots,
    center: (SIZE - 1) / 2,
  };
}

/** Props de décor à précharger, en plus des `bld-*`. */
export const TOWN_DECOR_PROPS = ["tree-green", "bush-dense", "flowers", "grass-tuft", "daisy", "fern"];
