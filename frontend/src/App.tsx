import { useStore } from "./store";
import { LoadingScreen } from "./screens/LoadingScreen";
import { TitleScreen } from "./screens/TitleScreen";
import { CinematicScreen } from "./screens/CinematicScreen";
import { LobbyScreen } from "./screens/LobbyScreen";
import { AccountScreen } from "./screens/AccountScreen";
import { LeaderboardScreen } from "./screens/LeaderboardScreen";
import { GameScreen } from "./screens/GameScreen";
import { SettingsOverlay } from "./settings/SettingsOverlay";
import { EditorScreen } from "./editor/EditorScreen";
import { DesignerScreen } from "./designer/DesignerScreen";
import { VoxelBench } from "./voxel/VoxelBench";
import { VoxelEditScreen } from "./voxeledit/VoxelEditScreen";
import { CharStudioScreen } from "./charstudio/CharStudioScreen";
import { ErrorBoundary } from "./ui/ErrorBoundary";

// The app shell is full-bleed at every viewport size: `.device` is simply the
// full-viewport container (see app-shell.css) — the old phone/tablet frame on
// desktop is gone.
export default function App() {
  const appScreen = useStore((s) => s.appScreen);
  const settingsScreen = useStore((s) => s.settingsScreen);

  // The editor and the data studio are full-screen dev tools, outside the app shell.
  if (appScreen === "editor") return <EditorScreen />;
  if (appScreen === "designer") return <DesignerScreen />;
  if (appScreen === "voxelbench") return <VoxelBench />;
  if (appScreen === "voxeledit") return <VoxelEditScreen />;
  if (appScreen === "charstudio") return <CharStudioScreen />;

  return (
    <div className="app-bg">
      <div className="device">
        {/* Sans ce garde-fou, une exception de rendu laissait un écran BLANC. */}
        <ErrorBoundary>
          {appScreen === "loading" && <LoadingScreen />}
          {appScreen === "title" && <TitleScreen />}
          {appScreen === "cinematic" && <CinematicScreen />}
          {appScreen === "lobby" && <LobbyScreen />}
          {appScreen === "account" && <AccountScreen />}
          {appScreen === "leaderboard" && <LeaderboardScreen />}
          {appScreen === "game" && <GameScreen />}
          {settingsScreen && <SettingsOverlay />}
        </ErrorBoundary>
      </div>
    </div>
  );
}
