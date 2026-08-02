import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Logo } from "../components/Logo";
import { api } from "../api/client";
import type { LeaderboardMode, ScoreEntry } from "../api/types";

const MEDALS = ["🥇", "🥈", "🥉"];

// Les onglets du classement. Les trois natures de partie ne se comparent pas (un
// run solo avec 4 bots ne joue pas comme une expédition publique à quatre humains),
// donc chaque onglet interroge le serveur avec son ?mode= ; "" = tout confondu.
const TABS: { mode: LeaderboardMode | ""; label: string; icon: string; hint: string }[] = [
  { mode: "", label: "Toutes", icon: "🏆", hint: "Toutes les villes, tous types de partie confondus." },
  { mode: "solo", label: "Solo", icon: "⚔️", hint: "Villes des parties solo (un joueur et ses bots)." },
  { mode: "public", label: "Publiques", icon: "🌍", hint: "Villes des expéditions publiques." },
  { mode: "private", label: "Privées", icon: "🎪", hint: "Villes des parties privées entre amis." },
];

const MODE_BADGE: Record<LeaderboardMode, string> = {
  solo: "🤖 solo",
  public: "🌍 publique",
  private: "🎪 privée",
};

// "Classement" (menu principal) : le palmarès des villes — survie la plus longue
// d'abord, monstres tués en départage. Les données viennent de
// GET /api/leaderboard et survivent aux parties elles-mêmes (table dédiée côté
// serveur).
export function LeaderboardScreen() {
  const setScreen = useStore((s) => s.setScreen);
  const [tab, setTab] = useState<LeaderboardMode | "">("");
  const [entries, setEntries] = useState<ScoreEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setEntries(null);
    setError(null);
    api
      .leaderboard(tab || undefined)
      .then((list) => alive && setEntries(list))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [tab]);

  const active = TABS.find((t) => t.mode === tab) ?? TABS[0];

  return (
    <div className="screen parchment lobby-screen">
      <div className="ornament">
        <i />
        <i />
        <i />
      </div>
      <Logo />
      <div className="lobby-panel lb-panel">
        <div className="lobby-tabs lb-tabs" role="tablist" aria-label="Type de partie">
          {TABS.map((t) => (
            <button
              key={t.mode || "all"}
              role="tab"
              aria-selected={t.mode === tab}
              className={t.mode === tab ? "on" : ""}
              onClick={() => setTab(t.mode)}
            >
              <span aria-hidden="true">{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        <div className="lobby-card">
          <div className="lobby-card-title">🏆 Classement des villes</div>
          <div className="lobby-hint">
            {active.hint} Survie la plus longue d'abord, monstres tués en départage.
          </div>
          {error && <div className="lobby-error">⚠️ {error}</div>}
          {!entries && !error && <div className="lobby-hint">Chargement…</div>}
          {entries && entries.length === 0 && (
            <div className="lobby-hint">
              Aucune ville dans ce classement — lance une première partie !
            </div>
          )}
          {entries && entries.length > 0 && (
            <div className="lb-list">
              {entries.map((e, i) => (
                <div key={e.gameId} className={`lb-row ${i < 3 ? "top" : ""}`}>
                  <span className="lb-rank">{MEDALS[i] ?? `${i + 1}.`}</span>
                  <span className="lb-main">
                    {/* Le nom de la ville a sa ligne à lui : c'est le sujet du
                        classement, il ne doit pas être tronqué par les badges.
                        En nœud de texte nu il ne pourrait pas rétrécir — d'où le
                        span dédié. */}
                    <span className="lb-name">{e.townName || e.gameName || "Ville sans nom"}</span>
                    <span className="lb-meta">
                      {/* Pastille d'état réduite à son emoji : en toutes lettres
                          elle ne laissait plus la place aux noms des joueurs. */}
                      <span
                        className={`lb-status ${e.gameOver ? "over" : "live"}`}
                        title={e.gameOver ? "Ville tombée" : "Ville encore debout"}
                        aria-label={e.gameOver ? "Ville tombée" : "Ville encore debout"}
                      >
                        {e.gameOver ? "💀" : "⚔️"}
                      </span>
                      {/* Le badge de mode n'a de sens que dans l'onglet « Toutes ». */}
                      {tab === "" && <span className="lb-mode">{MODE_BADGE[e.mode]}</span>}
                      {e.players.length > 0 && (
                        <span className="lb-players">👥 {e.players.join(", ")}</span>
                      )}
                    </span>
                  </span>
                  <span className="lb-scores">
                    <span title="Vagues survécues">🌊 Vague {e.waves}</span>
                    <span title="Jours tenus">📅 Jour {e.days}</span>
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
