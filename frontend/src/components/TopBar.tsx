import { useStore } from "../store";

// Top status bar present on all in-game screens (avatar, town name, town HP, settings).
export function TopBar() {
  const openSettings = useStore((s) => s.openSettings);
  const toggleTownStatus = useStore((s) => s.toggleTownStatus);
  const toggleCheat = useStore((s) => s.toggleCheat);
  const openHero = useStore((s) => s.openHero);
  const game = useStore((s) => s.game);
  const selectedHeroId = useStore((s) => s.selectedHeroId);
  const hpPct = game ? Math.round((game.town.hp / game.town.maxHp) * 100) : 100;
  const hpClass = hpPct > 60 ? "" : hpPct > 30 ? "warn" : "alert";

  const openCharacter = () => {
    const id = selectedHeroId ?? game?.heroes[0]?.id;
    if (id) openHero(id);
  };

  return (
    <div className="topbar">
      <button className="avatar" title="Personnage" onClick={openCharacter}>
        🙂
      </button>
      <span className="town">TownName 1</span>
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
