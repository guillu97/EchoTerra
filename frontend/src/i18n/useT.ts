// Le pont React de l'i18n.
//
// `t()` lit un état de MODULE (la langue courante), pas un état React : un composant
// qui l'appelle sans rien d'autre ne se redessinerait donc jamais au changement de
// langue. `useT()` l'abonne à `onLangChange` — c'est la seule raison d'être de ce
// fichier, et c'est pour ça qu'un composant qui affiche du texte DOIT passer par lui
// plutôt que d'importer `t` directement.
//
// ⚠ on ne remonte PAS l'arbre sur une `key` pour forcer le redessin : ça détruirait
// les vues voxel (moteur, terrain, caméra) à chaque changement de langue, alors que
// CLAUDE.md rappelle qu'une seule remontée de `VoxelTownView` coûte déjà la scène
// entière. Un abonnement coûte un rendu de texte, pas une reconstruction de monde.

import { useSyncExternalStore } from "react";
import { getLang, onLangChange, t, tDesc, tf, tName, tServer, type Lang } from "./index";

/** S'abonne à la langue courante et la renvoie. */
export function useLang(): Lang {
  return useSyncExternalStore(onLangChange, getLang, getLang);
}

/**
 * Les fonctions de traduction, liées au rendu courant.
 *
 * Les références renvoyées sont STABLES (ce sont les fonctions de module) : seul le
 * réabonnement provoque le redessin. Un composant peut donc les mettre en dépendance
 * d'un `useMemo` sans le relancer à chaque image.
 */
export function useT() {
  useLang();
  return { t, tf, tName, tDesc, tServer };
}
