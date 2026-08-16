// Test du PICKING de la carte voxel : « qu'est-ce que je viens de cliquer ? »
//
// Le tap était résolu par le seul point d'impact du rayon sur le TERRAIN, en
// traversant tout ce qui est posé dessus. La caméra étant dimétrique à 30°, un
// point situé à la hauteur h se projette là où le sol est h/tan(30°) ≈ 1,73
// unité plus loin (réparti sur x ET z, azimut 45°) : cliquer le TORSE d'un
// héros touchait le sol une à deux cases DERRIÈRE lui — d'où « le perso se
// déplace au lieu d'ouvrir la popup d'actions ». Ce test rejoue exactement ça.
//
//   (dev servers lancés : backend :8080 + vite :5173)
//   PERF_BROWSER=/opt/pw-browsers/chromium node tests/map-tap.mjs
//
// ⚠ poll par page.evaluate (JAMAIS waitForFunction : en GL logiciel le canvas
// DPR affame le poller injecté de Playwright).

import { chromium } from "playwright-core";

const BASE = process.env.PERF_BASE ?? "http://localhost:5173";
const SEED = 20260809; // graine FIXE : le verdict ne doit pas dépendre du relief
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

console.log("Echo Terra — picking de la carte\n");
const browser = await chromium.launch({
  executablePath: process.env.PERF_BROWSER || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 780 } });
page.on("pageerror", (e) => console.log("  pageerror:", e.message));

await page.goto(BASE);
await waitState(page, () => !!window.__eg?.store, 30000, "app store");
await page.evaluate(async (seed) => {
  const r = await fetch("/api/games", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ width: 22, height: 22, seed }),
  });
  const g = await r.json();
  await window.__eg.store.getState().loadGame(g.id);
}, SEED);
await waitState(page, () => !!window.__eg.store.getState().game, 20000, "partie");
await page.evaluate(() => window.__eg.store.setState({ appScreen: "game", tab: "map" }));
await waitState(page, () => !!window.__vm?.world?.terrain, 40000, "terrain voxel");
await wait(1200);

// Sortir DEUX héros : le héros piloté, et un coéquipier sur la case d'à côté.
// C'est la situation de tous les jours (une équipe sort ensemble) et celle où
// le bug faisait le plus de dégâts.
const setup = await page.evaluate(async () => {
  const st = () => window.__eg.store.getState();
  const g = st().game;
  const tile = (x, y) => (x < 0 || y < 0 || x >= g.width || y >= g.height ? null : g.tiles[y * g.width + x]);
  const walkable = (x, y) => { const t = tile(x, y); return !!t && t.biome !== 0; };
  // direction depuis la ville offrant DEUX cases praticables d'affilée
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const dir =
    dirs.find(([dx, dy]) => walkable(g.town.x + dx, g.town.y + dy) && walkable(g.town.x + 2 * dx, g.town.y + 2 * dy)) ??
    dirs.find(([dx, dy]) => walkable(g.town.x + dx, g.town.y + dy));
  const step = async (id, dx, dy) => {
    st().selectHero(id);
    await st().move(dx, dy);
    await new Promise((r) => setTimeout(r, 300));
  };
  const [lead, mate] = st().game.heroes;
  await step(lead.id, dir[0], dir[1]);
  await step(lead.id, dir[0], dir[1]);
  await step(mate.id, dir[0], dir[1]);
  st().selectHero(lead.id);
  st().syncScene();
  const gg = st().game;
  const pos = (id) => { const h = gg.heroes.find((x) => x.id === id); return { x: h.x, y: h.y }; };
  return { leadId: lead.id, mateId: mate.id, lead: pos(lead.id), mate: pos(mate.id), town: { x: gg.town.x, y: gg.town.y } };
});
await wait(600);
console.log(`  héros piloté en (${setup.lead.x},${setup.lead.y}), coéquipier en (${setup.mate.x},${setup.mate.y}), ville en (${setup.town.x},${setup.town.y})`);

// Les taps sont joués avec `bus.emit` INTERCEPTÉ : on veut lire l'intention,
// pas jouer le coup (un déplacement réel fausserait les taps suivants).
const out = await page.evaluate(({ leadId, mateId }) => {
  const { world: w, engine } = window.__vm;
  const { bus } = window.__eg;
  const st = () => window.__eg.store.getState();
  const V3 = engine.target.constructor;
  const g = w.game;
  const lead = g.heroes.find((h) => h.id === leadId);
  const mate = g.heroes.find((h) => h.id === mateId);
  const realEmit = bus.emit.bind(bus);
  let last = null;
  const tap = (x, y, z) => {
    st().selectHero(leadId);
    st().syncScene();
    engine.groundAt(0, 0); // caméra à jour avant de projeter
    const v = new V3(x, y, z).project(engine.camera);
    const sx = ((v.x + 1) / 2) * engine.cssW;
    const sy = ((1 - v.y) / 2) * engine.cssH;
    last = null;
    bus.emit = (ev, p) => { last = { ev, ...p }; };
    try { w.onTap(sx, sy); } finally { bus.emit = realEmit; }
    if (!last) return "RIEN";
    if (last.ev === "map:tileClick") return `MOVE(${last.x},${last.y})`;
    if (last.ev === "map:heroMenu") return "MENU";
    if (last.ev === "map:heroClick") return `SELECT(${last.heroId === leadId ? "piloté" : last.heroId === mateId ? "coéquipier" : "?"})`;
    return last.ev;
  };
  const topOf = (x, y) => {
    const t = g.tiles[y * g.width + x];
    return t && !t.discovered ? 1.5 : w.smooth.heightAt(x, y) + 0.05;
  };
  // corps du héros piloté, des pieds à la tête (un héros mesure HERO_HEIGHT = 0,6)
  const body = [0.05, 0.2, 0.35, 0.5].map((dy) => ({ dy, got: tap(lead.x, topOf(lead.x, lead.y) + dy, lead.y) }));
  // ÉTIQUETTE DE NOM, juste AU-DESSUS de la tête : elle ne doit rien voler. Elle
  // était pickable ET portée trop haut (0,82 pour un héros de 0,6), si bien que
  // viser une case derrière un coéquipier tapait son nom — donc le sélectionnait
  // au lieu de déplacer le héros actif. Rapporté en jeu.
  // L'ÉTIQUETTE DE NOM N'EST PAS UN PERSONNAGE. Elle était pickable et portée à
  // 0,82 pour un héros qui mesure 0,6 : elle flottait une tête entière trop haut
  // ET répondait « c'est lui ». Viser la case derrière un coéquipier tapait donc
  // son nom, et le sélectionnait au lieu de déplacer le héros actif (rapporté en
  // jeu). On vise ICI le centre de l'étiquette telle qu'elle est dans la scène :
  // aucun objet portant un `heroId` ne doit s'y trouver.
  const foot = topOf(lead.x, lead.y);
  let lbl = null;
  w.sprites.traverse((o) => {
    if (o.isSprite && o.position.y > foot + 0.3 &&
        Math.abs(o.position.x - lead.x) < 0.5 && Math.abs(o.position.z - lead.y) < 0.5) lbl = o;
  });
  const plate = (() => {
    if (!lbl) return { found: false };
    const v = new V3(lbl.position.x, lbl.position.y, lbl.position.z).project(engine.camera);
    const hits = engine.pick(((v.x + 1) / 2) * engine.cssW, ((1 - v.y) / 2) * engine.cssH);
    let heroHits = 0;
    for (const h of hits) {
      for (let n = h.object; n; n = n.parent) if (n.userData?.pickTag?.heroId) { heroHits++; break; }
    }
    return { found: true, above: +(lbl.position.y - foot).toFixed(2), heroHits };
  })();

  // corps du coéquipier (case VOISINE : c'est là que le déplacement gagnait)
  const mateAdj = Math.abs(mate.x - lead.x) + Math.abs(mate.y - lead.y) === 1;
  const mateBody = [0.2, 0.4, 0.6].map((dy) => ({ dy, got: tap(mate.x, topOf(mate.x, mate.y) + dy, mate.y) }));
  // SOL d'une case voisine libre, côté caméra (jamais masquée par un modèle)
  let ground = null;
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const nx = lead.x + dx, ny = lead.y + dy;
    const t = g.tiles[ny * g.width + nx];
    if (!t || (t.discovered && t.biome === 0)) continue;
    if (g.heroes.some((h) => h.hp > 0 && h.x === nx && h.y === ny)) continue;
    if (nx === g.town.x && ny === g.town.y) continue;
    ground = { x: nx, y: ny, got: tap(nx, topOf(nx, ny), ny) };
    break;
  }
  return { body, plate, mateBody, mateAdj, ground };
}, { leadId: setup.leadId, mateId: setup.mateId });

const bodyBad = out.body.filter((r) => r.got !== "MENU");
check(
  "taper le héros piloté ouvre son menu d'actions (jamais un déplacement)",
  bodyBad.length === 0,
  out.body.map((r) => `+${r.dy}:${r.got}`).join(" "),
);
check(
  "l'étiquette de nom ne se tape pas (ce n'est pas le personnage)",
  out.plate.found && out.plate.heroHits === 0,
  out.plate.found ? `${out.plate.heroHits} objet(s) « héros » sous l'étiquette` : "étiquette introuvable",
);
// HERO_HEIGHT = 0.6 (voxel/characters.ts) : l'étiquette se pose juste au-dessus de
// la tête, pas une tête plus haut.
check(
  "l'étiquette de nom est posée sur la tête",
  out.plate.found && out.plate.above <= 0.7,
  out.plate.found ? `+${out.plate.above} au-dessus des pieds (héros = 0.6)` : "étiquette introuvable",
);
const mateBad = out.mateBody.filter((r) => !r.got.startsWith("SELECT"));
check(
  "taper un coéquipier voisin le sélectionne (jamais un déplacement)",
  out.mateAdj && mateBad.length === 0,
  (out.mateAdj ? "" : "[coéquipier non adjacent] ") + out.mateBody.map((r) => `+${r.dy}:${r.got}`).join(" "),
);
check(
  "taper le SOL d'une case voisine déplace toujours",
  !!out.ground && out.ground.got === `MOVE(${out.ground.x},${out.ground.y})`,
  out.ground ? `case (${out.ground.x},${out.ground.y}) -> ${out.ground.got}` : "aucune case voisine libre",
);

await browser.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok === results.length ? "PASS" : "FAIL"} — ${ok}/${results.length} checks ok`);
process.exit(ok === results.length ? 0 : 1);
