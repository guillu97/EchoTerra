// LA PASTILLE DE VAGUE DOIT SE LIRE — y compris quand la ville est en danger.
//
// Elle ne se lisait pas : `.chip.wave .wave-dmg` était `color: var(--red)` (#c0392b)
// posé SUR le dégradé rouge du chip, qui finit exactement sur --red. Contraste ~1,3
// mesuré, c'est-à-dire un chiffre invisible ; et `.chip.wave.fatal { color: var(--red) }`
// faisait le même coup au chip ENTIER — minuteur compris — au moment précis où il compte
// le plus (rapporté en jeu : « −0/16 en rouge sur rouge sans savoir ce que c'est »).
//
// Ce test MESURE ce que le navigateur peint, il ne relit pas la feuille de style : il
// rend le vrai app-shell.css sur le vrai balisage, capture les pixels, et calcule le
// rapport de contraste entre l'encre et le fond (percentiles 2/98 de la luminance, pour
// ignorer l'antialiasing). Une règle CSS qui redeviendrait rouge sur rouge le fait
// échouer, quelle que soit la façon dont elle est écrite.
//
//   PERF_BROWSER=/opt/pw-browsers/chromium node tests/wave-chip.mjs
//
// Pas de serveur de dev requis : la pastille est du CSS pur sur du balisage statique.

import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../src/app-shell.css", import.meta.url), "utf8");
// AA de la WCAG pour du texte normal. La pastille est petite ET sur un téléphone,
// donc on ne se contente pas du seuil « gros texte » (3:1).
// ⚠ le MINUTEUR ne passait qu'à 4,54 sur le haut clair du dégradé (--red-hi ne donne
// que 3:1 au blanc) : c'est l'ombre portée de `.chip.wave` qui l'assoit à 7. Si ce
// chiffre redescend, le correctif est d'assombrir le rouge ou de rendre l'ombre,
// JAMAIS d'abaisser ce seuil.
const MIN_CONTRAST = 4.5;

// Le balisage EXACT de TopBar.tsx (chip wave + badge de dégâts), dans ses deux états.
const page_html = `<!doctype html><meta charset="utf-8">
<style>${CSS}
  body { margin: 0; padding: 20px; background: var(--cream, #f6ecd8); }
  .row { margin-bottom: 12px; }
</style>
<div class="row"><header class="topbar" style="position:static">
  <button class="chip wave" id="normal">🌊 <span id="clk-n">07:53</span><i class="wave-dmg">−0…16 PV</i></button>
</header></div>
<div class="row"><header class="topbar" style="position:static">
  <button class="chip wave fatal" id="fatal">🌊 <span id="clk-f">01:12</span><i class="wave-dmg">−82…140 PV</i></button>
</header></div>`;

const luminance = (r, g, b) => {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const browser = await chromium.launch({
  executablePath: process.env.PERF_BROWSER || undefined,
  args: ["--force-color-profile=srgb", "--disable-lcd-text"],
});
const page = await browser.newPage({ viewport: { width: 420, height: 300 }, deviceScaleFactor: 2 });
await page.setContent(page_html, { waitUntil: "load" });

// Le rapport de contraste d'une zone rendue : on décode la capture DANS la page
// (canvas), puis on prend les percentiles 2 et 98 de la luminance — l'encre et le
// fond, sans se laisser tirer par les pixels d'antialiasing entre les deux.
async function contrastOf(selector, label) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${label}: élément introuvable (${selector})`);
  const shot = (await page.screenshot({ clip: box })).toString("base64");
  // Le décodage se fait DANS la page (canvas) : Node n'a pas de décodeur PNG, et on
  // veut de toute façon les pixels tels que le navigateur les a peints.
  const pixels = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(
      await (await fetch("data:image/png;base64," + b64)).blob(),
    );
    const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const out = [];
    for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]);
    return out;
  }, shot);
  const ls = pixels.map(([r, g, b]) => luminance(r, g, b)).sort((a, b) => a - b);
  const at = (q) => ls[Math.round(q * (ls.length - 1))];
  return (at(0.98) + 0.05) / (at(0.02) + 0.05);
}

// Le minuteur seul : sans le badge (sombre) dans le cadre, sinon son propre contraste
// masquerait un minuteur devenu illisible — c'est exactement ce que faisait `.fatal`.
const checks = [
  ["#normal .wave-dmg", "badge de dégâts (état normal)"],
  ["#fatal .wave-dmg", "badge de dégâts (ville en danger)"],
  ["#clk-n", "minuteur (état normal)"],
  ["#clk-f", "minuteur (ville en danger)"],
];

let failed = 0;
for (const [sel, label] of checks) {
  const ratio = await contrastOf(sel, label);
  const ok = ratio >= MIN_CONTRAST;
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${label} — contraste ${ratio.toFixed(2)}:1 (min ${MIN_CONTRAST})`);
}

// Le badge doit aussi porter son UNITÉ et une fourchette lisible comme une fourchette :
// « −0/16 » a été lu comme une fraction (« 0 sur 16 ») par le joueur qui l'a signalé.
const txt = await page.locator("#normal .wave-dmg").innerText();
if (!/PV/.test(txt) || txt.includes("/")) {
  console.log(`❌ le badge doit porter « PV » et pas de « / » (fourchette, pas fraction) — lu « ${txt} »`);
  failed++;
} else {
  console.log(`✅ le badge porte son unité et sa fourchette — « ${txt} »`);
}

// LA BARRE NE DOIT PAS DÉBORDER — le badge s'est allongé (« −0/16 » → « −82…140 PV »)
// et la TopBar a déjà débordé une fois à sept éléments sur 390px (cf. CLAUDE.md §7).
// On mesure sur le viewport le plus serré du parc, avec le badge le plus LARGE que le
// jeu puisse produire et un nom de ville long.
await page.setViewportSize({ width: 390, height: 700 });
await page.setContent(
  `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
  <header class="topbar">
    <button class="avatar">🙂</button>
    <span class="town-name">Valbourg-sur-Brume</span>
    <button class="chip status"><span class="st-hp">🏰 100%</span><span class="st-sep"></span><span class="st-pa">⚡ 21</span></button>
    <button class="chip wave fatal">🌊 07:53<i class="wave-dmg">−182…240 PV</i></button>
    <button class="iconbtn">📋</button><button class="iconbtn chat">✉️</button><button class="iconbtn">⚙️</button>
  </header>`,
  { waitUntil: "load" },
);
const fit = await page.evaluate(() => {
  const bar = document.querySelector(".topbar");
  const chip = document.querySelector(".chip.wave");
  const gear = document.querySelector(".iconbtn:last-of-type");
  const br = bar.getBoundingClientRect();
  return {
    overflow: bar.scrollWidth - bar.clientWidth,
    chipClipped: chip.getBoundingClientRect().right > br.right + 0.5,
    gearClipped: gear.getBoundingClientRect().right > br.right + 0.5,
    dmgWrapped: document.querySelector(".wave-dmg").getClientRects().length > 1,
  };
});
if (fit.overflow > 0 || fit.chipClipped || fit.gearClipped || fit.dmgWrapped) {
  console.log(
    `❌ la TopBar déborde à 390px — débordement ${fit.overflow}px` +
      `${fit.chipClipped ? ", pastille rognée" : ""}${fit.gearClipped ? ", ⚙️ hors écran" : ""}` +
      `${fit.dmgWrapped ? ", badge à la ligne" : ""}`,
  );
  failed++;
} else {
  console.log("✅ la TopBar tient à 390px avec le badge le plus large");
}

await browser.close();
if (failed) {
  console.error(`\n${failed} vérification(s) en échec.`);
  process.exit(1);
}
console.log("\nLa pastille de vague se lit dans ses deux états.");
