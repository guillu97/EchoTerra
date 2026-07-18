// Store de l'éditeur voxel (Phase 1b) — séparé du store du jeu, hook DEV
// window.__vx. Le MODÈLE (grille + palette) vit en mutable dans le store ;
// `rev` est bumpé à chaque mutation → la vue re-meshe. Undo/redo par snapshots
// (data ~40 Ko, plafonné). Autosave localStorage + export/import .vox.

import { create } from "zustand";
import type { VoxModel } from "../voxel/vox";
import { decodeVox } from "../voxel/vox";
// modules JS pur PARTAGÉS avec le CLI (VOXEL-PLAN Phase 1b : recettes live)
import { generateBlock } from "../voxel/shared/recipes.mjs";
import { encodeVox } from "../voxel/shared/vox-format.mjs";

export type Tool = "nav" | "place" | "erase" | "pick";
export type ViewMode = "single" | "tiling" | "stack";

export type RecipeEntry = {
  palette: { top: number[][]; side: number[][]; accents: number[][] };
  recipe: string;
  params: Record<string, number>;
};

const SAVE_KEY = "echoterra:voxeled:doc";
const HISTORY_MAX = 60;

// Bibliothèque : tous les .vox publiés (clés du glob → URLs /voxels/…).
const voxFiles = import.meta.glob("../../public/voxels/**/*.vox", { query: "?url" });
export const LIBRARY: { key: string; url: string; lod: string; id: string }[] = Object.keys(voxFiles)
  .map((k) => {
    const url = k.replace("../../public", "");
    const rel = url.replace("/voxels/", "");
    const lod = rel.includes("/") ? rel.split("/")[0] : "32";
    const id = rel.split("/").pop()!.replace(".vox", "");
    return { key: rel.replace(".vox", ""), url, lod, id };
  })
  .sort((a, b) => a.lod.localeCompare(b.lod) || a.id.localeCompare(b.id));

type Snapshot = { data: Uint8Array; palette: [number, number, number][] };

type VoxEditState = {
  model: VoxModel | null;
  modelName: string; // ex "grass-v0"
  rev: number; // bump = re-mesh
  tool: Tool;
  colorIdx: number; // 1-based dans model.palette
  mirrorX: boolean;
  view: ViewMode;
  orbit: boolean;
  status: string;
  recipes: Record<string, RecipeEntry> | null; // palettes.json
  recipeParams: Record<string, number>;
  recipeSeed: number;
  recipeSize: number;
  history: Snapshot[];
  future: Snapshot[];

  loadUrl: (url: string, name: string) => Promise<void>;
  loadRecipes: () => Promise<void>;
  setTool: (t: Tool) => void;
  setView: (v: ViewMode) => void;
  setOrbit: (o: boolean) => void;
  setMirrorX: (m: boolean) => void;
  setColorIdx: (i: number) => void;
  addColor: (rgb: [number, number, number]) => void;
  editVoxel: (x: number, y: number, z: number, v: number) => void;
  undo: () => void;
  redo: () => void;
  setRecipeParam: (k: string, v: number) => void;
  setRecipeSeed: (s: number) => void;
  setRecipeSize: (s: number) => void;
  regenerate: () => void;
  exportVox: () => void;
  importVox: (file: File) => Promise<void>;
  restore: () => boolean;
};

// Tronque la palette d'un .vox décodé aux couleurs réellement utilisées :
// le format stocke 255 entrées, les inutilisées seraient des pastilles noires.
function trimPalette(m: VoxModel): VoxModel {
  let max = 0;
  for (const v of m.data) if (v > max) max = v;
  m.palette = m.palette.slice(0, Math.max(1, max));
  return m;
}

function snapshot(m: VoxModel): Snapshot {
  return { data: new Uint8Array(m.data), palette: m.palette.map((c) => [...c] as [number, number, number]) };
}

function persist(state: { model: VoxModel | null; modelName: string }) {
  if (!state.model) return;
  const m = state.model;
  // Uint8Array → base64 par morceaux (éviter le dépassement d'arguments)
  let bin = "";
  for (let i = 0; i < m.data.length; i += 8192) bin += String.fromCharCode(...m.data.subarray(i, i + 8192));
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({ name: state.modelName, sx: m.sx, sy: m.sy, sz: m.sz, palette: m.palette, data: btoa(bin) }),
    );
  } catch { /* quota plein : tant pis pour l'autosave */ }
}
let saveTimer = 0;
function schedulePersist(get: () => VoxEditState) {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => persist(get()), 600);
}

export const useVoxEdit = create<VoxEditState>((set, get) => ({
  model: null,
  modelName: "",
  rev: 0,
  tool: "nav",
  colorIdx: 1,
  mirrorX: false,
  view: "single",
  orbit: false,
  status: "",
  recipes: null,
  recipeParams: {},
  recipeSeed: 42,
  recipeSize: 32,
  history: [],
  future: [],

  loadUrl: async (url, name) => {
    const res = await fetch(url);
    const model = trimPalette(decodeVox(new Uint8Array(await res.arrayBuffer())));
    // ne garder que les couleurs réellement présentes en palette éditable
    const { recipes } = get();
    const baseId = name.replace(/-v\d+$/, "");
    set({
      model,
      modelName: name,
      history: [],
      future: [],
      colorIdx: 1,
      rev: get().rev + 1,
      status: `${name} (${model.sx}×${model.sy}×${model.sz})`,
      recipeParams: { ...(recipes?.[baseId]?.params ?? {}) },
    });
    schedulePersist(get);
  },

  loadRecipes: async () => {
    try {
      const res = await fetch("/voxels/palettes.json");
      if (!res.ok) return;
      const recipes = (await res.json()) as Record<string, RecipeEntry>;
      set({ recipes });
      // le bloc initial a pu se charger AVANT ce fetch : compléter ses params
      const { modelName, recipeParams } = get();
      const entry = recipes[modelName.replace(/-v\d+$/, "")];
      if (entry && !Object.keys(recipeParams).length) set({ recipeParams: { ...entry.params } });
    } catch { /* pas de palettes.json : recettes live indisponibles */ }
  },

  setTool: (tool) => set({ tool }),
  setView: (view) => set({ view, rev: get().rev + 1 }),
  setOrbit: (orbit) => set({ orbit }),
  setMirrorX: (mirrorX) => set({ mirrorX }),
  setColorIdx: (colorIdx) => set({ colorIdx }),

  addColor: (rgb) => {
    const m = get().model;
    if (!m || m.palette.length >= 255) return;
    m.palette.push(rgb);
    set({ colorIdx: m.palette.length, rev: get().rev + 1 });
    schedulePersist(get);
  },

  editVoxel: (x, y, z, v) => {
    const m = get().model;
    if (!m) return;
    if (x < 0 || y < 0 || z < 0 || x >= m.sx || y >= m.sy || z >= m.sz) return;
    const idx = x + y * m.sx + z * m.sx * m.sy;
    if (m.data[idx] === v) return;
    const hist = [...get().history, snapshot(m)].slice(-HISTORY_MAX);
    m.data[idx] = v;
    if (get().mirrorX) {
      const mx = m.sx - 1 - x;
      if (mx !== x) m.data[mx + y * m.sx + z * m.sx * m.sy] = v;
    }
    set({ history: hist, future: [], rev: get().rev + 1 });
    schedulePersist(get);
  },

  undo: () => {
    const { model, history, future } = get();
    if (!model || !history.length) return;
    const prev = history[history.length - 1];
    const fut = [...future, snapshot(model)].slice(-HISTORY_MAX);
    model.data.set(prev.data);
    model.palette = prev.palette;
    set({ history: history.slice(0, -1), future: fut, rev: get().rev + 1 });
    schedulePersist(get);
  },
  redo: () => {
    const { model, history, future } = get();
    if (!model || !future.length) return;
    const nxt = future[future.length - 1];
    const hist = [...history, snapshot(model)].slice(-HISTORY_MAX);
    model.data.set(nxt.data);
    model.palette = nxt.palette;
    set({ history: hist, future: future.slice(0, -1), rev: get().rev + 1 });
    schedulePersist(get);
  },

  setRecipeParam: (k, v) => set({ recipeParams: { ...get().recipeParams, [k]: v } }),
  setRecipeSeed: (recipeSeed) => set({ recipeSeed }),
  setRecipeSize: (recipeSize) => set({ recipeSize }),

  // Régénère le bloc courant avec recipes.mjs (module partagé avec le CLI) —
  // la palette vient de palettes.json (extraction sharp faite côté Node).
  regenerate: () => {
    const { recipes, modelName, recipeParams, recipeSeed, recipeSize } = get();
    const baseId = modelName.replace(/-v\d+$/, "");
    const entry = recipes?.[baseId];
    if (!entry) { set({ status: `pas de recette pour « ${baseId} »` }); return; }
    const out = generateBlock(
      { recipe: entry.recipe, params: recipeParams },
      { top: entry.palette.top, side: entry.palette.side, accents: entry.palette.accents },
      { size: recipeSize, seed: recipeSeed },
    );
    const m = get().model;
    const hist = m ? [...get().history, snapshot(m)].slice(-HISTORY_MAX) : get().history;
    set({
      model: { sx: out.sx, sy: out.sy, sz: out.sz, data: out.data, palette: out.palette },
      history: hist,
      future: [],
      rev: get().rev + 1,
      status: `régénéré ${baseId} (seed ${recipeSeed}, ${recipeSize}³)`,
    });
    schedulePersist(get);
  },

  exportVox: () => {
    const { model, modelName } = get();
    if (!model) return;
    const bytes = encodeVox(model);
    const blob = new Blob([bytes as unknown as BlobPart], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${modelName || "bloc"}.vox`;
    a.click();
    URL.revokeObjectURL(a.href);
    set({ status: `exporté ${a.download} — à redéposer dans public/voxels/` });
  },

  importVox: async (file) => {
    const model = trimPalette(decodeVox(new Uint8Array(await file.arrayBuffer())));
    set({
      model,
      modelName: file.name.replace(".vox", ""),
      history: [],
      future: [],
      rev: get().rev + 1,
      status: `importé ${file.name} (${model.sx}×${model.sy}×${model.sz})`,
    });
    schedulePersist(get);
  },

  restore: () => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const doc = JSON.parse(raw);
      const bin = atob(doc.data);
      const data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      set({
        model: { sx: doc.sx, sy: doc.sy, sz: doc.sz, data, palette: doc.palette },
        modelName: doc.name,
        rev: get().rev + 1,
        status: `${doc.name} (restauré)`,
      });
      return true;
    } catch {
      return false;
    }
  },
}));

if (import.meta.env.DEV) {
  (window as unknown as { __vx?: unknown }).__vx = { store: useVoxEdit };
}
