import { useStore } from "../store";
import { NAV_TABS } from "../data/buildings";
import { heroesInTown, TOWN_TABS } from "../townUtils";
import type { Tab } from "../store";

// Bottom navigation: Home · Map · Stock · Structure · Craft.
// Town tabs are only reachable when one of MY heroes stands on the town tile
// (another player's hero being in town doesn't open MY city screen).
export function BottomNav() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const inTown = heroesInTown(game, playerId).length > 0;

  return (
    <nav className="bottom-nav">
      {NAV_TABS.map((t) => {
        const isTownTab = (TOWN_TABS as readonly string[]).includes(t.id);
        const disabled = isTownTab && !inTown;
        return (
          <button
            key={t.id}
            className={`${tab === t.id ? "active" : ""} ${disabled ? "locked" : ""}`}
            disabled={disabled}
            title={disabled ? "Aucun de tes héros dans la ville" : t.label}
            onClick={() => setTab(t.id as Tab)}
          >
            <span className="ni">{disabled ? "🔒" : t.icon}</span>
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
