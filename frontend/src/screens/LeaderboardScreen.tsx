import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Logo } from "../components/Logo";
import { api } from "../api/client";
import type { LeaderboardMode, ScoreEntry, Season } from "../api/types";
import { tServer } from "../i18n";
import { useT } from "../i18n/useT";

const MEDALS = ["🥇", "🥈", "🥉"];

// Les onglets du classement. Les trois natures de partie ne se comparent pas (un
// run solo avec 4 bots ne joue pas comme une expédition publique à quatre humains),
// donc chaque onglet interroge le serveur avec son ?mode= ; "" = tout confondu.
// Les natures d'expédition (backend theme.go), pour le badge de ligne. Le tempéré n'a
// pas de badge : c'est la carte ordinaire, et l'annoncer n'apprendrait rien.
const THEME_BADGE: Record<string, string> = {
  nordique: "❄️ Nordique",
  desertique: "🏜️ Désertique",
};

// ⚠ libellés et infobulles gardés en français ici, traduits AU RENDU : une constante
// de module n'est évaluée qu'une fois et figerait la langue du démarrage.
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
  // "" = la saison EN COURS (le défaut du serveur), "all" = tous les temps.
  const [season, setSeason] = useState("");
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [entries, setEntries] = useState<ScoreEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useT();

  useEffect(() => {
    let alive = true;
    api
      .seasons()
      .then((r) => alive && setSeasons(r.seasons))
      .catch(() => {
        /* le sélecteur disparaît, le classement reste : ce n'est pas une panne du jeu */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setEntries(null);
    setError(null);
    api
      .leaderboard(tab || undefined, season || undefined)
      .then((list) => alive && setEntries(list))
      // ⚠ tServer et non e.message : une ApiError porte le gabarit du serveur, et
      // c'est lui qui se traduit (api/client.ts).
      .catch((e: any) => alive && setError(tServer({ key: e?.key, args: e?.args, text: e?.message ?? String(e) })));
    return () => {
      alive = false;
    };
  }, [tab, season]);

  const active = TABS.find((tb) => tb.mode === tab) ?? TABS[0];

  return (
    <div className="screen parchment lobby-screen">
      <div className="ornament">
        <i />
        <i />
        <i />
      </div>
      <Logo />
      <div className="lobby-panel lb-panel">
        <div className="lobby-tabs lb-tabs" role="tablist" aria-label={t("Type de partie")}>
          {TABS.map((tb) => (
            <button
              key={tb.mode || "all"}
              role="tab"
              aria-selected={tb.mode === tab}
              className={tb.mode === tab ? "on" : ""}
              onClick={() => setTab(tb.mode)}
            >
              <span aria-hidden="true">{tb.icon}</span> {t(tb.label)}
            </button>
          ))}
        </div>

        {seasons.length > 0 && (
          <div className="lb-seasons">
            <label htmlFor="lb-season">📅 {t("Saison")}</label>
            <select
              id="lb-season"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
            >
              {seasons.map((sn) => (
                <option key={sn.id} value={sn.current ? "" : sn.id}>
                  {sn.label}
                  {sn.current ? " " + t("(en cours)") : ""}
                </option>
              ))}
              <option value="all">{t("Tous les temps")}</option>
            </select>
          </div>
        )}

        <div className="lobby-card">
          <div className="lobby-card-title">🏆 {t("Classement des villes")}</div>
          <div className="lobby-hint">
            {t(active.hint)} {t("Survie la plus longue d'abord, monstres tués en départage.")}{" "}
            {season === "all"
              ? t("Toutes saisons confondues.")
              : t("Le classement repart à chaque saison — les précédentes restent consultables.")}
          </div>
          {error && <div className="lobby-error">⚠️ {error}</div>}
          {!entries && !error && <div className="lobby-hint">{t("Chargement…")}</div>}
          {entries && entries.length === 0 && (
            <div className="lobby-hint">
              {season === "all"
                ? t("Aucune ville dans ce classement — lance une première partie !")
                : t("Aucune ville dans cette saison — la place est libre.")}
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
                    <span className="lb-name">{e.townName || e.gameName || t("Ville sans nom")}</span>
                    <span className="lb-meta">
                      {/* Pastille d'état réduite à son emoji : en toutes lettres
                          elle ne laissait plus la place aux noms des joueurs. */}
                      <span
                        className={`lb-status ${e.gameOver ? "over" : "live"}`}
                        title={e.gameOver ? t("Ville tombée") : t("Ville encore debout")}
                        aria-label={e.gameOver ? t("Ville tombée") : t("Ville encore debout")}
                      >
                        {e.gameOver ? "💀" : "⚔️"}
                      </span>
                      {/* Le badge de mode n'a de sens que dans l'onglet « Toutes ». */}
                      {tab === "" && <span className="lb-mode">{t(MODE_BADGE[e.mode])}</span>}
                      {/* La NATURE de la carte : deux villes de thèmes différents
                          n'ont pas affronté le même monde, le tableau doit le dire. */}
                      {e.theme && e.theme !== "tempere" && (
                        <span className="lb-mode">{THEME_BADGE[e.theme] ? t(THEME_BADGE[e.theme]) : e.theme}</span>
                      )}
                      {e.players.length > 0 && (
                        <span className="lb-players">👥 {e.players.join(", ")}</span>
                      )}
                    </span>
                  </span>
                  <span className="lb-scores">
                    <span title={t("Vagues survécues")}>🌊 {t("Vague {n}", { n: e.waves })}</span>
                    <span title={t("Jours tenus")}>📅 {t("Jour {n}", { n: e.days })}</span>
                    <span title={t("Monstres tués")}>👹 {e.monstersKilled}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="pill ghost" onClick={() => setScreen("title")}>
          ← {t("Retour")}
        </button>
      </div>
    </div>
  );
}
