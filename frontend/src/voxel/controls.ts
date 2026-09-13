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

// TORSION À DEUX DOIGTS = rotation de la vue. Les boutons ↺/↻ restent (ils sont
// le seul chemin à la souris, et le chemin accessible au clavier), mais au doigt
// la vue doit suivre la main.
//
// ⚠ ZONE MORTE, et elle n'est pas cosmétique : un pinch de zoom fait TOUJOURS
// tourner un peu l'axe des deux doigts (les pouces ne pincent pas sur une droite
// parfaite). Sans seuil, chaque zoom ferait pivoter la carte de quelques degrés
// puis la recollerait à un quart au relâchement — donc un zoom sur deux
// changerait l'orientation sans qu'on l'ait demandé. 0,22 rad ≈ 12,5°, mesuré
// au-dessus du bruit d'un pinch et bien en-dessous d'une torsion intentionnelle.
const TWIST_DEADZONE = 0.22;

export type TapInfo = { cssX: number; cssY: number; ground: THREE.Vector3 };

export class VoxelControls {
  onTap: ((t: TapInfo) => void) | null = null;
  /** "pan" (défaut) : drag déplace la cible ; "orbit" (éditeur) : drag orbite */
  mode: "pan" | "orbit" = "pan";
  private pointers = new Map<number, { x: number; y: number }>();
  private downAt: { x: number; y: number } | null = null;
  private lastPos = { x: 0, y: 0 }; // position précédente (deltas du mode orbit)
  private moved = false;
  private lastGround = new THREE.Vector3();
  private pinch: { dist0: number; zoom0: number; world0: THREE.Vector3; angle0: number; az0: number } | null = null;
  private twisting = false;
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
      this.lastPos = p;
      this.moved = false;
      this.engine.groundAt(p.x, p.y, this.lastGround);
    } else if (this.pointers.size === 2) {
      // baseline du pinch : distance, zoom et point-monde sous le MILIEU
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        dist0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        zoom0: this.engine.zoom,
        world0: this.engine.groundAt((a.x + b.x) / 2, (a.y + b.y) / 2).clone(),
        angle0: Math.atan2(b.y - a.y, b.x - a.x),
        az0: this.engine.azimuthNow,
      };
      this.twisting = false;
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
      // ROTATION d'abord : elle change ce que `groundAt` renvoie, donc elle doit
      // être posée AVANT le recollage de la cible — sinon on corrige la dérive du
      // pan avec une caméra qui n'est déjà plus celle qu'on va rendre, et la carte
      // glisse sous les doigts à chaque torsion (la leçon de MapScene, appliquée à
      // l'azimut : on ne lit jamais la caméra entre un set et un rendu).
      let dA = Math.atan2(b.y - a.y, b.x - a.x) - this.pinch.angle0;
      dA = Math.atan2(Math.sin(dA), Math.cos(dA)); // plus court chemin, jamais ±2π
      if (!this.twisting && Math.abs(dA) >= TWIST_DEADZONE) {
        // On franchit le seuil : on REBASELINE de la valeur de la zone morte,
        // sinon la vue saute de 12,5° d'un coup au moment précis où elle
        // s'anime — le geste paraîtrait cassé au démarrage.
        const sign = Math.sign(dA);
        this.pinch.angle0 += sign * TWIST_DEADZONE;
        dA -= sign * TWIST_DEADZONE;
        this.twisting = true;
      }
      // Le sens suit les boutons : ↻ (« pivoter à droite ») fait `azimut + π/2`,
      // et une torsion horaire à l'écran fait croître atan2 (l'axe Y des
      // pointeurs pointe vers le BAS). Les deux chemins tournent donc pareil.
      if (this.twisting) this.engine.setAzimuth(this.pinch.az0 + dA);
      // mapping ABSOLU : zoom posé depuis la baseline…
      this.engine.zoom = Math.min(this.engine.maxZoom, Math.max(this.engine.minZoom, this.pinch.zoom0 * (dist / this.pinch.dist0)));
      // …puis cible posée pour remettre world0 sous le milieu courant. Avec la
      // rotation déjà appliquée, le point saisi reste sous les doigts : la vue
      // pivote AUTOUR DE LA MAIN, pas autour du centre de l'écran.
      const now = this.engine.groundAt(mid.x, mid.y);
      this.engine.target.add(this.pinch.world0.clone().sub(now));
      this.engine.invalidate();
      return;
    }
    if (this.pointers.size === 1 && this.downAt) {
      if (Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > TAP_SLOP_CSS) this.moved = true;
      if (this.moved && this.mode === "orbit") {
        const dx = p.x - this.lastPos.x, dy = p.y - this.lastPos.y;
        this.engine.orbitBy(-dx * 0.008, dy * 0.006);
        this.lastPos = p;
        return;
      }
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
    if (this.pointers.size < 2) {
      this.pinch = null;
      if (this.twisting) {
        this.twisting = false;
        // ⚠ jamais en mode "orbit" : l'éditeur veut justement un azimut libre,
        // et le recoller au quart lui retirerait sa raison d'être.
        if (this.mode === "pan") this.engine.snapAzimuth();
      }
    }
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
