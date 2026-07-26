// Divisionnisme DANS LE MATÉRIAU — la touche vit dans le monde, pas sur la vitre.
//
// La première tentative était une passe plein écran (signacPass.ts) : la trame
// était collée à l'ÉCRAN. Elle ne suivait pas les surfaces, ne tournait pas avec
// la géométrie, ne se resserrait pas avec la distance, et stipplait
// indistinctement le ciel, le brouillard et les bâtiments — donc elle effaçait
// les silhouettes. Ça se lisait comme un filtre Photoshop, et c'était MOINS
// lisible que le rendu normal. Retour utilisateur, fondé.
//
// Ici, la touche est indexée sur la POSITION MONDE : chaque cellule de la grille
// (≈ un voxel) tire sa propre teinte. Conséquences, toutes voulues :
//   - la touche est solidaire de la surface : elle tourne, s'incline et rétrécit
//     avec elle, comme un empâtement sur un vrai volume ;
//   - les arêtes restent NETTES — la couleur varie dans la face, jamais au
//     travers de la silhouette ; le rendu gagne en lisibilité au lieu d'en perdre ;
//   - les ombres virent au violet parce que l'ÉCLAIRAGE le décide (le décalage
//     de teinte est piloté par la luminance APRÈS calcul des lumières), pas
//     parce qu'un filtre l'a plaqué après coup.
//
// Coût géométrique : ZÉRO. On n'ajoute pas un triangle — c'est précisément ce
// qui évite l'écueil du greedy meshing (donner une couleur propre à chaque voxel
// EN AMONT casserait la fusion des quads et ferait exploser le budget).

import * as THREE from "three";

/** Uniformes PARTAGÉS par tous les matériaux patchés → bascule instantanée. */
export const signacUniforms = {
  uSignac: { value: 0 }, // 0 = éteint, 1 = plein effet
  uSat: { value: 1.35 }, // multiplicateur de saturation
  uScatter: { value: 0.035 }, // amplitude du tirage de teinte par touche
  // Taille d'une touche, en unités monde (1 unité = une tuile). À 1/16 — la
  // maille du LOD voxel — la touche tombe sous le pixel dès qu'on dézoome et se
  // lit comme du BRUIT, pas comme une facture. Le Signac tardif pose des touches
  // LARGES, en mosaïque : 1/5 de tuile les rend franchement visibles.
  uCell: { value: 1 / 5 },
};

const GLSL_HELPERS = /* glsl */ `
  varying vec3 vSignacWorld;
  uniform float uSignac;
  uniform float uSat;
  uniform float uScatter;
  uniform float uCell;

  vec3 sg_rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }
  vec3 sg_hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  float sg_hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
  }
`;

// Tirage de teinte par cellule-monde, appliqué à la couleur DIFFUSE (donc avant
// l'éclairage : la touche est une propriété de la matière, pas du rendu).
const GLSL_TOUCH = /* glsl */ `
  {
    vec3 cell = floor(vSignacWorld / max(uCell, 1e-4));
    float h1 = sg_hash(cell);
    float h2 = sg_hash(cell + 31.7);
    vec3 hsv = sg_rgb2hsv(diffuseColor.rgb);
    // La DONNÉE porte désormais la division de teinte (divisionize() dans les
    // recettes) : le shader ne doit plus la refaire, sinon les deux se cumulent
    // et la surface part en bruit. Il ne garde qu'une vibration FINE, à une
    // échelle plus serrée que la touche peinte — le grain de la matière, pas la
    // touche elle-même.
    float flatness = 1.0 - smoothstep(0.05, 0.35, hsv.y);
    hsv.x = fract(hsv.x + (h1 - 0.5) * uScatter * (1.0 + 1.2 * flatness));
    hsv.y = clamp(hsv.y * uSat + 0.06 * flatness, 0.0, 1.0);
    hsv.z = clamp(hsv.z * (0.94 + 0.12 * h2), 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, sg_hsv2rgb(hsv), uSignac);
  }
`;

// Contraste chaud/froid APRÈS éclairage : les ombres tirent vers le violet et le
// bleu, les lumières vers le chaud. C'est le refus du gris, qui fait la
// luminosité du néo-impressionnisme — et il est ici piloté par la lumière réelle
// de la scène, donc il reste cohérent quand le soleil ou la caméra bougent.
const GLSL_SHADOW_HUE = /* glsl */ `
  {
    vec3 h = sg_rgb2hsv(gl_FragColor.rgb);
    float shift = mix(-0.075, 0.028, smoothstep(0.10, 0.75, h.z));
    h.x = fract(h.x + shift * uSignac);
    h.y = clamp(h.y * mix(1.0, 1.22, uSignac), 0.0, 1.0);
    gl_FragColor.rgb = sg_hsv2rgb(h);
  }
`;

const patched = new WeakSet<THREE.Material>();

/**
 * Branche le divisionnisme sur un matériau voxel (Lambert ou Basic, à couleurs
 * de sommets). Idempotent. À appeler AVANT la première compilation.
 */
export function signacify<T extends THREE.Material>(mat: T): T {
  if (patched.has(mat)) return mat;
  patched.add(mat);

  const prev = mat.onBeforeCompile?.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    Object.assign(shader.uniforms, signacUniforms);

    shader.vertexShader =
      "varying vec3 vSignacWorld;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n  vSignacWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );

    let f = GLSL_HELPERS + shader.fragmentShader;
    // `<color_fragment>` est l'endroit où les couleurs de sommets entrent dans
    // `diffuseColor` : c'est là que la touche doit se poser.
    f = f.replace("#include <color_fragment>", "#include <color_fragment>\n" + GLSL_TOUCH);
    // Le nom du chunk final a changé en r152 (output_fragment → opaque_fragment) :
    // on gère les deux, sinon le patch tombe silencieusement.
    if (f.includes("#include <opaque_fragment>"))
      f = f.replace("#include <opaque_fragment>", "#include <opaque_fragment>\n" + GLSL_SHADOW_HUE);
    else if (f.includes("#include <output_fragment>"))
      f = f.replace("#include <output_fragment>", "#include <output_fragment>\n" + GLSL_SHADOW_HUE);
    shader.fragmentShader = f;
  };
  // Sans clé de cache distincte, three peut réutiliser un programme non patché.
  mat.customProgramCacheKey = () => "signac";
  mat.needsUpdate = true;
  return mat;
}

/** Active/désactive le rendu divisionniste (instantané, aucun recompile). */
export function setSignacEnabled(on: boolean, strength = 0.6) {
  const s = Math.max(0, Math.min(1, strength));
  signacUniforms.uSignac.value = on ? 0.5 + s * 0.5 : 0;
  signacUniforms.uSat.value = 1.06 + s * 0.34;
  signacUniforms.uScatter.value = 0.008 + s * 0.035; // la donnée fait le gros du travail
  // touches plus larges quand on pousse l'intensité (mosaïque du Signac tardif)
  signacUniforms.uCell.value = 1 / (7.0 - s * 3.0);
}
