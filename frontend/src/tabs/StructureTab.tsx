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
  const pa = useWorkerPA();
  const inTown = heroesInTown(game).length > 0;

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
          const canPay = pa >= b.cost.pa;
          const can = inTown && enoughMats && canPay && !busy;
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
                    <span className="tag-type ttown">chantier</span>
                  )}
                </div>
                <div className="ps-sub cost">
                  <span className="ing ok">⚡{b.cost.pa}</span>
                  {mats.map((m, i) => (
                    <span key={i} className={have(m.name) >= m.qty ? "ing ok" : "ing miss"}>
                      {" · "}
                      {m.name} {have(m.name)}/{m.qty}
                    </span>
                  ))}
                </div>
              </div>
              <button
                className="ps-act"
                disabled={!can}
                title={!inTown ? "Être en ville" : !enoughMats ? "Matériaux manquants (Banque)" : !canPay ? "PA insuffisants" : ""}
                onClick={() => townAction(b.id, "build")}
              >
                {b.built ? "Améliorer" : "Construire"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
