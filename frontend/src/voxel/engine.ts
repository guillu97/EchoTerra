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
  /** élévation caméra (rad) — ELEVATION dimétrique par défaut, modifiable en orbite libre */
  elevation = ELEVATION;
  onFrame: ((info: { calls: number; triangles: number; ms: number }) => void) | null = null;

  private azimuth = azimuthFor(0);
  private sun: THREE.DirectionalLight | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  /** progression du cycle solaire 0..1 (0 = aube après la vague, 1 = vague imminente) */
  private dayTime = 0.35;
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

  /**
   * Éclairage pastel storybook (passe beauté 2026-07-17) :
   * - hémisphérique crème (ciel) → lavande (rebond sol) : le dégradé pastel ;
   * - soleil directionnel chaud FIXE DANS LE MONDE (les ombres tournent avec la
   *   rotation de caméra — correct et lisible) avec OMBRES PORTÉES douces ;
   * - tone mapping ACES : compresse les hautes lumières, adoucit l'ensemble.
   * Les matériaux voxel sont des Lambert `vertexColors` ; l'ombrage cuit du
   * mesher a été réduit en conséquence. `shadowSpan` = demi-étendue (unités
   * monde) de la boîte d'ombre, à dimensionner par vue (combat 8, ville 30…).
   */
  enableLighting({ shadowSpan = 40 }: { shadowSpan?: number } = {}) {
    if (this.sun) return;
    // ciel quasi neutre + rebond lavande : le soleil apporte seulement une
    // pointe de chaleur — un couple trop chaud tirait les verts vers l'olive
    // légèrement moins d'ambiant : la surexposition délavait les couleurs
    // exposition recalée (2026-07-19 « pas assez coloré ») : l'ancien couple
    // 1.2 + 1.7 clampait les faces du dessus à blanc et délavait TOUTES les
    // couleurs — total visé ≈ 1.4 au zénith, mêmes rapports soleil/ciel
    const hemi = new THREE.HemisphereLight(0xf7f5ff, 0xcfc2e8, 0.75);
    this.scene.add(hemi);
    this.hemi = hemi;
    const sun = new THREE.DirectionalLight(0xfff2e0, 1.05);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); // 1024 fourmillait sur mobile (DPR 3)
    sun.shadow.camera.left = -shadowSpan;
    sun.shadow.camera.right = shadowSpan;
    sun.shadow.camera.top = shadowSpan;
    sun.shadow.camera.bottom = -shadowSpan;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 500;
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // la passe d'ombres ne se re-rend QUE quand cible/soleil/contenu changent
    // (la boucle continue des nuages re-rendait 2048² à CHAQUE frame → lag au
    // pan de la ville) ; les vues appellent refreshShadows() sur leurs rebuilds
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    // pas de tone mapping agressif : il boueusait les pastels — les intensités
    // hémisphérique/soleil sont calibrées pour que les faces du dessus gardent
    // ~la luminosité des palettes d'origine
    this.invalidate();
  }

  /** applique zoom + azimut + cible à la caméra (avant chaque rendu) */
  private applyCamera() {
    this.camera.zoom = this.zoom;
    const [dx, dy, dz] = cameraDir(this.azimuth, this.elevation);
    this.camera.position.set(
      this.target.x + dx * CAM_DIST,
      this.target.y + dy * CAM_DIST,
      this.target.z + dz * CAM_DIST,
    );
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    // le soleil (et sa boîte d'ombre) suit la cible : le pan ne sort jamais de
    // l'ombre — et sa POSITION dans le ciel suit le cycle du jour (setDayTime)
    if (this.sun) {
      const t = this.dayTime;
      // arc dans le ciel : est → zénith → couchant ; il descend vers la vague
      const az = -1.0 + t * 1.9; // rad, autour de la direction de base
      const el = 0.42 + Math.sin(Math.min(1, t / 0.85) * Math.PI) * 0.55 - Math.max(0, t - 0.85) * 1.2;
      const d = 180;
      this.sun.position.set(
        this.target.x + Math.sin(az) * Math.cos(el) * d,
        this.target.y + Math.max(0.12, Math.sin(el)) * d,
        this.target.z - Math.cos(az) * Math.cos(el) * d,
      );
      this.sun.target.position.copy(this.target);
      this.sun.target.updateMatrixWorld();
    }
  }

  /**
   * Cycle solaire piloté par LE TIMER DE VAGUE (t = 0 aube après la vague,
   * t = 1 vague imminente) : le soleil parcourt son arc et la lumière glisse
   * de l'aube dorée au plein jour, puis à un crépuscule mauve menaçant.
   */
  setDayTime(t: number) {
    this.dayTime = Math.min(1, Math.max(0, t));
    if (!this.sun || !this.hemi) return;
    const ramp = (stops: [number, number][], x: number): number => {
      for (let i = 1; i < stops.length; i++) {
        if (x <= stops[i][0]) {
          const [x0, v0] = stops[i - 1];
          const [x1, v1] = stops[i];
          const k = (x - x0) / (x1 - x0);
          return v0 + (v1 - v0) * Math.min(1, Math.max(0, k));
        }
      }
      return stops[stops.length - 1][1];
    };
    const lerpColor = (stops: [number, number][][], x: number) =>
      new THREE.Color(ramp(stops[0], x), ramp(stops[1], x), ramp(stops[2], x));
    // couleurs (0..1 par canal) : aube dorée-orangée → jour neutre chaud →
    // heure dorée → crépuscule MAUVE marqué (la vague approche, ça se voit)
    this.sun.color = lerpColor(
      [
        [[0, 1.0], [0.2, 1.0], [0.6, 1.0], [0.85, 1.0], [1, 0.8]],
        [[0, 0.7], [0.2, 0.95], [0.6, 0.95], [0.85, 0.76], [1, 0.5]],
        [[0, 0.45], [0.2, 0.88], [0.6, 0.88], [0.85, 0.52], [1, 0.62]],
      ],
      this.dayTime,
    );
    this.sun.intensity = ramp([[0, 0.85], [0.25, 1.05], [0.7, 1.05], [1, 0.6]], this.dayTime);
    this.hemi.color = lerpColor(
      [
        [[0, 1.0], [0.25, 0.97], [0.7, 0.97], [1, 0.6]],
        [[0, 0.86], [0.25, 0.96], [0.7, 0.96], [1, 0.56]],
        [[0, 0.78], [0.25, 1.0], [0.7, 1.0], [1, 0.88]],
      ],
      this.dayTime,
    ); // ciel : pêche d'aube → neutre → indigo crépusculaire
    this.hemi.intensity = ramp([[0, 0.7], [0.5, 0.75], [1, 0.58]], this.dayTime);
    this.invalidate();
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
    this.elevation = ELEVATION; // une rotation "jeu" reprend l'angle dimétrique
    this.invalidate();
  }

  /** orbite LIBRE (éditeur) : delta d'azimut/élévation, sans animation */
  orbitBy(dAz: number, dEl: number) {
    this.rotAnim = null;
    this.azimuth += dAz;
    this.elevation = Math.min(Math.PI / 2 - 0.05, Math.max(0.08, this.elevation + dEl));
    this.invalidate();
  }

  private lastShadowKey = "";

  /** force une re-render de la passe d'ombres (contenu statique modifié) */
  refreshShadows() {
    this.renderer.shadowMap.needsUpdate = true;
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
      if (this.sun) {
        const k = `${this.target.x.toFixed(2)},${this.target.y.toFixed(2)},${this.target.z.toFixed(2)},${this.dayTime.toFixed(3)}`;
        if (k !== this.lastShadowKey) {
          this.lastShadowKey = k;
          this.renderer.shadowMap.needsUpdate = true; // pan/cycle solaire : ombres à jour
        }
      }
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

  /** azimut caméra courant (rad) — pour orienter les modèles face caméra */
  get azimuthNow(): number {
    return this.azimuth;
  }
}
