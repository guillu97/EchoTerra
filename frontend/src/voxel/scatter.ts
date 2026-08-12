// Scatter déterministe des props par biome (lot D1 du WORLD-DETAILS-PLAN) +
// repères uniques par seed (lot D2). Module PARTAGÉ carte (VoxelMapView) /
// banc (VoxelBench) : PUR — entrée = tuiles + ville + graine de partie, sortie
// = placements {id, variante, position fractionnaire, rotation, échelle}. Le
// caller pose la hauteur (surface lissée) et compose les matrices — ce module
// n'importe pas THREE.
//
// Règles « près de » (le placement raconte) : une passe voisinage classe chaque
// tuile (bord d'eau, eau calme, pied de falaise, sommet, prairie ouverte) et
// les tables de scatter les ciblent. ⚠ Les tuiles NON DÉCOUVERTES ont un biome
// caviardé à 0 (eau) par le fog serveur : tout test de voisinage exige
// `discovered`, sinon la brume compterait comme un lac.

export const PROP_KEYS = [
  "tree-green", "tree-pink", "rock", "pine", "pine-snow", "grass-tuft", "flowers", "reed",
  "lilypad", "water-rock", "driftwood", "shells", "pebbles", "kelp", "dune-grass", "tallgrass",
  "berry-bush", "daisy", "stump", "mushroom", "fern", "log", "bush-dense", "scree", "crystal",
  "cairn", "dead-tree", "snowdrift", "ice-spike", "frost-tree", "frost-bush",
  "scarecrow", "snowman", "boat", "menhir", "turtle", "beehive",
  "butterfly", "gull", "firefly", "rabbit", "hare", "crab",
  "web", "snow-motes", "eagle",
  "ruin-wall", "ruin-column", "ruin-slab", "ruin-arch",
];

export type ScatterTile = { biome: number; height: number; discovered?: boolean; monsterId?: string };
export type ScatterSource = {
  width: number;
  height: number;
  tiles: ScatterTile[];
  townX: number;
  townY: number;
  /** identifiant stable de la partie (game.id — la seed est masquée par le fog serveur) */
  seedStr: string;
  /** NATURE de l'expédition (backend theme.go). Vide/absent = tempéré. */
  theme?: string;
};
export type PropPlacement = {
  id: string;
  v: number; // variante 0..2
  x: number; // coords monde en tuiles, fractionnaires
  y: number;
  rot: number; // radians autour de l'axe vertical
  scale: number;
  /** vie ambiante (lot D3) : visible seulement le jour / au crépuscule ; absent = toujours */
  phase?: "day" | "night";
};

const GROUND_LEVEL = 3; // même convention que MapScene/VoxelMapView
function relief(t: ScatterTile): number {
  if (t.biome <= 2) return 0;
  return Math.max(0, t.height - GROUND_LEVEL);
}

function h01(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  h = ((h ^ (h >> 13)) * 1274126177) >>> 0;
  return ((h >>> 16) & 0xffff) / 0x10000;
}

function strHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0;
  return h;
}

/** drapeaux de voisinage d'une tuile (8-voisins, les inconnus ne comptent pas) */
type TileFlags = {
  nearWater: boolean; // ≥1 voisin eau découvert
  nearSand: boolean;
  calmWater: boolean; // eau dont TOUS les voisins connus sont de l'eau (loin du bord)
  cliffFoot: boolean; // un voisin domine d'au moins 2 niveaux de relief
  summit: boolean; // plus haut que tous ses voisins découverts (et relief ≥ 2)
  openMeadow: boolean; // prairie sans voisin forêt
};

// LA VÉGÉTATION SUIT LE THÈME (backend theme.go). Le biais de biomes change ce
// qu'il y a autour de la ville ; ces surcharges changent ce qui POUSSE sur les
// biomes que le thème n'a pas déplacés — une lande gelée ne porte pas les mêmes
// arbres qu'une prairie, une steppe aride non plus.
//
// ⚠ On ne remplace que ce qui a une raison de changer, et on ne touche NI aux
// repères de carte NI aux ruines : ce sont des points d'intérêt, pas du décor.
const themeSkin = (theme: string | undefined) => ({
  nordic: theme === "nordique",
  desert: theme === "desertique",
});

export function scatterProps(src: ScatterSource): PropPlacement[] {
  const { width, height, tiles, townX, townY } = src;
  const at = (x: number, y: number): ScatterTile | undefined =>
    x >= 0 && y >= 0 && x < width && y < height ? tiles[y * width + x] : undefined;

  const flagsOf = (x: number, y: number, t: ScatterTile): TileFlags => {
    let nearWater = false, nearSand = false, nearForest = false, cliffFoot = false;
    let allWater = true, higherThanAll = true;
    const myRelief = relief(t);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = at(x + dx, y + dy);
        if (!n || !n.discovered) { allWater = false; continue; }
        if (n.biome === 0) nearWater = true; else allWater = false;
        if (n.biome === 1) nearSand = true;
        if (n.biome === 3) nearForest = true;
        const nr = relief(n);
        if (nr >= myRelief + 2) cliffFoot = true;
        if (nr >= myRelief) higherThanAll = false;
      }
    }
    return {
      nearWater,
      nearSand,
      calmWater: t.biome === 0 && allWater,
      cliffFoot,
      summit: myRelief >= 2 && higherThanAll,
      openMeadow: t.biome === 2 && !nearForest,
    };
  };

  const out: PropPlacement[] = [];
  const plant = (x: number, y: number, id: string, k: number, base: number, phase?: "day" | "night") => {
    out.push({
      id,
      v: Math.floor(h01(x, y, k + 4) * 3),
      x: x + (h01(x, y, k) - 0.5) * 0.7,
      y: y + (h01(x, y, k + 1) - 0.5) * 0.7,
      rot: h01(x, y, k + 3) * Math.PI * 2,
      scale: base * (0.75 + h01(x, y, k + 2) * 0.4),
      ...(phase ? { phase } : {}),
    });
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = tiles[y * width + x];
      if (!t.discovered) continue;
      // enceinte de la ville : la case du temple ET son anneau de 8 voisines
      // restent dégagés (le parvis + la couronne d'oliviers occupent la place)
      if (Math.max(Math.abs(x - townX), Math.abs(y - townY)) <= 1) continue;
      const f = flagsOf(x, y, t);
      const skin = themeSkin(src.theme);
      const h = (s: number) => h01(x, y, s);
      // nappes basse fréquence (hautes herbes de prairie) : cellules 3×3
      const inPatch = h01(Math.floor(x / 3), Math.floor(y / 3), 700) < 0.4;

      if (t.biome === 0) { // eau : nénuphars au calme, rochers émergés, bois flotté aux rives
        if (f.calmWater && h(200) < 0.09) plant(x, y, "lilypad", 205, 0.4);
        if (h(210) < 0.04) plant(x, y, "water-rock", 215, 0.5);
        if (f.nearSand && h(220) < 0.05) plant(x, y, "driftwood", 225, 0.45);
        if (h(600) < 0.03) plant(x, y, "gull", 605, 0.45, "day");
      } else if (t.biome === 1) { // sable : ligne d'eau vivante, dunes sèches
        if (skin.desert) {
          // LES DUNES DU THÈME : saguaros et carcasses, les deux silhouettes qui
          // n'existent nulle part ailleurs (gen-props.mjs, lot 3).
          if (h(231) < 0.10) plant(x, y, "cactus", 236, 0.95);
          if (h(232) < 0.045) plant(x, y, "bones", 237, 0.6);
          if (f.nearWater && h(233) < 0.25) plant(x, y, "palm", 238, 0.6); // l'oasis
        }
        if (h(230) < (f.nearWater ? 0.16 : 0.06)) plant(x, y, "shells", 235, 0.42);
        if (h(240) < 0.07) plant(x, y, "pebbles", 245, 0.45);
        if (f.nearWater && h(250) < 0.06) plant(x, y, "kelp", 255, 0.45);
        if (h(260) < 0.13) plant(x, y, "dune-grass", 265, 0.3);
        if (h(170) < (f.nearWater ? 0.2 : 0.04)) plant(x, y, "reed", 175, 0.38);
        if (h(610) < (f.nearWater ? 0.05 : 0.02)) plant(x, y, "crab", 615, 0.32, "day");
      } else if (t.biome === 2) { // prairie : nappes d'herbes, baies, ponctuation
        const r = h(60);
        if (skin.nordic) {
          // LANDE GELÉE : plus d'arbres en fleurs, des bosquets givrés et des
          // congères qui débordent du névé voisin.
          if (r < 0.05) plant(x, y, "frost-tree", 70, 0.5);
          else if (r < 0.11) plant(x, y, "pine-snow", 80, 0.5);
          if (h(91) < 0.09) plant(x, y, "frost-bush", 96, 0.4);
          if (h(92) < 0.07) plant(x, y, "snowdrift", 97, 0.45);
          if (h(95) < 0.015) plant(x, y, "rune-stone", 102, 0.55); // stèle gravée, rare
        } else if (skin.desert) {
          // STEPPE ARIDE : ce qui reste debout est mort ou épineux.
          if (r < 0.05) plant(x, y, "dead-tree", 70, 0.5);
          else if (r < 0.10) plant(x, y, "olive", 80, 0.5);
          if (h(93) < 0.12) plant(x, y, "dune-grass", 98, 0.32);
          if (h(94) < 0.08) plant(x, y, "brambles", 99, 0.38);
          if (h(95) < 0.05) plant(x, y, "cactus", 101, 0.85);
        } else if (r < 0.06) plant(x, y, "tree-pink", 70, 0.55);
        else if (r < 0.14) plant(x, y, "tree-green", 80, 0.5);
        if (h(90) < 0.05) plant(x, y, "rock", 95, 0.5);
        if (h(120) < 0.55) plant(x, y, "grass-tuft", 125, 0.32);
        const hasFlowers = h(130) < 0.16;
        if (hasFlowers) plant(x, y, "flowers", 135, 0.3);
        if (inPatch && h(270) < 0.45) plant(x, y, "tallgrass", 275, 0.34);
        if (h(280) < 0.06) plant(x, y, "berry-bush", 285, 0.4);
        if (h(290) < (inPatch ? 0.05 : 0.015)) plant(x, y, "daisy", 295, 0.4);
        if (h(300) < 0.02) plant(x, y, "stump", 305, 0.4);
        if (hasFlowers && h(620) < 0.4) plant(x, y, "butterfly", 625, 0.4, "day"); // près des fleurs
        if (!t.monsterId && h(630) < 0.02) plant(x, y, "rabbit", 635, 0.32, "day"); // jamais sur un pack
        // muret en ruine : rares « anciennes fermes » — segments ALIGNÉS le long
        // d'une ligne de la cellule 6×6 (rotation posée, pas hachée)
        const fx = Math.floor(x / 6), fy = Math.floor(y / 6);
        if (h01(fx, fy, 800) < 0.08) {
          const horiz = h01(fx, fy, 801) < 0.5;
          const anchor = 1 + Math.floor(h01(fx, fy, 802) * 4);
          const on = horiz ? y % 6 === anchor : x % 6 === anchor;
          if (on && h(803) < 0.75) {
            out.push({
              id: "ruin-wall", v: Math.floor(h(804) * 3),
              x: x + (h(805) - 0.5) * 0.15, y: y + (h(806) - 0.5) * 0.15,
              rot: horiz ? 0 : Math.PI / 2, scale: 0.5,
            });
          }
        }
      } else if (t.biome === 3) { // forêt : sous-bois dense (lore Dryade)
        if (skin.nordic) {
          // TAÏGA : conifères serrés, sous-bois givré.
          plant(x, y, "pine", 10, 0.62);
          if (h(20) < 0.5) plant(x, y, "pine-snow", 30, 0.55);
          if (h(40) < 0.14) plant(x, y, "frost-tree", 50, 0.5);
        } else if (skin.desert) {
          // PALMERAIE : l'oasis du thème (c'est ELLE qui rend l'eau, thirst.go), donc
          // l'endroit où l'on va — donc celui qu'il faut reconnaître de loin.
          plant(x, y, "palm", 10, 0.66);
          if (h(20) < 0.45) plant(x, y, "palm", 30, 0.56);
          if (h(25) < 0.3) plant(x, y, "olive", 35, 0.5);
          if (h(40) < 0.12) plant(x, y, "reed", 50, 0.42);
        } else {
          plant(x, y, "tree-green", 10, 0.62);
          if (h(20) < 0.5) plant(x, y, "tree-green", 30, 0.5);
          if (h(40) < 0.12) plant(x, y, "tree-pink", 50, 0.55);
        }
        if (h(110) < 0.4) plant(x, y, "grass-tuft", 115, 0.3);
        if (h(310) < 0.13) plant(x, y, "mushroom", 315, 0.33);
        if (h(320) < 0.16) plant(x, y, "fern", 325, 0.36);
        if (h(330) < 0.045) plant(x, y, "log", 335, 0.45);
        if (h(340) < 0.09) plant(x, y, "bush-dense", 345, 0.42);
        if (h(640) < 0.1) plant(x, y, "firefly", 645, 0.45, "night"); // crépuscule seulement
        if (h(660) < 0.02) plant(x, y, "web", 665, 0.4); // annonce l'Araignée Cristalline
      } else if (t.biome === 4) { // montagne : éboulis au pied des falaises, cristaux, cairns aux sommets
        if (h(99) < 0.3) plant(x, y, "rock", 100, 0.65);
        if (skin.desert) {
          if (h(150) < 0.12) plant(x, y, "dead-tree", 155, 0.55); // rien ne pousse sur le grès
        } else if (h(150) < 0.3) plant(x, y, skin.nordic ? "pine-snow" : "pine", 155, 0.62);
        if (h(350) < (f.cliffFoot ? 0.35 : 0.04)) plant(x, y, "scree", 355, 0.5);
        if (h(360) < 0.045) plant(x, y, "crystal", 365, 0.45);
        if (h(370) < (f.summit ? 0.3 : 0.015)) plant(x, y, "cairn", 375, 0.45);
        if (h(380) < 0.05) plant(x, y, "dead-tree", 385, 0.5);
      } else if (t.biome === 5) { // neige : congères, glace, arbres givrés
        if (h(160) < 0.35) plant(x, y, "pine-snow", 165, 0.6);
        if (skin.nordic && h(161) < 0.012) plant(x, y, "rune-stone", 166, 0.55);
        if (h(390) < 0.11) plant(x, y, "snowdrift", 395, 0.5);
        if (h(400) < 0.05) plant(x, y, "ice-spike", 405, 0.45);
        if (h(410) < 0.06) plant(x, y, "frost-tree", 415, 0.5);
        if (h(420) < 0.06) plant(x, y, "frost-bush", 425, 0.4);
        if (!t.monsterId && h(650) < 0.012) plant(x, y, "hare", 655, 0.3, "day"); // lièvre discret
        if (h(670) < 0.06) plant(x, y, "snow-motes", 675, 0.5); // souffle de neige figé
      }
    }
  }

  out.push(...landmarks(src, at, flagsOf));
  out.push(...ruins(src, at));
  return out;
}

// ---------------------------------------------------------------------------
// RUINES ÉPARSES (lore Echo Terra) : 2-3 par carte tous biomes terrestres —
// colonne brisée, dalle gravée, arche à moitié effondrée. Même tirage
// déterministe que les landmarks (meilleure tuile par score haché).
// ---------------------------------------------------------------------------
const RUIN_TYPES = ["ruin-column", "ruin-slab", "ruin-arch"];

function ruins(src: ScatterSource, at: (x: number, y: number) => ScatterTile | undefined): PropPlacement[] {
  // ⚠ ^ renvoie un int32 SIGNÉ : sans >>> 0, seed % 2 peut valoir −1 (n=1)
  // et (seed+i) % 3 indexer négativement le tableau des types
  const seed = (strHash(src.seedStr) ^ 0x2417) >>> 0;
  const n = 2 + (seed % 2);
  const out: PropPlacement[] = [];
  for (let i = 0; i < n; i++) {
    let best: { x: number; y: number; score: number } | null = null;
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const t = at(x, y);
        if (!t?.discovered || t.biome === 0) continue;
        if (x === src.townX && y === src.townY) continue;
        const score = h01(x, y, seed ^ (i * 0x9e37));
        if (!best || score > best.score) best = { x, y, score };
      }
    }
    if (best) out.push(one(RUIN_TYPES[(seed + i) % RUIN_TYPES.length], best.x, best.y, seed + i, 0.5));
  }
  return out;
}

// ---------------------------------------------------------------------------
// LOT D2 — repères uniques par seed. 3 à 5 landmarks par carte, tirés du pool
// par hachage de game.id ; chacun se pose sur SA meilleure tuile éligible
// (score haché par tuile). Le client ne connaît que les tuiles découvertes :
// un repère peut donc « apparaître » (voire se déplacer vers une meilleure
// tuile) au fil de l'exploration — assumé, ce sont des décors.
// ---------------------------------------------------------------------------

type LandmarkDef = {
  id: string;
  eligible: (t: ScatterTile, f: TileFlags) => boolean;
  /** émet le(s) placement(s) du repère sur la tuile choisie */
  place: (x: number, y: number, seed: number) => PropPlacement[];
};

const one = (id: string, x: number, y: number, seed: number, scale: number, v = 0): PropPlacement => ({
  id, v, x, y, rot: h01(x, y, seed) * Math.PI * 2, scale,
});

const LANDMARKS: LandmarkDef[] = [
  { id: "boat", eligible: (t, f) => t.biome === 1 && f.nearWater, place: (x, y, s) => [one("boat", x, y, s, 0.7)] },
  { id: "turtle", eligible: (t, f) => t.biome === 1 && f.nearWater, place: (x, y, s) => [one("turtle", x, y, s, 0.5)] },
  { id: "scarecrow", eligible: (t, f) => f.openMeadow, place: (x, y, s) => [one("scarecrow", x, y, s, 0.6)] },
  { id: "beehive", eligible: (t) => t.biome === 2, place: (x, y, s) => [one("beehive", x, y, s, 0.55)] },
  {
    id: "fairy-ring", // cercle de fées : 8 champignons en anneau sur la tuile
    eligible: (t) => t.biome === 3,
    place: (x, y, s) => {
      const ring: PropPlacement[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + h01(x, y, s) * 0.7;
        ring.push({
          id: "mushroom", v: i % 3,
          x: x + Math.cos(a) * 0.42, y: y + Math.sin(a) * 0.42,
          rot: a, scale: 0.22 + h01(x + i, y, s + i) * 0.08,
        });
      }
      return ring;
    },
  },
  {
    id: "old-tree", // vieil arbre ancien — écho au « Cœur de chêne ancien » du craft
    eligible: (t) => t.biome === 3,
    place: (x, y, s) => [one("tree-green", x, y, s, 1.35, 1)],
  },
  { id: "menhir", eligible: (t, f) => t.biome === 4 && (f.summit || relief(t) >= 2), place: (x, y, s) => [one("menhir", x, y, s, 0.75)] },
  { id: "snowman", eligible: (t) => t.biome === 5, place: (x, y, s) => [one("snowman", x, y, s, 0.55)] },
  // l'aigle tournoie au-dessus du pic (la carte anime sa position au tick solaire)
  { id: "eagle", eligible: (t, f) => t.biome === 4 && (f.summit || relief(t) >= 3), place: (x, y, s) => [one("eagle", x, y, s, 0.55)] },
];

function landmarks(
  src: ScatterSource,
  at: (x: number, y: number) => ScatterTile | undefined,
  flagsOf: (x: number, y: number, t: ScatterTile) => TileFlags,
): PropPlacement[] {
  const seed = strHash(src.seedStr);
  // 3 à 5 repères : les défs sont classées par score haché, on garde les K premières
  const count = 3 + (h01(seed & 0xffff, seed >>> 16, 31) * 3) | 0;
  const chosen = LANDMARKS
    .map((d) => ({ d, score: h01(strHash(d.id), seed, 17) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
  const out: PropPlacement[] = [];
  for (const { d } of chosen) {
    let best: { x: number; y: number; score: number } | null = null;
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const t = at(x, y);
        if (!t || !t.discovered) continue;
        if (x === src.townX && y === src.townY) continue;
        if (!d.eligible(t, flagsOf(x, y, t))) continue;
        const score = h01(x, y, seed ^ strHash(d.id));
        if (!best || score > best.score) best = { x, y, score };
      }
    }
    if (best) out.push(...d.place(best.x, best.y, seed & 0x3ff));
  }
  return out;
}
