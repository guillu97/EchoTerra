import { useState } from "react";
import { useStore } from "../store";
import { Overlay } from "../ui/Overlay";
import { buildingBlurb, buildingName, TOWN_BUILDINGS, TOWN_REPAIR_HP, type BuildingLayout } from "../data/buildings";
import { VoxelTownView } from "../voxel/VoxelTownView";
import type { TownBuilding } from "../api/types";
import { HeroChips } from "../components/HeroChips";
import { TownOrders } from "../components/TownOrders";
import { TownWorker, useWorkerPA } from "../components/TownWorker";
import { effectiveTownHeroId } from "../townUtils";
import { useT } from "../i18n/useT";

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
  const scoutWave = useStore((s) => s.scoutWave);
  const setTab = useStore((s) => s.setTab);
  const toggleTownStatus = useStore((s) => s.toggleTownStatus);
  const toggleTownJournal = useStore((s) => s.toggleTownJournal);
  const toggleTownLedger = useStore((s) => s.toggleTownLedger);
  const toggleChat = useStore((s) => s.toggleChat);
  const busy = useStore((s) => s.busy);
  const game = useStore((s) => s.game);
  const townHeroId = useStore((s) => s.townHeroId);
  const playerId = useStore((s) => s.playerId);
  const pa = useWorkerPA();
  const { t } = useT();
  const noPa = pa < 1 || busy;
  const durFull = b.durability >= b.maxDurability;
  const isDefensive = b.id === "wall" || b.id === "gate" || b.id === "tower";
  // Remparts : PV de la VILLE (distincts de la durabilité du bâtiment), et la pierre
  // qui les paie (game.TownRepairMaterial côté serveur).
  const townFull = !!game && game.town.hp >= game.town.maxHp;
  const townStone = (game?.town.storage.find((it) => it.name === "Pierre")?.qty ?? 0) > 0;

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

  // Infirmerie : le blessé le plus mal en point parmi les héros EN VILLE (miroir du
  // choix serveur, cf. TownAction "heal").
  const hurt = (game?.heroes ?? [])
    .filter((h) => h.hp > 0 && h.x === game?.town.x && h.y === game?.town.y)
    .filter((h) => h.hp < h.maxHp || h.states.includes("Blessé"))
    .sort((a, z) => a.hp - z.hp)[0];

  // Building-specific primary action (label, handler, PA cost).
  const flavor: { label: string; fn: () => void; cost: number; disabled?: boolean } | null =
    layout.id === "bank"
      ? { label: "🏦 " + t("Ouvrir (Stock)"), fn: () => { onClose(); setTab("stock"); }, cost: 0 }
      : layout.id === "kitchen"
      ? { label: "🍳 " + t("Cuisiner (Atelier)"), fn: () => { onClose(); setTab("craft"); }, cost: 0 }
      : layout.id === "tower"
      ? { label: "🗼 " + t("Évaluer l'attaque"), fn: () => { onClose(); toggleTownStatus(true); }, cost: 0 }
      : layout.id === "townhall"
      ? {
          label: deadHero
            ? "🛏️ " + t("Ressusciter {name}", { name: deadHero.name })
            : "🛏️ " + t("Ressusciter (aucun héros à terre)"),
          fn: () => townAction("townhall", "revive"),
          cost: reviveCost,
          disabled: !deadHero,
        }
      : layout.id === "panel"
      ? { label: "📋 " + t("Journal"), fn: () => { onClose(); toggleTownJournal(true); }, cost: 0 }
      : layout.id === "poste"
      ? { label: "✉️ " + t("Ouvrir la messagerie"), fn: () => { onClose(); toggleChat(true); }, cost: 0 }
      : layout.id === "infirmerie"
      ? {
          // L'Infirmerie soigne le plus mal en point de MES héros présents (le serveur
          // choisit le patient : à quinze héros, désigner soi-même serait une corvée).
          // Quota quotidien = niveau ; gratuit et illimité au niveau 3.
          label: hurt ? "🏥 " + t("Soigner {name}", { name: hurt.name }) : "🏥 " + t("Soigner (personne de blessé)"),
          fn: () => townAction("infirmerie", "heal"),
          cost: b.level >= 3 ? 0 : 1,
          disabled: !hurt,
        }
      : null;

  return (
    <Overlay onClose={onClose} cardClassName="bmenu-modal" labelledBy="bmenu-title">
      <>
        <div className="bm-head">
          <span className="bm-icon">{layout.icon}</span>
          <div className="bm-title">
            <strong id="bmenu-title">{buildingName(layout.id, layout.name)}</strong>{" "}
            <span className="lvl">{t("Niv. {n}", { n: b.level })}</span>
          </div>
          <button className="hero-close" onClick={onClose}>✕</button>
        </div>
        <div className="blurb">{buildingBlurb(layout.id)}</div>

        <div className="durab">
          {t("Durabilité")} {b.durability}/{b.maxDurability}
          <Bar value={b.durability} max={b.maxDurability} color={durColor(b.durability / b.maxDurability)} />
        </div>
        {isDefensive && (
          <div className="bm-def">
            🛡 {t("Défense")} : <b>+{b.defense}</b>
            {b.id === "gate" && b.open && <span className="bm-warn"> — {t("porte ouverte (0)")}</span>}
          </div>
        )}
        {b.id === "well" && (
          <div className="durab">
            💧 {t("Eau")} {b.capacity}/{b.maxCapacity}
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
                  ? t("{name} a déjà bu aujourd'hui", { name: worker?.name ?? t("Le héros") })
                  : wellEmpty
                  ? t("Puits à sec")
                  : worker
                  ? t("Puiser de l'eau ({name})", { name: worker.name })
                  : t("Puiser de l'eau")}
              </span>
              <span className="c">{t("1/jour")}</span>
            </button>
          )}
          {/* LA TOUR DE GUET : monter observer la horde. Ce n'est pas un bonus solo —
              chaque JOUEUR qui s'y colle resserre la fourchette pour toute la ville, et
              chacun ne compte qu'une fois par vague. C'est ce qui donne à la Tour un
              rôle au-delà de ses points de défense. */}
          {b.id === "tower" && (
            <button
              className="primary"
              disabled={busy || (game?.town.forecast?.precision ?? 0) >= 99}
              onClick={() => { scoutWave(); }}
            >
              <span>
                🔭 {t("Estimer la vague")}
                {game?.town.forecast &&
                  ` (${game.town.forecast.min}–${game.town.forecast.max}, ${game.town.forecast.precision}%)`}
              </span>
              <span className="c">-2</span>
            </button>
          )}
          {b.id === "gate" && (
            <button className="primary" disabled={noPa} onClick={() => townAction("gate", "toggle")}>
              <span>🚪 {b.open ? t("Fermer la porte") : t("Ouvrir la porte")}</span>
              <span className="c">-1</span>
            </button>
          )}
          {/* Relever les remparts : la SEULE façon de rendre des PV à la ville. Sans
              elle, Town.HP ne faisait que descendre et toute partie était un compte à
              rebours — c'est ce qui rend l'épuisement de la carte, et non l'arithmétique
              de la horde, la vraie limite d'une longue partie. Payée en PA ET en pierre. */}
          {b.id === "wall" && (
            <button
              className="primary"
              disabled={noPa || townFull || !townStone}
              onClick={() => townAction("wall", "repair", 1)}
            >
              <span>
                🧱 {townFull
                  ? t("La ville est intacte")
                  : townStone
                  ? t("Relever les remparts (+{n} PV)", { n: TOWN_REPAIR_HP })
                  : t("Il faut de la Pierre à la Banque")}
              </span>
              <span className="c">{t("-1 PA · -1 Pierre")}</span>
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
          {/* Le Panneau porte DEUX lectures : ce qui s'est passé (journal) et ce que
              chacun a apporté (registre) — cf. TownLedger.tsx. */}
          {layout.id === "panel" && (
            <button onClick={() => { onClose(); toggleTownLedger(true); }}>
              <span>🤝 {t("Ce que la ville vous doit")}</span>
            </button>
          )}
          <button onClick={() => { onClose(); setTab("structure"); }}>
            <span>🏗️ {t("Améliorer (Bâtir)")}</span>
          </button>
          <button disabled={noPa || durFull} onClick={() => townAction(layout.id, "restore", 1)}>
            <span>🔧 {t("Réparer +5 durabilité")}</span>
            <span className="c">-1</span>
          </button>
        </div>
        <TownWorker />
      </>
    </Overlay>
  );
}

// La bulle de conversation posée sur la ville : le DERNIER message réel du
// board, cliquable pour ouvrir la messagerie.
//
// Elle affichait jusqu'ici deux répliques codées en dur reprises de la maquette
// (« Neko : Putain qui a laissé la porte ouverte encore !! » et le bandeau
// Shinki 🦊) — une promesse de fonctionnalité que rien ne tenait. Le bandeau du
// bas a disparu avec elles : c'est la place de la liste des personnages.
function ChatBubble() {
  const chat = useStore((s) => s.chat);
  const toggleChat = useStore((s) => s.toggleChat);
  const { t } = useT();
  const last = chat[chat.length - 1];
  if (!last) return null;
  return (
    <button className="chat-bubble" title={t("Ouvrir la messagerie")} onClick={() => toggleChat(true)}>
      <span className="who">{last.author} :</span> {last.text}
    </button>
  );
}

// Home tab = the town. Buildings funded by the PA of heroes in town + Bank materials.
export function HomeTab() {
  const game = useStore((s) => s.game);
  const setTab = useStore((s) => s.setTab);
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
      {/* L'ordre du jour passe AVANT tout le reste : c'est la première chose qu'une
          session de cinq minutes doit lire. */}
      <TownOrders />
      <ChatBubble />

      <div className={`town ${selected ? "dim" : ""}`}>
        {/* Le tertre en voxel. Le rendu 2D isométrique de secours a été retiré
            (2026-07-29) : maintenir deux moteurs obligeait le plan à rester
            compatible d'une grille de cases, ce qui interdisait précisément la
            géométrie polaire et le terrain lissé. */}
        {/* ⚠ `key` PAR PARTIE : la scène de la ville est montée UNE fois
            (`useEffect(..., [])`) et son terrain lit le thème AU MONTAGE. Sans cette
            clé, reprendre une autre expédition sans recharger la page garde la palette
            de la précédente — mesuré : un bourg nordique rendu en ocre désertique. */}
        <VoxelTownView
          key={game?.id ?? "none"}
          selected={selected}
          onBuildingClick={onBuildingClick}
          onClear={() => setSelected(null)}
        />
      </div>

      {sel && selState && selState.built && (
        <BuildingMenu layout={sel} b={selState} onClose={() => setSelected(null)} />
      )}

      <HeroChips />
    </div>
  );
}
