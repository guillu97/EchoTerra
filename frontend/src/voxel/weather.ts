// LA MÉTÉO D'UN THÈME (2026-08-12) — ce qui BOUGE dans un biome.
//
// Les thèmes (backend theme.go) donnaient déjà une palette, des props, des modèles, des
// armes et une contrainte de survie. Il leur manquait le mouvement : une carte nordique
// était un paysage d'hiver PARFAITEMENT IMMOBILE, un désert une étendue vide qui ne
// respirait pas. Deux effets suffisent, parce qu'ils sont ceux qu'on associe d'emblée à
// ces deux pays :
//
//   • NORDIQUE — la neige tombe, sous un ciel COUVERT. Les deux vont ensemble : de la
//     neige sous un ciel dégagé se lit comme un bug de particules. La cohérence n'est
//     pas seulement dans la présence des nuages, c'est le MÊME VENT qui porte le pont
//     de nuages et qui incline la chute des flocons — c'est ça qu'on voit.
//   • DÉSERTIQUE — des vire-vents ROULENT en travers de la carte, poussés par ce même
//     vent. Un seul objet en mouvement dans un décor immobile suffit à donner l'échelle
//     et la direction du vent.
//
// ⚠ TROIS RÈGLES DE COÛT, parce que la carte est un rendu ON-DEMAND et que les nuages
// en avaient DÉJÀ été retirés une fois pour la batterie (2026-07-19) :
//
//  1. **RIEN N'EXISTE QUAND C'EST COUPÉ.** À « Aucun » (`weatherFps` 0) on ne construit
//     pas la couche : pas de géométrie, pas de boucle, pas un redraw. Ce n'est pas une
//     animation figée — c'est l'absence. Même contrat que « Figée » côté personnages, et
//     c'est la seule façon honnête de tenir « la carte est 100 % on-demand ».
//  2. **LA CADENCE EST CHOISIE**, jamais celle de l'écran : la boucle enchaîne
//     `setTimeout(1000/fps)` → `rAF`, exactement comme le cadenceur d'idle de
//     unitAnim.ts. Un effet d'ambiance ne doit pas décider tout seul de brûler 60 fps.
//  3. **UN THÈME SANS MÉTÉO NE COÛTE RIEN.** Le tempéré ne construit rien et ne
//     télécharge pas un octet de plus.
//
// ⚠ ZÉRO TRAVAIL CPU PAR FLOCON : la chute, la dérive et le rebouclage sont dans le
// VERTEX SHADER, une seule uniforme de temps par frame. Compter à la main quelques
// milliers de flocons en JS aurait mangé le budget que le cadenceur essaie de protéger.
//
// ⚠ AUCUN OBJET DE MÉTÉO N'EST PICKABLE : `engine.pick` raycaste `scene.children`
// ENTIER — un nuage au-dessus de la tête, ou un nuage de points avec son seuil de
// raycast par défaut, intercepterait les taps de la carte et le héros ne bougerait plus.

import * as THREE from "three";
import type { BlockLibrary } from "./terrain";
import { makeClouds } from "./clouds";
import { signacify } from "./signacMaterial";

export type Weather = {
  group: THREE.Group;
  /** avance l'effet à l'instant `s` (secondes) */
  setTime: (s: number) => void;
  dispose: () => void;
};

export type WeatherOpts = {
  /** centre de la zone couverte (coords monde) */
  cx: number;
  cy: number;
  /** côté de la zone couverte */
  span: number;
  /** graine stable (id de partie) : deux sessions voient la même météo */
  seed: number;
  /** hauteur du sol — les vire-vents roulent dessus */
  groundAt?: (x: number, z: number) => number;
  /** un vire-vent ne roule pas sur l'eau */
  passable?: (x: number, z: number) => boolean;
  /** Les vire-vents ont-ils leur place ici ? Faux pour la vue VILLE : le tertre
   *  est couvert de bâtiments, de clôtures et de mobilier, et rien ne dit à une
   *  boule qui roule de les contourner — elle les TRAVERSAIT. Le décor de la ville
   *  est trop dense pour un objet libre, et lui inventer une carte d'obstacles
   *  coûterait plus que ce que l'effet rapporte à cette échelle. */
  tumbleweeds?: boolean;
  /** ce que la caméra regarde : centre visé (monde) + taille de la vue (px) et
   *  échelle (px par unité monde). La colonne de neige s'en sert pour SUIVRE le
   *  regard et pour tenir une densité à l'écran constante. */
  view?: () => { x: number; z: number; w: number; h: number; ppu: number };
};

function h01(i: number, s: number): number {
  let h = (i * 374761393 + s * 668265263) >>> 0;
  h = ((h ^ (h >> 13)) * 1274126177) >>> 0;
  return ((h >>> 16) & 0xffff) / 0x10000;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** rend un objet totalement invisible au raycast (cf. l'avertissement d'en-tête) */
function unpickable<T extends THREE.Object3D>(o: T): T {
  o.raycast = () => undefined;
  return o;
}

// ── NEIGE ────────────────────────────────────────────────────────────────────
// Nuage de points : chaque flocon garde sa position de DÉPART en attribut et le
// shader en déduit sa position courante. `mod` sur la hauteur = rebouclage sans
// fin ; `mod` sur l'horizontale = la dérive du vent ne vide jamais la boîte.
//
// Les flocons passés SOUS le terrain sont éliminés par le test de profondeur : on
// obtient gratuitement l'impression qu'ils se posent, sans un octet de logique.
const SNOW_VS = `
uniform float uTime;
uniform float uSize;
uniform float uHeight;
uniform float uSpan;
uniform vec2  uWind;
attribute float aPhase;
attribute float aSpeed;
varying float vFade;
void main() {
  vec3 p = position;
  // chute + rebouclage vertical
  p.y = mod(p.y - uTime * aSpeed, uHeight);
  // dérive du vent + flottement propre au flocon, rebouclés dans la boîte
  vec2 drift = uWind * uTime + vec2(sin(uTime * 0.7 + aPhase), cos(uTime * 0.53 + aPhase * 1.7)) * 0.6;
  p.xz = mod(p.xz + drift + uSpan * 0.5, uSpan) - uSpan * 0.5;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (0.65 + 0.5 * fract(aPhase * 3.1));
  // les flocons du haut de la boîte s'estompent : la neige n'a pas de plafond net
  vFade = 1.0 - smoothstep(uHeight * 0.72, uHeight, p.y);
}`;

// ⚠ UN FLOCON BLANC SUR UN CIEL BLANC EST INVISIBLE. Le fond de la carte est un
// ciel clair, et la moitié d'une carte est de la BRUME (fog serveur) presque
// blanche : une neige blanche pure disparaissait dessus et ne se voyait que
// devant les sapins (vérifié à l'œil sur capture). D'où un flocon à DEUX TONS —
// cœur clair, bord froid : c'est le liseré bleuté qui le détache du ciel, et le
// cœur qui le garde lisible sur un terrain sombre.
const SNOW_FS = `
uniform vec3 uColor;
uniform vec3 uEdge;
uniform float uOpacity;
varying float vFade;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.18, d) * uOpacity * vFade;
  if (a < 0.02) discard;
  gl_FragColor = vec4(mix(uEdge, uColor, smoothstep(0.44, 0.14, d)), a);
}`;

function makeSnowfall(o: WeatherOpts): Weather {
  // ⚠ LA COLONNE DE NEIGE NE COUVRE PAS LA CARTE, ELLE SUIT LE REGARD. Un premier
  // jet semait les flocons sur toute la carte : à l'écran on n'en voyait qu'une
  // poignée (mesuré — la vue tient ~11 unités de large, la carte 50 à 140, donc
  // moins de 5 % des flocons étaient à l'image), et couvrir une grande carte à
  // densité utile aurait demandé des dizaines de milliers de points.
  const span = 72; // large devant la vue la plus dézoomée, indépendant de la carte
  const height = 18;
  // Réserve de flocons. Seul un PRÉFIXE est dessiné (voir setTime) : la réserve
  // doit être assez grande pour tenir la densité voulue au zoom le plus SERRÉ,
  // où la vue ne couvre qu'un quinzième de la colonne.
  const count = 16000;
  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const speed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (h01(i, o.seed + 11) - 0.5) * span;
    pos[i * 3 + 1] = h01(i, o.seed + 12) * height;
    pos[i * 3 + 2] = (h01(i, o.seed + 13) - 0.5) * span;
    phase[i] = h01(i, o.seed + 14) * 6.283;
    speed[i] = 1.1 + h01(i, o.seed + 15) * 1.5;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geom.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  geom.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
  // Sphère bornée à la main : THREE la calculerait sur les positions de DÉPART,
  // que le shader déplace ensuite — il croirait la neige ailleurs et la culerait.
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height / 2, 0), span);

  const wind = windOf(o.seed);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: 3 },
      uHeight: { value: height },
      uSpan: { value: span },
      uWind: { value: new THREE.Vector2(Math.cos(wind) * 0.5, Math.sin(wind) * 0.5) },
      uColor: { value: new THREE.Color(0.99, 1, 1) },
      uEdge: { value: new THREE.Color(0.44, 0.55, 0.76) },
      uOpacity: { value: 0.95 },
    },
    vertexShader: SNOW_VS,
    fragmentShader: SNOW_FS,
    transparent: true,
    depthWrite: false,
  });
  const points = unpickable(new THREE.Points(geom, mat));
  points.frustumCulled = false;
  points.position.set(o.cx, 0, o.cy);
  const group = new THREE.Group();
  group.add(points);
  // combien de flocons on veut VOIR, quel que soit le zoom
  const ON_SCREEN = 520;
  return {
    group,
    setTime: (s) => {
      mat.uniforms.uTime.value = s;
      const v = o.view?.();
      if (!v) return;
      // 1) recentrage à HYSTÉRÉSIS : on ne bouge la colonne que lorsque le regard
      //    s'en est vraiment éloigné. Sans le seuil, la neige collerait à l'écran
      //    pendant les pans ; avec, la plupart des déplacements ne la bougent pas
      //    du tout, et le saut — sur un semis stochastique rebouclé — ne se voit
      //    pas.
      if (Math.abs(v.x - points.position.x) > span * 0.25 || Math.abs(v.z - points.position.z) > span * 0.25) {
        points.position.set(v.x, 0, v.z);
      }
      // 2) taille : un flocon a une taille MONDE, donc il grossit au zoom. Borné
      //    en bas (sous ~2,5 px il disparaît dans le sous-pixel) et en haut.
      mat.uniforms.uSize.value = clamp(v.ppu * 0.11, 3.2, 8);
      // 3) DENSITÉ À L'ÉCRAN CONSTANTE. À densité 3D fixe, dézoomer noierait la
      //    carte sous la neige et zoomer la ferait disparaître. On ne dessine donc
      //    qu'un PRÉFIXE du nuage (les positions viennent d'un hachage, un préfixe
      //    reste uniformément réparti) — un compteur, pas un rebuild.
      const visible = Math.max(1, (v.w / v.ppu) * (v.h / v.ppu));
      geom.setDrawRange(0, clamp(Math.round((ON_SCREEN * span * span) / visible), 60, count));
    },
    dispose: () => {
      geom.dispose();
      mat.dispose();
      group.clear();
    },
  };
}

/** cap du vent de cette partie — PARTAGÉ par les nuages, les flocons et les
 *  vire-vents : c'est là que se joue la « cohérence » qu'on voit à l'écran. */
function windOf(seed: number): number {
  return h01(1, seed) * Math.PI * 2;
}

// ── VIRE-VENTS ───────────────────────────────────────────────────────────────
// Une poignée de boules qui traversent la carte dans le sens du vent, roulant sur
// elles-mêmes. Le modèle est CENTRÉ en hauteur sur son rayon (gen-props.mjs), donc
// on le décale de son rayon vers le bas dans un pivot : le pivot est le centre de
// la boule, et la rotation ne la fait ni flotter ni s'enfoncer.
const TW_MAT = signacify(new THREE.MeshLambertMaterial({ vertexColors: true }));
const TW_RADIUS = 13 / 30; // rayon du modèle en unités monde (cf. gen-props.mjs)

function makeTumbleweeds(lib: BlockLibrary, o: WeatherOpts): Weather | null {
  // ⚠ MÊME LEÇON QUE LA NEIGE : le couloir SUIT LE REGARD. Semés sur la carte, il
  // en aurait fallu des centaines pour qu'un seul traverse la vue (mesuré : un
  // seul vire-vent à l'image sur une carte de 40, et pas au bon endroit) — or
  // chacun est un mesh, donc un draw call. Une douzaine autour de la caméra suffit
  // et le coût ne dépend plus de la taille de la carte.
  // Couloir SERRÉ (un peu plus large que la vue) : plus le couloir est large,
  // plus la chance qu'un vire-vent tombe sur une case connue et visible est
  // faible — et c'est du décor, il doit se voir.
  const span = 28;
  const n = 12;
  const wind = windOf(o.seed);
  const dir = new THREE.Vector2(Math.cos(wind), Math.sin(wind));
  // axe de roulement : perpendiculaire au déplacement, dans le plan du sol
  const rollAxis = new THREE.Vector3(-dir.y, 0, dir.x);
  const group = new THREE.Group();
  const items: { pivot: THREE.Group; speed: number; off: number; lane: number; scale: number }[] = [];
  for (let i = 0; i < n; i++) {
    const geom = lib.get("tumbleweed", i % 3);
    if (!geom) continue;
    const scale = 0.5 + h01(i, o.seed + 21) * 0.35;
    const mesh = unpickable(new THREE.Mesh(geom, TW_MAT));
    mesh.position.y = -TW_RADIUS * scale; // le centre de la boule remonte sur le pivot
    mesh.scale.setScalar(scale);
    mesh.castShadow = true;
    const pivot = unpickable(new THREE.Group());
    pivot.add(mesh);
    group.add(pivot);
    items.push({
      pivot,
      speed: 1.6 + h01(i, o.seed + 22) * 1.9,
      off: h01(i, o.seed + 23),
      // ⚠ COULOIR ÉTROIT, à la mesure de la VUE et non de la carte : un
      // vire-vent n'est visible que sur une case DÉCOUVERTE (il ne roule ni sur
      // l'eau ni sur le brouillard), et au début d'une partie on ne connaît qu'une
      // cinquantaine de cases sur seize cents. Mesuré avec des voies larges :
      // 0,00 vire-vent à l'écran en moyenne sur quarante secondes — l'effet
      // n'existait tout simplement pas.
      lane: (h01(i, o.seed + 24) - 0.5) * span * 0.45,
      scale,
    });
  }
  if (!items.length) return null;
  let cx = o.cx, cz = o.cy;
  return {
    group,
    setTime: (s) => {
      const v = o.view?.();
      // recentrage à hystérésis, comme la colonne de neige : la plupart des pans
      // ne bougent rien, et un saut ne se voit pas sur des objets qui entrent et
      // sortent du champ en permanence.
      if (v && (Math.abs(v.x - cx) > span * 0.3 || Math.abs(v.z - cz) > span * 0.3)) { cx = v.x; cz = v.z; }
      for (const it of items) {
        const travel = s * it.speed + it.off * span;
        const u = ((travel % span) + span) % span - span / 2;
        const x = cx + dir.x * u - dir.y * it.lane;
        const z = cz + dir.y * u + dir.x * it.lane;
        // Hors carte, sur l'eau, ou sous le brouillard : on ne le montre pas. Une
        // boule sèche qui roule sur un lac — ou qui flotte au-dessus de la nappe de
        // brume, essayé et rejeté : elle se lit comme un objet en lévitation — c'est
        // le genre de détail qui défait tout le reste.
        if (o.passable && !o.passable(x, z)) {
          it.pivot.visible = false;
          continue;
        }
        it.pivot.visible = true;
        const r = TW_RADIUS * it.scale;
        const ground = o.groundAt?.(x, z) ?? 0;
        // petit rebond : une boule de brindilles ne roule pas collée au sol
        const hop = Math.abs(Math.sin(travel * 0.9)) * r * 0.35;
        it.pivot.position.set(x, ground + r + hop, z);
        it.pivot.quaternion.setFromAxisAngle(rollAxis, travel / r);
      }
    },
    dispose: () => {
      group.clear();
    },
  };
}

// ── COMPOSITION ──────────────────────────────────────────────────────────────

/** La météo de ce thème, ou `null` s'il n'en a pas (tempéré : rien, zéro coût). */
export function makeWeather(theme: string | undefined, lib: BlockLibrary, o: WeatherOpts): Weather | null {
  const parts: Weather[] = [];
  if (theme === "nordique") {
    parts.push(makeSnowfall(o));
    // LE CIEL COUVERT. Même vent que les flocons — c'est là qu'est la cohérence.
    //
    // ⚠ LE CIEL SUIT LA CAMÉRA (parallaxe 1), comme une voûte céleste. Semé sur la
    // carte, il était invisible en jeu : la projection est dimétrique à 30°, donc
    // un nuage à 15 unités d'altitude se projette ~26 unités PLUS HAUT à l'écran,
    // très au-dessus d'une vue qui n'en couvre qu'une vingtaine — mesuré, un seul
    // nuage effleurait le bord supérieur, et sur une grande carte il en aurait fallu
    // des centaines pour qu'un seul soit au-dessus de la tête. Le suivi règle les
    // deux d'un coup : une douzaine de nuages suffit, et rien ne « saute » quand on
    // se déplace, puisqu'un ciel ne se déplace pas avec le sol.
    //
    // Pas d'ombres portées : sous un ciel bouché il n'y en a pas, et chaque tache
    // coûterait un draw call de plus par nuage.
    const deck = makeClouds(lib, {
      count: 12,
      cx: 0, cy: 0, span: 46,
      altitude: [10, 14],
      speed: [0.5, 1.1],
      // gros et peu nombreux plutôt que petits et nombreux : c'est la SURFACE
      // couverte qui fait le ciel bouché, et chaque nuage coûte un draw call.
      scale: [4.5, 7.5],
      seed: o.seed,
      wind: windOf(o.seed),
    });
    deck.group.traverse((c) => unpickable(c));
    const sky = new THREE.Group();
    sky.add(deck.group);
    parts.push({
      group: sky,
      setTime: (s) => {
        const v = o.view?.();
        if (v) sky.position.set(v.x, 0, v.z);
        deck.setTime(s);
      },
      dispose: () => { deck.dispose(); sky.clear(); },
    });
  } else if (theme === "desertique" && o.tumbleweeds !== false) {
    const tw = makeTumbleweeds(lib, o);
    if (tw) parts.push(tw);
  }
  if (!parts.length) return null;
  const group = new THREE.Group();
  for (const p of parts) group.add(p.group);
  return {
    group,
    setTime: (s) => { for (const p of parts) p.setTime(s); },
    dispose: () => { for (const p of parts) p.dispose(); group.clear(); },
  };
}

/** Les modèles dont la météo de CE thème a besoin — vide en tempéré (règle 3 :
 *  une expédition sans météo ne télécharge pas un octet de plus). */
export function weatherPropKeys(theme: string | undefined, opts: { tumbleweeds?: boolean } = {}): string[] {
  if (theme === "nordique") return ["cloud"];
  // ⚠ MÊME CONDITION QUE `makeWeather` : une vue qui ne veut pas de vire-vents ne
  // doit pas non plus en télécharger le modèle (règle 3). Le paramètre est là pour
  // que les deux ne puissent pas diverger.
  if (theme === "desertique" && opts.tumbleweeds !== false) return ["tumbleweed"];
  return [];
}

// ── LA COUCHE, SA BOUCLE ET SON INTERRUPTEUR ─────────────────────────────────
//
// Un seul objet pour les deux vues : il possède la météo courante, sa boucle
// cadencée, et l'interrupteur du réglage. La règle qui compte est dans `rebuild` :
// à 0 image/s on DÉTRUIT la couche au lieu de la figer.
export class WeatherLayer {
  private weather: Weather | null = null;
  private key = "";
  private raf = 0;
  private timer: ReturnType<typeof setTimeout> | 0 = 0;
  private active = true;
  private fps: number;
  private t0 = performance.now();

  constructor(
    private engine: { scene: THREE.Scene; invalidate(): void },
    fps: number,
  ) {
    this.fps = clamp(Math.round(fps) || 0, 0, 60);
  }

  /** Réglage « Effets de météo ». 0 = plus rien du tout (cf. règle 1). */
  setFps(fps: number, rebuild: () => void) {
    const v = clamp(Math.round(fps) || 0, 0, 60);
    if (v === this.fps) return;
    const wasOff = this.fps === 0;
    this.fps = v;
    if (v === 0) this.clear();
    else if (wasOff) rebuild(); // rien n'existait : il faut reconstruire
    else this.ensureLoop();
  }

  /** Onglet quitté : la vue reste montée mais ne doit plus rien demander. */
  setActive(on: boolean) {
    if (this.active === on) return;
    this.active = on;
    if (on) this.ensureLoop();
    else this.stopLoop();
  }

  get enabled(): boolean { return this.fps > 0; }
  /** la météo en place (les tests de perf s'en servent pour vérifier l'absence) */
  get current(): Weather | null { return this.weather; }

  /** (Re)construit si la clé a changé. `key` doit résumer tout ce dont la météo
   *  dépend (thème + zone) : sans elle on rebâtirait à chaque draw de la carte. */
  rebuild(key: string, build: () => Weather | null) {
    if (!this.fps) { this.clear(); return; }
    if (key === this.key && this.weather) return;
    this.clear();
    this.key = key;
    this.weather = build();
    if (!this.weather) return;
    this.engine.scene.add(this.weather.group);
    this.weather.setTime((performance.now() - this.t0) / 1000);
    this.ensureLoop();
  }

  private clear() {
    this.stopLoop();
    if (this.weather) {
      this.engine.scene.remove(this.weather.group);
      this.weather.dispose();
      this.weather = null;
    }
    this.key = "";
  }

  private ensureLoop() {
    if (!this.active || !this.fps || !this.weather) return;
    if (this.raf || this.timer) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.timer) clearTimeout(this.timer);
    this.raf = 0;
    this.timer = 0;
  }

  private tick = () => {
    this.raf = 0;
    if (!this.active || !this.fps || !this.weather) return;
    // page en arrière-plan : on reste armé sans rien rendre (même convention que
    // le cadenceur d'idle et la boucle des nuages de la ville).
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    this.weather.setTime((performance.now() - this.t0) / 1000);
    this.engine.invalidate();
    this.timer = setTimeout(() => {
      this.timer = 0;
      this.raf = requestAnimationFrame(this.tick);
    }, 1000 / this.fps);
  };

  dispose() { this.clear(); }
}
