// ─────────────────────────────────────────────────────────────────────────────
// TRADUIRE CE QUE LE SERVEUR ENVOIE — sans jamais toucher à la valeur.
//
// Le backend parle français : un état s'appelle `"Tétanisé"`, un objet
// `"Ration d'eau"`, un plan `"Plan de la Tour"`. Ces chaînes sont des
// IDENTIFIANTS qui se trouvent être français — le code les COMPARE
// (`states.includes("Tétanisé")`, `name === "Ration d'eau"`), les recettes s'en
// servent, les bots aussi. Les traduire côté serveur casserait tout le jeu.
//
// Ce module fait donc la seule chose honnête : il laisse la valeur tranquille
// et traduit son AFFICHAGE. ⚠ Une valeur inconnue est rendue TELLE QUELLE
// plutôt que remplacée par un point d'interrogation — un objet ajouté au
// backend et pas encore traduit doit rester lisible en français, pas devenir
// invisible.
// ─────────────────────────────────────────────────────────────────────────────

import { t } from "./index";
import type { TKey } from "./types";

/** État de héros sur la carte : la valeur serveur → son libellé traduit. */
const STATE_KEYS: Record<string, TKey> = {
  "Tétanisé": "state.tetanise",
  "Caché": "state.cache",
  "Blessé": "state.blesse",
  Fatigue: "state.fatigue",
  Soif: "state.soif",
  "Gelé": "state.gele",
};

export function stateLabel(state: string): string {
  const key = STATE_KEYS[state];
  return key ? t(key) : state;
}

/** La liste d'états d'un héros, traduite, dans l'ordre où le serveur l'envoie. */
export function stateLabels(states: readonly string[] | undefined): string[] {
  return (states ?? []).map(stateLabel);
}
