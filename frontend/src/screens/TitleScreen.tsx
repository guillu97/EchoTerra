import { useStore } from "../store";
import { Logo } from "../components/Logo";

// "Ecran de titre" — main menu.
export function TitleScreen() {
  const { startAdventure, openSettings, pushLog } = useStore();

  return (
    <div className="screen parchment">
      <div className="ornament">
        <i />
        <i />
        <i />
      </div>
      <Logo />
      <div className="menu">
        <button className="pill red" onClick={() => startAdventure()}>
          Start the game
        </button>
        <button className="pill" onClick={() => pushLog("Classement — bientôt")}>
          Ranking
        </button>
        <button className="pill" onClick={() => pushLog("Succès — bientôt")}>
          Achievement
        </button>
        <button className="pill" onClick={() => openSettings("menu")}>
          Parameter
        </button>
      </div>
      <div className="branch" />
      <div className="bird">🐦</div>
    </div>
  );
}
