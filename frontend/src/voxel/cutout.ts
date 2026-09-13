// UNE FENÊTRE DANS LE FEUILLAGE — le décor s'efface autour du héros sélectionné.
//
// Le problème, rapporté en jeu (capture à l'appui) : un héros posé sous une
// canopée disparaît derrière elle, et les LOSANGES DE DÉPLACEMENT avec lui. Or
// un losange est une promesse (cf. VoxelMapView) : s'il est caché par un arbre,
// le joueur ne sait plus où il peut aller — sur un téléphone, où il n'a ni
// survol ni clic droit pour sonder, c'est une impasse.
//
// ⚠ POURQUOI PAS « les props en semi-transparent », tout court : un matériau
// `transparent: true` sur TOUT le décor le fait basculer dans la passe triée de
// three, où quelques milliers d'instances d'arbres se trient mal (z-fighting
// entre feuillages) et coûtent cher — pour un effet dont on n'a besoin QUE
// autour d'un héros, c'est-à-dire sur une poignée de pixels.
//
// ⚠ POURQUOI PAS « faire disparaître les props des 5 cases » : la case qui
// masque n'est PAS la case visée. La projection est dimétrique à 30°, donc un
// point à la hauteur h se dessine là où le sol se trouve h/tan(30°) ≈ 1,73
// unité plus loin (le même calcul que le picking, cf. CLAUDE.md) : l'arbre qui
// cache un héros est deux à trois cases DEVANT lui, et lesquelles dépend de
// l'orientation courante. Une règle en coordonnées de tuiles serait donc à
// refaire à chaque rotation, et fausse à chaque hauteur d'arbre.
//
// La réponse est donc en ESPACE ÉCRAN, là où l'occlusion se produit vraiment :
// un disque autour du héros, et l'on n'efface QUE ce qui est DEVANT lui en
// profondeur (`gl_FragCoord.z < uCutDepth`) — le feuillage derrière le héros
// n'a aucune raison de s'effacer, et l'effacer signalerait un danger imaginaire.
//
// ⚠ L'effacement est TRAMÉ (dither) et non alpha : un `discard` sur un motif
// d'écran garde le matériau dans la passe OPAQUE — zéro tri, zéro coût de
// transparence, et un rendu qui se lit comme un voile sur une image déjà
// voxelisée. L'opacité résiduelle (`uCutFloor`) est délibérée : l'arbre reste
// DEVINABLE, sinon la carte semble perdre son décor à chaque sélection.

import * as THREE from "three";

/** Uniformes PARTAGÉS par tous les matériaux patchés (mêmes valeurs partout). */
export const cutoutUniforms = {
  /** centre du disque, en pixels PHYSIQUES et origine EN BAS (repère gl_FragCoord). */
  uCutCenter: { value: new THREE.Vector2(-1e5, -1e5) },
  /** rayon en pixels physiques. **0 = éteint** — c'est l'interrupteur. */
  uCutRadius: { value: 0 },
  /** profondeur écran de la cible ([0,1]) : on n'efface que ce qui est DEVANT. */
  uCutDepth: { value: 1 },
  /** part de pixels conservés au centre du disque (0 = invisible, 1 = opaque). */
  uCutFloor: { value: 0.22 },
};

const GLSL_HEAD = /* glsl */ `
  uniform vec2 uCutCenter;
  uniform float uCutRadius;
  uniform float uCutDepth;
  uniform float uCutFloor;
  float ct_hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
  }
`;

// La trame est indexée sur des blocs de 2×2 pixels PHYSIQUES : à un pixel elle
// se lit comme du bruit sur un écran à fort DPR (le voile disparaît), à quatre
// elle devient une grille visible. Deux est le compromis mesuré.
const GLSL_CUT = /* glsl */ `
  if (uCutRadius > 0.0 && gl_FragCoord.z < uCutDepth) {
    float d = distance(gl_FragCoord.xy, uCutCenter) / uCutRadius;
    if (d < 1.0) {
      float keep = mix(uCutFloor, 1.0, smoothstep(0.55, 1.0, d));
      // ATTENTION : le test keep < 1.0 n'est pas une optimisation, c'est un
      // INVARIANT. A opacite pleine la fenetre ne doit RIEN retirer ; sans ce
      // garde, quelques pixels disparaissaient quand meme, parce que ct_hash
      // s'appuie sur fract(), qui rend exactement 1.0 en float32 des que son
      // argument tombe un cheveu sous un entier (fract(-3.0000001) arrondi a
      // 1.0) : 1.0 > 1.0 devenait vrai par la porte de derriere. Mesure par le
      // garde-fou test:map-gesture, pas deduit.
      if (keep < 1.0 && ct_hash(floor(gl_FragCoord.xy * 0.5)) > keep) discard;
    }
  }
`;

const patched = new WeakSet<THREE.Material>();

/**
 * Branche la fenêtre sur un matériau de décor. Idempotent, et CHAÎNABLE avec
 * `signacify` — dans les deux ordres.
 *
 * ⚠ La clé de cache est ÉTENDUE et non écrasée : `signacify` en pose une
 * (`"signac"`) précisément pour que three ne recycle pas un programme non
 * patché. L'écraser ferait tomber l'un des deux patches en silence, et il n'y a
 * aucune erreur pour le dire — on verrait juste le divisionnisme disparaître.
 */
export function cutoutify<T extends THREE.Material>(mat: T): T {
  if (patched.has(mat)) return mat;
  patched.add(mat);

  const prevCompile = mat.onBeforeCompile?.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prevCompile?.(shader, renderer);
    Object.assign(shader.uniforms, cutoutUniforms);
    let f = GLSL_HEAD + shader.fragmentShader;
    // `<clipping_planes_fragment>` ouvre le main() de TOUS les matériaux three :
    // c'est le seul point d'ancrage commun à Lambert et Basic, et il est assez
    // haut pour que le fragment effacé ne paie ni l'éclairage ni les ombres.
    f = f.replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n" + GLSL_CUT);
    shader.fragmentShader = f;
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : "") + "+cutout";
  mat.needsUpdate = true;
  return mat;
}

/** Éteint la fenêtre (aucun `discard` évalué : `uCutRadius` à 0 court-circuite). */
export function clearCutout() {
  cutoutUniforms.uCutRadius.value = 0;
}

/**
 * Pose la fenêtre à partir de points MONDE : le premier est la cible (il donne
 * la profondeur de référence), les suivants sont ce qui doit rester visible
 * avec elle — ici le héros et ses cases de déplacement.
 *
 * ⚠ Le rayon se DÉDUIT de ces points au lieu d'être une constante en unités
 * monde : l'écart écran entre un héros et sa case voisine dépend du zoom ET de
 * l'orientation, donc une constante donnerait un trou minuscule dézoomé et un
 * cratère de près. Ici la fenêtre couvre exactement ce qu'elle doit couvrir, à
 * tout zoom.
 */
export function setCutoutFromWorld(
  camera: THREE.Camera,
  drawingWidth: number,
  drawingHeight: number,
  points: THREE.Vector3[],
  margin: number,
): void {
  if (points.length === 0 || drawingWidth <= 0) return clearCutout();
  const v = new THREE.Vector3();
  let cx = 0, cy = 0, depth = 0;
  const screen: Array<[number, number]> = [];
  for (const p of points) {
    v.copy(p).project(camera);
    // gl_FragCoord : origine EN BAS À GAUCHE, pixels physiques, z dans [0,1].
    const sx = (v.x * 0.5 + 0.5) * drawingWidth;
    const sy = (v.y * 0.5 + 0.5) * drawingHeight;
    screen.push([sx, sy]);
    depth = Math.max(depth, v.z * 0.5 + 0.5);
  }
  [cx, cy] = screen[0];
  let r = 0;
  for (const [sx, sy] of screen) r = Math.max(r, Math.hypot(sx - cx, sy - cy));
  cutoutUniforms.uCutCenter.value.set(cx, cy);
  // La marge est une FRACTION du rayon et non un nombre de pixels : dézoomé, une
  // marge fixe de quelques dizaines de pixels ouvrirait un cratère sur un quart
  // de la carte, alors qu'elle disparaîtrait au zoom maximum.
  cutoutUniforms.uCutRadius.value = r * (1 + margin);
  // Un poil DEVANT la cible : sans ce biais, le fragment du héros lui-même (ou
  // d'un prop rigoureusement à sa profondeur) tombe du mauvais côté du test et
  // clignote quand la caméra bouge d'un cheveu.
  cutoutUniforms.uCutDepth.value = depth - 1e-4;
}
