import { useEffect } from "react";
import { useStore } from "../store";
import { TopBar } from "../components/TopBar";
import { BottomNav } from "../components/BottomNav";
import { HomeTab } from "../tabs/HomeTab";
import { MapTab } from "../tabs/MapTab";
import { StockTab } from "../tabs/StockTab";
import { StructureTab } from "../tabs/StructureTab";
import { CraftTab } from "../tabs/CraftTab";
import { HeroOverlay } from "../components/HeroOverlay";
import { TownStatus } from "../components/TownStatus";
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
      <div className="tab-body">
        {tab === "home" && <HomeTab />}
        {tab === "map" && <MapTab />}
        {tab === "stock" && <StockTab />}
        {tab === "structure" && <StructureTab />}
        {tab === "craft" && <CraftTab />}
      </div>
      <BottomNav />
      <HeroOverlay />
      <TownStatus />
      <GameOver />
      <CheatPanel />
      {error && <div className="toast">⚠️ {error}</div>}
    </div>
  );
}
