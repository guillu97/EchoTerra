import { useEffect, useState } from "react";
import { useStore } from "../store";
import { buildingName } from "../data/buildings";

// LE MOMENT DE LA VAGUE.
//
// La horde qui frappe est le battement du jeu — et c'était trois lignes de log.
// C'est aussi le pire instant côté client : le serveur résout la vague (mesuré
// jusqu'à 1,3 s en local, davantage en déploiement où la fonction se réveille),
// puis des centaines de créatures apparaissent d'un coup et la frame suivante
// devient très lourde. Cette cinématique couvre exactement cette fenêtre.
//
// ⚠ ELLE EST EN CSS PUR, et c'est la décision qui compte ici. Une animation
// pilotée en JS (rAF, compteurs animés) se figerait précisément au moment qu'on
// cherche à masquer, puisque c'est le thread principal qui maille et qui rend.
// Les keyframes sur `transform`/`opacity` tournent sur le compositeur : elles
// continuent de se dérouler pendant que le reste peine. Aucun `setTimeout`
// n'anime quoi que ce soit ici — ils ne font qu'avancer les ÉTAPES.

type Phase = "strike" | "report";

// Le composant monté en permanence ne fait que router : la cinématique elle-même
// est REMONTÉE à chaque vague (`key`). Sans ça, `phase` survivait d'une vague à
// l'autre et la nouvelle s'ouvrait sur le RAPPORT le temps d'une frame — l'effet
// qui remet « strike » ne tourne qu'APRÈS le premier rendu.
export function WaveCinematic() {
  const cinema = useStore((s) => s.waveCinema);
  if (!cinema) return null;
  return <WaveCinematicRun key={cinema.report.wave} cinema={cinema} />;
}

function WaveCinematicRun({ cinema }: { cinema: NonNullable<ReturnType<typeof useStore.getState>["waveCinema"]> }) {
  const dismiss = useStore((s) => s.dismissWaveCinema);
  const [phase, setPhase] = useState<Phase>("strike");

  useEffect(() => {
    // 1,6 s de frappe, puis le rapport. Si le thread principal était bloqué, le
    // timer arrive en retard : tant mieux, la cinématique aura duré le temps
    // qu'il fallait.
    const t = setTimeout(() => setPhase("report"), 1600);
    return () => clearTimeout(t);
  }, []);

  // Échap ferme, comme toute modale (ui/Overlay) — deuxième sortie, au cas où le
  // bouton serait hors écran sur un très petit téléphone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (phase === "strike") setPhase("report");
      else dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, dismiss]);

  const { report: r, waves, townDamage } = cinema;
  // ⚠ Go sérialise une slice vide en `null`, pas en `[]` : lire `.length`
  // directement sur ces deux champs plantait le rendu dès qu'une vague ne
  // touchait ni bâtiment ni héros — c'est-à-dire le cas courant.
  const heroesHit = r.heroesHit ?? [];
  // Un même bâtiment peut être touché plusieurs fois dans une vague : on cumule
  // (« Panneau -5 · Panneau -11 » ne veut rien dire pour un lecteur).
  const buildingsHit = Object.values(
    (r.buildingsHit ?? []).reduce<Record<string, { id: string; name: string; delta: number }>>((acc, b) => {
      acc[b.id] = acc[b.id] ? { ...acc[b.id], delta: acc[b.id].delta + b.delta } : { ...b };
      return acc;
    }, {}),
  );
  const many = waves > 1;
  const breached = r.defense < r.hordePower;

  return (
    <div
      className={`wavecine ${phase}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Vague ${r.wave}`}
      // Taper pendant la frappe passe au rapport : on ne retient personne.
      onClick={() => (phase === "strike" ? setPhase("report") : undefined)}
    >
      <div className="wc-sky" />
      <div className="wc-strike">
        <div className="wc-kicker">{many ? `${waves} vagues pendant ton absence` : `Jour ${r.day}`}</div>
        <div className="wc-title">VAGUE {r.wave}</div>
        <div className="wc-sub">
          {breached ? "La horde a percé les défenses" : "Les murs ont tenu"}
        </div>
        {townDamage > 0 && <div className="wc-hit">−{townDamage} PV</div>}
      </div>

      {phase === "report" && (
        <div className="wc-card">
          <div className="wc-head">
            <span className="wc-h-title">📜 Rapport de vague</span>
            <span className="wc-h-day">
              {many ? `Vagues ${r.wave - waves + 1}–${r.wave}` : `Vague ${r.wave}`} · Jour {r.day}
            </span>
          </div>

          <div className="wc-duel">
            <div className="wc-side horde">
              <span className="wc-n">{r.hordePower}</span>
              <span className="wc-l">Horde</span>
            </div>
            <span className="wc-vs">vs</span>
            <div className="wc-side def">
              <span className="wc-n">{r.defense}</span>
              <span className="wc-l">Défense</span>
            </div>
          </div>

          <ul className="wc-lines">
            <li>
              <span>🏰 Ville</span>
              <b className={townDamage > 0 ? "bad" : "ok"}>
                {townDamage > 0 ? `−${townDamage} PV` : "intacte"}
              </b>
            </li>
            <li>
              <span>❤️ PV restants</span>
              <b>{r.townHpAfter}</b>
            </li>
            {buildingsHit.length > 0 && (
              <li>
                <span>🧱 Bâtiments</span>
                <b className="bad">
                  {buildingsHit.map((b) => `${buildingName(b.id, b.name)} ${b.delta}`).join(" · ")}
                </b>
              </li>
            )}
            {heroesHit.length > 0 && (
              <li>
                <span>⚔️ Hors les murs</span>
                <b className="bad">{heroesHit.map((h) => `${h.name} ${h.delta}`).join(" · ")}</b>
              </li>
            )}
            {r.monstersSpawned > 0 && (
              <li>
                <span>👹 Renforts</span>
                <b>+{r.monstersSpawned} packs</b>
              </li>
            )}
          </ul>

          {/* ⚠ IL FAUT TOUJOURS UNE SORTIE. La ville tombée n'affichait QUE la
              ligne « La ville est tombée » : plus aucun bouton, et cette
              cinématique passe au-dessus de tout (--z-modal-top, au-dessus de
              l'écran de fin) — le joueur restait bloqué sur son rapport, sans
              retour au menu ni nouvelle partie. Le rapport de la dernière vague
              se lit, PUIS on rend la main. */}
          {r.gameOver && <div className="wc-fallen">💀 La ville est tombée.</div>}
          <button className="pill red wc-go" onClick={dismiss} autoFocus>
            {r.gameOver ? "Voir le bilan" : "Continuer"}
          </button>
        </div>
      )}
    </div>
  );
}
