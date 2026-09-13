// LE LANCEUR DE TESTS — un seul point d'entrée pour les 13 suites e2e.
//
// Pourquoi il existe : AUCUNE suite ne démarre ses serveurs. Chacune suppose
// déjà debout un backend :8080 ET un Vite :5173, et échoue par un timeout de
// 30 s sur `window.__eg?.store` quand ils ne le sont pas — un message qui ne
// dit PAS « il manque les serveurs ». Le préambule était donc manuel et non
// écrit, à refaire à chaque session, et une session en déduisait que la suite
// était cassée.
//
//   node tests/run.mjs                 # toutes les suites
//   node tests/run.mjs fog weather     # celles-ci seulement
//   node tests/run.mjs --list
//   node tests/run.mjs --keep          # laisse les serveurs debout après coup
//   node tests/run.mjs --serve         # JUSTE les serveurs, et il les tient
//
// `--serve` existe pour jouer à la main : démarrer Echo Terra demandait deux
// terminaux (Go d'un côté, Vite de l'autre) et une base qu'on pollue. ⚠ il garde
// la base RÉELLE (`backend/echoterra.db`), lui : une partie qu'on veut reprendre
// demain ne doit pas mourir avec le process.
//
// ⚠ IL RÉUTILISE ce qui tourne déjà (sonde /healthz et :5173) et ne ferme QUE
// ce qu'il a lui-même lancé : un serveur de dev ouvert dans un autre terminal
// ne doit pas mourir parce qu'on a lancé les tests.
// ⚠ BASE DE DONNÉES JETABLE (`ECHOTERRA_DB` dans un dossier temporaire) : les
// suites créent de vraies parties, et les accumuler dans `echoterra.db` fait
// dériver `ensurePublicLobby` et le salon public d'une exécution sur l'autre.
// ⚠ le backend est COMPILÉ une fois (`go build`) plutôt que lancé par
// `go run` : `go run` relaie mal les signaux (c'est un parent qui survit à son
// enfant), donc le port 8080 restait pris après un Ctrl-C.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TESTS = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(TESTS, "..");
const REPO = resolve(FRONTEND, "..");

// Les suites, dans l'ordre où elles coûtent : le CSS pur d'abord (il n'a besoin
// de rien), puis ce qui demande une partie.
const SUITES = [
  { name: "wave-chip", file: "wave-chip.mjs", servers: false, about: "contraste de la pastille de vague" },
  { name: "perf", file: "perf/voxel-perf.mjs", servers: true, about: "budgets de chargement de la carte" },
  { name: "map-tap", file: "map-tap.mjs", servers: true, about: "picking de la carte" },
  { name: "combat-ui", file: "combat-ui.mjs", servers: true, about: "barre d'action du combat" },
  { name: "fog", file: "fog.mjs", servers: true, about: "brouillard de guerre" },
  { name: "weather", file: "weather.mjs", servers: true, about: "météo des thèmes" },
  { name: "camera", file: "camera-bounds.mjs", servers: true, about: "bornes de la caméra" },
  { name: "inventory", file: "inventory.mjs", servers: true, about: "inventaire et fiches d'objet" },
  { name: "structures", file: "structures.mjs", servers: true, about: "onglet Bâtir" },
  { name: "mythic", file: "mythic.mjs", servers: true, about: "faveur des dieux" },
  { name: "endgame", file: "endgame.mjs", servers: true, about: "récit de fin de partie" },
  { name: "reconnect", file: "reconnect.mjs", servers: true, about: "reprise après une absence" },
  { name: "proportions", file: "proportions.mjs", servers: true, about: "audit des proportions des assets" },
];

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("-")));
const wanted = argv.filter((a) => !a.startsWith("-"));

if (flags.has("--list") || flags.has("-l")) {
  for (const s of SUITES) console.log(`  ${s.name.padEnd(12)} ${s.about}${s.servers ? "" : "  (sans serveur)"}`);
  process.exit(0);
}

const suites = wanted.length
  ? wanted.map((n) => {
      const s = SUITES.find((x) => x.name === n || x.file === n);
      if (!s) {
        console.error(`suite inconnue : ${n}\nconnues : ${SUITES.map((x) => x.name).join(", ")}`);
        process.exit(2);
      }
      return s;
    })
  : SUITES;

const BASE = process.env.PERF_BASE ?? "http://localhost:5173";
const API = process.env.ECHOTERRA_API ?? "http://localhost:8080";
const BROWSER = process.env.PERF_BROWSER ?? "/opt/pw-browsers/chromium";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function alive(url) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 1500);
    const r = await fetch(url, { signal: c.signal });
    clearTimeout(t);
    return r.ok || r.status === 404; // la racine de Vite répond, c'est tout ce qu'on demande
  } catch {
    return false;
  }
}

/** Attend qu'une URL réponde, en affichant la fin du journal si ça n'arrive pas. */
async function waitUp(url, what, proc, timeoutMs = 90_000) {
  const t0 = Date.now();
  for (;;) {
    if (await alive(url)) return Date.now() - t0;
    if (proc?.exitCode != null) throw new Error(`${what} s'est arrêté (code ${proc.exitCode})\n${proc.log.slice(-2000)}`);
    if (Date.now() - t0 > timeoutMs) throw new Error(`${what} n'a pas répondu en ${timeoutMs / 1000}s\n${proc?.log.slice(-2000) ?? ""}`);
    await wait(400);
  }
}

/** Lance un process en gardant son journal sous la main (pour le diagnostic). */
function launch(cmd, args, opts) {
  // ⚠ `detached` donne au process SON groupe : `npm run dev` lance Vite dans un
  // enfant, donc tuer npm seul laissait le port 5173 pris. On tue le GROUPE.
  const p = spawn(cmd, args, { ...opts, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  p.log = "";
  const keep = (d) => {
    p.log = (p.log + d).slice(-8000);
    if (process.env.RUN_VERBOSE) process.stdout.write(d);
  };
  p.stdout.on("data", keep);
  p.stderr.on("data", keep);
  return p;
}

const started = [];
async function ensureServers() {
  const needBack = !(await alive(`${API}/healthz`));
  const needFront = !(await alive(BASE));

  if (needBack) {
    const tmp = mkdtempSync(join(tmpdir(), "echoterra-e2e-"));
    const bin = join(tmp, "server");
    console.log("· compilation du backend…");
    const build = spawnSync("go", ["-C", join(REPO, "backend"), "build", "-o", bin, "./cmd/server"], { encoding: "utf8" });
    if (build.status !== 0) throw new Error(`go build a échoué :\n${build.stderr || build.stdout}`);
    const db = process.env.ECHOTERRA_KEEP_DB ? "echoterra.db" : join(tmp, "e2e.db");
    const srv = launch(bin, [], {
      cwd: join(REPO, "backend"),
      env: { ...process.env, ECHOTERRA_DB: db, ECHOTERRA_ADDR: ":8080" },
    });
    started.push({ proc: srv, name: "backend" });
    const ms = await waitUp(`${API}/healthz`, "le backend", srv);
    console.log(`· backend :8080 prêt (${ms} ms, base ${db})`);
  } else {
    console.log("· backend :8080 déjà debout — réutilisé");
  }

  if (needFront) {
    const vite = launch("npm", ["run", "dev", "--", "--port", "5173", "--strictPort"], {
      cwd: FRONTEND,
      env: { ...process.env, BROWSER: "none" },
    });
    started.push({ proc: vite, name: "vite" });
    const ms = await waitUp(BASE, "Vite", vite);
    console.log(`· frontend :5173 prêt (${ms} ms)`);
  } else {
    console.log("· frontend :5173 déjà debout — réutilisé");
  }
}

function stopServers() {
  for (const { proc, name } of started) {
    if (proc.exitCode == null) {
      process.stdout.write(`· arrêt de ${name}\n`);
      try {
        process.kill(-proc.pid, "SIGTERM");
      } catch {
        proc.kill("SIGTERM");
      }
    }
  }
}

function runSuite(s) {
  return new Promise((done) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [join(TESTS, s.file)], {
      cwd: FRONTEND,
      stdio: "inherit",
      env: { ...process.env, PERF_BROWSER: BROWSER, PERF_BASE: BASE },
    });
    p.on("exit", (code) => done({ ok: code === 0, ms: Date.now() - t0 }));
  });
}

if (flags.has("--serve")) {
  process.env.RUN_VERBOSE ??= "1"; // on joue à la main : on veut voir les journaux
  process.env.ECHOTERRA_KEEP_DB = "1";
  await ensureServers();
  console.log(`\n▶ Echo Terra — ${BASE}  (API ${API})\nCtrl-C pour arrêter.`);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopServers(); process.exit(0); });
  await new Promise(() => {}); // on tient la main
}

let failed = 0;
try {
  if (suites.some((s) => s.servers)) await ensureServers();
  const results = [];
  for (const s of suites) {
    console.log(`\n━━ ${s.name} — ${s.about}`);
    const r = await runSuite(s);
    results.push({ ...s, ...r });
    if (!r.ok) failed++;
  }
  console.log(`\n${"═".repeat(52)}`);
  for (const r of results) console.log(`  ${r.ok ? "✅" : "❌"} ${r.name.padEnd(12)} ${(r.ms / 1000).toFixed(1)}s`);
  console.log(`${"═".repeat(52)}\n${results.length - failed}/${results.length} suites au vert`);
} catch (e) {
  console.error(`\n❌ ${e.message}`);
  failed = 1;
} finally {
  if (!flags.has("--keep")) stopServers();
  else if (started.length) console.log("· serveurs laissés debout (--keep)");
}
process.exit(failed ? 1 : 0);
