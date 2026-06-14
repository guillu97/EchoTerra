import { useStore } from "../store";

// Roster chips (left side, above the nav). Tapping selects the active hero. The
// character screen is opened from the top-left avatar, not from here.
const FALLBACK_ROLES = ["Pioneer", "Collector", "Scout"];

export function HeroChips() {
  const game = useStore((s) => s.game);
  const selectedHeroId = useStore((s) => s.selectedHeroId);
  const selectHero = useStore((s) => s.selectHero);
  if (!game) return null;

  return (
    <div className="hero-chips">
      {game.heroes.slice(0, 3).map((h, i) => (
        <button
          key={h.id}
          className={`hc ${h.id === selectedHeroId ? "sel" : ""}`}
          onClick={() => selectHero(h.id)}
        >
          <span className="dot">{h.name[0]}</span>
          {h.class && h.class !== "Sans classe" ? h.class : FALLBACK_ROLES[i] || h.name}
          <span className="star">★</span>
        </button>
      ))}
    </div>
  );
}
