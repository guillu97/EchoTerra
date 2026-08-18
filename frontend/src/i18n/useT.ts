import { useSyncExternalStore } from "react";
import { localeRevision, onLocaleChange, t, tn, currentLocale } from "./index";
import type { LocaleCode, TKey, TParams } from "./types";

/**
 * LE crochet des composants : `const T = useT(); … T("nav.map")`.
 *
 * ⚠ Il s'abonne au CHANGEMENT DE LANGUE (`useSyncExternalStore`) et pas
 * seulement au premier rendu : les fichiers de langue arrivent par `import()`,
 * donc un composant déjà monté afficherait le français pour toujours si
 * personne ne le prévenait que sa langue vient d'atterrir. La révision est un
 * entier — React ne redessine que quand elle bouge, pas à chaque `t()`.
 */
export function useT(): {
  (key: TKey, params?: TParams): string;
  n: (base: string, n: number, params?: TParams) => string;
  locale: LocaleCode;
} {
  useSyncExternalStore(onLocaleChange, localeRevision, localeRevision);
  const fn = ((key: TKey, params?: TParams) => t(key, params)) as ReturnType<typeof useT>;
  fn.n = tn;
  fn.locale = currentLocale();
  return fn;
}
