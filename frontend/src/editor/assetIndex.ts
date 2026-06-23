// Asset index for the map editor.
//
// We enumerate EVERY png under frontend/public/assets/ at build time via Vite's
// import.meta.glob (eager, ?url) so the palette always reflects what's actually on
// disk — no manual list to maintain. Each entry exposes its category (the folder
// name), file (basename without extension) and a resolved URL usable in <img>/canvas.

export interface AssetEntry {
  cat: string; // folder under assets/ (isotiles, buildings, …)
  file: string; // basename without .png
  url: string; // resolved, hashed URL (works in dev and build)
  label: string; // human label for the palette
}

// We use import.meta.glob ONLY to enumerate the files on disk at build time — the lazy
// importers are never called, so nothing is bundled/duplicated. The actual URL is the
// public path (/assets/cat/file.png), exactly like the rest of the game references it.
const modules = import.meta.glob("../../public/assets/**/*.png") as Record<string, unknown>;
const publicUrl = (cat: string, file: string) => `/assets/${cat}/${file}.png`;

function prettify(file: string): string {
  // "bld-blacksmith" / "iso-darkgrass" → "Blacksmith" / "Darkgrass"
  const noPrefix = file.replace(/^(bld|iso|mtile|mat|obj|food|weapon|tool|med|potion|misc|prop|mob|char|tile|nav|hero)-/, "");
  return noPrefix
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const ALL_ASSETS: AssetEntry[] = Object.keys(modules)
  .map((path) => {
    const m = path.match(/\/assets\/([^/]+)\/(.+)\.png$/);
    if (!m) return null;
    const [, cat, file] = m;
    return { cat, file, url: publicUrl(cat, file), label: prettify(file) } as AssetEntry;
  })
  .filter((e): e is AssetEntry => e !== null)
  .sort((a, b) => a.file.localeCompare(b.file));

// Categories surfaced in the palette, in display order. Anything not listed here is
// grouped under "Divers" at the end.
export const CATEGORY_ORDER: { cat: string; label: string }[] = [
  { cat: "isotiles", label: "Tuiles iso" },
  { cat: "buildings", label: "Bâtiments" },
  { cat: "props", label: "Décor / Props" },
  { cat: "objects", label: "Objets" },
  { cat: "characters", label: "Personnages" },
  { cat: "monsters", label: "Monstres" },
  { cat: "tiles", label: "Tuiles (top-down)" },
];

const KNOWN = new Set(CATEGORY_ORDER.map((c) => c.cat));

export interface AssetCategory {
  cat: string;
  label: string;
  entries: AssetEntry[];
}

export function groupedAssets(): AssetCategory[] {
  const byCat = new Map<string, AssetEntry[]>();
  for (const e of ALL_ASSETS) {
    if (!byCat.has(e.cat)) byCat.set(e.cat, []);
    byCat.get(e.cat)!.push(e);
  }
  const out: AssetCategory[] = [];
  for (const { cat, label } of CATEGORY_ORDER) {
    if (byCat.has(cat)) out.push({ cat, label, entries: byCat.get(cat)! });
  }
  // Trailing "Divers" bucket for any leftover folders (bg, islands, ui, npc, heroes…).
  const misc: AssetEntry[] = [];
  for (const [cat, entries] of byCat) if (!KNOWN.has(cat)) misc.push(...entries);
  if (misc.length) out.push({ cat: "_misc", label: "Divers", entries: misc });
  return out;
}

// Resolve an {cat,file} reference (as stored in the document) back to a URL.
const URL_BY_KEY = new Map<string, string>(ALL_ASSETS.map((e) => [`${e.cat}/${e.file}`, e.url]));
export function assetUrlFor(cat: string, file: string): string | undefined {
  return URL_BY_KEY.get(`${cat}/${file}`);
}
