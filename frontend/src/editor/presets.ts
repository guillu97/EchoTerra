// Preset capture/stamp helpers + localStorage persistence.

import type { Layer, MapDoc, Preset } from "./types";
import { DOC_VERSION, recomputeCell } from "./types";
import { renderDocToCanvas } from "./editorExport";

const LS_KEY = "echoterra:editor:presets";

// Build a throwaway MapDoc from a preset (used to render a thumbnail / preview).
export function presetToDoc(preset: Preset): MapDoc {
  const gridW = preset.w;
  const gridH = preset.h;
  const cells = Array.from(
    { length: gridW * gridH },
    () => ({ blocks: [], height: 0 }) as MapDoc["cells"][number],
  );
  for (const c of preset.cells) {
    if (c.dx < gridW && c.dy < gridH) {
      const cell = { blocks: (c.blocks ?? []).map((b) => (b ? { ...b } : null)), height: 0 };
      recomputeCell(cell);
      cells[c.dy * gridW + c.dx] = cell;
    }
  }
  const objLayer: Layer = {
    id: "preset-obj",
    name: "obj",
    kind: "object",
    visible: true,
    placements: preset.objects.map((o, i) => ({
      id: `po-${i}`,
      cx: o.dx,
      cy: o.dy,
      asset: o.asset,
      scale: o.scale,
      rot: o.rot,
      flipX: o.flipX,
      lift: o.lift,
      crop: o.crop,
    })),
  };
  return {
    version: DOC_VERSION,
    gridW,
    gridH,
    cells,
    layers: [{ id: "ground", name: "Sol", kind: "ground", visible: true, placements: [] }, objLayer],
  };
}

// Render a small dataURL thumbnail for a preset (downscaled to ~96px tall).
export async function presetThumb(preset: Preset): Promise<string | undefined> {
  try {
    const full = await renderDocToCanvas(presetToDoc(preset), 1);
    const maxH = 96;
    const s = Math.min(1, maxH / full.height);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(full.width * s));
    c.height = Math.max(1, Math.round(full.height * s));
    c.getContext("2d")!.drawImage(full, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } catch {
    return undefined;
  }
}

export function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as Preset[];
  } catch {
    /* ignore */
  }
  return [];
}

export function savePresets(presets: Preset[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(presets));
  } catch {
    /* quota / disabled — keep in memory only */
  }
}
