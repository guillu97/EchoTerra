import { useState } from "react";
import { useStore } from "../store";
import { Overlay } from "../ui/Overlay";
import { TOWN_BUILDINGS, TOWN_REPAIR_HP, type BuildingLayout } from "../data/buildings";
import { VoxelTownView } from "../voxel/VoxelTownView";
import type { TownBuilding } from "../api/types";
import { HeroChips } from "../components/HeroChips";
import { TownOrders } from "../components/TownOrders";
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
  const scoutWave = useStore((s) => s.scoutWave);
  const setTab = useStore((s) => s.setTab);
  const toggleTownStatus = useStore((s) => s.toggleTownStatus);
  const toggleTownJournal = useStore((s) => s.toggleTownJournal);
  const toggleTownLedger = useStore((s) => s.toggleTownLedger);
  const toggleTemple = useStore((s) => s.toggleTemple);
  const toggleChat = useStore((s) => s.toggleChat);
  const busy = useStore((s) => s.busy);
  const game = useStore((s) => s.game);
  const townHeroId = useStore((s) => s.townHeroId);
  const playerId = useStore((s) => s.playerId);
  const pa = useWorkerPA();
  const noPa = pa < 1 || busy;
  const durFull = b.durability >= b.maxDurability;
  const isDefensive = b.id === "wall" || b.id === "gate" || b.id === "tower";
  // Remparts : PV de la VILLE (distincts de la durabilité du bâtiment), et la pierre
  // qui les paie (game.TownRepairMaterial côté serveur).
  const townFull = !!game && game.town.hp >= game.town.maxHp;
  const townStone = (game?.town.storage.find((it) => it.name === "Pierre")?.qty ?? 0) > 0;

  // Puits : la ration est PAR HÉROS et par jour, et le puits la met dans le SAC — on
  // n'a donc rien bu en la puisant (boire, c'est le bouton 💧 de la carte, +6 PA). Deux
  // conséquences pour l'étiquette :
  //  - on dit « puisé », jamais « bu » ;
  //  - le quota épuisé se lit sur la liste DÉRIVÉE du serveur (`waterDrawnToday`), pas
  //    sur `drewWaterDay` : ce champ ne porte que le JOUR de la dernière ration, donc le
  //    comparer au jour courant grisait le puits dès la PREMIÈRE alors qu'une Cuisine
  //    niveau 2 en autorise une seconde (dailyWaterAllowance côté serveur).
  const workerId = game ? effectiveTownHeroId(game, playerId, townHeroId) : undefined;
  const worker = game?.heroes.find((h) => h.id === workerId);
  const waterAllowance = game?.town.waterAllowance ?? 1;
  const waterDrawn = worker && worker.drewWaterDay === game?.day ? worker.drewWaterCount ?? 1 : 0;
  const workerWaterDone = !!worker && (game?.town.waterDrawnToday ?? []).includes(worker.id);
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
      : layout.id === "poste"
      ? { label: "✉️ Ouvrir la messagerie", fn: () => { onClose(); toggleChat(true); }, cost: 0 }
      : layout.id === "temple"
      ? {
          // LE TEMPLE : le compteur de faveur et le scrutin. Gratuit — voter est une
          // décision, pas un travail, et le faire payer en PA donnerait le dernier mot
          // au joueur le plus riche.
          label: `${game?.theme?.pantheon?.favor ?? "⚡"} Appeler un dieu (${game?.town.favor ?? 0}/${game?.town.favorGoal ?? 20})`,
          fn: () => { onClose(); toggleTemple(true); },
          cost: 0,
        }
      : layout.id === "infirmerie"
      ? {
          // L'Infirmerie soigne le plus mal en point de MES héros présents (le serveur
          // choisit le patient : à quinze héros, désigner soi-même serait une corvée).
          // Quota quotidien = niveau ; gratuit et illimité au niveau 3.
          label: hurt ? `🏥 Soigner ${hurt.name}` : "🏥 Soigner (personne de blessé)",
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
          <>
            <div className="durab">
              💧 Eau {b.capacity}/{b.maxCapacity}
              <Bar value={b.capacity} max={b.maxCapacity} color="#3da5ff" />
            </div>
            {/* Ce que le puits fait VRAIMENT : la ration part dans le SAC, elle ne se
                boit qu'ensuite sur le terrain. Sans cette phrase « puiser » et « boire »
                se confondent, et le joueur croit avoir dépensé son eau sans y toucher. */}
            <div className="bm-def">
              La ration part dans le sac de {worker?.name ?? "l'ouvrier"} — elle se boit ensuite
              (💧 sur la carte, +6 PA).
            </div>
          </>
        )}

        <div className="act">
          {b.id === "well" && (
            <button
              className="primary"
              disabled={busy || wellEmpty || workerWaterDone || !worker}
              onClick={() => townAction("well", "water")}
            >
              <span>
                💧 {workerWaterDone
                  ? waterAllowance > 1
                    ? `${worker?.name ?? "Le héros"} a puisé ses ${waterAllowance} rations`
                    : `${worker?.name ?? "Le héros"} a déjà puisé sa ration`
                  : wellEmpty
                  ? "Puits à sec"
                  : `Puiser une ration${worker ? ` (${worker.name})` : ""}`}
              </span>
              <span className="c">
                {waterDrawn}/{waterAllowance} auj.
              </span>
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
                🔭 Estimer la vague
                {game?.town.forecast &&
                  ` (${game.town.forecast.min}–${game.town.forecast.max}, ${game.town.forecast.precision}%)`}
              </span>
              <span className="c">-2</span>
            </button>
          )}
          {b.id === "gate" && (
            <button className="primary" disabled={noPa} onClick={() => townAction("gate", "toggle")}>
              <span>🚪 {b.open ? "Fermer la porte" : "Ouvrir la porte"}</span>
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
                  ? "La ville est intacte"
                  : townStone
                  ? `Relever les remparts (+${TOWN_REPAIR_HP} PV)`
                  : "Il faut de la Pierre à la Banque"}
              </span>
              <span className="c">-1 PA · -1 Pierre</span>
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
              <span>🤝 Ce que la ville vous doit</span>
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
  const last = chat[chat.length - 1];
  if (!last) return null;
  return (
    <button className="chat-bubble" title="Ouvrir la messagerie" onClick={() => toggleChat(true)}>
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
