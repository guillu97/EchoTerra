// Shared isometric renderer. The SAME drawMap() feeds the live editor canvas and the
// PNG exporter, so what you see is exactly what you save.

import type { CropRect, MapDoc, Placement } from "./types";
import { inBounds } from "./types";
import { assetUrlFor } from "./assetIndex";
import { getImage } from "./imageCache";
import { metricsFor } from "./spriteMetrics";
import { getAssetCrop } from "./assetCrops";

// Per-placement crop wins; otherwise the asset-wide source crop applies.
function effCrop(pl: Placement): CropRect | undefined {
  return pl.crop ?? getAssetCrop(pl.asset.cat, pl.asset.file);
}

// Projection / sprite anchoring at the DEFAULT block size. Everything scales linearly
// with the block width via setIsoTileSize() so the iso block size is one grid-linked
// variable. Every cube is drawn into a UNIFORM box (tileW × (tileH+cubeDepth)) and
// bottom-anchored so it sits ON its grid cell — uniform size + grid-aligned.
const ISO_BASE = {
  tileW: 64, // diamond width (px, world units) — the iso block size
  tileH: 32, // diamond height (= tileW / 2 for a 2:1 iso)
  elev: 30, // vertical px per height level (== cubeDepth so stacked cubes connect)
  cubeDepth: 30, // uniform visible side height of every block
  objW: 60, // target content width for an object/building sprite
  objBottomDrop: 6, // object feet offset below the cube's top-diamond centre
};
export const ISO = { ...ISO_BASE };
export const DEFAULT_TILE_W = ISO_BASE.tileW;

// Resize the whole iso grid + every block uniformly. project()/drawMap read ISO live,
// so a mutate is all that's needed — no threading through call sites.
export function setIsoTileSize(tileW: number) {
  const k = tileW / ISO_BASE.tileW;
  ISO.tileW = tileW;
  ISO.tileH = ISO_BASE.tileH * k;
  ISO.elev = ISO_BASE.elev * k;
  ISO.cubeDepth = ISO_BASE.cubeDepth * k;
  ISO.objW = ISO_BASE.objW * k;
  ISO.objBottomDrop = ISO_BASE.objBottomDrop * k;
}

export interface Point {
  sx: number;
  sy: number;
}

export function project(cx: number, cy: number, h: number): Point {
  return {
    sx: (cx - cy) * (ISO.tileW / 2),
    sy: (cx + cy) * (ISO.tileH / 2) - h * ISO.elev,
  };
}

function diamond(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
  const hw = ISO.tileW / 2;
  const hh = ISO.tileH / 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy - hh);
  ctx.lineTo(sx + hw, sy);
  ctx.lineTo(sx, sy + hh);
  ctx.lineTo(sx - hw, sy);
  ctx.closePath();
}

// Draw a sprite so its measured content is `contentW` wide, horizontally centred on the
// tile, with the content bottom pinned `bottomDrop` px below the top-diamond centre.
function drawSprite(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  p: Point,
  contentW: number,
  bottomDrop: number,
) {
  const m = metricsFor(img);
  if (!m) {
    // Metrics not ready yet — fall back to a centred square so nothing flickers blank.
    ctx.drawImage(img, p.sx - contentW / 2, p.sy - contentW * 0.7, contentW, contentW);
    return;
  }
  const drawW = contentW / m.fWidth; // scale the FULL image so its content == contentW
  const drawH = drawW * m.aspect;
  const x = p.sx - m.fCenterX * drawW;
  const y = p.sy + bottomDrop - m.fBottom * drawH;
  ctx.drawImage(img, x, y, drawW, drawH);
}

function cubeAt(ctx: CanvasRenderingContext2D, img: HTMLImageElement, p: Point, crop?: CropRect) {
  // Every block is drawn into the SAME box — width tileW, height tileH+cubeDepth — and
  // bottom-anchored so its front-bottom vertex sits on the cell (p.sy + tileH/2). This
  // makes all blocks the same size, sit ON the grid, and line up top AND bottom. The
  // source region is the explicit crop, else the measured content bbox (so transparent
  // margins don't shrink the block).
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  let sx0 = 0,
    sy0 = 0,
    sw = nw,
    sh = nh;
  if (crop) {
    sx0 = crop.x * nw;
    sy0 = crop.y * nh;
    sw = crop.w * nw;
    sh = crop.h * nh;
  } else {
    const m = metricsFor(img);
    if (m) {
      sx0 = m.fLeft * nw;
      sy0 = m.fTop * nh;
      sw = (m.fRight - m.fLeft) * nw;
      sh = (m.fBottom - m.fTop) * nh;
    }
  }
  const w = ISO.tileW;
  const h = ISO.tileH + ISO.cubeDepth;
  ctx.drawImage(img, sx0, sy0, sw, sh, p.sx - w / 2, p.sy + ISO.tileH / 2 - h, w, h);
}

// Resolved screen geometry of a placed object (after its transforms), used for both
// drawing and hit-testing so the two never disagree.
export interface ObjGeom {
  x: number; // top-left of the (unrotated) draw rect
  y: number;
  w: number;
  h: number;
  feetX: number; // anchor the transforms pivot around
  feetY: number;
}

export function objectGeom(
  pl: Placement,
  cellHeight: number,
  img: HTMLImageElement,
): ObjGeom | null {
  const m = metricsFor(img);
  if (!m) return null;
  const targetW = ISO.objW * (pl.scale ?? 1);
  const top = project(pl.cx, pl.cy, cellHeight + (pl.lift ?? 0));
  const feetX = top.sx + (pl.dx ?? 0);
  // Stand on the block's TOP face, which sits cubeDepth above the cell centre.
  const feetY = top.sy - ISO.cubeDepth + ISO.objBottomDrop + (pl.dy ?? 0);

  const crop = effCrop(pl);
  if (crop) {
    // Render only the crop region; it displays `targetW` wide, anchored centre-bottom.
    const cropPxW = crop.w * img.naturalWidth;
    const cropPxH = crop.h * img.naturalHeight;
    const w = targetW;
    const h = cropPxW > 0 ? targetW * (cropPxH / cropPxW) : targetW;
    return { x: feetX - w / 2, y: feetY - h, w, h, feetX, feetY };
  }

  // Whole sprite: scale so its measured content == targetW, anchored content centre/bottom.
  const drawW = targetW / m.fWidth;
  const drawH = drawW * m.aspect;
  const x = feetX - m.fCenterX * drawW;
  const y = feetY - m.fBottom * drawH;
  return { x, y, w: drawW, h: drawH, feetX, feetY };
}

function objAt(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  pl: Placement,
  cellHeight: number,
) {
  const g = objectGeom(pl, cellHeight, img);
  if (!g) {
    objAtFallback(ctx, img, project(pl.cx, pl.cy, cellHeight));
    return;
  }
  ctx.save();
  if (pl.rot || pl.flipX) {
    ctx.translate(g.feetX, g.feetY);
    if (pl.rot) ctx.rotate((pl.rot * Math.PI) / 180);
    if (pl.flipX) ctx.scale(-1, 1);
    ctx.translate(-g.feetX, -g.feetY);
  }
  const crop = effCrop(pl);
  if (crop) {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    ctx.drawImage(img, crop.x * nw, crop.y * nh, crop.w * nw, crop.h * nh, g.x, g.y, g.w, g.h);
  } else {
    ctx.drawImage(img, g.x, g.y, g.w, g.h);
  }
  ctx.restore();
}

function objAtFallback(ctx: CanvasRenderingContext2D, img: HTMLImageElement, p: Point) {
  drawSprite(ctx, img, p, ISO.objW, ISO.objBottomDrop);
}

export interface DrawOpts {
  grid?: boolean; // draw the grid plane at the focus level
  focusLevel?: number; // active elevation: the grid + hover sit here
  focusDim?: boolean; // dim blocks NOT at the focus level (level-focus mode)
  hover?: { cx: number; cy: number } | null;
  hoverRadius?: number; // brush footprint radius (cells) to outline around the hover
  showLevels?: boolean; // overlay each placed cell's height number
  selected?: { layerId: string; id: string } | null;
  region?: { x: number; y: number; w: number; h: number } | null; // marquee selection
}

const DIM_ALPHA = 0.25; // opacity of off-focus levels in level-focus mode

export function drawMap(
  ctx: CanvasRenderingContext2D,
  doc: MapDoc,
  requestRedraw?: () => void,
  opts: DrawOpts = {},
) {
  const groundLayer = doc.layers.find((l) => l.kind === "ground");
  const objectLayers = doc.layers.filter((l) => l.kind === "object" && l.visible);
  const groundVisible = !!groundLayer?.visible;

  // Bucket object placements by cell so we don't rescan per cell.
  const byCell = new Map<string, { layerId: string; pl: Placement; url: string }[]>();
  objectLayers.forEach((layer) => {
    for (const pl of layer.placements) {
      const url = assetUrlFor(pl.asset.cat, pl.asset.file);
      if (!url) continue;
      const key = `${pl.cx},${pl.cy}`;
      if (!byCell.has(key)) byCell.set(key, []);
      byCell.get(key)!.push({ layerId: layer.id, pl, url });
    }
  });

  // Grid plane at the ACTIVE level (top-face plane), drawn BEFORE the blocks so placed
  // blocks read as sitting ON TOP of the grid. Only this one plane is shown.
  if (opts.grid) {
    const lvl = opts.focusLevel ?? 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = lvl > 0 ? "rgba(120,210,255,0.45)" : "rgba(255,255,255,0.14)";
    for (let cy = 0; cy < doc.gridH; cy++)
      for (let cx = 0; cx < doc.gridW; cx++) {
        const p = project(cx, cy, lvl);
        diamond(ctx, p.sx, p.sy - ISO.cubeDepth);
        ctx.stroke();
      }
  }


  // Render cells back-to-front.
  const order: { cx: number; cy: number }[] = [];
  for (let cy = 0; cy < doc.gridH; cy++)
    for (let cx = 0; cx < doc.gridW; cx++) order.push({ cx, cy });
  order.sort((a, b) => a.cx + a.cy - (b.cx + b.cy));

  for (const { cx, cy } of order) {
    const cell = doc.cells[cy * doc.gridW + cx];
    if (!cell) continue;

    // Ground stack: draw each block at its level (different tiles can stack per level).
    // In level-focus mode, blocks not at the active level are dimmed.
    if (groundVisible && cell.blocks) {
      for (let lvl = 0; lvl < cell.blocks.length; lvl++) {
        const blk = cell.blocks[lvl];
        if (!blk) continue;
        const url = assetUrlFor(blk.cat, blk.file);
        const img = url ? getImage(url, requestRedraw) : undefined;
        if (!img) continue;
        const dim = opts.focusDim && opts.focusLevel != null && lvl !== opts.focusLevel;
        if (dim) ctx.globalAlpha = DIM_ALPHA;
        cubeAt(ctx, img, project(cx, cy, lvl), getAssetCrop(blk.cat, blk.file));
        if (dim) ctx.globalAlpha = 1;
      }
    }

    // Marquee region tint (base plane).
    if (opts.region) {
      const rg = opts.region;
      if (cx >= rg.x && cx < rg.x + rg.w && cy >= rg.y && cy < rg.y + rg.h) {
        const p = project(cx, cy, 0);
        diamond(ctx, p.sx, p.sy);
        ctx.fillStyle = "rgba(255,209,102,0.22)";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255,209,102,0.85)";
        ctx.stroke();
      }
    }

    // Hover highlight — floats at the ACTIVE level so you see where a block will land in
    // elevation — plus the brush footprint ring around it.
    if (opts.hover) {
      const r = Math.max(0, (opts.hoverRadius ?? 1) - 1);
      const within = Math.abs(cx - opts.hover.cx) <= r && Math.abs(cy - opts.hover.cy) <= r;
      const isCentre = opts.hover.cx === cx && opts.hover.cy === cy;
      if (isCentre || within) {
        const lvl = opts.focusLevel ?? cell.height;
        const p = project(cx, cy, lvl);
        const sy = p.sy - ISO.cubeDepth; // top face of a block at that level
        diamond(ctx, p.sx, sy);
        ctx.fillStyle = isCentre ? "rgba(120,210,255,0.30)" : "rgba(120,210,255,0.12)";
        ctx.fill();
        ctx.lineWidth = isCentre ? 2 : 1;
        ctx.strokeStyle = "rgba(120,210,255,0.9)";
        ctx.stroke();
        // A faint vertical post from the ground to the floating preview, for depth read.
        if (isCentre && lvl > 0) {
          const g = project(cx, cy, 0);
          ctx.beginPath();
          ctx.moveTo(p.sx, sy);
          ctx.lineTo(g.sx, g.sy + ISO.tileH / 2);
          ctx.strokeStyle = "rgba(120,210,255,0.5)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    // Height-number overlay on placed cells.
    if (opts.showLevels && cell.blocks && cell.blocks.some(Boolean)) {
      const p = project(cx, cy, cell.height);
      const ty = p.sy - ISO.cubeDepth;
      ctx.font = `bold ${Math.round(ISO.tileH * 0.42)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(String(cell.height), p.sx, ty);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillText(String(cell.height), p.sx, ty);
    }

    // Objects sitting on the cell's top surface, bottom→top by layer.
    const placed = byCell.get(`${cx},${cy}`);
    if (placed) {
      for (const { layerId, pl, url } of placed) {
        const img = getImage(url, requestRedraw);
        if (!img) continue;
        objAt(ctx, img, pl, cell.height);
        if (opts.selected && opts.selected.layerId === layerId && opts.selected.id === pl.id) {
          const g = objectGeom(pl, cell.height, img);
          if (g) {
            ctx.save();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "rgba(120,210,255,0.95)";
            ctx.setLineDash([5, 4]);
            ctx.strokeRect(g.x, g.y, g.w, g.h);
            ctx.setLineDash([]);
            // Feet marker.
            ctx.fillStyle = "rgba(120,210,255,0.95)";
            ctx.beginPath();
            ctx.arc(g.feetX, g.feetY, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
    }
  }

}

// Pick the topmost object under a world point (reverse draw order). Returns the
// placement ref + its cell so the caller can select/move it.
export function screenToObject(
  worldX: number,
  worldY: number,
  doc: MapDoc,
): { layerId: string; id: string } | null {
  const objectLayers = doc.layers.filter((l) => l.kind === "object" && l.visible);
  // Build draw order (back-to-front), then test front-to-back.
  type Hit = { layerId: string; pl: Placement; cellH: number; rank: number };
  const all: Hit[] = [];
  objectLayers.forEach((layer, li) => {
    for (const pl of layer.placements) {
      const cell = doc.cells[pl.cy * doc.gridW + pl.cx];
      all.push({ layerId: layer.id, pl, cellH: cell?.height ?? 0, rank: (pl.cx + pl.cy) * 1000 + li });
    }
  });
  all.sort((a, b) => b.rank - a.rank); // front/top first
  for (const hit of all) {
    const url = assetUrlFor(hit.pl.asset.cat, hit.pl.asset.file);
    const img = url ? getImage(url) : undefined;
    if (!img) continue;
    const g = objectGeom(hit.pl, hit.cellH, img);
    if (!g) continue;
    if (worldX >= g.x && worldX <= g.x + g.w && worldY >= g.y && worldY <= g.y + g.h)
      return { layerId: hit.layerId, id: hit.pl.id };
  }
  return null;
}

// Pick the frontmost/topmost cell whose top-face diamond contains the world point.
export function screenToCell(
  worldX: number,
  worldY: number,
  doc: MapDoc,
): { cx: number; cy: number } | null {
  let best: { cx: number; cy: number; rank: number } | null = null;
  for (let cy = 0; cy < doc.gridH; cy++)
    for (let cx = 0; cx < doc.gridW; cx++) {
      const cell = doc.cells[cy * doc.gridW + cx];
      const h = cell?.height ?? 0;
      const p = project(cx, cy, h);
      const dx = Math.abs(worldX - p.sx) / (ISO.tileW / 2);
      const dy = Math.abs(worldY - p.sy) / (ISO.tileH / 2);
      if (dx + dy <= 1) {
        const rank = (cx + cy) * 100 + h; // frontmost, then highest
        if (!best || rank > best.rank) best = { cx, cy, rank };
      }
    }
  return best ? { cx: best.cx, cy: best.cy } : null;
}

// Invert the projection at a GIVEN level's top-face plane (the plane the grid + hover are
// drawn on). This is what paint tools must use so the cursor matches the visible level
// grid — picking by each cell's own height drifts more and more as the level rises.
export function screenToCellAtLevel(
  worldX: number,
  worldY: number,
  doc: MapDoc,
  level: number,
): { cx: number; cy: number } | null {
  const yGround = worldY + level * ISO.elev + ISO.cubeDepth; // undo elevation + top-face offset
  const a = worldX / (ISO.tileW / 2); // cx - cy
  const b = yGround / (ISO.tileH / 2); // cx + cy
  const cx = Math.round((a + b) / 2);
  const cy = Math.round((b - a) / 2);
  return inBounds(doc, cx, cy) ? { cx, cy } : null;
}

// World-space bounding box for the PNG export canvas. Generous on purpose — sprite
// content varies — the exporter trims transparent margins afterwards.
export function contentBounds(doc: MapDoc): { x: number; y: number; w: number; h: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let maxH = 0;
  for (let cy = 0; cy < doc.gridH; cy++)
    for (let cx = 0; cx < doc.gridW; cx++) {
      const base = project(cx, cy, 0);
      minX = Math.min(minX, base.sx);
      maxX = Math.max(maxX, base.sx);
      minY = Math.min(minY, base.sy);
      maxY = Math.max(maxY, base.sy);
      maxH = Math.max(maxH, doc.cells[cy * doc.gridW + cx]?.height ?? 0);
    }
  // Margins: half a tile sideways, plenty of headroom for tall props + raised columns.
  const padX = ISO.tileW;
  const padTop = ISO.tileW * 2 + maxH * ISO.elev;
  const padBottom = ISO.tileH * 2;
  return {
    x: minX - padX,
    y: minY - padTop,
    w: maxX - minX + padX * 2,
    h: maxY - minY + padTop + padBottom,
  };
}

// DEV diagnostic hook.
if (import.meta.env.DEV)
  (window as unknown as { __iso: unknown }).__iso = { ISO, project, drawMap, screenToCell, screenToCellAtLevel };
