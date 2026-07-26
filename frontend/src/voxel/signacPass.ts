// Passe « Signac » — rendu divisionniste (néo-impressionnisme).
//
// Deux effets, dans cet ordre, parce que c'est dans cet ordre qu'ils comptent :
//
//   1. LE PARTI PRIS DE COULEUR. Ce qui fait la luminosité de Signac tient moins
//      aux points qu'au refus du gris : les ombres ne sont pas des noirs
//      désaturés mais des VIOLETS et des BLEUS, les lumières tirent vers le
//      chaud, et la saturation reste haute partout. C'est `uSat` + la rotation
//      de teinte pilotée par la luminance.
//   2. LA TOUCHE. Chaque pixel est reconstruit depuis le centre de sa cellule,
//      peint comme une touche ronde sur un fond de toile clair qui transparaît
//      entre les touches. La teinte de chaque touche est décalée au hasard
//      (`uScatter`) : c'est le mélange OPTIQUE — deux touches voisines de
//      couleurs pures se recomposent dans l'œil, elles ne sont pas mélangées
//      sur la palette.
//
// La densité suit la valeur : les zones sombres reçoivent des touches PLUS
// LARGES (elles couvrent davantage la toile), les zones claires laissent
// respirer le fond. Sans cela, une scène sombre vue à travers une trame de
// points clairs se délave complètement.
//
// Rangées décalées d'une demi-cellule : une grille carrée stricte se lit comme
// une moustiquaire, pas comme une facture peinte.
//
// Limite assumée : les touches sont ancrées à l'ÉCRAN, pas au monde — comme la
// toile l'est sous le motif. Quand la caméra pivote, le sujet glisse derrière la
// trame. C'est cohérent avec la métaphore, mais ça se voit ; d'où `uStrength`,
// réglable, et une trame assez fine par défaut.

import * as THREE from "three";

export const SignacShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    /** Pas de la trame, en pixels physiques. */
    uDot: { value: 7.0 },
    /** Dosage global de la passe (0 = rendu normal, 1 = pleine peinture). */
    uStrength: { value: 0.85 },
    /** Multiplicateur de saturation. */
    uSat: { value: 1.45 },
    /** Amplitude du décalage de teinte par touche (mélange optique). */
    uScatter: { value: 0.055 },
    /** Couleur de la toile qui transparaît entre les touches. */
    uCanvas: { value: new THREE.Color(0xf3ead6) },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2  uResolution;
    uniform float uDot;
    uniform float uStrength;
    uniform float uSat;
    uniform float uScatter;
    uniform vec3  uCanvas;
    varying vec2 vUv;

    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }
    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 px = vUv * uResolution;
      vec3 base = texture2D(tDiffuse, vUv).rgb;

      // --- cellule de touche (rangées décalées) ---------------------------
      float row   = floor(px.y / uDot);
      float xoff  = mod(row, 2.0) * 0.5;
      vec2  cell  = vec2(floor(px.x / uDot - xoff), row);
      vec2  center = (cell + vec2(0.5 + xoff, 0.5)) * uDot;
      float h1 = hash(cell);
      float h2 = hash(cell + 17.3);
      // la touche n'est pas posée au cordeau : léger désordre de la main
      center += (vec2(h1, h2) - 0.5) * uDot * 0.4;

      vec3 src = texture2D(tDiffuse, clamp(center / uResolution, 0.0, 1.0)).rgb;

      // --- parti pris de couleur ------------------------------------------
      vec3 hsv = rgb2hsv(src);
      float lum = hsv.z;
      // ombres vers le violet/bleu, lumières vers le chaud
      float hueShift = mix(-0.085, 0.030, smoothstep(0.12, 0.80, lum));
      // dispersion par touche : c'est ça, le mélange optique
      hueShift += (h1 - 0.5) * uScatter * 2.0;

      // APLATS SANS COULEUR — le cas décisif ici. La pierre des bâtiments est un
      // quasi-blanc uniforme (matériau self-lit, aucun ombrage), donc il n'y a
      // aucune couleur locale à diviser : le village virait à la tache blanche.
      // C'est précisément ce que Signac fait des voiles et des murs blancs — il
      // ne les peint pas en blanc, il les peint en touches mauves, bleues, roses
      // et jaunes qui se recomposent en lumière. Plus la source est désaturée,
      // plus on tire la teinte de chaque touche au sort, et plus on casse la
      // valeur pour que l'aplat cesse d'être un aplat.
      float flatness = 1.0 - smoothstep(0.05, 0.35, hsv.y); // NB: 'flat' est un mot réservé GLSL
      hueShift += (h2 - 0.5) * uScatter * 6.0 * flatness;
      hsv.x = fract(hsv.x + hueShift);
      // Plancher de saturation ÉLEVÉ : sans lui, les surfaces quasi blanches
      // (pierre des bâtiments, ciel pâle) restent grises et se dissolvent dans
      // la toile. Signac ne peint pas le blanc en blanc — il le peint en touches
      // pâles mais franchement colorées, qui se recomposent en lumière.
      hsv.y = clamp(hsv.y * uSat + 0.26 + 0.20 * flatness, 0.0, 1.0);
      hsv.z = clamp(hsv.z - 0.12 * flatness * (1.0 - h1 * 0.55), 0.0, 1.0);
      vec3 touch = hsv2rgb(hsv);

      // --- masque de la touche ---------------------------------------------
      // Plus la zone est sombre, plus la touche est large : elle couvre la toile.
      // Sinon une scène sombre vue à travers une trame claire se délave.
      // Les touches se CHEVAUCHENT (couverture haute, bord doux) : à faible
      // couverture, les zones claires — c'est-à-dire le sujet — se délavaient
      // jusqu'au blanc, et seules les ombres restaient lisibles.
      float radius = uDot * mix(0.95, 0.72, smoothstep(0.05, 0.85, lum));
      float d = length(px - center) / max(radius, 0.001);
      float mask = 1.0 - smoothstep(0.35, 1.05, d);

      vec3 painted = mix(uCanvas, touch, mask);
      gl_FragColor = vec4(mix(base, painted, uStrength), 1.0);
    }
  `,
};

/** Réglages exposés : le curseur d'intensité pilote les trois d'un coup. */
export function signacUniformsFor(strength: number) {
  const s = Math.max(0, Math.min(1, strength));
  return {
    uStrength: 0.35 + s * 0.6, // même à 0 le grading reste perceptible
    uSat: 1.15 + s * 0.45,
    uScatter: 0.02 + s * 0.05,
  };
}
