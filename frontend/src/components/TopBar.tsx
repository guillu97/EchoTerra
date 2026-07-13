import { useStore } from "../store";
import { useWaveRemaining } from "../useWave";

// Compact countdown: mm:ss under an hour, h:mm:ss above.
function fmtCountdown(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  if (s >= 3600) return `${Math.floor(s / 3600)}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

// Top status bar present on all in-game screens: avatar (character screen), town
// name + day/wave, town HP gauge, next-wave countdown, settings.
export function TopBar() {
  const openSettings = useStore((s) => s.openSettings);
  const toggleTownStatus = useStore((s) => s.toggleTownStatus);
  const toggleCheat = useStore((s) => s.toggleCheat);
  const openHero = useStore((s) => s.openHero);
  const game = useStore((s) => s.game);
  const selectedHeroId = useStore((s) => s.selectedHeroId);
  const remaining = useWaveRemaining(game);

  const hpPct = game ? Math.round((game.town.hp / game.town.maxHp) * 100) : 100;
  const hpClass = hpPct > 60 ? "" : hpPct > 30 ? "warn" : "alert";
  const waveSoon = remaining > 0 && remaining <= 60;
  const townName = game?.town.name || game?.name || "Echo Terra";

  const openCharacter = () => {
    const id = selectedHeroId ?? game?.heroes[0]?.id;
    if (id) openHero(id);
  };

  return (
    <div className="topbar">
      <button className="avatar" title="Personnage" onClick={openCharacter}>
        🙂
      </button>
      <button className="tb-title" onClick={() => toggleTownStatus(true)} title="État de la ville">
        <span className="tb-town">{townName}</span>
        <span className="tb-sub">
          Jour {game?.day ?? 1} · Vague {game?.waveNumber ?? 0}
        </span>
      </button>
      <button className={`chip hp ${hpClass}`} onClick={() => toggleTownStatus(true)} title="Points de vie de la ville">
        🏰
        <i className="bar">
          <i style={{ width: `${hpPct}%` }} />
        </i>
        {hpPct}%
      </button>
      {game?.status === "active" && game.nextWaveAt && (
        <button
          className={`chip wave ${waveSoon ? "alert" : ""}`}
          onClick={() => toggleTownStatus(true)}
          title="Prochaine vague"
        >
          🌊 {fmtCountdown(remaining)}
        </button>
      )}
      {import.meta.env.DEV && (
        <button className="iconbtn" title="Triche (dev)" onClick={toggleCheat}>
          🔧
        </button>
      )}
      <button className="iconbtn" title="Paramètres" onClick={() => openSettings("menu")}>
        ⚙️
      </button>
    </div>
  );
}
