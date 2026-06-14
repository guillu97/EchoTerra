import { useStore } from "../store";
import { heroesInTown, effectiveTownHeroId } from "../townUtils";

// Lets the player pick which in-town hero pays the action points for town work.
export function TownWorker() {
  const game = useStore((s) => s.game);
  const townHeroId = useStore((s) => s.townHeroId);
  const setTownHero = useStore((s) => s.setTownHero);
  const inTown = heroesInTown(game);
  if (inTown.length === 0) return null;
  const eff = effectiveTownHeroId(game, townHeroId);

  return (
    <div className="town-worker">
      <span className="tw-label">PA payés par</span>
      {inTown.map((h) => (
        <button
          key={h.id}
          className={`tw-chip ${h.id === eff ? "sel" : ""}`}
          onClick={() => setTownHero(h.id)}
          title={`${h.name} — ${h.pa} PA`}
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
  const townHeroId = useStore((s) => s.townHeroId);
  const eff = effectiveTownHeroId(game, townHeroId);
  return game?.heroes.find((h) => h.id === eff)?.pa ?? 0;
}
