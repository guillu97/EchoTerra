import { useStore } from "../store";
import { heroesInTown, townPA } from "../townUtils";

// Small header shown on town tabs: how many heroes are in town and the shared PA pool
// that funds construction and town actions.
export function TownBar({ label }: { label?: string }) {
  const game = useStore((s) => s.game);
  const heroes = heroesInTown(game);
  const pa = townPA(game);

  return (
    <div className="town-bar">
      {label && <span className="tb-title">{label}</span>}
      <span className="tb-spacer" />
      <span className="tb-chip">🧍 {heroes.length} en ville</span>
      <span className="tb-chip pa">⚡ {pa} PA</span>
    </div>
  );
}
