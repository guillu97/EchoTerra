import type { WaveForecast } from "./api/types";

// LA PRÉVISION DE VAGUE, MISE EN MOTS UNE SEULE FOIS.
//
// Le serveur (game/orders.go) rend des NOMBRES ; le joueur, lui, lit une pastille de
// quatre caractères sur un téléphone. « −0/16 » y a été compris comme une fraction
// (« 0 sur 16 ») alors que c'est une FOURCHETTE de PV perdus — rapporté en jeu, et
// c'est la lecture naturelle du slash. D'où les deux règles d'ici :
//
//   - le séparateur d'une fourchette est « … », jamais « / » ;
//   - le chiffre porte son UNITÉ (PV), sinon il ne veut rien dire hors contexte.
//
// Et surtout, la même phrase sert la pastille de la TopBar, son aria-label, son
// title et la feuille « État de la ville » : sur un écran tactile il n'y a pas de
// survol pour révéler un title, donc la version longue DOIT exister ailleurs — mais
// elle ne peut pas diverger de la courte.
export function damageRange(f: WaveForecast): string {
  if (f.damageMax <= 0) return "0";
  if (f.damageMin === f.damageMax) return `−${f.damageMax}`;
  return `−${f.damageMin}…${f.damageMax}`;
}

// Ce que la pastille rouge de la TopBar veut dire, en une phrase.
export function damageSentence(f: WaveForecast): string {
  if (f.damageMax <= 0) return "La défense absorbe la prochaine vague : aucun dégât attendu.";
  if (f.damageMin === f.damageMax)
    return `La prochaine vague coûterait ${f.damageMax} PV à la ville.`;
  return `La prochaine vague coûterait entre ${f.damageMin} et ${f.damageMax} PV à la ville.`;
}

// D'où vient la précision — le progrès doit se voir (Tour de guet + observateurs).
export function precisionSentence(f: WaveForecast): string {
  const src =
    f.tower === 0
      ? "sans Tour de guet, on devine"
      : `Tour niv.${f.tower}, ${f.scouts} observateur${f.scouts > 1 ? "s" : ""}`;
  return `Horde estimée entre ${f.min} et ${f.max} contre ${f.defense} de défense · fiable à ${f.precision}% (${src}).`;
}

// LE LEVIER : ces créatures-là entrent dans la puissance de la horde, donc les
// abattre fait baisser le chiffre sous les yeux du joueur (wave.go).
export function besiegingSentence(f: WaveForecast): string {
  return f.besieging > 0
    ? `${f.besieging} créature${f.besieging > 1 ? "s" : ""} aux abords — les abattre fait baisser ce chiffre.`
    : "Abords dégagés.";
}
