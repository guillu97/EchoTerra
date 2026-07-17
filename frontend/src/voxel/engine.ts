// Moteur de rendu voxel partagé (Map monde / Combat / Home / éditeur).
// - Rendu ON-DEMAND : rien ne tourne au repos (batterie mobile) — appeler
//   invalidate() après tout changement ; une transition anime via invalidate
//   en chaîne jusqu'à échéance.
// - Caméra ORTHOGRAPHIQUE dimétrique (élévation 30° → mêmes proportions 2:1
//   que l'iso Phaser), azimut = orientation × 90° + 45°, animé au changement.
// - Canvas en PIXELS PHYSIQUES (DPR plafonné, cf. game/dpr.ts) ; le frustum est
//   exprimé en px CSS et `zoom` = px CSS par unité monde → la math écran↔monde
//   des contrôles est triviale et exacte.

import * as THREE from "three";
import { DPR } from "../game/dpr";
import { azimuthFor, cameraDir, ELEVATION, nextOrientation, type Orientation } from "./rotation";

const CAM_DIST = 300; // recul arbitraire (ortho : seule la direction compte)
const ROT_MS = 240; // durée de l'animation de rotation

export class VoxelEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  /** point regardé, sur le plan du sol (y = 0) */
  readonly target = new THREE.Vector3();
  orientation: Orientation = 0;
  zoom = 48; // px CSS par unité monde (1 unité = 1 bloc)
  minZoom = 12;
  maxZoom = 220;
  onFrame: ((info: { calls: number; triangles: number; ms: number }) => void) | null = null;

  private azimuth = azimuthFor(0);
  private rotAnim: { from: number; to: number; t0: number } | null = null;
  private raf = 0;
  private ro: ResizeObserver;
  private cssW = 1;
  private cssH = 1;

  constructor(readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(DPR);
    this.renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:none";
    host.appendChild(this.renderer.domElement);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.cssW = w;
    this.cssH = h;
    this.renderer.setSize(w, h, false); // false: le style CSS reste 100%
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.invalidate();
  }

  /** applique zoom + azimut + cible à la caméra (avant chaque rendu) */
  private applyCamera() {
    this.camera.zoom = this.zoom;
    const [dx, dy, dz] = cameraDir(this.azimuth);
    this.camera.position.set(
      this.target.x + dx * CAM_DIST,
      this.target.y + dy * CAM_DIST,
      this.target.z + dz * CAM_DIST,
    );
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** point du plan sol (y=0) sous un point écran (px CSS relatifs au canvas) */
  groundAt(cssX: number, cssY: number, out = new THREE.Vector3()): THREE.Vector3 {
    this.applyCamera();
    const ndc = new THREE.Vector2((cssX / this.cssW) * 2 - 1, -(cssY / this.cssH) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    ray.ray.intersectPlane(plane, out);
    return out;
  }

  /** raycast complet dans la scène (picking) */
  pick(cssX: number, cssY: number): THREE.Intersection[] {
    this.applyCamera();
    const ndc = new THREE.Vector2((cssX / this.cssW) * 2 - 1, -(cssY / this.cssH) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray.intersectObjects(this.scene.children, true);
  }

  setOrientation(o: Orientation) {
    if (o === this.orientation) return;
    this.rotAnim = { from: this.azimuth, to: azimuthFor(o), t0: performance.now() };
    this.orientation = o;
    this.invalidate();
  }
  rotate(dir: 1 | -1 = 1) {
    // vise l'azimut voisin en continu (pas de saut si on enchaîne les rotations)
    const from = this.azimuth;
    this.orientation = nextOrientation(this.orientation, dir);
    this.rotAnim = { from, to: from + (dir * Math.PI) / 2, t0: performance.now() };
    this.invalidate();
  }

  /** demande UN rendu (déduplique) ; les animations ré-invalident elles-mêmes */
  invalidate() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const t0 = performance.now();
      if (this.rotAnim) {
        const k = Math.min(1, (t0 - this.rotAnim.t0) / ROT_MS);
        const e = 1 - (1 - k) * (1 - k); // ease-out
        this.azimuth = this.rotAnim.from + (this.rotAnim.to - this.rotAnim.from) * e;
        if (k >= 1) {
          this.azimuth = azimuthFor(this.orientation);
          this.rotAnim = null;
        } else this.invalidate();
      }
      this.applyCamera();
      this.renderer.render(this.scene, this.camera);
      this.onFrame?.({
        calls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        ms: performance.now() - t0,
      });
    });
  }

  /** hauteur apparente (px CSS) d'une unité monde verticale — pour l'UI */
  get elevationPx(): number {
    return this.zoom * Math.sin(ELEVATION);
  }
}
