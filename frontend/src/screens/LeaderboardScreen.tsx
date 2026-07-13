import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Logo } from "../components/Logo";
import { api } from "../api/client";
import type { ScoreEntry } from "../api/types";

const MEDALS = ["🥇", "🥈", "🥉"];

// "Classement" (main menu): every started town's achievements — longest survival
// first, monsters slain as tie-breaker. Data comes from GET /api/leaderboard and
// survives the games themselves (dedicated leaderboard table server-side).
export function LeaderboardScreen() {
  const setScreen = useStore((s) => s.setScreen);
  const [entries, setEntries] = useState<ScoreEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .leaderboard()
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="screen parchment lobby-screen">
      <div className="ornament">
        <i />
        <i />
        <i />
      </div>
      <Logo />
      <div className="lobby-panel">
        <div className="lobby-card">
          <div className="lobby-card-title">🏆 Classement des villes</div>
          <div className="lobby-hint">
            Survie la plus longue et monstres tués, toutes parties confondues.
          </div>
          {error && <div className="lobby-error">⚠️ {error}</div>}
          {!entries && !error && <div className="lobby-hint">Chargement…</div>}
          {entries && entries.length === 0 && (
            <div className="lobby-hint">Aucune ville au tableau — lancez une première partie !</div>
          )}
          {entries && entries.length > 0 && (
            <div className="lb-list">
              {entries.map((e, i) => (
                <div key={e.gameId} className={`lb-row ${i < 3 ? "top" : ""}`}>
                  <span className="lb-rank">{MEDALS[i] ?? `${i + 1}.`}</span>
                  <span className="lb-main">
                    <span className="lb-town">
                      {e.townName || e.gameName || "Ville sans nom"}
                      <span className={`lb-status ${e.gameOver ? "over" : "live"}`}>
                        {e.gameOver ? "💀 tombée" : "⚔️ en cours"}
                      </span>
                    </span>
                    {e.players.length > 0 && (
                      <span className="lb-players">👥 {e.players.join(", ")}</span>
                    )}
                  </span>
                  <span className="lb-scores">
                    <span title="Survie">📅 Jour {e.days} · Vague {e.waves}</span>
                    <span title="Monstres tués">👹 {e.monstersKilled}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="pill ghost" onClick={() => setScreen("title")}>
          ← Retour
        </button>
      </div>
    </div>
  );
}
