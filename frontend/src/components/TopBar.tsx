import { useStore } from "../store";

// Top status bar present on all in-game screens. Every region is a large, clearly
// tappable button: 🙂 character, 🏰 town status, ⚡ per-hero actions recap, 🔧 cheat
// (dev), ⚙️ settings.
export function TopBar() {
  const openSettings = useStore((s) => s.openSettings);
  const toggleTownStatus = useStore((s) => s.toggleTownStatus);
  const toggleCheat = useStore((s) => s.toggleCheat);
  const toggleActionsRecap = useStore((s) => s.toggleActionsRecap);
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
      <button className="tb-btn avatar" title="Personnage" onClick={openCharacter}>
        🙂
      </button>
      <button className={`tb-btn tb-town ${hpClass}`} onClick={() => toggleTownStatus(true)} title="État de la ville">
        🏰 <b>{hpPct}%</b>
      </button>
      <button className="tb-btn" title="Actions des héros" onClick={() => toggleActionsRecap(true)}>
        ⚡ <span className="tb-label">Actions</span>
      </button>
      <button className="tb-btn" title="Triche (dev)" onClick={toggleCheat}>
        🔧
      </button>
      <button className="tb-btn" title="Paramètres" onClick={() => openSettings("menu")}>
        ⚙️
      </button>
    </div>
  );
}
