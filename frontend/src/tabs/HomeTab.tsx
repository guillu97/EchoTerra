import { useState, useRef, useEffect } from "react";
import { useStore } from "../store";
import { TOWN_BUILDINGS, ISO_TOWN, ISO_TOWN_TILES, ISO_BUILDING_CELL, type BuildingLayout, type IsoTileKind } from "../data/buildings";
import { assetUrl, type AssetKey } from "../assets";

// Iso tile kind -> asset key.
const ISO_TILE_ASSET: Record<IsoTileKind, AssetKey> = {
  grass: "iso-grass", stone: "iso-stone", water: "iso-water",
  sand: "iso-sand", forest: "iso-forest", snow: "iso-snow", bridge: "iso-bridge",
};

// Screen position of grid cell (gx,gy), centred on the grid, scaled by `scale`.
function isoPos(gx: number, gy: number, scale: number) {
  const cx = gx - ISO_TOWN.center;
  const cy = gy - ISO_TOWN.center;
  return {
    x: (cx - cy) * (ISO_TOWN.tileW / 2) * scale,
    y: (cx + cy) * (ISO_TOWN.tileH / 2) * scale,
  };
}

// Track a container's width and derive the iso scale factor (responsive sizing).
function useIsoScale() {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale((el.clientWidth || ISO_TOWN.refWidth) / ISO_TOWN.refWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, scale };
}
import type { TownBuilding } from "../api/types";
import { HeroChips } from "../components/HeroChips";
import { TownWorker, useWorkerPA } from "../components/TownWorker";
import { effectiveTownHeroId } from "../townUtils";
import { useWaveRemaining, formatHMS } from "../useWave";

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
  const pushLog = useStore((s) => s.pushLog);
  const busy = useStore((s) => s.busy);
  const game = useStore((s) => s.game);
  const townHeroId = useStore((s) => s.townHeroId);
  const pa = useWorkerPA();
  const noPa = pa < 1 || busy;
  const durFull = b.durability >= b.maxDurability;
  const isDefensive = b.id === "wall" || b.id === "gate" || b.id === "tower";

  // Well: the daily ration is per-hero (the selected town worker). Figure out whether
  // that worker has already drunk today so we can label/disable the button.
  const workerId = game ? effectiveTownHeroId(game, townHeroId) : undefined;
  const worker = game?.heroes.find((h) => h.id === workerId);
  const workerDrankToday = !!worker && worker.drewWaterDay === game?.day;
  const wellEmpty = b.capacity <= 0;

  // Building-specific primary action (label, handler, PA cost).
  const flavor: { label: string; fn: () => void; cost: number } | null =
    layout.id === "bank"
      ? { label: "🏦 Ouvrir (Stock)", fn: () => { onClose(); setTab("stock"); }, cost: 0 }
      : layout.id === "kitchen"
      ? { label: "🍳 Cuisiner (Craft)", fn: () => { onClose(); setTab("craft"); }, cost: 0 }
      : layout.id === "tower"
      ? { label: "🗼 Évaluer l'attaque", fn: () => { onClose(); toggleTownStatus(true); }, cost: 0 }
      : layout.id === "townhall"
      ? { label: "🛏️ Ressusciter un héros", fn: () => townAction("townhall", "use"), cost: 1 }
      : layout.id === "panel"
      ? { label: "📋 Journal", fn: () => pushLog("📋 Journal de la ville — bientôt"), cost: 0 }
      : null;

  return (
    <div className="settings" onClick={onClose}>
      <div className="panel-card bmenu-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bm-head">
          <span className="bm-icon">{layout.icon}</span>
          <div className="bm-title">
            <strong>{layout.name}</strong> <span className="lvl">Lv {b.level}</span>
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
            <button className={flavor.cost ? "" : "primary"} disabled={flavor.cost > 0 && noPa} onClick={flavor.fn}>
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
      </div>
    </div>
  );
}

// Home tab = the town. Buildings funded by the PA of heroes in town + Bank materials.
export function HomeTab() {
  const game = useStore((s) => s.game);
  const toggleTownStatus = useStore((s) => s.toggleTownStatus);
  const setTab = useStore((s) => s.setTab);
  const [selected, setSelected] = useState<string | null>(null);
  const { ref: townRef, scale } = useIsoScale();
  const remaining = useWaveRemaining(game);
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
    <div className="town-wrap" ref={townRef} style={{ position: "absolute", inset: 0 }}>
      <button className="wave-banner" onClick={() => toggleTownStatus(true)} title="Voir l'état de la ville">
        Next wave in
        <br />
        <b>{formatHMS(remaining)}</b>
        {game && <span className="wb-hp">🏰 {Math.round((game.town.hp / game.town.maxHp) * 100)}%</span>}
      </button>

      <div className="chat-bubble">
        <span className="who">Neko :</span> Putain qui a laissé la porte ouverte encore !!
      </div>

      <div className={`town ${selected ? "dim" : ""}`} onClick={() => setSelected(null)}>
        {/* Isometric tile platform: layered rendering — ground tiles, then buildings. */}
        <div className="iso-stage">
          {/* Layer 1 — ground tiles (depth-sorted among tiles). */}
          <div className="iso-layer iso-tiles">
            {ISO_TOWN_TILES.map((t) => {
              const { x, y } = isoPos(t.gx, t.gy, scale);
              const src = assetUrl(ISO_TILE_ASSET[t.kind]);
              if (!src) return null;
              return (
                <img
                  key={`t-${t.gx}-${t.gy}`}
                  src={src}
                  className="iso-tile"
                  alt=""
                  style={{ left: x, top: y, width: ISO_TOWN.cube * scale, zIndex: t.gx + t.gy }}
                />
              );
            })}
          </div>

          {/* Layer 2 — buildings (depth-sorted among buildings, always above tiles). */}
          <div className="iso-layer iso-buildings">
          {TOWN_BUILDINGS.map((b) => {
            const cell = ISO_BUILDING_CELL[b.id];
            if (!cell) return null;
            const bs = buildingState(b.id);
            if (!bs || (!bs.built && !bs.underConstruction)) return null;
            const site = !bs.built; // under construction
            const imgSrc = site ? assetUrl("building-scaffold") : assetUrl(b.assetKey);
            const { x, y } = isoPos(cell.gx, cell.gy, scale);
            return (
              <button
                key={b.id}
                className={`building ${selected === b.id ? "active" : ""} ${site ? "site" : ""}`}
                style={{ left: x, top: y, zIndex: Math.round(cell.gx + cell.gy) }}
                title={site ? `${b.name} — en construction` : b.name}
                onClick={(e) => {
                  e.stopPropagation();
                  onBuildingClick(b.id);
                }}
              >
                <span
                  className={`ic ${imgSrc ? "has-img" : ""}`}
                  style={imgSrc ? { width: ISO_TOWN.build * scale, height: ISO_TOWN.build * scale } : undefined}
                >
                  {imgSrc
                    ? <img src={imgSrc} alt={b.icon} className="building-img" />
                    : site
                    ? "🏗️"
                    : b.icon}
                </span>
                <span className="nm">{b.name}</span>
              </button>
            );
          })}
          </div>
        </div>

        <div className="shinki">
          <div className="face">🦊</div>
          <div className="msg">
            <div className="who">Shinki</div>
            <div className="txt">Welcome to Echo Terra, traveler!</div>
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
