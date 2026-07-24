import { useEffect, useState } from "react";
import { useStore, slotGameId, type GameSlot } from "../store";
import { Logo } from "../components/Logo";
import { assetUrl, libUrl } from "../assets";
import { api } from "../api/client";
import type { GameState } from "../api/types";
import { formatHMS } from "../useWave";

// "Ecran de titre" — main menu: resume cards (deux créneaux : solo + publique/
// privée), the ways to play, ranking + settings, and a debug section.
export function TitleScreen() {
  const {
    openSettings,
    openLobby,
    openAccount,
    startAdventure,
    startSoloBots,
    resumeSlot,
    pushLog,
    startTestGame,
    continueTestGame,
    busy,
    setScreen,
    user,
  } = useStore();

  // Parties en cours dans chaque créneau (null = créneau vide). Un joueur peut
  // avoir UNE partie solo ET UNE partie publique/privée simultanément.
  const soloGame = useSlotGame("solo");
  const mpGame = useSlotGame("mp");

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

      {/* Quand une partie tourne dans un créneau, on ne montre QUE « Reprendre »
          pour ce créneau (le bouton d'entrée correspondant est masqué). */}
      {soloGame && (
        <ResumeCard game={soloGame} kicker="REPRENDRE — SOLO" busy={busy} onResume={() => resumeSlot("solo")} />
      )}
      {mpGame && (
        <ResumeCard game={mpGame} kicker="REPRENDRE — PARTIE" busy={busy} onResume={() => resumeSlot("mp")} />
      )}

      <div className="menu">
        {/* Solo : masqué si une partie solo est déjà en cours (on la reprend). */}
        {!soloGame && (
          <button className="pill red pulse" disabled={busy} onClick={() => startSoloBots()}>
            ⚔️ Solo <small>(avec 4 bots)</small>
          </button>
        )}
        {/* Publiques/privées : un seul créneau « mp ». Masqués tant qu'une partie
            publique/privée est en cours (impossible d'être dans deux à la fois). */}
        {!mpGame && (
          <>
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
          </>
        )}
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
          <button className="pill dev-pill" onClick={() => setScreen("charstudio")}>
            🎭 Persos
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

// Charge la partie mémorisée dans un créneau (ou undefined si vide / terminée /
// introuvable). Best-effort : un échec réseau laisse simplement le bouton caché.
function useSlotGame(slot: GameSlot): GameState | undefined {
  const [game, setGame] = useState<GameState | undefined>();
  useEffect(() => {
    const id = slotGameId(slot);
    if (!id) {
      setGame(undefined);
      return;
    }
    let alive = true;
    api
      .getGame(id)
      .then((g) => {
        if (alive) setGame(g.status === "gameover" ? undefined : g);
      })
      .catch(() => {
        if (alive) setGame(undefined);
      });
    return () => {
      alive = false;
    };
  }, [slot]);
  return game;
}

// "Reprendre ta partie" — carte de reprise d'un créneau.
function ResumeCard({
  game,
  kicker,
  onResume,
  busy,
}: {
  game: GameState;
  kicker: string;
  onResume: () => void;
  busy: boolean;
}) {
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
        <span className="kicker">{kicker}</span>
        <span className="title">{game.name || "Expédition"}</span>
        <span className="meta">{meta}</span>
      </span>
      <span className="play">▶</span>
    </button>
  );
}
