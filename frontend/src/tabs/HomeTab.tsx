import { useState } from "react";
import { useStore } from "../store";
import { Overlay } from "../ui/Overlay";
import { TOWN_BUILDINGS, type BuildingLayout } from "../data/buildings";
import { TownMap } from "../components/TownMap";
import { VoxelTownView } from "../voxel/VoxelTownView";
import type { TownBuilding } from "../api/types";
import { HeroChips } from "../components/HeroChips";
import { TownWorker, useWorkerPA } from "../components/TownWorker";
import { effectiveTownHeroId } from "../townUtils";

export function durColor(ratio: number) {
  if (ratio > 0.6) return "#4be36e";
  if (ratio > 0.3) return "#f4c430";
  return "#e24b4b";
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="mini-bar" style={{ marginTop: 3 }}>
      <i style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`, background: color }} />
    </div>
  );
}

// Centered modal for a BUILT, non-workshop building. Construction (build/upgrade) is
// done from the Structure tab, so the "Améliorer" entry jumps there.
function BuildingMenu({ layout, b, onClose }: { layout: BuildingLayout; b: TownBuilding; onClose: () => void }) {
  const townAction = useStore((s) => s.townAction);
  const setTab = useStore((s) => s.setTab);
  const toggleTownStatus = useStore((s) => s.toggleTownStatus);
  const toggleTownJournal = useStore((s) => s.toggleTownJournal);
  const busy = useStore((s) => s.busy);
  const game = useStore((s) => s.game);
  const townHeroId = useStore((s) => s.townHeroId);
  const playerId = useStore((s) => s.playerId);
  const pa = useWorkerPA();
  const noPa = pa < 1 || busy;
  const durFull = b.durability >= b.maxDurability;
  const isDefensive = b.id === "wall" || b.id === "gate" || b.id === "tower";

  // Well: the daily ration is per-hero (the selected town worker). Figure out whether
  // that worker has already drunk today so we can label/disable the button.
  const workerId = game ? effectiveTownHeroId(game, playerId, townHeroId) : undefined;
  const worker = game?.heroes.find((h) => h.id === workerId);
  const workerDrankToday = !!worker && worker.drewWaterDay === game?.day;
  const wellEmpty = b.capacity <= 0;

  // Townhall revive: needs a fallen hero; free and unlimited at level 3, otherwise
  // 2 PA with a daily allowance equal to the building's level (server-enforced).
  const deadHero = game?.heroes.find((h) => h.hp <= 0);
  const reviveCost = b.level >= 3 ? 0 : 2;

  // Building-specific primary action (label, handler, PA cost).
  const flavor: { label: string; fn: () => void; cost: number; disabled?: boolean } | null =
    layout.id === "bank"
      ? { label: "🏦 Ouvrir (Stock)", fn: () => { onClose(); setTab("stock"); }, cost: 0 }
      : layout.id === "kitchen"
      ? { label: "🍳 Cuisiner (Craft)", fn: () => { onClose(); setTab("craft"); }, cost: 0 }
      : layout.id === "tower"
      ? { label: "🗼 Évaluer l'attaque", fn: () => { onClose(); toggleTownStatus(true); }, cost: 0 }
      : layout.id === "townhall"
      ? {
          label: deadHero ? `🛏️ Ressusciter ${deadHero.name}` : "🛏️ Ressusciter (aucun héros à terre)",
          fn: () => townAction("townhall", "revive"),
          cost: reviveCost,
          disabled: !deadHero,
        }
      : layout.id === "panel"
      ? { label: "📋 Journal", fn: () => { onClose(); toggleTownJournal(true); }, cost: 0 }
      : null;

  return (
    <Overlay onClose={onClose} cardClassName="bmenu-modal" labelledBy="bmenu-title">
      <>
        <div className="bm-head">
          <span className="bm-icon">{layout.icon}</span>
          <div className="bm-title">
            <strong id="bmenu-title">{layout.name}</strong> <span className="lvl">Lv {b.level}</span>
          </div>
          <button className="hero-close" onClick={onClose}>✕</button>
        </div>
        <div className="blurb">{layout.blurb}</div>

        <div className="durab">
          Durabilité {b.durability}/{b.maxDurability}
          <Bar value={b.durability} max={b.maxDurability} color={durColor(b.durability / b.maxDurability)} />
        </div>
        {isDefensive && (
          <div className="bm-def">
            🛡 Défense : <b>+{b.defense}</b>
            {b.id === "gate" && b.open && <span className="bm-warn"> — porte ouverte (0)</span>}
          </div>
        )}
        {b.id === "well" && (
          <div className="durab">
            💧 Eau {b.capacity}/{b.maxCapacity}
            <Bar value={b.capacity} max={b.maxCapacity} color="#3da5ff" />
          </div>
        )}

        <div className="act">
          {b.id === "well" && (
            <button
              className="primary"
              disabled={busy || wellEmpty || workerDrankToday || !worker}
              onClick={() => townAction("well", "water")}
            >
              <span>
                💧 {workerDrankToday
                  ? `${worker?.name ?? "Le héros"} a déjà bu aujourd'hui`
                  : wellEmpty
                  ? "Puits à sec"
                  : `Puiser de l'eau${worker ? ` (${worker.name})` : ""}`}
              </span>
              <span className="c">1/jour</span>
            </button>
          )}
          {b.id === "gate" && (
            <button className="primary" disabled={noPa} onClick={() => townAction("gate", "toggle")}>
              <span>🚪 {b.open ? "Fermer la porte" : "Ouvrir la porte"}</span>
              <span className="c">-1</span>
            </button>
          )}
          {flavor && (
            <button
              className={flavor.cost ? "" : "primary"}
              disabled={flavor.disabled || (flavor.cost > 0 && noPa) || (flavor.disabled === false && busy)}
              onClick={flavor.fn}
            >
              <span>{flavor.label}</span>
              {flavor.cost > 0 && <span className="c">-{flavor.cost}</span>}
            </button>
          )}
          <button onClick={() => { onClose(); setTab("structure"); }}>
            <span>🏗️ Améliorer (Structure)</span>
          </button>
          <button disabled={noPa || durFull} onClick={() => townAction(layout.id, "restore", 1)}>
            <span>🔧 Réparer +5 durabilité</span>
            <span className="c">-1</span>
          </button>
        </div>
        <TownWorker />
      </>
    </Overlay>
  );
}

// Home tab = the town. Buildings funded by the PA of heroes in town + Bank materials.
export function HomeTab() {
  const game = useStore((s) => s.game);
  const setTab = useStore((s) => s.setTab);
  const voxelMap = useStore((s) => s.settings.voxelMap);
  const [selected, setSelected] = useState<string | null>(null);
  const buildingState = (id: string) => game?.town.buildings?.find((x) => x.id === id);
  const sel = selected ? TOWN_BUILDINGS.find((b) => b.id === selected) : null;
  const selState = sel ? buildingState(sel.id) : undefined;

  const onBuildingClick = (id: string) => {
    const bs = buildingState(id);
    // The Workshop and any construction site lead straight to the Structure tab.
    if (id === "workshop" || (bs && !bs.built)) {
      setTab("structure");
      return;
    }
    setSelected((cur) => (cur === id ? null : id));
  };

  return (
    <div className="town-wrap" style={{ position: "absolute", inset: 0 }}>
      <div className="chat-bubble">
        <span className="who">Neko :</span> Putain qui a laissé la porte ouverte encore !!
      </div>

      <div className={`town ${selected ? "dim" : ""}`}>
        {/* The town map: authored in the editor (JSON export). Rendered by the
            editor's canvas renderer, or by the voxel engine when the experimental
            voxel flag is on (VOXEL-PLAN Phase 4) — same props either way. */}
        {voxelMap ? (
          <VoxelTownView selected={selected} onBuildingClick={onBuildingClick} onClear={() => setSelected(null)} />
        ) : (
          <TownMap selected={selected} onBuildingClick={onBuildingClick} onClear={() => setSelected(null)} />
        )}

        <div className="shinki">
          <div className="face">🦊</div>
          <div className="msg">
            <div className="who">Shinki</div>
            <div className="txt">Bienvenue à Echo Terra, voyageuse ! La horde approche…</div>
          </div>
        </div>
      </div>

      {sel && selState && selState.built && (
        <BuildingMenu layout={sel} b={selState} onClose={() => setSelected(null)} />
      )}

      <HeroChips />
    </div>
  );
}
