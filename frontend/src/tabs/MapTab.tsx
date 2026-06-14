import { useEffect, useState } from "react";
import { useStore } from "../store";
import { PhaserGame } from "../game/PhaserGame";
import { bus, EV } from "../eventBus";

// Radial action menu (Hordes-style) that pops at the selected hero when tapped on the map.
const FIREBALL_PA = 2; // mirrors backend FireballPACost

function ActionMenu() {
  const { game, selectedHeroId, search, startCombat, hide, escape, fireball, busy } = useStore();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => bus.on(EV.MapHeroMenu, ({ sx, sy }: { sx: number; sy: number }) => setPos({ x: sx, y: sy })), []);

  if (!pos || !game) return null;
  const hero = game.heroes.find((h) => h.id === selectedHeroId);
  if (!hero) return null;
  const tileAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= game.width || y >= game.height ? undefined : game.tiles[y * game.width + x];
  const tile = tileAt(hero.x, hero.y);
  const onMonster = !!tile?.monsterId;
  // Fire ball reaches the hero's tile or any orthogonally adjacent pack.
  const monsterInRange =
    onMonster ||
    [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => !!tileAt(hero.x + dx, hero.y + dy)?.monsterId);
  const stuck = hero.states.includes("Tétanisé");
  const noPa = busy || hero.pa <= 0;
  const close = () => setPos(null);
  const run = async (fn: () => Promise<void>) => {
    close();
    await fn();
  };

  return (
    <>
      <div className="menu-backdrop" onClick={close} />
      <div className="action-menu" style={{ left: pos.x, top: pos.y }}>
        <div className="am-title">
          {hero.name} · ⚡{hero.pa}
          {stuck && <span className="am-stuck"> · Tétanisé</span>}
        </div>
        {onMonster && (
          <button className="am-fight" disabled={busy} onClick={() => run(startCombat)}>
            ⚔️ Fight
          </button>
        )}
        {/* Fire ball (map skill, mockup page 3): ranged blast on a pack on/next to the hero. */}
        {monsterInRange && (
          <button
            className="am-fireball"
            disabled={busy || hero.pa < FIREBALL_PA}
            onClick={() => run(fireball)}
          >
            🔥 Fire ball <i>-{FIREBALL_PA}</i>
          </button>
        )}
        {/* Fouille impossible quand le héros est bloqué par la horde. */}
        <button disabled={noPa || stuck || (tile?.resources ?? 0) <= 0} onClick={() => run(search)}>
          🔎 Search <i>-1</i>
        </button>
        <button disabled={noPa} onClick={() => run(hide)}>
          🫥 Hide <i>-1</i>
        </button>
        {/* Escape only matters when the hero is stuck (Tétanisé) by the surrounding pack. */}
        {stuck && (
          <button disabled={noPa} onClick={() => run(escape)}>
            🏃 Escape <i>-1</i>
          </button>
        )}
      </div>
    </>
  );
}

function MapControls() {
  const { game, selectedHeroId, selectHero, move, advance, busy } = useStore();
  if (!game) return null;
  const hero = game.heroes.find((h) => h.id === selectedHeroId);
  if (!hero) return null;
  const stuck = hero.states.includes("Tétanisé");

  return (
    <div className="map-controls">
      <div className="hero-select">
        {game.heroes.map((h) => (
          <button
            key={h.id}
            className={`hsel ${h.id === selectedHeroId ? "sel" : ""} ${h.hp <= 0 ? "dead" : ""}`}
            disabled={h.hp <= 0}
            onClick={() => selectHero(h.id)}
          >
            <span className="hsel-name">{h.name}</span>
            <span className="hsel-stat">❤️{h.hp} ⚡{h.pa}</span>
          </button>
        ))}
      </div>
      <div className="line">
        <strong>{hero.name}</strong>
        <span>❤️ {hero.hp}/{hero.maxHp}</span>
        <span>⚡ {hero.pa}/{hero.maxPa}</span>
        {hero.states.length > 0 && <span style={{ color: "#ffd166" }}>{hero.states.join(", ")}</span>}
      </div>
      <div className="line">
        <div className="dpad-mini">
          <span className="sp" />
          <button disabled={busy} onClick={() => move(0, -1)}>↑</button>
          <span className="sp" />
          <button disabled={busy} onClick={() => move(-1, 0)}>←</button>
          <span className="sp" />
          <button disabled={busy} onClick={() => move(1, 0)}>→</button>
          <span className="sp" />
          <button disabled={busy} onClick={() => move(0, 1)}>↓</button>
          <span className="sp" />
        </div>
        <button
          className="small actions-btn"
          disabled={busy}
          title="Ouvrir le menu d'action du héros"
          onClick={() => {
            const r = document.querySelector(".map-host")?.getBoundingClientRect();
            bus.emit(EV.MapHeroMenu, { sx: (r?.width ?? 300) / 2, sy: (r?.height ?? 420) - 160 });
          }}
        >
          ⚡ Actions
        </button>
        <button className="small" disabled={busy} onClick={() => advance()} title="Déclencher la prochaine vague maintenant">
          🌊 Forcer vague
        </button>
      </div>
      {stuck ? (
        <div className="map-hint warn">⚠️ {hero.name} est Tétanisé — tue le monstre (Fight) ou fuis (Escape).</div>
      ) : (
        <div className="map-hint">💡 Tape ton héros sur la carte pour les actions.</div>
      )}
    </div>
  );
}

function CombatControls() {
  const { combat, current, combatMode, setCombatMode, combatUnitClick, endTurn, returnToMap, busy } =
    useStore();
  if (!combat) return null;
  const curUnit = combat.units.find((u) => u.id === current?.unitId);
  const ended = combat.status !== "active";
  const targetList = current && (combatMode === "skill" ? current.skillTargets : current.attackTargets);

  return (
    <div className="map-controls">
      <div className="line">
        <strong>Combat · round {combat.round}</strong>
        {ended && (
          <span style={{ color: combat.status === "won" ? "#4be36e" : "#e24b4b" }}>
            {combat.status === "won" ? "VICTOIRE" : "DÉFAITE"}
          </span>
        )}
      </div>

      {!ended && curUnit && curUnit.side === "hero" && (
        <>
          <div className="line" style={{ fontSize: 12, color: "#cbd6e6" }}>
            Tour de <strong>&nbsp;{curUnit.name}</strong> — clique une case verte pour bouger.
          </div>
          <div className="line">
            <button className={`small ${combatMode === "attack" ? "red" : ""}`} disabled={busy} onClick={() => setCombatMode("attack")}>
              Attaque
            </button>
            <button className={`small ${combatMode === "skill" ? "red" : ""}`} disabled={busy} onClick={() => setCombatMode("skill")}>
              {current?.skill?.name || "Compétence"}
            </button>
            <button className="small" disabled={busy} onClick={() => endTurn()}>
              Fin du tour
            </button>
          </div>
          {(combatMode === "attack" || combatMode === "skill") && (
            <div className="line">
              {targetList && targetList.length > 0 ? (
                targetList.map((id) => {
                  const u = combat.units.find((x) => x.id === id);
                  return (
                    <button key={id} className="small red" disabled={busy} onClick={() => combatUnitClick(id)}>
                      🎯 {u?.name}
                    </button>
                  );
                })
              ) : (
                <span style={{ fontSize: 12, color: "#9fb2c9" }}>Aucune cible à portée — déplace-toi.</span>
              )}
            </div>
          )}
        </>
      )}

      {!ended && curUnit && curUnit.side !== "hero" && (
        <div className="line" style={{ color: "#9fb2c9" }}>L'ennemi agit…</div>
      )}

      {ended && (
        <div className="line">
          <button className="small green" onClick={() => returnToMap()}>↩ Retour à la carte</button>
        </div>
      )}
    </div>
  );
}

// Map tab = the global Phaser world map (and the isometric combat that branches from it).
export function MapTab() {
  const view = useStore((s) => s.view);
  const syncScene = useStore((s) => s.syncScene);

  // Re-push the current scene state to Phaser whenever we (re)enter the Map tab, and
  // nudge Phaser's RESIZE scale manager so the canvas matches the (now sized) container.
  useEffect(() => {
    const t1 = setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
    const t2 = setTimeout(() => syncScene(), 80);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [syncScene]);

  return (
    <div className="map-host">
      <PhaserGame />
      {view !== "combat" && <ActionMenu />}
      {view === "combat" ? <CombatControls /> : <MapControls />}
    </div>
  );
}
