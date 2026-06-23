import { create } from "zustand";
import type { AssetRef, Cell, CropRect, Layer, MapDoc, Placement, Preset } from "./types";
import { cellOccupied, emptyDoc, inBounds, normalizeCell, recomputeCell, topLevel } from "./types";
import { loadPresets, presetThumb, savePresets } from "./presets";
import { detectContentCrop, setAssetCrop } from "./assetCrops";
import { ALL_ASSETS } from "./assetIndex";
import { DEFAULT_TILE_W, setIsoTileSize } from "./isoRender";

const LS_TILE = "echoterra:editor:tileW";
function loadTileW(): number {
  try {
    const v = Number(localStorage.getItem(LS_TILE));
    if (v >= 16 && v <= 256) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_TILE_W;
}

// Autosave the working map so a refresh / HMR reload never loses work.
const LS_DOC = "echoterra:editor:doc";
function loadSavedDoc(): MapDoc | null {
  try {
    const raw = localStorage.getItem(LS_DOC);
    if (!raw) return null;
    const doc = JSON.parse(raw) as MapDoc;
    if (!doc || !Array.isArray(doc.cells) || !Array.isArray(doc.layers)) return null;
    doc.cells = doc.cells.map((c) => normalizeCell({ ...(c as Cell) }));
    return doc;
  } catch {
    return null;
  }
}

// What the crop modal is editing: a selected placement's own crop, or an asset's
// global source crop (re-frames the asset everywhere it's used).
export type CropTarget = { kind: "placement" } | { kind: "asset"; asset: AssetRef };

export type Tool = "paint" | "erase" | "raise" | "lower" | "select" | "marquee" | "stamp" | "pan";

export interface RegionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const MAX_HEIGHT = 32;

export interface Selection {
  layerId: string;
  id: string;
}

// Brush = how a single paint action spreads + randomizes. size 1 + density 1 + no
// jitter == the classic one-cell brush.
export interface BrushSettings {
  size: number; // radius in cells (1 = single cell, 2 = 3×3, …)
  density: number; // 0..1 chance to paint each cell in the footprint
  randomRot: number; // ± degrees of random rotation on placed objects
  scaleMin: number;
  scaleMax: number;
  randomFlip: boolean; // randomly mirror placed objects
  jitter: number; // ± pixel offset on placed objects
  assetSet: AssetRef[]; // if non-empty, each placement picks a random asset from here
}

export const DEFAULT_BRUSH: BrushSettings = {
  size: 1,
  density: 1,
  randomRot: 0,
  scaleMin: 1,
  scaleMax: 1,
  randomFlip: false,
  jitter: 0,
  assetSet: [],
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

let pid = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${pid++}`;
const clone = <T>(v: T): T => structuredClone(v);

interface EditorState {
  doc: MapDoc;
  tool: Tool;
  selectedAsset?: AssetRef;
  activeLayerId: string;
  selection: Selection | null; // currently selected placed object
  cropTarget: CropTarget | null; // crop editor modal target (placement or asset)
  assetCropRev: number; // bumps when an asset's source crop changes (drives redraw)
  brush: BrushSettings;
  region: RegionRect | null; // marquee selection (cell rect) for preset capture
  presets: Preset[];
  stamp: Preset | null; // armed preset to stamp
  gridTile: number; // iso block size (px) — the grid-linked size variable
  level: number; // active elevation level: ground paint places blocks at this height
  showLevels: boolean; // overlay each cell's height number
  levelFocus: boolean; // dim blocks not at the active level (level-focus mode)
  fillColumn: boolean; // ground paint fills levels 0..active in one click (solid pillar)
  past: MapDoc[];
  future: MapDoc[];

  setTool: (t: Tool) => void;
  selectAsset: (a: AssetRef) => void;
  setActiveLayer: (id: string) => void;

  beginStroke: () => void; // snapshot for undo at the start of a drag/click
  applyAt: (cx: number, cy: number) => void;

  // Brush settings + random asset set.
  setBrush: (patch: Partial<BrushSettings>) => void;
  addToBrushSet: (a: AssetRef) => void;
  removeFromBrushSet: (i: number) => void;
  clearBrushSet: () => void;

  // Presets: marquee region → capture → stamp.
  setRegion: (r: RegionRect | null) => void;
  capturePreset: (name: string) => Promise<void>;
  deletePreset: (id: string) => void;
  renamePreset: (id: string, name: string) => void;
  armStamp: (p: Preset | null) => void;
  stampAt: (cx: number, cy: number) => void;
  importPresets: (arr: Preset[]) => void;

  // Object selection + transforms (Select tool).
  selectObject: (sel: Selection | null) => void;
  openCropPlacement: () => void;
  openCropAsset: (asset: AssetRef) => void;
  closeCrop: () => void;
  setAssetCropFor: (cat: string, file: string, crop: CropRect | undefined) => void;
  autoCropAsset: (cat: string, file: string) => Promise<void>;
  autoCropAssets: (assets: AssetRef[]) => Promise<void>;
  setGridTile: (w: number) => void;
  autoResizeAllIso: () => Promise<void>;
  setLevel: (n: number) => void;
  setShowLevels: (b: boolean) => void;
  setLevelFocus: (b: boolean) => void;
  setFillColumn: (b: boolean) => void;
  selectedPlacement: () => Placement | undefined;
  updateSelected: (patch: Partial<Placement>, history?: boolean) => void;
  nudgeSelected: (ddx: number, ddy: number) => void; // pixel move (no history; pair with beginStroke)
  deleteSelected: () => void;

  addLayer: () => void;
  removeLayer: (id: string) => void;
  renameLayer: (id: string, name: string) => void;
  toggleLayer: (id: string) => void;
  moveLayer: (id: string, dir: -1 | 1) => void;

  setGrid: (w: number, h: number) => void;
  newDoc: () => void;
  loadDoc: (doc: MapDoc) => void;

  undo: () => void;
  redo: () => void;
}

const HISTORY_CAP = 60;

export const useEditorStore = create<EditorState>((set, get) => {
  const pushHistory = () =>
    set((s) => ({ past: [...s.past, clone(s.doc)].slice(-HISTORY_CAP), future: [] }));

  const activeLayer = (doc: MapDoc, id: string): Layer | undefined =>
    doc.layers.find((l) => l.id === id);

  return {
    doc: loadSavedDoc() ?? emptyDoc(),
    tool: "paint",
    selectedAsset: undefined,
    activeLayerId: "ground",
    selection: null,
    cropTarget: null,
    assetCropRev: 0,
    brush: { ...DEFAULT_BRUSH },
    region: null,
    presets: loadPresets(),
    stamp: null,
    gridTile: loadTileW(),
    level: 0,
    showLevels: false,
    levelFocus: true,
    fillColumn: false,
    past: [],
    future: [],

    setTool: (t) => set((s) => ({ tool: t, selection: t === "select" ? s.selection : null })),

    selectAsset: (a) =>
      set((s) => {
        // Smart layer routing: tiles paint the ground; anything else goes to an object layer.
        let activeLayerId = s.activeLayerId;
        const active = activeLayer(s.doc, activeLayerId);
        if (a.cat === "isotiles") {
          activeLayerId = s.doc.layers.find((l) => l.kind === "ground")?.id ?? activeLayerId;
        } else if (active?.kind === "ground") {
          activeLayerId = s.doc.layers.find((l) => l.kind === "object")?.id ?? activeLayerId;
        }
        return { selectedAsset: a, activeLayerId, tool: s.tool === "pan" ? "paint" : s.tool };
      }),

    setActiveLayer: (id) => set({ activeLayerId: id }),

    beginStroke: () => pushHistory(),

    applyAt: (cx, cy) =>
      set((s) => {
        if (!inBounds(s.doc, cx, cy)) return {};
        const doc = { ...s.doc, cells: s.doc.cells.slice(), layers: s.doc.layers.slice() };
        const layer = activeLayer(doc, s.activeLayerId);
        const b = s.brush;
        const r = b.size - 1; // radius in cells

        // Random asset for a placement: from the brush set if any, else the palette pick.
        const pickAsset = (): AssetRef | undefined => {
          if (b.assetSet.length) return { ...b.assetSet[Math.floor(Math.random() * b.assetSet.length)] };
          return s.selectedAsset ? { ...s.selectedAsset } : undefined;
        };
        // Random transforms applied to a freshly placed object.
        const randomXf = (): Partial<Placement> => {
          const xf: Partial<Placement> = {};
          if (b.randomRot) xf.rot = Math.round(rand(-b.randomRot, b.randomRot));
          if (b.scaleMin !== 1 || b.scaleMax !== 1) xf.scale = +rand(b.scaleMin, b.scaleMax).toFixed(2);
          if (b.randomFlip) xf.flipX = Math.random() < 0.5;
          if (b.jitter) {
            xf.dx = Math.round(rand(-b.jitter, b.jitter));
            xf.dy = Math.round(rand(-b.jitter, b.jitter));
          }
          return xf;
        };

        // Build the brush footprint (centre always included; others gated by density).
        const cells: { cx: number; cy: number }[] = [];
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (!inBounds(doc, nx, ny)) continue;
            const isCentre = dx === 0 && dy === 0;
            if (!isCentre && Math.random() > b.density) continue;
            cells.push({ cx: nx, cy: ny });
          }

        // Height tools: raise = add a block on top (copy of the top block), lower = remove
        // the top block. Operates on the stack of every footprint cell.
        if (s.tool === "raise" || s.tool === "lower") {
          for (const c of cells) {
            const i = c.cy * doc.gridW + c.cx;
            const cell = { ...doc.cells[i], blocks: doc.cells[i].blocks.slice() };
            if (s.tool === "raise") {
              const top = topLevel(cell);
              const fill = cell.blocks[top] ?? s.selectedAsset;
              if (fill && cell.blocks.length <= MAX_HEIGHT)
                cell.blocks[cellOccupied(cell) ? top + 1 : 0] = { ...fill };
            } else {
              cell.blocks[topLevel(cell)] = null;
            }
            recomputeCell(cell);
            doc.cells[i] = cell;
          }
          return { doc };
        }

        if (!layer) return {};

        if (layer.kind === "ground") {
          let changed = false;
          for (const c of cells) {
            const i = c.cy * doc.gridW + c.cx;
            const cell = { ...doc.cells[i], blocks: doc.cells[i].blocks.slice() };
            if (s.tool === "erase") {
              // Remove the block at the active level (or the top one if that level is empty).
              const lvl = cell.blocks[s.level] ? s.level : topLevel(cell);
              cell.blocks[lvl] = null;
            } else if (s.tool === "paint") {
              const a = pickAsset();
              if (!a) continue;
              const lvl = Math.min(s.level, MAX_HEIGHT);
              while (cell.blocks.length <= lvl) cell.blocks.push(null);
              if (s.fillColumn) {
                // One block spanning levels 0..active — a solid pillar in one click.
                for (let L = 0; L <= lvl; L++) cell.blocks[L] = { ...a };
              } else {
                cell.blocks[lvl] = a; // stack a single block at the active elevation
              }
            } else continue;
            recomputeCell(cell);
            doc.cells[i] = cell;
            changed = true;
          }
          return changed ? { doc } : {};
        }

        // Object layer.
        const li = doc.layers.findIndex((l) => l.id === layer.id);
        const nl: Layer = { ...layer, placements: layer.placements.slice() };
        let changed = false;
        for (const c of cells) {
          if (s.tool === "erase") {
            for (let i = nl.placements.length - 1; i >= 0; i--)
              if (nl.placements[i].cx === c.cx && nl.placements[i].cy === c.cy) {
                nl.placements.splice(i, 1);
                changed = true;
                break;
              }
          } else if (s.tool === "paint") {
            const a = pickAsset();
            if (!a) continue;
            // For a plain (non-random, single) brush, skip if the same asset is already on
            // top — prevents drag spam. Random/scatter brushes intentionally stack.
            const isPlain = b.size === 1 && !b.assetSet.length && !b.randomRot && !b.jitter && !b.randomFlip && b.scaleMin === 1 && b.scaleMax === 1;
            if (isPlain) {
              const top = [...nl.placements].reverse().find((p) => p.cx === c.cx && p.cy === c.cy);
              if (top && top.asset.cat === a.cat && top.asset.file === a.file) continue;
            }
            nl.placements.push({ id: newId("p"), cx: c.cx, cy: c.cy, asset: a, ...randomXf() });
            changed = true;
          }
        }
        if (!changed) return {};
        doc.layers[li] = nl;
        return { doc };
      }),

    setBrush: (patch) => set((s) => ({ brush: { ...s.brush, ...patch } })),
    addToBrushSet: (a) =>
      set((s) => {
        if (s.brush.assetSet.some((x) => x.cat === a.cat && x.file === a.file)) return {};
        return { brush: { ...s.brush, assetSet: [...s.brush.assetSet, { ...a }] } };
      }),
    removeFromBrushSet: (i) =>
      set((s) => ({ brush: { ...s.brush, assetSet: s.brush.assetSet.filter((_, k) => k !== i) } })),
    clearBrushSet: () => set((s) => ({ brush: { ...s.brush, assetSet: [] } })),

    setRegion: (r) => set({ region: r }),

    capturePreset: async (name) => {
      const { doc, region } = get();
      if (!region) return;
      const { x, y, w, h } = region;
      const cells = [];
      for (let cy = y; cy < y + h; cy++)
        for (let cx = x; cx < x + w; cx++) {
          if (!inBounds(doc, cx, cy)) continue;
          const c = doc.cells[cy * doc.gridW + cx];
          if (c && cellOccupied(c))
            cells.push({ dx: cx - x, dy: cy - y, blocks: c.blocks.map((b) => (b ? { ...b } : null)) });
        }
      const objects = [];
      for (const l of doc.layers)
        if (l.kind === "object")
          for (const p of l.placements)
            if (p.cx >= x && p.cx < x + w && p.cy >= y && p.cy < y + h)
              objects.push({
                dx: p.cx - x,
                dy: p.cy - y,
                asset: { ...p.asset },
                scale: p.scale,
                rot: p.rot,
                flipX: p.flipX,
                lift: p.lift,
                crop: p.crop,
              });
      const preset: Preset = { id: newId("preset"), name: name || "Preset", w, h, cells, objects };
      // Add immediately, then fill in a thumbnail asynchronously.
      set((s) => {
        const presets = [...s.presets, preset];
        savePresets(presets);
        return { presets, region: null };
      });
      const thumb = await presetThumb(preset);
      if (thumb)
        set((s) => {
          const presets = s.presets.map((p) => (p.id === preset.id ? { ...p, thumb } : p));
          savePresets(presets);
          return { presets };
        });
    },

    deletePreset: (id) =>
      set((s) => {
        const presets = s.presets.filter((p) => p.id !== id);
        savePresets(presets);
        return { presets, stamp: s.stamp?.id === id ? null : s.stamp };
      }),

    renamePreset: (id, name) =>
      set((s) => {
        const presets = s.presets.map((p) => (p.id === id ? { ...p, name } : p));
        savePresets(presets);
        return { presets };
      }),

    armStamp: (p) => set({ stamp: p, tool: p ? "stamp" : "select", region: null }),

    stampAt: (cx, cy) =>
      set((s) => {
        if (!s.stamp) return {};
        const doc = { ...s.doc, cells: s.doc.cells.slice(), layers: s.doc.layers.slice() };
        // Ground cells: overwrite the whole stack.
        for (const c of s.stamp.cells) {
          const nx = cx + c.dx;
          const ny = cy + c.dy;
          if (!inBounds(doc, nx, ny)) continue;
          const blocks = (c.blocks ?? []).map((b) => (b ? { ...b } : null));
          const cell = { blocks, height: 0 };
          recomputeCell(cell);
          doc.cells[ny * doc.gridW + nx] = cell;
        }
        // Objects: add to the active object layer (fall back to the first object layer).
        let target = doc.layers.find((l) => l.id === s.activeLayerId && l.kind === "object");
        if (!target) target = doc.layers.find((l) => l.kind === "object");
        if (target && s.stamp.objects.length) {
          const li = doc.layers.findIndex((l) => l.id === target!.id);
          const nl: Layer = { ...target, placements: target.placements.slice() };
          for (const o of s.stamp.objects) {
            const nx = cx + o.dx;
            const ny = cy + o.dy;
            if (!inBounds(doc, nx, ny)) continue;
            nl.placements.push({
              id: newId("p"),
              cx: nx,
              cy: ny,
              asset: { ...o.asset },
              scale: o.scale,
              rot: o.rot,
              flipX: o.flipX,
              lift: o.lift,
              crop: o.crop,
            });
          }
          doc.layers[li] = nl;
        }
        return { doc };
      }),

    importPresets: (arr) =>
      set((s) => {
        const presets = [...s.presets, ...arr];
        savePresets(presets);
        return { presets };
      }),

    selectObject: (sel) => set({ selection: sel, cropTarget: null }),

    openCropPlacement: () => set({ cropTarget: { kind: "placement" } }),
    openCropAsset: (asset) => set({ cropTarget: { kind: "asset", asset: { ...asset } } }),
    closeCrop: () => set({ cropTarget: null }),
    setAssetCropFor: (cat, file, crop) => {
      setAssetCrop(cat, file, crop);
      set((s) => ({ assetCropRev: s.assetCropRev + 1 }));
    },

    autoCropAsset: async (cat, file) => {
      const crop = await detectContentCrop(cat, file);
      if (crop) {
        setAssetCrop(cat, file, crop);
        set((s) => ({ assetCropRev: s.assetCropRev + 1 }));
      }
    },

    autoCropAssets: async (assets) => {
      let any = false;
      for (const a of assets) {
        const crop = await detectContentCrop(a.cat, a.file);
        if (crop) {
          setAssetCrop(a.cat, a.file, crop);
          any = true;
        }
      }
      if (any) set((s) => ({ assetCropRev: s.assetCropRev + 1 }));
    },

    setGridTile: (w) => {
      w = Math.max(16, Math.min(256, Math.round(w)));
      setIsoTileSize(w);
      try {
        localStorage.setItem(LS_TILE, String(w));
      } catch {
        /* ignore */
      }
      set({ gridTile: w });
    },

    setLevel: (n) => set({ level: Math.max(0, Math.min(MAX_HEIGHT, Math.round(n))) }),
    setShowLevels: (b) => set({ showLevels: b }),
    setLevelFocus: (b) => set({ levelFocus: b }),
    setFillColumn: (b) => set({ fillColumn: b }),

    // One pass: auto-crop every iso tile so they all frame their cube tightly and render at
    // the uniform block size (tileW). The "resize all blocks to the grid size" action.
    autoResizeAllIso: async () => {
      const iso = ALL_ASSETS.filter((a) => a.cat === "isotiles").map((a) => ({ cat: a.cat, file: a.file }));
      await get().autoCropAssets(iso);
    },

    selectedPlacement: () => {
      const { doc, selection } = get();
      if (!selection) return undefined;
      const layer = doc.layers.find((l) => l.id === selection.layerId);
      return layer?.placements.find((p) => p.id === selection.id);
    },

    updateSelected: (patch, history = true) => {
      if (history) pushHistory();
      set((s) => {
        if (!s.selection) return {};
        const layers = s.doc.layers.map((l) => {
          if (l.id !== s.selection!.layerId) return l;
          return {
            ...l,
            placements: l.placements.map((p) => (p.id === s.selection!.id ? { ...p, ...patch } : p)),
          };
        });
        return { doc: { ...s.doc, layers } };
      });
    },

    nudgeSelected: (ddx, ddy) =>
      set((s) => {
        if (!s.selection) return {};
        const layers = s.doc.layers.map((l) => {
          if (l.id !== s.selection!.layerId) return l;
          return {
            ...l,
            placements: l.placements.map((p) =>
              p.id === s.selection!.id ? { ...p, dx: (p.dx ?? 0) + ddx, dy: (p.dy ?? 0) + ddy } : p,
            ),
          };
        });
        return { doc: { ...s.doc, layers } };
      }),

    deleteSelected: () => {
      const { selection } = get();
      if (!selection) return;
      pushHistory();
      set((s) => {
        const layers = s.doc.layers.map((l) =>
          l.id === selection.layerId
            ? { ...l, placements: l.placements.filter((p) => p.id !== selection.id) }
            : l,
        );
        return { doc: { ...s.doc, layers }, selection: null };
      });
    },

    addLayer: () => {
      pushHistory();
      set((s) => {
        const doc = { ...s.doc, layers: s.doc.layers.slice() };
        const n = doc.layers.filter((l) => l.kind === "object").length + 1;
        const layer: Layer = {
          id: newId("layer"),
          name: `Calque ${n}`,
          kind: "object",
          visible: true,
          placements: [],
        };
        doc.layers.push(layer);
        return { doc, activeLayerId: layer.id };
      });
    },

    removeLayer: (id) => {
      const l = get().doc.layers.find((x) => x.id === id);
      if (!l || l.kind === "ground") return; // never remove the ground layer
      pushHistory();
      set((s) => {
        const layers = s.doc.layers.filter((x) => x.id !== id);
        const activeLayerId = s.activeLayerId === id ? layers[0].id : s.activeLayerId;
        const selection = s.selection?.layerId === id ? null : s.selection;
        return { doc: { ...s.doc, layers }, activeLayerId, selection };
      });
    },

    renameLayer: (id, name) =>
      set((s) => ({
        doc: { ...s.doc, layers: s.doc.layers.map((l) => (l.id === id ? { ...l, name } : l)) },
      })),

    toggleLayer: (id) =>
      set((s) => ({
        doc: {
          ...s.doc,
          layers: s.doc.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
        },
      })),

    moveLayer: (id, dir) => {
      pushHistory();
      set((s) => {
        const layers = s.doc.layers.slice();
        const i = layers.findIndex((l) => l.id === id);
        const j = i + dir;
        // Keep the ground layer pinned at the bottom (index 0).
        if (i <= 0 || j <= 0 || j >= layers.length) return {};
        [layers[i], layers[j]] = [layers[j], layers[i]];
        return { doc: { ...s.doc, layers } };
      });
    },

    setGrid: (w, h) => {
      pushHistory();
      set((s) => {
        w = Math.max(1, Math.min(64, Math.floor(w)));
        h = Math.max(1, Math.min(64, Math.floor(h)));
        const cells = Array.from({ length: w * h }, (_, k) => {
          const cx = k % w;
          const cy = Math.floor(k / w);
          const old = cx < s.doc.gridW && cy < s.doc.gridH ? s.doc.cells[cy * s.doc.gridW + cx] : undefined;
          return old ? { ...old, blocks: old.blocks.slice() } : { blocks: [], height: 0 };
        });
        // Drop out-of-range placements.
        const layers = s.doc.layers.map((l) => ({
          ...l,
          placements: l.placements.filter((p) => p.cx < w && p.cy < h),
        }));
        return { doc: { ...s.doc, gridW: w, gridH: h, cells, layers } };
      });
    },

    newDoc: () => {
      pushHistory();
      set((s) => ({ doc: emptyDoc(s.doc.gridW, s.doc.gridH), activeLayerId: "ground", selection: null }));
    },

    loadDoc: (doc) => {
      pushHistory();
      set({
        doc,
        activeLayerId: doc.layers.find((l) => l.kind === "ground")?.id ?? doc.layers[0]?.id,
        selection: null,
      });
    },

    undo: () =>
      set((s) => {
        if (!s.past.length) return {};
        const past = s.past.slice();
        const prev = past.pop()!;
        return { doc: prev, past, future: [clone(s.doc), ...s.future].slice(0, HISTORY_CAP), selection: null };
      }),

    redo: () =>
      set((s) => {
        if (!s.future.length) return {};
        const [next, ...future] = s.future;
        return { doc: next, future, past: [...s.past, clone(s.doc)].slice(-HISTORY_CAP), selection: null };
      }),
  };
});

// Apply the persisted iso block size to the live projection at startup.
setIsoTileSize(useEditorStore.getState().gridTile);

// Autosave the doc (debounced) whenever it changes, so a reload restores the map.
let _saveTimer: ReturnType<typeof setTimeout> | undefined;
let _lastDoc = useEditorStore.getState().doc;
useEditorStore.subscribe((s) => {
  if (s.doc === _lastDoc) return;
  _lastDoc = s.doc;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_DOC, JSON.stringify(useEditorStore.getState().doc));
    } catch {
      /* quota / disabled — keep in memory only */
    }
  }, 500);
});

// DEV hook for inspection/testing (mirrors window.__eg for the game store).
if (import.meta.env.DEV) (window as unknown as { __ed: unknown }).__ed = useEditorStore;
