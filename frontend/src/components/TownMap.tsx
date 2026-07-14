import { useEffect, useRef, useState } from "react";
import townJson from "../data/town-map.json";
import type { Cell, MapDoc, Placement } from "../editor/types";
import { normalizeCell } from "../editor/types";
import { loadAll } from "../editor/imageCache";
import { assetUrlFor } from "../editor/assetIndex";
import { ISO, drawMap, project } from "../editor/isoRender";
import { TOWN_BUILDINGS } from "../data/buildings";
import { heroAssetUrl } from "../assets";
import { myTeamHeroes } from "../townUtils";
import { useStore } from "../store";
import { durColor } from "../tabs/HomeTab";

// The Home town is a map authored in the built-in editor (frontend/src/editor/),
// exported as JSON and rendered here with the editor's own renderer — what you see
// in the editor is exactly what the Home shows. Buildings placed on the map become
// clickable hotspots wired to the game's building states.
//
// The whole thing is wrapped in a zoom/pan viewport (wheel + drag + pinch, same
// absolute-mapping pinch math as the Phaser map — zero drift by construction).

// Editor asset file -> game building id (only mapped buildings are clickable).
const ASSET_TO_BUILDING: Record<string, string> = {
  "bld-well": "well",
  gate: "gate",
  "bld-chapel": "townhall",
  panel: "panel",
  workshop: "workshop",
  bank: "bank",
  "bld-archerytower": "tower",
};

const CANVAS_RES = 2; // backing-store supersample (CSS size stays world-sized)
const TAP_SLOP = 8; // px of pointer travel before a press counts as a drag

// Block asset files that read as "grass" — in-town heroes stand on these cells.
const GRASS_FILES = new Set(["grass", "jungle", "darkgrass", "fallgrass", "mossy"]);

interface Spot {
  buildingId: string;
  x: number; // world px, relative to the rendered canvas origin
  y: number;
}

interface Baked {
  canvas: HTMLCanvasElement;
  w: number; // world size of the render
  h: number;
  spots: Spot[];
  grass: { x: number; y: number }[]; // hero stand-points on grass cells (feet anchors)
}

// --- doc preparation (module-level: parsed and rendered once per session) ----

function getDoc(): MapDoc {
  const d = townJson as unknown as MapDoc;
  d.cells = d.cells.map((c) => normalizeCell({ ...(c as Cell) }));
  return d;
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

// Tight world bounds over OCCUPIED cells + placements only (the editor's
// contentBounds spans the whole 54×59 grid, mostly empty — 4× the canvas).
function occupiedBounds(doc: MapDoc): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let maxH = 0;
  const touch = (cx: number, cy: number, h: number) => {
    const p = project(cx, cy, 0);
    minX = Math.min(minX, p.sx);
    maxX = Math.max(maxX, p.sx);
    minY = Math.min(minY, p.sy);
    maxY = Math.max(maxY, p.sy);
    maxH = Math.max(maxH, h);
  };
  for (let cy = 0; cy < doc.gridH; cy++)
    for (let cx = 0; cx < doc.gridW; cx++) {
      const cell = doc.cells[cy * doc.gridW + cx];
      if (cell?.blocks?.some(Boolean)) touch(cx, cy, cell.height ?? 0);
    }
  for (const l of doc.layers)
    for (const p of l.placements) touch(p.cx, p.cy, doc.cells[p.cy * doc.gridW + p.cx]?.height ?? 0);
  if (!isFinite(minX)) return { x: 0, y: 0, w: 100, h: 100 };
  const padX = ISO.tileW * 1.5;
  const padTop = ISO.tileW * 2 + maxH * ISO.elev;
  const padBottom = ISO.tileH * 2 + ISO.cubeDepth;
  return { x: minX - padX, y: minY - padTop, w: maxX - minX + padX * 2, h: maxY - minY + padTop + padBottom };
}

let bakedPromise: Promise<Baked> | null = null;

// Decode every asset then render the full map once to an offscreen canvas; the
// result (and the building hotspot anchors) is cached for the whole session.
function bakeTown(): Promise<Baked> {
  if (bakedPromise) return bakedPromise;
  bakedPromise = (async () => {
    const doc = getDoc();
    await loadAll(usedUrls(doc));
    const b = occupiedBounds(doc);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(b.w * CANVAS_RES));
    canvas.height = Math.max(1, Math.ceil(b.h * CANVAS_RES));
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.scale(CANVAS_RES, CANVAS_RES);
    ctx.translate(-b.x, -b.y);
    drawMap(ctx, doc, undefined, { grid: false });

    const spots: Spot[] = [];
    const occupied = new Set<string>(); // cells taken by placements (+1 ring): no hero there
    for (const l of doc.layers) {
      if (!l.visible) continue;
      for (const p of l.placements as Placement[]) {
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) occupied.add(`${p.cx + dx},${p.cy + dy}`);
        const id = ASSET_TO_BUILDING[p.asset.file];
        if (!id) continue;
        const h = doc.cells[p.cy * doc.gridW + p.cx]?.height ?? 0;
        const pt = project(p.cx, p.cy, h + (p.lift ?? 0));
        spots.push({
          buildingId: id,
          x: pt.sx + (p.dx ?? 0) - b.x,
          y: pt.sy - ISO.cubeDepth + (p.dy ?? 0) - b.y,
        });
      }
    }

    // Hero stand-points: cells whose TOP block is grass, away from the buildings.
    // Stable order (row-major) so hero->spot assignment is deterministic.
    const grass: { x: number; y: number }[] = [];
    for (let cy = 0; cy < doc.gridH; cy++)
      for (let cx = 0; cx < doc.gridW; cx++) {
        const cell = doc.cells[cy * doc.gridW + cx];
        const blocks = cell?.blocks ?? [];
        let top: string | undefined;
        for (let i = blocks.length - 1; i >= 0; i--)
          if (blocks[i]) {
            top = blocks[i]!.file;
            break;
          }
        if (!top || !GRASS_FILES.has(top) || occupied.has(`${cx},${cy}`)) continue;
        const pt = project(cx, cy, cell.height ?? 0);
        grass.push({ x: pt.sx - b.x, y: pt.sy - ISO.cubeDepth + ISO.objBottomDrop - b.y });
      }
    return { canvas, w: b.w, h: b.h, spots, grass };
  })();
  return bakedPromise;
}

// --- component ---------------------------------------------------------------

export function TownMap({
  selected,
  onBuildingClick,
  onClear,
}: {
  selected: string | null;
  onBuildingClick: (id: string) => void;
  onClear: () => void;
}) {
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [baked, setBaked] = useState<Baked | null>(null);
  // View transform: screen = world·z + (tx, ty). Kept in a ref (mutated at pointer
  // speed) and mirrored to CSS directly — re-rendering React on every pointermove
  // would kill the pan on phones.
  const view = useRef({ z: 1, tx: 0, ty: 0, zMin: 0.2, zMax: 4 });
  const worldRef = useRef<HTMLDivElement>(null);
  const userMoved = useRef(false);
  const dragged = useRef(false);
  // Active pointers + pinch baseline (absolute mapping — see MapScene).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; z: number; worldX: number; worldY: number } | null>(null);
  const down = useRef({ x: 0, y: 0 });

  useEffect(() => {
    let dead = false;
    bakeTown().then((b) => !dead && setBaked(b));
    return () => {
      dead = true;
    };
  }, []);

  const applyView = () => {
    const el = worldRef.current;
    if (!el) return;
    const v = view.current;
    el.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.z})`;
    // Building pills counter-scale so they stay screen-sized at any zoom level.
    el.style.setProperty("--inv", String(1 / v.z));
  };

  // Fit the whole town in the viewport (initial view; re-applied on resize until
  // the player zooms/pans manually).
  const fit = () => {
    const vp = viewportRef.current;
    if (!vp || !baked) return;
    const vw = vp.clientWidth || 1;
    const vh = vp.clientHeight || 1;
    const z = Math.min(vw / baked.w, vh / baked.h) * 0.95;
    view.current.z = z;
    view.current.zMin = z * 0.7;
    view.current.zMax = Math.max(z * 5, 2.5);
    view.current.tx = (vw - baked.w * z) / 2;
    view.current.ty = (vh - baked.h * z) / 2;
    applyView();
  };

  useEffect(() => {
    if (!baked) return;
    fit();
    const vp = viewportRef.current;
    if (!vp) return;
    const ro = new ResizeObserver(() => {
      if (!userMoved.current) fit();
    });
    ro.observe(vp);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baked]);

  // Zoom multiplying by `factor`, keeping the world point under (sx, sy) pinned.
  const zoomAt = (factor: number, sx: number, sy: number) => {
    const v = view.current;
    const z = Math.min(v.zMax, Math.max(v.zMin, v.z * factor));
    const wx = (sx - v.tx) / v.z;
    const wy = (sy - v.ty) / v.z;
    v.z = z;
    v.tx = sx - wx * z;
    v.ty = sy - wy * z;
    userMoved.current = true;
    applyView();
  };

  const localPos = (e: { clientX: number; clientY: number }) => {
    const r = viewportRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    viewportRef.current?.setPointerCapture(e.pointerId);
    const p = localPos(e);
    pointers.current.set(e.pointerId, p);
    down.current = p;
    dragged.current = false;
    if (pointers.current.size === 2) {
      // Pinch baseline: finger distance, zoom, and the world point under the
      // midpoint — every move re-derives zoom/pan from HERE (no drift).
      const [a, b] = [...pointers.current.values()];
      const v = view.current;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        z: v.z,
        worldX: (midX - v.tx) / v.z,
        worldY: (midY - v.ty) / v.z,
      };
      dragged.current = true;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = localPos(e);
    const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, p);
    const v = view.current;
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.dist > 0 && dist > 0) {
        const z = Math.min(v.zMax, Math.max(v.zMin, (pinch.current.z * dist) / pinch.current.dist));
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        v.z = z;
        v.tx = midX - pinch.current.worldX * z;
        v.ty = midY - pinch.current.worldY * z;
        userMoved.current = true;
        applyView();
      }
      dragged.current = true;
      return;
    }
    if (pointers.current.size === 1) {
      v.tx += p.x - prev.x;
      v.ty += p.y - prev.y;
      if (Math.abs(p.x - down.current.x) + Math.abs(p.y - down.current.y) > TAP_SLOP) {
        dragged.current = true;
        userMoved.current = true;
      }
      applyView();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    // Taps are resolved HERE: setPointerCapture redirects the browser's click
    // events to the viewport, so the spot buttons' onClick never fires. Hit-test
    // whatever is under the finger instead.
    if (pointers.current.size === 0 && !dragged.current) {
      const spot = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
        ".town-spot",
      ) as HTMLElement | null;
      if (spot?.dataset.bid) onBuildingClick(spot.dataset.bid);
      else onClear();
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const p = localPos(e);
    zoomAt(e.deltaY > 0 ? 0.9 : 1.1, p.x, p.y);
  };

  const buildingState = (id: string) => game?.town.buildings?.find((x) => x.id === id);

  if (!baked) {
    return (
      <div className="town-map-viewport" ref={viewportRef}>
        <div className="town-map-loading">🏗️ Construction de la ville…</div>
      </div>
    );
  }

  return (
    <div
      className="town-map-viewport"
      ref={viewportRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <div className="town-map-world" ref={worldRef} style={{ width: baked.w, height: baked.h }}>
        <canvas
          className="town-map-canvas"
          style={{ width: baked.w, height: baked.h }}
          ref={(el) => {
            // Blit the pre-baked render into the live canvas once it exists.
            if (!el || el.dataset.baked) return;
            el.width = baked.canvas.width;
            el.height = baked.canvas.height;
            el.getContext("2d")!.drawImage(baked.canvas, 0, 0);
            el.dataset.baked = "1";
          }}
        />
        {/* MY in-town heroes: the map hides them once they're inside the walls —
            HERE is where they live, standing on the grass. Other players' heroes
            stay invisible (their town view shows their own team). Deterministic
            grass-cell assignment (hash of the hero id + wide-stride probing). */}
        {game &&
          baked.grass.length > 0 &&
          (() => {
            const inTown = myTeamHeroes(game, playerId).filter(
              (h) => h.hp > 0 && h.x === game.town.x && h.y === game.town.y,
            );
            const used = new Set<number>();
            const hash = (s: string) => {
              let n = 0;
              for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
              return n;
            };
            return inTown.map((h) => {
              let idx = hash(h.id) % baked.grass.length;
              // Big coprime stride: colliding heroes land CELLS apart, not shoulder
              // to shoulder (grass spots are row-major, +1 = the adjacent cell).
              while (used.has(idx)) idx = (idx + 29) % baked.grass.length;
              used.add(idx);
              const g = baked.grass[idx];
              return (
                <div key={h.id} className="town-hero" style={{ left: g.x, top: g.y }}>
                  <img src={heroAssetUrl(h.class)} alt={h.name} />
                  <span className="th-name">{h.name}</span>
                </div>
              );
            });
          })()}
        {baked.spots.map((s) => {
          const layout = TOWN_BUILDINGS.find((b) => b.id === s.buildingId);
          const bs = buildingState(s.buildingId);
          if (!layout || !bs) return null;
          const site = !bs.built;
          return (
            <button
              key={s.buildingId}
              data-bid={s.buildingId}
              className={`town-spot ${selected === s.buildingId ? "sel" : ""} ${site ? "site" : ""}`}
              style={{ left: s.x, top: s.y }}
              title={site ? `${layout.name} — en construction` : layout.name}
            >
              <span className="ts-pill">
                {site ? "🏗️" : layout.icon} {layout.name}
              </span>
              {bs.built && (
                <span className="ts-dur">
                  <i
                    style={{
                      width: `${bs.maxDurability > 0 ? Math.min(100, (bs.durability / bs.maxDurability) * 100) : 0}%`,
                      background: durColor(bs.maxDurability > 0 ? bs.durability / bs.maxDurability : 0),
                    }}
                  />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
