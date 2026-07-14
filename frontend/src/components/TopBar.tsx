import { useState } from "react";
import { useStore } from "../store";
import { HeroActionsMenu } from "./HeroActionsMenu";

// Top status bar present on all in-game screens (avatar, town name, town HP, settings).
// The smiley opens the hero dropdown: roster + per-hero actions + character sheets.
export function TopBar() {
  const openSettings = useStore((s) => s.openSettings);
  const toggleTownStatus = useStore((s) => s.toggleTownStatus);
  const toggleCheat = useStore((s) => s.toggleCheat);
  const game = useStore((s) => s.game);
  const [heroMenu, setHeroMenu] = useState(false);
  const hpPct = game ? Math.round((game.town.hp / game.town.maxHp) * 100) : 100;
  const hpClass = hpPct > 60 ? "" : hpPct > 30 ? "warn" : "alert";

  return (
    <div className="topbar">
      <button className="avatar" title="Mes personnages" onClick={() => setHeroMenu((o) => !o)}>
        🙂
      </button>
      {heroMenu && <HeroActionsMenu onClose={() => setHeroMenu(false)} />}
      {/* NOT className="town": the Home container's `.town { position:absolute;
          inset:0 }` rule stretches it over the avatar and eats its clicks. */}
      <span className="town-name">TownName 1</span>
      <button className={`chip ${hpClass}`} onClick={() => toggleTownStatus(true)} title="État de la ville">
        🏰 {hpPct}%
      </button>
      <span className="chip">⭐ 6/18</span>
      <button className="iconbtn" title="Triche (dev)" onClick={toggleCheat}>
        🔧
      </button>
      <button className="iconbtn" title="Paramètres" onClick={() => openSettings("menu")}>
        ⚙️
      </button>
    </div>
  );
}
