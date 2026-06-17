/**
 * EchoTerra — AI Horde asset generator
 *
 * Generates the game's placeholder art via the AI Horde (https://aihorde.net),
 * a free, community-powered Stable Diffusion cluster. No browser, no Perchance,
 * no Cloudflare/Turnstile — just a REST API.
 *
 * Usage (from the scripts/ folder):
 *   npm install                         # (no deps needed anymore, but harmless)
 *   node generate-assets.mjs            # generate all missing assets
 *   node generate-assets.mjs --id building-gate   # generate one specific asset
 *   node generate-assets.mjs --dry-run            # list what would be generated
 *
 * API key:
 *   Uses the anonymous key "0000000000" by default (free, lowest priority — can be
 *   slow). Register a free key at https://aihorde.net for much faster queueing and
 *   export it as HORDE_API_KEY for a big speed-up.
 *
 * Output: frontend/public/assets/{category}/{filename}.png
 * Already-generated files are skipped automatically (delete to regenerate).
 */

import { mkdirSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { ASSETS, STYLE } from "./asset-manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_BASE = join(__dirname, "../frontend/public/assets");

const API = "https://stablehorde.net/api/v2";
const API_KEY = process.env.HORDE_API_KEY || "0000000000"; // anonymous = free
const CLIENT_AGENT = "echoterra-assetgen:1.1:github.com/guillu97/EchoTerra";
const MODEL = process.env.HORDE_MODEL || "Dreamshaper"; // fast, well-staffed general model

// ── CLI flags ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ONLY_ID = args.includes("--id") ? args[args.indexOf("--id") + 1] : null;

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outputPath = (a) => join(OUTPUT_BASE, a.category, a.filename);
const fullPrompt = (a) => `${STYLE}, ${a.prompt}`;
const ensureDir = (a) => mkdirSync(join(OUTPUT_BASE, a.category), { recursive: true });

async function jsonFetch(url, opts) {
  const r = await fetch(url, opts);
  let body;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  return { status: r.status, ok: r.ok, body };
}

// ── AI Horde generation ─────────────────────────────────────────────────────────

/**
 * Submit one generation request and poll until the image is ready.
 * Returns a Buffer of the image bytes (usually WEBP or PNG).
 */
async function generateAsset(asset) {
  const prompt = fullPrompt(asset);
  console.log(`  Prompt: ${prompt.slice(0, 80)}…`);

  const submit = await jsonFetch(`${API}/generate/async`, {
    method: "POST",
    headers: {
      apikey: API_KEY,
      "content-type": "application/json",
      "Client-Agent": CLIENT_AGENT,
    },
    body: JSON.stringify({
      prompt,
      params: {
        sampler_name: "k_euler_a",
        cfg_scale: 7,
        width: 512,
        height: 512,
        steps: 25,
        n: 1,
      },
      models: [MODEL],
      nsfw: false,
      censor_nsfw: true,
      r2: true,
    }),
  });

  if (!submit.ok || !submit.body?.id) {
    const msg = submit.body?.message || JSON.stringify(submit.body);
    throw new Error(`submit failed (${submit.status}): ${msg}`);
  }
  const id = submit.body.id;

  // Poll /check (cheap) until done. Anonymous (free) priority can sit 15-20 min
  // deep in the global queue; a registered HORDE_API_KEY drops this to ~1-2 min.
  const TIMEOUT = 30 * 60 * 1000;
  const start = Date.now();
  let lastLog = 0;
  while (Date.now() - start < TIMEOUT) {
    await sleep(8000);
    const chk = await jsonFetch(`${API}/generate/check/${id}`);
    if (!chk.ok) {
      // transient — keep polling unless the request is clearly gone
      if (chk.status === 404) throw new Error("request expired/faulted on the horde");
      continue;
    }
    const c = chk.body;
    const now = Date.now();
    if (now - lastLog > 12000) {
      console.log(
        `  ⏳ queue=${c.queue_position} wait~${c.wait_time}s ` +
          `processing=${c.processing} finished=${c.finished}`
      );
      lastLog = now;
    }
    if (c.done) break;
    if (c.faulted) throw new Error("generation faulted on the horde");
  }

  const status = await jsonFetch(`${API}/generate/status/${id}`);
  const gen = status.body?.generations?.[0];
  if (!gen?.img) throw new Error("no image in status response (timed out?)");

  const imgResp = await fetch(gen.img); // r2 presigned URL
  if (!imgResp.ok) throw new Error(`image download failed (${imgResp.status})`);
  const webp = Buffer.from(await imgResp.arrayBuffer());
  // AI Horde returns WebP — convert to real PNG so the .png files are truthful.
  const png = await sharp(webp).png().toBuffer();
  console.log(`  ✓ ${png.length} bytes (PNG) via worker "${gen.worker_name || "?"}" (${gen.model})`);
  return png;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const toGenerate = ASSETS.filter((a) => (ONLY_ID ? a.id === ONLY_ID : true));

  if (DRY_RUN) {
    console.log(`\nDry run — ${toGenerate.length} assets would be generated:\n`);
    for (const a of toGenerate) {
      const exists = existsSync(outputPath(a));
      console.log(`  [${exists ? "✓ exists" : "missing"}] ${a.id} → ${a.category}/${a.filename}`);
      if (!exists) console.log(`    Prompt: ${fullPrompt(a).slice(0, 90)}…`);
    }
    console.log(`\nStyle prefix: "${STYLE}"\n`);
    return;
  }

  const missing = toGenerate.filter((a) => !existsSync(outputPath(a)));
  if (missing.length === 0) {
    console.log("✓ All assets already generated.");
    return;
  }

  console.log(`\n🎨 EchoTerra asset generator (AI Horde · model "${MODEL}")\n`);
  console.log(
    `Generating ${missing.length} missing assets` +
      (API_KEY === "0000000000" ? " — anonymous key (free, may be slow)…\n" : "…\n")
  );

  let success = 0;
  let failed = 0;

  for (let i = 0; i < missing.length; i++) {
    const asset = missing[i];
    ensureDir(asset);
    console.log(`[${i + 1}/${missing.length}] ${asset.id}`);
    try {
      const data = await generateAsset(asset);
      writeFileSync(outputPath(asset), data);
      console.log(`  ✓ Saved → ${outputPath(asset)}`);
      success++;
    } catch (e) {
      console.error(`  ✗ Failed: ${e.message}`);
      failed++;
    }
    if (i < missing.length - 1) await sleep(2000);
  }

  console.log(`\n✅ Done: ${success} generated, ${failed} failed.`);
  if (failed > 0) console.log(`Re-run to retry failed assets (they were not saved).`);
  if (success > 0) {
    console.log(`\nNext: commit the generated assets.`);
    console.log(`  cd .. && git add frontend/public/assets && git commit -m "assets: generated via AI Horde"`);
  }
}

main().catch((e) => {
  console.error("\n💥 Fatal error:", e.message);
  process.exit(1);
});
