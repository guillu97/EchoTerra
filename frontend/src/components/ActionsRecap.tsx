import { useStore } from "../store";
import type { GameState, Hero } from "../api/types";

const FIREBALL_PA = 2; // mirrors backend FireballPACost

type ActionRow = { icon: string; label: string; cost: number; ok: boolean; why?: string };

// Computes the map actions currently available to a hero (mirrors MapTab's ActionMenu
// gating), with a reason when an action is unavailable.
function heroActions(game: GameState, h: Hero): ActionRow[] {
  const tileAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= game.width || y >= game.height ? undefined : game.tiles[y * game.width + x];
  const tile = tileAt(h.x, h.y);
  const onMonster = !!tile?.monsterId;
  const monsterInRange =
    onMonster ||
    [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => !!tileAt(h.x + dx, h.y + dy)?.monsterId);
  const stuck = h.states.includes("Tétanisé");
  const dead = h.hp <= 0;
  const noPa = h.pa <= 0;
  const inTown = h.x === game.town.x && h.y === game.town.y;

  if (dead) return [{ icon: "💀", label: "Hors combat", cost: 0, ok: false, why: "à ressusciter" }];

  const rows: ActionRow[] = [];
  rows.push({
    icon: "🧭", label: "Se déplacer", cost: 1,
    ok: !stuck && !noPa, why: stuck ? "Tétanisé" : noPa ? "0 PA" : undefined,
  });
  if (onMonster) rows.push({ icon: "⚔️", label: "Combattre", cost: 0, ok: true });
  if (monsterInRange)
    rows.push({
      icon: "🔥", label: "Boule de feu", cost: FIREBALL_PA,
      ok: h.pa >= FIREBALL_PA, why: h.pa < FIREBALL_PA ? `besoin de ${FIREBALL_PA} PA` : undefined,
    });
  rows.push({
    icon: "🔎", label: "Fouiller", cost: 1,
    ok: !stuck && !noPa && (tile?.resources ?? 0) > 0,
    why: stuck ? "Tétanisé" : noPa ? "0 PA" : (tile?.resources ?? 0) <= 0 ? "rien à fouiller" : undefined,
  });
  rows.push({ icon: "🫥", label: "Se cacher", cost: 1, ok: !noPa, why: noPa ? "0 PA" : undefined });
  if (stuck) rows.push({ icon: "🏃", label: "Fuir", cost: 1, ok: !noPa, why: noPa ? "0 PA" : undefined });
  if (inTown)
    rows.push({ icon: "💧", label: "Puiser de l'eau (Puits)", cost: 0, ok: h.drewWaterDay !== game.day, why: h.drewWaterDay === game.day ? "déjà bu aujourd'hui" : undefined });
  return rows;
}

// Recap overlay (from the TopBar ⚡ button): one card per hero listing the actions
// currently available, their PA cost, and why an action is locked. Tapping a card
// selects that hero and jumps to the map.
export function ActionsRecap() {
  const open = useStore((s) => s.actionsRecapOpen);
  const toggle = useStore((s) => s.toggleActionsRecap);
  const game = useStore((s) => s.game);
  const selectHero = useStore((s) => s.selectHero);
  const setTab = useStore((s) => s.setTab);

  if (!open || !game) return null;

  const goTo = (id: string) => {
    selectHero(id);
    setTab("map");
    toggle(false);
  };

  return (
    <div className="settings" onClick={() => toggle(false)}>
      <div className="panel-card actions-recap" onClick={(e) => e.stopPropagation()}>
        <div className="hero-screen-head">
          <span className="hss-title">⚡ Actions disponibles</span>
          <button className="hero-close" onClick={() => toggle(false)}>✕</button>
        </div>

        {game.heroes.map((h) => {
          const here = h.x === game.town.x && h.y === game.town.y;
          return (
            <div className="ar-hero" key={h.id}>
              <button className="ar-head" onClick={() => goTo(h.id)} title="Voir sur la carte">
                <span className="ar-name">{h.classTier === 0 ? h.name : `${h.name} · ${h.class}`}</span>
                <span className="ar-meta">
                  ⚡{h.pa}/{h.maxPa} · ❤️{h.hp}/{h.maxHp}
                  <span className={`tag-loc ${here ? "in" : "out"}`}>{here ? "en ville" : "expédition"}</span>
                </span>
              </button>
              {h.states.length > 0 && <div className="ar-states">{h.states.join(" · ")}</div>}
              <div className="ar-actions">
                {heroActions(game, h).map((a) => (
                  <div className={`ar-act ${a.ok ? "" : "off"}`} key={a.label}>
                    <span className="ar-ic">{a.icon}</span>
                    <span className="ar-lbl">{a.label}</span>
                    {a.cost > 0 && <span className="ar-cost">-{a.cost} PA</span>}
                    {!a.ok && a.why && <span className="ar-why">{a.why}</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <button className="pill" style={{ width: "100%", marginTop: 12 }} onClick={() => toggle(false)}>
          Fermer
        </button>
      </div>
    </div>
  );
}
