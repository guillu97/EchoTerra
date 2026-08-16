import { useStore } from "../store";
import { heroesInTown, effectiveTownHeroId } from "../townUtils";
import { useT } from "../i18n/useT";

// Lets the player pick which of THEIR in-town heroes pays the action points for
// town work (another player's heroes are never offered — nor spendable).
export function TownWorker() {
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const townHeroId = useStore((s) => s.townHeroId);
  const setTownHero = useStore((s) => s.setTownHero);
  const { t } = useT();
  const inTown = heroesInTown(game, playerId);
  if (inTown.length === 0) return null;
  const eff = effectiveTownHeroId(game, playerId, townHeroId);

  return (
    <div className="town-worker">
      <span className="tw-label">{t("PA payés par")}</span>
      {inTown.map((h) => (
        <button
          key={h.id}
          className={`tw-chip ${h.id === eff ? "sel" : ""}`}
          onClick={() => setTownHero(h.id)}
          title={t("{name} — {n} PA", { name: h.name, n: h.pa })}
        >
          {h.name} <b>⚡{h.pa}</b>
        </button>
      ))}
    </div>
  );
}

// PA available from the currently selected town worker.
export function useWorkerPA(): number {
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const townHeroId = useStore((s) => s.townHeroId);
  const eff = effectiveTownHeroId(game, playerId, townHeroId);
  return game?.heroes.find((h) => h.id === eff)?.pa ?? 0;
}
