import { useState } from "react";
import { useStore } from "../store";
import { HeroActionsMenu } from "./HeroActionsMenu";
import { heroesInTown } from "../townUtils";
import { assetUrl, type AssetKey } from "../assets";

// Portrait key for a hero class (same mapping as HeroOverlay).
function portraitKey(classId?: string): AssetKey {
  const map: Record<string, AssetKey> = {
    pionnier: "hero-pionnier",
    chasseur: "hero-chasseur",
    eclaireur: "hero-eclaireur",
    gardien: "hero-gardien",
    recuperateur: "hero-recuperateur",
    herboriste: "hero-herboriste",
  };
  return (classId && map[classId]) || "hero-sans-classe";
}

// Top status bar present on all in-game screens (avatar, town name, town HP,
// team PA, journal, settings). The avatar opens the hero dropdown: roster +
// per-hero actions + character sheets.
export function TopBar() {
  const openSettings = useStore((s) => s.openSettings);
  const toggleTownStatus = useStore((s) => s.toggleTownStatus);
  const toggleTownJournal = useStore((s) => s.toggleTownJournal);
  const toggleCheat = useStore((s) => s.toggleCheat);
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const selectedHeroId = useStore((s) => s.selectedHeroId);
  const [heroMenu, setHeroMenu] = useState(false);
  const hpPct = game ? Math.round((game.town.hp / game.town.maxHp) * 100) : 100;
  const hpClass = hpPct > 60 ? "" : hpPct > 30 ? "warn" : "alert";
  const inTown = heroesInTown(game, playerId).length > 0;

  // My team's cumulated PA (all heroes in a multi game, every hero in legacy solo).
  const myIds = game?.players?.find((p) => p.id === playerId)?.heroIds;
  const myHeroes = (game?.heroes ?? []).filter((h) => !myIds || myIds.includes(h.id));
  const totalPA = myHeroes.reduce((a, h) => a + h.pa, 0);

  const selHero = game?.heroes.find((h) => h.id === selectedHeroId) ?? myHeroes[0];
  const portrait = assetUrl(portraitKey(selHero?.classId));

  return (
    <div className="topbar">
      <button className="avatar" title="Mes personnages" onClick={() => setHeroMenu((o) => !o)}>
        {portrait ? <img src={portrait} alt="🙂" /> : "🙂"}
      </button>
      {heroMenu && <HeroActionsMenu onClose={() => setHeroMenu(false)} />}
      {/* NOT className="town": the Home container's `.town { position:absolute;
          inset:0 }` rule stretches it over the avatar and eats its clicks. */}
      <span className="town-name">{game?.name || "Echo Terra"}</span>
      <button className={`chip ${hpClass}`} onClick={() => toggleTownStatus(true)} title="État de la ville">
        🏰 {hpPct}%
      </button>
      <span className="chip pa" title="PA cumulés de ton équipe">
        ⚡ {totalPA} PA
      </span>
      {inTown && (
        <button className="iconbtn" title="Journal de la ville" onClick={() => toggleTownJournal(true)}>
          📋
        </button>
      )}
      <button className="iconbtn" title="Triche (dev)" onClick={toggleCheat}>
        🔧
      </button>
      <button className="iconbtn" title="Paramètres" onClick={() => openSettings("menu")}>
        ⚙️
      </button>
    </div>
  );
}
