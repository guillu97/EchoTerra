import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Chronicle } from "../api/types";

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
  if (!data) return <div className="lobby-card lobby-hint">Chargement de la chronique…</div>;

  const { totals, titles, runs } = data;
  if (totals.runs === 0) {
    return (
      <div className="lobby-card">
        <div className="lobby-card-title">📜 Ma chronique</div>
        <div className="lobby-hint">
          Aucune expédition à raconter pour l'instant. Ce que tu apporteras à une ville — chantiers,
          récoltes, remparts relevés, requêtes honorées — restera ici même quand elle sera tombée.
        </div>
      </div>
    );
  }

  const won = titles.filter((t) => t.got);
  const next = titles.filter((t) => !t.got).slice(0, 3);

  return (
    <div className="lobby-card">
      <div className="lobby-card-title">📜 Ma chronique</div>

      <div className="chron-stats">
        <Stat icon="🌍" label="expéditions" value={totals.runs} />
        <Stat icon="🛡️" label="meilleure survie" value={`${totals.bestWave} vagues`} />
        <Stat icon="🔨" label="PA de chantier" value={totals.buildPa} />
        <Stat icon="🎒" label="objets rapportés" value={totals.deposited} />
        <Stat icon="⚔️" label="créatures abattues" value={totals.slain} />
        <Stat icon="🤝" label="requêtes honorées" value={totals.filled} />
      </div>

      {won.length > 0 && (
        <>
          <div className="chron-sub">Titres</div>
          <div className="chron-titles">
            {won.map((t) => (
              <span key={t.id} className="chron-title got" title={`${t.desc} — ${t.need}`}>
                {t.icon} {t.name}
              </span>
            ))}
          </div>
        </>
      )}

      {next.length > 0 && (
        <>
          <div className="chron-sub">À venir</div>
          <div className="chron-next">
            {next.map((t) => (
              <div key={t.id} className="chron-nextrow">
                <span className="chron-title">
                  {t.icon} {t.name}
                </span>
                <span className="chron-prog">
                  <i style={{ width: `${Math.min(100, (t.value / t.need) * 100)}%` }} />
                </span>
                <span className="chron-num">
                  {t.value}/{t.need}
                </span>
              </div>
            ))}
          </div>
          <div className="lobby-hint">
            Les titres sont une mémoire, pas un avantage : ils ne donnent rien en jeu.
          </div>
        </>
      )}

      <button className="pill ghost" onClick={() => setOpenRuns((v) => !v)} aria-expanded={openRuns}>
        {openRuns ? "Masquer" : "Voir"}{" "}
        {runs.length === 1 ? "mon expédition" : `mes ${runs.length} expéditions`}
      </button>
      {openRuns && (
        <div className="lobby-list">
          {runs.map((r) => (
            <div key={r.gameId} className="lobby-row static">
              <span className="lobby-row-name">
                {r.gameOver ? "🪦" : "▶"} {r.townName}
              </span>
              <span className="lobby-row-count">
                vague {r.waves} · {r.buildPa} PA · {r.deposited} objets
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
