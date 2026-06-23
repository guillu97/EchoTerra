// Build a searchable asset catalog from the manifest.
//
// Outputs:
//   asset-index/catalog.json  — machine-readable list (id, category, title, file, tags, style, prompt)
//   asset-index/CATALOG.md    — human-readable index grouped by category
//
// Purpose: any later session can grep these (by title / tags / category) to find
// the right asset — e.g. "an isometric character" → category=characters, tag "isometric".
//
// Run: node scripts/build-catalog.mjs   (also called automatically at the end of a generation run)

import { writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ASSETS, STYLE_FAR } from "./asset-manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PUBLIC = join(ROOT, "frontend", "public");

// Per-category keyword expansion so natural queries match (e.g. "isometric character").
const CAT_KW = {
  isotiles: ["isometric", "iso", "tile", "cube", "terrain", "ground", "biome", "block"],
  tiles: ["tile", "terrain", "ground", "top-down", "biome", "map"],
  objects: ["item", "object", "icon", "loot", "inventory"],
  buildings: ["building", "structure", "isometric", "iso"],
  characters: ["character", "hero", "person", "chibi", "rpg", "unit", "npc", "portrait", "isometric"],
  heroes: ["character", "hero", "person", "chibi", "rpg", "unit", "portrait", "isometric"],
  npc: ["character", "npc", "person", "chibi", "unit", "isometric"],
  monsters: ["monster", "enemy", "creature", "mob", "isometric"],
  props: ["prop", "decoration", "scenery", "isometric", "iso"],
  structures: ["structure", "building", "isometric", "iso"],
  islands: ["island", "terrain", "isometric", "iso", "biome", "map"],
  bg: ["background", "backdrop", "scene"],
  ui: ["ui", "interface", "icon", "hud", "button"],
};

const STOP = new Set([
  "a", "an", "the", "single", "with", "and", "of", "on", "its", "one",
  "small", "large", "building", "game", "asset", "view", "isolated", "nothing",
]);

const tokens = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w));

const titleFrom = (a) => {
  if (a.note) {
    const parts = a.note.split("—");
    return (parts[parts.length - 1] || a.note).trim();
  }
  return a.id.replace(/^[a-z]+-/, "").replace(/-/g, " ");
};

const entries = [];
for (const a of ASSETS) {
  if (a.id.startsWith("_")) continue; // scratch / test files never enter the catalog
  const file = `assets/${a.category}/${a.filename}`;
  const lod =
    a.category === "buildings" ? (a.style === STYLE_FAR ? "far" : "near") : null;
  const tagSet = new Set([
    a.category,
    ...(CAT_KW[a.category] || []),
    ...tokens(a.id.replace(/^[a-z]+-/, "")),
    ...tokens(a.note),
  ]);
  if (lod) tagSet.add(lod);
  entries.push({
    id: a.id,
    category: a.category,
    title: titleFrom(a),
    file,
    exists: existsSync(join(PUBLIC, file)),
    style: lod,
    tags: [...tagSet].sort(),
    prompt: (a.prompt || "").replace(/\s+/g, " ").trim(),
  });
}

entries.sort((x, y) =>
  x.category === y.category ? x.id.localeCompare(y.id) : x.category.localeCompare(y.category)
);

writeFileSync(join(ROOT, "asset-index", "catalog.json"), JSON.stringify(entries, null, 2));

// Human-readable index grouped by category.
const byCat = {};
for (const e of entries) (byCat[e.category] ||= []).push(e);
let md =
  `# Echo Terra — Asset catalog\n\n` +
  `Searchable index of generated assets. Machine-readable copy: \`catalog.json\`.\n` +
  `Each entry: id, category, title, file path, tags, style (near/far for buildings), prompt.\n` +
  `To find an asset in a later session, grep this file or \`catalog.json\` by title / tag / category.\n\n`;
for (const cat of Object.keys(byCat).sort()) {
  const list = byCat[cat];
  md += `## ${cat} (${list.length})\n\n`;
  for (const e of list)
    md += `- **${e.title}** \`${e.id}\` — \`${e.file}\`${e.style ? ` · ${e.style}` : ""} · tags: ${e.tags.join(", ")}\n`;
  md += `\n`;
}
writeFileSync(join(ROOT, "asset-index", "CATALOG.md"), md);

const missing = entries.filter((e) => !e.exists).length;
console.log(`🗂  catalog: ${entries.length} assets → asset-index/catalog.json + CATALOG.md`);
if (missing) console.log(`   (${missing} listed assets have no PNG yet)`);
