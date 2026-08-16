import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Chronicle } from "../api/types";
import { useT } from "../i18n/useT";

// LA CHRONIQUE — ce qu'un compte garde des villes qu'il a vues tomber (P7 de
// RETENTION-PLAN.md).
//
// Le problème qu'elle règle : une expédition finit TOUJOURS par tomber, et jusqu'ici
// tout mourait avec elle. Tenir vingt vagues, bâtir une tour, rapporter six cents objets
// — et n'en garder rien. C'est la seule chose qu'on puisse faire traverser les parties
// sans casser le jeu.
//
// ⚠ COSMÉTIQUE, JAMAIS DE LA PUISSANCE (même règle que les mémoriaux) : un titre
// n'accorde ni PA, ni défense, ni objet. Un vétéran et un débutant qui rejoignent la même
// ville y arrivent strictement égaux — c'est cette égalité qui fait tenir une survie de
// groupe. Ce qui traverse, c'est le souvenir.
//
// Tout vient du serveur (api/chronicle.go), titres compris : ce composant met en forme.
export function ChronicleCard() {
  const [data, setData] = useState<Chronicle | null>(null);
  const [failed, setFailed] = useState(false);
  const [openRuns, setOpenRuns] = useState(false);
  const { t, tName, tDesc } = useT();

  useEffect(() => {
    let alive = true;
    api
      .myChronicle()
      .then((c) => alive && setData(c))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed) return null;
  if (!data) return <div className="lobby-card lobby-hint">{t("Chargement de la chronique…")}</div>;

  const { totals, titles, runs } = data;
  if (totals.runs === 0) {
    return (
      <div className="lobby-card">
        <div className="lobby-card-title">📜 {t("Ma chronique")}</div>
        <div className="lobby-hint">
          {t(
            "Aucune expédition à raconter pour l'instant. Ce que tu apporteras à une ville — chantiers, récoltes, remparts relevés, requêtes honorées — restera ici même quand elle sera tombée.",
          )}
        </div>
      </div>
    );
  }

  // ⚠ variables renommées : `t` est le nom de la fonction de traduction.
  const won = titles.filter((ti) => ti.got);
  const next = titles.filter((ti) => !ti.got).slice(0, 3);

  return (
    <div className="lobby-card">
      <div className="lobby-card-title">📜 {t("Ma chronique")}</div>

      <div className="chron-stats">
        <Stat icon="🌍" label={t("expéditions")} value={totals.runs} />
        <Stat icon="🛡️" label={t("meilleure survie")} value={t("{n} vagues", { n: totals.bestWave })} />
        <Stat icon="🔨" label={t("PA de chantier")} value={totals.buildPa} />
        <Stat icon="🎒" label={t("objets rapportés")} value={totals.deposited} />
        <Stat icon="⚔️" label={t("créatures abattues")} value={totals.slain} />
        <Stat icon="🤝" label={t("requêtes honorées")} value={totals.filled} />
      </div>

      {won.length > 0 && (
        <>
          <div className="chron-sub">{t("Titres")}</div>
          <div className="chron-titles">
            {won.map((ti) => (
              <span key={ti.id} className="chron-title got" title={`${tDesc(ti.desc)} — ${ti.need}`}>
                {ti.icon} {tName(ti.name)}
              </span>
            ))}
          </div>
        </>
      )}

      {next.length > 0 && (
        <>
          <div className="chron-sub">{t("À venir")}</div>
          <div className="chron-next">
            {next.map((ti) => (
              <div key={ti.id} className="chron-nextrow">
                <span className="chron-title">
                  {ti.icon} {tName(ti.name)}
                </span>
                <span className="chron-prog">
                  <i style={{ width: `${Math.min(100, (ti.value / ti.need) * 100)}%` }} />
                </span>
                <span className="chron-num">
                  {ti.value}/{ti.need}
                </span>
              </div>
            ))}
          </div>
          <div className="lobby-hint">
            {t("Les titres sont une mémoire, pas un avantage : ils ne donnent rien en jeu.")}
          </div>
        </>
      )}

      <button className="pill ghost" onClick={() => setOpenRuns((v) => !v)} aria-expanded={openRuns}>
        {runs.length === 1
          ? openRuns
            ? t("Masquer mon expédition")
            : t("Voir mon expédition")
          : openRuns
          ? t("Masquer mes {n} expéditions", { n: runs.length })
          : t("Voir mes {n} expéditions", { n: runs.length })}
      </button>
      {openRuns && (
        <div className="lobby-list">
          {runs.map((r) => (
            <div key={r.gameId} className="lobby-row static">
              <span className="lobby-row-name">
                {r.gameOver ? "🪦" : "▶"} {r.townName}
              </span>
              <span className="lobby-row-count">
                {t("vague {w} · {pa} PA · {n} objets", { w: r.waves, pa: r.buildPa, n: r.deposited })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: string; label: string; value: number | string }) {
  return (
    <div className="chron-stat">
      <span className="chron-stat-v">
        {icon} {value}
      </span>
      <span className="chron-stat-l">{label}</span>
    </div>
  );
}
