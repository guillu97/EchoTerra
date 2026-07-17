// Personnages voxel (Phase 5, étape 2) : géométries meshées des .vox de
// `public/voxels/chars/`. Les vues les utilisent QUAND ELLES EXISTENT, sinon
// billboard PNG (bascule progressive, modèle par modèle — consigne du plan).
// Le modèle fait face à +Z monde : les vues posent rotation.y = azimut caméra
// pour qu'il tourne RÉELLEMENT avec la caméra.

import * as THREE from "three";
import { fetchVox } from "./vox";
import { meshVoxModel } from "./mesher";

export const HERO_HEIGHT = 0.85; // hauteur monde d'un héros (unités tuile)

// Tout ce que le générateur voxel sait produire (chars/ contient héros ET
// monstres) ; un .vox manquant retombe silencieusement en billboard.
export const ALL_CHAR_KEYS = [
  "char-scout", "char-builder", "char-archer", "char-knight", "char-merchant", "char-healer", "char-wizard",
  "mob-goblin", "mob-slime", "mob-windelemental", "mob-bat", "mob-ghost", "mob-mushroomling", "mob-spider", "mob-wolf", "mob-orc",
];

export class CharLibrary {
  private geoms = new Map<string, { geometry: THREE.BufferGeometry; scale: number }>();
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
        } catch {
          this.failed.add(key); // pas (encore) de modèle : la vue garde le billboard
        }
      }),
    );
  }

  /** Mesh prêt à poser (pieds à y=0) ou undefined si pas de modèle. */
  make(key: string): THREE.Mesh | undefined {
    const e = this.geoms.get(key);
    if (!e) return undefined;
    const m = new THREE.Mesh(e.geometry, CHAR_MAT);
    m.scale.setScalar(e.scale);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  dispose() {
    for (const e of this.geoms.values()) e.geometry.dispose();
    this.geoms.clear();
  }
}

const CHAR_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
