import { useMemo, useState } from "react";
import { useStore } from "../store";
import { buildingIcon, buildingName } from "../data/buildings";
import { TownWorker, useWorkerPA } from "../components/TownWorker";
import { buildingKnown, heroesInTown } from "../townUtils";
import { durColor } from "./HomeTab";
import type { TownBuilding } from "../api/types";

type Sort = "status" | "name" | "level";

// Structure = the chantier hub. Default view GROUPS buildings by state so players see
// at a glance where to pour their PA: open chantiers first (construction AND upgrade
// use the same plan→invest flow), then plans to lay, then the built town.
export function StructureTab() {
  const game = useStore((s) => s.game);
  const townAction = useStore((s) => s.townAction);
  const busy = useStore((s) => s.busy);
  const [sort, setSort] = useState<Sort>("status");
  const playerId = useStore((s) => s.playerId);
  const pa = useWorkerPA();
  const inTown = heroesInTown(game, playerId).length > 0;
  // PA choisis par chantier (voir `chosen` plus bas) : par défaut on propose tout
  // ce que le travailleur peut donner, mais c'est LUI qui décide combien il pose.
  const [amounts, setAmounts] = useState<Record<string, number>>({});

  const storage = game?.town.storage ?? [];
  const have = (name: string) => storage.find((i) => i.name === name)?.qty ?? 0;

  // Les sites dont le plan n'a pas encore été trouvé sont HORS LISTE (townUtils) —
  // on en garde juste le nombre, pour dire que le catalogue est plus grand sans
  // en faire une liste de courses.
  const hidden = (game?.town.buildings ?? []).filter((b) => !buildingKnown(game, b)).length;

  const groups = useMemo(() => {
    const list = (game?.town.buildings ?? []).filter((b) => buildingKnown(game, b));
    if (sort !== "status") {
      list.sort((a, b) => (sort === "level" ? b.level - a.level : buildingName(a.id, a.name).localeCompare(buildingName(b.id, b.name))));
      return [{ key: "all", title: "", items: list }];
    }
    const byName = (a: TownBuilding, b: TownBuilding) =>
    buildingName(a.id, a.name).localeCompare(buildingName(b.id, b.name));
    return [
      { key: "chantier", title: "🏗️ Chantiers en cours", items: list.filter((b) => b.underConstruction).sort(byName) },
      { key: "plan", title: "📐 Plans à poser", items: list.filter((b) => !b.built && !b.underConstruction).sort(byName) },
      { key: "built", title: "🏠 Construits", items: list.filter((b) => b.built && !b.underConstruction).sort(byName) },
    ].filter((g) => g.items.length > 0);
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
        {groups.map((g) => (
          <div className="ps-group" key={g.key}>
            {g.title && <div className="ps-group-h">{g.title}</div>}
            {g.items.map((b) => {
          const mats = b.cost.materials;
          const enoughMats = mats.every((m) => have(m.name) >= m.qty);
          const open = b.underConstruction; // chantier ouvert (plan posé)
          const remaining = Math.max(0, b.cost.pa - b.paInvested);
          // Chantier ouvert : le travailleur CHOISIT combien de PA il pose ici. Le
          // plafond reste ce qu'il a en poche et ce qu'il reste à faire (le serveur
          // borne aux deux de son côté) ; le défaut est « tout », c'est-à-dire le
          // comportement d'avant, mais garder 2 PA pour rentrer ou pour un second
          // chantier est désormais possible — les PA d'un héros sont sa journée.
          const maxInvest = Math.min(pa, remaining);
          const invest = maxInvest > 0 ? Math.max(1, Math.min(maxInvest, amounts[b.id] ?? maxInvest)) : 0;
          const setInvest = (n: number) =>
            setAmounts((m) => ({ ...m, [b.id]: Math.max(1, Math.min(maxInvest, n)) }));
          const maxed = b.built && b.cost.pa === 0; // level 3 reached (design max)
          // Plan (blueprint) à trouver : un chantier NEUF (site, pas encore posé) exige
          // le plan correspondant en Banque pour être posé (il est consommé à la pose).
          const plan = !b.built && !open ? b.cost.plan ?? "" : "";
          const hasPlan = plan === "" || have(plan) >= 1;
          // Tech-tree prerequisites (sites only): the plan is locked until every
          // required building is BUILT at its level.
          const unmet = (!b.built && !open ? b.requires ?? [] : []).filter((req) => {
            const o = game?.town.buildings.find((x) => x.id === req.building);
            return !o || !o.built || o.level < req.level;
          });
          const canAct = open ? enoughMats && invest > 0 : pa >= 1 && unmet.length === 0 && hasPlan;
          const can = inTown && canAct && !busy && !maxed;
          const label = maxed ? "Niv. max" : open ? `+${invest} PA` : b.built ? "📐 Améliorer" : "📐 Poser le plan";
          const hint = !inTown
            ? "Être en ville"
            : maxed
            ? "Niveau maximum atteint"
            : unmet.length > 0
            ? `Requiert ${unmet.map((r) => `${buildingName(r.building)} niv.${r.level}`).join(", ")}`
            : !open && !hasPlan
            ? `Trouve « ${plan} » et dépose-le à la Banque pour poser ce chantier`
            : open && !enoughMats
            ? "Matériaux manquants en Banque — les PA investis restent acquis"
            : open
            ? `Investir ${invest} PA dans ce chantier (${b.paInvested}/${b.cost.pa})`
            : pa < 1
            ? "PA insuffisants"
            : "Poser le plan de chantier (1 PA)";
          return (
            <div className={`ps-row compact ${b.built ? "" : "site"}`} key={b.id}>
              <div className="ps-ic">{b.built ? buildingIcon(b.id) : "🏗️"}</div>
              <div className="ps-main">
                <div className="ps-title">
                  <span className="nm">{buildingName(b.id, b.name)}</span>
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
                  {unmet.length > 0 && (
                    <span className="tag-type miss">
                      🔒 requiert {unmet.map((r) => `${buildingName(r.building)} niv.${r.level}`).join(", ")}
                    </span>
                  )}
                </div>
                {!maxed && (
                  <div className="ps-sub cost">
                    <span className="ing ok">⚡{b.cost.pa} PA</span>
                    {plan !== "" && (
                      <span className={hasPlan ? "ing ok" : "ing miss"}>
                        {" · "}📐 {plan} {have(plan)}/1
                      </span>
                    )}
                    {mats.map((m, i) => (
                      <span key={i} className={have(m.name) >= m.qty ? "ing ok" : "ing miss"}>
                        {" · "}
                        {m.name} {have(m.name)}/{m.qty}
                      </span>
                    ))}
                  </div>
                )}
                {open && (
                  <div className="ps-progress" title={`${b.paInvested}/${b.cost.pa} PA investis`}>
                    <i style={{ width: `${Math.min(100, (b.paInvested / Math.max(1, b.cost.pa)) * 100)}%` }} />
                    <span>
                      {b.paInvested}/{b.cost.pa} PA
                      {!enoughMats && " · ⏸ matériaux manquants"}
                    </span>
                  </div>
                )}
                {open && inTown && maxInvest > 0 && (
                  <div className="ps-invest" role="group" aria-label={`PA à investir dans ${buildingName(b.id, b.name)}`}>
                    <button
                      className="stepbtn"
                      disabled={invest <= 1 || busy}
                      aria-label="Un PA de moins"
                      onClick={() => setInvest(invest - 1)}
                    >
                      −
                    </button>
                    <span className="amt" aria-live="polite">
                      ⚡ {invest} <i>/ {maxInvest}</i>
                    </span>
                    <button
                      className="stepbtn"
                      disabled={invest >= maxInvest || busy}
                      aria-label="Un PA de plus"
                      onClick={() => setInvest(invest + 1)}
                    >
                      +
                    </button>
                    <button
                      className="stepbtn wide"
                      disabled={invest >= maxInvest || busy}
                      aria-label="Investir tous les PA disponibles"
                      onClick={() => setInvest(maxInvest)}
                    >
                      tout
                    </button>
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
        ))}
        {hidden > 0 && (
          <div className="stock-note compact ps-unknown">
            📜 {hidden} bâtiment{hidden > 1 ? "s" : ""} de la ville {hidden > 1 ? "attendent" : "attend"} encore
            {hidden > 1 ? " leurs plans" : " son plan"} — les plans se trouvent dans les ruines et à la fouille.
          </div>
        )}
      </div>
    </div>
  );
}
