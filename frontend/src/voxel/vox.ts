// Décodage .vox (MagicaVoxel, un modèle par fichier) — miroir navigateur de
// scripts/voxel/vox-format.mjs. z est VERS LE HAUT dans le fichier (convention
// MagicaVoxel) ; la conversion vers l'espace three (y up) se fait au meshing.

export type VoxModel = {
  sx: number;
  sy: number;
  sz: number;
  /** indices de palette 1-based, 0 = vide ; x + y*sx + z*sx*sy */
  data: Uint8Array;
  /** [r,g,b] 0-255 ; l'indice voxel k lit palette[k-1] */
  palette: [number, number, number][];
};

export function decodeVox(bytes: Uint8Array): VoxModel {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "VOX ") {
    throw new Error("pas un fichier .vox");
  }
  let size: { sx: number; sy: number; sz: number } | null = null;
  let voxels: Uint8Array | null = null;
  let palette: [number, number, number][] | null = null;
  let pos = 8;
  while (pos + 12 <= bytes.byteLength) {
    const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    const content = dv.getInt32(pos + 4, true);
    const start = pos + 12;
    if (id === "MAIN") { pos = start; continue; } // descendre dans les enfants
    if (id === "SIZE") size = { sx: dv.getInt32(start, true), sy: dv.getInt32(start + 4, true), sz: dv.getInt32(start + 8, true) };
    else if (id === "XYZI") {
      const n = dv.getInt32(start, true);
      voxels = bytes.subarray(start + 4, start + 4 + n * 4);
    } else if (id === "RGBA") {
      palette = [];
      for (let i = 0; i < 255; i++) palette.push([bytes[start + i * 4], bytes[start + i * 4 + 1], bytes[start + i * 4 + 2]]);
    }
    pos = start + content;
  }
  if (!size || !voxels) throw new Error(".vox incomplet");
  const data = new Uint8Array(size.sx * size.sy * size.sz);
  for (let i = 0; i < voxels.length; i += 4) {
    data[voxels[i] + voxels[i + 1] * size.sx + voxels[i + 2] * size.sx * size.sy] = voxels[i + 3];
  }
  return { ...size, data, palette: palette ?? [] };
}

export async function fetchVox(url: string): Promise<VoxModel> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`vox ${url}: HTTP ${res.status}`);
  return decodeVox(new Uint8Array(await res.arrayBuffer()));
}
