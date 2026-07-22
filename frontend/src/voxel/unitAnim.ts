// Registre + boucle d'animation des unités voxel (héros/monstres), partagé par
// la carte, le combat et la ville. Les vues RECONSTRUISENT leurs meshes à chaque
// draw ; l'animator garde l'ÉTAT par id (phase d'idle, déplacement en cours,
// one-shot d'attaque/compétence) à travers ces reconstructions et pilote chaque
// frame les transforms du rig. Une seule boucle rAF invalide le moteur tant
// qu'il reste des unités et que l'onglet est visible.

import * as THREE from "three";
import type { Rig, AnimState } from "./rig";
import { applyAnim } from "./rig";

type Unit = {
  rig: Rig;
  x: number; z: number; baseY: number;       // pose monde cible
  px: number; pz: number; pby: number;        // pose précédente (pour le lerp de déplacement)
  moveStart: number;                          // ms du début du pas (0 = immobile)
  state: AnimState; stateStart: number;       // one-shot courant
  clock0: number;                             // origine d'horloge (phase idle stable par unité)
  faceCamera: boolean;
  facingY: number;                            // cap fixe (combat) si !faceCamera
};

const MOVE_MS = 320;
const HOP = 0.12;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class UnitAnimator {
  private units = new Map<string, Unit>();
  private seen = new Set<string>();
  private raf = 0;
  private clockHash = 0;

  constructor(
    private engine: { invalidate(): void; azimuthNow: number },
    private now: () => number = () => performance.now(),
  ) {}

  /** Début de passe de draw : marque toutes les unités absentes jusqu'au sync. */
  beginFrame() { this.seen.clear(); }

  /** Enregistre/rafraîchit une unité (rig reconstruit à chaque draw). */
  sync(id: string, rig: Rig, x: number, baseY: number, z: number, opts: { faceCamera?: boolean; facingY?: number } = {}) {
    this.seen.add(id);
    const prev = this.units.get(id);
    const t = this.now();
    if (prev) {
      const moved = prev.x !== x || prev.z !== z;
      const u: Unit = {
        ...prev, rig,
        px: prev.x, pz: prev.z, pby: prev.baseY,
        x, z, baseY,
        moveStart: moved ? t : (prev.moveStart && t - prev.moveStart < MOVE_MS ? prev.moveStart : 0),
        faceCamera: opts.faceCamera ?? prev.faceCamera,
        facingY: opts.facingY ?? prev.facingY,
      };
      // si un déplacement était déjà en cours, on repart de la pose interpolée
      if (moved && prev.moveStart && t - prev.moveStart < MOVE_MS) {
        const k = easeInOut((t - prev.moveStart) / MOVE_MS);
        u.px = prev.px + (prev.x - prev.px) * k;
        u.pz = prev.pz + (prev.z - prev.pz) * k;
        u.pby = prev.pby + (prev.baseY - prev.pby) * k;
      }
      this.units.set(id, u);
    } else {
      // nouvelle unité : horloge décalée par hachage d'id (idle désynchronisé)
      let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
      this.units.set(id, {
        rig, x, z, baseY, px: x, pz: z, pby: baseY, moveStart: 0,
        state: "idle", stateStart: 0, clock0: (h % 6280) / 1000,
        faceCamera: opts.faceCamera ?? true, facingY: opts.facingY ?? 0,
      });
    }
    this.ensureLoop();
  }

  /** Fin de passe : oublie les unités disparues de la scène. */
  endFrame() {
    for (const id of [...this.units.keys()]) if (!this.seen.has(id)) this.units.delete(id);
    if (!this.units.size && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }

  /** Déclenche une animation ponctuelle (attaque/compétence/touché). */
  trigger(id: string, state: AnimState) {
    const u = this.units.get(id);
    if (!u) return;
    u.state = state; u.stateStart = this.now();
    this.ensureLoop();
  }

  private stateDur(s: AnimState) { return s === "attack" ? 450 : s === "skill" ? 700 : s === "hit" ? 300 : 0; }

  private ensureLoop() { if (!this.raf) this.raf = requestAnimationFrame(this.tick); }

  private tick = () => {
    this.raf = 0;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      this.raf = requestAnimationFrame(this.tick); // reste armé, ne rend pas
      return;
    }
    const t = this.now();
    const clock = t / 1000;
    for (const u of this.units.values()) {
      // pose : lerp de déplacement + arc de saut
      let X = u.x, Z = u.z, Y = u.baseY;
      let moveT = 1;
      if (u.moveStart) {
        moveT = (t - u.moveStart) / MOVE_MS;
        if (moveT >= 1) { moveT = 1; u.moveStart = 0; }
        else {
          const k = easeInOut(moveT);
          X = u.px + (u.x - u.px) * k;
          Z = u.pz + (u.z - u.pz) * k;
          Y = u.pby + (u.baseY - u.pby) * k + Math.sin(moveT * Math.PI) * HOP;
        }
      }
      u.rig.root.position.set(X, Y, Z);
      if (u.faceCamera) u.rig.root.rotation.y = this.engine.azimuthNow;
      else u.rig.root.rotation.y = u.facingY;

      // état : one-shot prioritaire, sinon marche (déplacement) sinon idle
      let state: AnimState = "idle";
      let st = clock - u.clock0;
      if (u.state !== "idle") {
        const el = t - u.stateStart;
        if (el < this.stateDur(u.state)) { state = u.state; st = el / 1000; }
        else u.state = "idle";
      }
      applyAnim(u.rig, state, st, clock + u.clock0, moveT);
    }
    this.engine.invalidate();
    this.raf = requestAnimationFrame(this.tick);
  };

  dispose() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; this.units.clear(); }
}
