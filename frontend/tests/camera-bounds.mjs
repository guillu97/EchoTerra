// Test des BORNES DE LA CAMÉRA : « quand je bouge, ça déplace les nuages ».
//
// Le pan était INFINI. Sur la vue VILLE on tirait le tertre dans un coin et il
// ne restait à l'écran que du ciel : les nuages volent à 13-17 unités et la
// projection est dimétrique à 30°, donc ils se projettent ~26 unités PLUS HAUT
// que le sol — un pan vers le haut ne trouvait littéralement QUE des nuages, et
// plus aucun moyen de savoir dans quel sens revenir (rapporté en jeu, capture à
// l'appui). Même trou sur la carte du monde : on dérivait hors du damier.
//
// Ce test rejoue le geste (des drags francs, par de vrais événements pointeur)
// et vérifie que le contenu reste à l'écran. Il vérifie AUSSI qu'il mord : le
// même geste, bornes retirées, DOIT perdre le bourg — sans quoi le test ne
// prouverait rien.
//
//   (dev servers lancés : backend :8080 + vite :5173)
//   PERF_BROWSER=/opt/pw-browsers/chromium node tests/camera-bounds.mjs
//
// ⚠ poll par page.evaluate (JAMAIS waitForFunction : en GL logiciel le canvas
// DPR affame le poller injecté de Playwright).

import { chromium } from "playwright-core";

const BASE = process.env.PERF_BASE ?? "http://localhost:5173";
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`  ${ok ? "✓" : "✗ FAIL"} ${name} — ${detail}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitState(page, fn, timeout, what) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return Date.now() - t0;
    if (Date.now() - t0 > timeout) throw new Error(`timeout (${timeout}ms) waiting for ${what}`);
    await wait(300);
  }
}

console.log("Echo Terra — bornes de la caméra\n");
const browser = await chromium.launch({
  executablePath: process.env.PERF_BROWSER || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 420, height: 780 } });
page.on("pageerror", (e) => console.log("  pageerror:", e.message));

await page.goto(BASE);
await waitState(page, () => !!window.__eg?.store, 30000, "app store");
await page.evaluate(async () => { await window.__eg.store.getState().newGame(); });
await waitState(page, () => !!window.__eg.store.getState().game, 20000, "partie");

// Rectangle du canvas d'une vue (px CSS page) — il y en a plusieurs à l'écran
// (la carte reste MONTÉE toute la partie), on passe donc par le moteur lui-même.
const canvasRect = (page, hook) =>
  page.evaluate((h) => {
    const r = window[h].engine.renderer.domElement.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, hook);

/**
 * Un drag franc dans le canvas, par de vrais événements pointeur.
 * ⚠ le point de DÉPART doit être sur le canvas et pas sur une pastille de
 * bâtiment (`.town-spot`) : ces div flottent AU-DESSUS et avalent le
 * pointerdown — mesuré, un drag parti du centre de la ville ne panait rien du
 * tout, et le test croyait à une butée.
 */
async function drag(page, hook, rect, dx, dy) {
  const start = await page.evaluate(({ h, r }) => {
    const canvas = window[h].engine.renderer.domElement;
    for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.15]]) {
      const x = r.x + r.w * fx, y = r.y + r.h * fy;
      if (document.elementFromPoint(x, y) === canvas) return { x, y };
    }
    return null;
  }, { h: hook, r: rect });
  if (!start) throw new Error("aucun point libre sur le canvas");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(start.x + (dx * i) / 8, start.y + (dy * i) / 8);
  await page.mouse.up();
  await wait(120);
}

// ── LA VILLE — le bug rapporté ───────────────────────────────────────────────
await page.evaluate(() => window.__eg.store.setState({ appScreen: "game", tab: "home" }));
await waitState(page, () => !!window.__vt?.engine, 40000, "vue ville");
await wait(1500);
const townRect = await canvasRect(page, "__vt");

// Le centre du tertre = la cible du cadrage initial, avant qu'on y touche.
const home = await page.evaluate(() => {
  const t = window.__vt.engine.target;
  return { x: t.x, y: t.y, z: t.z, bounds: window.__vt.engine.panBounds };
});
check(
  "la vue ville a des bornes de pan",
  !!home.bounds && home.bounds.maxX > home.bounds.minX,
  home.bounds ? `x ${home.bounds.minX.toFixed(1)}..${home.bounds.maxX.toFixed(1)}, z ${home.bounds.minZ.toFixed(1)}..${home.bounds.maxZ.toFixed(1)}` : "AUCUNE",
);

/** Le point monde `p` est-il dans le cadre ? (NDC après pose de la caméra) */
const onScreen = (page, hook, p) =>
  page.evaluate(({ h, p }) => {
    const e = window[h].engine;
    e.groundAt(0, 0); // pose la caméra avant de projeter
    const V3 = e.target.constructor;
    const v = new V3(p.x, p.y, p.z).project(e.camera);
    return { x: v.x, y: v.y, on: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  }, { h: hook, p });

// Un pan NORMAL doit continuer de marcher : borner ne veut pas dire figer.
await drag(page, "__vt", townRect, 60, 60);
const nudged = await page.evaluate(() => ({ x: window.__vt.engine.target.x, z: window.__vt.engine.target.z }));
check(
  "un petit pan déplace bien la vue",
  Math.hypot(nudged.x - home.x, nudged.z - home.z) > 0.2,
  `cible (${nudged.x.toFixed(1)},${nudged.z.toFixed(1)}) ≠ (${home.x.toFixed(1)},${home.z.toFixed(1)})`,
);

// …puis LE geste du rapport : on tire vers le bas de l'écran, encore et encore,
// jusqu'à ce qu'il ne reste que le ciel. Quatre drags valent une carte entière.
for (let i = 0; i < 4; i++) await drag(page, "__vt", townRect, 140, 300);
const after = await page.evaluate(() => ({ x: window.__vt.engine.target.x, z: window.__vt.engine.target.z }));
const b = home.bounds;
check(
  "la cible reste sur le tertre",
  !!b && after.x >= b.minX - 0.01 && after.x <= b.maxX + 0.01 && after.z >= b.minZ - 0.01 && after.z <= b.maxZ + 0.01,
  `cible (${after.x.toFixed(1)},${after.z.toFixed(1)})`,
);
const townSeen = await onScreen(page, "__vt", home);
check(
  "le bourg est TOUJOURS à l'écran après le pan",
  townSeen.on,
  `centre du tertre en NDC (${townSeen.x.toFixed(2)},${townSeen.y.toFixed(2)})`,
);

// ── LE TÉMOIN : sans bornes, le même geste perd le bourg ─────────────────────
await page.evaluate((p) => {
  const e = window.__vt.engine;
  e.panBounds = null;
  e.target.set(p.x, p.y, p.z);
  e.invalidate();
}, home);
await wait(200);
for (let i = 0; i < 4; i++) await drag(page, "__vt", townRect, 140, 300);
const lost = await onScreen(page, "__vt", home);
check(
  "TÉMOIN : sans bornes le même geste perd le bourg (le test mord)",
  !lost.on,
  `centre du tertre en NDC (${lost.x.toFixed(2)},${lost.y.toFixed(2)})`,
);

// ── LA CARTE DU MONDE ────────────────────────────────────────────────────────
await page.evaluate(() => window.__eg.store.setState({ tab: "map" }));
await waitState(page, () => !!window.__vm?.world?.terrain, 40000, "terrain voxel");
await wait(1200);
const mapRect = await canvasRect(page, "__vm");
const dims = await page.evaluate(() => {
  const g = window.__eg.store.getState().game;
  return { w: g.width, h: g.height, bounds: window.__vm.engine.panBounds };
});
check(
  "la carte a des bornes de pan à sa taille",
  !!dims.bounds && dims.bounds.maxX === dims.w - 1 && dims.bounds.maxZ === dims.h - 1,
  dims.bounds ? `${dims.w}×${dims.h} → x 0..${dims.bounds.maxX}, z 0..${dims.bounds.maxZ}` : "AUCUNE",
);
for (let i = 0; i < 6; i++) await drag(page, "__vm", mapRect, -200, -260);
const mapTarget = await page.evaluate(() => ({ x: window.__vm.engine.target.x, z: window.__vm.engine.target.z }));
check(
  "la cible de la carte reste sur une tuile",
  mapTarget.x >= -0.01 && mapTarget.x <= dims.w - 1 + 0.01 && mapTarget.z >= -0.01 && mapTarget.z <= dims.h - 1 + 0.01,
  `cible (${mapTarget.x.toFixed(1)},${mapTarget.z.toFixed(1)}) sur ${dims.w}×${dims.h}`,
);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
