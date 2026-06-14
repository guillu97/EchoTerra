/**
 * EchoTerra — Perchance asset generator
 *
 * Usage (from the scripts/ folder):
 *   npm install                    # installs playwright
 *   npx playwright install chromium  # downloads the browser
 *   node generate-assets.mjs       # generates all missing assets
 *   node generate-assets.mjs --id building-gate  # generate one specific asset
 *   node generate-assets.mjs --dry-run           # list what would be generated
 *
 * Output: frontend/public/assets/{category}/{filename}.png
 * Already-generated files are skipped automatically (delete to regenerate).
 */

import { chromium } from "playwright";
import { mkdirSync, existsSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ASSETS, STYLE } from "./asset-manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_BASE = join(__dirname, "../frontend/public/assets");
const PERCHANCE_URL = "https://perchance.org/ai-text-to-image-generator";

// ── CLI flags ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ONLY_ID = args.includes("--id") ? args[args.indexOf("--id") + 1] : null;
const HEADLESS = !args.includes("--visible");  // headless by default; use --visible to see the browser

// ── Helpers ───────────────────────────────────────────────────────────────────

function outputPath(asset) {
  return join(OUTPUT_BASE, asset.category, asset.filename);
}

function fullPrompt(asset) {
  return `${STYLE}, ${asset.prompt}`;
}

function ensureDir(asset) {
  mkdirSync(join(OUTPUT_BASE, asset.category), { recursive: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Perchance automation ───────────────────────────────────────────────────────

/**
 * Find the prompt input on the Perchance page.
 * The generator might be directly on the page or inside an iframe.
 */
async function findPromptInput(page) {
  // Try direct selectors first
  const directSelectors = [
    'textarea[placeholder*="prompt" i]',
    'textarea[placeholder*="describe" i]',
    'input[placeholder*="prompt" i]',
    'textarea#prompt',
    'textarea.prompt',
    '.prompt-input textarea',
    '.text-input textarea',
    'textarea',
  ];

  for (const sel of directSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 })) return { el, frame: null };
    } catch {}
  }

  // Try inside iframes
  for (const frame of page.frames()) {
    for (const sel of directSelectors) {
      try {
        const el = frame.locator(sel).first();
        if (await el.isVisible({ timeout: 1000 })) return { el, frame };
      } catch {}
    }
  }

  return null;
}

/**
 * Find the generate button.
 */
async function findGenerateButton(page, frame) {
  const context = frame || page;
  const selectors = [
    'button:has-text("Generate")',
    'button:has-text("generate")',
    'button[aria-label*="generate" i]',
    'button.generate',
    'button.generate-btn',
    'input[type="button"][value*="generate" i]',
    'button:has-text("Create")',
    'button:has-text("Make")',
  ];

  for (const sel of selectors) {
    try {
      const el = context.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 })) return el;
    } catch {}
  }
  return null;
}

/**
 * Wait for and extract the generated image.
 * Returns a Buffer of the PNG data.
 */
async function waitForImage(page, frame) {
  const context = frame || page;
  const TIMEOUT = 120_000; // 2 min max

  // Selectors for the result image
  const imgSelectors = [
    "img.result-image",
    "img.generated-image",
    "img.output-image",
    ".image-result img",
    ".result img",
    ".output img",
    'img[alt*="generated" i]',
    'img[alt*="result" i]',
    // Perchance might use a canvas
    "canvas.result-canvas",
    "canvas.output",
    "canvas",
    // Generic: the first big img that appears after generation
    "img",
  ];

  const start = Date.now();

  while (Date.now() - start < TIMEOUT) {
    for (const sel of imgSelectors) {
      try {
        const els = context.locator(sel);
        const count = await els.count();
        for (let i = 0; i < count; i++) {
          const el = els.nth(i);
          const visible = await el.isVisible({ timeout: 500 });
          if (!visible) continue;

          const tag = await el.evaluate((n) => n.tagName.toLowerCase());
          if (tag === "canvas") {
            // Export canvas as PNG blob
            const data = await el.evaluate((canvas) => {
              return new Promise((resolve) => {
                canvas.toBlob((blob) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result);
                  reader.readAsDataURL(blob);
                }, "image/png");
              });
            });
            const base64 = data.replace(/^data:image\/png;base64,/, "");
            return Buffer.from(base64, "base64");
          }

          const src = await el.getAttribute("src");
          if (!src || src.startsWith("data:image/gif") || src.includes("spinner") || src.includes("loading"))
            continue;

          if (src.startsWith("data:image")) {
            const base64 = src.replace(/^data:image\/\w+;base64,/, "");
            return Buffer.from(base64, "base64");
          }

          if (src.startsWith("http") || src.startsWith("/")) {
            // Fetch the image data
            const resp = await (frame || page).evaluate(async (url) => {
              const r = await fetch(url);
              const buf = await r.arrayBuffer();
              return Array.from(new Uint8Array(buf));
            }, src.startsWith("/") ? new URL(src, PERCHANCE_URL).href : src);
            return Buffer.from(resp);
          }
        }
      } catch {}
    }

    await sleep(2000);
  }

  throw new Error("Timed out waiting for generated image");
}

/**
 * Generate one asset using Perchance.
 */
async function generateAsset(page, asset) {
  const prompt = fullPrompt(asset);
  console.log(`  Prompt: ${prompt.slice(0, 80)}...`);

  // Navigate fresh for each asset to avoid state issues
  await page.goto(PERCHANCE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // Let any JS initialize
  await sleep(3000);

  const inputResult = await findPromptInput(page);
  if (!inputResult) {
    // Dump what we see to help debugging
    const bodyText = await page.locator("body").textContent().catch(() => "");
    console.error(`  ✗ Could not find prompt input. Page text preview: ${bodyText.slice(0, 200)}`);
    throw new Error("Prompt input not found — check --visible mode to inspect the page");
  }

  const { el: input, frame } = inputResult;
  await input.fill("");
  await input.type(prompt, { delay: 20 });
  await sleep(500);

  const btn = await findGenerateButton(page, frame);
  if (!btn) throw new Error("Generate button not found");

  await btn.click();
  console.log(`  ⏳ Generating (may take 30–90s)…`);

  const imageBuffer = await waitForImage(page, frame);
  return imageBuffer;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const toGenerate = ASSETS.filter((a) => {
    if (ONLY_ID && a.id !== ONLY_ID) return false;
    return true;
  });

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

  console.log(`\n🎨 EchoTerra asset generator (Perchance)\n`);
  console.log(`Generating ${missing.length} missing assets…\n`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  let success = 0;
  let failed = 0;

  for (let i = 0; i < missing.length; i++) {
    const asset = missing[i];
    ensureDir(asset);
    console.log(`[${i + 1}/${missing.length}] ${asset.id}`);

    try {
      const data = await generateAsset(page, asset);
      writeFileSync(outputPath(asset), data);
      console.log(`  ✓ Saved → ${outputPath(asset)}`);
      success++;
    } catch (e) {
      console.error(`  ✗ Failed: ${e.message}`);
      failed++;
    }

    // Polite delay between generations to avoid rate-limiting
    if (i < missing.length - 1) {
      console.log(`  ⏸  Pause 5s…`);
      await sleep(5000);
    }
  }

  await browser.close();

  console.log(`\n✅ Done: ${success} generated, ${failed} failed.`);
  if (failed > 0) {
    console.log(`Re-run to retry failed assets (they were not saved, so they'll be attempted again).`);
  }
  if (success > 0) {
    console.log(`\nNext: commit the generated assets and push them to the repo.`);
    console.log(`  cd .. && git add frontend/public/assets && git commit -m "assets: generated via Perchance"`);
  }
}

main().catch((e) => {
  console.error("\n💥 Fatal error:", e.message);
  process.exit(1);
});
