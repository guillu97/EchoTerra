// LE RETOUR DANS SA VILLE après une absence — les deux façons dont il partait mal.
//
// 1. LE RATTRAPAGE SE JOUAIT SOUS LES YEUX DU JOUEUR. Une requête de jeu ne rejoue
//    qu'une poignée de vagues (game.RequestBudget), et le seul relanceur était le
//    sondage de 20 s : la ville se faisait frapper UNE VAGUE TOUTES LES 20 SECONDES,
//    minuteur figé à 0, une cinématique à chaque fois. Le serveur annonce désormais
//    son retard (`catchUp`) ; le client redemande aussitôt et n'ouvre QU'UNE
//    cinématique, à l'arrivée, avec le cumul.
// 2. LA VILLE TOMBÉE ÉTAIT UN CUL-DE-SAC. Le rapport de la dernière vague passe
//    au-dessus de tout (--z-modal-top) et, en cas de game over, ne portait AUCUN
//    bouton : plus de retour au menu ni de nouvelle partie.
//
//   (dev servers lancés : backend :8080 + vite :5173)
//   PERF_BROWSER=/opt/pw-browsers/chromium node tests/reconnect.mjs
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

console.log("Echo Terra — reprise de partie (rattrapage + fin de partie)\n");
const browser = await chromium.launch({
  executablePath: process.env.PERF_BROWSER || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 420, height: 780 } });
page.on("pageerror", (e) => console.log("  pageerror:", e.message));

await page.goto(BASE);
await waitState(page, () => !!window.__eg?.store, 30000, "app store");
await page.evaluate(async () => {
  await window.__eg.store.getState().newGame();
});
await waitState(page, () => !!window.__eg.store.getState().game, 20000, "partie");
await page.evaluate(() => window.__eg.store.setState({ appScreen: "game", tab: "home" }));

// --- 1. le rattrapage ------------------------------------------------------
//
// On simule un serveur EN RETARD : trois réponses qui portent `catchUp` (une vague
// de plus à chaque fois, 10 PV de moins), puis une quatrième qui annonce le monde à
// jour. C'est exactement le contrat que la boucle du client consomme.
await page.evaluate(() => {
  const st = window.__eg.store.getState();
  const g = structuredClone(st.game);
  // Point de départ : la ville a déjà connu 10 vagues et elle est intacte.
  g.waveNumber = 10;
  g.town.hp = 100;
  g.lastWave = {
    wave: 10, day: 5, hordePower: 20, defense: 20, townDamage: 0, townHpAfter: 100,
    buildingsHit: [], heroesHit: [], monstersSpawned: 0, at: new Date().toISOString(), gameOver: false,
  };
  window.__eg.store.setState({ game: g });

  const seq = [
    { wave: 11, hp: 90, catchUp: true },
    { wave: 12, hp: 80, catchUp: true },
    { wave: 13, hp: 70, catchUp: true },
    { wave: 14, hp: 60, catchUp: false }, // rattrapé
  ];
  const probe = { calls: [], cinemaWhilePending: 0 };
  window.__catch = probe;
  const orig = window.fetch.bind(window);
  let n = 0;
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET" || !/\/api\/games\/[^/?]+$/.test(url)) return orig(input, init);
    const res = await orig(input, init);
    const body = await res.clone().json();
    const step = seq[Math.min(n, seq.length - 1)];
    n++;
    probe.calls.push(Date.now());
    // Une cinématique ouverte AVANT la fin du rattrapage = le bug d'origine.
    if (window.__eg.store.getState().waveCinema && n < seq.length) probe.cinemaWhilePending++;
    body.status = "active";
    body.catchUp = step.catchUp;
    body.waveNumber = step.wave;
    body.town.hp = step.hp;
    body.lastWave = {
      wave: step.wave, day: 5 + Math.floor(step.wave / 2), hordePower: 40, defense: 20,
      townDamage: 10, townHpAfter: step.hp, buildingsHit: [], heroesHit: [],
      monstersSpawned: 3, at: new Date().toISOString(), gameOver: false,
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
});

const t0 = Date.now();
await page.evaluate(() => window.__eg.store.getState().refreshGame());
await waitState(page, () => window.__catch.calls.length >= 4, 15000, "les 4 tours de rattrapage");
await wait(400);
const catchUp = await page.evaluate(() => {
  const s = window.__eg.store.getState();
  const c = window.__catch;
  return {
    calls: c.calls.length,
    span: c.calls.length > 1 ? c.calls[c.calls.length - 1] - c.calls[0] : 0,
    cinemaWhilePending: c.cinemaWhilePending,
    cinema: s.waveCinema && { wave: s.waveCinema.report.wave, waves: s.waveCinema.waves, dmg: s.waveCinema.townDamage },
    catchingUp: s.catchingUp,
  };
});

check(
  "le client redemande TOUT DE SUITE tant que le serveur est en retard (pas le sondage de 20 s)",
  catchUp.calls >= 4 && catchUp.span < 8000,
  `${catchUp.calls} requêtes en ${catchUp.span}ms (${Date.now() - t0}ms au total)`,
);
check(
  "aucune cinématique pendant le rattrapage",
  catchUp.cinemaWhilePending === 0,
  `${catchUp.cinemaWhilePending} ouverture(s) prématurée(s)`,
);
check(
  "UNE seule cinématique à l'arrivée, avec le cumul des vagues et des dégâts",
  !!catchUp.cinema && catchUp.cinema.wave === 14 && catchUp.cinema.waves === 4 && catchUp.cinema.dmg === 40,
  catchUp.cinema ? `vague ${catchUp.cinema.wave} · ${catchUp.cinema.waves} vagues · −${catchUp.cinema.dmg} PV` : "aucune",
);
check("l'indicateur de rattrapage retombe", catchUp.catchingUp === false, `catchingUp=${catchUp.catchingUp}`);

// --- 2. la ville tombée rend la main ---------------------------------------
await page.evaluate(() => {
  const s = window.__eg.store.getState();
  const g = structuredClone(s.game);
  g.status = "gameover";
  g.town.hp = 0;
  window.__eg.store.setState({
    game: g,
    waveCinema: {
      report: {
        wave: 17, day: 9, hordePower: 92, defense: 37, townDamage: 27, townHpAfter: 0,
        buildingsHit: [], heroesHit: [], monstersSpawned: 21, at: new Date().toISOString(), gameOver: true,
      },
      waves: 1,
      townDamage: 27,
    },
  });
});
// La frappe dure 1,6 s ; un tap passe au rapport sans attendre.
await page.locator(".wavecine").click({ position: { x: 10, y: 10 } });
await page.locator(".wc-card button").first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
const hasExit = await page.locator(".wc-card button").count();
check("le rapport d'une ville tombée porte un bouton de sortie", hasExit > 0, `${hasExit} bouton(s)`);

if (hasExit > 0) {
  await page.locator(".wc-card button").first().click();
  await wait(300);
}
// ⚠ « .go-card visible » ne suffit PAS : l'écran de fin était bien monté, mais la
// cinématique passe au-dessus (--z-modal-top) et lui mangeait ses boutons. Ce qu'on
// vérifie, c'est que le rapport a bien DISPARU.
const cinemaGone = (await page.locator(".wavecine").count()) === 0;
const goVisible = await page.locator(".gameover .go-card").isVisible().catch(() => false);
check(
  "fermer le rapport le retire et découvre l'écran de fin",
  cinemaGone && goVisible,
  cinemaGone ? (goVisible ? "bilan accessible" : "bilan absent") : "le rapport recouvre toujours l'écran",
);

if (goVisible) {
  await page.getByRole("button", { name: /Menu principal/i }).click();
  await wait(400);
}
const screen = await page.evaluate(() => window.__eg.store.getState().appScreen);
check("« Menu principal » ramène bien au titre", screen === "title", `appScreen=${screen}`);

await browser.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok === results.length ? "PASS" : "FAIL"} — ${ok}/${results.length} checks ok`);
process.exit(ok === results.length ? 0 : 1);
