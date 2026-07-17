// Greedy meshing d'un modèle voxel → BufferGeometry three, couleurs PAR VERTEX
// (zéro texture). L'éclairage est CUIT dans les couleurs (ombrage fixe par
// direction de face, style Minecraft — pas de lumière dynamique : elle
// aplatirait le rendu storybook). Les faces coplanaires de même couleur sont
// fusionnées en grands rectangles → un bloc 32³ détaillé retombe à ~1–3 k tris.
//
// Espace : voxel (x, y, z-up) → three (X = x, Y = z, Z = y). Le modèle est
// recentré sur son cube de base : origine au CENTRE du bloc en X/Z, bas à Y=0,
// et mis à l'échelle 1/size → un bloc = 1 unité monde (le HEADROOM dépasse
// au-dessus de Y=1, c'est voulu : c'est le décor).

import * as THREE from "three";
import type { VoxModel } from "./vox";

// Ombrage fixe par direction (normale monde) : dessus plein feu, dessous sombre,
// flancs différenciés pour que les arêtes lisent sous les 4 orientations.
const FACE_SHADE: Record<string, number> = {
  "py": 1.0, "ny": 0.45,
  "px": 0.8, "nx": 0.62,
  "pz": 0.9, "nz": 0.7,
};

export type MeshedBlock = {
  geometry: THREE.BufferGeometry;
  triangles: number;
};

export function meshVoxModel(model: VoxModel, size = model.sx): MeshedBlock {
  const { sx, sy, sz, data, palette } = model;
  const dims = [sx, sy, sz];
  const at = (x: number, y: number, z: number): number =>
    x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : data[x + y * sx + z * sx * sy];

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // Convention d'axes voxel→monde pour positions ET normales.
  const toWorld = (vx: number, vy: number, vz: number): [number, number, number] => [
    vx / size - 0.5,
    vz / size,
    vy / size - 0.5,
  ];
  const shadeFor = (d: number, sign: number): number =>
    FACE_SHADE[(sign > 0 ? "p" : "n") + "xzy"[d]];

  // Greedy classique : pour chaque axe d, on balaie les plans entre tranches ;
  // le masque porte (couleur, signe de la face) et on fusionne les rectangles.
  const x = [0, 0, 0];
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const mask = new Int32Array(dims[u] * dims[v]);
    for (x[d] = 0; x[d] <= dims[d]; x[d]++) {
      let n = 0;
      for (x[v] = 0; x[v] < dims[v]; x[v]++) {
        for (x[u] = 0; x[u] < dims[u]; x[u]++, n++) {
          const a = x[d] > 0 ? at(x[0] - (d === 0 ? 1 : 0), x[1] - (d === 1 ? 1 : 0), x[2] - (d === 2 ? 1 : 0)) : 0;
          const b = x[d] < dims[d] ? at(x[0], x[1], x[2]) : 0;
          // face exposée entre a et b : l'un plein, l'autre vide
          mask[n] = a && !b ? a : b && !a ? -b : 0;
        }
      }
      n = 0;
      for (let j = 0; j < dims[v]; j++) {
        for (let i = 0; i < dims[u]; ) {
          const c = mask[n + i];
          if (!c) { i++; continue; }
          let w = 1;
          while (i + w < dims[u] && mask[n + i + w] === c) w++;
          let h = 1;
          outer: for (; j + h < dims[v]; h++) {
            for (let k = 0; k < w; k++) if (mask[n + i + k + h * dims[u]] !== c) break outer;
          }
          // émettre le quad (i..i+w, j..j+h) dans le plan x[d]
          const ci = Math.abs(c) - 1;
          const rgb = palette[ci] ?? [255, 0, 255];
          const sign = c > 0 ? 1 : -1;
          const shade = shadeFor(d, sign);
          const base = positions.length / 3;
          const pt = [0, 0, 0];
          pt[d] = x[d];
          const du = [0, 0, 0]; du[u] = w;
          const dv2 = [0, 0, 0]; dv2[v] = h;
          pt[u] = i; pt[v] = j;
          const quad = [
            [pt[0], pt[1], pt[2]],
            [pt[0] + du[0], pt[1] + du[1], pt[2] + du[2]],
            [pt[0] + du[0] + dv2[0], pt[1] + du[1] + dv2[1], pt[2] + du[2] + dv2[2]],
            [pt[0] + dv2[0], pt[1] + dv2[1], pt[2] + dv2[2]],
          ];
          for (const [qx, qy, qz] of quad) {
            const [wx, wy, wz] = toWorld(qx, qy, qz);
            positions.push(wx, wy, wz);
            colors.push((rgb[0] / 255) * shade, (rgb[1] / 255) * shade, (rgb[2] / 255) * shade);
          }
          // sens d'enroulement : l'échange d'axes voxel(x,y,z-up)→three(x,z,y)
          // inverse la chiralité, donc l'ordre est l'OPPOSÉ de l'espace voxel
          // (vérifié par test de normales géométriques sur un cube unité)
          if (sign > 0) indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
          else indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          // zéro le masque consommé
          for (let hh = 0; hh < h; hh++) for (let ww = 0; ww < w; ww++) mask[n + i + ww + hh * dims[u]] = 0;
          i += w;
        }
        n += dims[u];
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return { geometry, triangles: indices.length / 3 };
}
