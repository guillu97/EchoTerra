import { Fragment, type ReactNode } from "react";
import { t } from "./index";
import type { TKey, TParams } from "./types";

/**
 * TRADUCTION AVEC DES MORCEAUX DE JSX — `tx("map.hint.stuck", { name: <strong>…</strong> })`.
 *
 * ⚠ Pourquoi ça existe : les phrases du jeu mettent le nom du héros en gras au
 * MILIEU (« ⚠️ **Rhun** est Tétanisé — tue le pack ou fuis »). Découper la
 * phrase en trois bouts autour du gras marche en français et NULLE PART
 * ailleurs : le japonais met le sujet ailleurs, l'allemand rejette le verbe à
 * la fin. La phrase doit donc rester ENTIÈRE dans le fichier de langue, avec
 * son `{name}` où la langue le veut, et c'est le RENDU qui y glisse le nœud.
 *
 * ⚠ Un paramètre absent est laissé tel quel (« {name} ») plutôt que supprimé :
 * un trou visible se corrige, un mot avalé en silence ne se voit jamais.
 */
export function tx(key: TKey, params: Record<string, ReactNode>): ReactNode {
  // Les valeurs simples passent par `t()` pour garder UNE seule implémentation
  // de l'interpolation ; seuls les nœuds React sont recousus ici.
  const scalars: TParams = {};
  for (const [k, v] of Object.entries(params))
    if (typeof v === "string" || typeof v === "number") scalars[k] = v;
  const raw = t(key, scalars);

  const parts = raw.split(/(\{\w+\})/g);
  return (
    <>
      {parts.map((piece, i) => {
        const m = /^\{(\w+)\}$/.exec(piece);
        if (!m) return <Fragment key={i}>{piece}</Fragment>;
        const node = params[m[1]];
        return <Fragment key={i}>{node === undefined ? piece : node}</Fragment>;
      })}
    </>
  );
}
