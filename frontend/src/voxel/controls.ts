// Contrôles tactiles/souris du moteur voxel : pan 1 doigt, molette ancrée au
// curseur, PINCH EN MAPPING ABSOLU depuis la baseline (la leçon durement
// apprise de MapScene : jamais d'incréments — zoom = zoomDépart × dist/distDépart
// et la cible est POSÉE pour recoller le point-monde de départ sous le milieu
// courant → zéro dérive par construction), tap si déplacement < TAP_SLOP.
//
// Toute la math écran↔monde passe par engine.groundAt (plan y=0) calculée sur
// l'état caméra COURANT avant de le modifier — l'équivalent du zoomBy manuel de
// MapScene (on ne lit jamais la caméra entre un set et un rendu).

import * as THREE from "three";
import type { VoxelEngine } from "./engine";

// Seuil tap-vs-drag : MapScene utilise 10×DPR en px PHYSIQUES (pointeurs
// Phaser) ; les pointeurs DOM sont en px CSS → l'équivalent exact est 10px CSS.
const TAP_SLOP_CSS = 10;

export type TapInfo = { cssX: number; cssY: number; ground: THREE.Vector3 };

export class VoxelControls {
  onTap: ((t: TapInfo) => void) | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private downAt: { x: number; y: number } | null = null;
  private moved = false;
  private lastGround = new THREE.Vector3();
  private pinch: { dist0: number; zoom0: number; world0: THREE.Vector3 } | null = null;
  private el: HTMLElement;
  private abort = new AbortController();

  constructor(private engine: VoxelEngine) {
    this.el = engine.renderer.domElement;
    const s = { signal: this.abort.signal };
    this.el.addEventListener("pointerdown", this.onDown, s);
    this.el.addEventListener("pointermove", this.onMove, s);
    this.el.addEventListener("pointerup", this.onUp, s);
    this.el.addEventListener("pointercancel", this.onUp, s);
    this.el.addEventListener("wheel", this.onWheel, { passive: false, ...s });
  }
  dispose() {
    this.abort.abort();
  }

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent) => {
    this.el.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      this.downAt = p;
      this.moved = false;
      this.engine.groundAt(p.x, p.y, this.lastGround);
    } else if (this.pointers.size === 2) {
      // baseline du pinch : distance, zoom et point-monde sous le MILIEU
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        dist0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        zoom0: this.engine.zoom,
        world0: this.engine.groundAt((a.x + b.x) / 2, (a.y + b.y) / 2).clone(),
      };
      this.downAt = null; // deux doigts = jamais un tap
    }
  };

  private onMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // mapping ABSOLU : zoom posé depuis la baseline…
      this.engine.zoom = Math.min(this.engine.maxZoom, Math.max(this.engine.minZoom, this.pinch.zoom0 * (dist / this.pinch.dist0)));
      // …puis cible posée pour remettre world0 sous le milieu courant
      const now = this.engine.groundAt(mid.x, mid.y);
      this.engine.target.add(this.pinch.world0.clone().sub(now));
      this.engine.invalidate();
      return;
    }
    if (this.pointers.size === 1 && this.downAt) {
      if (Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > TAP_SLOP_CSS) this.moved = true;
      if (this.moved) {
        // pan "attrape le sol" : le point-monde saisi reste sous le doigt
        const now = this.engine.groundAt(p.x, p.y);
        this.engine.target.add(this.lastGround.clone().sub(now));
        this.engine.invalidate();
        // lastGround reste le point saisi : il est recalculé À CHAQUE événement
        // sur la caméra déjà déplacée → pas d'accumulation d'erreur
        this.engine.groundAt(p.x, p.y, this.lastGround);
      }
    }
  };

  private onUp = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 1) {
      // retour à un doigt : re-saisir le sol pour un pan sans saut
      const [rest] = [...this.pointers.values()];
      this.engine.groundAt(rest.x, rest.y, this.lastGround);
      this.downAt = null;
    }
    if (this.pointers.size === 0 && p && this.downAt && !this.moved) {
      this.onTap?.({ cssX: p.x, cssY: p.y, ground: this.engine.groundAt(p.x, p.y).clone() });
    }
    if (this.pointers.size === 0) this.downAt = null;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    const before = this.engine.groundAt(p.x, p.y).clone();
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.engine.zoom = Math.min(this.engine.maxZoom, Math.max(this.engine.minZoom, this.engine.zoom * factor));
    const after = this.engine.groundAt(p.x, p.y);
    this.engine.target.add(before.sub(after)); // le point sous le curseur ne bouge pas
    this.engine.invalidate();
  };
}
