// LA FAVEUR DES DIEUX, VUE D'UN TÉLÉPHONE (backend mythic.go).
//
// Ce que seul un navigateur peut répondre, et donc tout ce que ce fichier teste :
//
//  1. LA BARRE DU HAUT NE DÉBORDE PAS. Le compteur de faveur en fait un septième
//     élément, sur une barre où le bouton ⚙️ était DÉJÀ coupé par le bord de l'écran à
//     390 px (rapporté en jeu, capture à l'appui). Un bouton hors de l'écran est
//     inatteignable et ne se signale pas — c'est le seul défaut de cette barre qu'un
//     joueur ne peut pas contourner. On mesure la boîte, pas l'apparence.
//  2. AUCUN TEXTE DE DIEU N'EST TRONQUÉ. Trois cartes avec un nom, un effet et une
//     légende sur 390 px de large : au doigt il n'y a pas de survol pour révéler la
//     suite (même règle que la grille d'inventaire, cf. tests/inventory.mjs).
//  3. LE VOTE PART VRAIMENT AU SERVEUR, avec le bon dieu.
//
// La MÉCANIQUE (dépouillement, expiration, effets, déterminisme des ex æquo) est
// couverte côté Go — game/mythic_test.go et api/mythic_test.go, qui jouent de vraies
// vagues. Ici l'état de ville est POSÉ dans le store : bâtir un Temple pour de bon
// demanderait de trouver son plan à la fouille, ce qui n'apprendrait rien de plus sur
// l'interface et rendrait le test tributaire d'un tirage.
//
//   (dev servers lancés : backend :8080 + vite :5173)
//   PERF_BROWSER=/opt/pw-browsers/chromium node tests/mythic.mjs
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
    await wait(300);
  }
}

// Les trois panthéons du serveur (mythic.go). Recopiés ICI et nulle part ailleurs dans
// le client : c'est le payload qui les porte en vrai — ce test simule ce payload.
const OLYMPE = {
  id: "olympe",
  name: "Olympe",
  favor: "⚡",
  temple: "Temple d'Olympe",
  gods: [
    { id: "zeus", name: "Zeus", icon: "⚡", domain: "rempart", boon: "La foudre garde les murs", tagline: "Le maître de l'orage tient la porte avec vous." },
    { id: "demeter", name: "Déméter", icon: "🌾", domain: "moisson", boon: "La terre rend davantage", tagline: "Là où elle passe, même la pierre a du grain." },
    { id: "ares", name: "Arès", icon: "🗡️", domain: "lame", boon: "Les héros frappent plus fort", tagline: "Il ne protège personne. Il rend les coups." },
  ],
};
const ASGARD = { ...OLYMPE, id: "asgard", favor: "🔨", temple: "Hof des Ases" };

console.log("Echo Terra — la faveur des dieux\n");
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

// patchTown pose un état de ville et rend la main une fois React repeint.
const patchTown = (pantheon, town, extra = {}) =>
  page.evaluate(
    ([pantheon, town, extra]) => {
      const st = window.__eg.store;
      const g = structuredClone(st.getState().game);
      g.theme = { ...(g.theme ?? { id: "tempere", name: "Tempéré", emoji: "🌿", tagline: "", dominant: 2 }), pantheon };
      Object.assign(g.town, town);
      const t = g.town.buildings.find((b) => b.id === "temple");
      if (t) Object.assign(t, town.__temple ?? {});
      // Un identifiant de joueur : le vote appartient au JOUEUR, et la partie legacy
      // de test n'en a aucun (les cartes de dieu seraient toutes éteintes, à raison).
      st.setState({ game: g, appScreen: "game", tab: "map", playerId: "p1", ...extra });
    },
    [pantheon, town, extra],
  );

// ─── 1. sans temple ni faveur, le compteur n'existe pas ───────────────────────
await patchTown(OLYMPE, { favor: 0, favorGoal: 20, blessingSlots: 0, blessings: [], __temple: { built: false, level: 0 } });
await wait(500);
let chip = await page.evaluate(() => document.querySelector(".chip.favor")?.textContent ?? null);
check("aucun compteur tant que la ville n'a ni temple ni faveur", chip === null, `chip=${chip ?? "absent"}`);

// ─── 2. le compteur apparaît, avec l'icône DU PANTHÉON ────────────────────────
const built = { built: true, level: 2, durability: 90, maxDurability: 90 };
await patchTown(OLYMPE, { favor: 14, favorGoal: 20, blessingSlots: 2, blessings: [], votes: {}, __temple: built });
await wait(500);
chip = await page.evaluate(() => document.querySelector(".chip.favor")?.textContent?.trim() ?? null);
check("le compteur de faveur s'affiche avec l'icône grecque", chip === "⚡ 14", `chip=${JSON.stringify(chip)}`);

await patchTown(ASGARD, { favor: 14, favorGoal: 20, blessingSlots: 2, blessings: [], votes: {}, __temple: built });
await wait(400);
chip = await page.evaluate(() => document.querySelector(".chip.favor")?.textContent?.trim() ?? null);
check("…et l'icône suit le panthéon de la terre où l'on joue", chip === "🔨 14", `chip=${JSON.stringify(chip)}`);

// ─── 3. LA BARRE DU HAUT NE DÉBORDE PAS, compteur compris ─────────────────────
// On mesure sur le pire cas : faveur PRÊTE (le chip est alors le plus large, avec son
// halo) et un héros en ville (le bouton 📋 du journal s'ajoute).
await patchTown(OLYMPE, { favor: 20, favorGoal: 20, blessingSlots: 2, blessings: [], votes: {}, __temple: built });
await wait(500);
const bar = await page.evaluate(() => {
  const tb = document.querySelector(".topbar");
  const btns = [...tb.querySelectorAll("button")];
  const vw = window.innerWidth;
  const kids = [...tb.children].filter((e) => getComputedStyle(e).display !== "none");
  return {
    overflow: tb.scrollWidth - tb.clientWidth,
    n: btns.length,
    // ⚠ la barre a droit de PASSER À LA LIGNE (filet anti-découpe), ce qui rend
    // `scrollWidth` toujours égal à `clientWidth` : sans cette mesure-ci, le test
    // passerait avec une barre sur trois rangs. On compte les rangs par le CENTRE
    // vertical — les hauteurs diffèrent d'un élément à l'autre, donc `top` ne dit rien.
    rows: new Set(kids.map((e) => {
      const r = e.getBoundingClientRect();
      return Math.round((r.top + r.bottom) / 2);
    })).size,
    // Le dernier bouton de la rangée est ⚙️ : c'est lui qui sortait de l'écran.
    outside: btns.filter((b) => b.getBoundingClientRect().right > vw + 0.5).map((b) => b.title || b.textContent),
    vw,
  };
});
check(
  "la barre du haut ne déborde pas horizontalement à 390 px",
  bar.overflow <= 1,
  `scrollWidth − clientWidth = ${bar.overflow}px sur ${bar.n} boutons`,
);
check(
  "aucun bouton de la barre ne sort de l'écran",
  bar.outside.length === 0,
  bar.outside.length ? `hors écran : ${bar.outside.join(", ")}` : `${bar.n} boutons, tous dans ${bar.vw}px`,
);
check(
  "…et elle tient sur UNE rangée (le filet de passage à la ligne ne sert pas)",
  bar.rows === 1,
  `${bar.rows} rangée(s) pour ${bar.n} boutons à ${bar.vw}px`,
);

// ─── 4. le Temple : trois dieux, leur effet en clair, rien de tronqué ─────────
await page.evaluate(() => window.__eg.store.getState().toggleTemple(true));
await wait(600);
const cards = await page.evaluate(() =>
  [...document.querySelectorAll(".god-card")].map((el) => ({
    name: el.querySelector(".gc-nm")?.textContent ?? "",
    boon: el.querySelector(".gc-boon")?.textContent ?? "",
    disabled: el.disabled,
    // le navigateur dit lui-même si un texte déborde de sa boîte
    cut: [...el.querySelectorAll(".gc-nm, .gc-boon, .gc-tag")].some(
      (t) => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1,
    ),
  })),
);
check("le Temple présente les trois dieux du panthéon", cards.length === 3, `${cards.length} carte(s)`);
check(
  "chaque dieu dit ce qu'il FAIT, pas seulement sa légende",
  cards.every((c) => c.boon.length > 5),
  cards.map((c) => c.boon).join(" · "),
);
check(
  "aucun texte de dieu n'est tronqué à 390 px",
  cards.every((c) => !c.cut),
  cards.filter((c) => c.cut).map((c) => c.name).join(", ") || "trois cartes lisibles en entier",
);

// ─── 5. le vote part vraiment au serveur, avec le bon dieu ────────────────────
await page.evaluate(() => {
  window.__votes = [];
  const orig = window.fetch;
  window.fetch = async (url, opt) => {
    if (String(url).includes("/town/blessing")) {
      window.__votes.push(JSON.parse(opt.body));
      // On répond l'état courant : le serveur refuserait, faute de vrai Temple bâti —
      // ce que game/mythic_test.go couvre déjà. Ici on vérifie le CÂBLAGE.
      return new Response(JSON.stringify(window.__eg.store.getState().game), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return orig(url, opt);
  };
});
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".god-card")];
  cards.find((c) => c.textContent.includes("Déméter"))?.click();
});
await wait(800);
const sent = await page.evaluate(() => window.__votes ?? []);
check(
  "taper un dieu envoie la voix au serveur",
  sent.length === 1 && sent[0].godId === "demeter",
  JSON.stringify(sent),
);

// ─── 6. un dieu qui veille déjà n'est pas revotable ───────────────────────────
await page.evaluate(() => window.__eg.store.getState().toggleTemple(false));
await patchTown(OLYMPE, {
  favor: 20,
  favorGoal: 20,
  blessingSlots: 2,
  votes: {},
  blessings: [{ godId: "zeus", name: "Zeus", icon: "⚡", domain: "rempart", untilWave: 9 }],
  __temple: built,
});
await page.evaluate(() => window.__eg.store.getState().toggleTemple(true));
await wait(600);
const held = await page.evaluate(() => {
  const z = [...document.querySelectorAll(".god-card")].find((c) => c.textContent.includes("Zeus"));
  return { disabled: !!z?.disabled, active: document.querySelectorAll(".temple-active .ta-row").length };
});
check("un dieu déjà invoqué ne peut pas être revoté", held.disabled, `bouton Zeus disabled=${held.disabled}`);
check("…et il figure parmi les bénédictions en cours", held.active === 1, `${held.active} bénédiction(s) affichée(s)`);

// ─── 7. sans Temple bâti, le panneau dit L'ÉTAPE OÙ L'ON EN EST ───────────────
// Deux étapes distinctes, et les confondre serait un mensonge : depuis que l'onglet
// Bâtir ne montre que les sites dont le plan est en Banque (townUtils.buildingKnown),
// « va le bâtir » envoie vers une liste où le Temple ne figure même pas.
const noTemple = { built: false, level: 0, cost: { pa: 16, materials: [], plan: "Plan du Temple" } };
await page.evaluate(() => window.__eg.store.getState().toggleTemple(false));
await patchTown(OLYMPE, { favor: 6, favorGoal: 20, blessingSlots: 0, blessings: [], votes: {}, storage: [], __temple: noTemple });
await page.evaluate(() => window.__eg.store.getState().toggleTemple(true));
await wait(600);
let locked = await page.evaluate(() => document.querySelector(".temple-modal .stock-note")?.textContent ?? "");
check(
  "sans le plan, le panneau dit qu'il faut le TROUVER (et que la faveur n'est pas perdue)",
  locked.includes("trouver") && locked.includes("Plan du Temple") && locked.includes("perdue"),
  JSON.stringify(locked.slice(0, 90)),
);

await page.evaluate(() => window.__eg.store.getState().toggleTemple(false));
await patchTown(OLYMPE, {
  favor: 6, favorGoal: 20, blessingSlots: 0, blessings: [], votes: {},
  storage: [{ name: "Plan du Temple", type: "objet", qty: 1 }],
  __temple: noTemple,
});
await page.evaluate(() => window.__eg.store.getState().toggleTemple(true));
await wait(600);
locked = await page.evaluate(() => document.querySelector(".temple-modal .stock-note")?.textContent ?? "");
check(
  "…et une fois le plan en Banque, qu'il faut le BÂTIR",
  locked.includes("bâtir") && locked.includes("perdue"),
  JSON.stringify(locked.slice(0, 90)),
);

await browser.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok === results.length ? "PASS" : "FAIL"} — ${ok}/${results.length} checks ok`);
process.exit(ok === results.length ? 0 : 1);
