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
      <div className="ornament">
        <i />
        <i />
        <i />
      </div>
      <Logo />
      {inLobby ? <WaitingRoom /> : <LobbyForms />}
    </div>
  );
}

// --- create / join forms -----------------------------------------------------

function LobbyForms() {
  const { playerName, setPlayerName, createLobby, joinLobby, fetchLobbies, lobbies, busy, error, setScreen } =
    useStore();
  const [minPlayers, setMinPlayers] = useState(2);
  const [code, setCode] = useState("");

  useEffect(() => {
    fetchLobbies();
    const t = setInterval(() => fetchLobbies(), 5000);
    return () => clearInterval(t);
  }, [fetchLobbies]);

  return (
    <div className="lobby-panel">
      <label className="lobby-field">
        <span>Ton nom d'aventurier</span>
        <input
          value={playerName}
          maxLength={20}
          placeholder="Aventurier"
          onChange={(e) => setPlayerName(e.target.value)}
        />
      </label>

      <div className="lobby-card">
        <div className="lobby-card-title">🆕 Créer une partie</div>
        <div className="lobby-hint">
          Chaque joueur incarne une équipe de 3 héros. Plus il y a de joueurs, plus la horde initiale
          est nombreuse.
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
          className="pill red"
          disabled={busy}
          onClick={() => createLobby({ minPlayers, maxPlayers: 4 })}
        >
          Créer le salon
        </button>
      </div>

      <div className="lobby-card">
        <div className="lobby-card-title">🤝 Rejoindre une partie</div>
        <label className="lobby-field row">
          <span>Code</span>
          <input
            value={code}
            maxLength={36}
            placeholder="ABC12"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </label>
        <button className="pill" disabled={busy || !code.trim()} onClick={() => joinLobby(code.trim())}>
          Rejoindre par code
        </button>
        {lobbies.length > 0 && (
          <div className="lobby-list">
            {lobbies.map((l) => (
              <button
                key={l.id}
                className="lobby-row"
                disabled={busy || l.players.length >= l.maxPlayers}
                onClick={() => joinLobby(l.joinCode ?? l.id)}
              >
                <span className="lobby-row-name">{l.name}</span>
                <span className="lobby-row-count">
                  {l.players.length}/{l.maxPlayers} joueurs · min {l.minPlayers}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="lobby-error">⚠️ {error}</div>}
      <button className="pill ghost" onClick={() => setScreen("title")}>
        ← Retour
      </button>
    </div>
  );
}

// --- waiting room --------------------------------------------------------------

function WaitingRoom() {
  const { game, playerId, startLobby, refreshLobby, leaveLobby, kickFromLobby, busy, error } =
    useStore();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = setInterval(() => refreshLobby(), 3000);
    return () => clearInterval(t);
  }, [refreshLobby]);

  if (!game) return null;

  const me = game.players.find((p) => p.id === playerId);
  const isHost = !!me?.host;
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
      <div className="lobby-card">
        <div className="lobby-card-title">🎪 {game.name || "Salon"}</div>
        <button className="lobby-code" onClick={copyCode} title="Copier le code">
          {game.joinCode} {copied ? "✅" : "📋"}
        </button>
        <div className="lobby-hint">Partage ce code pour inviter d'autres joueurs.</div>

        <div className="lobby-players">
          {game.players.map((p) => (
            <div key={p.id} className={"lobby-player" + (p.id === playerId ? " me" : "")}>
              <span>{p.host ? "👑" : "🧝"}</span>
              <span className="lobby-player-name">{p.name}</span>
              {p.id === playerId && <span className="lobby-me-tag">(toi)</span>}
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
            </div>
          ))}
          {Array.from({ length: game.maxPlayers - game.players.length }).map((_, i) => (
            <div key={`empty-${i}`} className="lobby-player empty">
              <span>💤</span>
              <span className="lobby-player-name">En attente…</span>
            </div>
          ))}
        </div>

        <div className="lobby-status">
          {enough
            ? `Prêt à partir (${game.players.length}/${game.minPlayers} minimum atteint)`
            : `En attente de joueurs : ${game.players.length}/${game.minPlayers} minimum`}
        </div>
        <div className="lobby-hint">
          {game.players.length * 3} héros partiront à l'aventure (3 par joueur).
        </div>

        {isHost ? (
          <button className="pill red" disabled={busy || !enough} onClick={() => startLobby()}>
            ⚔️ Lancer la partie
          </button>
        ) : (
          <div className="lobby-hint">L'hôte lancera la partie quand tout le monde sera là.</div>
        )}
      </div>

      {error && <div className="lobby-error">⚠️ {error}</div>}
      <button className="pill ghost" onClick={() => leaveLobby()}>
        ← Quitter le salon
      </button>
    </div>
  );
}
