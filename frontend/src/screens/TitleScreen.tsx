import { useEffect, useState } from "react";
import { useStore, slotGameId, type GameSlot } from "../store";
import { Logo } from "../components/Logo";
import { assetUrl, libUrl } from "../assets";
import { api } from "../api/client";
import type { GameState } from "../api/types";
import { formatHMS } from "../useWave";
import { useT } from "../i18n/useT";

// "Ecran de titre" — main menu: resume cards (deux créneaux : solo + publique/
// privée), the ways to play, ranking + settings, and a debug section.
export function TitleScreen() {
  const T = useT();
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
        {user ? user.name : T("title.signIn")}
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
        <ResumeCard game={soloGame} kicker={T("title.resume.solo")} busy={busy} onResume={() => resumeSlot("solo")} />
      )}
      {mpGame && (
        <ResumeCard game={mpGame} kicker={T("title.resume.mp")} busy={busy} onResume={() => resumeSlot("mp")} />
      )}

      <div className="menu">
        {/* Solo : masqué si une partie solo est déjà en cours (on la reprend). */}
        {!soloGame && (
          <button className="pill red pulse" disabled={busy} onClick={() => startSoloBots()}>
            ⚔️ {T("title.solo")} <small>{T("title.solo.hint")}</small>
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
                  pushLog(T("title.public.needAccount"));
                  openAccount();
                }
              }}
            >
              🌍 {T("title.public")} {!user && <small>{T("title.public.locked")}</small>}
            </button>
            <button className="pill" onClick={() => openLobby("private")}>
              🎪 {T("title.private")}
            </button>
          </>
        )}
        <div className="menu-row">
          <button className="pill cream" onClick={() => setScreen("leaderboard")}>
            🏆 {T("title.leaderboard")}
          </button>
          <button className="pill cream" onClick={() => openSettings("menu")}>
            ⚙️ {T("title.settings")}
          </button>
        </div>
      </div>

      <div className="dev-section">
        <div className="dev-label">🛠 {T("title.debug")}</div>
        <div className="dev-btns">
          <button className="pill dev-pill" disabled={busy} onClick={() => startTestGame()}>
            🆕 {T("title.debug.newGame")}
          </button>
          <button className="pill dev-pill" disabled={busy} onClick={() => continueTestGame()}>
            ▶ {T("title.debug.continue")}
          </button>
          <button className="pill dev-pill" disabled={busy} onClick={() => startAdventure()}>
            🎬 {T("title.debug.intro")}
          </button>
          <button className="pill dev-pill" onClick={() => setScreen("editor")}>
            🗺️ {T("title.debug.editor")}
          </button>
          <button className="pill dev-pill" onClick={() => setScreen("designer")}>
            🧬 {T("title.debug.designer")}
          </button>
          <button className="pill dev-pill" onClick={() => setScreen("voxeledit")}>
            🧊 {T("title.debug.voxels")}
          </button>
          <button className="pill dev-pill" onClick={() => setScreen("charstudio")}>
            🎭 {T("title.debug.chars")}
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
  const T = useT();
  const townPct = Math.round((game.town.hp / game.town.maxHp) * 100);
  const waveSec = Math.max(0, Math.floor((new Date(game.nextWaveAt).getTime() - Date.now()) / 1000));
  const meta =
    game.status === "lobby"
      ? T("title.resume.lobby", { players: game.players.length, min: game.minPlayers })
      : T("title.resume.meta", { day: game.day, hp: townPct, timer: formatHMS(waveSec) });

  return (
    <button className="resume-card" disabled={busy} onClick={onResume}>
      <span className="thumb">
        <img src={libUrl("islands", "core-built")} alt="" />
      </span>
      <span className="body">
        <span className="kicker">{kicker}</span>
        <span className="title">{game.name || T("title.resume.expedition")}</span>
        <span className="meta">{meta}</span>
      </span>
      <span className="play">▶</span>
    </button>
  );
}
