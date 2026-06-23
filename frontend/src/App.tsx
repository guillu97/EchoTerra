import { useStore } from "./store";
import { LoadingScreen } from "./screens/LoadingScreen";
import { TitleScreen } from "./screens/TitleScreen";
import { CinematicScreen } from "./screens/CinematicScreen";
import { GameScreen } from "./screens/GameScreen";
import { SettingsOverlay } from "./settings/SettingsOverlay";
import { EditorScreen } from "./editor/EditorScreen";

// The whole game lives inside a phone-shaped frame: centered with a decorative
// background on desktop, full-screen on phones (see app-shell.css).
export default function App() {
  const appScreen = useStore((s) => s.appScreen);
  const settingsScreen = useStore((s) => s.settingsScreen);

  // The editor is a full-screen dev tool, rendered outside the phone frame.
  if (appScreen === "editor") return <EditorScreen />;

  return (
    <div className="app-bg">
      <div className="device">
        {appScreen === "loading" && <LoadingScreen />}
        {appScreen === "title" && <TitleScreen />}
        {appScreen === "cinematic" && <CinematicScreen />}
        {appScreen === "game" && <GameScreen />}
        {settingsScreen && <SettingsOverlay />}
      </div>
    </div>
  );
}
