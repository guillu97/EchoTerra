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
  const onTown = hero.x === game.town.x && hero.y === game.town.y;
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
        {onTown && <div className="am-note">🏰 En ville — fouille et cachette inutiles ici</div>}
        {/* Pas de fouille ni de cachette sur la case ville (la ville protège déjà et n'a
            rien à fouiller) — le serveur les refuse aussi. */}
        {!onTown && (
          <>
            {/* Fouille impossible quand le héros est bloqué par la horde. */}
            <button disabled={noPa || stuck || (tile?.resources ?? 0) <= 0} onClick={() => run(search)}>
              🔎 Search <i>-1</i>
            </button>
            <button disabled={noPa} onClick={() => run(hide)}>
              🫥 Hide <i>-1</i>
            </button>
          </>
        )}
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

// Slim map bar: hero selection and per-hero actions moved to the 🙂 dropdown in
// the TopBar (HeroActionsMenu). Movement is unchanged: select a hero, tap the
// yellow diamonds on the map. Only map-wide tools remain here.
function MapControls() {
  const { game, selectedHeroId, advance, busy, showOthers, toggleOthers } = useStore();
  if (!game) return null;
  const hero = game.heroes.find((h) => h.id === selectedHeroId);
  const stuck = !!hero?.states.includes("Tétanisé");
  const multiplayer = (game.players?.length ?? 0) > 1;

  return (
    <div className="map-controls">
      <div className="line">
        <button className="small" disabled={busy} onClick={() => advance()} title="Déclencher la prochaine vague maintenant">
          🌊 Forcer vague
        </button>
        {multiplayer && (
          <button
            className={`small ${showOthers ? "red" : ""}`}
            title="Afficher/masquer les héros des autres joueurs (sprites translucides)"
            onClick={() => toggleOthers()}
          >
            👥 Autres
          </button>
        )}
      </div>
      {stuck ? (
        <div className="map-hint warn">⚠️ {hero?.name} est Tétanisé — tue le monstre (Fight) ou fuis (Escape).</div>
      ) : (
        <div className="map-hint">
          💡 Héros et actions via 🙂 en haut — tape les losanges jaunes pour te déplacer.
        </div>
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
// It is mounted for the whole game session and hidden with CSS when another tab is
// active (`active` prop) so the Phaser instance and its textures survive tab switches.
export function MapTab({ active = true }: { active?: boolean }) {
  const view = useStore((s) => s.view);
  const syncScene = useStore((s) => s.syncScene);

  // Hidden pre-warm: as soon as MapScene has registered its handlers, push the state
  // so it bakes its pillar atlas and builds the tile layer in the background
  // (PhaserGame gates the scene wake-up), making the first real open of the tab instant.
  useEffect(() => bus.on(EV.MapSceneReady, () => syncScene()), [syncScene]);

  // Re-push the scene state on (re)entering the tab. Canvas sizing is owned by the
  // ResizeObserver in PhaserGame (and the hidden tab keeps its layout size thanks
  // to visibility:hidden), so no resize nudge is needed here.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => syncScene(), 80);
    return () => clearTimeout(t);
  }, [active, syncScene]);

  return (
    <div className={active ? "map-host" : "map-host map-host-hidden"}>
      <PhaserGame active={active} />
      {view !== "combat" && <ActionMenu />}
      {view === "combat" ? <CombatControls /> : <MapControls />}
    </div>
  );
}
