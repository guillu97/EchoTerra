// Nuages qui PASSENT au-dessus de la carte et de la ville (2026-07-19).
// Anti-pattern par construction :
//  - vitesse, altitude, taille, miroir et cap (vent ±9°) propres à CHAQUE nuage ;
//  - quand un nuage boucle sa traversée, son COULOIR, son altitude et son
//    échelle sont RE-TIRÉS (hachés par numéro de tour) — un nuage qui revient
//    n'emprunte jamais deux fois la même trajectoire ;
//  - les entrées/sorties se font aux marges du span, hors du regard.
// Les nuages sont des .vox solides self-lit (le diorama assume), castShadow :
// leurs ombres glissent sur le terrain. Le temps est CONTINU (setTime à chaque
// frame rendue — les vues animent via rAF quand elles sont visibles).

import * as THREE from "three";
import type { BlockLibrary } from "./terrain";

export type Clouds = {
  group: THREE.Group;
  setTime: (s: number) => void;
  dispose: () => void;
};

const CLOUD_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });

// ombre FACTICE : tache radiale douce posée PILE sous le nuage (l'ombre solaire
// projetée atterrissait à altitude/tan(élévation) du nuage — trop décalée — et
// forçait une re-render de la shadow map à chaque frame)
let blobTex: THREE.Texture | null = null;
function blobTexture(): THREE.Texture {
  if (blobTex) return blobTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, "rgba(40,44,64,0.42)");
  g.addColorStop(0.7, "rgba(40,44,64,0.2)");
  g.addColorStop(1, "rgba(40,44,64,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

/** Fraction de la demi-maille sur laquelle un nuage s'estompe avant de reboucler. */
const FADE = 0.15;

/** ramène `v` dans l'intervalle de largeur `span` centré sur `c` (modulo signé) */
function wrap(v: number, c: number, span: number): number {
  return c + (((v - c + span / 2) % span) + span) % span - span / 2;
}

function h01(i: number, s: number): number {
  let h = (i * 374761393 + s * 668265263) >>> 0;
  h = ((h ^ (h >> 13)) * 1274126177) >>> 0;
  return ((h >>> 16) & 0xffff) / 0x10000;
}

export function makeClouds(
  lib: BlockLibrary,
  opts: {
    count: number;
    cx: number; // centre de la zone survolée (coords monde)
    cy: number;
    span: number; // longueur de la traversée (zone + marges)
    altitude: [number, number];
    speed: [number, number]; // unités monde / seconde
    scale: [number, number];
    seed: number;
    /** hauteur du sol sous (x,z) — les ombres factices s'y posent */
    groundAt?: (x: number, z: number) => number;
    /** cap du vent imposé (rad). La météo d'un thème (weather.ts) le partage entre
     *  le pont de nuages, la chute des flocons et les vire-vents : c'est là que se
     *  voit la cohérence. Absent = cap dérivé de la graine, comme avant. */
    wind?: number;
    /**
     * REBOUCLAGE autour d'un point (typiquement `engine.skyCentre(altitude)`) —
     * la façon de couvrir une grande carte avec une douzaine de nuages SANS que le
     * ciel suive le regard.
     *
     * Chaque nuage garde sa position MONDE (il ne dérive qu'au vent) tant qu'il
     * reste dans la boîte de côté `span` centrée là ; en sortant, il est reporté
     * d'un span entier de l'autre côté — un saut, mais très en dehors du cadre,
     * puisque la boîte fait deux fois la vue. C'est le `mod` du shader de neige,
     * appliqué à des objets.
     *
     * ⚠ le centre doit être celui de la PROJECTION à l'altitude des nuages, pas la
     * cible caméra : en dimétrique un objet en l'air se dessine ~1,73 × son
     * altitude plus haut, donc une boîte centrée sur la cible ferait reboucler des
     * nuages ENCORE VISIBLES. D'où `VoxelEngine.skyCentre`.
     */
    wrapAround?: () => { x: number; z: number };
  },
): Clouds {
  const group = new THREE.Group();
  const wind = opts.wind ?? h01(1, opts.seed) * Math.PI * 2; // cap général du vent, par partie
  // ⚠ UN REBOUCLAGE EST INVISIBLE S'IL SE FAIT À OPACITÉ NULLE — et c'est la SEULE
  // façon de le garantir. La géométrie ne suffit pas : un nuage qui saute d'un span
  // traverse une distance comparable à ce que le cadre couvre, donc il peut sortir
  // « très loin d'un côté » et atterrir « juste au bord de l'autre » (mesuré : ndc.y
  // −1,27, soit un gros nuage à moitié dans l'image). Reculer la frontière ne fait
  // que déplacer le problème, et au zoom le plus large aucune frontière ne tient.
  // Les nuages de bord s'estompent donc sur les derniers 25 % de la maille : ils
  // paraissent se perdre dans la brume, et le saut a lieu quand ils sont éteints.
  const fading = !!opts.wrapAround;
  const items: { mesh: THREE.Mesh; blob: THREE.Mesh | null; i: number; speed: number; off: number; dirX: number; dirZ: number; perX: number; perZ: number; lap: number }[] = [];
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false });
  for (let i = 0; i < opts.count; i++) {
    const geom = lib.get("cloud", i % 3);
    if (!geom) continue;
    // matériau propre au nuage quand il s'estompe (sinon tous partageraient la même
    // opacité) ; sinon on garde LE matériau commun, gratuit.
    const mat = fading ? CLOUD_MAT.clone() : CLOUD_MAT;
    if (fading) { mat.transparent = true; mat.depthWrite = false; }
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.ownMat = fading;
    mesh.name = "cloud"; // scène AUDITABLE (cf. tests/proportions.mjs)
    mesh.castShadow = false; // l'ombre est la tache factice, pas la passe soleil
    const a = wind + (h01(i, opts.seed + 2) - 0.5) * 0.32; // ±9° par nuage
    let blob: THREE.Mesh | null = null;
    if (opts.groundAt) {
      blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), blobMat);
      group.add(blob);
    }
    items.push({
      mesh, blob, i,
      speed: opts.speed[0] + h01(i, opts.seed + 3) * (opts.speed[1] - opts.speed[0]),
      off: h01(i, opts.seed + 4), // départ étalé sur toute la traversée
      dirX: Math.cos(a), dirZ: Math.sin(a),
      perX: -Math.sin(a), perZ: Math.cos(a),
      lap: -1,
    });
    group.add(mesh);
  }
  const applyLap = (it: (typeof items)[number], lap: number) => {
    it.lap = lap;
    const sc = opts.scale[0] + h01(it.i * 13 + lap, opts.seed + 5) * (opts.scale[1] - opts.scale[0]);
    it.mesh.scale.set(h01(it.i * 17 + lap, opts.seed + 6) < 0.5 ? -sc : sc, sc, sc);
    it.blob?.scale.set(sc * 0.9, 1, sc * 0.7);
  };
  const setTime = (s: number) => {
    const c = opts.wrapAround?.();
    for (const it of items) {
      const travel = s * it.speed + it.off * opts.span;
      const lap = Math.floor(travel / opts.span);
      if (lap !== it.lap) applyLap(it, lap); // nouveau passage → nouvelle silhouette
      const u = travel - lap * opts.span - opts.span / 2; // −span/2 .. +span/2
      const lane = (h01(it.i * 7 + lap, opts.seed + 7) - 0.5) * opts.span * 0.85;
      const alt = opts.altitude[0] + h01(it.i * 11 + lap, opts.seed + 8) * (opts.altitude[1] - opts.altitude[0]);
      let px = opts.cx + it.dirX * u + it.perX * lane;
      let pz = opts.cy + it.dirZ * u + it.perZ * lane;
      if (c) {
        px = wrap(px, c.x, opts.span);
        pz = wrap(pz, c.z, opts.span);
        // distance au centre, normalisée sur la demi-maille : 1 = la frontière.
        const t = Math.max(Math.abs(px - c.x), Math.abs(pz - c.z)) / (opts.span / 2);
        const m = it.mesh.material as THREE.MeshBasicMaterial;
        m.opacity = Math.min(1, Math.max(0, (1 - t) / FADE));
        m.visible = m.opacity > 0.01; // un nuage éteint ne coûte pas un draw call
      }
      it.mesh.position.set(px, alt, pz);
      if (it.blob && opts.groundAt) it.blob.position.set(px, opts.groundAt(px, pz) + 0.05, pz);
    }
  };
  setTime(performance.now() / 1000);
  return {
    group,
    setTime,
    dispose: () => {
      for (const it of items) if (it.mesh.userData.ownMat) (it.mesh.material as THREE.Material).dispose();
      group.clear();
    },
  };
}
