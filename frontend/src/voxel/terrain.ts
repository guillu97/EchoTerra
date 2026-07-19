// Couche de terrain instanciée : la transposition 3D de l'atlas de piliers de
// MapScene. Chaque type de bloc (id × variante) est meshé UNE fois puis rendu
// en InstancedMesh — 60×60 tuiles ≈ 10–20 draw calls, quel que soit le détail
// des blocs. Teinte par instance (fog / ombrage d'altitude / danger) via
// instanceColor, diffée par le code appelant.

import * as THREE from "three";
import { fetchVox } from "./vox";
import { meshVoxModel } from "./mesher";

export const BLOCK_VARIANTS = 3; // gen-blocks.mjs en produit 3 par id

/** Bibliothèque des géométries de blocs (id-vK → BufferGeometry meshée).
 *  `base` choisit le LOD : "/voxels" = 32³ (combat/ville de près),
 *  "/voxels/16" = 16³ (échelle carte monde — ~4× moins de triangles). */
export class BlockLibrary {
  private geoms = new Map<string, THREE.BufferGeometry>();
  triangles = new Map<string, number>();
  meshMs = 0;

  constructor(readonly base: string = "/voxels") {}

  async load(ids: string[]): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const id of ids) {
      for (let v = 0; v < BLOCK_VARIANTS; v++) {
        const key = `${id}-v${v}`;
        if (this.geoms.has(key)) continue;
        jobs.push(
          fetchVox(`${this.base}/${key}.vox`).then((model) => {
            const t0 = performance.now();
            const { geometry, triangles } = meshVoxModel(model);
            this.meshMs += performance.now() - t0;
            this.geoms.set(key, geometry);
            this.triangles.set(key, triangles);
          }),
        );
      }
    }
    await Promise.all(jobs);
  }

  get(id: string, variant: number): THREE.BufferGeometry | undefined {
    return this.geoms.get(`${id}-v${((variant % BLOCK_VARIANTS) + BLOCK_VARIANTS) % BLOCK_VARIANTS}`);
  }
  dispose() {
    for (const g of this.geoms.values()) g.dispose();
    this.geoms.clear();
  }
}

/** hachage mélangé de position → variante stable (même recette que la brume 2D) */
export function variantAt(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return (h >>> 16) % BLOCK_VARIANTS;
}

export type TerrainCell = {
  x: number;
  y: number; // coordonnées tuile (le monde three met y sur Z)
  block: string; // id du bloc de SURFACE ("grass", "mist"…)
  levels: number; // hauteur du pilier en blocs (1 = sol plat)
  under?: string; // bloc des niveaux inférieurs (défaut : block) — la terre
  // sous l'herbe, la pierre sous la neige : sans lui les piliers montrent une
  // couche d'herbe à CHAQUE niveau (effet "rayures" constaté au banc)
  tint?: THREE.Color; // teinte d'instance (défaut blanc)
};

/**
 * (Re)construit les InstancedMesh d'un terrain. Retourne le groupe à insérer
 * dans la scène + un index instance→cellule pour le picking.
 */
export function buildTerrain(lib: BlockLibrary, cells: TerrainCell[]): {
  group: THREE.Group;
  lookup: Map<THREE.Object3D, TerrainCell[]>;
  instances: number;
} {
  // regrouper les placements par (bloc, variante) — le sommet du pilier porte
  // le bloc de surface, les niveaux dessous le bloc `under`
  const buckets = new Map<string, { geom: THREE.BufferGeometry; items: { cell: TerrainCell; level: number }[] }>();
  for (const cell of cells) {
    const v = variantAt(cell.x, cell.y);
    for (let l = 0; l < cell.levels; l++) {
      const id = l === cell.levels - 1 ? cell.block : cell.under ?? cell.block;
      const geom = lib.get(id, v);
      if (!geom) continue;
      const key = `${id}-v${v}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { geom, items: [] }));
      b.items.push({ cell, level: l });
    }
  }
  const group = new THREE.Group();
  const lookup = new Map<THREE.Object3D, TerrainCell[]>();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  // la BRUME s'auto-éclaire (Basic) : c'est un voile magique qui porte ses
  // couleurs — éclairée/ombrée en Lambert elle devenait un papier gris sale
  const mistMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  let instances = 0;
  const m = new THREE.Matrix4();
  for (const [key, { geom, items }] of buckets.entries()) {
    const mist = key.startsWith("mist");
    const mesh = new THREE.InstancedMesh(geom, mist ? mistMat : mat, items.length);
    const cellsOf: TerrainCell[] = [];
    for (let i = 0; i < items.length; i++) {
      const { cell, level } = items[i];
      m.makeTranslation(cell.x, level, cell.y);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, cell.tint ?? WHITE);
      cellsOf.push(cell);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // ⚠ la BRUME ne projette ni ne reçoit d'ombre : son mur en projetait des
    // bandes PCF sombres qui scintillaient le long de la frontière du fog
    mesh.castShadow = !mist;
    mesh.receiveShadow = !mist;
    lookup.set(mesh, cellsOf);
    group.add(mesh);
    instances += items.length;
  }
  return { group, lookup, instances };
}

const WHITE = new THREE.Color(1, 1, 1);

export type StackItem = { x: number; y: number; level: number; block: string };

/**
 * Instancie des blocs posés à des niveaux ARBITRAIRES (le format `Cell.blocks[]`
 * de l'éditeur de carte : pierre au niveau 0, sable au niveau 1, trous permis) —
 * utilisé par le Home voxel qui lit town-map.json tel quel.
 */
export function buildStacks(lib: BlockLibrary, items: StackItem[]): {
  group: THREE.Group;
  lookup: Map<THREE.Object3D, StackItem[]>;
  instances: number;
} {
  const buckets = new Map<string, { geom: THREE.BufferGeometry; items: StackItem[] }>();
  for (const it of items) {
    const v = variantAt(it.x, it.y);
    const geom = lib.get(it.block, v);
    if (!geom) continue;
    const key = `${it.block}-v${v}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { geom, items: [] }));
    b.items.push(it);
  }
  const group = new THREE.Group();
  const lookup = new Map<THREE.Object3D, StackItem[]>();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const m = new THREE.Matrix4();
  let instances = 0;
  for (const { geom, items: list } of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geom, mat, list.length);
    for (let i = 0; i < list.length; i++) {
      m.makeTranslation(list[i].x, list[i].level, list[i].y);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    lookup.set(mesh, list);
    group.add(mesh);
    instances += list.length;
  }
  return { group, lookup, instances };
}
