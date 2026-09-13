// LE GESTE DE LA CARTE — la torsion à deux doigts, et la fenêtre dans le feuillage.
//
// Deux retours de jeu, une capture à l'appui :
//   1. un héros posté sous une canopée disparaît derrière elle, et ses LOSANGES
//      de déplacement avec lui — donc on ne sait plus où l'on peut aller ;
//   2. la vue ne tourne qu'avec deux boutons, alors qu'au doigt la rotation est
//      un geste (« plus intuitif que les boutons de rotation »).
//
// Ce que le test mord vraiment :
//   - la torsion tourne, et la ZONE MORTE empêche un pinch de zoom de faire
//     pivoter la carte par accident (c'est ce point-là qui casse en silence) ;
//   - le relâchement RECOLLE au quart, sinon le voxel dimétrique moire ;
//   - le patch de shader de la fenêtre est RÉELLEMENT compilé : un
//     `onBeforeCompile` qui ne s'applique pas ne lève aucune erreur, on croirait
//     seulement à un réglage trop doux. On le prouve en forçant les uniformes et
//     en exigeant que l'image CHANGE.
//
//   (dev servers lancés : backend :8080 + vite :5173)
//   PERF_BROWSER=/opt/pw-browsers/chromium node tests/map-gesture.mjs
//
// ⚠ poll par page.evaluate (JAMAIS waitForFunction : en GL logiciel le canvas
// DPR affame le poller injecté de Playwright).

import { chromium } from "playwright-core";

const BASE = process.env.PERF_BASE ?? "http://localhost:5173";
const QUARTER = Math.PI / 2;
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
const deg = (r) => `${((r * 180) / Math.PI).toFixed(1)}°`;

console.log("Echo Terra — le geste de la carte\n");
const browser = await chromium.launch({
  executablePath: process.env.PERF_BROWSER || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
// hasTouch : sans lui le navigateur ignore les Input.dispatchTouchEvent, et le
// test passerait en ne testant rien.
const page = await browser.newPage({ viewport: { width: 420, height: 780 }, hasTouch: true });
page.on("pageerror", (e) => console.log("  pageerror:", e.message));
const cdp = await page.context().newCDPSession(page);

await page.goto(BASE);
await waitState(page, () => !!window.__eg?.store, 30000, "app store");
await page.evaluate(async () => { await window.__eg.store.getState().newGame(); });
await waitState(page, () => !!window.__eg.store.getState().game, 20000, "partie");
await page.evaluate(() => window.__eg.store.setState({ appScreen: "game", tab: "map" }));
await waitState(page, () => !!window.__vm?.engine, 40000, "vue carte");
// Le décor est chargé de façon ASYNCHRONE (propsLib) : sans cette attente, la
// fenêtre n'aurait rien à effacer et le test passerait à vide.
await waitState(page, () => (window.__vm.world.props?.children?.length ?? 0) > 0, 40000, "décor posé");
await wait(800);

const rect = await page.evaluate(() => {
  const r = window.__vm.engine.renderer.domElement.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
const az = () => page.evaluate(() => window.__vm.engine.azimuthNow);

/** Deux doigts posés puis tournés de `turn` radians autour de leur milieu, avec
 *  un facteur d'écartement `spread` (1 = pas de zoom). Un vrai geste, en pas. */
async function twoFinger(page, turn, spread = 1, steps = 10) {
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  const r0 = Math.min(rect.width, rect.height) * 0.22;
  const pt = (a, r) => [
    { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r },
    { x: cx - Math.cos(a) * r, y: cy - Math.sin(a) * r },
  ];
  const send = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, i) => ({ ...p, id: i })) });
  await send("touchStart", pt(0, r0));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    await send("touchMove", pt(turn * k, r0 * (1 + (spread - 1) * k)));
  }
  const mid = await az();
  await send("touchEnd", []);
  return mid;
}

// ── 1. la torsion tourne, et elle suit le doigt ──────────────────────────────
const before = await az();
const during = await twoFinger(page, 0.9); // ~51°, franchement au-delà du seuil
const turned = Math.abs(during - before);
check(
  "une torsion à deux doigts fait tourner la vue",
  turned > 0.4,
  `${deg(before)} → ${deg(during)} pendant le geste (torsion demandée 51,6°, zone morte 12,6° déduite)`,
);
await wait(600); // l'animation de recollage (ROT_MS 240) + marge
const snapped = await az();
const off = Math.abs(((((snapped - Math.PI / 4) % QUARTER) + QUARTER) % QUARTER));
check(
  "au relâchement, la vue RECOLLE au quart le plus proche",
  Math.min(off, QUARTER - off) < 0.01,
  `azimut ${deg(snapped)} — écart au quart ${deg(Math.min(off, QUARTER - off))}`,
);

// Une PETITE torsion revient à son quart de départ (ci-dessus) ; une GRANDE doit
// en changer, sinon « snapper » voudrait dire « ne jamais tourner ».
const beforeBig = await az();
await twoFinger(page, 1.45); // ~83° : au-delà du demi-quart, donc quart suivant
await wait(600);
const afterBig = await az();
check(
  "une grande torsion change bel et bien de quart",
  Math.abs(Math.abs(afterBig - beforeBig) - QUARTER) < 0.01,
  `${deg(beforeBig)} → ${deg(afterBig)} (un quart = 90°)`,
);

// ── 2. la zone morte : un pinch de zoom ne doit RIEN faire tourner ───────────
const beforePinch = await az();
await twoFinger(page, 0, 1.6); // zoom franc, aucune torsion
await wait(600);
check(
  "un pinch de zoom pur ne fait pas pivoter la carte",
  Math.abs((await az()) - beforePinch) < 1e-6,
  `azimut inchangé (${deg(beforePinch)})`,
);
const beforeSlop = await az();
await twoFinger(page, 0.14, 1.4); // 8° de torsion parasite, sous le seuil de 12,6°
await wait(600);
check(
  "une torsion PARASITE sous le seuil est ignorée (la zone morte mord)",
  Math.abs((await az()) - beforeSlop) < 1e-6,
  `8,0° de torsion pendant un zoom → azimut inchangé (${deg(beforeSlop)})`,
);

// ── 3. la fenêtre est posée SUR le héros sélectionné ─────────────────────────
await page.evaluate(() => {
  const st = window.__eg.store.getState();
  st.selectHero(st.game.heroes[0].id);
});
await wait(500);
const cut = await page.evaluate(() => {
  const { engine, world, cutout } = window.__vm;
  // La taille du BACKING STORE du canvas EST celle du drawing buffer, donc le
  // repère de gl_FragCoord — la lire ici évite de fabriquer un Vector2.
  const el = engine.renderer.domElement;
  return {
    radius: cutout.uCutRadius.value,
    depth: cutout.uCutDepth.value,
    cx: cutout.uCutCenter.value.x,
    cy: cutout.uCutCenter.value.y,
    w: el.width, h: el.height,
    props: world.props.children.length,
  };
});
check(
  "la fenêtre s'ouvre quand un héros est sélectionné",
  cut.radius > 0 && cut.depth < 1,
  `rayon ${cut.radius.toFixed(0)} px physiques, profondeur de référence ${cut.depth.toFixed(4)}`,
);
check(
  "elle est centrée DANS le cadre, pas hors écran",
  cut.cx > 0 && cut.cx < cut.w && cut.cy > 0 && cut.cy < cut.h,
  `centre (${cut.cx.toFixed(0)},${cut.cy.toFixed(0)}) dans ${cut.w}×${cut.h}`,
);
check(
  "elle couvre le héros ET ses quatre cases, sans avaler la carte",
  cut.radius > 8 && cut.radius < Math.max(cut.w, cut.h) * 0.6,
  `rayon ${cut.radius.toFixed(0)} px sur un cadre de ${cut.w}×${cut.h}`,
);

// ── 4. LE PATCH DE SHADER EST VIVANT (le point qui casse en silence) ─────────
// On force la fenêtre à couvrir tout l'écran : le décor DOIT disparaître. Si
// `onBeforeCompile` n'avait pas pris, l'image serait rigoureusement identique.
//
// ⚠ ON FIGE D'ABORD LA SCÈNE, et ce n'est pas une précaution : la carte
// RESPIRE (idle des personnages, météo, tick solaire toutes les 5 s). Un
// premier jet comparait deux captures prises à 400 ms d'intervalle — elles
// diffèrent TOUJOURS, donc le test « le patch est vivant » passait pour la
// mauvaise raison et le test « rien ne change » échouait pour la mauvaise
// raison aussi. Les deux réglages à 0 (« Figée » / « Aucun ») rendent la carte
// 100 % on-demand, contrat déjà vérifié par test:perf ; le tick solaire est
// débranché à la main, lui n'a pas de réglage.
await page.evaluate(() => {
  window.__eg.store.getState().updateSettings({ idleAnimFps: 0, weatherFps: 0 });
  window.__vm.world.sunTick = () => {}; // le tick solaire (5 s) n'a pas de réglage
  // ⚠ ET LES POSES. « Figée » ne coupe que la BOUCLE d'idle : les poses restent
  // rafraîchies par pose() branché sur onBeforeFrame, donc sur les frames que
  // d'AUTRES demandent (c'est écrit tel quel dans CLAUDE.md, et c'est voulu).
  // Conséquence pour un test au pixel : dès qu'un héros est à l'écran, deux
  // redessins ne rendent JAMAIS la même image — mesuré, le témoin ci-dessous
  // échouait avant qu'on fige aussi la respiration.
  window.__vm.world.animator.pose = () => {};
});
await wait(2000); // le démontage des couches météo demande ~1,5 s (cf. test:perf)
// ⚠ On attend que le moteur ait RÉELLEMENT redessiné avant de capturer. Un
// simple `wait(400)` échouait au hasard : le moteur est on-demand, donc rien ne
// garantit qu'une frame soit composée — et une capture prise avant le redessin
// rend l'image PRÉCÉDENTE, ce qui faisait échouer le test pour une raison qui
// n'avait rien à voir avec le shader (vérifié par un témoin : deux captures sans
// redessin sont identiques, un redessin pur l'est aussi).
const frames = () => page.evaluate(() => window.__vm.engine.frames);
async function shoot() {
  const f0 = await frames();
  await page.evaluate(() => window.__vm.engine.invalidate());
  const t0 = Date.now();
  while ((await frames()) <= f0 && Date.now() - t0 < 5000) await wait(50);
  await wait(250); // laisse le compositeur publier la frame
  return page.screenshot({ clip: rect });
}

const force = (radius, floor) =>
  page.evaluate(({ radius, floor }) => {
    const { engine, world, cutout } = window.__vm;
    world.updateCutout = () => {}; // sinon la boucle repose la fenêtre à chaque frame
    const el = engine.renderer.domElement;
    cutout.uCutRadius.value = radius;
    cutout.uCutFloor.value = floor;
    cutout.uCutDepth.value = 1; // « tout est devant » : on ne teste plus la profondeur
    cutout.uCutCenter.value.set(el.width / 2, el.height / 2);
    engine.invalidate();
  }, { radius, floor });

await force(0, 0.22);
const shotOff = await shoot();
// TÉMOIN : deux redessins aux MÊMES réglages doivent rendre la même image. Sans
// lui, les deux vérifications suivantes ne prouveraient rien — une image qui
// change tout le temps « change » aussi quand on allume la fenêtre.
const shotSame = await shoot();
check(
  "témoin : à réglages égaux, deux redessins rendent la même image",
  shotOff.equals(shotSame),
  shotOff.equals(shotSame) ? "scène figée, la comparaison au pixel a un sens" : "scène instable — les checks suivants ne veulent rien dire",
);
await force(1e5, 0.0); // tout l'écran, opacité résiduelle nulle
const shotAll = await shoot();
check(
  "le patch de shader est RÉELLEMENT compilé : la fenêtre efface du décor",
  !shotOff.equals(shotAll),
  `image ${shotOff.equals(shotAll) ? "IDENTIQUE (le patch n'a pas pris)" : "changée"} avec ${cut.props} groupes de décor`,
);
await force(1e5, 1.0); // rayon énorme mais opacité pleine = rien à jeter
const shotOpaque = await shoot();
check(
  "à opacité pleine, la fenêtre ne retire RIEN (pas d'effet de bord)",
  shotOpaque.equals(shotOff),
  shotOpaque.equals(shotOff) ? "image identique à fenêtre éteinte" : "l'image a changé alors qu'elle ne devait pas",
);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
