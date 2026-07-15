import { useEffect } from "react";
import { useStore } from "../store";
import { useWaveRemaining, formatHMS } from "../useWave";
import { TopBar } from "../components/TopBar";
import { BottomNav } from "../components/BottomNav";
import { HomeTab } from "../tabs/HomeTab";
import { MapTab } from "../tabs/MapTab";
import { StockTab } from "../tabs/StockTab";
import { StructureTab } from "../tabs/StructureTab";
import { CraftTab } from "../tabs/CraftTab";
import { HeroOverlay } from "../components/HeroOverlay";
import { TownStatus } from "../components/TownStatus";
import { TownJournal } from "../components/TownJournal";
import { GameOver } from "../components/GameOver";
import { CheatPanel } from "../components/CheatPanel";

// In-game shell: persistent top bar + active tab + bottom navigation. Polls the server
// so scheduled waves (town damage, spawns) show up without manual refresh.
export function GameScreen() {
  const tab = useStore((s) => s.tab);
  const error = useStore((s) => s.error);
  const refreshGame = useStore((s) => s.refreshGame);

  useEffect(() => {
    const t = setInterval(() => refreshGame(), 20000);
    return () => clearInterval(t);
  }, [refreshGame]);

  return (
    <div className="screen sky">
      <TopBar />
      <WaveBanner />
      <div className="tab-body">
        {tab === "home" && <HomeTab />}
        {/* The Map tab stays mounted for the whole game session (hidden via CSS when
            inactive): unmounting it destroyed the Phaser instance — WebGL context,
            ~17 downloaded 1024² textures, normalized cubes, pillar atlas, tile layer —
            and rebuilt everything on every visit, which made the tab take seconds to
            open. Kept warm, opening the Map is instant (it even preloads in the
            background while the player is on Home). */}
        <MapTab active={tab === "map"} />
        {tab === "stock" && <StockTab />}
        {tab === "structure" && <StructureTab />}
        {tab === "craft" && <CraftTab />}
      </div>
      <BottomNav />
      <HeroOverlay />
      <TownStatus />
      <TownJournal />
      <GameOver />
      <CheatPanel />
      {error && <div className="toast">⚠️ {error}</div>}
    </div>
  );
}

// Central "PROCHAINE VAGUE" countdown (design chrome, shared by every tab).
// Overlaid on the tab body so the iso views keep their full height.
function WaveBanner() {
  const game = useStore((s) => s.game);
  const toggleTownStatus = useStore((s) => s.toggleTownStatus);
  const remaining = useWaveRemaining(game);
  if (!game || game.status !== "active") return null;
  return (
    <div className="wave-row">
      <button className="wave-banner" onClick={() => toggleTownStatus(true)} title="État de la ville">
        <span className="wb-ico">🌊</span>
        <span>
          <span className="wb-kicker">PROCHAINE VAGUE</span>
          <span className="wb-time">{formatHMS(remaining)}</span>
        </span>
      </button>
    </div>
  );
}
