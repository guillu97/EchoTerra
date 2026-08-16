// L'INTERNATIONALISATION — un seul point d'entrée pour tout le texte que lit un joueur.
//
// ⚠ LA CLÉ EST LA PHRASE FRANÇAISE, pas un identifiant inventé (`settings.title`).
// Trois raisons, et elles ont toutes coûté cher ailleurs :
//   1. le REPLI est gratuit et lisible — une traduction manquante affiche du français,
//      jamais un `settings.title` cru en plein écran ;
//   2. le code reste LISIBLE : `t("Paramètres")` se relit sans aller chercher ailleurs
//      ce que la clé contient — et ce dépôt est écrit en français, du serveur au CSS ;
//   3. il n'y a rien à inventer ni à tenir à jour pour les ~120 refus serveur, dont la
//      phrase française EST déjà l'identifiant naturel (voir game/i18n.go).
// Le prix : reformuler le français casse le lien vers l'anglais. C'est SILENCIEUX, donc
// c'est un test qui le rattrape (`npm run test:i18n` compare les clés réellement
// utilisées au catalogue anglais) — jamais l'œil.
//
// Deux formes de substitution, parce qu'il y a deux producteurs de texte :
//   t("Il reste {n} PA", { n: 3 })   — l'interface, nommé, écrit à la main ici ;
//   tf("%s est tétanisé", ["Ana"])   — le serveur, positionnel, en verbes fmt de Go.

import { EN } from "./en";

export const LANGS = ["fr", "en"] as const;
export type Lang = (typeof LANGS)[number];

/** Le nom d'une langue DANS cette langue — un anglophone cherche « English », pas « Anglais ». */
export const LANG_NAMES: Record<Lang, string> = { fr: "Français", en: "English" };

/** Le drapeau sert de repère visuel dans la liste : on retrouve sa langue sans la lire. */
export const LANG_FLAGS: Record<Lang, string> = { fr: "🇫🇷", en: "🇬🇧" };

/** Catalogues. Le français est vide PAR CONSTRUCTION : la clé est déjà le français. */
const CATALOGS: Record<Lang, Record<string, string>> = { fr: {}, en: EN };

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (LANGS as readonly string[]).includes(v);
}

// --- détection ---------------------------------------------------------------

/**
 * La langue du NAVIGATEUR, ramenée à une langue qu'on sert. C'est le défaut demandé :
 * personne ne doit avoir à régler quoi que ce soit pour lire le jeu dans sa langue.
 *
 * ⚠ on lit `navigator.languages` EN ENTIER et pas seulement `navigator.language` : un
 * navigateur réglé sur « de-DE, fr-FR, en » n'a pas d'allemand ici, mais son porteur
 * lit le français mieux que l'anglais — prendre la première langue SERVIE de sa liste
 * respecte son ordre de préférence au lieu de le jeter au premier échec.
 * Repli final en anglais : c'est la langue la plus partagée par ceux dont on ne parle
 * pas la langue.
 */
export function detectLang(): Lang {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const list: string[] = nav?.languages?.length ? [...nav.languages] : nav?.language ? [nav.language] : [];
  for (const tag of list) {
    const base = String(tag).toLowerCase().split("-")[0];
    if (isLang(base)) return base;
  }
  return "en";
}

// --- état courant ------------------------------------------------------------

let current: Lang = "fr";
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

/**
 * Change la langue affichée. Renvoie true si ça a bougé — l'appelant évite ainsi de
 * notifier tout l'arbre React pour un réglage qui n'a pas changé.
 *
 * ⚠ pose aussi `<html lang>` : ce n'est pas cosmétique, c'est ce qui dit au lecteur
 * d'écran quelle voix employer et au navigateur comment couper les mots.
 */
export function setLang(l: Lang): boolean {
  if (l === current) return false;
  current = l;
  if (typeof document !== "undefined") document.documentElement.lang = l;
  listeners.forEach((fn) => fn());
  return true;
}

/** S'abonner aux changements de langue (voir useLang dans ./useT). */
export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// --- traduction --------------------------------------------------------------

/**
 * Une clé peut porter un CONTEXTE après une barre verticale : `t("Ville|onglet")`.
 * Deux occurrences du même mot français qui ne se traduisent pas pareil selon l'endroit
 * ont ainsi chacune leur entrée, et le repli français reste la partie avant la barre.
 */
function stripContext(key: string): string {
  const bar = key.indexOf("|");
  return bar === -1 ? key : key.slice(0, bar);
}

function lookup(key: string): string {
  const cat = CATALOGS[current];
  const hit = cat[key];
  if (hit !== undefined) return hit;
  return stripContext(key);
}

export type Vars = Record<string, string | number>;

/**
 * LA fonction de traduction de l'interface. Substitution NOMMÉE `{x}` — nommée et pas
 * positionnelle parce qu'une langue réordonne les membres d'une phrase, et qu'un
 * traducteur doit pouvoir écrire « {building} needs {n} {item} » dans l'ordre anglais.
 *
 * Un `{x}` sans valeur est laissé TEL QUEL plutôt que remplacé par « undefined » : on
 * voit alors le trou dans la phrase, ce qui se signale tout seul en relecture.
 */
export function t(key: string, vars?: Vars): string {
  const s = lookup(key);
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

// --- messages du serveur -----------------------------------------------------

/**
 * Le contrat de `game.Msg` (backend/internal/game/i18n.go) : la phrase française,
 * son gabarit (qui sert de clé) et ses arguments.
 */
export interface ServerMsg {
  /** Gabarit français en verbes fmt (`%s`, `%d`) — la clé de traduction. */
  key?: string;
  /** Substitutions, dans l'ordre du gabarit. */
  args?: ServerArg[];
  /** Le français déjà rendu : le repli, et ce que gardent les archives déjà écrites. */
  text: string;
}

/**
 * Un argument de gabarit. Les trois formes en objet sont les MARQUEURS du serveur
 * (backend/internal/game/i18n.go) : elles disent « ceci est un nom de jeu », qu'il
 * faut donc traduire, par opposition à un nom de joueur qu'il ne faut surtout pas
 * toucher. Sans elles, un héros baptisé « Pierre » deviendrait « Stone ».
 */
export type ServerArg =
  | string
  | number
  | { name: string }
  | { names: string[] }
  | { items: { name: string; qty: number }[] };

/** Le connecteur d'une énumération — « Pionnier ou Chasseur ». */
function joinOr(names: string[]): string {
  const shown = names.map(tName);
  if (shown.length <= 1) return shown[0] ?? "";
  return shown.slice(0, -1).join(", ") + " " + t("ou|énumération") + " " + shown[shown.length - 1];
}

/** Une liste de matériaux chiffrés — « 6 Pierre, 2 Brique ». */
function joinItems(items: { name: string; qty: number }[]): string {
  return items.map((it) => `${it.qty} ${tName(it.name)}`).join(", ");
}

function renderArg(a: ServerArg): string {
  if (a !== null && typeof a === "object") {
    if ("name" in a) return tName(a.name);
    if ("names" in a) return joinOr(a.names);
    if ("items" in a) return joinItems(a.items);
  }
  return String(a);
}

/**
 * Rend un `%`-gabarit à la Go. Volontairement minuscule : le serveur n'émet que `%s`,
 * `%d` et `%%` dans ces phrases-là (vérifié par un test Go), donc un moteur complet
 * serait du poids mort.
 *
 * Un argument manquant laisse le verbe visible plutôt que d'écrire « undefined » —
 * même raison que pour `{x}` ci-dessus.
 */
export function sprintf(tmpl: string, args: readonly ServerArg[] = []): string {
  let i = 0;
  return tmpl.replace(/%[sd%]/g, (verb) => {
    if (verb === "%%") return "%";
    const v = args[i++];
    return v === undefined ? verb : renderArg(v);
  });
}

/**
 * Traduit un message composé par le serveur.
 *
 * ⚠ LE REPLI EST `msg.text`, PAS LA CLÉ. Le journal de la ville est PERSISTÉ : les
 * lignes écrites avant cette version n'ont pas de gabarit, et une ville qui a tourné
 * trois jours ne doit pas voir son histoire remplacée par des trous. Sans gabarit, on
 * affiche ce que le serveur avait écrit — du français, mais du français juste.
 */
export function tServer(msg: ServerMsg | null | undefined): string {
  if (!msg) return "";
  if (!msg.key) return msg.text ?? "";
  if (current === "fr") return msg.text || sprintf(msg.key, msg.args);
  const cat = CATALOGS[current];
  const tmpl = cat[msg.key];
  if (tmpl === undefined) return msg.text || sprintf(msg.key, msg.args);
  return sprintf(tmpl, msg.args);
}

/**
 * Traduit un gabarit `%` directement (le cas d'un texte serveur reçu sans enveloppe,
 * typiquement un message d'erreur HTTP dont on connaît le gabarit côté client).
 */
export function tf(key: string, args: readonly ServerArg[] = []): string {
  return sprintf(lookup(key), args);
}

/**
 * LES NOMS DE DONNÉES — objets, bâtiments, classes, monstres, états, recettes.
 *
 * ⚠ CES NOMS FRANÇAIS SONT DES IDENTIFIANTS DE JEU, jamais de simples étiquettes :
 * `craft.go` cherche littéralement « Bois », `thirst.go` pose l'état « Soif »,
 * `buildingPlanItem` compose « Plan de la Tour ». CLAUDE.md l'écrit noir sur blanc —
 * on ne les traduit PAS sur le fil. Ils voyagent en français et ne changent d'habit
 * qu'au dernier moment, ici, à l'affichage.
 *
 * Séparé de `t()` par un préfixe de contexte pour que « Poste » (le bâtiment) et
 * « Poste » (un éventuel libellé d'interface) ne se marchent jamais dessus.
 */
export function tName(name: string | undefined | null): string {
  if (!name) return "";
  const cat = CATALOGS[current];
  const hit = cat["data:" + name];
  if (hit !== undefined) return hit;
  // ⚠ LES NOMS COMPOSÉS AVEC UN NOM PROPRE. Une ruine-mémorial s'appelle « Ruines de
  // Valbourg » : le nom entier ne peut pas être une clé (chaque ville en fabriquerait
  // une nouvelle), mais son PRÉFIXE en est une. On traduit donc le préfixe et on laisse
  // le nom de la ville intact — comme on laisse intacts les noms de joueurs.
  for (const p of COMPOSED_PREFIXES) {
    if (name.startsWith(p)) {
      const t = cat["data:" + p];
      if (t !== undefined) return t + name.slice(p.length);
    }
  }
  return name;
}

/**
 * Les préfixes de noms composés côté serveur. Volontairement une LISTE EXPLICITE et
 * courte : deviner un préfixe (« tout ce qui précède une majuscule ») découperait des
 * noms ordinaires au hasard.
 */
const COMPOSED_PREFIXES = ["Ruines de "];

/**
 * Comme `tName`, pour une phrase de description venue d'un catalogue serveur
 * (effet d'objet, description de compétence, rôle de classe…).
 */
export function tDesc(desc: string | undefined | null): string {
  if (!desc) return "";
  const cat = CATALOGS[current];
  return cat["desc:" + desc] ?? desc;
}

/** Le catalogue courant — réservé aux tests et à l'outil de vérification des clés. */
export function catalogFor(l: Lang): Record<string, string> {
  return CATALOGS[l];
}
