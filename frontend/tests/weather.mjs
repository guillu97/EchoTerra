// LA MÉTÉO DES THÈMES (voxel/weather.ts) — ce test existe parce que TOUT ce qui a
// mal tourné en l'écrivant était SILENCIEUX.
//
// Trois pannes réelles, aucune n'aurait fait échouer un test unitaire ni levé la
// moindre erreur en console :
//   • le pont de nuages construit AVANT que la bibliothèque de props soit chargée :
//     `lib.get` rend `undefined`, la boucle fait `continue`, la couche existe mais
//     est VIDE — et sa clé l'empêche ensuite d'être rebâtie (mesuré : 0 nuage) ;
//   • la colonne de neige semée sur la CARTE au lieu de suivre le regard : la vue
//     ne couvre qu'une dizaine d'unités sur cinquante à cent quarante, donc moins
//     de 5 % des flocons étaient à l'image ;
//   • les vire-vents avec des voies larges : ils ne roulent que sur une case
//     DÉCOUVERTE, or on en connaît une cinquantaine sur seize cents en début de
//     partie — mesuré 0,00 vire-vent à l'écran en moyenne sur quarante secondes.
//
// D'où des checks qui COMPTENT ce qui est réellement là, jamais « le code a tourné ».
//
//   (dev servers lancés : backend :8080 + vite :5173)
//   PERF_BROWSER=/opt/pw-browsers/chromium node tests/weather.mjs
//
// ⚠ poll par page.evaluate (JAMAIS waitForFunction : en GL logiciel le canvas DPR
// affame le poller injecté de Playwright).

import { chromium } from "playwright-core";

const BASE = process.env.PERF_BASE ?? "http://localhost:5173";
// Graines FIXES dont on connaît le thème (game.PickTheme est déterministe) : un
// thème se TIRE, on ne le choisit pas, donc le test doit l'imposer.
// ⚠ pas de graine 0 : le serveur la remplace par une graine au hasard.
const SEEDS = { tempere: 4, nordique: 2, desertique: 5 };
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

console.log("Echo Terra — météo des thèmes\n");
const browser = await chromium.launch({
  executablePath: process.env.PERF_BROWSER || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 480, height: 860 } });
page.on("pageerror", (e) => console.log("  pageerror:", e.message));
await page.goto(BASE);
await waitState(page, () => !!window.__eg?.store, 30000, "app store");

/** Charge une partie de la graine voulue et attend la carte. */
async function openMap(seed) {
  await page.evaluate(async (seed) => {
    const r = await fetch("/api/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ width: 40, height: 40, seed }),
    });
    const g = await r.json();
    window.__eg.store.setState({ game: g, appScreen: "game", tab: "map", view: "map", selectedHeroId: g.heroes[0]?.id });
    // ⚠ il faut REDEMANDER un rendu : poser l'état ne suffit pas. C'est la
    // poignée de main MapSceneReady (émise par la vue à son montage) qui fait
    // re-pousser l'état courant à la scène — sans elle, changer de partie dans
    // le même onglet laisse la carte sur la précédente.
    window.__eg.bus.emit(window.__eg.EV.MapSceneReady);
  }, seed);
  await waitState(page, () => !!window.__vm?.world.terrain && !!window.__vm?.world.props, 40000, "terrain+props");
  await wait(2500);
}

/** Ce qu'il y a RÉELLEMENT dans la couche météo. */
const layer = () =>
  page.evaluate(() => {
    const w = window.__vm.world;
    const cur = w.weather.current;
    let flakes = 0, clouds = 0;
    cur?.group.traverse((o) => {
      if (o.isPoints) flakes += o.geometry.drawRange.count === Infinity ? o.geometry.attributes.position.count : o.geometry.drawRange.count;
      // un vire-vent est un mesh SEUL dans son pivot ; un nuage est un mesh direct
      if (o.isMesh && !(o.parent?.type === "Group" && o.parent.children.length === 1 && o.parent.parent !== cur.group)) clouds++;
    });
    return { theme: w.game.themeId, built: !!cur, flakes, clouds };
  });

// ── TEMPÉRÉ : rien du tout ───────────────────────────────────────────────────
await openMap(SEEDS.tempere);
let l = await layer();
check("expédition tempérée : aucune couche de météo", l.theme === "tempere" && !l.built, `thème ${l.theme}, couche ${l.built}`);
// …et pas un octet de plus : les modèles de météo sont chargés PAR THÈME.
// (Mesuré ici avant tout autre thème — la liste des ressources est cumulative.)
const dl = await page.evaluate(() =>
  performance.getEntriesByType("resource").filter((e) => /\/(tumbleweed|cloud)-v\d\.vox/.test(e.name)).length);
check("expédition tempérée : aucun modèle de météo téléchargé", dl === 0, `${dl} .vox de météo`);

// ── NORDIQUE : il neige, sous des nuages, et le VENT est partagé ──────────────
await openMap(SEEDS.nordique);
l = await layer();
check("nordique : des flocons sont DESSINÉS", l.theme === "nordique" && l.flakes > 200, `${l.flakes} flocons dans le drawRange`);
check("nordique : un pont de nuages existe", l.clouds >= 5, `${l.clouds} nuages`);

// La COHÉRENCE demandée : le pont de nuages et la chute des flocons partagent le
// même cap de vent. On le vérifie par le DÉPLACEMENT réel des nuages, pas en
// relisant la constante des deux côtés.
const coherent = await page.evaluate(async () => {
  const cur = window.__vm.world.weather.current;
  let wind = null;
  const clouds = [];
  cur.group.traverse((o) => {
    if (o.isPoints) wind = o.material.uniforms.uWind.value;
    if (o.isMesh && o.parent?.children.length > 2) clouds.push(o);
  });
  // Déplacement sur UNE seconde : assez court pour qu'aucun nuage ne reboucle sa
  // traversée (un rebouclage re-tire son couloir, ce qui polluerait la mesure).
  cur.setTime(100);
  const p0 = clouds.map((m) => [m.position.x, m.position.z]);
  cur.setTime(101);
  let dx = 0, dz = 0, n = 0;
  for (let i = 0; i < clouds.length; i++) {
    const ax = clouds[i].position.x - p0[i][0], az = clouds[i].position.z - p0[i][1];
    const d = Math.hypot(ax, az);
    if (d > 1e-3 && d < 5) { dx += ax; dz += az; n++; }
  }
  if (!n || !wind) return null;
  const nrm = (a, b) => { const l = Math.hypot(a, b) || 1; return [a / l, b / l]; };
  const [ux, uz] = nrm(dx, dz);
  const [wx, wz] = nrm(wind.x, wind.y);
  return { dot: ux * wx + uz * wz, n };
});
check(
  "nordique : neige et nuages portés par le MÊME vent",
  !!coherent && Math.abs(coherent.dot) > 0.95,
  coherent ? `cos = ${coherent.dot.toFixed(3)} sur ${coherent.n} nuages` : "mesure impossible",
);

// ⚠⚠ UN CIEL NE SUIT PAS LE DOIGT. La première version COLLAIT le pont de nuages à
// la cible caméra (parallaxe 1) : chaque pan translatait les nuages du MÊME vecteur,
// ce qui se lit immédiatement comme un bug (« les nuages bougent en même temps que la
// caméra et la suivent », rapporté en jeu). Ils REBOUCLENT désormais autour du regard
// au lieu de le suivre : on mesure les deux moitiés de la phrase — aucun nuage ne
// prend le déplacement de la caméra, et il en reste à l'écran après le pan.
const sky = await page.evaluate(() => {
  const w = window.__vm.world, e = w.engine, cur = w.weather.current;
  const clouds = [];
  cur.group.traverse((o) => { if (o.isMesh && o.name === "cloud") clouds.push(o); });
  const T = 100; // MÊME instant à chaque pas : tout écart vient de la caméra, pas du vent
  const V3 = e.target.constructor;
  // état d'un nuage : position monde, opacité, et présence dans le cadre
  const snap = () => {
    e.groundAt(0, 0); // pose la caméra avant de projeter
    return clouds.map((m) => {
      const v = new V3(m.position.x, m.position.y, m.position.z).project(e.camera);
      return {
        x: m.position.x, z: m.position.z, o: m.material.opacity,
        seen: Math.abs(v.x) <= 1.15 && Math.abs(v.y) <= 1.15,
      };
    });
  };
  // ⚠ ON PANE COMME UN DOIGT : par petits pas. Un saut instantané de douze unités
  // n'existe pas en jeu et il empêcherait le fondu de bord de jouer son rôle.
  const t0 = { x: e.target.x, z: e.target.z };
  cur.setTime(T);
  let prev = snap();
  const first = prev;
  let stayed = 0, followed = 0, wrapped = 0, popped = 0;
  for (let step = 0; step < 8; step++) {
    e.target.set(e.target.x + 1.5, e.target.y, e.target.z + 1.5);
    e.groundAt(0, 0);
    cur.setTime(T);
    const now = snap();
    for (let i = 0; i < clouds.length; i++) {
      const dx = now[i].x - prev[i].x, dz = now[i].z - prev[i].z;
      if (Math.hypot(dx, dz) < 0.01) continue;
      if (Math.hypot(dx - 1.5, dz - 1.5) < 0.3) { followed++; continue; } // il a SUIVI le pan
      wrapped++;
      // un rebouclage n'a le droit d'exister que sur un nuage éteint ou hors cadre
      if ((prev[i].seen && prev[i].o > 0.05) || (now[i].seen && now[i].o > 0.05)) popped++;
    }
    prev = now;
  }
  // Combien de nuages n'ont pas bougé d'un pouce sur tout le trajet ?
  for (let i = 0; i < clouds.length; i++) if (Math.abs(prev[i].x - first[i].x) < 0.01 && Math.abs(prev[i].z - first[i].z) < 0.01) stayed++;
  const seenAfter = prev.filter((c) => c.seen && c.o > 0.5).length;
  const seenBefore = first.filter((c) => c.seen && c.o > 0.5).length;
  e.target.set(t0.x, e.target.y, t0.z); // on remet la caméra où on l'a prise
  e.groundAt(0, 0);
  return { n: clouds.length, stayed, followed, wrapped, popped, seenBefore, seenAfter };
});
check(
  "nordique : les nuages NE SUIVENT PAS la caméra",
  sky.n > 0 && sky.followed === 0,
  `${sky.stayed}/${sky.n} immobiles après 12 unités de pan, ${sky.wrapped} rebouclages, ${sky.followed} qui suivent`,
);
check(
  "nordique : aucun rebouclage VISIBLE (fondu de bord)",
  sky.popped === 0,
  `${sky.wrapped} rebouclage(s), dont ${sky.popped} sur un nuage à la fois dans le cadre et opaque`,
);
check(
  "nordique : …et il reste des nuages à l'écran après le pan",
  sky.seenAfter > 0,
  `${sky.seenBefore} → ${sky.seenAfter} nuages dans le cadre`,
);

// ── DÉSERTIQUE : des vire-vents ROULENT, et on en voit ───────────────────────
await openMap(SEEDS.desertique);
l = await layer();
const tw = await page.evaluate(() => {
  const cur = window.__vm.world.weather.current;
  const pivots = [];
  cur.group.traverse((o) => {
    if (o.isMesh && o.parent?.type === "Group" && o.parent.children.length === 1) pivots.push(o.parent);
  });
  // Combien de vire-vents à l'écran EN MOYENNE sur 40 s de temps simulé ? Et
  // tournent-ils sur eux-mêmes ? ⚠ un vire-vent masqué (eau, brouillard) n'est pas
  // mis à jour : on ne compte donc que les pas où il était visible AVANT et APRÈS.
  let seen = 0, samples = 0, pairs = 0, rolled = 0;
  let prev = pivots.map(() => null);
  for (let s = 0; s < 40; s += 0.5) {
    cur.setTime(s);
    seen += pivots.filter((p) => p.visible).length;
    samples++;
    pivots.forEach((p, i) => {
      const q = p.visible ? p.quaternion.w : null;
      if (q !== null && prev[i] !== null) { pairs++; if (Math.abs(q - prev[i]) > 1e-5) rolled++; }
      prev[i] = q;
    });
  }
  return { count: pivots.length, moy: seen / samples, rolled, pairs };
});
check("désertique : des vire-vents existent", l.theme === "desertique" && tw.count >= 8, `${tw.count} vire-vents`);
check("désertique : on en voit vraiment (terrain connu)", tw.moy >= 1, `${tw.moy.toFixed(2)} à l'écran en moyenne`);
check("désertique : ils ROULENT (rotation qui change)", tw.pairs > 20 && tw.rolled >= tw.pairs * 0.9, `${tw.rolled}/${tw.pairs} pas où le vire-vent était visible`);
check("désertique : pas de neige", l.flakes === 0, `${l.flakes} flocons`);

// TAILLE — mesurée EN TUILES, comme tout prop (cf. CLAUDE.md §7a-bis : une taille à
// l'écran est le produit du remplissage du modèle dans sa grille et de l'échelle de
// pose, donc « il est trop gros » ne se corrige pas à l'œil sur une capture). Le
// repère est le HÉROS (0,6 unité de haut) : un vire-vent monte à la cuisse, il ne
// fait pas la taille d'un homme — ce qu'il faisait au premier jet (0,77 tuile de
// large, presque le double d'un cactus, « les tumbleweeds sont trop gros »).
const twSize = await page.evaluate(() => {
  const cur = window.__vm.world.weather.current;
  let lo = Infinity, hi = 0, n = 0;
  cur.group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * o.scale.x;
    if (!w) return;
    lo = Math.min(lo, w); hi = Math.max(hi, w); n++;
  });
  return { lo, hi, n };
});
check(
  "désertique : un vire-vent reste plus petit qu'un héros (0,6)",
  twSize.n > 0 && twSize.hi <= 0.32 && twSize.lo >= 0.15,
  `${twSize.lo.toFixed(2)}–${twSize.hi.toFixed(2)} tuile de large sur ${twSize.n} boules`,
);

// ⚠ LES CASES DÉCOUVERTES PLUS TARD COMPTENT AUSSI. La couche est construite UNE
// fois par partie ; si son test de praticabilité capture l'objet `game` de ce
// moment-là, il gèle la carte de découverte telle qu'elle était AU LANCEMENT — la
// ville et ses abords — et plus aucun vire-vent ne roulera jamais ailleurs, quoi
// que le joueur explore. Rapporté en jeu, et c'est exactement ce que ce check
// rejoue : on révèle un coin ÉLOIGNÉ, on y pose la caméra, on compte.
await page.evaluate(async () => {
  // ⚠ ON EXPLORE POUR DE VRAI (triche de dev `revealFog`, côté SERVEUR). Marquer
  // `discovered` dans l'objet client ne suffit pas : le fog serveur CAVIARDE le
  // biome des cases inconnues à 0 (= eau), donc une case « révélée » à la main
  // reste un lac aux yeux du vire-vent, et le test mesurerait sa propre bidouille.
  await window.__eg.store.getState().revealFog(true);
  window.__eg.bus.emit(window.__eg.EV.MapSceneReady);
});
await wait(2500);
const explored = await page.evaluate(() => {
  const w = window.__vm.world;
  const g = window.__eg.store.getState().game;
  // un carré de terre LOIN de la ville — le vire-vent doit y rouler comme ailleurs
  const far = (a, size) => (a > size / 2 ? 7 : size - 8);
  const cx = far(g.town.x, g.width), cz = far(g.town.y, g.height);
  let land = 0;
  for (let y = cz - 6; y <= cz + 6; y++)
    for (let x = cx - 6; x <= cx + 6; x++) {
      const t = g.tiles[y * g.width + x];
      if (t?.discovered && t.biome !== 0) land++;
    }
  w.engine.target.set(cx, w.engine.target.y, cz);
  const cur = w.weather.current;
  const pivots = [];
  cur.group.traverse((o) => {
    if (o.isMesh && o.parent?.type === "Group" && o.parent.children.length === 1) pivots.push(o.parent);
  });
  let seen = 0, samples = 0;
  for (let s = 0; s < 40; s += 0.5) { cur.setTime(s); seen += pivots.filter((p) => p.visible).length; samples++; }
  return { land, moy: seen / samples, town: [g.town.x, g.town.y], at: [cx, cz] };
});
check(
  "désertique : ils roulent AUSSI sur les cases explorées ensuite",
  explored.land > 40 && explored.moy >= 1,
  `${explored.moy.toFixed(2)} à l'écran en (${explored.at}) — loin de la ville (${explored.town}), ${explored.land} cases de terre`,
);

// ── LA MÉTÉO N'INTERCEPTE JAMAIS UN TAP ──────────────────────────────────────
// `engine.pick` raycaste la scène ENTIÈRE : un nuage au-dessus de la tête, ou un
// nuage de points avec son seuil de raycast par défaut, volerait les taps de la
// carte et le héros ne bougerait plus.
const picks = await page.evaluate(() => {
  const e = window.__vm.engine;
  const grp = window.__vm.world.weather.current?.group;
  const inWeather = (o) => { for (let n = o; n; n = n.parent) if (n === grp) return true; return false; };
  let total = 0, stolen = 0;
  for (const [x, y] of [[240, 300], [120, 260], [360, 380], [240, 180]]) {
    const hits = e.pick(x, y);
    total += hits.length;
    stolen += hits.filter((h) => inWeather(h.object)).length;
  }
  return { total, stolen };
});
check("la météo n'intercepte aucun tap", picks.stolen === 0, `${picks.stolen} interceptions sur ${picks.total} touches`);

// ── L'INTERRUPTEUR : « Aucun » SUPPRIME, il ne fige pas ──────────────────────
await page.evaluate(() => window.__eg.store.getState().updateSettings({ idleAnimFps: 0, weatherFps: 0 }));
// ⚠ ON LAISSE LE DÉMONTAGE FINIR avant de compter. Éteindre les deux couches
// provoque quelques redraws de TRANSITION (destruction de la météo, dernière pose
// des personnages, minuterie d'idle déjà armée) qui arrivaient jusqu'à ~1,5 s plus
// tard : à 700 ms d'attente, ce test comptait 2 ou 3 redraws SELON LE TOUR et
// échouait une fois sur deux — un flake traîné trois lots, qu'on a fini par mesurer.
// En régime établi il n'y a qu'UNE source de redraw (le tick solaire, toutes les
// 5 s) : vérifié en instrumentant `invalidate()` — 1 appel en 6 s, et rien d'autre.
await wait(1800);
const gone = await page.evaluate(() => !window.__vm.world.weather.current);
const f0 = await page.evaluate(() => window.__vm.engine.frames);
await wait(3000);
const f1 = await page.evaluate(() => window.__vm.engine.frames);
check("« Aucun » : la couche n'existe plus", gone, gone ? "couche absente" : "couche encore là");
// ≤2 : le cycle solaire tique toutes les 5 s et redessine.
check("« Aucun » : la carte redevient 100 % on-demand", f1 - f0 <= 2, `${f1 - f0} redraws en 3s`);

await page.evaluate(() => window.__eg.store.getState().updateSettings({ weatherFps: 15 }));
await wait(1500);
check("rallumer RECONSTRUIT la couche", await page.evaluate(() => !!window.__vm.world.weather.current), "couche revenue");

// cadence : ça anime, et ça ne part jamais à la fréquence de l'écran.
// ⚠ pas de plancher serré : en GL LOGICIEL une frame de carte coûte des centaines
// de ms, la boucle est affamée bien avant sa cadence. Ce qui est vérifiable, c'est
// que ça bouge et que c'est PLAFONNÉ.
const a0 = await page.evaluate(() => window.__vm.engine.frames);
await wait(3000);
const a1 = await page.evaluate(() => window.__vm.engine.frames);
const fps = (a1 - a0) / 3;
check("cadence tenue sous son plafond (15 demandées)", fps > 0.3 && fps <= 22, `${fps.toFixed(1)} redraws/s`);

// ── ONGLET QUITTÉ : la météo se tait aussi ───────────────────────────────────
await page.evaluate(() => window.__eg.store.setState({ tab: "stock" }));
// ⚠ laisser RETOMBER la frame déjà en vol : en GL logiciel un redraw de la carte
// prend plus d'une seconde, donc une image demandée juste avant le changement
// d'onglet atterrit APRÈS lui et se compterait comme « la météo continue ».
await wait(3000);
const b0 = await page.evaluate(() => window.__vm.engine.frames);
await wait(2000);
const b1 = await page.evaluate(() => window.__vm.engine.frames);
check("hors de l'onglet Map, la météo ne demande plus rien", b1 - b0 === 0, `${b1 - b0} redraws en 2s`);

// ── LA VILLE AUSSI ───────────────────────────────────────────────────────────
// Un bourg nordique au sec pendant qu'il neige sur la carte, à un tap de
// distance, se lit comme un bug.
await page.evaluate(() => window.__eg.store.setState({ tab: "map" }));
await openMap(SEEDS.nordique);
await page.evaluate(() => window.__eg.store.setState({ tab: "home" }));
await waitState(page, () => !!window.__vt, 20000, "vue ville");
await wait(4000);
const townSnow = await page.evaluate(() => {
  let flakes = 0;
  window.__vt.engine.scene.traverse((o) => { if (o.isPoints) flakes += o.geometry.attributes.position.count; });
  return flakes;
});
check("il neige aussi sur la ville nordique", townSnow > 0, `${townSnow} flocons dans la scène de ville`);

// ⚠ AUCUN VIRE-VENT SUR LE TERTRE : rien ne dit à une boule qui roule librement de
// contourner un bâtiment, et elle les TRAVERSAIT. La ville garde la neige, qui
// tombe sur tout sans rien traverser.
await page.evaluate(() => window.__eg.store.setState({ tab: "map" }));
await openMap(SEEDS.desertique);
await page.evaluate(() => window.__eg.store.setState({ tab: "home" }));
await wait(5000);
const townTw = await page.evaluate(() => {
  // Sur un thème désertique privé de vire-vents, la ville n'a plus AUCUNE météo :
  // la couche entière doit être nulle, pas seulement vide.
  const cur = window.__vt.weather.current;
  let rolling = 0;
  cur?.group.traverse((o) => { if (o.isMesh) rolling++; });
  return { built: !!cur, rolling };
});
check(
  "aucun vire-vent dans la ville (ils traversaient les bâtiments)",
  !townTw.built && townTw.rolling === 0,
  `couche ${townTw.built}, ${townTw.rolling} objets roulants`,
);

await browser.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok === results.length ? "PASS" : "FAIL"} — ${ok}/${results.length} checks ok`);
process.exit(ok === results.length ? 0 : 1);
