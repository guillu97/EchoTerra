// Registre + boucle d'animation des unités voxel (héros/monstres), partagé par
// la carte, le combat et la ville. Les vues RECONSTRUISENT leurs meshes à chaque
// draw ; l'animator garde l'ÉTAT par id (phase d'idle, déplacement en cours,
// one-shot d'attaque/compétence) à travers ces reconstructions et pilote les
// transforms du rig.
//
// QUI PILOTE LES FRAMES (2026-08-02). L'animator réarmait son rAF « tant qu'il
// reste une unité » : comme l'idle (respiration, battements d'ailes) ne s'arrête
// jamais, la CARTE rendait ~35 fps en continu dès qu'un héros existait — c'est
// à dire toujours. Sur un téléphone c'est la batterie dépensée pour un détail
// qu'on ne regarde pas, et ça contredisait le contrat « la carte est 100 %
// on-demand » (les nuages en avaient déjà été retirés pour la même raison).
//
// Deux rôles, donc, choisis par la vue à la construction :
//   - PRODUCTEUR de frames (`idleDrivesFrames: true`, défaut — combat, ville) :
//     la boucle tourne tant qu'il reste une unité, l'idle vit en permanence ;
//   - CONSOMMATEUR (`idleDrivesFrames: false` — la carte) : la boucle ne tourne
//     que tant qu'il se PASSE quelque chose (un pas, un one-shot, une mort) et
//     s'arrête ensuite. Les poses sont alors rafraîchies par `pose()`, que la
//     vue branche sur `engine.onBeforeFrame` : à chaque frame que QUELQU'UN
//     D'AUTRE demande (rotation de caméra, redraw, déplacement), les rigs sont
//     posés — mais aucune frame n'est demandée pour eux seuls.
//
// `setActive(false)` coupe tout : la carte reste MONTÉE quand on change d'onglet
// (elle est seulement masquée en CSS), sans ça elle continuait d'animer derrière
// un `visibility: hidden`.

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

// unité vaincue en train de s'effondrer (détachée du registre vivant)
type Dying = { rig: Rig; start: number; mats: THREE.Material[]; y: number };

const MOVE_MS = 320;
const HOP = 0.12;
const DEATH_MS = 850;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class UnitAnimator {
  private units = new Map<string, Unit>();
  private dying: Dying[] = [];
  private seen = new Set<string>();
  private raf = 0;
  private clockHash = 0;

  private active = true;
  private idleDrivesFrames: boolean;

  constructor(
    private engine: { invalidate(): void; azimuthNow: number },
    private now: () => number = () => performance.now(),
    opts: { idleDrivesFrames?: boolean } = {},
  ) {
    this.idleDrivesFrames = opts.idleDrivesFrames ?? true;
  }

  /** Coupe ou relance l'animation (onglet applicatif quitté : la vue reste
   *  montée mais masquée, elle ne doit plus rien animer). */
  setActive(on: boolean) {
    if (this.active === on) return;
    this.active = on;
    if (!on) {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else this.ensureLoop();
  }

  /** Y a-t-il quelque chose de TRANSITOIRE en cours ? (un pas, un one-shot, une
   *  mort) — par opposition à l'idle, qui ne finit jamais. */
  private busy(t: number) {
    if (this.dying.length) return true;
    for (const u of this.units.values()) {
      if (u.moveStart) return true;
      if (u.state !== "idle" && t - u.stateStart < this.stateDur(u.state)) return true;
    }
    return false;
  }

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
    if (!this.units.size && !this.dying.length && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }

  /** Déclenche une animation ponctuelle (attaque/compétence/touché). */
  trigger(id: string, state: AnimState) {
    const u = this.units.get(id);
    if (!u) return;
    u.state = state; u.stateStart = this.now();
    this.ensureLoop();
  }

  private stateDur(s: AnimState) { return s === "attack" ? 450 : s === "skill" ? 700 : s === "hit" ? 300 : 0; }

  /** Joue la MORT d'une unité : le rig (déjà ajouté à la scène par l'appelant)
   *  s'effondre en arrière + se fond + s'enfonce, puis est retiré et libéré.
   *  L'animator prend possession du rig (détaché du registre vivant). */
  playDeath(rig: Rig, x: number, baseY: number, z: number, facingY: number) {
    rig.root.position.set(x, baseY, z);
    rig.root.rotation.y = facingY;
    const mats: THREE.Material[] = [];
    rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material) {
        const c = (m.material as THREE.MeshLambertMaterial).clone();
        c.transparent = true;
        m.material = c;
        mats.push(c);
      }
    });
    this.dying.push({ rig, start: this.now(), mats, y: baseY });
    this.ensureLoop();
  }

  private ensureLoop() { if (!this.raf && this.active) this.raf = requestAnimationFrame(this.tick); }

  private tick = () => {
    this.raf = 0;
    if (!this.active) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      this.raf = requestAnimationFrame(this.tick); // reste armé, ne rend pas
      return;
    }
    const t = this.now();
    this.pose(t);
    this.engine.invalidate();
    // On ne DEMANDE des frames que tant qu'il se passe quelque chose. En mode
    // consommateur, l'idle seul ne réarme pas : la respiration continue de vivre
    // sur les frames demandées par d'autres (rotation, redraw), pas sur les
    // siennes.
    const keep = this.busy(t) || (this.idleDrivesFrames && this.units.size > 0);
    this.raf = keep ? requestAnimationFrame(this.tick) : 0;
  };

  /** Pose toutes les unités pour l'instant `t`. N'invalide RIEN et ne réarme
   *  RIEN — c'est ce que la carte branche sur `engine.onBeforeFrame`. */
  pose(t: number = this.now()) {
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

    // unités vaincues : bascule en arrière + fondu + enfoncement, puis retrait
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      const p = (t - d.start) / DEATH_MS;
      if (p >= 1) {
        d.rig.root.parent?.remove(d.rig.root);
        for (const m of d.mats) m.dispose();
        this.dying.splice(i, 1);
        continue;
      }
      const e = easeInOut(Math.min(1, p * 1.3)); // s'effondre un peu avant la fin
      d.rig.tilt.rotation.set(0, 0, 0);
      d.rig.tilt.rotation.x = -(Math.PI / 2) * e;      // tombe sur le dos
      d.rig.root.position.y = d.y - 0.12 * e;          // s'enfonce
      for (const m of d.mats) (m as THREE.Material).opacity = 1 - p; // se fond
    }
  }

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.units.clear();
    for (const d of this.dying) { d.rig.root.parent?.remove(d.rig.root); for (const m of d.mats) m.dispose(); }
    this.dying = [];
  }
}
