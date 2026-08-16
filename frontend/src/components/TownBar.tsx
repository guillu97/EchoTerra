import { useStore } from "../store";
import { heroesInTown, townPA } from "../townUtils";
import { useT } from "../i18n/useT";

// Small header shown on town tabs: how many of MY heroes are in town and MY PA pool
// that funds construction and town actions (other players' teams don't count).
export function TownBar({ label }: { label?: string }) {
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const heroes = heroesInTown(game, playerId);
  const pa = townPA(game, playerId);
  const { t } = useT();

  return (
    <div className="town-bar">
      {label && <span className="tb-title">{label}</span>}
      <span className="tb-spacer" />
      <span className="tb-chip">🧍 {t("{n} en ville", { n: heroes.length })}</span>
      <span className="tb-chip pa">⚡ {t("{n} PA", { n: pa })}</span>
    </div>
  );
}
