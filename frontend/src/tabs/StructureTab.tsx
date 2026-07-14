import { useMemo, useState } from "react";
import { useStore } from "../store";
import { buildingIcon } from "../data/buildings";
import { TownWorker, useWorkerPA } from "../components/TownWorker";
import { heroesInTown } from "../townUtils";
import { durColor } from "./HomeTab";

type Sort = "status" | "name" | "level";

// Structure = one compact list of every building. Construction sites show "Construire",
// built ones show "Améliorer". Each needs PA + the right materials in the Bank.
export function StructureTab() {
  const game = useStore((s) => s.game);
  const townAction = useStore((s) => s.townAction);
  const busy = useStore((s) => s.busy);
  const [sort, setSort] = useState<Sort>("status");
  const playerId = useStore((s) => s.playerId);
  const pa = useWorkerPA();
  const inTown = heroesInTown(game, playerId).length > 0;

  const storage = game?.town.storage ?? [];
  const have = (name: string) => storage.find((i) => i.name === name)?.qty ?? 0;

  const buildings = useMemo(() => {
    const list = [...(game?.town.buildings ?? [])];
    list.sort((a, b) => {
      switch (sort) {
        case "level":
          return b.level - a.level;
        case "name":
          return a.name.localeCompare(b.name);
        default:
          return Number(a.built) - Number(b.built) || a.name.localeCompare(b.name);
      }
    });
    return list;
  }, [game, sort]);

  return (
    <div className="panel-screen">
      <div className="ps-head">
        <strong>Structures</strong>
        <div className="sortbar-inline">
          {(["status", "name", "level"] as Sort[]).map((k) => (
            <button key={k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>
              {k === "status" ? "Statut" : k === "name" ? "A-Z" : "Lv"}
            </button>
          ))}
        </div>
        {inTown && <span className="tb-chip pa">⚡{pa}</span>}
      </div>
      {!inTown && (
        <div className="stock-note compact">🏙️ Reviens en ville pour construire/améliorer. Consultation seule.</div>
      )}
      {inTown && <TownWorker />}

      <div className="ps-list compact">
        {buildings.map((b) => {
          const mats = b.cost.materials;
          const enoughMats = mats.every((m) => have(m.name) >= m.qty);
          const open = b.underConstruction; // chantier ouvert (plan posé)
          const remaining = Math.max(0, b.cost.pa - b.paInvested);
          // Chantier ouvert : on investit les PA du worker (le serveur borne au restant).
          // Pas de plan : le poser coûte 1 PA (les matériaux ne servent qu'ensuite).
          const invest = Math.min(pa, remaining);
          const canAct = open ? enoughMats && invest > 0 : pa >= 1;
          const can = inTown && canAct && !busy;
          const label = open ? `+${invest} PA` : b.built ? "📐 Améliorer" : "📐 Poser le plan";
          const hint = !inTown
            ? "Être en ville"
            : open && !enoughMats
            ? "Matériaux manquants en Banque — les PA investis restent acquis"
            : open
            ? `Investir les PA du travailleur (${b.paInvested}/${b.cost.pa})`
            : pa < 1
            ? "PA insuffisants"
            : "Poser le plan de chantier (1 PA)";
          return (
            <div className={`ps-row compact ${b.built ? "" : "site"}`} key={b.id}>
              <div className="ps-ic">{b.built ? buildingIcon(b.id) : "🏗️"}</div>
              <div className="ps-main">
                <div className="ps-title">
                  <span className="nm">{b.name}</span>
                  {b.built ? (
                    <>
                      <span className="lvl">Lv {b.level}</span>
                      <span className="dur-mini" style={{ color: durColor(b.durability / b.maxDurability) }}>
                        🛡 {Math.round((b.durability / b.maxDurability) * 100)}%
                      </span>
                    </>
                  ) : (
                    <span className="tag-type ttown">{open ? "en chantier" : "plan à poser"}</span>
                  )}
                  {open && b.built && <span className="tag-type ttown">amélioration Lv {b.level + 1}</span>}
                </div>
                <div className="ps-sub cost">
                  <span className="ing ok">⚡{b.cost.pa} PA</span>
                  {mats.map((m, i) => (
                    <span key={i} className={have(m.name) >= m.qty ? "ing ok" : "ing miss"}>
                      {" · "}
                      {m.name} {have(m.name)}/{m.qty}
                    </span>
                  ))}
                </div>
                {open && (
                  <div className="ps-progress" title={`${b.paInvested}/${b.cost.pa} PA investis`}>
                    <i style={{ width: `${Math.min(100, (b.paInvested / Math.max(1, b.cost.pa)) * 100)}%` }} />
                    <span>
                      {b.paInvested}/{b.cost.pa} PA
                      {!enoughMats && " · ⏸ matériaux manquants"}
                    </span>
                  </div>
                )}
              </div>
              <button className="ps-act" disabled={!can} title={hint} onClick={() => townAction(b.id, "build", open ? invest : 1)}>
                {label}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
