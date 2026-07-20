import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Logo } from "../components/Logo";
import { assetUrl, libUrl } from "../assets";
import { api } from "../api/client";
import type { GameState } from "../api/types";
import { formatHMS } from "../useWave";

const LS_GAME = "echoterra:gameId";

// "Ecran de titre" — main menu: resume card, the three ways to play (solo,
// public, private), ranking + settings, and a debug section (dev/test flows).
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
        <span className="avatar">{user ? "🦊" : "👤"}</span>
        {user ? user.name : "Connexion"}
      </button>
      <div className="ornament">
        <i />
        <i />
        <i />
      </div>
      <Logo />

      {/* La reprise n'apparaît QUE si le joueur est connecté : sans compte on ne
          sait pas quel joueur reprendre (identité ambiguë en multijoueur). */}
      {user && <ResumeCard onResume={() => continueTestGame()} busy={busy} />}

      <div className="menu">
        <button className="pill red pulse" disabled={busy} onClick={() => startSoloBots()}>
          ⚔️ Solo <small>(avec 4 bots)</small>
        </button>
        {/* Une partie publique exige un compte (identité stable du joueur). Sans
            connexion, le bouton mène à l'écran de connexion. */}
        <button
          className="pill"
          onClick={() => {
            if (user) {
              openLobby("public");
            } else {
              pushLog("🔒 Connecte-toi pour rejoindre une partie publique.");
              openAccount();
            }
          }}
        >
          🌍 Parties publiques {!user && <small>🔒 connexion requise</small>}
        </button>
        <button className="pill" onClick={() => openLobby("private")}>
          🎪 Parties privées
        </button>
        <div className="menu-row">
          <button className="pill cream" onClick={() => pushLog("Classement — bientôt")}>
            🏆 Classement
          </button>
          <button className="pill cream" onClick={() => openSettings("menu")}>
            ⚙️ Paramètres
          </button>
        </div>
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
          <button className="pill dev-pill" onClick={() => setScreen("voxeledit")}>
            🧊 Voxels
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

// "Reprendre ta partie" — shown when the last played game still exists server-side.
function ResumeCard({ onResume, busy }: { onResume: () => void; busy: boolean }) {
  const [game, setGame] = useState<GameState | undefined>();

  useEffect(() => {
    const id = localStorage.getItem(LS_GAME);
    if (!id) return;
    let alive = true;
    api
      .getGame(id)
      .then((g) => {
        if (alive && g.status !== "gameover") setGame(g);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!game) return null;

  const townPct = Math.round((game.town.hp / game.town.maxHp) * 100);
  const waveSec = Math.max(0, Math.floor((new Date(game.nextWaveAt).getTime() - Date.now()) / 1000));
  const meta =
    game.status === "lobby"
      ? `Salon en attente · ${game.players.length}/${game.minPlayers} joueurs`
      : `Jour ${game.day} · 🏰 ${townPct}% · 🌊 ${formatHMS(waveSec)}`;

  return (
    <button className="resume-card" disabled={busy} onClick={onResume}>
      <span className="thumb">
        <img src={libUrl("islands", "core-built")} alt="" />
      </span>
      <span className="body">
        <span className="kicker">REPRENDRE TA PARTIE</span>
        <span className="title">{game.name || "Expédition"}</span>
        <span className="meta">{meta}</span>
      </span>
      <span className="play">▶</span>
    </button>
  );
}
