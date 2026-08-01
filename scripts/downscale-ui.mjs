// Réduit les PNG d'INTERFACE à leur taille d'affichage réelle.
//
// Pourquoi : les icônes de la barre du bas sont sorties du générateur en 1024²
// (~2,2 Mo à elles cinq) alors qu'elles s'affichent dans un carré de 26px (38px
// pour le bouton central) — soit 114px au pire, à DPR 3. Elles faisaient à elles
// seules dépasser le budget de payload PNG vérifié par `npm run test:perf`.
//
// Pas de dépendance : le redimensionnement passe par le canvas de Chromium, déjà
// présent pour les tests Playwright.
//
//   node scripts/downscale-ui.mjs [--size 160] [--dry]
//
// Le script écrit PAR-DESSUS les fichiers sources : les originaux 1024² restent
// dans l'historique git si besoin de régénérer plus grand.

import { readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = path.join(ROOT, "frontend/public/assets");

// `playwright-core` est une devDependency du FRONT, et la résolution ESM ignore
// NODE_PATH comme le cwd : on la résout explicitement depuis frontend/.
const requireFromFrontend = createRequire(path.join(ROOT, "frontend/package.json"));
const pw = await import(pathToFileURL(requireFromFrontend.resolve("playwright-core")).href);
const chromium = pw.chromium ?? pw.default?.chromium;

// Chemin sous `assets/` + taille cible (px du côté long).
const TARGETS = [
  ["ui/nav-home.png", 160],
  ["ui/nav-map.png", 160],
  ["ui/nav-stock.png", 160],
  ["ui/nav-structure.png", 160],
  ["ui/nav-craft.png", 160],
  // Sprites des maisons de remplissage du mode « Classique » de la Ville. Ils
  // s'affichent dans ~2 tuiles iso (≈150px) et sortaient du générateur en
  // 1024² : à neuf, ils faisaient à eux seuls dépasser le budget de payload.
  ...[
    "bld-cottage", "bld-house", "bld-house-blue",
    "bld-barn", "bld-market", "bld-house-large",
    "bld-logcabin", "bld-roundhouse", "bld-house-stone",
  ].map((f) => [`buildings/${f}.png`, 512]),
];

const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const sizeArg = Number(argv[argv.indexOf("--size") + 1]);

// Playwright peut pointer sur un binaire déjà installé (image CI/conteneur).
const executablePath = process.env.PERF_BROWSER || undefined;
const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();

let before = 0;
let after = 0;

for (const [file, defaultSize] of TARGETS) {
  const size = Number.isFinite(sizeArg) && sizeArg > 0 ? sizeArg : defaultSize;
  const abs = path.join(ASSETS, file);
  const src = await readFile(abs);
  before += src.length;

  const dataUrl = `data:image/png;base64,${src.toString("base64")}`;
  const out = await page.evaluate(
    async ({ dataUrl, size }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const scale = Math.min(1, size / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      return { url: c.toDataURL("image/png"), w, h, ow: img.width, oh: img.height };
    },
    { dataUrl, size },
  );

  const buf = Buffer.from(out.url.split(",")[1], "base64");
  after += buf.length;
  const kb = (n) => `${(n / 1024).toFixed(0)}ko`;
  console.log(
    `  ${file}: ${out.ow}×${out.oh} ${kb(src.length)} -> ${out.w}×${out.h} ${kb(buf.length)}` +
      (dry ? "  (dry)" : ""),
  );
  if (!dry) await writeFile(abs, buf);
}

await browser.close();

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)}Mo`;
console.log(`\n${dry ? "[dry] " : ""}total ${mb(before)} -> ${mb(after)} (${mb(before - after)} économisés)`);
await stat(ASSETS); // garde-fou : le dossier doit exister
