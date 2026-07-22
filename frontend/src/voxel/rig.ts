// Rig d'animation des unités voxel (héros + monstres) — Phase perso 3.
//
// Les .vox sont des maillages MONOLITHIQUES. Plutôt que de régénérer tous les
// assets en parties séparées, on DÉCOUPE le modèle chargé au vol par BANDES de
// voxels (les jambes/pattes/ailes sont proprement séparables ; le reste = corps)
// et on assemble un petit squelette THREE : chaque membre pivote autour de son
// articulation (même astuce que les vantaux du portail). Les créatures SANS
// membres (slime, fantôme, élémentaire) ne sont pas découpées : le corps entier
// reçoit une animation « logique » (rebond, flottement, rotation).
//
// Convention mesher : voxel (x,y,z-up) → monde (X=x/size−0.5, Y=z/size, Z=y/size−0.5).
// Le modèle fait face à +Z monde ; les vues posent root.rotation.y = cap.

import * as THREE from "three";
import type { VoxModel } from "./vox";
import { meshVoxModel } from "./mesher";

export type AnimKind = "biped" | "quadruped" | "critter" | "winged" | "blob" | "float" | "vortex" | "static";
export type AnimState = "idle" | "walk" | "attack" | "skill" | "hit";

const CHAR_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });

// --- spécification de découpe par type ------------------------------------
// Régions en coordonnées FINES du modèle chargé. Une région = un membre mobile
// (pivot + axe de rotation) ; tout ce qui n'appartient à aucune région forme le
// CORPS (mesh statique qui rebondit/penche par-dessus).
type Limb = { name: string; test: (x: number, y: number, z: number) => boolean; pivot: [number, number, number]; phase: number };

function bipedLimbs(sx: number, sy: number, sz: number, legTop: number): Limb[] {
  const xm = sx / 2, ym = sy / 2;
  return [
    { name: "legL", test: (x, _y, z) => z < legTop && x < xm, pivot: [sx * 0.36, ym, legTop], phase: 0 },
    { name: "legR", test: (x, _y, z) => z < legTop && x >= xm, pivot: [sx * 0.64, ym, legTop], phase: Math.PI },
  ];
}

function quadrupedLimbs(sx: number, sy: number, legTop: number): Limb[] {
  const xm = sx / 2, ym = sy / 2;
  // 4 pattes réparties par quadrant (avant/arrière × gauche/droite), démarche
  // diagonale (AVG+ARD en phase, opposés en contre-phase)
  return [
    { name: "legFL", test: (x, y, z) => z < legTop && x < xm && y >= ym, pivot: [sx * 0.36, sy * 0.68, legTop], phase: 0 },
    { name: "legFR", test: (x, y, z) => z < legTop && x >= xm && y >= ym, pivot: [sx * 0.64, sy * 0.68, legTop], phase: Math.PI },
    { name: "legBL", test: (x, y, z) => z < legTop && x < xm && y < ym, pivot: [sx * 0.36, sy * 0.32, legTop], phase: Math.PI },
    { name: "legBR", test: (x, y, z) => z < legTop && x >= xm && y < ym, pivot: [sx * 0.64, sy * 0.32, legTop], phase: 0 },
  ];
}

function wingLimbs(sx: number, sy: number, sz: number): Limb[] {
  const xm = sx / 2, ym = sy / 2, zc = sz * 0.55;
  const inner = sx * 0.16;
  return [
    { name: "wingL", test: (x, _y, z) => x < xm - inner && z > sz * 0.28, pivot: [xm - inner, ym, zc], phase: 0 },
    { name: "wingR", test: (x, _y, z) => x >= xm + inner && z > sz * 0.28, pivot: [xm + inner, ym, zc], phase: 0 },
  ];
}

function spiderLimbs(sx: number, sy: number, sz: number): Limb[] {
  const xm = sx / 2, ym = sy / 2, out = sx * 0.16;
  return [
    { name: "legL", test: (x, _y, _z) => x < xm - out, pivot: [xm - out, ym, sz * 0.28], phase: 0 },
    { name: "legR", test: (x, _y, _z) => x >= xm + out, pivot: [xm + out, ym, sz * 0.28], phase: Math.PI },
  ];
}

type Spec = { kind: AnimKind; limbs: (sx: number, sy: number, sz: number) => Limb[]; swing: number; axis: "x" | "z" };

// Par clé de modèle. `swing` = amplitude d'oscillation du membre (rad), `axis` =
// axe local de rotation (x = balancier avant/arrière, z = battement latéral).
const SPECS: Record<string, Spec> = {
  // héros : bipèdes (jambes courtes chibi z<~7)
  hero: { kind: "biped", limbs: (sx, sy, sz) => bipedLimbs(sx, sy, sz, Math.round(sz * 0.11)), swing: 0.7, axis: "x" },
  "mob-goblin": { kind: "biped", limbs: (sx, sy, sz) => bipedLimbs(sx, sy, sz, Math.round(sz * 0.18)), swing: 0.8, axis: "x" },
  "mob-orc": { kind: "biped", limbs: (sx, sy, sz) => bipedLimbs(sx, sy, sz, Math.round(sz * 0.18)), swing: 0.8, axis: "x" },
  "mob-wolf": { kind: "quadruped", limbs: (sx, sy, sz) => quadrupedLimbs(sx, sy, Math.round(sz * 0.5)), swing: 0.6, axis: "x" },
  "mob-spider": { kind: "critter", limbs: (sx, sy, sz) => spiderLimbs(sx, sy, sz), swing: 0.35, axis: "x" },
  "mob-bat": { kind: "winged", limbs: (sx, sy, sz) => wingLimbs(sx, sy, sz), swing: 0.9, axis: "z" },
  // sans membres : pas de découpe, anim du corps entier
  "mob-slime": { kind: "blob", limbs: () => [], swing: 0, axis: "x" },
  "mob-ghost": { kind: "float", limbs: () => [], swing: 0, axis: "x" },
  "mob-windelemental": { kind: "vortex", limbs: () => [], swing: 0, axis: "x" },
  "mob-mushroomling": { kind: "blob", limbs: () => [], swing: 0, axis: "x" },
};

export function specForKey(key: string): Spec {
  if (key.startsWith("char-")) return SPECS.hero;
  return SPECS[key] ?? SPECS["mob-slime"]; // défaut : corps entier qui rebondit
}

// --- géométries découpées (mise en cache par clé) --------------------------
export type RiggedGeom = {
  kind: AnimKind;
  scale: number;
  axis: "x" | "z";
  swing: number;
  body: THREE.BufferGeometry;
  limbs: { name: string; geom: THREE.BufferGeometry; pivot: THREE.Vector3; phase: number }[];
};

/** Découpe un modèle voxel en corps + membres selon sa spec. */
export function splitRig(model: VoxModel, key: string, worldHeight: number): RiggedGeom {
  const spec = specForKey(key);
  const { sx, sy, sz, data } = model;
  const limbSpecs = spec.limbs(sx, sy, sz);
  const scale = worldHeight / (sz / sx);
  const toLocal = (fx: number, fy: number, fz: number) =>
    new THREE.Vector3(fx / sx - 0.5, fz / sx, fy / sx - 0.5);

  // masque d'appartenance : chaque voxel → indice de membre (ou −1 = corps)
  const owner = new Int8Array(sx * sy * sz).fill(-1);
  if (limbSpecs.length) {
    for (let z = 0; z < sz; z++)
      for (let y = 0; y < sy; y++)
        for (let x = 0; x < sx; x++) {
          const idx = x + y * sx + z * sx * sy;
          if (!data[idx]) continue;
          for (let li = 0; li < limbSpecs.length; li++)
            if (limbSpecs[li].test(x, y, z)) { owner[idx] = li; break; }
        }
  }

  const meshSubset = (keep: (i: number) => boolean): THREE.BufferGeometry => {
    const sub = new Uint8Array(sx * sy * sz);
    for (let i = 0; i < sub.length; i++) if (data[i] && keep(i)) sub[i] = data[i];
    return meshVoxModel({ ...model, data: sub }, sx).geometry;
  };

  const body = meshSubset((i) => owner[i] === -1);
  const limbs = limbSpecs.map((l, li) => ({
    name: l.name,
    geom: meshSubset((i) => owner[i] === li),
    pivot: toLocal(l.pivot[0], l.pivot[1], l.pivot[2]),
    phase: l.phase,
  }));
  return { kind: spec.kind, scale, axis: spec.axis, swing: spec.swing, body, limbs };
}

// --- instance montée dans la scène -----------------------------------------
export type Rig = {
  root: THREE.Group;        // position/rotation.y/scale posés par la vue
  tilt: THREE.Group;        // rebond/penché/lunge (procédural, échelle modèle)
  limbGroups: { group: THREE.Group; phase: number }[];
  kind: AnimKind;
  axis: "x" | "z";
  swing: number;
  mats: THREE.MeshLambertMaterial[]; // matériaux (clone pour translucidité)
};

export function buildRig(rg: RiggedGeom): Rig {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);
  root.scale.setScalar(rg.scale);
  const mats: THREE.MeshLambertMaterial[] = [];
  const addMesh = (geom: THREE.BufferGeometry, parent: THREE.Object3D) => {
    const mat = CHAR_MAT;
    const m = new THREE.Mesh(geom, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    mats.push(mat);
    return m;
  };
  addMesh(rg.body, tilt);
  const limbGroups = rg.limbs.map((l) => {
    const pivot = new THREE.Group();
    pivot.position.copy(l.pivot);
    const m = addMesh(l.geom, pivot);
    m.position.set(-l.pivot.x, -l.pivot.y, -l.pivot.z); // annule le pivot → aligné à angle 0
    tilt.add(pivot);
    return { group: pivot, phase: l.phase };
  });
  return { root, tilt, limbGroups, kind: rg.kind, axis: rg.axis, swing: rg.swing, mats };
}

// --- animation ------------------------------------------------------------
// `t` = secondes depuis le début de l'état courant ; `phase` = horloge continue
// pour l'idle/marche. Retourne rien : mute les transforms du rig.
export function applyAnim(rig: Rig, state: AnimState, t: number, clock: number, moveT: number) {
  const { tilt, limbGroups, kind, axis } = rig;
  // reset des membres
  const setLimb = (g: THREE.Group, a: number) => { g.rotation.set(0, 0, 0); if (axis === "x") g.rotation.x = a; else g.rotation.z = a; };
  tilt.position.set(0, 0, 0);
  tilt.rotation.set(0, 0, 0);
  tilt.scale.set(1, 1, 1);

  const walking = state === "walk" || moveT < 1;
  const gait = clock * 9;

  if (kind === "blob") {
    // slime / champignon : squash & stretch + petit rebond
    const b = walking ? Math.abs(Math.sin(clock * 6)) : (Math.sin(clock * 2.4) * 0.5 + 0.5);
    const sq = 1 - b * 0.18, st = 1 + b * 0.22;
    tilt.scale.set(st, sq, st);
    tilt.position.y = b * (walking ? 0.18 : 0.05);
  } else if (kind === "float") {
    // fantôme : flotte + tangue doucement
    tilt.position.y = 0.12 + Math.sin(clock * 1.8) * 0.06;
    tilt.rotation.z = Math.sin(clock * 1.3) * 0.12;
    if (walking) tilt.position.y += 0.05 + Math.abs(Math.sin(clock * 5)) * 0.05;
  } else if (kind === "vortex") {
    // élémentaire : tourne sur lui-même + ondule
    tilt.rotation.y = clock * 2.2;
    tilt.position.y = Math.sin(clock * 3) * 0.04 + (walking ? 0.06 : 0);
  } else {
    // membres (bipède/quadrupède/critter/ailé)
    if (kind === "winged") {
      // battement d'ailes permanent (plus rapide en vol/déplacement) : les deux
      // ailes battent en MIROIR (gauche +, droite −)
      const flap = Math.sin(clock * (walking ? 16 : 9)) * rig.swing;
      limbGroups.forEach((l, i) => { l.group.rotation.set(0, 0, 0); l.group.rotation.z = (i === 0 ? flap : -flap); });
      tilt.position.y = 0.1 + Math.sin(clock * 3) * 0.05; // plane
    } else if (walking) {
      const amp = rig.swing;
      // pas DISCRET (déplacement d'une case) : une foulée nette (0→π) par case,
      // pic au milieu ; sinon marche continue au gait libre
      const phase = moveT < 1 ? moveT * Math.PI : gait;
      const s = Math.sin(phase);
      for (const l of limbGroups) setLimb(l.group, Math.sin(phase + l.phase) * amp);
      tilt.position.y = Math.abs(s) * 0.07;                    // rebond de foulée
      tilt.rotation.z = s * 0.05;                              // léger roulis
      tilt.rotation.x = -0.1 * (moveT < 1 ? s : 1);            // penché en avant
    } else {
      // idle : respiration + micro-balancement des membres
      for (const l of limbGroups) setLimb(l.group, Math.sin(clock * 1.6 + l.phase) * 0.06);
      tilt.position.y = Math.sin(clock * 2) * 0.015;
    }
  }

  // couches one-shot par-dessus (attaque / compétence / touché)
  if (state === "attack") {
    // anticipation (recul + accroupi) → frappe (lunge avant + piqué) → retour
    const d = Math.min(1, t / 0.45);
    const e = d < 0.3 ? -(d / 0.3) : 1 - (d - 0.3) / 0.7; // −1 recul .. +1 avant
    tilt.position.z += e * 0.32;         // lunge le long du regard (+Z local)
    tilt.rotation.x += -e * 0.5;         // pique vers la cible
    tilt.position.y += (d < 0.3 ? -0.05 : 0.02);
  } else if (state === "skill") {
    // accroupi → jaillit + pulse d'échelle (halo géré par la vue)
    const d = Math.min(1, t / 0.7);
    const up = Math.sin(Math.min(d, 0.5) / 0.5 * Math.PI); // monte puis redescend
    tilt.position.y += up * 0.28;
    const p = 1 + up * 0.14;
    tilt.scale.multiplyScalar(p);
    tilt.rotation.y += d * (kind === "vortex" ? 0 : Math.PI * 2 * 0.15);
  } else if (state === "hit") {
    const d = Math.min(1, t / 0.3);
    tilt.position.z -= (1 - d) * 0.12;   // encaisse (recul)
    tilt.rotation.x += (1 - d) * 0.2;
  }
}

export function disposeRiggedGeom(rg: RiggedGeom) {
  rg.body.dispose();
  for (const l of rg.limbs) l.geom.dispose();
}
