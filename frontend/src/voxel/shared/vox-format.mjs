// Lecture/écriture du format .vox (MagicaVoxel, version 150) — JS pur.
// Un seul modèle par fichier ; z vers le haut (convention MagicaVoxel = la nôtre).
// Palette : RGBA[256] ; l'entrée fichier k correspond à l'indice voxel k+1.

function chunk(id, content, children = new Uint8Array(0)) {
  const buf = new Uint8Array(12 + content.length + children.length);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < 4; i++) buf[i] = id.charCodeAt(i);
  dv.setInt32(4, content.length, true);
  dv.setInt32(8, children.length, true);
  buf.set(content, 12);
  buf.set(children, 12 + content.length);
  return buf;
}

// model: { sx, sy, sz, data: Uint8Array (x + y*sx + z*sx*sy, 0 = vide), palette: [[r,g,b]...] }
export function encodeVox(model) {
  const { sx, sy, sz, data, palette } = model;
  if (sx > 256 || sy > 256 || sz > 256) throw new Error("modèle > 256, hors format .vox");
  const sizeC = new Uint8Array(12);
  const sdv = new DataView(sizeC.buffer);
  sdv.setInt32(0, sx, true); sdv.setInt32(4, sy, true); sdv.setInt32(8, sz, true);

  let count = 0;
  for (let i = 0; i < data.length; i++) if (data[i]) count++;
  const xyzi = new Uint8Array(4 + count * 4);
  new DataView(xyzi.buffer).setInt32(0, count, true);
  let o = 4;
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        const v = data[x + y * sx + z * sx * sy];
        if (!v) continue;
        xyzi[o] = x; xyzi[o + 1] = y; xyzi[o + 2] = z; xyzi[o + 3] = v;
        o += 4;
      }
    }
  }

  const rgba = new Uint8Array(256 * 4);
  for (let i = 0; i < 255; i++) {
    const c = palette[i];
    if (c) { rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = 255; }
  }

  // canal de PARTIE (rig) OPTIONNEL : chunk maison "nPRT" = 1 octet par voxel
  // occupé, dans le MÊME ordre que XYZI. MagicaVoxel l'ignore ; notre décodeur le lit.
  const chunks = [chunk("SIZE", sizeC), chunk("XYZI", xyzi), chunk("RGBA", rgba)];
  if (model.parts) {
    const prt = new Uint8Array(4 + count);
    new DataView(prt.buffer).setInt32(0, count, true);
    let p = 4;
    for (let z = 0; z < sz; z++)
      for (let y = 0; y < sy; y++)
        for (let x = 0; x < sx; x++) {
          const idx = x + y * sx + z * sx * sy;
          if (data[idx]) prt[p++] = model.parts[idx] || 0;
        }
    chunks.push(chunk("nPRT", prt));
  }
  const children = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  { let off = 0; for (const c of chunks) { children.set(c, off); off += c.length; } }
  const main = chunk("MAIN", new Uint8Array(0), children);
  const out = new Uint8Array(8 + main.length);
  const dv = new DataView(out.buffer);
  out[0] = 86; out[1] = 79; out[2] = 88; out[3] = 32; // "VOX "
  dv.setInt32(4, 150, true);
  out.set(main, 8);
  return out;
}

export function decodeVox(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag !== "VOX ") throw new Error("pas un fichier .vox");
  let size = null, voxels = null, palette = null;
  let pos = 8;
  const readChunk = () => {
    const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    const content = dv.getInt32(pos + 4, true);
    const start = pos + 12;
    pos = start + content; // les enfants suivent : on itère linéairement
    return { id, start, content };
  };
  while (pos < bytes.byteLength) {
    const { id, start, content } = readChunk();
    if (id === "SIZE") size = { sx: dv.getInt32(start, true), sy: dv.getInt32(start + 4, true), sz: dv.getInt32(start + 8, true) };
    else if (id === "XYZI") {
      const n = dv.getInt32(start, true);
      voxels = bytes.subarray(start + 4, start + 4 + n * 4);
    } else if (id === "RGBA") {
      palette = [];
      for (let i = 0; i < 255; i++) palette.push([bytes[start + i * 4], bytes[start + i * 4 + 1], bytes[start + i * 4 + 2]]);
    } else if (id === "MAIN") pos = start; // descendre dans les enfants
    if (content < 0) throw new Error("chunk corrompu");
  }
  if (!size || !voxels) throw new Error(".vox incomplet");
  const data = new Uint8Array(size.sx * size.sy * size.sz);
  for (let i = 0; i < voxels.length; i += 4) {
    data[voxels[i] + voxels[i + 1] * size.sx + voxels[i + 2] * size.sx * size.sy] = voxels[i + 3];
  }
  return { ...size, data, palette: palette ?? [] };
}
