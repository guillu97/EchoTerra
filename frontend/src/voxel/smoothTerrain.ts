// Terrain de la carte en PENTES VOXEL (choix utilisateur 2026-07-17) : le champ
// de hauteurs lissé + terrassé n'est PAS rendu en surface continue (essayée,
// pas aimée) mais RASTERISÉ en fines colonnes voxel — 4 colonnes par côté de
// tuile, pas verticaux de ¼ d'unité (voxels cubiques) : les pentes deviennent
// des escaliers de petits cubes, comme la référence diorama.
// - plateaux plats aux rebords organiques (terrasses sur le champ lissé) ;
// - palette DIORAMA par biome, fondue aux frontières ; murs des marches en
//   pierre crème (proportionnel à la hauteur de la marche) ; AO cuite ;
// - l'eau se creuse (rives en escaliers doux) ; pointillés d'herbe discrets ;
// - bord de monde = murs jusqu'à 0 (jupe intégrée).
// `heightAt` renvoie la hauteur QUANTIFIÉE de la colonne (props/unités posés
// sur les marches). Réglage : Réglages → « Terrain voxel : Blocs / Pentes ».

import * as THREE from "three";

/** source structurelle : GameState convient, le banc fabrique la sienne */
export type TerrainSource = {
  width: number;
  height: number;
  tiles: { biome: number; height: number; discovered?: boolean }[];
};

// Grain fin : blocs de pente d'1/8 de tuile (retours successifs « trop
// pixelisé » puis « réduis chaque bloc » — ¼ → 1/6 → 1/8)
const R = 10; // colonnes voxel par côté de tuile (résolution ×1.25, 2026-07-18)
const VS = 1 / 10; // pas vertical (= 1/R : voxels cubiques)
// micro-relief bas : à la grille 1/6, 0.11 franchissait le pas partout et
// couvrait les plaines de bosselures (constaté sur capture) — la texture doit
// venir de la finesse de la grille et de l'ondulation, pas du bruit
const MICRO = 0.045;
const TERRACE_BAND = 0.26; // largeur de la transition de terrasse
// Retour utilisateur (« sol trop lisse, reliefs plus hauts ») :
const HEIGHT_SCALE = 2.6; // amplification des hauteurs du monde (montagnes/collines nettement plus hautes)
const ROLL_AMP = 1.1; // ondulation lente des plaines (± unités) — buttes en marches

// Palette diorama par biome (désaturée façon maquette), deux nuances par biome.
// Palette densifiée (retour utilisateur : « moins pâle ») — pastels francs,
// pas délavés : verts qui existent, eau vraiment bleue, sable doré.
// Recalée sur les VRAIES teintes des isotiles peintes (échantillon des faces
// du dessus, 2026-07-19 — retour « pas assez coloré ») : verts chartreuse
// saturés, eau lagon franche, sable doré, roche plus profonde.
const DIORAMA: Record<number, [number, number, number][]> = {
  0: [[92, 182, 214], [76, 168, 204]], // eau lagon franche
  1: [[233, 198, 130], [222, 185, 114]], // sable doré
  2: [[160, 199, 82], [146, 188, 70]], // herbe chartreuse (isotile: 167,195,80)
  3: [[128, 163, 66], [116, 152, 58]], // sol forêt (isotile: 131,153,71)
  4: [[178, 162, 138], [163, 147, 122]], // roche chaude plus profonde
  5: [[236, 240, 249], [224, 230, 242]], // neige
};
const CLIFF: [number, number, number] = [212, 192, 152]; // pierre des marches, plus chaude
const UNDISCOVERED: [number, number, number] = [225, 227, 244]; // sous la brume

// ombrage voxel par face (mêmes valeurs douces que le mesher des blocs)
const SHADE_TOP = 1.0;
const SHADE_X = { p: 0.93, n: 0.84 };
const SHADE_Z = { p: 0.97, n: 0.78 };

function terrace(h: number): number {
  const base = Math.floor(h);
  const frac = h - base;
  const k = Math.min(1, Math.max(0, (frac - (0.5 - TERRACE_BAND / 2)) / TERRACE_BAND));
  return base + k * k * (3 - 2 * k);
}

type Palettes = Record<string, { palette: { top: number[][] } }>;

function hash01(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h >>> 16) & 0xffff) / 0x10000;
}

// bruit de valeur LISSE inter-tuiles (2 octaves) — l'ondulation des plaines
function rollNoise(x: number, y: number): number {
  const oct = (px: number, py: number, s: number) => {
    const x0 = Math.floor(px), y0 = Math.floor(py);
    const fx = px - x0, fy = py - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const v00 = hash01(x0, y0, s), v10 = hash01(x0 + 1, y0, s);
    const v01 = hash01(x0, y0 + 1, s), v11 = hash01(x0 + 1, y0 + 1, s);
    return v00 + (v10 - v00) * sx + (v01 + (v11 - v01) * sx - (v00 + (v10 - v00) * sx)) * sy;
  };
  return 0.65 * oct(x / 6.5, y / 6.5, 21) + 0.35 * oct(x / 2.8, y / 2.8, 22);
}

export class SmoothTerrain {
  mesh: THREE.Mesh | null = null;
  private cols: Float32Array | null = null; // hauteur quantifiée par colonne
  private gw = 0;
  private gh = 0;
  private timeUniform: { value: number } | null = null; // uniform du shader d'eau

  /** avance le temps du shader d'eau (appelé sur les frames rendues) */
  setTime(seconds: number) {
    if (this.timeUniform) this.timeUniform.value = seconds;
  }

  /** hauteur de la MARCHE sous (x, y) monde — les props/unités s'y posent */
  heightAt(x: number, y: number): number {
    if (!this.cols) return 1;
    const cx = Math.min(Math.max(Math.floor((x + 0.5) * R), 0), this.gw - 1);
    const cy = Math.min(Math.max(Math.floor((y + 0.5) * R), 0), this.gh - 1);
    return this.cols[cy * this.gw + cx];
  }

  build(
    game: TerrainSource,
    palettes: Palettes | null,
    renderHeight: (t: TerrainSource["tiles"][number]) => number,
    // Options : la CARTE amplifie les hauteurs et fait rouler les plaines ; le
    // COMBAT veut des marches FIDÈLES et des plateaux plats (heightScale 1, roll 0,
    // micro 0) tout en gardant les pentes voxel arrondies.
    opts: { heightScale?: number; rollAmp?: number; micro?: number } = {},
  ): THREE.Mesh {
    void palettes; // l'extraction isotiles reste l'affaire des blocs
    const heightScale = opts.heightScale ?? HEIGHT_SCALE;
    const rollAmp = opts.rollAmp ?? ROLL_AMP;
    const micro = opts.micro ?? MICRO;
    const W = game.width, H = game.height;
    const gw = (this.gw = W * R), gh = (this.gh = H * R);

    const tileAt = (tx: number, ty: number) =>
      game.tiles[Math.min(Math.max(ty, 0), H - 1) * W + Math.min(Math.max(tx, 0), W - 1)];
    const tileH = (tx: number, ty: number): number => {
      const t = tileAt(tx, ty);
      if (!t?.discovered) return 0;
      if (t.biome === 0) return -0.45; // l'eau se creuse
      // hauteurs AMPLIFIÉES + ondulation lente des terres (les plaines roulent
      // en buttes de marches au lieu d'un grand aplat) — le sable près de
      // l'eau ondule moins pour garder des plages basses
      const rollScale = t.biome === 1 ? 0.35 : 1;
      return renderHeight(t) * heightScale + (rollNoise(tx, ty) - 0.5) * rollAmp * rollScale;
    };
    const cornerH = (cx: number, cy: number): number => {
      let sum = 0, cnt = 0;
      for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 0; dx++) {
          const tx = cx + dx, ty = cy + dy;
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
          sum += tileH(tx, ty); cnt++;
        }
      }
      return cnt ? sum / cnt : 0;
    };

    // 1) hauteur quantifiée par colonne : champ lissé (coins moyennés,
    // smoothstep dans la tuile) → terrasses → micro → QUANTIFICATION au pas VS
    const cols = new Float32Array(gw * gh);
    for (let cy = 0; cy < gh; cy++) {
      for (let cx = 0; cx < gw; cx++) {
        const tx = Math.floor(cx / R), ty = Math.floor(cy / R);
        const fx = (cx + 0.5) / R - tx, fy = (cy + 0.5) / R - ty;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const h00 = cornerH(tx, ty), h10 = cornerH(tx + 1, ty);
        const h01 = cornerH(tx, ty + 1), h11 = cornerH(tx + 1, ty + 1);
        const smooth = h00 + (h10 - h00) * sx + (h01 + (h11 - h01) * sx - (h00 + (h10 - h00) * sx)) * sy;
        let hgt = terrace(smooth);
        const t = tileAt(tx, ty);
        if (micro > 0 && !(t?.discovered && t.biome === 0)) hgt += (hash01(cx, cy, 7) - 0.5) * 2 * micro;
        cols[cy * gw + cx] = Math.round((hgt + 1) / VS) * VS; // +1 : sol des blocs
      }
    }
    this.cols = cols;

    // 2) couleur de base par colonne : palette du biome le plus proche, fondue
    // avec les tuiles voisines selon la position dans la tuile
    // nuance du biome MÉLANGÉE par un bruit doux (fini le damier par tuile qui
    // lisait comme du bruit de pixels) : grandes nappes de ton fondues
    const tileColor = (tx: number, ty: number): [number, number, number] => {
      const t = tileAt(tx, ty);
      if (!t?.discovered) return UNDISCOVERED;
      const shades = DIORAMA[t.biome] ?? DIORAMA[2];
      const k = rollNoise(tx * 1.7 + 40, ty * 1.7 + 40);
      return [
        shades[0][0] + (shades[1][0] - shades[0][0]) * k,
        shades[0][1] + (shades[1][1] - shades[0][1]) * k,
        shades[0][2] + (shades[1][2] - shades[0][2]) * k,
      ];
    };
    const colColor = (cx: number, cy: number): [number, number, number] => {
      const wx = (cx + 0.5) / R - 0.5, wy = (cy + 0.5) / R - 0.5;
      const tx0 = Math.round(wx), ty0 = Math.round(wy);
      // fondu BILINÉAIRE vers les voisins, NUL au cœur de la tuile (le poids ne
      // monte que sur le dernier tiers vers le bord : cœur net, jointure douce).
      // ⚠ l'ancien mélange uniforme (1/3 tuile + 1/3 voisin X + 1/3 voisin Y)
      // basculait de trio d'échantillons au CENTRE des tuiles → les carrés de
      // couleur étaient décalés d'une demi-tuile, leurs coins tombaient au
      // centre des cases (l'église semblait posée « au carrefour de 4 cases »).
      const dxf = wx - tx0, dyf = wy - ty0;
      const wgt = (d: number) => Math.min(0.5, Math.max(0, (Math.abs(d) - 0.18) / 0.32) * 0.5);
      const ax = wgt(dxf), ay = wgt(dyf);
      const sx = Math.sign(dxf) || 1, sy = Math.sign(dyf) || 1;
      const c00 = tileColor(tx0, ty0), c10 = tileColor(tx0 + sx, ty0);
      const c01 = tileColor(tx0, ty0 + sy), c11 = tileColor(tx0 + sx, ty0 + sy);
      const mix = (i: number) =>
        c00[i] * (1 - ax) * (1 - ay) + c10[i] * ax * (1 - ay) + c01[i] * (1 - ax) * ay + c11[i] * ax * ay;
      const r = mix(0), g = mix(1), b = mix(2), cnt = 1;
      // pointillés d'herbe plus discrets + grain ADOUCI (l'ancien bruit par
      // colonne lisait comme de la neige de pixels)
      const t = tileAt(tx0, ty0);
      const dot = t?.discovered && (t.biome === 2 || t.biome === 3) && hash01(cx, cy, 13) < 0.035 ? 0.9 : 1;
      const grain = (0.985 + hash01(cx, cy, 3) * 0.03) * dot;
      let out: [number, number, number] = [(r / cnt) * grain, (g / cnt) * grain, (b / cnt) * grain];
      // algues affleurantes (WORLD-DETAILS) : nappes vert sombre SOUS la surface,
      // en veines de bruit — c'est la teinte du bloc d'eau, pas un prop
      if (t?.discovered && t.biome === 0) {
        const algae = rollNoise(cx * 0.21 + 9, cy * 0.21 - 4);
        if (algae > 0.63) {
          const k = Math.min(1, (algae - 0.63) / 0.2) * 0.7;
          const deep: [number, number, number] = [56, 122, 104];
          out = [out[0] + (deep[0] - out[0]) * k, out[1] + (deep[1] - out[1]) * k, out[2] + (deep[2] - out[2]) * k];
        }
      }
      return out;
    };

    // 3) géométrie : face du DESSUS par colonne + murs vers les voisins plus
    // bas (bord du monde : mur jusqu'à 0 — la jupe est intégrée)
    const positions: number[] = [];
    const colors: number[] = [];
    const normals: number[] = [];
    const waterAttr: number[] = []; // 1 = colonne d'eau (le shader n'anime qu'elle)
    const indices: number[] = [];
    let quadIsWater = 0;
    const pushQuad = (
      pts: [number, number, number][],
      n: [number, number, number],
      rgb: [number, number, number],
      shade: number,
    ) => {
      const base = positions.length / 3;
      for (const [px, py, pz] of pts) {
        positions.push(px, py, pz);
        normals.push(n[0], n[1], n[2]);
        colors.push((rgb[0] / 255) * shade, (rgb[1] / 255) * shade, (rgb[2] / 255) * shade);
        waterAttr.push(quadIsWater);
      }
      // enroulement choisi pour que la face géométrique suive la normale voulue
      const [a, b, c] = pts;
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const crDotN =
        (e1[1] * e2[2] - e1[2] * e2[1]) * n[0] +
        (e1[2] * e2[0] - e1[0] * e2[2]) * n[1] +
        (e1[0] * e2[1] - e1[1] * e2[0]) * n[2];
      if (crDotN > 0) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    };
    const s = 1 / R; // taille d'une colonne (unités monde)
    for (let cy = 0; cy < gh; cy++) {
      for (let cx = 0; cx < gw; cx++) {
        const h = cols[cy * gw + cx];
        const x0 = cx * s - 0.5, x1 = x0 + s;
        const z0 = cy * s - 0.5, z1 = z0 + s;
        const base = colColor(cx, cy);

        // AO : colonne en creux vs ses voisines → assombrie ; rebord → +5 %
        const nb = [
          cx > 0 ? cols[cy * gw + cx - 1] : 0,
          cx < gw - 1 ? cols[cy * gw + cx + 1] : 0,
          cy > 0 ? cols[(cy - 1) * gw + cx] : 0,
          cy < gh - 1 ? cols[(cy + 1) * gw + cx] : 0,
        ];
        const avg = (nb[0] + nb[1] + nb[2] + nb[3]) / 4;
        const concave = avg - h;
        const rim = nb.some((v) => h - v >= VS * 2);
        // l'eau (toujours en creux) garde sa teinte laiteuse : AO plafonnée
        const tHere = tileAt(Math.floor(cx / R), Math.floor(cy / R));
        const isWater = tHere?.discovered && tHere.biome === 0;
        const aoMax = isWater ? 0.1 : 0.3;
        const ao = (1 - Math.min(aoMax, Math.max(0, concave) * 0.8)) * (rim ? 1.05 : 1);

        quadIsWater = isWater ? 1 : 0;
        pushQuad(
          [[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]],
          [0, 1, 0], base, SHADE_TOP * ao,
        );

        // murs : vers chaque voisin plus bas — teinte glissant vers la pierre
        // crème avec la HAUTEUR de la marche (les rebords de terrasse en crème)
        const wall = (lo: number, nx: number, nz: number, pts: [number, number, number][]) => {
          const drop = h - lo;
          if (drop <= 0.0001) return;
          const k = Math.min(1, (drop - VS) / 0.9);
          let rgb: [number, number, number] = [
            base[0] + (CLIFF[0] - base[0]) * Math.max(0, k),
            base[1] + (CLIFF[1] - base[1]) * Math.max(0, k),
            base[2] + (CLIFF[2] - base[2]) * Math.max(0, k),
          ];
          // sous la NAPPE de brume basse, la jupe des zones non découvertes
          // reste lavande (le socle gris jurait au bord du monde)
          if (tHere && !tHere.discovered) rgb = [206, 209, 232];
          // veines de minerai (lot D4) : sur les MURS de falaise de montagne,
          // fins filons dorés/cuivrés serpentant en diagonale (rare, par bruit)
          if (k > 0.55 && tHere?.discovered && tHere.biome === 4) {
            const serp = Math.sin(cx * 1.31 + cy * 0.73 + h * 7.1) + Math.sin(cy * 1.07 - cx * 0.41);
            if (Math.abs(serp) < 0.16) {
              const gold = ((cx * 7 + cy * 13) & 3) !== 0;
              rgb = gold ? [212, 176, 96] : [198, 134, 92];
            }
          }
          const shade = nx !== 0 ? (nx > 0 ? SHADE_X.p : SHADE_X.n) : nz > 0 ? SHADE_Z.p : SHADE_Z.n;
          pushQuad(pts, [nx, 0, nz], rgb, shade);
        };
        const hW = cx > 0 ? cols[cy * gw + cx - 1] : 0;
        const hE = cx < gw - 1 ? cols[cy * gw + cx + 1] : 0;
        const hN = cy > 0 ? cols[(cy - 1) * gw + cx] : 0;
        const hS = cy < gh - 1 ? cols[(cy + 1) * gw + cx] : 0;
        wall(hW, -1, 0, [[x0, h, z1], [x0, h, z0], [x0, hW, z0], [x0, hW, z1]]);
        wall(hE, 1, 0, [[x1, h, z0], [x1, h, z1], [x1, hE, z1], [x1, hE, z0]]);
        wall(hN, 0, -1, [[x0, h, z0], [x1, h, z0], [x1, hN, z0], [x0, hN, z0]]);
        wall(hS, 0, 1, [[x1, h, z1], [x0, h, z1], [x0, hS, z1], [x1, hS, z1]]);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geom.setAttribute("aWater", new THREE.Float32BufferAttribute(waterAttr, 1));
    geom.setIndex(indices);
    geom.computeBoundingSphere();

    // SHADER d'eau : injection dans le Lambert — les fragments d'eau chatoient
    // (vaguelettes de luminosité qui glissent) selon l'uniform uTime, avancé
    // sur les frames RENDUES (rendu on-demand : l'eau vit pendant les
    // interactions/ticks, immobile au repos — pas de boucle continue).
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const timeUniform = { value: 0 };
    this.timeUniform = timeUniform;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = timeUniform;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float aWater;\nvarying float vWater;\nvarying vec3 vWpos;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvWater = aWater;\nvWpos = position;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uTime;\nvarying float vWater;\nvarying vec3 vWpos;",
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          if (vWater > 0.5) {
            float w1 = sin(vWpos.x * 9.0 + vWpos.z * 6.0 + uTime * 1.6);
            float w2 = sin(vWpos.x * 4.0 - vWpos.z * 11.0 + uTime * 1.1);
            diffuseColor.rgb += vec3(0.05, 0.06, 0.07) * (w1 * 0.6 + w2 * 0.4);
          }`,
        );
    };
    this.mesh?.geometry.dispose();
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    return this.mesh;
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.mesh = null;
  }
}
