// LES MODÈLES PROPRES À UN THÈME (backend theme.go, lot 3).
//
// Un thème peut donner sa silhouette à un bâtiment ou à une ruine : la halle sommitale
// du bourg (le premier bâtiment qu'on voit en ouvrant la ville) et le donjon de sable
// (pyramide en désert, drakkar au nord). La clé du modèle devient alors
// `<base>-<theme>` — par exemple `bld-townhall-nordique`.
//
// ⚠ LE REGISTRE EST EXPLICITE, ET C'EST TOUT L'INTÉRÊT. Les modèles sont PRÉCHARGÉS par
// liste de clés : demander une clé qui n'a pas de fichier ne produit ni erreur ni repli,
// `BlockLibrary.get` rend `undefined` et la pose fait `continue` — un bâtiment
// silencieusement INVISIBLE et incliquable, exactement le piège déjà documenté pour
// `buildingModelKey`. On ne dérive donc jamais la clé « à l'aveugle » : on demande au
// registre, qui ne connaît que les fichiers réellement générés par gen-props.mjs.
const THEMED = new Set([
  "bld-townhall-nordique",
  "bld-townhall-desertique",
  "site-epave-desertique",
  "site-epave-nordique",
  // LE TEMPLE (mythic.go) : « spécifique au biome » était la demande, et c'est le seul
  // bâtiment dont la forme DIT quelque chose du jeu — le panthéon qu'on prie. Péristyle
  // grec en tempéré (la clé de base), hof à pignons de bois au nord, pylône et obélisques
  // au sud.
  "bld-temple-nordique",
  "bld-temple-desertique",
]);

/** La clé à utiliser pour ce modèle sous ce thème (la base si rien n'est prévu). */
export function themedKey(base: string, theme: string | undefined): string {
  if (!theme) return base;
  const key = `${base}-${theme}`;
  return THEMED.has(key) ? key : base;
}

/** Les clés à PRÉCHARGER pour ce thème (vide en tempéré : rien de plus à télécharger). */
export function themedKeysFor(theme: string | undefined): string[] {
  if (!theme) return [];
  return [...THEMED].filter((k) => k.endsWith(`-${theme}`));
}

/** Toutes les clés thématiques — pour le banc d'essai, qui charge tout. */
export const ALL_THEMED_KEYS = [...THEMED];
