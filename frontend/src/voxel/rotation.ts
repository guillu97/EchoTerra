// Rotation de la caméra à 4 orientations (FFTA2). Les DONNÉES ne tournent
// jamais : seule la direction de la caméra change (azimut 45° + k·90°), les
// billboards refont face à la caméra et les overlays au sol sont invariants.

export type Orientation = 0 | 1 | 2 | 3;

/** Angle d'élévation dimétrique : sin(30°) = 0.5 → losanges 2:1 comme l'iso. */
export const ELEVATION = Math.PI / 6;

export function azimuthFor(o: Orientation): number {
  return Math.PI / 4 + (o * Math.PI) / 2;
}

export function nextOrientation(o: Orientation, dir: 1 | -1 = 1): Orientation {
  return (((o + dir) % 4) + 4) % 4 as Orientation;
}

/** Vecteur unitaire caméra→scène inversé (position = cible + dir · dist). */
export function cameraDir(azimuth: number): [number, number, number] {
  return [
    Math.cos(ELEVATION) * Math.sin(azimuth),
    Math.sin(ELEVATION),
    Math.cos(ELEVATION) * Math.cos(azimuth),
  ];
}
