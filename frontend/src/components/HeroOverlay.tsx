import { useStore } from "../store";
import { classForIndex, ATTR_ROWS } from "../data/classes";

// Character screen (opened from the top-left avatar). Class, attributes + bonuses and
// unique skills. ◀ ▶ cycle the roster. Inventory lives in the Stock tab, not here.
export function HeroOverlay() {
  const heroId = useStore((s) => s.heroOverlay);
  const game = useStore((s) => s.game);
  const openHero = useStore((s) => s.openHero);
  const close = useStore((s) => s.closeHero);
  const pushLog = useStore((s) => s.pushLog);

  if (!heroId || !game) return null;
  const index = game.heroes.findIndex((h) => h.id === heroId);
  const h = game.heroes[index];
  if (!h) return null;
  const cls = classForIndex(index);
  const n = game.heroes.length;
  const cycle = (delta: number) => openHero(game.heroes[(index + delta + n) % n].id);
  const here = h.x === game.town.x && h.y === game.town.y;

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
          <div className="hero-portrait">🔥</div>
          <div className="hero-id">
            <div className="hero-name">{cls.role}</div>
            <div className="hero-class">{cls.tier} · {h.name}</div>
          </div>
          <button className="hero-arrow" onClick={() => cycle(1)} aria-label="suivant">▶</button>
          <button className="pill green evolve" onClick={() => pushLog("Évolution de classe — bientôt")}>Evolve</button>
        </div>

        <div className="hero-hpbar">
          <span>❤️ {h.hp}/{h.maxHp}</span>
          <span>⚡ {h.pa}/{h.maxPa} PA</span>
          <span className={`tag-loc ${here ? "in" : "out"}`}>{here ? "en ville" : "en expédition"}</span>
        </div>

        <h4>Attributes</h4>
        <div className="attr-grid">
          {ATTR_ROWS.map(({ key, label }) => {
            const bonus = cls.bonuses[key] ?? 0;
            return (
              <div className="attr" key={key}>
                <span>{label}</span>
                <b>
                  {h.stats[key]}
                  {bonus > 0 && <span className="attr-bonus"> +{bonus}</span>}
                </b>
              </div>
            );
          })}
        </div>
        {cls.movement > 0 && (
          <div className="attr-move">+{cls.movement} movement point{cls.movement > 1 ? "s" : ""}</div>
        )}

        <h4>Unique skills</h4>
        {cls.skills.map((sk) => (
          <div className="skill" key={sk.name}>
            <div className="skill-name">
              <span className="skill-ic">{sk.icon}</span>
              {sk.name} <span className="tag-type">{sk.scope}</span>
            </div>
            <div className="skill-desc">{sk.desc}</div>
          </div>
        ))}

        <button className="pill" style={{ width: "100%", marginTop: 12 }} onClick={() => close()}>
          Return
        </button>
      </div>
    </div>
  );
}
