// Editor document model. Serialized verbatim to JSON on save / read back on load.

export interface AssetRef {
  cat: string;
  file: string;
}

export interface Cell {
  blocks: (AssetRef | null)[]; // stack of iso cubes by elevation level (index = level); null = gap
  height: number; // top occupied level (0 when empty); kept in sync for picking/objects
  ground?: AssetRef; // LEGACY single-tile column — migrated into `blocks` on load
}

// Top occupied level of a cell's stack (0 if empty).
export function topLevel(cell: Cell): number {
  for (let i = cell.blocks.length - 1; i >= 0; i--) if (cell.blocks[i]) return i;
  return 0;
}
export function cellOccupied(cell: Cell): boolean {
  return cell.blocks.some(Boolean);
}
// Keep `height` in sync and trim trailing gaps.
export function recomputeCell(cell: Cell): void {
  while (cell.blocks.length && !cell.blocks[cell.blocks.length - 1]) cell.blocks.pop();
  cell.height = topLevel(cell);
}
// Migrate a legacy {height, ground} cell to the stack model (idempotent).
export function normalizeCell(cell: Cell): Cell {
  if (!cell.blocks) {
    const legacy = cell as { height?: number; ground?: AssetRef };
    const blocks: (AssetRef | null)[] = [];
    if (legacy.ground) for (let i = 0; i <= (legacy.height ?? 0); i++) blocks.push({ ...legacy.ground });
    cell.blocks = blocks;
  }
  delete cell.ground;
  recomputeCell(cell);
  return cell;
}

export type LayerKind = "ground" | "object";

// A sub-rectangle of the source image to render, as fractions 0..1 of the natural size.
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placement {
  id: string;
  cx: number;
  cy: number;
  asset: AssetRef;
  // Optional transforms (all default to the identity / 0).
  scale?: number; // size multiplier, default 1
  rot?: number; // rotation in degrees, default 0
  flipX?: boolean; // horizontal mirror
  lift?: number; // height levels raised above the cell's top face
  dx?: number; // fine pixel offset (free move)
  dy?: number;
  crop?: CropRect; // render only this region of the source image
}

export interface Layer {
  id: string;
  name: string;
  kind: LayerKind; // "ground" = the special sol + height layer; "object" = free placements
  visible: boolean;
  placements: Placement[]; // empty for the ground layer
}

export interface MapDoc {
  version: number;
  gridW: number;
  gridH: number;
  cells: Cell[]; // length gridW*gridH, row-major (idx = cy*gridW + cx)
  layers: Layer[]; // bottom → top render order; the ground layer is always layers[0]
}

// A reusable, stampable arrangement captured from a rectangular region of the map.
// Coordinates are relative to the region's top-left corner.
export interface PresetCell {
  dx: number;
  dy: number;
  blocks: (AssetRef | null)[]; // stack by level (mirrors Cell.blocks)
}
export interface PresetObject {
  dx: number;
  dy: number;
  asset: AssetRef;
  scale?: number;
  rot?: number;
  flipX?: boolean;
  lift?: number;
  crop?: CropRect;
}
export interface Preset {
  id: string;
  name: string;
  w: number;
  h: number;
  cells: PresetCell[];
  objects: PresetObject[];
  thumb?: string; // small dataURL preview
}

export const DOC_VERSION = 1;

export const cellIdx = (doc: { gridW: number }, cx: number, cy: number) => cy * doc.gridW + cx;

export function inBounds(doc: MapDoc, cx: number, cy: number): boolean {
  return cx >= 0 && cy >= 0 && cx < doc.gridW && cy < doc.gridH;
}

export function emptyDoc(gridW = 14, gridH = 14): MapDoc {
  const cells: Cell[] = Array.from({ length: gridW * gridH }, () => ({ blocks: [], height: 0 }));
  return {
    version: DOC_VERSION,
    gridW,
    gridH,
    cells,
    layers: [
      { id: "ground", name: "Sol", kind: "ground", visible: true, placements: [] },
      { id: "buildings", name: "Bâtiments", kind: "object", visible: true, placements: [] },
      { id: "props", name: "Décor", kind: "object", visible: true, placements: [] },
      { id: "objects", name: "Objets", kind: "object", visible: true, placements: [] },
    ],
  };
}
