import { useStore } from "./store";
import { LoadingScreen } from "./screens/LoadingScreen";
import { TitleScreen } from "./screens/TitleScreen";
import { CinematicScreen } from "./screens/CinematicScreen";
import { LobbyScreen } from "./screens/LobbyScreen";
import { AccountScreen } from "./screens/AccountScreen";
import { GameScreen } from "./screens/GameScreen";
import { SettingsOverlay } from "./settings/SettingsOverlay";
import { EditorScreen } from "./editor/EditorScreen";
import { DesignerScreen } from "./designer/DesignerScreen";
import { VoxelBench } from "./voxel/VoxelBench";
import { VoxelEditScreen } from "./voxeledit/VoxelEditScreen";

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

  return (
    <div className="app-bg">
      <div className="device">
        {appScreen === "loading" && <LoadingScreen />}
        {appScreen === "title" && <TitleScreen />}
        {appScreen === "cinematic" && <CinematicScreen />}
        {appScreen === "lobby" && <LobbyScreen />}
        {appScreen === "account" && <AccountScreen />}
        {appScreen === "game" && <GameScreen />}
        {settingsScreen && <SettingsOverlay />}
      </div>
    </div>
  );
}
