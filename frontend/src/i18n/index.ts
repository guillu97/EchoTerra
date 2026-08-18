// ─────────────────────────────────────────────────────────────────────────────
// LE MOTEUR DE TRADUCTION — voir `types.ts` pour le contrat.
//
// ⚠ LE FRANÇAIS EST LE SEUL FICHIER EMBARQUÉ EN DUR. Les sept autres langues
// sont chargées à la DEMANDE (`import()` → Vite en fait des morceaux séparés) :
// embarquer les huit, c'est faire télécharger huit fois le même texte à un
// téléphone qui n'en lira qu'un. La contrepartie est que `t()` doit rester
// SYNCHRONE — sinon chaque libellé de chaque composant deviendrait un état
// asynchrone — donc il sert le français tant que la langue demandée n'est pas
// arrivée, puis un ré-affichage a lieu (voir `useT`).
// ─────────────────────────────────────────────────────────────────────────────

import { fr } from "./locales/fr";
import { LOCALE_CODES, LOCALE_NAMES, NO_PLURAL } from "./types";
import type { Locale, LocaleCode, TKey, TParams } from "./types";

export { LOCALE_CODES, LOCALE_NAMES } from "./types";
export type { LocaleCode, TKey, TParams } from "./types";

const LOADERS: Record<LocaleCode, () => Promise<{ default: Locale }>> = {
  fr: async () => ({ default: fr }),
  en: () => import("./locales/en").then((m) => ({ default: m.en })),
  es: () => import("./locales/es").then((m) => ({ default: m.es })),
  de: () => import("./locales/de").then((m) => ({ default: m.de })),
  it: () => import("./locales/it").then((m) => ({ default: m.it })),
  pt: () => import("./locales/pt").then((m) => ({ default: m.pt })),
  zh: () => import("./locales/zh").then((m) => ({ default: m.zh })),
  ja: () => import("./locales/ja").then((m) => ({ default: m.ja })),
};

let active: LocaleCode = "fr";
let table: Locale = fr;
const listeners = new Set<() => void>();

/** S'abonner aux changements de langue (utilisé par `useT`). */
export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function currentLocale(): LocaleCode {
  return active;
}

/** Un entier qui change à chaque bascule de langue — la clé de ré-affichage React. */
let revision = 0;
export function localeRevision(): number {
  return revision;
}

/**
 * Charge et active une langue. Idempotent, et sûr à appeler avant que la
 * précédente soit arrivée : seul le DERNIER appel gagne (`token`), sinon un
 * réseau lent ferait revenir une langue que le joueur vient de quitter.
 */
let token = 0;
export async function setLocale(code: LocaleCode): Promise<void> {
  const mine = ++token;
  if (code === active && table !== fr) return;
  let loaded: Locale;
  try {
    loaded = (await LOADERS[code]()).default;
  } catch {
    return; // morceau injoignable : on reste sur ce qu'on affichait
  }
  if (mine !== token) return;
  active = code;
  table = loaded;
  revision++;
  try {
    document.documentElement.lang = code;
  } catch {
    /* pas de DOM (tests Node) */
  }
  listeners.forEach((fn) => fn());
}

/**
 * La langue à servir à quelqu'un qui n'a jamais choisi : celle du navigateur
 * si l'appli la parle, français sinon. ⚠ on lit `navigator.languages` ENTIER
 * (un francophone au Canada arrive en `en-CA, fr-CA` — lui servir l'anglais
 * parce qu'il est en tête serait obéir à l'OS et non à la personne).
 */
export function detectLocale(): LocaleCode {
  const tags: string[] = [];
  try {
    tags.push(...(navigator.languages ?? []), navigator.language ?? "");
  } catch {
    /* pas de navigateur */
  }
  for (const tag of tags) {
    const base = String(tag).toLowerCase().split("-")[0] as LocaleCode;
    if ((LOCALE_CODES as readonly string[]).includes(base)) return base;
  }
  return "fr";
}

const PARAM = /\{(\w+)\}/g;

function interpolate(s: string, params?: TParams): string {
  if (!params) return s;
  return s.replace(PARAM, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * LE traducteur. `t("nav.map")`, `t("map.pa", { n: 4 })`.
 *
 * ⚠ Le repli est PAR CLÉ et non par fichier : une langue à jour sauf sur la
 * clé du jour affiche le français à cet endroit précis au lieu de basculer
 * tout l'écran. (Le typage rend ce cas impossible à compiler, mais un fichier
 * de langue peut aussi arriver d'un déploiement plus ancien via le cache du
 * CDN — c'est ce cas-là que le repli couvre.)
 */
export function t(key: TKey, params?: TParams): string {
  const raw = table[key] ?? fr[key];
  if (raw === undefined) {
    if (import.meta.env?.DEV) console.warn(`[i18n] clé inconnue : ${key}`);
    return String(key);
  }
  return interpolate(raw, params);
}

/**
 * Traduction ACCORDÉE EN NOMBRE : `tn("map.waves", 1)` lit `map.waves.one`,
 * `tn("map.waves", 3)` lit `map.waves.other`. `{n}` est fourni d'office.
 *
 * ⚠ Le français met le SINGULIER à zéro (« 0 vague ») là où l'anglais met le
 * pluriel (« 0 waves ») : c'est la règle de la LANGUE ACTIVE qui décide, pas
 * celle du français source. Et le chinois et le japonais n'ont qu'une forme.
 */
export function tn(base: string, n: number, params?: TParams): string {
  const one = NO_PLURAL.has(active) ? false : active === "fr" ? Math.abs(n) < 2 : Math.abs(n) === 1;
  return t(`${base}.${one ? "one" : "other"}` as TKey, { n, ...params });
}

/** Le nom d'une langue dans sa propre langue. */
export function localeName(code: LocaleCode): string {
  return LOCALE_NAMES[code];
}
