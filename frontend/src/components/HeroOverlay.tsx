import { useState } from "react";
import { useStore } from "../store";
import type { Stats } from "../api/types";
import { assetUrl, type AssetKey } from "../assets";

function heroAssetKey(classId: string): AssetKey {
  const map: Record<string, AssetKey> = {
    pionnier: "hero-pionnier",
    chasseur: "hero-chasseur",
    eclaireur: "hero-eclaireur",
    gardien: "hero-gardien",
    recuperateur: "hero-recuperateur",
    herboriste: "hero-herboriste",
  };
  return map[classId] ?? "hero-sans-classe";
}

// Evolution day thresholds (mirror backend internal/game/classes.go
// EvolveDayIntermediate / EvolveDayAdvanced). game.day increments every 2 waves.
const EVOLVE_DAY_INTERMEDIATE = 2;
const EVOLVE_DAY_ADVANCED = 4;

const ATTR_ROWS: { key: keyof Stats; label: string }[] = [
  { key: "force", label: "Strength" },
  { key: "dexterite", label: "Dexterity" },
  { key: "precision", label: "Accuracy" },
  { key: "agilite", label: "Agility" },
  { key: "endurance", label: "Endurance" },
  { key: "athletisme", label: "Athleticism" },
];

function tierLabel(tier: number): string {
  switch (tier) {
    case 1: return "Classe intermédiaire";
    case 2: return "Classe avancée";
    default: return "Sans classe";
  }
}

function bonusSummary(bonuses: Stats, paBonus: number): string {
  const parts: string[] = [];
  ATTR_ROWS.forEach(({ key, label }) => {
    if (bonuses[key]) parts.push(`+${bonuses[key]} ${label}`);
  });
  if (paBonus) parts.push(`+${paBonus} PA`);
  return parts.join(" · ");
}

// Character screen (opened from the top-left avatar). Class, attributes + bonuses and
// unique skills. ◀ ▶ cycle the roster. Inventory lives in the Stock tab, not here.
export function HeroOverlay() {
  const heroId = useStore((s) => s.heroOverlay);
  const game = useStore((s) => s.game);
  const classes = useStore((s) => s.classes);
  const openHero = useStore((s) => s.openHero);
  const close = useStore((s) => s.closeHero);
  const evolve = useStore((s) => s.evolve);
  const busy = useStore((s) => s.busy);
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!heroId || !game) return null;
  const index = game.heroes.findIndex((h) => h.id === heroId);
  const h = game.heroes[index];
  if (!h) return null;
  const n = game.heroes.length;
  const cycle = (delta: number) => {
    setPickerOpen(false);
    openHero(game.heroes[(index + delta + n) % n].id);
  };
  const here = h.x === game.town.x && h.y === game.town.y;

  const currentClass = classes.find((c) => c.id === h.classId);
  const nextTier = h.classTier + 1;
  const requiredDay = nextTier === 1 ? EVOLVE_DAY_INTERMEDIATE : EVOLVE_DAY_ADVANCED;
  const maxed = h.classTier >= 2;
  const eligible = !maxed && game.day >= requiredDay;
  const nextChoices = classes.filter((c) => c.tier === nextTier);

  return (
    <div className="settings" onClick={() => close()}>
      <div className="panel-card hero-card-screen" onClick={(e) => e.stopPropagation()}>
        <div className="hero-screen-head">
          <span className="hss-title">Personnage</span>
          <button className="hero-close" onClick={() => close()}>✕</button>
        </div>

        {/* header with roster arrows */}
        <div className="hero-top">
          <button className="hero-arrow" onClick={() => cycle(-1)} aria-label="précédent">◀</button>
          <div className="hero-portrait">
            {assetUrl(heroAssetKey(h.classId))
              ? <img src={assetUrl(heroAssetKey(h.classId))} alt="🔥" className="portrait-img" />
              : "🔥"}
          </div>
          <div className="hero-id">
            <div className="hero-name">{h.classTier === 0 ? "Sans classe" : h.class}</div>
            <div className="hero-class">{tierLabel(h.classTier)} · {h.name}</div>
          </div>
          <button className="hero-arrow" onClick={() => cycle(1)} aria-label="suivant">▶</button>
          <button
            className="pill green evolve"
            disabled={maxed || !eligible || busy}
            onClick={() => setPickerOpen((v) => !v)}
          >
            {maxed ? "Max" : eligible ? "Evolve" : `Jour ${requiredDay}`}
          </button>
        </div>

        {pickerOpen && eligible && (
          <div className="evolve-picker">
            <div className="ep-title">Choisis une évolution — {tierLabel(nextTier)}</div>
            {nextChoices.map((c) => (
              <div className="ep-option" key={c.id}>
                <div className="ep-head">
                  <strong>{c.name}</strong>
                  <button
                    className="pill green ep-pick"
                    disabled={busy}
                    onClick={() => {
                      setPickerOpen(false);
                      evolve(c.id);
                    }}
                  >
                    Choisir
                  </button>
                </div>
                <div className="ep-role">{c.role}</div>
                <div className="ep-bonuses">{bonusSummary(c.bonuses, c.paBonus)}</div>
              </div>
            ))}
          </div>
        )}

        <div className="hero-hpbar">
          <span>❤️ {h.hp}/{h.maxHp}</span>
          <span>⚡ {h.pa}/{h.maxPa} PA</span>
          <span className={`tag-loc ${here ? "in" : "out"}`}>{here ? "en ville" : "en expédition"}</span>
        </div>

        <h4>Attributes</h4>
        <div className="attr-grid">
          {ATTR_ROWS.map(({ key, label }) => {
            const bonus = h.classBonuses[key] ?? 0;
            return (
              <div className="attr" key={key}>
                <span>{label}</span>
                <b>
                  {h.stats[key]}
                  {bonus > 0 && <span className="attr-bonus"> (+{bonus})</span>}
                </b>
              </div>
            );
          })}
        </div>

        <h4>Unique skills</h4>
        {currentClass ? (
          currentClass.skills.map((sk) => (
            <div className="skill" key={sk.name}>
              <div className="skill-name">
                <span className="skill-ic">{sk.scope === "map" ? "🗺️" : "⚔️"}</span>
                {sk.name} <span className="tag-type">{sk.scope === "map" ? "Only Map" : "Only in fight"}</span>
              </div>
              <div className="skill-desc">{sk.desc}</div>
            </div>
          ))
        ) : (
          <div className="map-hint">Aucune classe — explore, combats et collecte pour débloquer une évolution.</div>
        )}

        <button className="pill" style={{ width: "100%", marginTop: 12 }} onClick={() => close()}>
          Return
        </button>
      </div>
    </div>
  );
}
