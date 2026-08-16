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
// ⚠ LOCALE FIXÉE EN FRANÇAIS. Depuis l'i18n, l'interface suit `navigator.language` :
// un Chromium headless démarre en anglais, et toutes les assertions de ce fichier —
// écrites sur les libellés français — tombaient d'un coup. On épingle donc la langue
// plutôt que de dupliquer chaque attente dans les deux langues ; c'est `test:i18n` qui
// garde le catalogue, pas ces tests-ci.
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "fr-FR" });
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

// ── LA FICHE D'OBJET (components/ItemSheet.tsx) ─────────────────────────────
// Taper un objet doit DIRE ce que c'est et proposer ce qu'on peut en faire. Trois
// niveaux de vérification, du moins au plus fort :
//   1. ce que la fiche AFFICHE (inventaire posé côté client — c'est du rendu) ;
//   2. l'ORDRE ENVOYÉ au serveur quand on appuie (requête interceptée) ;
//   3. et pour le chemin qu'on peut jouer POUR DE VRAI — la ration puisée au
//      puits — l'effet mesuré sur l'ÉTAT SERVEUR.
// Un bouton qui s'affiche mais n'agit pas serait pire que pas de bouton.

const posted = [];
page.on("request", (r) => { if (r.method() === "POST") posted.push(r.url() + " " + (r.postData() ?? "")); });

await page.evaluate(async () => {
  // catalogues : `loadGame` (l'entrée de test) ne les charge pas — l'app passe par
  // enterActiveGame. On les pose donc à la main.
  const st = window.__eg.store;
  const [items, eq] = await Promise.all([
    fetch("/api/items").then((r) => r.json()),
    fetch("/api/equipment").then((r) => r.json()),
  ]);
  st.setState({ itemEffects: items, equipment: eq });
  const g = structuredClone(st.getState().game);
  const weapon = Object.keys(eq).find((n) => eq[n].slot === "arme");
  const hero = g.heroes[0];
  hero.inventory = [
    { name: "Ration d'eau", type: "eau", qty: 2 },
    { name: weapon, type: "arme", qty: 1 },
    { name: "Pierre", type: "minerai", qty: 9 },
  ];
  hero.pa = Math.max(0, hero.maxPa - 3); // sinon le serveur refuse : « déjà au mieux »
  st.setState({ game: g, tab: "stock" });
  window.__probe = { heroId: hero.id, weapon };
});
await wait(900);

const open = async (index) => {
  const cells = await page.$$(".item-cell");
  await cells[index].click();
  await wait(400);
  return page.evaluate(() => {
    const s = document.querySelector(".item-sheet");
    if (!s) return null;
    return {
      title: s.querySelector("#item-sheet-title")?.textContent,
      tags: [...s.querySelectorAll(".isheet-tags span")].map((t) => t.textContent),
      body: [...s.querySelectorAll(".isheet-block p")].map((p) => p.textContent).join(" "),
      buttons: [...s.querySelectorAll(".isheet-actions button")].map((b) => ({ txt: b.textContent, off: b.disabled })),
    };
  });
};
const press = (re) =>
  page.evaluate((src) => {
    const b = [...document.querySelectorAll(".isheet-actions button")].find((x) => new RegExp(src).test(x.textContent));
    b?.click();
    return !!b;
  }, re.source);
const closeSheet = async () => { await page.keyboard.press("Escape"); await wait(300); };

// 1) ce que la fiche affiche
const conso = await open(0);
check(
  "taper un consommable ouvre sa fiche, avec ce qu'il fait",
  !!conso && conso.title === "Ration d'eau" && conso.tags.some((t) => /\+\d+ PA/.test(t)),
  conso ? `${conso.title} — ${conso.tags.join(" / ")}` : "pas de fiche",
);
check(
  "la fiche propose « Utiliser »",
  !!conso && conso.buttons.some((b) => /Utiliser/.test(b.txt) && !b.off),
  conso ? conso.buttons.map((b) => b.txt + (b.off ? "(off)" : "")).join(" ") : "-",
);
// 2) …et l'ordre part vers le bon endpoint
posted.length = 0;
await press(/Utiliser/);
await wait(1200);
check(
  "« Utiliser » envoie bien un ordre de consommation au serveur",
  posted.some((p) => /\/heroes\/[^/]+\/use\b/.test(p) && p.includes("Ration d'eau")),
  posted.filter((p) => p.includes("/heroes/")).map((p) => p.split("/api/games/")[1] ?? p).join(" | ") || "aucune requête",
);
await closeSheet();

const arme = await open(1);
check(
  "une arme montre ses bonus et propose « Équiper »",
  !!arme && arme.tags.length > 0 && arme.buttons.some((b) => /Équiper/.test(b.txt) && !b.off),
  arme ? `${arme.title} — ${arme.tags.join(" / ")}` : "pas de fiche",
);
posted.length = 0;
await press(/Équiper/);
await wait(1200);
check(
  "« Équiper » envoie bien l'objet ET son emplacement",
  posted.some((p) => /\/heroes\/[^/]+\/equip\b/.test(p) && p.includes('"slot":"arme"')),
  posted.filter((p) => p.includes("/heroes/")).map((p) => p.split("/api/games/")[1] ?? p).join(" | ") || "aucune requête",
);
await closeSheet();

// Une ressource n'a AUCUNE action, mais elle a une explication : c'est tout
// l'intérêt d'ouvrir la fiche d'un objet sur lequel on ne peut rien faire.
const mat = await open(2);
check(
  "une ressource explique à quoi elle sert, sans bouton d'action",
  !!mat && /Atelier|chantier|Banque/.test(mat.body) && !mat.buttons.some((b) => /Utiliser|Équiper/.test(b.txt)),
  mat ? `${mat.title} — ${mat.body.slice(0, 60)}…` : "pas de fiche",
);
await closeSheet();

// 3) LE CHEMIN JOUÉ POUR DE VRAI. Le puits donne une VRAIE ration à un héros en
// ville ; on dépense un PA en sortant, puis on boit depuis la fiche. Ce que le
// serveur en dit est le seul verdict qui compte.
const real = await page.evaluate(async () => {
  const st = () => window.__eg.store.getState();
  const g0 = st().game;
  const hero = g0.heroes[0];
  st().setTownHero(hero.id);
  await st().townAction("well", "water"); // ration RÉELLE dans son sac
  // sortir d'un pas : 1 PA dépensé, donc la ration servira à quelque chose
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const g1 = st().game;
  const d = dirs.find(([dx, dy]) => {
    const t = g1.tiles[(hero.y + dy) * g1.width + (hero.x + dx)];
    return t && t.biome !== 0;
  });
  st().selectHero(hero.id);
  if (d) await st().move(d[0], d[1]);
  await new Promise((r) => setTimeout(r, 400));
  const h = st().game.heroes.find((x) => x.id === hero.id);
  return { heroId: hero.id, pa: h.pa, rations: h.inventory.find((i) => i.name === "Ration d'eau")?.qty ?? 0 };
});
check(
  "le puits a bien donné une VRAIE ration (pré-requis du test)",
  real.rations >= 1,
  `${real.rations} ration(s), ${real.pa} PA`,
);
await page.evaluate(() => window.__eg.store.setState({ tab: "stock" }));
await wait(800);
const idx = await page.evaluate(() =>
  [...document.querySelectorAll(".item-cell")].findIndex((c) => c.querySelector(".item-name")?.textContent === "Ration d'eau"),
);
await open(idx);
await press(/Utiliser/);
await wait(1800);
const after = await page.evaluate((id) => {
  const h = window.__eg.store.getState().game.heroes.find((x) => x.id === id);
  return { pa: h.pa, rations: h.inventory.find((i) => i.name === "Ration d'eau")?.qty ?? 0 };
}, real.heroId);
check(
  "boire depuis la fiche rend vraiment des PA (état serveur)",
  after.pa > real.pa && after.rations === real.rations - 1,
  `PA ${real.pa} → ${after.pa}, rations ${real.rations} → ${after.rations}`,
);

await browser.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok === results.length ? "PASS" : "FAIL"} — ${ok}/${results.length} checks ok`);
process.exit(ok === results.length ? 0 : 1);
