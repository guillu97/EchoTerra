import { useStore } from "../store";
import { NAV_TABS } from "../data/buildings";
import { heroesInTown, TOWN_TABS } from "../townUtils";
import type { Tab } from "../store";

// Bottom navigation: Ville · Carte · Sac · Bâtir · Craft.
// Town tabs are only reachable when at least one hero stands on the town tile.
export function BottomNav() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const game = useStore((s) => s.game);
  const inTown = heroesInTown(game).length > 0;

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
            title={disabled ? "Aucun héros dans la ville" : t.label}
            onClick={() => setTab(t.id as Tab)}
          >
            <span className="ni">
              {t.icon}
              {disabled && <span className="lock">🔒</span>}
            </span>
            <span className="nl">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
