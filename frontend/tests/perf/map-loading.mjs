// Map loading performance test — checks that everything Phaser loads is optimized.
//
//   npm run test:perf          (from frontend/)
//
// Reuses running dev servers (backend :8080 + vite :5173) when present, otherwise
// starts both and stops them afterwards. Needs a Chromium: honours PERF_BROWSER
// (executable path), then the Playwright browsers dir, then the installed
// Chrome/Edge channel.
//
// What it enforces (BUDGETS below):
//   1. network  — total PNG payload bounded, and NO url downloaded twice
//                 (MapScene is the single loader of the shared unit sprites)
//   2. memory   — no raw 1024² source kept resident (iso-raw-*/town-raw freed,
//                 unit sprites downscaled), estimated texture memory bounded
//   3. timing   — atlas + tile layer pre-baked in background (pre-warm), opening
//                 and re-opening the Map tab bounded
//   4. survival — tab switches keep the same Phaser instance, sleep the scenes,
//                 and trigger ZERO new asset downloads
//   5. display  — canvas backing store matches devicePixelRatio (no pixelation)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_DIR = path.resolve(FRONTEND_DIR, "..");
const APP_URL = process.env.PERF_APP_URL || "http://localhost:5173/";
const API_HEALTH = "http://localhost:8080/healthz";

const BUDGETS = {
  totalPngMB: 16, // total PNG payload of a session (Phaser map set + DOM: Home town, backgrounds)
  duplicateDownloads: 0, // same PNG URL fetched more than once (see allow-list below)
  prewarmMs: 20000, // enter game -> pillar atlas baked (background, incl. downloads)
  firstOpenMs: 1500, // setTab("map") -> scene active (pre-warmed, should be ~20ms)
  reopenMs: 750, // back to the map after visiting another tab
  reopenNewDownloads: 0, // PNGs re-downloaded when re-opening the Map tab
  maxUnitTextureDim: 512, // unit sprites (char-*/mob-*) must be downscaled
  maxTextureDim: 4096, // hard GPU-safety bound for any resident texture
  estTextureMB: 40, // sum of w*h*4 over resident textures (DPR 3 worst case)
  canvasDprTolerancePx: 3, // |canvas.width - cssWidth * dpr|
};

// Files legitimately fetched by TWO consumers: the Home tab's DOM town uses these
// isotiles as <img>/CSS while MapScene loads them for cube normalization. The dev
// server sends no cache headers so both fetches hit the network; in production the
// second is a cache hit. Any OTHER duplicate = a Phaser loader loading a file twice.
const DUPLICATE_ALLOWLIST = ["/assets/isotiles/grass.png", "/assets/isotiles/stone.png"];

// ---------------------------------------------------------------------------

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗ FAIL"} ${name} — ${detail}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// evaluate-based polling instead of page.waitForFunction: once the DPR-sized WebGL
// canvas is visible, software-GL environments (headless CI without a GPU) starve
// Playwright's injected rAF poller — plain evaluates still get through.
const waitState = async (page, pred, timeoutMs, what) => {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await page.evaluate(pred)) return;
    if (Date.now() > end) throw new Error(`timeout (${timeoutMs}ms) waiting for ${what}`);
    await sleep(50);
  }
};
const up = async (url) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
};
const waitUp = async (url, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await up(url)) return true;
    await sleep(500);
  }
  return false;
};

const children = [];
const spawnServer = (cmd, args, opts) => {
  const child = spawn(cmd, args, { ...opts, stdio: "ignore", detached: process.platform !== "win32" });
  children.push(child);
  return child;
};
const stopServers = () => {
  for (const c of children) {
    try {
      process.platform === "win32" ? c.kill() : process.kill(-c.pid, "SIGTERM");
    } catch {}
  }
};

async function ensureServers() {
  if (!(await up(API_HEALTH))) {
    console.log("· starting backend (go run ./cmd/server)…");
    spawnServer("go", ["run", "./cmd/server"], {
      cwd: path.join(REPO_DIR, "backend"),
      env: { ...process.env, ECHOTERRA_DB: path.join(REPO_DIR, "backend", "perf-test.db") },
    });
    if (!(await waitUp(API_HEALTH, 120000))) throw new Error("backend did not come up on :8080");
  }
  if (!(await up(APP_URL))) {
    console.log("· starting frontend (vite)…");
    spawnServer(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev"], { cwd: FRONTEND_DIR });
    if (!(await waitUp(APP_URL, 60000))) throw new Error("frontend did not come up on :5173");
  }
}

function browserExecutable() {
  if (process.env.PERF_BROWSER) return { executablePath: process.env.PERF_BROWSER };
  const bundled = process.env.PLAYWRIGHT_BROWSERS_PATH
    ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium")
    : null;
  if (bundled && existsSync(bundled)) return { executablePath: bundled };
  return { channel: "chrome" }; // system Chrome (falls back below if absent)
}

async function launch() {
  const opt = browserExecutable();
  try {
    return await chromium.launch(opt);
  } catch (e) {
    if (opt.channel === "chrome") return await chromium.launch({ channel: "msedge" });
    throw e;
  }
}

// --- scenario ---------------------------------------------------------------

async function run() {
  await ensureServers();
  const browser = await launch();
  // Phone-like: 390×844 CSS at deviceScaleFactor 3 exercises the DPR path.
  const DPR = 3;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: DPR });

  const pngs = new Map(); // url -> { count, bytes }
  page.on("response", async (resp) => {
    const url = resp.url();
    if (!url.includes("/assets/") || !url.endsWith(".png") || resp.request().method() !== "GET") return;
    const entry = pngs.get(url) || { count: 0, bytes: 0 };
    entry.count++;
    entry.bytes = Number(resp.headers()["content-length"] || entry.bytes || 0);
    pngs.set(url, entry);
  });
  page.on("pageerror", (e) => check("no page error", false, e.message));

  await page.goto(APP_URL);
  await waitState(page, () => !!window.__eg?.store, 30000, "app store (dev build with window.__eg)");

  // Enter a fresh game, landing on the Home tab (the map pre-warms hidden).
  const t0 = Date.now();
  await page.evaluate(async () => {
    const s = window.__eg.store;
    await s.getState().newGame();
    s.setState({ appScreen: "game", tab: "home" });
  });

  // 3) pre-warm: atlas + tile layer baked in the background while on Home
  await waitState(page, () => !!window.__phaser?.textures.exists("pillar-atlas"), BUDGETS.prewarmMs, "pillar atlas");
  const prewarmMs = Date.now() - t0;
  check("pre-warm (enter game -> atlas baked, hidden)", prewarmMs <= BUDGETS.prewarmMs, `${prewarmMs}ms`);
  await sleep(1500); // let any stragglers (loader, shrink passes) settle
  await page.evaluate(() => (window.__phaser.__tag = "original"));

  // 5) display resolution: canvas backing store must be DPR× its CSS size
  const res = await page.evaluate(() => {
    const c = document.querySelector(".map-host canvas");
    const r = c.getBoundingClientRect();
    return { w: c.width, cssW: r.width, dpr: window.devicePixelRatio };
  });
  const wantW = res.cssW * Math.min(res.dpr, 3);
  check(
    "canvas at native device resolution",
    Math.abs(res.w - wantW) <= BUDGETS.canvasDprTolerancePx,
    `canvas ${res.w}px for ${res.cssW}css×dpr${res.dpr} (want ~${Math.round(wantW)})`,
  );

  // 2) texture hygiene: raw sources freed, unit sprites downscaled, memory bounded
  const tex = await page.evaluate(() => {
    const out = [];
    const list = window.__phaser.textures.list;
    for (const key in list) {
      if (key.startsWith("__")) continue;
      const src = list[key].getSourceImage?.();
      if (src && src.width) out.push({ key, w: src.width, h: src.height });
    }
    return out;
  });
  const raws = tex.filter((t) => t.key.startsWith("iso-raw-") || t.key === "town-raw");
  check("raw 1024² sources freed after normalization", raws.length === 0, raws.map((t) => t.key).join(",") || "none resident");
  const units = tex.filter((t) => t.key.startsWith("char-") || t.key.startsWith("mob-"));
  const fatUnits = units.filter((t) => Math.max(t.w, t.h) > BUDGETS.maxUnitTextureDim);
  check(
    `unit sprites downscaled to ≤${BUDGETS.maxUnitTextureDim}px`,
    units.length > 0 && fatUnits.length === 0,
    fatUnits.length ? fatUnits.map((t) => `${t.key}:${t.w}`).join(",") : `${units.length} sprites, max ${Math.max(...units.map((t) => Math.max(t.w, t.h)))}px`,
  );
  const oversize = tex.filter((t) => Math.max(t.w, t.h) > BUDGETS.maxTextureDim);
  check(`no texture above ${BUDGETS.maxTextureDim}px`, oversize.length === 0, oversize.map((t) => `${t.key}:${t.w}×${t.h}`).join(",") || "ok");
  const estMB = tex.reduce((s, t) => s + t.w * t.h * 4, 0) / (1024 * 1024);
  check(`estimated texture memory ≤${BUDGETS.estTextureMB}MiB`, estMB <= BUDGETS.estTextureMB, `${estMB.toFixed(1)}MiB across ${tex.length} textures`);

  // 1) network: bounded payload, zero duplicate downloads
  const totalMB = [...pngs.values()].reduce((s, e) => s + e.bytes, 0) / (1024 * 1024);
  const dups = [...pngs.entries()].filter(
    ([url, e]) => e.count > 1 && !DUPLICATE_ALLOWLIST.some((a) => url.endsWith(a)),
  );
  check(`PNG payload ≤${BUDGETS.totalPngMB}MB`, totalMB <= BUDGETS.totalPngMB, `${totalMB.toFixed(2)}MB over ${pngs.size} files`);
  check(
    "no PNG downloaded twice",
    dups.length <= BUDGETS.duplicateDownloads,
    dups.length ? dups.map(([u, e]) => `${u.split("/").pop()}×${e.count}`).join(", ") : "all unique",
  );

  // 3) opening the Map tab must be near-instant (pre-warmed)
  const t1 = Date.now();
  await page.evaluate(() => window.__eg.store.getState().setTab("map"));
  await waitState(
    page,
    () => window.__phaser.scene.isActive("map") && !window.__phaser.scene.isSleeping("map"),
    BUDGETS.firstOpenMs + 5000,
    "map scene awake (first open)",
  );
  const firstOpenMs = Date.now() - t1;
  check(`first Map open ≤${BUDGETS.firstOpenMs}ms`, firstOpenMs <= BUDGETS.firstOpenMs, `${firstOpenMs}ms`);

  // 4) tab switch away: same instance, scenes asleep, and polls don't wake them
  await page.evaluate(() => window.__eg.store.getState().setTab("stock"));
  await sleep(300);
  await page.evaluate(() => window.__eg.store.getState().refreshGame());
  await sleep(500);
  const hidden = await page.evaluate(() => ({
    same: window.__phaser.__tag === "original",
    asleep: window.__phaser.scene.isSleeping("map"),
  }));
  check("Phaser instance survives tab switch", hidden.same, hidden.same ? "same game object" : "instance was recreated!");
  check("map scene sleeps while hidden (poll-proof)", hidden.asleep, hidden.asleep ? "asleep" : "still rendering hidden");

  // 4) re-open: fast and with zero new downloads
  const downloadsBefore = [...pngs.values()].reduce((s, e) => s + e.count, 0);
  const t2 = Date.now();
  await page.evaluate(() => window.__eg.store.getState().setTab("map"));
  await waitState(
    page,
    () => window.__phaser.scene.isActive("map") && !window.__phaser.scene.isSleeping("map"),
    BUDGETS.reopenMs + 5000,
    "map scene awake (re-open)",
  );
  const reopenMs = Date.now() - t2;
  await sleep(500);
  const downloadsAfter = [...pngs.values()].reduce((s, e) => s + e.count, 0);
  check(`Map re-open ≤${BUDGETS.reopenMs}ms`, reopenMs <= BUDGETS.reopenMs, `${reopenMs}ms`);
  check("re-open triggers no downloads", downloadsAfter - downloadsBefore <= BUDGETS.reopenNewDownloads, `${downloadsAfter - downloadsBefore} new`);

  // Texture inventory (informational)
  console.log("\n  Resident textures (largest first):");
  tex
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, 12)
    .forEach((t) => console.log(`    ${t.key.padEnd(18)} ${String(t.w).padStart(4)}×${String(t.h).padEnd(4)} ~${((t.w * t.h * 4) / (1024 * 1024)).toFixed(2)}MiB`));

  await browser.close();
}

console.log("Echo Terra — map loading perf test\n");
try {
  await run();
} catch (e) {
  check("scenario completed", false, e.message);
} finally {
  stopServers();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? "PASS" : "FAIL"} — ${results.length - failed.length}/${results.length} checks ok`);
process.exit(failed.length === 0 ? 0 : 1);
