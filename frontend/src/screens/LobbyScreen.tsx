import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Logo } from "../components/Logo";
import { LOBBY_SIZES } from "../data/buildings";
import { useCountdown, formatHMS } from "../useWave";
import { useT } from "../i18n/useT";

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
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [code, setCode] = useState("");
  const { t, tName, tDesc } = useT();
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
        ← {t("Retour")}
      </button>
      <div className="lobby-logo">
        <Logo />
      </div>

      <div className="lobby-tabs">
        <button className={isPublic ? "on" : ""} onClick={() => openLobby("public")}>
          🌍 {t("Publiques")}
        </button>
        <button className={!isPublic ? "on" : ""} onClick={() => openLobby("private")}>
          🎪 {t("Privées")}
        </button>
      </div>

      <label className="lobby-field">
        <span>{t("Ton nom d'aventurier")}</span>
        <input
          value={playerName}
          maxLength={20}
          placeholder={t("Aventurier")}
          onChange={(e) => setPlayerName(e.target.value)}
        />
      </label>

      {isPublic ? (
        <div className="lobby-card">
          <div className="lobby-card-title">🌍 {t("Parties publiques")}</div>
          <div className="lobby-hint left">
            {t(
              "Une partie démarre dès son minimum de joueurs atteint, puis reste ouverte quelques vagues : on peut embarquer dans une expédition déjà en route. Chaque joueur incarne une équipe de 3 héros.",
            )}
          </div>
          {publicLobbies.length === 0 && <div className="lobby-hint">{t("Recherche de parties…")}</div>}
          {publicLobbies.length > 0 && (
            <div className="lobby-list">
              {publicLobbies.map((l) => {
                const full = l.players.length >= l.maxPlayers;
                const ready = l.players.length >= l.minPlayers;
                // Une expédition DÉJÀ LANCÉE mais encore ouverte : on rejoint une ville
                // qui existe, avec un compte à rebours en vagues avant fermeture.
                const started = l.status === "active";
                const status = started
                  ? t("En route — jour {d}, vague {w} · {n}/{max} joueurs", {
                      d: l.day,
                      w: l.waveNumber,
                      n: l.players.length,
                      max: l.maxPlayers,
                    })
                  : (ready ? t("Minimum atteint") : t("En attente de joueurs")) +
                    " · " +
                    t("{n}/{max} joueurs", { n: l.players.length, max: l.maxPlayers });
                return (
                  <button
                    key={l.id}
                    className="lobby-row"
                    disabled={busy || full}
                    onClick={() => joinLobby(l.id)}
                  >
                    <span className="lobby-row-main">
                      <span className="lobby-row-icon">{started ? "⚔️" : lobbyIcon(l.name)}</span>
                      <span className="lobby-row-text">
                        <span className="lobby-row-name">
                          {l.name}
                          {/* La NATURE de la carte : c'est elle qui distingue cette
                              expédition de la précédente (backend theme.go). */}
                          {l.theme && l.theme.id !== "tempere" && (
                            <span className="lobby-theme" title={tDesc(l.theme.tagline)}>
                              {l.theme.emoji} {tName(l.theme.name)}
                            </span>
                          )}
                        </span>
                        <span className="lobby-row-status">{status}</span>
                      </span>
                    </span>
                    <span className={"lobby-badge" + (ready || started ? " hot" : "")}>
                      {full
                        ? t("COMPLET")
                        : started
                        ? l.joinWavesLeft > 1
                          ? t("{n} VAGUES", { n: l.joinWavesLeft })
                          : t("1 VAGUE")
                        : ready
                        ? t("DÉMARRE")
                        : `${l.players.length}/${l.minPlayers}`}
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
            <div className="lobby-card-title">🆕 {t("Créer une partie")}</div>
            <div className="lobby-hint left">
              {t("Tu es l'hôte : partage le code, ajoute des bots et lance quand tout le monde est là.")}
            </div>
            <label className="lobby-field row">
              <span>{t("Joueurs minimum")}</span>
              <select value={minPlayers} onChange={(e) => setMinPlayers(Number(e.target.value))}>
                {LOBBY_SIZES.filter((n) => n <= maxPlayers).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="lobby-field row">
              <span>{t("Joueurs maximum")}</span>
              <select
                value={maxPlayers}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setMaxPlayers(v);
                  if (minPlayers > v) setMinPlayers(v);
                }}
              >
                {LOBBY_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {/* La carte est générée à la taille du salon (worldgen.SizeForPlayers) :
                la surface par joueur reste constante, et les gisements garantis suivent. */}
            <div className="lobby-hint left">
              {t(
                "La carte est taillée pour {n} joueurs — plus l'expédition est grande, plus le monde l'est, et plus la horde l'est aussi.",
                { n: maxPlayers },
              )}
            </div>
            <button
              className="pill red compact"
              disabled={busy}
              onClick={() => createLobby({ minPlayers, maxPlayers })}
            >
              {t("Créer le salon")}
            </button>
          </div>

          <div className="lobby-card">
            <div className="lobby-card-title">🤝 {t("Rejoindre par code")}</div>
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
                {t("Rejoindre")}
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
  const { t } = useT();

  useEffect(() => {
    const t = setInterval(() => refreshLobby(), 3000);
    return () => clearInterval(t);
  }, [refreshLobby]);

  if (!game) return null;

  const me = game.players.find((p) => p.id === playerId);
  const isPublic = game.visibility === "public";
  const isHost = !!me?.host && !isPublic; // public games have no host powers
  const enough = game.players.length >= game.minPlayers;
  const escortIn = useCountdown(game.escortAt);

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
        ← {t("Quitter le salon")}
      </button>

      <div className="lobby-card big">
        <div className="lobby-room-title">
          {isPublic ? "🌍" : "🎪"} {game.name || t("Salon")}
        </div>
        {isPublic ? (
          <div className="lobby-banner">
            <span className="lobby-banner-icon">🚀</span>
            <span>
              {t("Démarrage automatique dès que le salon atteint {n} joueurs — aucun hôte requis.", {
                n: game.minPlayers,
              })}
            </span>
          </div>
        ) : (
          <>
            <button className="lobby-code" onClick={copyCode} title={t("Copier le code")}>
              {game.joinCode} {copied ? "✅" : "📋"}
            </button>
            <div className="lobby-hint">{t("Partage ce code pour inviter d'autres joueurs.")}</div>
          </>
        )}

        <div className="lobby-players">
          {game.players.map((p) => (
            <div key={p.id} className={"lobby-player" + (p.id === playerId ? " me" : "")}>
              <span>{p.host ? "👑" : p.bot ? "🤖" : "🧝"}</span>
              <span className="lobby-player-name">{p.name}</span>
              {p.id === playerId && <span className="lobby-me-tag">{t("(toi)")}</span>}
              {p.bot && <span className="lobby-me-tag">{t("bot")}</span>}
              {isHost && p.id !== playerId && (
                <button
                  className="lobby-kick"
                  disabled={busy}
                  title={t("Expulser {name}", { name: p.name })}
                  onClick={() => kickFromLobby(p.id)}
                >
                  ✕
                </button>
              )}
              {isPublic && p.id !== playerId && !p.bot && (
                <button
                  className="lobby-kick"
                  disabled={busy}
                  title={t("Voter pour expulser {name}", { name: p.name })}
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
              <span className="lobby-player-name">{t("En attente…")}</span>
            </div>
          ))}
        </div>

        <div className={"lobby-status" + (enough ? " ready" : "")}>
          {enough
            ? t("Prêt à partir ✓ · {n}/{min} minimum atteint", { n: game.players.length, min: game.minPlayers })
            : t("En attente de joueurs : {n}/{min} minimum", { n: game.players.length, min: game.minPlayers })}
        </div>
        {/* L'ESCORTE DE DÉPART (backend lobby.go) : une expédition publique ne fait
            jamais attendre indéfiniment. Le serveur donne l'heure du départ (`escortAt`,
            champ DÉRIVÉ) — le client ne recopie pas le délai, il le lirait de travers le
            jour où il changerait. */}
        {escortIn !== null && (
          <div className="lobby-escort">
            🤖{" "}
            {t(
              "Départ dans {time} avec une escorte si personne d'autre n'arrive — l'expédition restera ouverte, on peut vous rejoindre en route.",
              { time: formatHMS(escortIn) },
            )}
          </div>
        )}
        <div className="lobby-hint">
          {t("{n} héros partiront à l'aventure (3 par joueur).", { n: game.players.length * 3 })}
        </div>

        {isHost ? (
          <>
            <button
              className="pill compact"
              disabled={busy || game.players.length >= game.maxPlayers}
              onClick={() => addBot()}
            >
              🤖 {t("Ajouter un bot")}
            </button>
            <button className="pill red" disabled={busy || !enough} onClick={() => startLobby()}>
              ⚔️ {t("Lancer la partie")}
            </button>
          </>
        ) : (
          <div className="lobby-hint">
            {isPublic
              ? t("Départ automatique dès que le salon est assez rempli.")
              : t("L'hôte lancera la partie quand tout le monde sera là.")}
          </div>
        )}
      </div>

      {error && <div className="lobby-error">⚠️ {error}</div>}
    </div>
  );
}
