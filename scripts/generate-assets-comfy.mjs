/**
 * EchoTerra — local ComfyUI asset generator
 *
 * Generates the game's placeholder art via a LOCAL ComfyUI instance
 * (http://127.0.0.1:8188). No cloud, no queue, no bot-detection — your own GPU.
 * Reuses the exact same manifest/prompts as the AI Horde generator so the two
 * are interchangeable.
 *
 * Prereqs:
 *   - ComfyUI running (D:\ComfyUI_windows_portable\run_nvidia_gpu.bat)
 *   - A checkpoint in ComfyUI/models/checkpoints (default: dreamshaper_8.safetensors)
 *
 * Usage (from the scripts/ folder):
 *   node generate-assets-comfy.mjs               # generate all missing assets
 *   node generate-assets-comfy.mjs --id building-gate   # one specific asset
 *   node generate-assets-comfy.mjs --force       # regenerate even if the file exists
 *   node generate-assets-comfy.mjs --dry-run     # list what would be generated
 *
 * Env overrides:
 *   COMFY_HOST     host:port           (default 127.0.0.1:8188)
 *   COMFY_CKPT     checkpoint filename (default dreamshaper_8.safetensors)
 *   COMFY_STEPS    sampler steps       (default 25)
 *   COMFY_CFG      cfg scale           (default 7)
 *   COMFY_SAMPLER  sampler_name        (default euler_ancestral)
 *   COMFY_SIZE     square px           (default 512)
 *
 * Output: frontend/public/assets/{category}/{filename}.png
 */

import { mkdirSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { ASSETS, STYLE, STYLE_NEAR } from "./asset-manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_BASE = join(__dirname, "../frontend/public/assets");

const HOST = process.env.COMFY_HOST || "127.0.0.1:8188";
const BASE = `http://${HOST}`;

// Which model pipeline to drive:
//   "zimage"   = local Z-Image-Turbo (image_z_image_turbo.json) — fast, default
//   "ideogram" = local Ideogram v4 (image_ideogram4_t2i.json) — structured-JSON prompts
//                with bbox layout control; slower (~3 min/image) but composes scenes precisely
//   "sd15"     = DreamShaper 8 fallback
const BACKEND = (process.env.COMFY_BACKEND || "zimage").toLowerCase();

// SD1.5 (DreamShaper) checkpoint.
const CKPT = process.env.COMFY_CKPT || "dreamshaper_8.safetensors";

// Z-Image-Turbo model files (must live in their respective models/ subfolders).
const Z_UNET = process.env.COMFY_ZUNET || "z_image_turbo_bf16.safetensors";
const Z_CLIP = process.env.COMFY_ZCLIP || "qwen_3_4b.safetensors";
const Z_VAE = process.env.COMFY_ZVAE || "ae.safetensors";

// Ideogram v4 model files. The saved workflow drives BOTH guider slots from the
// unconditional UNET, so only that one diffusion model is needed (fits 24 GB RAM).
const IDEO_UNET = process.env.COMFY_IDEO_UNET || "ideogram4_unconditional_fp8_scaled.safetensors";
const IDEO_CLIP = process.env.COMFY_IDEO_CLIP || "qwen3vl_8b_fp8_scaled.safetensors";
const IDEO_VAE = process.env.COMFY_IDEO_VAE || "flux2-vae.safetensors";
const IDEO_STEPS = Number(process.env.COMFY_IDEO_STEPS || 20); // Default preset
const IDEO_MU = Number(process.env.COMFY_IDEO_MU || 0.0);
const IDEO_STD = Number(process.env.COMFY_IDEO_STD || 1.75);

// Sampler defaults differ per backend; an env var always wins.
const STEPS = Number(process.env.COMFY_STEPS || (BACKEND === "zimage" ? 8 : 25));
const CFG = Number(process.env.COMFY_CFG || (BACKEND === "zimage" ? 1 : 7));
const SAMPLER =
  process.env.COMFY_SAMPLER || (BACKEND === "zimage" ? "res_multistep" : "euler_ancestral");
const SCHEDULER = process.env.COMFY_SCHEDULER || (BACKEND === "zimage" ? "simple" : "normal");
const SIZE = Number(process.env.COMFY_SIZE || (BACKEND === "sd15" ? 512 : 1024));
const MODEL_LABEL =
  BACKEND === "ideogram"
    ? `Ideogram v4 (${IDEO_UNET})`
    : BACKEND === "zimage"
    ? `Z-Image-Turbo (${Z_UNET})`
    : CKPT;

// Round a dimension to a multiple of 16 (Ideogram's latent/scheduler require it).
const round16 = (n) => Math.max(256, Math.round(n / 16) * 16);

const NEGATIVE =
  "blurry, low quality, low resolution, jpeg artifacts, watermark, signature, " +
  "text, ugly, deformed, extra limbs, bad anatomy, cropped, frame, border";

// ── CLI flags ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FORCE = args.includes("--force");
const REMBG = args.includes("--rembg"); // strip backgrounds (real alpha) after generating
// --id accepts one id or a comma-separated list (e.g. --id app-bg,town-island,tile-grass)
const ONLY_IDS = args.includes("--id")
  ? new Set((args[args.indexOf("--id") + 1] || "").split(",").map((s) => s.trim()).filter(Boolean))
  : null;
// --seed N pins a FIXED seed for every asset (style-cohesion experiments). Without it,
// each asset gets its own pseudo-random seed (more variety, less uniform lighting).
const FIXED_SEED = args.includes("--seed")
  ? Number(args[args.indexOf("--seed") + 1])
  : null;

// ComfyUI's embedded Python (where rembg is installed) — used for --rembg.
const PYTHON =
  process.env.COMFY_PYTHON || "D:\\ComfyUI_windows_portable\\python_embeded\\python.exe";

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outputPath = (a) => join(OUTPUT_BASE, a.category, a.filename);
// Per-asset prompt. `raw:true` sends a.prompt verbatim (e.g. a structured-JSON prompt
// for the Ideogram backend). Otherwise prepend the style prefix (a.style or global STYLE).
const fullPrompt = (a) => {
  if (a.raw) return a.prompt;
  // Buildings default to the cohesive NEAR look (bold outline, fixed light/angle);
  // an explicit a.style (e.g. STYLE_FAR for distant buildings) always wins.
  const fallback = a.category === "buildings" ? STYLE_NEAR : STYLE;
  const pre = a.style !== undefined ? a.style : fallback;
  return pre ? `${pre}, ${a.prompt}` : a.prompt;
};
const assetW = (a) => Number(a.width) || SIZE;
const assetH = (a) => Number(a.height) || SIZE;
const ensureDir = (a) => mkdirSync(join(OUTPUT_BASE, a.category), { recursive: true });

// A simple, deterministic-ish seed that still varies per asset + run.
let seedCounter = process.pid % 100000;
const nextSeed = () =>
  FIXED_SEED !== null
    ? FIXED_SEED
    : (seedCounter = (seedCounter * 1103515245 + 12345) & 0x7fffffff);

// ── ComfyUI prompt graphs (API format) ──────────────────────────────────────────
function buildWorkflow(prompt, seed, w, h) {
  if (BACKEND === "ideogram") return buildIdeogram(prompt, seed, w, h);
  if (BACKEND === "zimage") return buildZImage(prompt, seed, w, h);
  return buildSD15(prompt, seed, w, h);
}

// Ideogram v4, mirroring image_ideogram4_t2i.json (single-UNET variant: both guider
// slots use the unconditional model). Prompt is a structured-JSON caption (or NL).
// DualModelGuider (cfg 7) + CFGOverride (cfg 3 @ 0.7-1.0) + Ideogram4Scheduler.
function buildIdeogram(prompt, seed, w = SIZE, h = SIZE) {
  const W = round16(w);
  const H = round16(h);
  return {
    vae: { class_type: "VAELoader", inputs: { vae_name: IDEO_VAE } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: IDEO_CLIP, type: "ideogram4", device: "default" } },
    unet: { class_type: "UNETLoader", inputs: { unet_name: IDEO_UNET, weight_dtype: "default" } },
    unet_uncond: { class_type: "UNETLoader", inputs: { unet_name: IDEO_UNET, weight_dtype: "default" } },
    pos: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: prompt } },
    neg: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["pos", 0] } },
    cfgov: { class_type: "CFGOverride", inputs: { model: ["unet", 0], cfg: 3, start_percent: 0.7, end_percent: 1 } },
    guider: {
      class_type: "DualModelGuider",
      inputs: { model: ["cfgov", 0], positive: ["pos", 0], model_negative: ["unet_uncond", 0], negative: ["neg", 0], cfg: 7 },
    },
    latent: { class_type: "EmptyFlux2LatentImage", inputs: { width: W, height: H, batch_size: 1 } },
    sampler: { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    sched: { class_type: "Ideogram4Scheduler", inputs: { steps: IDEO_STEPS, width: W, height: H, mu: IDEO_MU, std: IDEO_STD } },
    noise: { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    ksampler: {
      class_type: "SamplerCustomAdvanced",
      inputs: { noise: ["noise", 0], guider: ["guider", 0], sampler: ["sampler", 0], sigmas: ["sched", 0], latent_image: ["latent", 0] },
    },
    decode: { class_type: "VAEDecode", inputs: { samples: ["ksampler", 0], vae: ["vae", 0] } },
    save: { class_type: "SaveImage", inputs: { filename_prefix: "echoterra", images: ["decode", 0] } },
  };
}

// Z-Image-Turbo, mirroring image_z_image_turbo.json:
// UNETLoader -> ModelSamplingAuraFlow -> KSampler (8 steps, cfg 1, res_multistep/simple)
// with a Qwen3 text encoder (CLIPLoader type "lumina2"), the negative branch zeroed out.
function buildZImage(prompt, seed, w = SIZE, h = SIZE) {
  return {
    "28": { class_type: "UNETLoader", inputs: { unet_name: Z_UNET, weight_dtype: "default" } },
    "11": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["28", 0], shift: 3 } },
    "30": { class_type: "CLIPLoader", inputs: { clip_name: Z_CLIP, type: "lumina2", device: "default" } },
    "27": { class_type: "CLIPTextEncode", inputs: { clip: ["30", 0], text: prompt } },
    "33": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["27", 0] } },
    "29": { class_type: "VAELoader", inputs: { vae_name: Z_VAE } },
    "13": { class_type: "EmptySD3LatentImage", inputs: { width: w, height: h, batch_size: 1 } },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: STEPS,
        cfg: CFG,
        sampler_name: SAMPLER,
        scheduler: SCHEDULER,
        denoise: 1,
        model: ["11", 0],
        positive: ["27", 0],
        negative: ["33", 0],
        latent_image: ["13", 0],
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["29", 0] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "echoterra", images: ["8", 0] } },
  };
}

// Minimal SD1.5 txt2img: checkpoint -> CLIP encode x2 -> empty latent -> KSampler
// -> VAE decode -> SaveImage.
function buildSD15(prompt, seed, w = SIZE, h = SIZE) {
  return {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CKPT } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: NEGATIVE, clip: ["4", 1] } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: w, height: h, batch_size: 1 } },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: STEPS,
        cfg: CFG,
        sampler_name: SAMPLER,
        scheduler: SCHEDULER,
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "echoterra", images: ["8", 0] } },
  };
}

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

async function waitForServer() {
  try {
    const r = await fetch(`${BASE}/system_stats`);
    return r.ok;
  } catch {
    return false;
  }
}

// ── Generation ──────────────────────────────────────────────────────────────────
async function generateAsset(asset) {
  const prompt = fullPrompt(asset);
  const seed = nextSeed();
  const w = assetW(asset);
  const h = assetH(asset);
  console.log(`  Prompt: ${prompt.slice(0, 80)}… (${w}x${h}, seed ${seed})`);

  const submit = await jsonFetch(`${BASE}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: buildWorkflow(prompt, seed, w, h) }),
  });
  if (!submit.ok || !submit.body?.prompt_id) {
    const msg = submit.body?.error
      ? JSON.stringify(submit.body.error)
      : JSON.stringify(submit.body);
    throw new Error(`submit failed (${submit.status}): ${msg}`);
  }
  const promptId = submit.body.prompt_id;

  // Poll /history until this prompt has outputs. Ideogram is slow (~3 min) with heavy
  // model offload on 8 GB VRAM, so allow more time for it.
  const TIMEOUT = (BACKEND === "ideogram" ? 15 : 5) * 60 * 1000;
  const start = Date.now();
  let outputs = null;
  while (Date.now() - start < TIMEOUT) {
    await sleep(1500);
    const hist = await jsonFetch(`${BASE}/history/${promptId}`);
    const entry = hist.body?.[promptId];
    if (entry?.status?.status_str === "error") {
      throw new Error("generation errored on the ComfyUI server (check its console)");
    }
    if (entry?.outputs) {
      outputs = entry.outputs;
      break;
    }
  }
  if (!outputs) throw new Error("timed out waiting for ComfyUI");

  // Find the first SaveImage output image.
  let img = null;
  for (const nodeId of Object.keys(outputs)) {
    const imgs = outputs[nodeId]?.images;
    if (imgs && imgs.length) {
      img = imgs[0];
      break;
    }
  }
  if (!img) throw new Error("no image in ComfyUI output");

  const q = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder || "",
    type: img.type || "output",
  });
  const imgResp = await fetch(`${BASE}/view?${q}`);
  if (!imgResp.ok) throw new Error(`image fetch failed (${imgResp.status})`);
  // ComfyUI's SaveImage already writes a real PNG — store the bytes as-is.
  const png = Buffer.from(await imgResp.arrayBuffer());
  console.log(`  ✓ ${png.length} bytes (PNG)`);
  return png;
}

// ── Background removal (real alpha) ──────────────────────────────────────────────
function runRembg(paths) {
  const script = join(__dirname, "remove_bg.py");
  console.log(`\n✂️  Removing backgrounds (rembg) on ${paths.length} file(s)…`);
  const r = spawnSync(PYTHON, [script, ...paths], { stdio: "inherit" });
  if (r.error) {
    console.error(`  ✗ rembg step failed to launch: ${r.error.message}`);
    console.error(`    Run manually: "${PYTHON}" "${script}"`);
  } else if (r.status !== 0) {
    console.error(`  ✗ rembg exited with code ${r.status}`);
  }
}

// ── Catalog + PNG metadata (post-generation) ─────────────────────────────────────
// Rebuild the searchable catalog and embed tEXt metadata so assets stay findable
// (by title / tags / category) from any later session.
function buildCatalogAndMeta() {
  console.log(`\n🗂  Building asset catalog + embedding PNG metadata…`);
  const cat = spawnSync(process.execPath, [join(__dirname, "build-catalog.mjs")], {
    stdio: "inherit",
  });
  if (cat.status !== 0) {
    console.error(`  ✗ catalog build failed (skipping metadata embed)`);
    return;
  }
  spawnSync(PYTHON, [join(__dirname, "embed_png_meta.py")], { stdio: "inherit" });
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const toGenerate = ASSETS.filter((a) => (ONLY_IDS ? ONLY_IDS.has(a.id) : true));

  if (DRY_RUN) {
    console.log(`\nDry run — ${toGenerate.length} assets considered:\n`);
    for (const a of toGenerate) {
      const exists = existsSync(outputPath(a));
      console.log(`  [${exists ? "✓ exists" : "missing"}] ${a.id} → ${a.category}/${a.filename}`);
      if (!exists) console.log(`    Prompt: ${fullPrompt(a).slice(0, 90)}…`);
    }
    console.log(`\nServer: ${BASE} · ${MODEL_LABEL} · ${SIZE}x${SIZE} · ${STEPS} steps · cfg ${CFG}\n`);
    return;
  }

  if (!(await waitForServer())) {
    console.error(
      `\n💥 ComfyUI not reachable at ${BASE}.\n` +
        `   Start it first: D:\\ComfyUI_windows_portable\\run_nvidia_gpu.bat\n`
    );
    process.exit(1);
  }

  const missing = toGenerate.filter((a) => FORCE || !existsSync(outputPath(a)));
  if (missing.length === 0) {
    console.log("✓ All assets already generated (use --force to regenerate).");
    return;
  }

  console.log(`\n🎨 EchoTerra asset generator (local ComfyUI · ${MODEL_LABEL})\n`);
  console.log(`Generating ${missing.length} assets on ${BASE}…\n`);

  let success = 0;
  let failed = 0;
  const toStrip = []; // freshly-generated files eligible for background removal
  for (let i = 0; i < missing.length; i++) {
    const asset = missing[i];
    ensureDir(asset);
    console.log(`[${i + 1}/${missing.length}] ${asset.id}`);
    try {
      const data = await generateAsset(asset);
      const out = outputPath(asset);
      writeFileSync(out, data);
      console.log(`  ✓ Saved → ${out}`);
      if (!asset.keepBackground) toStrip.push(out); // backgrounds/tiles stay opaque
      success++;
    } catch (e) {
      console.error(`  ✗ Failed: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n✅ Done: ${success} generated, ${failed} failed.`);
  if (REMBG && toStrip.length) runRembg(toStrip);
  if (success > 0) buildCatalogAndMeta();
  if (success > 0) {
    console.log(`\nNext: commit the generated assets.`);
    console.log(`  cd .. && git add frontend/public/assets && git commit -m "assets: generated via ComfyUI"`);
  }
}

main().catch((e) => {
  console.error("\n💥 Fatal error:", e.message);
  process.exit(1);
});
