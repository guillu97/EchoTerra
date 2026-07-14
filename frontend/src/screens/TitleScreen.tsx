import { useStore } from "../store";
import { Logo } from "../components/Logo";
import { assetUrl } from "../assets";

// "Ecran de titre" — main menu: the three ways to play (solo, public, private),
// settings, and a debug section (dev/test flows).
export function TitleScreen() {
  const {
    openSettings,
    openLobby,
    openAccount,
    startAdventure,
    startSoloBots,
    pushLog,
    startTestGame,
    continueTestGame,
    busy,
    setScreen,
    user,
  } = useStore();

  return (
    <div className="screen parchment">
      <button className="account-chip" onClick={() => openAccount()}>
        👤 {user ? user.name : "Connexion"}
      </button>
      <div className="ornament">
        <i />
        <i />
        <i />
      </div>
      <Logo />
      <div className="menu">
        <button className="pill red" disabled={busy} onClick={() => startSoloBots()}>
          🤖 Solo <small>(avec 4 bots)</small>
        </button>
        <button className="pill" onClick={() => openLobby("public")}>
          🌍 Parties publiques
        </button>
        <button className="pill" onClick={() => openLobby("private")}>
          🎪 Parties privées
        </button>
        <button className="pill" onClick={() => openSettings("menu")}>
          ⚙️ Paramètres
        </button>
      </div>

      <div className="dev-section">
        <div className="dev-label">🛠 Debug</div>
        <div className="dev-btns">
          <button className="pill dev-pill" disabled={busy} onClick={() => startTestGame()}>
            🆕 Nouvelle partie test
          </button>
          <button className="pill dev-pill" disabled={busy} onClick={() => continueTestGame()}>
            ▶ Continuer
          </button>
          <button className="pill dev-pill" disabled={busy} onClick={() => startAdventure()}>
            🎬 Intro
          </button>
          <button className="pill dev-pill" onClick={() => setScreen("editor")}>
            🗺️ Éditeur
          </button>
          <button className="pill dev-pill" onClick={() => setScreen("designer")}>
            🧬 Données
          </button>
          <button className="pill dev-pill" onClick={() => pushLog("Classement — bientôt")}>
            🏆 Classement
          </button>
        </div>
      </div>

      <div className="branch" />
      <div className="bird">
        {assetUrl("bird") ? <img src={assetUrl("bird")} alt="🐦" /> : "🐦"}
      </div>
    </div>
  );
}
