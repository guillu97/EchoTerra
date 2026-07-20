import { useStore } from "../store";
import { myTeamHeroes } from "../townUtils";
import { assetUrl, type AssetKey } from "../assets";
import type { Hero } from "../api/types";

// Portrait key for a hero class (same mapping as TopBar / HeroOverlay).
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

// Barre de sélection des héros, posée sur la carte (vue Map uniquement). Une
// pastille par héros de MON équipe : portrait, nom, barre de PV, PA, et un badge
// de lieu (🏰 en ville). Taper une pastille sélectionne le héros ACTIF (celui
// que les losanges jaunes déplacent) ET recentre la caméra dessus. C'est LE
// moyen simple de choisir qui sort de la ville (sélectionner puis taper une case
// adjacente) et qui je déplace — plus besoin du dropdown 🙂 pour ça.
export function MapHeroBar() {
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const selectedHeroId = useStore((s) => s.selectedHeroId);
  const focusHero = useStore((s) => s.focusHero);
  const openHero = useStore((s) => s.openHero);
  if (!game) return null;

  const roster = myTeamHeroes(game, playerId);
  if (roster.length === 0) return null;

  const selected = roster.find((h) => h.id === selectedHeroId);
  const selInTown = !!selected && selected.hp > 0 && selected.x === game.town.x && selected.y === game.town.y;

  return (
    <div className="map-herobar">
      <div className="mhb-row">
        {roster.map((h) => (
          <HeroChip
            key={h.id}
            hero={h}
            inTown={h.hp > 0 && h.x === game.town.x && h.y === game.town.y}
            selected={h.id === selectedHeroId}
            onSelect={() => focusHero(h.id)}
            onOpenSheet={() => openHero(h.id)}
          />
        ))}
      </div>
      {selected && selected.hp > 0 && (
        <div className="mhb-hint">
          {selInTown ? (
            <>🏰 <strong>{selected.name}</strong> est en ville — tape une case adjacente pour le faire sortir.</>
          ) : selected.states.includes("Tétanisé") ? (
            <>⚠️ <strong>{selected.name}</strong> est Tétanisé — tue le pack ou fuis.</>
          ) : (
            <>🎯 <strong>{selected.name}</strong> sélectionné — tape les losanges jaunes pour le déplacer.</>
          )}
        </div>
      )}
    </div>
  );
}

function HeroChip({
  hero,
  inTown,
  selected,
  onSelect,
  onOpenSheet,
}: {
  hero: Hero;
  inTown: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpenSheet: () => void;
}) {
  const dead = hero.hp <= 0;
  const stuck = hero.states.includes("Tétanisé");
  const hpPct = Math.max(0, Math.min(100, Math.round((hero.hp / hero.maxHp) * 100)));
  const hpClass = hpPct > 60 ? "" : hpPct > 30 ? "warn" : "low";
  const portrait = assetUrl(portraitKey(hero.classId));

  return (
    <div className={`mhb-chip ${selected ? "sel" : ""} ${dead ? "dead" : ""}`}>
      <button
        className="mhb-pick"
        disabled={dead}
        title={dead ? `${hero.name} est à terre` : `Sélectionner ${hero.name} et le viser sur la carte`}
        onClick={onSelect}
      >
        <span className="mhb-portrait">
          {portrait ? <img src={portrait} alt="" /> : <span className="mhb-emoji">🙂</span>}
          {dead ? (
            <span className="mhb-badge dead">💀</span>
          ) : inTown ? (
            <span className="mhb-badge town">🏰</span>
          ) : stuck ? (
            <span className="mhb-badge warn">🔒</span>
          ) : null}
        </span>
        <span className="mhb-info">
          <span className="mhb-name">{hero.name}</span>
          <span className="mhb-hpbar">
            <i className={hpClass} style={{ width: `${hpPct}%` }} />
          </span>
          <span className="mhb-pa">⚡ {hero.pa}/{hero.maxPa}</span>
        </span>
      </button>
      <button className="mhb-sheet" title="Fiche du personnage" onClick={onOpenSheet}>
        ⓘ
      </button>
    </div>
  );
}
