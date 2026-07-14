import { create } from "zustand";
import type { BiomeResourceDef, BuildingDef, DesignDoc, HeroClassDef, MapGenDef, MonsterDef, RecipeDef } from "./types";
import { DESIGN_DOC_VERSION, seedDoc } from "./types";

// Designer store — separate from the game store, like the map editor's. The doc is
// autosaved to localStorage (debounced) and restored on load, so a refresh never
// loses design work. Export/import via JSON files (see DesignerScreen).

export type DesignTab = "buildings" | "recipes" | "classes" | "resources" | "monsters" | "mapgen";

const LS_KEY = "echoterra:designer:doc";

function loadSavedDoc(): DesignDoc {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return seedDoc();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.buildings)) return seedDoc();
    return { ...seedDoc(), ...parsed, version: parsed.version ?? DESIGN_DOC_VERSION };
  } catch {
    return seedDoc();
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function autosave(doc: DesignDoc) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(doc));
    } catch {
      /* quota — design data is small, ignore */
    }
  }, 400);
}

interface DesignerState {
  doc: DesignDoc;
  tab: DesignTab;
  selId: Record<DesignTab, string | null>;
  setTab: (t: DesignTab) => void;
  select: (id: string | null) => void;
  // Generic per-collection updates: replace the item with the same INDEX (ids are
  // editable, so matching by index keeps a renamed item selected).
  updateBuilding: (id: string, next: BuildingDef) => void;
  updateRecipe: (id: string, next: RecipeDef) => void;
  updateClass: (id: string, next: HeroClassDef) => void;
  updateResource: (id: string, next: BiomeResourceDef) => void;
  updateMonster: (id: string, next: MonsterDef) => void;
  updateMapgen: (next: MapGenDef) => void;
  addItem: () => void;
  removeItem: (id: string) => void;
  importDoc: (doc: DesignDoc) => void;
  resetSeed: () => void;
}

const freshId = (base: string, taken: string[]): string => {
  let n = 1;
  let id = base;
  while (taken.includes(id)) id = `${base}-${++n}`;
  return id;
};

export const useDesigner = create<DesignerState>((set, get) => {
  const setDoc = (doc: DesignDoc) => {
    autosave(doc);
    set({ doc });
  };
  const replace = <T extends { id: string }>(list: T[], id: string, next: T): T[] =>
    list.map((it) => (it.id === id ? next : it));

  return {
    doc: loadSavedDoc(),
    tab: "buildings",
    selId: { buildings: null, recipes: null, classes: null, resources: null, monsters: null, mapgen: null },
    setTab: (tab) => set({ tab }),
    select: (id) => set((s) => ({ selId: { ...s.selId, [s.tab]: id } })),

    updateBuilding: (id, next) => {
      const { doc } = get();
      setDoc({ ...doc, buildings: replace(doc.buildings, id, next) });
      if (next.id !== id) get().select(next.id);
    },
    updateRecipe: (id, next) => {
      const { doc } = get();
      setDoc({ ...doc, recipes: replace(doc.recipes, id, next) });
      if (next.id !== id) get().select(next.id);
    },
    updateClass: (id, next) => {
      const { doc } = get();
      setDoc({ ...doc, classes: replace(doc.classes, id, next) });
      if (next.id !== id) get().select(next.id);
    },
    updateResource: (id, next) => {
      const { doc } = get();
      setDoc({ ...doc, resources: replace(doc.resources, id, next) });
      if (next.id !== id) get().select(next.id);
    },
    updateMonster: (id, next) => {
      const { doc } = get();
      setDoc({ ...doc, monsters: replace(doc.monsters, id, next) });
      if (next.id !== id) get().select(next.id);
    },
    updateMapgen: (next) => setDoc({ ...get().doc, mapgen: next }),

    addItem: () => {
      const { doc, tab } = get();
      if (tab === "mapgen") return; // single parameter set — nothing to add
      if (tab === "buildings") {
        const id = freshId("nouveau-batiment", doc.buildings.map((b) => b.id));
        const b: BuildingDef = { id, name: "Nouveau bâtiment", icon: "🏚️", blurb: "", startsBuilt: false, requires: [], levels: [{ pa: 2, materials: [{ name: "Bois", qty: 2 }], effects: "" }] };
        setDoc({ ...doc, buildings: [...doc.buildings, b] });
      } else if (tab === "recipes") {
        const id = freshId("nouvelle-recette", doc.recipes.map((r) => r.id));
        const r: RecipeDef = { id, name: "Nouvelle recette", icon: "📦", category: "conso", building: "", buildingLevel: 1, field: false, pa: 1, ingredients: [{ name: "Bois", qty: 1 }], output: { type: "objet", name: "Nouvel objet", qty: 1 }, effects: "" };
        setDoc({ ...doc, recipes: [...doc.recipes, r] });
      } else if (tab === "classes") {
        const id = freshId("nouvelle-classe", doc.classes.map((c) => c.id));
        const c: HeroClassDef = { id, name: "Nouvelle classe", tier: 1, day: 2, requires: [], role: "", bonuses: { force: 0, dexterite: 0, agilite: 0, endurance: 0, athletisme: 0, precision: 0 }, paBonus: 0, skills: [], appearance: { map: "char-scout", icon: "char-scout" } };
        setDoc({ ...doc, classes: [...doc.classes, c] });
      } else if (tab === "resources") {
        const id = freshId("nouveau-biome", doc.resources.map((r) => r.id));
        const r: BiomeResourceDef = { id, name: "Nouveau biome", icon: "🗺️", walkable: true, searchable: true, resourcesMin: 1, resourcesMax: 3, drops: [], notes: "" };
        setDoc({ ...doc, resources: [...doc.resources, r] });
      } else {
        const id = freshId("nouveau-monstre", doc.monsters.map((m) => m.id));
        const m: MonsterDef = { id, name: "Nouveau monstre", icon: "👾", appearance: "mob-slime", hp: 8, stats: { force: 2, dexterite: 0, agilite: 2, endurance: 2, athletisme: 0, precision: 2 }, packMin: 1, packMax: 2, biomes: [], special: "", drops: [], notes: "" };
        setDoc({ ...doc, monsters: [...doc.monsters, m] });
      }
      const s = get();
      const list =
        s.tab === "buildings" ? s.doc.buildings :
        s.tab === "recipes" ? s.doc.recipes :
        s.tab === "classes" ? s.doc.classes :
        s.tab === "resources" ? s.doc.resources : s.doc.monsters;
      s.select(list[list.length - 1].id);
    },

    removeItem: (id) => {
      const { doc, tab } = get();
      if (tab === "buildings")
        setDoc({
          ...doc,
          buildings: doc.buildings.filter((b) => b.id !== id).map((b) => ({ ...b, requires: b.requires.filter((r) => r.building !== id) })),
        });
      else if (tab === "recipes") setDoc({ ...doc, recipes: doc.recipes.filter((r) => r.id !== id) });
      else if (tab === "classes")
        setDoc({
          ...doc,
          classes: doc.classes.filter((c) => c.id !== id).map((c) => ({ ...c, requires: c.requires.filter((r) => r !== id) })),
        });
      else if (tab === "resources")
        setDoc({
          ...doc,
          resources: doc.resources.filter((r) => r.id !== id),
          // A removed biome disappears from the monsters' spawn lists too.
          monsters: doc.monsters.map((m) => ({ ...m, biomes: m.biomes.filter((b) => b !== id) })),
        });
      else setDoc({ ...doc, monsters: doc.monsters.filter((m) => m.id !== id) });
      get().select(null);
    },

    importDoc: (doc) => setDoc({ ...seedDoc(), ...doc, version: doc.version ?? DESIGN_DOC_VERSION }),
    resetSeed: () => setDoc(seedDoc()),
  };
});

if (import.meta.env.DEV) (window as unknown as { __dd: unknown }).__dd = useDesigner;
