// LE RÉCIT DE FIN DE PARTIE — ce qu'on emporte d'une ville tombée.
//
// L'écran de fin était un cul-de-sac (RETENTION-PLAN.md, R1+R2) :
//   1. il ne disait PAS ce que le joueur avait fait, alors que le serveur tenait le
//      registre depuis P3 (game/contribution.go), le sérialisait (`contributions`) et
//      le typait côté client — et qu'AUCUN composant ne le lisait ;
//   2. il ne disait pas que la ville allait hanter les cartes suivantes, ce qui est
//      pourtant vrai depuis les mémoriaux (P5) ;
//   3. et son bouton « Nouvelle partie » appelait POST /api/games, c'est-à-dire la
//      partie SOLO LEGACY 22×22 sans joueurs : au seul instant où l'on sait que le
//      joueur est là, le jeu l'éjectait de sa boucle multijoueur.
//
//   (dev servers lancés : backend :8080 + vite :5173)
//   PERF_BROWSER=/opt/pw-browsers/chromium node tests/endgame.mjs
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
async function waitState(page, fn, timeout, what) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return Date.now() - t0;
    if (Date.now() - t0 > timeout) throw new Error(`timeout (${timeout}ms) waiting for ${what}`);
    await wait(200);
  }
}

console.log("Echo Terra — récit de fin de partie\n");
const browser = await chromium.launch({
  executablePath: process.env.PERF_BROWSER || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
// ⚠ LOCALE FIXÉE EN FRANÇAIS. Depuis l'i18n, l'interface suit `navigator.language` :
// un Chromium headless démarre en anglais, et toutes les assertions de ce fichier —
// écrites sur les libellés français — tombaient d'un coup. On épingle donc la langue
// plutôt que de dupliquer chaque attente dans les deux langues ; c'est `test:i18n` qui
// garde le catalogue, pas ces tests-ci.
const page = await browser.newPage({ viewport: { width: 420, height: 900 }, locale: "fr-FR" });
page.on("pageerror", (e) => console.log("  pageerror:", e.message));

await page.goto(BASE);
await waitState(page, () => !!window.__eg?.store, 30000, "app store");
await page.evaluate(async () => {
  await window.__eg.store.getState().newGame();
});
await waitState(page, () => !!window.__eg.store.getState().game, 20000, "partie");

// Une ville PUBLIQUE tombée, trois joueurs. ⚠ le registre est injecté À L'ENVERS du
// mérite : le dernier arrivé est celui qui a le plus fait, et le premier n'a RIEN
// fait — c'est ce qui permet de distinguer « ordre d'arrivée » de « classement ».
await page.evaluate(() => {
  const g = structuredClone(window.__eg.store.getState().game);
  g.status = "gameover";
  g.visibility = "public";
  g.solo = false;
  g.town.hp = 0;
  g.town.name = "Valbourg";
  g.waveNumber = 19;
  g.day = 10;
  g.monstersKilled = 143;
  g.players = [
    { id: "p1", name: "Ana", heroIds: [], host: true, bot: false, joinedAt: "2026-08-01T10:00:00Z" },
    { id: "p2", name: "Moi", heroIds: [], host: false, bot: false, joinedAt: "2026-08-01T11:00:00Z" },
    { id: "p3", name: "Zoé", heroIds: [], host: false, bot: false, joinedAt: "2026-08-01T12:00:00Z" },
  ];
  g.contributions = {
    p2: { playerId: "p2", name: "Moi", buildPa: 12, deposited: 7, slain: 3, repaired: 0, crafted: 2, filled: 1 },
    p3: { playerId: "p3", name: "Zoé", buildPa: 99, deposited: 88, slain: 77, repaired: 66, crafted: 55, filled: 44 },
  };
  window.__eg.store.setState({
    game: g,
    playerId: "p2",
    user: { id: "u1", name: "Moi", email: "moi@example.com" },
    appScreen: "game",
    tab: "home",
    waveCinema: undefined,
  });
});
await page.locator(".gameover .go-card").waitFor({ state: "visible", timeout: 8000 });

// --- 1. ce que J'AI apporté -------------------------------------------------
const blocks = await page.locator(".go-block h3").allTextContents();
check(
  "le récit ouvre sur ce que le joueur a apporté",
  blocks.some((t) => /ce que tu as apport/i.test(t)),
  blocks.join(" · ") || "aucun bloc",
);
const mineTxt = await page
  .locator(".go-block")
  .first()
  .innerText()
  .catch(() => ""); // absent sur le code d'avant : on veut un FAIL, pas un timeout
check(
  "ma ligne porte mes six colonnes non nulles",
  /12/.test(mineTxt) && /7/.test(mineTxt) && /2/.test(mineTxt) && /1/.test(mineTxt),
  mineTxt.replace(/\s+/g, " ").slice(0, 90),
);

// --- 2. le registre : ordre d'ARRIVÉE, jamais le mérite ---------------------
const names = await page.locator(".go-block .lg-list .lg-name").allTextContents();
const order = names.map((n) => n.replace(/\s+/g, " ").trim());
check(
  "le registre suit l'ordre d'arrivée et non le mérite",
  order.length === 3 && /Ana/.test(order[0]) && /Moi/.test(order[1]) && /Zo/.test(order[2]),
  order.join(" → ") || "vide",
);
const rowsTxt = await page.locator(".go-block .lg-list .lg-row").allInnerTexts();
check(
  "un joueur qui n'a rien fait garde sa ligne",
  /rien encore/i.test(rowsTxt[0] ?? ""),
  (rowsTxt[0] ?? "").replace(/\s+/g, " "),
);
check(
  "aucun total ni aucun « meilleur joueur »",
  !/total|meilleur|classement|1er|score/i.test(rowsTxt.join(" ")),
  "aucune mention de rang dans les lignes",
);

// --- 3. la promesse des mémoriaux -------------------------------------------
const memorial = await page.locator(".go-memorial").innerText().catch(() => "");
check(
  "la ville tombée est annoncée comme ruine des prochaines cartes",
  /Valbourg/.test(memorial) && /ruine/i.test(memorial),
  memorial.replace(/\s+/g, " ").slice(0, 90) || "absente",
);

// --- 4. la relance ne repasse PAS par la partie legacy ----------------------
await page.evaluate(() => {
  window.__legacy = 0;
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    // POST /api/games EXACTEMENT : c'est le flux solo legacy 22×22 (les autres —
    // /lobby, /solo, /join — portent un suffixe).
    if (method === "POST" && /\/api\/games$/.test(url.split("?")[0])) window.__legacy++;
    return orig(input, init);
  };
});
// ⚠ on ne clique QUE si le bouton existe : un régresseur qui le supprimerait doit
// voir un FAIL lisible, pas un timeout de Playwright au milieu du fichier.
const relaunch = page.getByRole("button", { name: /Rejoindre une exp/i });
const hasRelaunch = await relaunch.count();
if (hasRelaunch) {
  await relaunch.first().click();
  await wait(600);
}
const after = await page.evaluate(() => ({
  screen: window.__eg.store.getState().appScreen,
  legacy: window.__legacy,
}));
check(
  "la relance renvoie vers les expéditions, pas vers la partie legacy",
  hasRelaunch > 0 && after.screen === "lobby" && after.legacy === 0,
  hasRelaunch ? `appScreen=${after.screen} · ${after.legacy} appel(s) legacy` : "aucun bouton de relance",
);

// --- 5. une partie SOLO relance en solo -------------------------------------
await page.evaluate(() => {
  const g = structuredClone(window.__eg.store.getState().game);
  g.solo = true;
  g.visibility = "private";
  g.players = [{ id: "p1", name: "Moi", heroIds: [], host: true, bot: false, joinedAt: "2026-08-01T10:00:00Z" }];
  window.__eg.store.setState({ game: g, playerId: "p1", appScreen: "game" });
});
const backOnCard = await page
  .locator(".gameover .go-card")
  .waitFor({ state: "visible", timeout: 8000 })
  .then(() => true)
  .catch(() => false);
const soloBtn = backOnCard ? await page.getByRole("button", { name: /Repartir en solo/i }).count() : 0;
check(
  "une partie solo propose de repartir en solo",
  soloBtn === 1,
  backOnCard ? `${soloBtn} bouton(s)` : "écran de fin absent",
);

await browser.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok === results.length ? "PASS" : "FAIL"} — ${ok}/${results.length} checks ok`);
process.exit(ok === results.length ? 0 : 1);
