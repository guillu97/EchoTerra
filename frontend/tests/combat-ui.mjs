// LA BARRE D'ACTION DU COMBAT, vue du navigateur.
//
// Ce qu'elle défend : qu'un combat ouvert depuis la carte affiche bien ses trois
// rangs (qui joue / quoi faire / sur qui), que l'arme au poing y figure — même
// « Mains nues », qui est l'état par défaut d'un héros —, que chaque compétence
// servie a SON bouton, et que les raccourcis clavier arment le bon mode. Rien de
// tout ça n'est visible d'un test Go : le payload peut être parfait et la barre
// vide (c'est exactement ce qui arrivait quand un DTO perdait ses tags JSON).
//
//   (dev servers lancés : backend :8080 + vite :5173)
//   PERF_BROWSER=/opt/pw-browsers/chromium node tests/combat-ui.mjs
//
// ⚠ poll par page.evaluate (JAMAIS waitForFunction : en GL logiciel le canvas
// DPR affame le poller injecté de Playwright).

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

console.log("Echo Terra — barre d'action du combat\n");
const browser = await chromium.launch({
  executablePath: process.env.PERF_BROWSER || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
page.on("pageerror", (e) => console.log("  pageerror:", e.message));

await page.goto(BASE);
await waitState(page, () => !!window.__eg?.store, 30000, "app store");
await page.evaluate(async () => {
  const r = await fetch("/api/games", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ width: 22, height: 22, seed: 20260811 }),
  });
  const g = await r.json();
  await window.__eg.store.getState().loadGame(g.id);
});
await waitState(page, () => !!window.__eg.store.getState().game, 20000, "partie");
await page.evaluate(() => window.__eg.store.setState({ appScreen: "game", tab: "map" }));

// Marcher jusqu'au pack le plus proche, puis engager — le vrai chemin du joueur.
const started = await page.evaluate(async () => {
  const st = () => window.__eg.store.getState();
  const g0 = st().game;
  const hero = g0.heroes[0];
  let best = null;
  for (const m of Object.values(g0.monsters ?? {})) {
    const d = Math.abs(m.x - hero.x) + Math.abs(m.y - hero.y);
    if (!best || d < best.d) best = { m, d };
  }
  if (!best) return { ok: false, why: "aucun monstre visible" };
  st().selectHero(hero.id);
  for (let i = 0; i < 20; i++) {
    const h = st().game.heroes.find((x) => x.id === hero.id);
    if (h.x === best.m.x && h.y === best.m.y) break;
    const dx = Math.sign(best.m.x - h.x);
    const dy = dx !== 0 ? 0 : Math.sign(best.m.y - h.y);
    if (!dx && !dy) break;
    await st().move(dx, dy);
    if (st().game.heroes.find((x) => x.id === hero.id).pa <= 0) await st().advance(true);
  }
  const h = st().game.heroes.find((x) => x.id === hero.id);
  if (h.x !== best.m.x || h.y !== best.m.y) return { ok: false, why: `pas arrivé (${h.x},${h.y})→(${best.m.x},${best.m.y})` };
  await st().startCombat();
  return { ok: !!st().combat, why: "" };
});

if (!started.ok) {
  check("un combat s'ouvre depuis la carte", false, started.why);
} else {
  check("un combat s'ouvre depuis la carte", true, "engagé");
  await waitState(page, () => window.__eg.store.getState().view === "combat", 15000, "vue combat");
  await waitState(page, () => !!document.querySelector(".cbt-bar"), 10000, "barre de combat");
  await wait(1200);

  const seen = await page.evaluate(() => {
    const s = window.__eg.store.getState();
    return {
      bar: !!document.querySelector(".cbt-bar"),
      weapon: document.querySelector(".cbt-weapon")?.textContent?.trim() ?? "",
      acts: [...document.querySelectorAll(".cbt-act span")].map((e) => e.textContent),
      skills: (s.current?.skills ?? []).map((k) => k.skill.name),
      hp: !!document.querySelector(".cbt-hp b"),
    };
  });
  console.log("  état:", JSON.stringify(seen));

  check("la barre est montée", seen.bar, "cbt-bar");
  check("elle annonce l'arme au poing", seen.weapon.length > 0, seen.weapon || "(vide)");
  check("les PV du combattant actif sont là", seen.hp, "cbt-hp");
  check(
    "chaque compétence servie a son bouton",
    seen.skills.every((n) => seen.acts.includes(n)),
    `${seen.skills.join(" · ")} ⊂ ${seen.acts.join(" · ")}`,
  );
  check("les actions de base sont là", ["Attaque", "Défendre", "Fin"].every((n) => seen.acts.includes(n)), seen.acts.join(" · "));

  // LA PORTÉE SE VOIT : armer l'attaque doit peindre des cases au sol (servies
  // par le serveur), et les compétences servies ont chacune les leurs.
  const aim = await page.evaluate(() => {
    const s = window.__eg.store.getState();
    s.setCombatMode("attack");
    const c = window.__eg.store.getState().current;
    return {
      attack: (c?.attackCells ?? []).length,
      skills: (c?.skills ?? []).map((k) => ({ n: k.skill.name, cells: (k.cells ?? []).length, self: k.selfCast })),
    };
  });
  await wait(400);
  const painted = await page.evaluate(() => window.__vc?.world?.overlays?.children?.length ?? 0);
  console.log("  portée:", JSON.stringify(aim), "overlays:", painted);
  check("l'attaque de base a une portée servie", aim.attack > 0, `${aim.attack} cases`);
  check(
    "chaque compétence offensive a la sienne",
    aim.skills.every((k) => k.self || k.cells > 0),
    aim.skills.map((k) => `${k.n}:${k.cells}`).join(" · "),
  );

  // L'ÉCONOMIE DU TOUR SE VOIT. Le serveur tenait déjà « un déplacement et une
  // action par tour », mais la barre n'en disait rien : l'ennemi jouant son tour
  // instantanément, taper dix fois sur le même bouton « marchait » (c'étaient dix
  // ROUNDS) et le joueur en concluait qu'il pouvait enchaîner sans limite. Les
  // deux jauges sont la réponse, donc elles se testent depuis le navigateur —
  // c'est exactement le genre de chose qu'aucun test Go ne voit.
  const budget = await page.evaluate(() => {
    const pips = [...document.querySelectorAll(".cbt-budget i")];
    return { n: pips.length, cls: pips.map((e) => e.className) };
  });
  check(
    "les deux budgets du tour sont affichés",
    budget.n === 2,
    `${budget.n} pastille(s) : ${budget.cls.join(" · ")}`,
  );

  // LA RECHARGE. C'est le vrai correctif : « une action par tour » ne limitait
  // rien tant que la MEILLEURE action était rejouable à chaque tour.
  const cd = await page.evaluate(() => {
    const s = window.__eg.store.getState();
    return (s.current?.skills ?? []).map((k) => ({
      n: k.skill.name,
      cd: k.skill.cooldown ?? 0,
      left: k.cooldownLeft ?? 0,
    }));
  });
  check(
    "chaque compétence spéciale porte une recharge",
    cd.length > 0 && cd.every((k) => k.cd > 0),
    cd.map((k) => `${k.n}:↻${k.cd}`).join(" · ") || "(aucune compétence servie)",
  );
  const cdPips = await page.evaluate(() => document.querySelectorAll(".cbt-cdmax, .cbt-cd").length);
  check("la recharge est affichée sur le bouton", cdPips >= cd.length, `${cdPips} pastille(s) pour ${cd.length} compétence(s)`);

  // Lancer la compétence, puis vérifier qu'elle est bien ÉTEINTE au tour suivant
  // du héros — le contrat serveur rendu visible côté client.
  const spent = await page.evaluate(async () => {
    const st = () => window.__eg.store.getState();
    // Les deux camps naissent aux bords opposés de l'arène : il faut d'abord
    // MARCHER. On approche tour après tour (le déplacement seul ne clôt jamais le
    // tour, donc chaque round rend la main) jusqu'à avoir une cible à portée.
    const closest = () => {
      const s = st();
      const me = s.combat?.units.find((u) => u.id === s.current?.unitId);
      if (!me) return null;
      let best = null;
      for (const u of s.combat.units) {
        if (u.side === "monster" && u.hp > 0) {
          const d = Math.abs(u.x - me.x) + Math.abs(u.y - me.y);
          if (!best || d < best.d) best = { u, d };
        }
      }
      return best && { me, ...best };
    };
    for (let round = 0; round < 12; round++) {
      if ((st().current?.skills ?? []).some((k) => !k.selfCast && k.targets.length > 0)) break;
      const c = closest();
      if (!c || !st().current?.reachable?.length) break;
      // la case atteignable la plus proche de l'ennemi
      let goal = null;
      for (const [x, y] of st().current.reachable) {
        const d = Math.abs(x - c.u.x) + Math.abs(y - c.u.y);
        if (!goal || d < goal.d) goal = { x, y, d };
      }
      if (!goal || goal.d >= c.d) break;
      await st().combatTileClick(goal.x, goal.y);
      if (st().combat?.status !== "active") break;
    }
    const sk = (st().current?.skills ?? []).find((k) => !k.selfCast && k.targets.length > 0);
    if (!sk) return { skipped: "aucune compétence avec une cible à portée après approche" };
    st().selectCombatSkill(sk.idx);
    await st().combatUnitClick(sk.targets[0]);
    const c = st().current;
    const same = (c?.skills ?? []).find((k) => k.skill.name === sk.skill.name);
    // ⚠ `left` vaut -1 quand le tour est DÉJÀ passé (les deux budgets dépensés) :
    // `current` décrit alors une autre unité, et la compétence a disparu de la
    // liste. Les deux issues valident le contrat — ce qu'on refuse, c'est de
    // retrouver la MÊME capacité prête à être rejouée dans la foulée (left === 0).
    return { acted: !!c?.acted, left: same?.cooldownLeft ?? -1 };
  });
  await wait(500);
  if (spent.skipped) {
    console.log(`  (recharge en jeu non vérifiée : ${spent.skipped})`);
  } else {
    check(
      "lancer une compétence dépense l'action et met la capacité en recharge",
      spent.left !== 0,
      `action dépensée=${spent.acted} · recharge restante=${spent.left}`,
    );
  }

  // Raccourci clavier : A arme le mode attaque, Échap le désarme.
  await page.keyboard.press("a");
  await wait(150);
  const armed = await page.evaluate(() => window.__eg.store.getState().combatMode);
  await page.keyboard.press("Escape");
  await wait(150);
  const disarmed = await page.evaluate(() => window.__eg.store.getState().combatMode);
  check("le clavier arme et désarme l'attaque", armed === "attack" && disarmed === "move", `A→${armed} Échap→${disarmed}`);

  await page.screenshot({ path: process.env.SHOT ?? "/tmp/combat-ui.png" });
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
