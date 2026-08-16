// LE GARDE-FOU DE L'INTERNATIONALISATION.
//
// La clé de traduction est la PHRASE FRANÇAISE (voir src/i18n/index.ts). C'est ce qui
// rend le repli gratuit et le code lisible — et c'est aussi le seul point faible du
// procédé : reformuler une phrase française CASSE son lien vers l'anglais, en silence,
// sans erreur de compilation ni exception à l'exécution. On ne s'en aperçoit qu'en
// jouant, dans la langue qu'on ne parle pas.
//
// Ce test est donc l'unique chose qui tienne le contrat. Il lit LE CODE — le front en
// TypeScript et le serveur en Go — plutôt que le catalogue, et vérifie dans LES DEUX
// SENS :
//
//   1. toute clé réellement appelée a une entrée anglaise (sinon : français affiché) ;
//   2. toute entrée anglaise correspond à une clé appelée (sinon : traduction morte,
//      qui reste dans le fichier et fait croire que la phrase est couverte) ;
//   3. les gabarits du serveur ont EXACTEMENT les mêmes verbes fmt dans les deux
//      langues (`%s`, `%d`, `%%`), dans le même ordre — la substitution est
//      positionnelle, donc un verbe déplacé affiche un nombre à la place d'un nom, et
//      ça ne se voit pas à la relecture ;
//   4. les gabarits n'emploient QUE %s/%d/%% — le client réimplémente `fmt` en une
//      ligne et ne connaît rien d'autre ;
//   5. les NOMS DE JEU des catalogues serveur (objets, bâtiments, classes, créatures,
//      états) ont leur entrée `data:` — ce sont des identifiants qui voyagent en
//      français et que seul l'affichage rhabille.
//
// Aucun navigateur, aucun serveur : c'est de l'analyse de source, donc ça tourne en
// une seconde et peut être branché sur n'importe quel CI.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONT = join(HERE, "..", "src");
const BACK = join(HERE, "..", "..", "backend", "internal");

// Une chaîne littérale, TS ou Go, échappements compris.
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function unquote(raw) {
  return raw.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
}

// --- ce que le CODE demande -------------------------------------------------

// Les outils de dev (éditeur de carte, studio de données, studio persos, éditeur
// voxel) sont hors périmètre : internes, jamais vus par un joueur (décision assumée,
// cf. CLAUDE.md). `src/i18n/` est le catalogue lui-même.
const SKIP_FRONT = ["/editor/", "/designer/", "/charstudio/", "/voxeledit/", "/i18n/"];

/**
 * Tous les littéraux de chaîne du front, `t(…)` ou non.
 *
 * ⚠ NÉCESSAIRE : beaucoup de libellés sont posés dans des CONSTANTES DE MODULE
 * (`NAV_TABS`, `CATS`, `ATTR_ROWS`, les infobulles du classement…) et traduits au
 * rendu par `t(variable)` — une constante ne peut pas appeler `t()` elle-même, elle
 * serait évaluée une seule fois et figerait la langue du démarrage. Le test ne peut
 * donc pas les voir comme des appels, mais il peut les voir comme des LITTÉRAUX ;
 * c'est assez pour la question qu'il pose ici : « cette phrase française existe-t-elle
 * encore quelque part dans le code ? »
 */
function frontLiterals() {
  // On exclut les CATALOGUES (src/i18n/en/) — sinon chaque entrée se déclarerait
  // utilisée par sa propre présence — mais PAS le moteur `src/i18n/index.ts`, qui
  // appelle légitimement `t("ou|énumération")` pour joindre une liste.
  const files = walk(FRONT).filter(
    (f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes(`${sep}i18n${sep}en${sep}`),
  );
  const out = new Set();
  const re = new RegExp(STR, "g");
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(re)) out.add(unquote(m[1]));
  }
  return out;
}

function frontKeys() {
  const files = walk(FRONT).filter(
    (f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !SKIP_FRONT.some((s) => f.includes(s)),
  );
  const ui = new Map();
  const named = new Map();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const [re, bag, prefix] of [
      [new RegExp(String.raw`\bt\(\s*` + STR, "g"), ui, ""],
      [new RegExp(String.raw`\btName\(\s*` + STR, "g"), named, "data:"],
      [new RegExp(String.raw`\btDesc\(\s*` + STR, "g"), named, "desc:"],
    ]) {
      for (const m of src.matchAll(re)) {
        const k = prefix + unquote(m[1]);
        if (!bag.has(k)) bag.set(k, new Set());
        bag.get(k).add(f);
      }
    }
  }
  return { ui, named };
}

function serverKeys() {
  const files = walk(BACK).filter((f) => f.endsWith(".go") && !f.endsWith("_test.go"));
  const out = new Map();
  const simple = ["actionErr", "actionErrf", "invalidAction", "invalidActionf", "logTown", "newMsg"];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const res = [
      // writeErr(w, code, "…") : deux arguments avant la phrase.
      new RegExp(String.raw`\bwriteErr\([^,]+,[^,]+,\s*` + STR, "g"),
      // Msg{Key: "…"} construit à la main.
      new RegExp(String.raw`\bKey:\s*` + STR, "g"),
      // add(kind, icon, urgent, "…") de l'ordre du jour — `urgent` est souvent une
      // EXPRESSION, pas un booléen littéral, d'où le saut permissif.
      new RegExp(String.raw`\badd\(\s*` + STR + String.raw`,\s*` + STR + String.raw`,\s*[^"]*?` + STR, "g"),
      ...simple.map((fn) => new RegExp(String.raw`\b` + fn + String.raw`\(\s*` + STR, "g")),
    ];
    for (const re of res) {
      for (const m of src.matchAll(re)) {
        const raw = m[3] ?? m[1];
        const k = unquote(raw);
        if (!out.has(k)) out.set(k, new Set());
        out.get(k).add(f);
      }
    }
  }
  return out;
}

// Les NOMS DE JEU des catalogues serveur : ce sont des identifiants (CLAUDE.md), donc
// ils arrivent tels quels au client et doivent tous avoir une entrée `data:`.
function serverDataNames() {
  const names = new Set();
  const grab = (file, re, group = 1) => {
    const src = readFileSync(join(BACK, "game", file), "utf8");
    for (const m of src.matchAll(re)) names.add(unquote(m[group]));
  };
  // Ingrédients et butins : Item{"type", "Nom", n}
  const ITEM = new RegExp(
    String.raw`\{"(?:objet|minerai|plante|animal|aliment|eau|arme|consommable|deco)",\s*` + STR,
    "g",
  );
  for (const f of ["craft.go", "design.go", "ruins.go", "theme.go", "wave.go"]) grab(f, ITEM);
  // Recettes, espèces, classes, compétences, ruines, thèmes : champ Name.
  const NAME = new RegExp(String.raw`\bName:\s*` + STR, "g");
  // ⚠ combat.go compris : les compétences ISO y sont déclarées, et leur absence de
  // cette liste les avait laissées en français dans une interface anglaise.
  for (const f of [
    "craft.go",
    "design.go",
    "classes.go",
    "mapskills.go",
    "ruins.go",
    "theme.go",
    "weapons.go",
    "combat.go",
  ])
    grab(f, NAME);
  // Objets consommables / portables : la CLÉ de la table est le nom.
  const KEYED = new RegExp(String.raw`^\t` + STR + String.raw`:\s*\{`, "gm");
  for (const f of ["items.go", "equipment.go"]) grab(f, KEYED);
  // Plans de construction.
  grab("town.go", /return "(Plan [^"]*)"/g);
  // Le préfixe des ruines-mémoriaux : un nom COMPOSÉ avec un nom de ville, dont seul
  // le début est traduisible (cf. tName / COMPOSED_PREFIXES côté client).
  grab("ruins.go", /\bruinNamePrefix\s*=\s*"([^"]*)"/g);
  // ⚠ PAS DE FILTRE PAR JEU DE CARACTÈRES ICI. Une première version écartait tout nom
  // purement ASCII pour se débarrasser des noms anglais hérités du prototype
  // (TownBuilding.Name : "Wall", "Bank"…) — et jetait du même coup « Coup vif »,
  // « Frappe puissante », « Provocation », des noms français sans accent, qui sont
  // restés en français dans l'interface anglaise sans que rien ne le signale.
  // Les noms hérités ne sont plus un problème : ils vivent dans town.go, dont on
  // n'extrait aucun `Name:` (le client affiche buildingName(id), pas b.name).
  return names;
}

// --- vérifications ----------------------------------------------------------

const VERB = /%[a-zA-Z%]/g;
function verbs(s) {
  return (s.match(VERB) ?? []).join("");
}

let failures = 0;
let checks = 0;
function check(name, ok, detail) {
  checks++;
  if (ok) {
    console.log(`  ✓ ${name}`);
    return;
  }
  failures++;
  console.log(`  ✗ ${name}`);
  if (detail) for (const line of detail.slice(0, 25)) console.log(`      ${line}`);
  if (detail && detail.length > 25) console.log(`      … et ${detail.length - 25} de plus`);
}

// Les catalogues sont du TypeScript : plutôt que d'exiger un transpileur pour un test
// qui doit rester trivial, on les LIT comme du texte. Le format est celui de prettier
// (clé quotée ou identifiant, valeur quotée, éventuellement sur la ligne suivante),
// et un couple qui ne se laisserait pas lire ici ressortirait aussitôt en « manquant ».
const PAIR = new RegExp(
  String.raw`(?:^|[\n{,])\s*(?:` + STR + String.raw`|([A-Za-zÀ-ÿ_$][\w$À-ÿ]*))\s*:\s*` + STR,
  "g",
);

function pairsOf(text) {
  const out = new Map();
  for (const m of text.matchAll(PAIR)) {
    out.set(m[1] !== undefined ? unquote(m[1]) : m[2], unquote(m[3]));
  }
  return out;
}

/** Le catalogue anglais complet, clés `data:`/`desc:` préfixées comme à l'exécution. */
function catalog() {
  const out = new Map();
  for (const f of ["ui.ts", "server.ts"]) {
    for (const [k, v] of pairsOf(readFileSync(join(FRONT, "i18n", "en", f), "utf8"))) out.set(k, v);
  }
  // data.ts pose ses préfixes au chargement (voir sa fin de fichier) : on refait ici le
  // même geste, sur les deux blocs qu'il déclare.
  const src = readFileSync(join(FRONT, "i18n", "en", "data.ts"), "utf8");
  const cut = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
  for (const [k, v] of pairsOf(cut("const NAMES", "const DESCS"))) out.set("data:" + k, v);
  for (const [k, v] of pairsOf(cut("const DESCS", "export const DATA"))) out.set("desc:" + k, v);
  return out;
}

console.log("i18n — le catalogue anglais couvre-t-il ce que le code demande ?\n");

const cat = catalog();
const front = frontKeys();
const srv = serverKeys();

// 1. Rien d'appelé ne doit manquer au catalogue.
const wantedUI = [...front.ui.keys()];
const missingUI = wantedUI.filter((k) => !cat.has(k));
check(
  `les ${wantedUI.length} chaînes d'interface ont une traduction anglaise`,
  missingUI.length === 0,
  missingUI.map((k) => `manquant : ${JSON.stringify(k)}  (${[...front.ui.get(k)][0]})`),
);

const wantedSrv = [...srv.keys()];
const missingSrv = wantedSrv.filter((k) => !cat.has(k));
check(
  `les ${wantedSrv.length} gabarits du serveur ont une traduction anglaise`,
  missingSrv.length === 0,
  missingSrv.map((k) => `manquant : ${JSON.stringify(k)}  (${[...srv.get(k)][0]})`),
);

// 2. Rien d'orphelin ne doit rester au catalogue — une entrée qui ne correspond plus à
//    aucune clé appelée est une traduction morte, et elle masque le trou qu'elle a
//    laissé en changeant de nom.
// « Utilisée » = appelée explicitement, OU présente comme littéral quelque part dans
// le front (cf. frontLiterals : les libellés de catalogues passent par `t(variable)`).
const literals = frontLiterals();
const used = new Set([...wantedUI, ...wantedSrv, ...front.named.keys(), ...literals]);
const dataNames = serverDataNames();
for (const n of dataNames) used.add("data:" + n);
// Les catalogues `data:`/`desc:` sont servis par des valeurs d'exécution : on ne peut
// pas les rattacher à un appel littéral. On les exempte du sens « orphelin », mais pas
// du sens « manquant » ci-dessous.
const orphans = [...cat.keys()].filter(
  (k) => !used.has(k) && !k.startsWith("data:") && !k.startsWith("desc:"),
);
check(
  "aucune traduction orpheline (phrase française reformulée sans mettre à jour le catalogue)",
  orphans.length === 0,
  orphans.map((k) => `orphelin : ${JSON.stringify(k)}`),
);

// 3. Verbes fmt identiques des deux côtés, dans le même ordre.
const verbMismatch = wantedSrv
  .filter((k) => cat.has(k))
  .filter((k) => verbs(k) !== verbs(cat.get(k)))
  .map((k) => `${JSON.stringify(k)} → fr "${verbs(k)}" vs en "${verbs(cat.get(k))}"`);
check(
  "les gabarits ont les mêmes verbes fmt, dans le même ordre, en français et en anglais",
  verbMismatch.length === 0,
  verbMismatch,
);

// 4. Seuls %s, %d et %% : le rendu client n'implémente rien d'autre.
const exotic = wantedSrv
  .filter((k) => (k.match(VERB) ?? []).some((v) => !["%s", "%d", "%%"].includes(v)))
  .map((k) => `${JSON.stringify(k)} emploie un verbe non géré par le client`);
check("les gabarits n'emploient que %s, %d et %%", exotic.length === 0, exotic);

// 5. Les noms de jeu du serveur sont traduits.
const missingNames = [...dataNames].filter((n) => !cat.has("data:" + n)).sort();
check(
  `les ${dataNames.size} noms de jeu des catalogues serveur ont une entrée data:`,
  missingNames.length === 0,
  missingNames.map((n) => `nom sans traduction : ${JSON.stringify(n)}`),
);

// 6. Les substitutions nommées `{x}` de l'interface se retrouvent dans la traduction —
//    un trou perdu à la traduction fait disparaître un chiffre de la phrase.
const braces = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const braceMismatch = wantedUI
  .filter((k) => cat.has(k))
  .filter((k) => braces(k) !== braces(cat.get(k)))
  .map((k) => `${JSON.stringify(k)} → fr {${braces(k)}} vs en {${braces(cat.get(k))}}`);
check(
  "les substitutions {nommées} sont les mêmes en français et en anglais",
  braceMismatch.length === 0,
  braceMismatch,
);

console.log(`\n${checks - failures}/${checks} vérifications passées.`);
process.exit(failures === 0 ? 0 : 1);
