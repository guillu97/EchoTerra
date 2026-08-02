// Suite de perf du rendu VOXEL (défaut depuis 2026-07-17) — miroir de
// map-loading.mjs pour le nouveau moteur. Budgets device-indépendants (tris,
// draw calls, payload, cadence relative) ; le GL logiciel headless rend les
// temps absolus pessimistes, on ne borne donc que ce qui est structurel.
//
//   PERF_BROWSER=/opt/pw-browsers/chromium node tests/perf/voxel-perf.mjs
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

console.log("Echo Terra — voxel perf test\n");
const browser = await chromium.launch({
  executablePath: process.env.PERF_BROWSER || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 420, height: 780 } });
page.on("pageerror", (e) => console.log("  pageerror:", e.message));

await page.goto(BASE);
await waitState(page, () => !!window.__eg?.store, 30000, "app store");
await page.evaluate(async () => {
  const s = window.__eg.store;
  await s.getState().newGame();
});
await waitState(page, () => !!window.__eg.store.getState().game, 20000, "game");
await page.evaluate(() => window.__eg.store.setState({ appScreen: "game", tab: "map" }));
const tTerrain = await waitState(page, () => !!window.__vm?.world.terrain && !!window.__vm?.world.props, 30000, "terrain+props voxel");
check("carte voxel prête ≤20s", tTerrain <= 20000, `${tTerrain}ms`);
await wait(1500); // laisser la boucle nuages tourner

// --- budgets structurels sur vraie partie (fog au départ) -------------------
const info = await page.evaluate(() => {
  const w = window.__vm.world;
  const r = w.engine.renderer.info;
  return { tris: r.render.triangles, calls: r.render.calls, geoms: r.memory.geometries, frame: r.render.frame };
});
check("tris vraie partie ≤6M (fog)", info.tris <= 6_000_000, `${info.tris.toLocaleString()} tris`);
check("draw calls ≤160", info.calls <= 160, `${info.calls} calls`);

// --- payload réseau /voxels/* ------------------------------------------------
const payload = await page.evaluate(() => {
  const res = performance.getEntriesByType("resource").filter((e) => e.name.includes("/voxels/"));
  const bytes = res.reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0);
  const dupes = res.length - new Set(res.map((e) => e.name)).size;
  return { count: res.length, bytes, dupes };
});
check("payload voxel ≤4 MiB", payload.bytes <= 4 * 1024 * 1024, `${(payload.bytes / 1048576).toFixed(2)} MiB en ${payload.count} fichiers`);
check("aucun .vox téléchargé deux fois", payload.dupes === 0, `${payload.dupes} doublons`);

// --- la carte est 100 % ON-DEMAND (les nuages ne vivent qu'en ville) ---------
// ⚠ on compte `engine.frames` (un par REDRAW), pas `renderer.info.render.frame`
// (un par appel de rendu) : depuis que le mode beauté est le défaut, un seul
// redraw fait ~17 appels de rendu — la passe bloom en enchaîne plusieurs. Le
// contrat qu'on veut tenir est « combien de fois redessine-t-on », pas
// « combien coûte un redessin ».
const f0 = await page.evaluate(() => window.__vm.engine.frames);
await wait(3000);
const f1 = await page.evaluate(() => window.__vm.engine.frames);
// ≤2 : le cycle solaire tique toutes les 5 s et redessine — 0 ou 1 sur 3 s.
check("carte on-demand (pas de boucle continue)", f1 - f0 <= 2, `${f1 - f0} redraws en 3s au repos`);
check("pas de nuages sur la carte (retour perf mobile)", await page.evaluate(() => !window.__vm.world.clouds), "clouds absent");

// --- pas de fuite : géométries stables à travers les redraws -----------------
// Baseline prise ICI (après ~6s de vie) : les bibliothèques de persos/props
// chargent en asynchrone après terrain-prêt — mesurer depuis `info.geoms`
// comptait leur arrivée comme une fuite. On force ensuite plusieurs redraws
// (le chemin du poll 20 s) et on vérifie que RIEN ne s'accumule.
const g0 = await page.evaluate(() => window.__vm.engine.renderer.info.memory.geometries);
await page.evaluate(() => {
  for (let i = 0; i < 5; i++) window.__vm.world.draw();
});
await wait(1000);
const g1 = await page.evaluate(() => window.__vm.engine.renderer.info.memory.geometries);
check("géométries stables (pas de fuite au redraw)", Math.abs(g1 - g0) <= 4, `${g0} → ${g1} (5 redraws forcés)`);

// --- quitter l'onglet Map : la boucle continue s'arrête ----------------------
await page.evaluate(() => window.__eg.store.setState({ tab: "stock" }));
await wait(700);
const fA = await page.evaluate(() => window.__vm.engine.frames);
await wait(2000);
const fB = await page.evaluate(() => window.__vm.engine.frames);
// 0 attendu : hors de l'onglet Map, l'animator est coupé ET le cycle solaire
// est en pause (la vue reste MONTÉE, masquée en CSS — c'est à elle de se taire).
check("rendu STOPPÉ hors de l'onglet Map (batterie)", fB - fA === 0, `${fB - fA} redraws en 2s`);
await page.evaluate(() => window.__eg.store.setState({ tab: "map" }));
await wait(800);

// --- vue VILLE : bâtiments voxel + nuages ------------------------------------
await page.evaluate(() => window.__eg.store.setState({ tab: "home" }));
await waitState(page, () => !!window.__vt, 15000, "vue ville");
await wait(3000);
const town = await page.evaluate(() => {
  const eng = window.__vt.engine;
  let bld = 0;
  eng.scene.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.geometry?.attributes?.position) bld++; });
  return { tris: eng.renderer.info.render.triangles, calls: eng.renderer.info.render.calls, meshes: bld };
});
check("tris vue ville ≤2M", town.tris <= 2_000_000, `${town.tris.toLocaleString()} tris`);
check("bâtiments voxel présents en ville", town.meshes >= 6, `${town.meshes} meshes`);

// --- nuages : en VILLE uniquement, et ils passent ----------------------------
const cp0 = await page.evaluate(() => {
  const out = [];
  window.__vt.engine.scene.traverse((o) => { if (o.isMesh && o.material?.vertexColors && o.position.y > 12) out.push(o.position.x.toFixed(2)); });
  return out;
});
await wait(2500);
const cp1 = await page.evaluate(() => {
  const out = [];
  window.__vt.engine.scene.traverse((o) => { if (o.isMesh && o.material?.vertexColors && o.position.y > 12) out.push(o.position.x.toFixed(2)); });
  return out;
});
const cMoved = cp0.filter((x, i) => x !== cp1[i]).length;
check("nuages de la ville en mouvement", cp0.length > 0 && cMoved === cp0.length, `${cMoved}/${cp0.length}`);

await browser.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok === results.length ? "PASS" : "FAIL"} — ${ok}/${results.length} checks ok`);
process.exit(ok === results.length ? 0 : 1);
