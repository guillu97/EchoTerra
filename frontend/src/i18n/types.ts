// ─────────────────────────────────────────────────────────────────────────────
// LES LANGUES DE L'APPLI — le contrat
//
// ⚠ RÈGLE ABSOLUE : tout texte VU PAR UN JOUEUR vit dans `locales/fr.ts` (la
// source) et DOIT exister dans les huit langues. Ce n'est pas une convention
// de politesse : `Locale = Record<TKey, string>` fait ÉCHOUER `tsc` sur une clé
// manquante, donc un texte ajouté dans une seule langue ne compile pas.
// Le complément (`npm run test:i18n`) attrape ce que le typage ne peut pas voir :
// une valeur vide, un paramètre `{x}` perdu à la traduction, une chaîne
// française laissée en dur dans un composant déjà migré.
//
// Pourquoi une clé PLATE et pointée (`map.hero.stuck`) plutôt qu'un objet
// imbriqué : le typage d'un objet imbriqué ne dit RIEN d'utile quand une
// branche entière manque, et les huit fichiers ne se diffent plus à l'œil.
// ─────────────────────────────────────────────────────────────────────────────

// ⚠ import de TYPE : ce fichier ne doit embarquer AUCUNE valeur, pour rester
// lisible par Node (garde-fou `test:i18n`) autant que par Vite.
import type { fr } from "./locales/fr";

/** Toutes les clés de traduction du jeu. Dérivée de la SOURCE française. */
export type TKey = keyof typeof fr;

/**
 * Une langue = la traduction de CHAQUE clé. Aucune n'est optionnelle :
 * c'est ce `Record` qui rend une traduction manquante impossible à compiler.
 */
export type Locale = Record<TKey, string>;

/** Les codes de langue servis par l'appli (ISO 639-1). */
export const LOCALE_CODES = ["fr", "en", "es", "de", "it", "pt", "zh", "ja"] as const;
export type LocaleCode = (typeof LOCALE_CODES)[number];

/** Le nom de chaque langue DANS cette langue — jamais traduit, c'est le point. */
export const LOCALE_NAMES: Record<LocaleCode, string> = {
  fr: "Français",
  en: "English",
  es: "Español",
  de: "Deutsch",
  it: "Italiano",
  pt: "Português",
  zh: "中文",
  ja: "日本語",
};

/**
 * Les langues qui n'ont PAS de pluriel morphologique : `tn()` y sert toujours
 * la forme `.other`. Mettre `.one` et `.other` au même texte dans ces fichiers
 * serait du bruit qu'un relecteur prendrait pour un oubli.
 */
export const NO_PLURAL: ReadonlySet<LocaleCode> = new Set<LocaleCode>(["zh", "ja"]);

/** Les valeurs interpolables : `t("x", { n: 3, name: "Gui" })`. */
export type TParams = Record<string, string | number>;
