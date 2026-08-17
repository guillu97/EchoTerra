// AUDIT DES PROPORTIONS — la taille RÉELLE de chaque asset, en tuiles.
//
// Pourquoi un outil et pas un coup d'œil : une taille à l'écran est le PRODUIT de
// trois facteurs (remplissage du modèle dans sa grille × échelle de pose × coups de
// pouce comme le ×1,6 des arbres), et aucun des trois ne se lit dans le fichier de
// l'autre. Le repo s'est déjà fait prendre deux fois — un saguaro sorti plus grand
// qu'un sapin, un vire-vent à la taille d'un héros. Donc on MESURE la scène telle
// qu'elle est rendue (géométrie maillée × matrices réellement posées) et on compare
// à un REPÈRE du jeu.
//
// Le repère est le HÉROS : `CharLibrary` normalise chaque personnage à
// `HERO_HEIGHT` = 0,6 unité, donc un héros mesure exactement 0,6 tuile de haut. S'il
// représente un humain d'environ 1,7 m, alors **1 tuile ≈ 2,8 m** — et la colonne
// « ≈ m » du rapport dit ce que chaque objet mesurerait pour de vrai. C'est la seule
// façon de discuter d'un « c'est trop gros » avec des chiffres.
//
// ⚠ L'audit ne lit QUE des objets NOMMÉS (`mesh.name` / `rig.root.name`, posés par
// les vues). Un asset sans nom n'apparaît pas : c'est le prix d'une mesure faite sur
// la scène et non sur les tables, et c'est aussi une incitation à nommer.
//
// Sortie : un tableau trié + `asset-index/PROPORTIONS.md`. Les lignes ⚠ sortent de
// la fourchette attendue (table `EXPECTED`, qui est un choix d'ART DIRECTION et pas
// une vérité : c'est là qu'on discute).
//
//   (dev servers lancés : backend :8080 + vite :5173)
//   PERF_BROWSER=/opt/pw-browsers/chromium node tests/proportions.mjs
//
// ⚠ poll par page.evaluate (JAMAIS waitForFunction : en GL logiciel le canvas
// DPR affame le poller injecté de Playwright).

import { chromium } from "playwright-core";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const BASE = process.env.PERF_BASE ?? "http://localhost:5173";
const OUT = resolve(process.cwd(), "../asset-index/PROPORTIONS.md");
const SEEDS = { tempere: 4, nordique: 2, desertique: 5 }; // mêmes graines que test:weather
const HERO_H = 0.6; // unités monde (characters.ts, HERO_HEIGHT) — LE repère
const HUMAN_M = 1.7; // ce qu'un héros est censé représenter
const M_PER_TILE = HUMAN_M / HERO_H; // ≈ 2,83 m par tuile

// Fourchette de HAUTEUR attendue, en mètres réels. C'est un choix d'art direction à
// discuter ligne par ligne — l'outil ne fait que dire qui en sort. Un asset absent
// de la table est mesuré et listé sans verdict.
const EXPECTED = {
  // au sol, à la cheville
  "grass-tuft": [0.2, 0.7], daisy: [0.1, 0.5], flowers: [0.2, 0.7], pebbles: [0.05, 0.4],
  shells: [0.05, 0.3], "dune-grass": [0.2, 0.9], tallgrass: [0.3, 1.1], mushroom: [0.05, 0.5],
  lilypad: [0.02, 0.3], kelp: [0.2, 1.0], web: [0.3, 1.6], bones: [0.2, 0.9],
  "snow-motes": [0.05, 0.6], scree: [0.1, 0.7],
  // buissons, souches, rochers — du genou à la taille
  "bush-dense": [0.5, 1.7], "berry-bush": [0.5, 1.7], "frost-bush": [0.5, 1.7],
  brambles: [0.3, 1.3], fern: [0.3, 1.3], reed: [0.8, 2.6], stump: [0.3, 1.1],
  log: [0.3, 1.1], driftwood: [0.2, 1.0], rock: [0.4, 2.2], "water-rock": [0.3, 1.6],
  snowdrift: [0.3, 1.3], tumbleweed: [0.3, 1.0], cairn: [0.5, 2.2], crystal: [0.5, 3],
  // arbres et grandes silhouettes
  "tree-green": [4, 13], "tree-pink": [4, 13], pine: [5, 15], "pine-snow": [5, 15],
  // ⚠ `frost-tree` et `olive` sont des PETITS arbres (bouleau givré, olivier
  // rabougri), pas des futaies : leur fourchette est basse par intention, pas par
  // laxisme — ils doivent rester sous le sapin (4,2 m) tout en dominant un héros.
  "frost-tree": [2.5, 9], "dead-tree": [2, 10], olive: [2.5, 9], palm: [4, 13], cactus: [1.5, 6],
  "ice-spike": [1, 6], menhir: [1.5, 5], "rune-stone": [1, 3.5],
  scarecrow: [1.4, 2.6], snowman: [1, 2.2], boat: [0.5, 2.2], turtle: [0.2, 1.1],
  beehive: [0.4, 1.6], eagle: [0.5, 2.6],
  // vie ambiante
  // ⚠ la luciole est une LUMIÈRE (self-lit + calque bloom), pas un insecte : sa
  // taille est celle de son halo, sinon elle ne se verrait pas. Écart assumé.
  butterfly: [0.05, 0.4], gull: [0.2, 0.9], firefly: [0.02, 0.9], rabbit: [0.2, 0.7],
  hare: [0.2, 0.8], crab: [0.1, 0.6],
  // ruines éparses
  "ruin-wall": [1, 4.5], "ruin-column": [1.5, 6], "ruin-slab": [0.3, 1.6], "ruin-arch": [2, 6.5],
  // habité : un héros fait 1,7 m, une porte ~2 m, une maison de bourg ~5-7 m au faîte
  house: [4, 9], house2: [4, 9], house3: [4, 9], fence: [0.8, 2], "street-cart": [1, 2.6],
  "street-stall": [1.5, 3.5], "street-furniture": [0.5, 2],
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

console.log("Echo Terra — audit des proportions\n");
const browser = await chromium.launch({
  executablePath: process.env.PERF_BROWSER || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 480, height: 860 } });
page.on("pageerror", (e) => console.log("  pageerror:", e.message));
await page.goto(BASE);
await waitState(page, () => !!window.__eg?.store, 30000, "app store");

// Une seule fonction de mesure pour les trois scènes : elle marche l'arbre et
// traite trois formes d'objet nommé — InstancedMesh (les props semés, une matrice
// par exemplaire), Mesh (ville, météo) et Group (un rig de personnage, mesuré par
// l'union des boîtes de ses parties dans le repère MONDE).
const MEASURE = `(() => {
  const out = {};
  const put = (key, kind, w, h) => {
    if (!key || !isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return;
    const e = (out[key] ??= { key, kind, wLo: Infinity, wHi: 0, hLo: Infinity, hHi: 0, n: 0 });
    e.wLo = Math.min(e.wLo, w); e.wHi = Math.max(e.wHi, w);
    e.hLo = Math.min(e.hLo, h); e.hHi = Math.max(e.hHi, h);
    e.n++;
  };
  const bb = (g) => { g.computeBoundingBox(); return g.boundingBox; };
  return (scene, kindOf) => {
    scene.traverse((o) => {
      if (!o.name) return;
      const kind = kindOf(o);
      if (o.isInstancedMesh) {
        const b = bb(o.geometry);
        const gw = Math.max(b.max.x - b.min.x, b.max.z - b.min.z), gh = b.max.y - b.min.y;
        const m = new (Object.getPrototypeOf(o.matrixWorld).constructor)();
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          const el = m.elements;
          const s = Math.hypot(el[0], el[1], el[2]); // norme de la colonne X = échelle
          put(o.name.replace(/-v\\d+$/, ""), kind, gw * s, gh * s);
        }
      } else if (o.isMesh) {
        const b = bb(o.geometry);
        put(o.name, kind, Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * o.scale.x, (b.max.y - b.min.y) * o.scale.y);
      } else {
        // GROUPE NOMMÉ = un rig : union des parties, matrices monde appliquées
        o.updateMatrixWorld(true);
        let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity, zlo = Infinity, zhi = -Infinity, any = false;
        o.traverse((c) => {
          if (!c.geometry) return;
          const box = bb(c.geometry).clone().applyMatrix4(c.matrixWorld);
          xlo = Math.min(xlo, box.min.x); xhi = Math.max(xhi, box.max.x);
          ylo = Math.min(ylo, box.min.y); yhi = Math.max(yhi, box.max.y);
          zlo = Math.min(zlo, box.min.z); zhi = Math.max(zhi, box.max.z);
          any = true;
        });
        if (any) put(o.name, kind, Math.max(xhi - xlo, zhi - zlo), yhi - ylo);
      }
    });
    return out;
  };
})()`;

async function openMap(seed) {
  await page.evaluate(async (seed) => {
    const r = await fetch("/api/games", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ width: 40, height: 40, seed }),
    });
    const g = await r.json();
    window.__eg.store.setState({ game: g, appScreen: "game", tab: "map", view: "map", selectedHeroId: g.heroes[0]?.id });
    window.__eg.bus.emit(window.__eg.EV.MapSceneReady);
  }, seed);
  await waitState(page, () => !!window.__vm?.world.terrain && !!window.__vm?.world.props, 40000, "terrain+props");
  await wait(2500);
}

const measureMap = () =>
  page.evaluate((src) => {
    const measure = eval(src);
    const w = window.__vm.world;
    const kindOf = (o) =>
      o.name.startsWith("mob-") ? "monstre" : o.name.startsWith("char-") ? "héros" :
      o.name === "cloud" || o.name === "tumbleweed" ? "météo" : "prop";
    return measure(window.__vm.engine.scene, kindOf);
  }, MEASURE);

const measureTown = () =>
  page.evaluate((src) => {
    const measure = eval(src);
    return measure(window.__vt.engine.scene, (o) => (o.name.startsWith("char-") ? "héros (ville)" : "ville"));
  }, MEASURE);

const all = new Map();
const merge = (rows) => {
  for (const r of Object.values(rows)) {
    const cur = all.get(r.key);
    if (!cur) all.set(r.key, { ...r });
    else {
      cur.wLo = Math.min(cur.wLo, r.wLo); cur.wHi = Math.max(cur.wHi, r.wHi);
      cur.hLo = Math.min(cur.hLo, r.hLo); cur.hHi = Math.max(cur.hHi, r.hHi);
      cur.n += r.n;
    }
  }
};

for (const [theme, seed] of Object.entries(SEEDS)) {
  await openMap(seed);
  const served = await page.evaluate(() => window.__vm.world.game.themeId);
  const got = await measureMap();
  console.log(`  carte ${theme.padEnd(11)} (graine ${seed}) → thème servi ${served.padEnd(11)} ${Object.keys(got).length} assets`);
  merge(got);
}
// LA VILLE (une fois : son plan ne dépend pas du thème, seule la peau change)
await page.evaluate(() => window.__eg.store.setState({ tab: "home" }));
await waitState(page, () => !!window.__vt?.engine, 40000, "vue ville");
await wait(3000);
const town = await measureTown();
console.log(`  ville                          → ${Object.keys(town).length} assets`);
merge(town);
await browser.close();

// ── RAPPORT ─────────────────────────────────────────────────────────────────
const rows = [...all.values()].sort((a, b) => b.hHi - a.hHi);
const f = (n) => n.toFixed(2);
const range = (lo, hi) => (Math.abs(hi - lo) < 0.005 ? f(hi) : `${f(lo)}–${f(hi)}`);
// ⚠ LE VERDICT SE JUGE SUR LE PLUS GRAND EXEMPLAIRE, pas sur le plus petit. Le
// scatter tire une échelle par pied : un semis contient des jeunes pousses ET des
// sujets adultes, donc juger « trop petit » sur le minimum flaggait la VARIÉTÉ (un
// premier jet mettait ainsi le sapin et l'arbre vert au piquet, alors que leurs plus
// grands sujets sont exactement à la bonne taille). La question honnête est : « un
// exemplaire adulte de cet asset atteint-il la taille de la chose qu'il représente ? »
const verdict = (r) => {
  const exp = EXPECTED[r.key];
  if (!exp) return "—";
  const [lo, hi] = exp;
  const mHi = r.hHi * M_PER_TILE;
  if (mHi > hi * 1.35) return `⚠ trop grand (attendu ≤ ${hi} m)`;
  if (mHi < lo / 1.35) return `⚠ trop petit (attendu ≥ ${lo} m)`;
  return "ok";
};

console.log(`\n  repère : un héros = ${HERO_H} tuile de haut ≈ ${HUMAN_M} m → 1 tuile ≈ ${M_PER_TILE.toFixed(2)} m\n`);
const lines = [
  "# Proportions des assets — mesuré, pas estimé",
  "",
  "> Généré par `npm run test:proportions` (frontend, dev servers lancés). Les tailles sont",
  "> celles de la scène RÉELLEMENT rendue : géométrie maillée × échelle posée (boost des",
  "> arbres, `fitScale` de la ville et échelles par espèce compris).",
  "",
  `Repère : un héros mesure **${HERO_H} tuile** de haut (\`characters.ts\`, \`HERO_HEIGHT\`).`,
  `S'il représente un humain d'environ ${HUMAN_M} m, alors **1 tuile ≈ ${M_PER_TILE.toFixed(2)} m**.`,
  "",
  "| asset | type | largeur (tuiles) | hauteur (tuiles) | hauteur ≈ | × héros | verdict |",
  "|---|---|---|---|---|---|---|",
];
for (const r of rows) {
  const v = verdict(r);
  lines.push(
    `| \`${r.key}\` | ${r.kind} | ${range(r.wLo, r.wHi)} | ${range(r.hLo, r.hHi)} | ${f(r.hHi * M_PER_TILE)} m | ×${(r.hHi / HERO_H).toFixed(2)} | ${v} |`,
  );
  console.log(
    `  ${v.startsWith("⚠") ? "⚠" : " "} ${r.key.padEnd(18)} ${r.kind.padEnd(14)} l ${range(r.wLo, r.wHi).padEnd(12)} h ${range(r.hLo, r.hHi).padEnd(12)} ≈ ${f(r.hHi * M_PER_TILE).padStart(6)} m  ×héros ${(r.hHi / HERO_H).toFixed(2).padStart(5)}  ${v}`,
  );
}
const warned = rows.filter((r) => verdict(r).startsWith("⚠"));
lines.push("", `**${warned.length} asset(s) hors fourchette** sur ${rows.length} mesurés.`);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`\n  ${warned.length} hors fourchette sur ${rows.length} mesurés — rapport : ${OUT}`);
