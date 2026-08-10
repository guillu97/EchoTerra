import { useState } from "react";
import { useStore } from "../store";
import { Overlay } from "../ui/Overlay";
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
  { key: "force", label: "Force" },
  { key: "dexterite", label: "Dextérité" },
  { key: "precision", label: "Précision" },
  { key: "agilite", label: "Agilité" },
  { key: "endurance", label: "Endurance" },
  { key: "athletisme", label: "Athlétisme" },
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
  const equipment = useStore((s) => s.equipment);
  const equipItem = useStore((s) => s.equipItem);
  const myHeroes = useStore((s) => s.myHeroes);
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!heroId || !game) return null;
  // Multiplayer: the ◀▶ roster cycle only walks MY team.
  const mine = myHeroes();
  const roster = mine.length ? game.heroes.filter((x) => mine.includes(x.id)) : game.heroes;
  const index = roster.findIndex((x) => x.id === heroId);
  const h = index >= 0 ? roster[index] : game.heroes.find((x) => x.id === heroId);
  if (!h) return null;
  const n = roster.length;
  const cycle = (delta: number) => {
    setPickerOpen(false);
    if (n > 0) openHero(roster[((index < 0 ? 0 : index) + delta + n) % n].id);
  };
  // Ce que ce héros porte dans son sac et peut mettre.
  const wearable = h.inventory.filter((it) => !!equipment[it.name]);
  const here = h.x === game.town.x && h.y === game.town.y;

  const currentClass = classes.find((c) => c.id === h.classId);
  const nextTier = h.classTier + 1;
  const requiredDay = nextTier === 1 ? EVOLVE_DAY_INTERMEDIATE : EVOLVE_DAY_ADVANCED;
  const maxed = h.classTier >= 2;
  const eligible = !maxed && game.day >= requiredDay;
  // Tech-tree gating: an advanced class requires one of its parent classes
  // (Gardien ← Pionnier ; Récupérateur ← Chasseur/Éclaireur ; Herboriste ← Éclaireur).
  const nextChoices = classes.filter(
    (c) => c.tier === nextTier && (!c.requires?.length || c.requires.includes(h.classId)),
  );

  return (
    <Overlay onClose={() => close()} cardClassName="hero-card-screen" labelledBy="hero-ov-title">
      <>
        <div className="hero-screen-head">
          <span className="hss-title" id="hero-ov-title">Personnage</span>
          <button className="hero-close" onClick={() => close()}>✕</button>
        </div>

        {/* header with roster arrows */}
        <div className="hero-top">
          <button className="hero-arrow" onClick={() => cycle(-1)} aria-label="précédent">◀</button>
          <div className="hero-portrait">
            {assetUrl(heroAssetKey(h.classId))
              ? <img src={assetUrl(heroAssetKey(h.classId))} alt="" className="portrait-img" />
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
            {maxed ? "Max" : eligible ? "Évoluer" : `Jour ${requiredDay}`}
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

        {/* ÉQUIPEMENT PORTÉ (backend equipment.go). Deux emplacements seulement — une
            arme, un équipement — et les bonus ne s'appliquent qu'AU COMBAT : ils sont
            prêtés à l'unité, jamais greffés sur les attributs ci-dessous. */}
        <h4>Équipement</h4>
        <div className="gear-slots">
          {([
            { slot: "arme", icon: "🗡️", label: "Arme", worn: h.weapon },
            { slot: "equipement", icon: "🧥", label: "Équipement", worn: h.gear },
          ] as const).map(({ slot, icon, label, worn }) => (
            <div className="gear-slot" key={slot}>
              <span className="gear-ic">{icon}</span>
              <span className="gear-txt">
                <b>{worn || <span className="muted">{label} — vide</span>}</b>
                {worn && equipment[worn] && <span className="gear-desc">{equipment[worn].desc}</span>}
              </span>
              {worn && (
                <button className="small" disabled={busy} onClick={() => equipItem(h.id, "", slot)}>
                  Retirer
                </button>
              )}
            </div>
          ))}
          {wearable.length > 0 && (
            <div className="gear-pick">
              {wearable.map((it) => (
                <button
                  key={it.name}
                  className="small green"
                  disabled={busy}
                  title={equipment[it.name]?.desc}
                  onClick={() => equipItem(h.id, it.name, equipment[it.name].slot)}
                >
                  Équiper {it.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <h4>Attributs</h4>
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

        <h4>Compétences uniques</h4>
        {currentClass ? (
          currentClass.skills.map((sk) => (
            <div className="skill" key={sk.name}>
              <div className="skill-name">
                <span className="skill-ic">{sk.scope === "map" ? "🗺️" : "⚔️"}</span>
                {sk.name} <span className="tag-type">{sk.scope === "map" ? "Carte" : "Combat"}</span>
              </div>
              <div className="skill-desc">{sk.desc}</div>
            </div>
          ))
        ) : (
          <div className="map-hint">Aucune classe — explore, combats et collecte pour débloquer une évolution.</div>
        )}

        <button className="pill ov-close" onClick={() => close()}>
          Retour
        </button>
      </>
    </Overlay>
  );
}
