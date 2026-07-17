// Terrain CONTINU de la carte monde (par opposition aux blocs discrets) :
// une surface lisse interpolée construite depuis les MÊMES données serveur.
// - hauteur aux COINS = moyenne des tuiles adjacentes → pentes continues au
//   lieu de marches ; sous-division 3×3 par tuile + micro-relief de bruit ;
// - couleurs PAR VERTEX : palette du biome (palettes.json — les mêmes teintes
//   pastel que les blocs), FONDUES aux frontières de biomes (plage sable→herbe
//   dégradée toute seule) + variation par tuile et grain léger ;
// - jupe périmétrique vers le bas (la tranche du monde reste fermée) ;
// - la BRUME (non découvert) reste en blocs voxel : nuages posés sur un sol à 0.
// Le mode se choisit dans Réglages (`settings.voxelSmooth`) — les blocs restent
// disponibles pour comparer ; Combat et Home gardent leurs blocs (grille lisible).

import * as THREE from "three";
import type { GameState } from "../api/types";

const SUB = 3; // sous-divisions par tuile (3×3 quads)
const MICRO = 0.05; // amplitude du micro-relief (unités monde)

// STYLE DIORAMA (référence utilisateur 2026-07-17) : plateaux plats aux rebords
// organiques (terrasses), falaises pierre crème, AO cuite, palette menthe/crème.
const TERRACE_BAND = 0.34; // largeur de la transition falaise (fraction de niveau)

// Palette diorama par biome — désaturée façon maquette (la référence) ; deux
// nuances par biome pour les taches douces par tuile.
const DIORAMA: Record<number, [number, number, number][]> = {
  0: [[150, 202, 222], [138, 192, 214]], // eau laiteuse
  1: [[228, 213, 176], [220, 203, 164]], // sable crème
  2: [[186, 216, 170], [174, 208, 156]], // herbe menthe
  3: [[162, 198, 142], [152, 190, 132]], // forêt (sol clair — les arbres font le vert)
  4: [[204, 197, 186], [192, 185, 174]], // roche claire
  5: [[240, 242, 247], [230, 234, 241]], // neige
};
const CLIFF: [number, number, number] = [227, 219, 198]; // falaise pierre crème
const BIOME_IDS = ["water", "sand", "grass", "forest", "stone", "snow"];
void BIOME_IDS;

// Terrasse : plateau plat + montée douce centrée sur les demi-niveaux → les
// courbes de niveau du champ LISSÉ deviennent des rebords organiques (elles ne
// suivent pas les frontières de tuiles).
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

export class SmoothTerrain {
  mesh: THREE.Mesh | null = null;
  private heights: Float32Array | null = null; // hauteur lissée par sommet de sous-grille
  private game: GameState | null = null;

  /** hauteur du sol lissé au point (x, y) monde (coordonnées tuile continues) */
  heightAt(x: number, y: number): number {
    if (!this.game || !this.heights) return 1;
    const g = this.game;
    const n = SUB;
    const fx = Math.min(Math.max((x + 0.5) * n, 0), g.width * n - 0.001);
    const fy = Math.min(Math.max((y + 0.5) * n, 0), g.height * n - 0.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const w = g.width * n + 1;
    const h00 = this.heights[y0 * w + x0];
    const h10 = this.heights[y0 * w + x0 + 1];
    const h01 = this.heights[(y0 + 1) * w + x0];
    const h11 = this.heights[(y0 + 1) * w + x0 + 1];
    const tx = fx - x0, ty = fy - y0;
    return h00 + (h10 - h00) * tx + (h01 + (h11 - h01) * tx - (h00 + (h10 - h00) * tx)) * ty;
  }

  /**
   * (Re)construit la surface. `renderHeight` = niveaux de LA VUE BLOCS (0 =
   * plaine) pour rester cohérent avec brume/overlays ; les tuiles non
   * découvertes comptent hauteur 0 (la brume les couvre).
   */
  build(game: GameState, palettes: Palettes | null, renderHeight: (t: GameState["tiles"][number]) => number): THREE.Mesh {
    this.game = game;
    const W = game.width, H = game.height, n = SUB;
    const gw = W * n + 1, gh = H * n + 1;

    // couleur de base par tuile : palette DIORAMA du biome (désaturée façon
    // maquette — la référence), deux nuances alternées par hachage
    void palettes; // (l'extraction isotiles reste utilisée par les BLOCS)
    const tileColor = (tx: number, ty: number): [number, number, number] => {
      const t = game.tiles[ty * W + tx];
      if (!t?.discovered) return [225, 227, 244]; // sous la brume (peu visible)
      const shades = DIORAMA[t.biome] ?? DIORAMA[2];
      return shades[hash01(tx, ty) < 0.5 ? 0 : 1];
    };
    const tileH = (tx: number, ty: number): number => {
      const t = game.tiles[ty * W + tx];
      return t?.discovered ? renderHeight(t) : 0;
    };

    // hauteurs de la sous-grille : coins = moyenne des 4 tuiles, intérieur =
    // interpolation lissée (smoothstep) + micro-relief (nul sur l'eau)
    const heights = new Float32Array(gw * gh);
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
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const tx = Math.min(Math.floor(gx / n), W - 1);
        const ty = Math.min(Math.floor(gy / n), H - 1);
        const fx = (gx - tx * n) / n, fy = (gy - ty * n) / n;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const h00 = cornerH(tx, ty), h10 = cornerH(tx + 1, ty);
        const h01 = cornerH(tx, ty + 1), h11 = cornerH(tx + 1, ty + 1);
        const smooth = h00 + (h10 - h00) * sx + (h01 + (h11 - h01) * sx - (h00 + (h10 - h00) * sx)) * sy;
        // TERRASSES : le champ lissé est re-quantifié en plateaux aux rebords
        // organiques (style diorama) ; micro-relief léger par-dessus
        let hgt = terrace(smooth);
        const t = game.tiles[ty * W + tx];
        const isWater = t?.discovered && t.biome === 0;
        if (!isWater) hgt += (hash01(gx, gy, 7) - 0.5) * 2 * MICRO;
        heights[gy * gw + gx] = hgt + 1; // +1 : le "sol" des blocs est à 1 (dessus du bloc 0)
      }
    }
    this.heights = heights;

    // maillage : sommets partagés de la sous-grille + couleurs fondues aux coins
    const positions = new Float32Array(gw * gh * 3);
    const colors = new Float32Array(gw * gh * 3);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const i = gy * gw + gx;
        positions[i * 3] = gx / n - 0.5;
        positions[i * 3 + 1] = heights[i];
        positions[i * 3 + 2] = gy / n - 0.5;
        // couleur du sommet : moyenne des tuiles qui le touchent (fondu de
        // biomes), pondérée + grain discret par sommet
        const cx = gx / n - 0.5, cy = gy / n - 0.5; // position monde
        let r = 0, g2 = 0, b = 0, cnt = 0;
        const tx0 = Math.round(cx), ty0 = Math.round(cy);
        for (const [dx, dy] of [[0, 0], [Math.sign(cx - tx0) || 0, 0], [0, Math.sign(cy - ty0) || 0]]) {
          const tx = Math.min(Math.max(tx0 + dx, 0), W - 1);
          const ty = Math.min(Math.max(ty0 + dy, 0), H - 1);
          const c = tileColor(tx, ty);
          r += c[0]; g2 += c[1]; b += c[2]; cnt++;
        }
        // FALAISES CRÈME : plus la pente locale est forte, plus la couleur
        // glisse du biome vers la pierre claire (les rebords de terrasses
        // ressortent en crème, comme la référence)
        const hL = heights[gy * gw + Math.max(0, gx - 1)];
        const hR = heights[gy * gw + Math.min(gw - 1, gx + 1)];
        const hU = heights[Math.max(0, gy - 1) * gw + gx];
        const hD = heights[Math.min(gh - 1, gy + 1) * gw + gx];
        const slope = Math.hypot((hR - hL) * n * 0.5, (hD - hU) * n * 0.5);
        // seuil haut : seuls les VRAIS rebords de terrasse passent en pierre —
        // une pente douce garde la couleur du biome
        const cliff = Math.min(1, Math.max(0, (slope - 1.15) / 1.2));
        r = r / cnt + (CLIFF[0] - r / cnt) * cliff;
        g2 = g2 / cnt + (CLIFF[1] - g2 / cnt) * cliff;
        b = b / cnt + (CLIFF[2] - b / cnt) * cliff;
        // AO CUITE : les creux (concavité) foncent doucement — pieds de
        // falaises et vallons gagnent le contact sombre du style maquette
        const concave = (hL + hR + hU + hD) / 4 - heights[i];
        const ao = 1 - Math.min(0.32, Math.max(0, concave) * 0.85);
        const grain = 0.97 + hash01(gx, gy, 3) * 0.06;
        colors[i * 3] = (r / 255) * grain * ao;
        colors[i * 3 + 1] = (g2 / 255) * grain * ao;
        colors[i * 3 + 2] = (b / 255) * grain * ao;
      }
    }
    const indices: number[] = [];
    for (let gy = 0; gy < gh - 1; gy++) {
      for (let gx = 0; gx < gw - 1; gx++) {
        const a = gy * gw + gx, bI = a + 1, c = a + gw, d = c + 1;
        indices.push(a, c, bI, bI, c, d);
      }
    }

    // jupe périmétrique : rideau vertical vers y=0 sur le pourtour (duplique
    // les sommets de bord dans un second buffer, double face)
    const skirtColor = [CLIFF[0] / 255 * 0.94, CLIFF[1] / 255 * 0.94, CLIFF[2] / 255 * 0.94];
    const skirtPos: number[] = [];
    const skirtCol: number[] = [];
    const skirtIdx: number[] = [];
    const pushEdge = (ids: number[]) => {
      for (let k = 0; k < ids.length - 1; k++) {
        const iA = ids[k], iB = ids[k + 1];
        const base = skirtPos.length / 3;
        for (const i of [iA, iB]) {
          skirtPos.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
          skirtCol.push(...skirtColor);
        }
        for (const i of [iA, iB]) {
          skirtPos.push(positions[i * 3], 0, positions[i * 3 + 2]);
          skirtCol.push(skirtColor[0] * 0.6, skirtColor[1] * 0.6, skirtColor[2] * 0.6);
        }
        skirtIdx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        skirtIdx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2); // double face
      }
    };
    const north: number[] = [], south: number[] = [], west: number[] = [], east: number[] = [];
    for (let gx = 0; gx < gw; gx++) { north.push(gx); south.push((gh - 1) * gw + gx); }
    for (let gy = 0; gy < gh; gy++) { west.push(gy * gw); east.push(gy * gw + gw - 1); }
    pushEdge(north); pushEdge(south); pushEdge(west); pushEdge(east);

    const geom = new THREE.BufferGeometry();
    const allPos = new Float32Array(positions.length + skirtPos.length);
    allPos.set(positions); allPos.set(skirtPos, positions.length);
    const allCol = new Float32Array(colors.length + skirtCol.length);
    allCol.set(colors); allCol.set(skirtCol, colors.length);
    const skirtBase = positions.length / 3;
    const allIdx = [...indices, ...skirtIdx.map((i) => i + skirtBase)];
    geom.setAttribute("position", new THREE.BufferAttribute(allPos, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(allCol, 3));
    geom.setIndex(allIdx);
    geom.computeVertexNormals(); // normales lissées = le modelé continu
    geom.computeBoundingSphere();

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
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
