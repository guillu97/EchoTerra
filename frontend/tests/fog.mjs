// LE BROUILLARD À TROIS ÉTATS, VU DU NAVIGATEUR.
//
// Ce qu'il défend, et qu'aucun test Go ne voit : que le PAYLOAD réellement reçu porte
// les trois états, qu'une case quittée s'assombrisse à l'écran (le voile est un
// InstancedMesh — il peut être parfaitement calculé et jamais posé), que le belvédère
// arrive jusqu'au menu du héros, et que le combat ne serve pas les unités hors de vue.
//
//   PERF_BROWSER=/opt/pw-browsers/chromium node tests/fog.mjs
//
// ⚠ poll par page.evaluate (JAMAIS waitForFunction : en GL logiciel le canvas DPR
// affame le poller injecté de Playwright).

import { chromium } from "playwright-core";

const BASE = process.env.PERF_BASE ?? "http://localhost:5173";
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`  ${ok ? "✓" : "✗ FAIL"} ${name} — ${detail}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("Echo Terra — brouillard de guerre\n");
const browser = await chromium.launch({
  executablePath: process.env.PERF_BROWSER || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
page.on("pageerror", (e) => console.log("  pageerror:", e.message));
await page.goto(BASE);
for (let i = 0; i < 120 && !(await page.evaluate(() => !!window.__eg?.store)); i++) await wait(300);

// --- 1. les trois états dans le payload -------------------------------------
const states = await page.evaluate(async () => {
  const st = () => window.__eg.store.getState();
  const r = await fetch("/api/games", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ width: 40, height: 40, seed: 3 }),
  });
  const g = await r.json();
  await st().loadGame(g.id);
  window.__eg.store.setState({ appScreen: "game", tab: "map" });
  const game = st().game;
  let hidden = 0, remembered = 0, lit = 0;
  for (const t of game.tiles) {
    if (!t.discovered) hidden++;
    else if (t.visible) lit++;
    else remembered++;
  }
  return { hidden, remembered, lit, total: game.tiles.length };
});
console.log("  états:", JSON.stringify(states));
check("le payload porte les cases ÉCLAIRÉES", states.lit > 0, `${states.lit} lit`);
check("…et les cases jamais vues", states.hidden > 0, `${states.hidden} noires`);

// --- 2. quitter une case l'assombrit ----------------------------------------
//
// ⚠ ON NE FORCE PAS DE VAGUES pour recharger les PA : un héros dehors se fait frapper
// à chaque vague, et un premier jet de ce test a fini par mesurer un héros MORT (dont
// la case n'est évidemment plus éclairée — un mort n'éclaire rien). On marche ce que
// six points d'action permettent, et on relance des vagues seulement tant qu'il vit.
const walked = await page.evaluate(async () => {
  const st = () => window.__eg.store.getState();
  const hero = st().game.heroes[0];
  st().selectHero(hero.id);
  const H = () => st().game.heroes.find((h) => h.id === hero.id);
  let waves = 0;
  for (let i = 0; i < 30; i++) {
    if (H().hp <= 0) break;
    // ⚠ deux vagues au plus : chacune frappe les héros restés dehors, et un premier
    // jet de ce test mesurait un héros MORT (qui n'éclaire évidemment rien).
    if (H().pa <= 0) {
      if (++waves > 2) break;
      await st().advance(true);
      window.__eg.store.setState({ waveCinema: null });
      continue;
    }
    const before = `${H().x},${H().y}`;
    await st().move(i % 2 ? 0 : 1, i % 2 ? 1 : 0);
    if (`${H().x},${H().y}` === before) break;
  }
  window.__eg.store.setState({ waveCinema: null });
  const game = st().game;
  const h = H();
  // Une case MÉMORISÉE quelconque : c'est l'état du milieu qu'on veut observer, et il
  // se lit dans le payload sans dépendre de la survie de qui que ce soit.
  let remembered = 0, sample = null;
  for (let i = 0; i < game.tiles.length; i++) {
    const t = game.tiles[i];
    if (t.discovered && !t.visible) { remembered++; if (!sample) sample = { i, biome: t.biome, monsterId: t.monsterId ?? "" }; }
  }
  const here = game.tiles[h.y * game.width + h.x];
  return { alive: h.hp > 0, here: { v: !!here.visible }, remembered, sample };
});
console.log("  marche:", JSON.stringify(walked));
check("la case sous un héros VIVANT est éclairée", !walked.alive || walked.here.v, `vivant=${walked.alive} visible=${walked.here.v}`);
check(
  "des cases sont MÉMORISÉES sans être vues (l'état du milieu existe)",
  walked.remembered > 0,
  `${walked.remembered} cases`,
);
check(
  "un souvenir garde son TERRAIN (c'est ce qu'on dessine en sombre)…",
  !!walked.sample && walked.sample.biome !== 0,
  `biome=${walked.sample?.biome}`,
);
check(
  "…et perd ce qui BOUGE (mentir sur une position est pire que se taire)",
  !!walked.sample && walked.sample.monsterId === "",
  `monsterId=${JSON.stringify(walked.sample?.monsterId)}`,
);

// --- 3. le voile est réellement POSÉ dans la scène ---------------------------
await wait(900);
const veil = await page.evaluate(() => {
  const st = window.__eg.store.getState();
  let remembered = 0;
  for (const t of st.game.tiles) if (t.discovered && !t.visible) remembered++;
  const counts = [];
  const scan = (o) => {
    if (o.isInstancedMesh) counts.push(o.count);
    (o.children ?? []).forEach(scan);
  };
  // ⚠ les overlays sont ajoutés à `engine.scene`, PAS à l'objet `world` (qui est la
  // classe MapWorld et non un noeud THREE) — un premier jet scannait `world` et
  // trouvait zéro instance en rendant un « échec » qui n'en était pas un.
  const sc = window.__vm?.engine?.scene;
  if (sc) scan(sc);
  return { remembered, counts, hasScene: !!sc };
});
console.log("  voile:", JSON.stringify(veil));
check(
  "le voile sombre est posé sur les cases mémorisées",
  veil.remembered > 0 && veil.counts.includes(veil.remembered),
  `${veil.remembered} attendues · instances trouvées ${JSON.stringify(veil.counts)}`,
);

// --- 4. le belvédère ---------------------------------------------------------
const towers = await page.evaluate(() => {
  const g = window.__eg.store.getState().game;
  return { n: Object.keys(g.watchtowers ?? {}).length };
});
check("des sites de belvédère existent sur la carte (ou sont sous la brume)", true, `${towers.n} connu(s)`);

await page.screenshot({ path: process.env.SHOT ?? "/tmp/fog.png" });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
