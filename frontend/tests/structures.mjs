// L'ONGLET BÂTIR : ce qu'on montre, et combien de PA on y met.
//
// Deux régressions rapportées en jeu, toutes les deux sur le même écran :
//
//  1. LES PLANS PAS ENCORE DÉCOUVERTS S'AFFICHAIENT. Dix bâtiments du catalogue
//     ne s'ouvrent qu'avec un plan qui ne tombe que des ruines et de la fouille ;
//     la liste les alignait quand même, chacun avec « Plan de X 0/1 » et un
//     bouton « Poser le plan » inerte. Six lignes infaisables noyaient les deux
//     chantiers réellement ouvrables. Un site ne doit reparaître qu'avec son plan.
//
//  2. LE BOUTON INVESTISSAIT TOUS LES PA D'UN COUP. « +7 PA » était le seul
//     geste possible : impossible d'en poser 3 ici et d'en garder 4 pour rentrer
//     ou pour un second chantier, alors que les PA d'un héros SONT sa journée.
//
// Ce que le test vérifie : ce qui est RENDU (la liste, le doseur), et l'ORDRE
// ENVOYÉ au serveur (le `points` de la requête = le nombre choisi). La
// comptabilité serveur de l'investissement partiel, elle, est déjà couverte en
// Go (game/build_test.go, TestChantierAccumulatesAcrossHeroes).
//
//   (dev servers lancés : backend :8080 + vite :5173)
//   PERF_BROWSER=/opt/pw-browsers/chromium node tests/structures.mjs
//
// ⚠ poll par page.evaluate (JAMAIS waitForFunction : en GL logiciel le canvas
// DPR affame le poller injecté de Playwright).

import { chromium } from "playwright-core";

const BASE = process.env.PERF_BASE ?? "http://localhost:5173";
// Les bâtiments dont le plan est LOOTABLE (game/town.go buildingPlanItem) : tant
// qu'il n'est pas en Banque, aucun d'eux ne doit apparaître nulle part.
const PLAN_GATED = [
  "Mairie", "Tour", "Cuisine", "Recyclerie", "Poste",
  "Infirmerie", "Cartographe", "Armurerie", "Verger", "Caserne",
];
// Ceux qui sont debout dès le premier jour : eux doivent rester listés.
const STARTERS = ["Portail", "Muraille", "Banque", "Puits", "Atelier", "Panneau"];

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

console.log("Echo Terra — l'onglet Bâtir\n");
const browser = await chromium.launch({
  executablePath: process.env.PERF_BROWSER || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
// 390 × 844 : le téléphone le plus étroit du parc, comme pour l'inventaire.
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => console.log("  pageerror:", e.message));
const posted = [];
page.on("request", (r) => {
  if (r.method() === "POST") posted.push(r.url() + " " + (r.postData() ?? ""));
});

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
await page.evaluate(() => window.__eg.store.setState({ appScreen: "game", tab: "structure" }));
await wait(900);

const rows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".ps-row")].map((r) => ({
      nom: r.querySelector(".nm")?.textContent ?? "",
      act: r.querySelector(".ps-act")?.textContent ?? "",
      step: !!r.querySelector(".ps-invest"),
      amt: r.querySelector(".ps-invest .amt")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    })),
  );

// ── 1. LA LISTE ─────────────────────────────────────────────────────────────
const fresh = await rows();
const names = fresh.map((r) => r.nom);
const leaked = PLAN_GATED.filter((n) => names.includes(n));
check(
  "aucun bâtiment dont le plan n'a pas été trouvé n'est listé",
  fresh.length > 0 && leaked.length === 0,
  leaked.length ? `visibles à tort : ${leaked.join(", ")}` : `${names.length} lignes : ${names.join(", ")}`,
);
const missingStarters = STARTERS.filter((n) => !names.includes(n));
check(
  "les bâtiments de la ville restent tous listés",
  missingStarters.length === 0,
  missingStarters.length ? `absents : ${missingStarters.join(", ")}` : STARTERS.join(", "),
);
const note = await page.evaluate(() => document.querySelector(".ps-unknown")?.textContent?.replace(/\s+/g, " ").trim() ?? "");
check(
  "la liste DIT que le catalogue est plus grand, sans nommer les plans manquants",
  /\d+ bâtiment/.test(note) && !PLAN_GATED.some((n) => note.includes(n)),
  note || "aucune mention",
);

// ── 2. TROUVER UN PLAN LE FAIT APPARAÎTRE ───────────────────────────────────
// (le plan déposé en Banque est le SEUL déclencheur : c'est le moment de la découverte)
await page.evaluate(() => {
  const st = window.__eg.store;
  const g = structuredClone(st.getState().game);
  g.town.storage = [...(g.town.storage ?? []), { type: "objet", name: "Plan de la Cuisine", qty: 1 }];
  st.setState({ game: g });
});
await wait(600);
const withPlan = (await rows()).map((r) => r.nom);
check(
  "le plan trouvé fait apparaître SON chantier, et lui seul",
  withPlan.includes("Cuisine") && !withPlan.includes("Mairie") && !withPlan.includes("Caserne"),
  withPlan.join(", "),
);

// ── 3. LE DOSEUR DE PA ──────────────────────────────────────────────────────
// On ouvre un VRAI chantier : l'amélioration du Puits n'exige aucun plan, et
// poser le plan d'amélioration coûte 1 PA (game/town.go, phase 1).
const before = await page.evaluate(async () => {
  const st = () => window.__eg.store.getState();
  const hero = st().game.heroes[0];
  st().setTownHero(hero.id);
  await st().townAction("well", "build", 1); // pose le plan d'amélioration
  await new Promise((r) => setTimeout(r, 500));
  const h = st().game.heroes.find((x) => x.id === hero.id);
  const b = st().game.town.buildings.find((x) => x.id === "well");
  return { pa: h.pa, open: b.underConstruction, total: b.cost.pa, invested: b.paInvested };
});
check(
  "le chantier du Puits est bien ouvert (pré-requis du test)",
  before.open && before.pa > 2,
  `chantier ${before.invested}/${before.total} PA, travailleur à ${before.pa} PA`,
);
// Les matériaux du niveau 2 ne sont pas en Banque : sans eux le bouton reste
// éteint (c'est la règle « chantier en pause »). On les pose côté client pour
// pouvoir appuyer — ce qu'on mesure ici, c'est le NOMBRE ENVOYÉ, pas le stock.
await page.evaluate(() => {
  const st = window.__eg.store;
  const g = structuredClone(st.getState().game);
  const need = g.town.buildings.find((b) => b.id === "well").cost.materials;
  g.town.storage = [...(g.town.storage ?? []), ...need.map((m) => ({ type: m.type, name: m.name, qty: m.qty }))];
  st.setState({ game: g });
});
await wait(500);

const wellRow = async () => (await rows()).find((r) => r.nom === "Puits");
const w0 = await wellRow();
check(
  "un chantier ouvert propose un doseur de PA (− / + / tout)",
  !!w0?.step && /⚡ \d+ \/ \d+/.test(w0.amt),
  w0 ? `${w0.amt} · bouton « ${w0.act} »` : "pas de ligne Puits",
);
check(
  "par défaut il propose TOUT ce que le travailleur peut donner",
  !!w0 && w0.amt === `⚡ ${before.pa} / ${before.pa}` && w0.act === `+${before.pa} PA`,
  w0 ? `${w0.amt} → « ${w0.act} » (le héros a ${before.pa} PA)` : "-",
);

// Deux fois « − » : le compteur ET le bouton doivent suivre.
const pressStep = (label) =>
  page.evaluate((lbl) => {
    const row = [...document.querySelectorAll(".ps-row")].find((r) => r.querySelector(".nm")?.textContent === "Puits");
    const b = [...(row?.querySelectorAll(".ps-invest .stepbtn") ?? [])].find((x) => x.textContent.trim() === lbl);
    b?.click();
    return !!b;
  }, label);
await pressStep("−");
await pressStep("−");
await wait(300);
const w1 = await wellRow();
const want = before.pa - 2;
check(
  "le joueur peut choisir moins que tout",
  w1?.amt === `⚡ ${want} / ${before.pa}` && w1?.act === `+${want} PA`,
  w1 ? `${w1.amt} → « ${w1.act} »` : "-",
);

// …et c'est bien CE nombre qui part au serveur.
posted.length = 0;
await page.evaluate(() => {
  const row = [...document.querySelectorAll(".ps-row")].find((r) => r.querySelector(".nm")?.textContent === "Puits");
  row?.querySelector(".ps-act")?.click();
});
await wait(1200);
const sent = posted.filter((p) => /\/town\/action\b/.test(p));
check(
  "l'ordre envoyé porte le nombre de PA CHOISI",
  sent.some((p) => p.includes('"buildingId":"well"') && p.includes(`"points":${want}`)),
  sent.map((p) => p.split("/api/games/")[1] ?? p).join(" | ") || "aucune requête",
);

// « tout » remet le curseur au maximum disponible.
await page.evaluate(() => {
  const st = window.__eg.store;
  const g = structuredClone(st.getState().game);
  const need = g.town.buildings.find((b) => b.id === "well").cost.materials;
  g.town.storage = [...(g.town.storage ?? []), ...need.map((m) => ({ type: m.type, name: m.name, qty: m.qty }))];
  st.setState({ game: g });
});
await wait(400);
await pressStep("tout");
await wait(300);
const w2 = await wellRow();
const paNow = await page.evaluate(() => {
  const st = window.__eg.store.getState();
  return st.game.heroes.find((h) => h.id === st.townHeroId)?.pa ?? 0;
});
check(
  "« tout » remonte au maximum que le travailleur peut donner",
  paNow > 0 && w2?.act === `+${paNow} PA`,
  w2 ? `${w2.amt} → « ${w2.act} » (le héros a ${paNow} PA)` : "-",
);

await browser.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok === results.length ? "PASS" : "FAIL"} — ${ok}/${results.length} checks ok`);
process.exit(ok === results.length ? 0 : 1);
