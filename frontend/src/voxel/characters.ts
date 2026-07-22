// Personnages voxel (Phase 5, étape 2) : géométries meshées des .vox de
// `public/voxels/chars/`. Les vues les utilisent QUAND ELLES EXISTENT, sinon
// billboard PNG (bascule progressive, modèle par modèle — consigne du plan).
// Le modèle fait face à +Z monde : les vues posent rotation.y = azimut caméra
// pour qu'il tourne RÉELLEMENT avec la caméra.

import * as THREE from "three";
import { fetchVox } from "./vox";
import { meshVoxModel } from "./mesher";
import { splitRig, buildRig, disposeRiggedGeom, type Rig, type RiggedGeom } from "./rig";

export const HERO_HEIGHT = 0.6; // hauteur monde d'un héros (réduite 2× — retours utilisateur)

// Tout ce que le générateur voxel sait produire (chars/ contient héros ET
// monstres) ; un .vox manquant retombe silencieusement en billboard.
export const ALL_CHAR_KEYS = [
  "char-scout", "char-builder", "char-archer", "char-knight", "char-merchant", "char-healer", "char-wizard",
  "mob-goblin", "mob-slime", "mob-windelemental", "mob-bat", "mob-ghost", "mob-mushroomling", "mob-spider", "mob-wolf", "mob-orc",
];

export class CharLibrary {
  private geoms = new Map<string, { geometry: THREE.BufferGeometry; scale: number }>();
  private rigs = new Map<string, RiggedGeom>(); // géométries découpées (corps + membres), en cache
  private failed = new Set<string>();

  async load(keys: string[]): Promise<void> {
    await Promise.all(
      keys.map(async (key) => {
        if (this.geoms.has(key) || this.failed.has(key)) return;
        try {
          const model = await fetchVox(`/voxels/chars/${key}.vox`);
          const { geometry } = meshVoxModel(model, model.sx);
          // geometry: 1 unité de large, hauteur = sz/sx → normaliser à HERO_HEIGHT
          this.geoms.set(key, { geometry, scale: HERO_HEIGHT / (model.sz / model.sx) });
          // découpe rig (corps + membres) : cuite une fois, réutilisée par makeRig
          this.rigs.set(key, splitRig(model, key, HERO_HEIGHT));
        } catch {
          this.failed.add(key); // pas (encore) de modèle : la vue garde le billboard
        }
      }),
    );
  }

  /** Mesh statique prêt à poser (pieds à y=0) ou undefined si pas de modèle. */
  make(key: string): THREE.Mesh | undefined {
    const e = this.geoms.get(key);
    if (!e) return undefined;
    const m = new THREE.Mesh(e.geometry, CHAR_MAT);
    m.scale.setScalar(e.scale);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  /** Rig animable (corps + membres pivotants) ou undefined si pas de modèle. */
  makeRig(key: string): Rig | undefined {
    const rg = this.rigs.get(key);
    return rg ? buildRig(rg) : undefined;
  }

  dispose() {
    for (const e of this.geoms.values()) e.geometry.dispose();
    for (const rg of this.rigs.values()) disposeRiggedGeom(rg);
    this.geoms.clear();
    this.rigs.clear();
  }
}

/** Rend un rig translucide (héros des AUTRES joueurs) — clone les matériaux du
 *  rig et les marque `ownMat` pour être libérés au prochain clearOwned. */
export function setRigOpacity(rig: Rig, alpha: number) {
  rig.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!(m.material instanceof THREE.MeshLambertMaterial)) return;
    const c = m.material.clone();
    c.transparent = true;
    c.opacity = alpha;
    m.material = c;
    m.userData.ownMat = true;
  });
}

const CHAR_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
