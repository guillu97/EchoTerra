// Save/load: a flat PNG render of the whole map, plus a JSON document holding every
// element's grid position, height and layer.

import type { Cell, MapDoc } from "./types";
import { DOC_VERSION, emptyDoc, normalizeCell } from "./types";
import { assetUrlFor } from "./assetIndex";
import { loadAll } from "./imageCache";
import { contentBounds, drawMap } from "./isoRender";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function usedUrls(doc: MapDoc): string[] {
  const urls = new Set<string>();
  for (const c of doc.cells)
    for (const blk of c.blocks ?? []) {
      if (!blk) continue;
      const u = assetUrlFor(blk.cat, blk.file);
      if (u) urls.add(u);
    }
  for (const l of doc.layers)
    for (const p of l.placements) {
      const u = assetUrlFor(p.asset.cat, p.asset.file);
      if (u) urls.add(u);
    }
  return [...urls];
}

// Render the full map (independent of pan/zoom) to an offscreen canvas. Shared by the
// PNG exporter; all assets are decoded first so the single drawMap pass is complete.
export async function renderDocToCanvas(doc: MapDoc, scale = 2): Promise<HTMLCanvasElement> {
  await loadAll(usedUrls(doc));
  const b = contentBounds(doc);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(b.w * scale));
  canvas.height = Math.max(1, Math.ceil(b.h * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.scale(scale, scale);
  ctx.translate(-b.x, -b.y);
  drawMap(ctx, doc, undefined, { grid: false });
  return trimTransparent(canvas);
}

// Crop transparent margins so the saved PNG is tight to the drawn map.
function trimTransparent(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  let top = h,
    bottom = -1,
    left = w,
    right = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < 0) return canvas; // empty
  const pad = 8;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(w - 1, right + pad);
  bottom = Math.min(h - 1, bottom + pad);
  const out = document.createElement("canvas");
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext("2d")!.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// Render the full map (independent of pan/zoom) to a PNG and trigger a download.
export async function exportPng(doc: MapDoc, scale = 2) {
  const canvas = await renderDocToCanvas(doc, scale);
  await new Promise<void>((resolve) =>
    canvas.toBlob((blob) => {
      if (blob) download(blob, `echoterra-map-${stamp()}.png`);
      resolve();
    }, "image/png"),
  );
}

if (import.meta.env.DEV)
  (window as unknown as { __edExport: unknown }).__edExport = { renderDocToCanvas, exportPng, exportJson };

export function exportJson(doc: MapDoc) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  download(blob, `echoterra-map-${stamp()}.json`);
}

export async function importJson(file: File): Promise<MapDoc> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  // Light validation + migration: fall back to an empty doc shape for missing fields.
  if (typeof parsed !== "object" || !Array.isArray(parsed.cells) || !Array.isArray(parsed.layers))
    throw new Error("Fichier JSON invalide (cells/layers manquants)");
  const base = emptyDoc(parsed.gridW || 14, parsed.gridH || 14);
  const doc = {
    ...base,
    ...parsed,
    version: parsed.version ?? DOC_VERSION,
  } as MapDoc;
  // Migrate legacy {height, ground} cells to the block-stack model.
  doc.cells = doc.cells.map((c) => normalizeCell({ ...(c as Cell) }));
  return doc;
}

function stamp(): string {
  // Avoid Date in module scope concerns — fine in a click handler.
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
