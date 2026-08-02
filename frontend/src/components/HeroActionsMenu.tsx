import { useStore } from "../store";
import { myTeamHeroes } from "../townUtils";
import { mapSkillsForHero } from "../skills";
import { HeroChip } from "./HeroChip";
import type { Hero } from "../api/types";

// Dropdown anchored on the TopBar smiley: MY team's roster, one row per hero with
// its map actions. The ⓘ button opens the character sheet; the action buttons
// select the hero then act. Movement itself is unchanged (select a hero, tap the
// yellow diamonds on the map).
//
// The rows are the shared `HeroChip` (portrait, HP bar, PA, location badge) —
// this dropdown used to be the last dark-glass island of the interface, a navy
// panel with `#fff` text dropped on a parchment app, and it showed less about a
// hero than either of the other two rosters.
export function HeroActionsMenu({ onClose }: { onClose: () => void }) {
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const selectedHeroId = useStore((s) => s.selectedHeroId);
  const selectHero = useStore((s) => s.selectHero);
  const openHero = useStore((s) => s.openHero);
  const setTab = useStore((s) => s.setTab);
  const busy = useStore((s) => s.busy);
  const search = useStore((s) => s.search);
  const hide = useStore((s) => s.hide);
  const escape = useStore((s) => s.escape);
  const castSkill = useStore((s) => s.castSkill);
  const drinkRation = useStore((s) => s.drinkRation);
  const mapSkills = useStore((s) => s.mapSkills);
  const startCombat = useStore((s) => s.startCombat);
  if (!game) return null;

  const roster = myTeamHeroes(game, playerId);
  const tileAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= game.width || y >= game.height ? undefined : game.tiles[y * game.width + x];

  // Select the hero, close the menu, then run the action (store actions act on the
  // selected hero — set() is synchronous, the action reads the fresh selection).
  const run = async (h: Hero, fn: () => Promise<void>) => {
    selectHero(h.id);
    onClose();
    await fn();
  };

  return (
    <>
      <div className="hm-backdrop" onClick={onClose} />
      <div className="hero-menu">
        {roster.map((h) => {
          const dead = h.hp <= 0;
          const tile = tileAt(h.x, h.y);
          const onTown = h.x === game.town.x && h.y === game.town.y;
          const onMonster = !!tile?.monsterId;
          const monsterAdjacent =
            onMonster ||
            [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => !!tileAt(h.x + dx, h.y + dy)?.monsterId);
          const stuck = h.states.includes("Tétanisé");
          const noPa = busy || h.pa <= 0;
          const usableSkills = mapSkillsForHero(mapSkills, h.classId).filter((sk) =>
            sk.kind === "snipe" ? onMonster : monsterAdjacent,
          );
          const rations = h.inventory.find((it) => it.name === "Ration d'eau")?.qty ?? 0;
          const canDrink = rations > 0 && h.pa < h.maxPa;
          return (
            <div key={h.id} className={`hm-row ${h.id === selectedHeroId ? "sel" : ""} ${dead ? "dead" : ""}`}>
              <HeroChip
                hero={h}
                layout="column"
                inTown={onTown && !dead}
                selected={h.id === selectedHeroId}
                onSelect={() => {
                  selectHero(h.id);
                  setTab("map");
                  onClose();
                }}
                onOpenSheet={() => {
                  onClose();
                  openHero(h.id);
                }}
              />
              {!dead && (
                <div className="hm-actions">
                  {/* Plus de bouton 🎯 : taper la pastille elle-même sélectionne
                      le héros et bascule sur la carte. */}
                  {onMonster && (
                    <button className="hm-act fight" title="Combattre" disabled={busy} onClick={() => run(h, startCombat)}>
                      ⚔️
                    </button>
                  )}
                  {/* Compétences de carte de la classe (remplacent boule de feu / tir précis). */}
                  {usableSkills.map((sk) => (
                    <button
                      key={sk.id}
                      className="hm-act"
                      title={`${sk.name} (-${sk.pa} PA) — ${sk.desc}`}
                      disabled={busy || h.pa < sk.pa}
                      onClick={() => run(h, () => castSkill(sk.id))}
                    >
                      {sk.icon}
                    </button>
                  ))}
                  {canDrink && (
                    <button
                      className="hm-act"
                      title={`Boire une ration d'eau (+6 PA) — ${rations} en réserve`}
                      disabled={busy}
                      onClick={() => run(h, drinkRation)}
                    >
                      💧
                    </button>
                  )}
                  {onTown ? (
                    <span className="hm-note">🏰 en ville</span>
                  ) : (
                    <>
                      <button
                        className="hm-act"
                        title="Fouiller (-1 PA)"
                        disabled={noPa || stuck || (tile?.resources ?? 0) <= 0}
                        onClick={() => run(h, search)}
                      >
                        🔎
                      </button>
                      <button
                        className="hm-act"
                        title={stuck ? "Tétanisé — impossible de se cacher" : "Hide (-1 PA)"}
                        disabled={noPa || stuck}
                        onClick={() => run(h, hide)}
                      >
                        🫥
                      </button>
                    </>
                  )}
                  {stuck && (
                    <button className="hm-act" title="S'échapper (-1 PA)" disabled={noPa} onClick={() => run(h, escape)}>
                      🏃
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
