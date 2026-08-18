#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// LE GARDE-FOU DES LANGUES — `npm run test:i18n`
//
// « Chaque nouveau texte est obligatoirement écrit dans les différentes langues
// de l'appli. » Ce fichier est ce qui rend cette phrase VÉRIFIABLE.
//
// Deux filets, et il faut les deux :
//
//  1. `tsc` (via `npm run build`) refuse déjà de compiler une langue à qui il
//     manque une clé — `Locale = Record<TKey, string>`. C'est le filet le plus
//     serré, et il est gratuit.
//  2. Ce test attrape ce que le TYPAGE ne peut pas voir, parce qu'une chaîne
//     reste une chaîne : une valeur VIDE, un `{paramètre}` perdu à la
//     traduction (le libellé afficherait « il manque  Pierre »), une clé
//     restée en français dans une autre langue, un `.one` sans son `.other`,
//     et surtout du FRANÇAIS EN DUR laissé dans un composant déjà migré.
//
// ⚠ Il tourne SANS navigateur et sans serveur de dev : c'est de la lecture de
//   fichiers. Aucune raison de ne pas le lancer.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const LOCALES = path.join(SRC, "i18n", "locales");

const fails = [];
const warns = [];
const fail = (m) => fails.push(m);

// ── Les langues déclarées ────────────────────────────────────────────────────
const { LOCALE_CODES, LOCALE_NAMES, NO_PLURAL } = await import(
  path.join(SRC, "i18n", "types.ts")
);

const tables = {};
for (const code of LOCALE_CODES) {
  const file = path.join(LOCALES, `${code}.ts`);
  if (!fs.existsSync(file)) {
    fail(`langue déclarée sans fichier : ${code}.ts`);
    continue;
  }
  const mod = await import(file);
  const table = mod[code] ?? mod.default;
  if (!table) fail(`${code}.ts n'exporte ni \`${code}\` ni \`default\``);
  else tables[code] = table;
}

const source = tables.fr;
if (!source) {
  console.error("✖ pas de source française — rien à vérifier");
  process.exit(1);
}
const keys = Object.keys(source);

// ── 1. Chaque langue traduit CHAQUE clé, et pas une de plus ──────────────────
for (const [code, table] of Object.entries(tables)) {
  if (code === "fr") continue;
  const missing = keys.filter((k) => !(k in table));
  const extra = Object.keys(table).filter((k) => !(k in source));
  if (missing.length)
    fail(
      `${code} : ${missing.length} clé(s) NON TRADUITE(S) — ${missing.slice(0, 8).join(", ")}${
        missing.length > 8 ? ` … (+${missing.length - 8})` : ""
      }`,
    );
  if (extra.length)
    fail(`${code} : ${extra.length} clé(s) qui n'existent pas en français — ${extra.slice(0, 8).join(", ")}`);
}

// ── 2. Aucune valeur vide (sauf celles que le français laisse vides exprès) ──
const intentionallyEmpty = new Set(keys.filter((k) => source[k] === ""));
for (const [code, table] of Object.entries(tables)) {
  for (const k of keys) {
    const v = table[k];
    if (typeof v !== "string") continue;
    if (v.trim() === "" && !intentionallyEmpty.has(k))
      fail(`${code} : « ${k} » est vide alors que le français dit « ${source[k]} »`);
  }
}

// ── 3. Les {paramètres} survivent à la traduction ────────────────────────────
// Un libellé qui perd son `{n}` n'affiche pas un texte approximatif : il
// affiche une phrase à trou. C'est l'erreur de traduction la plus fréquente et
// la seule qui produise un bug visible.
const paramsOf = (s) => new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
for (const [code, table] of Object.entries(tables)) {
  if (code === "fr") continue;
  for (const k of keys) {
    if (typeof table[k] !== "string") continue;
    const want = paramsOf(source[k]);
    const got = paramsOf(table[k]);
    const lost = [...want].filter((p) => !got.has(p));
    const invented = [...got].filter((p) => !want.has(p));
    if (lost.length) fail(`${code} : « ${k} » a perdu {${lost.join("}, {")}}`);
    if (invented.length) fail(`${code} : « ${k} » invente {${invented.join("}, {")}}`);
  }
}

// ── 4. Les paires de pluriel sont complètes ─────────────────────────────────
// `tn()` compose la clé `<base>.one` / `<base>.other` : une moitié manquante
// est un texte qui n'apparaît qu'à certains nombres, donc un bug qu'aucun
// relecteur ne voit.
for (const k of keys) {
  if (k.endsWith(".one") && !(k.slice(0, -4) + ".other" in source))
    fail(`fr : « ${k} » n'a pas son pluriel « ${k.slice(0, -4)}.other »`);
  if (k.endsWith(".other") && !(k.slice(0, -6) + ".one" in source))
    fail(`fr : « ${k} » n'a pas son singulier « ${k.slice(0, -6)}.one »`);
}

// ── 5. Une traduction qui n'a pas été traduite ──────────────────────────────
// Copier le français dans les huit fichiers ferait passer les tests 1 à 4. Ce
// n'est un signal que pour les langues LOINTAINES du français : en espagnol ou
// en italien, « Solo », « Max », « Normal » sont légitimement identiques.
// D'où : on ne SIGNALE (sans faire échouer) que les phrases longues, et on
// ignore les langues latines et les valeurs sans lettre (chiffres, emoji).
const LATIN = new Set(["es", "it", "pt"]);
for (const [code, table] of Object.entries(tables)) {
  if (code === "fr" || LATIN.has(code)) continue;
  for (const k of keys) {
    const v = table[k];
    if (typeof v !== "string" || v !== source[k]) continue;
    // un seul mot identique (« Notifications », « Max », « Standard ») est un
    // cognat, pas un oubli : on n'alerte que sur une PHRASE.
    if (v.length < 20 || v.trim().split(/\s+/).length < 3) continue;
    warns.push(`${code} : « ${k} » est resté identique au français (« ${v.slice(0, 40)}… »)`);
  }
}

// ── 6. Les accents français dans une langue qui n'en a pas ──────────────────
// Un « é » dans le fichier allemand ou anglais est presque toujours un
// copier-coller oublié.
const FRENCH_ONLY = /[àâçéèêëîïôùûœ]/i;
for (const code of ["en", "de", "zh", "ja"]) {
  const table = tables[code];
  if (!table) continue;
  for (const k of keys) {
    const v = table[k];
    if (typeof v === "string" && FRENCH_ONLY.test(v) && v === source[k])
      fail(`${code} : « ${k} » est du français non traduit (« ${v.slice(0, 40)} »)`);
  }
}

// ── 7. Le nom de chaque langue est écrit DANS cette langue ──────────────────
for (const code of LOCALE_CODES) {
  if (!LOCALE_NAMES[code]) fail(`langue ${code} : pas de nom propre dans LOCALE_NAMES`);
}

// ── 8. Plus de français EN DUR dans les fichiers déjà migrés ────────────────
// Le seul filet qui attrape le vrai risque : quelqu'un (moi compris) qui
// ajoute un libellé DIRECTEMENT dans un composant au lieu de passer par `t()`.
// La liste est explicite et ne fait que GRANDIR — un fichier migré ne peut
// plus régresser, et un fichier pas encore migré ne fait pas échouer le test.
const MIGRATED = fs.existsSync(path.join(ROOT, "tests", "i18n-migrated.json"))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "i18n-migrated.json"), "utf8"))
  : [];

// ⚠ LES VALEURS QUI SE TROUVENT ÊTRE FRANÇAISES.
// Le backend nomme ses états et ses objets en français : `"Tétanisé"`,
// `"Ration d'eau"`, `"Plan de la Tour"`. Ce sont des IDENTIFIANTS — le client
// les COMPARE (`states.includes("Tétanisé")`), les recettes et les bots s'en
// servent, les traduire casserait le jeu (CLAUDE.md le dit déjà : « ne jamais
// traduire »). Leur AFFICHAGE, lui, passe par `i18n/gameText.ts`.
//
// ⚠ Cette liste doit rester COURTE et EXPLICITE : c'est une porte de sortie du
// garde-fou, et une porte large ne garde plus rien. Y ajouter une valeur veut
// dire « le code compare littéralement cette chaîne », jamais « ce texte
// m'ennuie ».
const GAME_VALUES = new Set([
  "Tétanisé",
  "Caché",
  "Blessé",
  "Fatigue",
  "Soif",
  "Gelé",
  "Ration d'eau",
  "Pierre",
  "Plan ",
]);

const FRENCH_WORD =
  /[àâäçéèêëîïôöùûüœ]|\b(le|la|les|des|une|un|du|de|vous|tes|ton|ta|est|pas|dans|pour|avec|sur|par|qui|que|ville|héros|vague|joueur|partie|monstre|aucun|tous|votre|toi)\b/i;

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, "$1"))
    .join("\n");
}

/**
 * Le texte NU d'un fichier JSX : ce qu'un joueur lit et que personne n'a
 * traduit — le texte entre une balise fermante et la balise suivante.
 *
 * ⚠⚠ TROIS AUTOMATES ONT ÉTÉ ÉCRITS ET JETÉS AVANT CELUI-CI, et aucun n'était
 * faux « en lisant le code » : chacun a été démasqué en vérifiant que le témoin
 * MORD (il ne mordait pas).
 *  1. une regex `>…texte…<` sur UNE ligne rate le cas le plus courant — Prettier
 *     met justement le texte sur sa propre ligne ;
 *  2. un automate qui suit les balises se fait décaler par `onClick={() => …}`
 *     (un `>` qui ne ferme rien) et par `i < src.length` (un `<` qui n'ouvre
 *     rien) ;
 *  3. et surtout : « profondeur d'accolade 0 » NE VEUT PAS DIRE « dans du
 *     JSX » — le corps d'une fonction est déjà une accolade, donc tout le JSX
 *     d'un composant vivait à la profondeur 1 et était sauté en silence. Cette
 *     version-là rendait UN candidat (« import ») sur 400 lignes.
 *
 * Ce qui marche est plus bête : on retire les chaînes (déjà couvertes par la
 * passe (a), et elles peuvent contenir `<`), puis on prend les tranches
 * `>…<` — la regex `[^<>]*` choisit d'elle-même le `>` le plus PROCHE, donc le
 * `>` d'une flèche ne peut pas ouvrir une fausse tranche. Enfin on ôte les
 * expressions `{…}` de la tranche : ce qui reste est du texte pur, et une
 * ligne mixte (« 🔎 {T(…)} et du français ») est donc bien attrapée.
 */
function jsxText(src) {
  // Les chaînes deviennent des chaînes vides : leur contenu est jugé ailleurs.
  const noStrings = src
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');

  const out = [];
  for (const m of noStrings.matchAll(/>([^<>]*)</g)) {
    let body = m[1];
    let prev;
    do {
      prev = body;
      body = body.replace(/\{[^{}]*\}/g, " ");
    } while (body !== prev);
    body = body.replace(/\s+/g, " ").trim();
    if (!body || /[;=(){}[\]"'`]/.test(body)) continue;
    if (!/[A-Za-zÀ-ÿ]{2}/.test(body)) continue;
    out.push(body);
  }
  return out;
}

for (const rel of MIGRATED) {
  const file = path.join(SRC, rel);
  if (!fs.existsSync(file)) {
    fail(`i18n-migrated.json cite un fichier absent : ${rel}`);
    continue;
  }
  const src = stripComments(fs.readFileSync(file, "utf8"));
  const offenders = [];
  // (a) littéraux de chaîne français
  for (const lit of src.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) ?? []) {
    const body = lit.slice(1, -1);
    if (body.length < 4) continue;
    if (/^[\w./#@-]+$/.test(body)) continue; // classes CSS, ids, chemins
    if (!FRENCH_WORD.test(body)) continue;
    if (GAME_VALUES.has(body)) continue; // un identifiant, pas un texte
    offenders.push(lit);
  }
  // (b) texte JSX entre balises — ⚠ PAS une regex sur une ligne.
  // Un premier jet cherchait `>…texte…<` sur UNE ligne et laissait passer le cas
  // le plus courant, parce que Prettier met justement le texte sur sa propre
  // ligne : `<button …>` \n `  🔎 Fouiller la case <i>` — le `>` ouvrant est deux
  // lignes plus haut. Vérifié : le témoin ne mordait pas. D'où ce petit automate,
  // qui ramasse ce qui se trouve HORS balise et HORS accolade.
  if (rel.endsWith(".tsx")) for (const body of jsxText(src)) {
    if (body.length < 4 || !FRENCH_WORD.test(body)) continue;
    offenders.push(`>${body}<`);
  }
  if (offenders.length)
    fail(
      `${rel} : ${offenders.length} texte(s) français EN DUR — passe par t() et ajoute la clé aux 8 langues : ${offenders
        .slice(0, 4)
        .join(" · ")}`,
    );
}

// ── Verdict ──────────────────────────────────────────────────────────────────
const n = keys.length;
const langs = Object.keys(tables).length;
for (const w of warns) console.log(`  ⚠ ${w}`);
if (fails.length) {
  console.error(`\n✖ i18n : ${fails.length} problème(s)\n`);
  for (const f of fails) console.error(`  ✖ ${f}`);
  console.error("");
  process.exit(1);
}
console.log(
  `✓ i18n : ${n} clés × ${langs} langues (${LOCALE_CODES.join(", ")}) = ${n * langs} textes, ` +
    `${MIGRATED.length} fichier(s) migré(s) sans français en dur` +
    (warns.length ? ` — ${warns.length} avertissement(s)` : ""),
);
