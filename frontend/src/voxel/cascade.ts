// Cascade (lot D4 du WORLD-DETAILS-PLAN) — REPÈRE : 1 par carte si la géo s'y
// prête. Détection PURE (falaise de relief ≥ 2 bordant une tuile d'eau
// découverte, choisie par hachage de la seed comme les landmarks) + rideau
// d'eau vertical en ShaderMaterial : bandes qui défilent vers le bas, écume au
// pied. Le temps avance comme le shader d'eau : sur les frames RENDUES
// (rendu on-demand — le tick solaire de 5 s et toute interaction l'animent).

import * as THREE from "three";
import type { ScatterSource, ScatterTile } from "./scatter";

const GROUND_LEVEL = 3;
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

/** tuile falaise (x,y) + direction (dx,dy) vers l'eau qu'elle surplombe */
export type CascadeSite = { x: number; y: number; dx: number; dy: number };

export function findCascadeSite(src: ScatterSource): CascadeSite | null {
  const { width, height, tiles } = src;
  const at = (x: number, y: number): ScatterTile | undefined =>
    x >= 0 && y >= 0 && x < width && y < height ? tiles[y * width + x] : undefined;
  const seed = strHash(src.seedStr) ^ 0x5eed;
  let best: { site: CascadeSite; score: number } | null = null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = tiles[y * width + x];
      if (!t.discovered || relief(t) < 2) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = at(x + dx, y + dy);
        if (!n?.discovered || n.biome !== 0) continue;
        const score = h01(x * 4 + dx, y * 4 + dy, seed);
        if (!best || score > best.score) best = { site: { x, y, dx, dy }, score };
      }
    }
  }
  return best?.site ?? null;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  // bandes verticales qui DESCENDENT (phase −y avec le temps) + colonnes
  float bands = 0.5 + 0.5 * sin((vUv.y * 5.0 + uTime * 0.9 + sin(vUv.x * 14.0) * 0.12) * 6.2831);
  float cols = 0.72 + 0.28 * sin(vUv.x * 34.0 + sin(vUv.x * 9.0) * 2.6);
  vec3 base = mix(vec3(0.58, 0.78, 0.90), vec3(0.94, 0.98, 1.0), bands * cols);
  float foam = smoothstep(0.20, 0.0, vUv.y); // écume au pied
  base = mix(base, vec3(1.0), foam * 0.75);
  float alpha = 0.5 + 0.28 * bands * cols;
  alpha = mix(alpha, 0.92, foam);
  alpha *= smoothstep(1.0, 0.9, vUv.y); // fondu au débordement du sommet
  gl_FragColor = vec4(base, alpha);
}`;

export type Cascade = { group: THREE.Group; setTime: (s: number) => void; dispose: () => void };

/** construit le rideau + l'écume au pied, posé sur la face de falaise du site */
export function buildCascade(site: CascadeSite, heightAt: (x: number, y: number) => number): Cascade {
  const { x, y, dx, dy } = site;
  // le lissage étale la falaise en TERRASSES : on échantillonne la traversée
  // falaise→eau et le rideau couvre la chute COMPLÈTE (sommet local → eau),
  // pas seulement la dernière marche
  let top = -Infinity, base = Infinity;
  for (const k of [0.05, 0.15, 0.25, 0.35, 0.45]) top = Math.max(top, heightAt(x + dx * k, y + dy * k));
  for (const k of [0.7, 0.85, 0.95]) base = Math.min(base, heightAt(x + dx * k, y + dy * k));
  const h = Math.max(0.6, top - base);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(0.72, h), mat);
  // au milieu de l'arête partagée, poussé de 3 cm vers l'eau (anti z-fighting)
  curtain.position.set(x + dx * 0.53, base + h / 2, y + dy * 0.53);
  curtain.rotation.y = Math.atan2(dx, dy);
  const foam = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xeef7fc, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  foam.position.set(x + dx * 0.75, base + 0.02, y + dy * 0.75);
  const group = new THREE.Group();
  group.add(curtain, foam);
  return {
    group,
    setTime: (s) => { mat.uniforms.uTime.value = s; },
    dispose: () => {
      curtain.geometry.dispose();
      mat.dispose();
      foam.geometry.dispose();
      (foam.material as THREE.Material).dispose();
    },
  };
}
