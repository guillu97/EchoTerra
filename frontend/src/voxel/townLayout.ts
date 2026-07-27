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

// 19×19. À 15 les parcelles se touchaient presque et le bourg paraissait
// riquiqui dans le cadre ; à 19 il y a de la rue entre les bâtiments, de la
// place pour le décor, et la ville remplit l'écran (le cadrage est resserré en
// conséquence, sinon agrandir la grille ne fait que rapetisser les bâtiments).
const SIZE = 19;
const LAST = SIZE - 1;
const GROUND = 2; // deux blocs d'épaisseur → le village repose sur un socle

// Parcelles intérieures. Coordonnées choisies pour que rien ne se chevauche et
// que la silhouette se lise depuis la caméra dimétrique : la Mairie au fond au
// centre (c'est le plus haut), les ateliers en couronne, le puits sur la place.
const INTERIOR: TownPlot[] = [
  { bid: "townhall", x: 9, y: 4, cells: 4.4, primary: true },
  { bid: "bank", x: 4, y: 5, cells: 3.6, primary: true },
  { bid: "workshop", x: 14, y: 5, cells: 3.6, primary: true },
  { bid: "kitchen", x: 4, y: 11, cells: 3.6, primary: true },
  { bid: "recyclerie", x: 14, y: 11, cells: 3.6, primary: true },
  { bid: "well", x: 9, y: 9, cells: 2.3, primary: true },
  { bid: "panel", x: 13, y: 15, cells: 2.1, primary: true },
];

const GATE_X = 9; // portail au milieu de la face avant (y = LAST)
const TOWER_CORNER = { x: LAST, y: 0 }; // tour sur le coin arrière-droit

// Place du village : dallage autour du puits.
const isSquare = (x: number, y: number) => x >= 8 && x <= 10 && y >= 8 && y <= 10;
// Allée du portail vers la place, puis traverse est-ouest.
const isPath = (x: number, y: number) =>
  (x === GATE_X && y >= 8 && y <= LAST - 1) || (y === 9 && x >= 4 && x <= 14);

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

  claim({ bid: "gate", x: GATE_X, y: LAST, cells: 3.2, primary: true });
  claim({ bid: "tower", x: TOWER_CORNER.x, y: TOWER_CORNER.y, cells: 3.2, primary: true });
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
      // ~1 cellule libre sur 7 reçoit un prop. À 26 % sur une grille de 15 ça
      // passait ; sur 19 il y a bien plus de cellules libres et la ville
      // disparaissait sous la végétation. Les arbres sont aussi rabaissés : à
      // 1.5 cellule ils dépassaient les bâtiments et masquaient les parcelles.
      if (h % 100 < 14) {
        const prop = DECOR[h % DECOR.length];
        const big = prop === "tree-green";
        decor.push({ x, y, prop, scale: big ? 1.15 : 0.8 });
      } else {
        heroSlots.push({ x, y, lvl: GROUND });
      }
    }
  }
  // Les héros se rassemblent volontiers sur la place : on met ces cases en tête.
  heroSlots.sort((a, b) => {
    const c = (SIZE - 1) / 2;
    const da = Math.abs(a.x - c) + Math.abs(a.y - 11);
    const db = Math.abs(b.x - c) + Math.abs(b.y - 11);
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
  for (const p of l.plots) {
    if (p.bid === "wall") continue;
    const file = BUILDING_SPRITE[p.bid];
    if (!file) continue;
    placements.push({
      id: `plot-${p.bid}`,
      cx: p.x,
      cy: p.y,
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
