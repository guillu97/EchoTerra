import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Logo } from "../components/Logo";

// Multiplayer entry: create a game, join one by code (or from the open-lobby list),
// then wait in the salon until enough players have joined and the host launches.
export function LobbyScreen() {
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const inLobby = game?.status === "lobby" && !!playerId;

  return (
    <div className="screen parchment lobby-screen">
      {inLobby ? <WaitingRoom /> : <LobbyForms />}
    </div>
  );
}

// Per-lobby flavor icon (no server data for this yet — stable pick by name).
const LOBBY_ICONS = ["🌲", "⛰️", "🏜️", "🌊", "🌸"];
const lobbyIcon = (name: string) =>
  LOBBY_ICONS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % LOBBY_ICONS.length];

// --- create / join forms -----------------------------------------------------

function LobbyForms() {
  const {
    playerName,
    setPlayerName,
    createLobby,
    joinLobby,
    fetchLobbies,
    lobbies,
    lobbyMode,
    openLobby,
    busy,
    error,
    setScreen,
  } = useStore();
  const [minPlayers, setMinPlayers] = useState(2);
  const [code, setCode] = useState("");
  const isPublic = lobbyMode === "public";

  useEffect(() => {
    if (!isPublic) return;
    fetchLobbies();
    const t = setInterval(() => fetchLobbies(), 5000);
    return () => clearInterval(t);
  }, [fetchLobbies, isPublic]);

  // Only public lobbies are listed — private games are joined by code.
  const publicLobbies = lobbies.filter((l) => l.visibility === "public");

  return (
    <div className="lobby-panel">
      <button className="back-link" onClick={() => setScreen("title")}>
        ← Retour
      </button>
      <div className="lobby-logo">
        <Logo />
      </div>

      <div className="lobby-tabs">
        <button className={isPublic ? "on" : ""} onClick={() => openLobby("public")}>
          🌍 Publiques
        </button>
        <button className={!isPublic ? "on" : ""} onClick={() => openLobby("private")}>
          🎪 Privées
        </button>
      </div>

      <label className="lobby-field">
        <span>Ton nom d'aventurier</span>
        <input
          value={playerName}
          maxLength={20}
          placeholder="Aventurier"
          onChange={(e) => setPlayerName(e.target.value)}
        />
      </label>

      {isPublic ? (
        <div className="lobby-card">
          <div className="lobby-card-title">🌍 Parties publiques</div>
          <div className="lobby-hint left">
            Une partie démarre dès son minimum de joueurs atteint. Chaque joueur incarne une équipe
            de <b>3 héros</b>.
          </div>
          {publicLobbies.length === 0 && <div className="lobby-hint">Recherche de parties…</div>}
          {publicLobbies.length > 0 && (
            <div className="lobby-list">
              {publicLobbies.map((l) => {
                const full = l.players.length >= l.maxPlayers;
                const ready = l.players.length >= l.minPlayers;
                return (
                  <button
                    key={l.id}
                    className="lobby-row"
                    disabled={busy || full}
                    onClick={() => joinLobby(l.id)}
                  >
                    <span className="lobby-row-main">
                      <span className="lobby-row-icon">{lobbyIcon(l.name)}</span>
                      <span className="lobby-row-text">
                        <span className="lobby-row-name">{l.name}</span>
                        <span className="lobby-row-status">
                          {ready ? "Minimum atteint" : "En attente de joueurs"} ·{" "}
                          {l.players.length}/{l.maxPlayers} joueurs
                        </span>
                      </span>
                    </span>
                    <span className={"lobby-badge" + (ready ? " hot" : "")}>
                      {full ? "COMPLET" : ready ? "DÉMARRE" : `${l.players.length}/${l.minPlayers}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="lobby-card">
            <div className="lobby-card-title">🆕 Créer une partie</div>
            <div className="lobby-hint left">
              Tu es l'hôte : partage le code, ajoute des bots et lance quand tout le monde est là.
            </div>
            <label className="lobby-field row">
              <span>Joueurs minimum</span>
              <select value={minPlayers} onChange={(e) => setMinPlayers(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="pill red compact"
              disabled={busy}
              onClick={() => createLobby({ minPlayers, maxPlayers: 4 })}
            >
              Créer le salon
            </button>
          </div>

          <div className="lobby-card">
            <div className="lobby-card-title">🤝 Rejoindre par code</div>
            <div className="lobby-join-row">
              <input
                value={code}
                maxLength={36}
                placeholder="ABC12"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <button
                className="pill compact"
                disabled={busy || !code.trim()}
                onClick={() => joinLobby(code.trim())}
              >
                Rejoindre
              </button>
            </div>
          </div>
        </>
      )}

      {error && <div className="lobby-error">⚠️ {error}</div>}
    </div>
  );
}

// --- waiting room --------------------------------------------------------------

function WaitingRoom() {
  const { game, playerId, startLobby, refreshLobby, leaveLobby, kickFromLobby, addBot, busy, error } =
    useStore();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = setInterval(() => refreshLobby(), 3000);
    return () => clearInterval(t);
  }, [refreshLobby]);

  if (!game) return null;

  const me = game.players.find((p) => p.id === playerId);
  const isPublic = game.visibility === "public";
  const isHost = !!me?.host && !isPublic; // public games have no host powers
  const enough = game.players.length >= game.minPlayers;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(game.joinCode ?? game.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="lobby-panel">
      <button className="back-link" onClick={() => leaveLobby()}>
        ← Quitter le salon
      </button>

      <div className="lobby-card big">
        <div className="lobby-room-title">
          {isPublic ? "🌍" : "🎪"} {game.name || "Salon"}
        </div>
        {isPublic ? (
          <div className="lobby-banner">
            <span className="lobby-banner-icon">🚀</span>
            <span>
              <b>Démarrage automatique</b> dès que le salon atteint {game.minPlayers} joueurs — aucun
              hôte requis.
            </span>
          </div>
        ) : (
          <>
            <button className="lobby-code" onClick={copyCode} title="Copier le code">
              {game.joinCode} {copied ? "✅" : "📋"}
            </button>
            <div className="lobby-hint">Partage ce code pour inviter d'autres joueurs.</div>
          </>
        )}

        <div className="lobby-players">
          {game.players.map((p) => (
            <div key={p.id} className={"lobby-player" + (p.id === playerId ? " me" : "")}>
              <span>{p.host ? "👑" : p.bot ? "🤖" : "🧝"}</span>
              <span className="lobby-player-name">{p.name}</span>
              {p.id === playerId && <span className="lobby-me-tag">(toi)</span>}
              {p.bot && <span className="lobby-me-tag">bot</span>}
              {isHost && p.id !== playerId && (
                <button
                  className="lobby-kick"
                  disabled={busy}
                  title={`Expulser ${p.name}`}
                  onClick={() => kickFromLobby(p.id)}
                >
                  ✕
                </button>
              )}
              {isPublic && p.id !== playerId && !p.bot && (
                <button
                  className="lobby-kick"
                  disabled={busy}
                  title={`Voter pour expulser ${p.name}`}
                  onClick={() => kickFromLobby(p.id)}
                >
                  🗳️{(game.kickVotes?.[p.id]?.length ?? 0) > 0 ? ` ${game.kickVotes?.[p.id]?.length}` : ""}
                </button>
              )}
            </div>
          ))}
          {Array.from({ length: game.maxPlayers - game.players.length }).map((_, i) => (
            <div key={`empty-${i}`} className="lobby-player empty">
              <span>💤</span>
              <span className="lobby-player-name">En attente…</span>
            </div>
          ))}
        </div>

        <div className={"lobby-status" + (enough ? " ready" : "")}>
          {enough
            ? `Prêt à partir ✓ · ${game.players.length}/${game.minPlayers} minimum atteint`
            : `En attente de joueurs : ${game.players.length}/${game.minPlayers} minimum`}
        </div>
        <div className="lobby-hint">
          {game.players.length * 3} héros partiront à l'aventure (3 par joueur).
        </div>

        {isHost ? (
          <>
            <button
              className="pill compact"
              disabled={busy || game.players.length >= game.maxPlayers}
              onClick={() => addBot()}
            >
              🤖 Ajouter un bot
            </button>
            <button className="pill red" disabled={busy || !enough} onClick={() => startLobby()}>
              ⚔️ Lancer la partie
            </button>
          </>
        ) : (
          <div className="lobby-hint">
            {isPublic
              ? "Départ automatique dès que le salon est assez rempli."
              : "L'hôte lancera la partie quand tout le monde sera là."}
          </div>
        )}
      </div>

      {error && <div className="lobby-error">⚠️ {error}</div>}
    </div>
  );
}
