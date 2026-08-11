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
import { TownJournal } from "../components/TownJournal";
import { TownLedger } from "../components/TownLedger";
import { TownChat } from "../components/TownChat";
import { WaveCinematic } from "../components/WaveCinematic";
import { GameOver } from "../components/GameOver";
import { CheatPanel } from "../components/CheatPanel";
import { Toasts } from "../ui/Toasts";

// In-game shell: persistent top bar + active tab + bottom navigation. Polls the server
// so scheduled waves (town damage, spawns) show up without manual refresh.
export function GameScreen() {
  const tab = useStore((s) => s.tab);
  const refreshGame = useStore((s) => s.refreshGame);
  const refreshChat = useStore((s) => s.refreshChat);
  const chatOpen = useStore((s) => s.chatOpen);

  useEffect(() => {
    const t = setInterval(() => refreshGame(), 20000);
    return () => clearInterval(t);
  }, [refreshGame]);

  // La messagerie a sa propre cadence : 20 s, c'est acceptable pour une vague,
  // pas pour une conversation. Sa route est légère et ne déclenche PAS le
  // rattrapage de simulation (voir townChatList côté serveur), donc sonder plus
  // vite ne coûte pas de tours de jeu. Fermée, on ralentit : le compteur de
  // non-lus voyage déjà avec le payload de partie.
  useEffect(() => {
    const t = setInterval(() => refreshChat(), chatOpen ? 4000 : 30000);
    return () => clearInterval(t);
  }, [refreshChat, chatOpen]);

  return (
    <div className="screen sky">
      <TopBar />
      <main className="tab-body">
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
      </main>
      <BottomNav />
      <HeroOverlay />
      <TownStatus />
      <TownJournal />
      <TownLedger />
      <TownChat />
      <WaveCinematic />
      <GameOver />
      <CheatPanel />
      <Toasts />
    </div>
  );
}
