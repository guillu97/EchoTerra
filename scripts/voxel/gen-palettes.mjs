// Extrait les palettes PAR DÉFAUT des personnages et monstres voxel (les mêmes
// que celles utilisées par gen-characters/gen-monsters : échantillonnage des
// PNG) et les fige dans un JSON consommé par le Studio Personnages
// (frontend/src/charstudio/palettes.json) — point de départ fidèle des
// palettes éditables en mode « recette live ».
//
//   node scripts/voxel/gen-palettes.mjs

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KEYS, samplePalette as sampleChar } from "./gen-characters.mjs";
import { samplePalette as sampleMob } from "./gen-monsters.mjs";
import { MONSTER_TEMPLATES } from "../../frontend/src/voxel/shared/monster-recipe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "frontend", "src", "charstudio", "palettes.json");

const out = {};
for (const key of KEYS) out[key] = await sampleChar(key);
for (const key of Object.keys(MONSTER_TEMPLATES)) out[key] = await sampleMob(key);
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`✓ ${Object.keys(out).length} palettes → ${path.relative(ROOT, OUT)}`);
