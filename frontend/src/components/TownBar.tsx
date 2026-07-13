import { useStore } from "../store";
import { heroesInTown, townPA } from "../townUtils";

// Small header shown on town tabs: how many of MY heroes are in town and MY PA pool
// that funds construction and town actions (other players' teams don't count).
export function TownBar({ label }: { label?: string }) {
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const heroes = heroesInTown(game, playerId);
  const pa = townPA(game, playerId);

  return (
    <div className="town-bar">
      {label && <span className="tb-title">{label}</span>}
      <span className="tb-spacer" />
      <span className="tb-chip">🧍 {heroes.length} en ville</span>
      <span className="tb-chip pa">⚡ {pa} PA</span>
    </div>
  );
}
