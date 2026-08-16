// LES NOMS D'OBJETS DOIVENT SE LIRE — sur un TÉLÉPHONE, en entier.
//
// La grille d'inventaire coupait les noms sur une seule ligne avec des points de
// suspension : « Plan de la P… » et « Plan de la C… » sont le MÊME texte à
// l'écran, et sur mobile il n'y a pas de survol pour révéler le `title`. Un nom
// tronqué sur un téléphone est un nom perdu (rapporté en jeu).
//
// Ce test mesure ce qui compte vraiment : le texte rendu déborde-t-il de sa boîte ?
// (`scrollWidth`/`scrollHeight` contre `clientWidth`/`clientHeight` — c'est le
// navigateur qui répond, pas une estimation de largeur de police.) Il le fait sur
// le viewport le plus SERRÉ du parc et avec les noms les plus LONGS du jeu.
//
//   (dev servers lancés : backend :8080 + vite :5173)
//   PERF_BROWSER=/opt/pw-browsers/chromium node tests/inventory.mjs
//
// ⚠ poll par page.evaluate (JAMAIS waitForFunction : en GL logiciel le canvas DPR
// affame le poller injecté de Playwright).

import { chromium } from "playwright-core";

const BASE = process.env.PERF_BASE ?? "http://localhost:5173";
// Les noms les plus longs du catalogue (game/design.go, craft.go, ruins.go) —
// « Plan de la Recyclerie » est le record, 21 caractères.
const LONG_NAMES = [
  "Plan de la Recyclerie",
  "Plan de la Cuisine",
  "Cœur de chêne ancien",
  "Trophée de monstre",
  "Ration d'eau",
  "Viande",
];
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

console.log("Echo Terra — lisibilité de l'inventaire\n");
const browser = await chromium.launch({
  executablePath: process.env.PERF_BROWSER || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
// 390 × 844 : le plus étroit des téléphones courants, donc le pire cas.
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => console.log("  pageerror:", e.message));
await page.goto(BASE);
await waitState(page, () => !!window.__eg?.store, 30000, "app store");
await page.evaluate(async () => {
  const r = await fetch("/api/games", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ width: 22, height: 22, seed: 7 }),
  });
  const g = await r.json();
  await window.__eg.store.getState().loadGame(g.id);
});
await waitState(page, () => !!window.__eg.store.getState().game, 20000, "partie");
await page.evaluate((names) => {
  const st = window.__eg.store;
  const g = structuredClone(st.getState().game);
  g.heroes[0].inventory = names.map((n) => ({ name: n, type: "objet", qty: 1 }));
  st.setState({ game: g, appScreen: "game", tab: "stock" });
}, LONG_NAMES);
await wait(1200);

const cells = await page.evaluate(() =>
  [...document.querySelectorAll(".item-name")].map((el) => ({
    txt: el.textContent,
    // le navigateur dit lui-même si le contenu déborde de sa boîte
    cut: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
    w: el.clientWidth,
  })),
);
check("les objets sont bien rendus", cells.length === LONG_NAMES.length, `${cells.length}/${LONG_NAMES.length} cases`);
const cut = cells.filter((c) => c.cut);
check(
  "aucun nom d'objet tronqué sur un téléphone (390 px)",
  cells.length > 0 && cut.length === 0,
  cut.length ? cut.map((c) => `« ${c.txt} » dans ${c.w}px`).join(", ") : `${cells.length} noms entiers`,
);
// …et le texte affiché est bien le nom COMPLET, pas une version raccourcie.
const missing = LONG_NAMES.filter((n) => !cells.some((c) => c.txt === n));
check("le nom affiché est le nom complet", missing.length === 0, missing.length ? `manquants : ${missing.join(", ")}` : "tous présents");

await browser.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok === results.length ? "PASS" : "FAIL"} — ${ok}/${results.length} checks ok`);
process.exit(ok === results.length ? 0 : 1);
