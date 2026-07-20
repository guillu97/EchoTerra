import { useEffect, useState } from "react";
import { useStore } from "../store";
import { PhaserGame } from "../game/PhaserGame";
import { VoxelMapView } from "../voxel/VoxelMapView";
import { VoxelCombatView } from "../voxel/VoxelCombatView";
import { bus, EV } from "../eventBus";
import { heroTexKey, libUrl, monsterTexKey } from "../assets";
import { MapHeroBar } from "../components/MapHeroBar";
import { CombatHeroBar } from "../components/CombatHeroBar";
import { mapSkillsForHero } from "../skills";
import { myActiveCombat } from "../combatUtils";

// Radial action menu (Hordes-style) that pops at the selected hero when tapped on the map.
function ActionMenu() {
  const { game, selectedHeroId, mapSkills, search, startCombat, hide, escape, castSkill, drinkRation, ruinClear, ruinExplore, busy } = useStore();
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
  // Un pack sur la case du héros ou orthogonalement adjacent (portée des sorts blast).
  const monsterAdjacent =
    onMonster ||
    [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => !!tileAt(hero.x + dx, hero.y + dy)?.monsterId);
  const stuck = hero.states.includes("Tétanisé");
  const ruin = tile?.ruinId ? game.ruins?.[tile.ruinId] : undefined;
  const noPa = busy || hero.pa <= 0;
  // Compétences de carte de la classe du héros disponibles ICI (une cible à portée).
  const heroSkills = mapSkillsForHero(mapSkills, hero.classId);
  const usableSkills = heroSkills.filter((sk) => (sk.kind === "snipe" ? onMonster : monsterAdjacent));
  // Boire une ration : possible si le héros en a une ET n'est pas déjà au max de PA.
  const rations = hero.inventory.find((it) => it.name === "Ration d'eau")?.qty ?? 0;
  const canDrink = rations > 0 && hero.pa < hero.maxPa;
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
        {/* Compétences de carte PAR CLASSE (remplacent la boule de feu universelle). */}
        {usableSkills.map((sk) => (
          <button
            key={sk.id}
            className="am-skill"
            disabled={busy || hero.pa < sk.pa}
            title={sk.desc}
            onClick={() => run(() => castSkill(sk.id))}
          >
            {sk.icon} {sk.name} <i>-{sk.pa}</i>
          </button>
        ))}
        {/* Boire une ration d'eau du sac : +6 PA (repartir explorer une fois à sec). */}
        {canDrink && (
          <button
            className="am-drink"
            disabled={busy}
            title="Restaure 6 PA (consomme une ration d'eau du sac)"
            onClick={() => run(drinkRation)}
          >
            💧 Boire une ration <i>+6 PA · {rations}</i>
          </button>
        )}
        {/* Ruine-donjon sous le héros : déblayage collectif puis exploration. */}
        {ruin && !ruin.cleared && (
          <button
            className="am-ruin"
            disabled={noPa || stuck}
            onClick={() => run(ruinClear)}
          >
            ⛏️ Déblayer {ruin.icon} <i>{ruin.paInvested}/{ruin.clearPa}</i>
          </button>
        )}
        {ruin && ruin.cleared && (
          <button
            className="am-ruin"
            disabled={busy || stuck || hero.pa < 2 || ruin.charges <= 0}
            title={ruin.charges <= 0 ? "Donjon épuisé" : ""}
            onClick={() => run(ruinExplore)}
          >
            🏛️ Explorer {ruin.icon} <i>-2 · {ruin.charges} 💎</i>
          </button>
        )}
        {onTown && <div className="am-note">🏰 En ville — fouille et cachette inutiles ici</div>}
        {/* Pas de fouille ni de cachette sur la case ville (la ville protège déjà et n'a
            rien à fouiller) — le serveur les refuse aussi. */}
        {!onTown && (
          <>
            {/* Fouille et cachette impossibles quand le héros est tenu par la horde
                (Tétanisé) — le serveur les refuse aussi. */}
            <button disabled={noPa || stuck || (tile?.resources ?? 0) <= 0} onClick={() => run(search)}>
              🔎 Search <i>-1</i>
            </button>
            <button
              disabled={noPa || stuck}
              title={stuck ? "Tétanisé — impossible de se cacher" : ""}
              onClick={() => run(hide)}
            >
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
  const { game, showOthers, toggleOthers, playerId, joinCombat, busy } = useStore();
  if (!game) return null;
  const multiplayer = (game.players?.length ?? 0) > 1;
  // Un combat actif (parmi TOUS ceux en cours — ils peuvent être plusieurs) où
  // figurent MES héros, que je n'ai pas encore rejoint → « Rejoindre le combat ».
  const mine = myActiveCombat(game, playerId);
  const canJoin = !!mine && !!playerId && !mine.participants?.includes(playerId);
  // « Forcer la vague » a déménagé dans le panneau de triche (🔧). Cette barre ne
  // garde que les actions de terrain (rejoindre un combat, masquer les autres).
  if (!canJoin && !multiplayer) return null;

  return (
    <div className="map-controls">
      {canJoin && (
        <div className="line">
          <button className="small red" disabled={busy} onClick={() => joinCombat()}>
            ⚔️ Rejoindre le combat ({mine!.tileX},{mine!.tileY}) — tes héros y sont !
          </button>
        </div>
      )}
      {multiplayer && (
        <div className="line">
          <button
            className={`small ${showOthers ? "red" : ""}`}
            title="Afficher/masquer les héros des autres joueurs (sprites translucides)"
            onClick={() => toggleOthers()}
          >
            👥 Autres
          </button>
        </div>
      )}
    </div>
  );
}

// Timeline d'initiative (lot C2) : les portraits dans l'ordre du tour, actif
// surligné, morts grisés. Taper un ennemi affiche ses cases menacées (orange).
function InitiativeBar() {
  const { combat, current, toggleThreat, threatUnitId } = useStore();
  if (!combat || combat.status !== "active") return null;
  return (
    <div className="init-bar">
      {combat.order.map((id, i) => {
        const u = combat.units.find((x) => x.id === id);
        if (!u) return null;
        const key =
          u.side === "hero" ? u.appearance || heroTexKey(u.kind) : monsterTexKey(u.kind, u.appearance);
        const url = key ? libUrl(u.side === "hero" ? "characters" : "monsters", key) : undefined;
        const cls = [
          "init-chip",
          u.side === "hero" ? "ally" : "enemy",
          i === combat.turnIdx ? "active" : "",
          u.hp <= 0 || u.fled ? "dead" : "",
          u.id === threatUnitId ? "threat" : "",
        ].join(" ");
        return (
          <button
            key={`${id}-${i}`}
            className={cls}
            title={`${u.name} · ${u.hp}/${u.maxHp} PV${u.side === "monster" ? " — menaces" : ""}`}
            onClick={() => u.side === "monster" && u.hp > 0 && toggleThreat(u.id)}
          >
            {url ? <img src={url} alt={u.name} /> : <span>{u.side === "hero" ? "🧑" : "👹"}</span>}
            {u.id === current?.unitId && <i className="init-now">▶</i>}
          </button>
        );
      })}
    </div>
  );
}

// Écran de fin (lot C2) : récapitulatif — butin par héros, PV restants, tours
// joués — au lieu du retour sec à la carte.
function CombatEndScreen() {
  const { combat, returnToMap } = useStore();
  if (!combat || combat.status === "active") return null;
  const won = combat.status === "won";
  const fled = combat.status === "fled";
  const heroes = combat.units.filter((u) => u.side === "hero");
  return (
    <div className="combat-end">
      <div className="combat-end-card">
        <h2 className={won ? "win" : fled ? "flee" : "loss"}>
          {won ? "🏆 Victoire !" : fled ? "🏃 Repli !" : "💀 Défaite…"}
        </h2>
        <div className="combat-end-sub">
          {combat.round} tour{combat.round > 1 ? "s" : ""} · {heroes.filter((u) => u.hp > 0).length}/
          {heroes.length} héros debout
        </div>
        <div className="combat-end-heroes">
          {heroes.map((u) => (
            <div key={u.id} className={`ce-hero ${u.hp <= 0 ? "dead" : ""}`}>
              <span className="ce-name">{u.hp <= 0 ? "☠️ " : ""}{u.name}</span>
              <span className="ce-hp">{Math.max(0, u.hp)}/{u.maxHp} PV</span>
            </div>
          ))}
        </div>
        {won && (combat.rewards?.length ?? 0) > 0 && (
          <div className="combat-end-loot">
            <div className="ce-loot-title">Butin</div>
            {combat.rewards!.map((r) => (
              <div key={r.heroId} className="ce-loot-row">
                <span className="ce-name">{r.heroName}</span>
                <span className="ce-items">
                  {r.items.map((it, i) => (
                    <em key={i}>{it.name}{it.qty > 1 ? ` ×${it.qty}` : ""}</em>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
        {fled && (
          <div className="combat-end-sub">
            L'équipe s'est repliée — pas de butin, et le pack rôde toujours sur la case…
          </div>
        )}
        {!won && !fled && <div className="combat-end-sub">Les survivants battent en retraite vers la ville…</div>}
        <button className="small green" onClick={() => returnToMap()}>↩ Retour à la carte</button>
      </div>
    </div>
  );
}

function CombatControls() {
  const {
    combat, current, combatMode, combatSkillIdx, setCombatMode, selectCombatSkill, combatUnitClick,
    combatDefend, combatFlee, combatUseItem, endTurn, busy, game, playerId,
  } = useStore();
  if (!combat) return null;
  const curUnit = combat.units.find((u) => u.id === current?.unitId);
  const ended = combat.status !== "active";
  // Multijoueur : je ne pilote que MES unités — le tour d'un autre joueur
  // présent s'affiche en attente (les absents sont joués par l'IA côté serveur).
  const legacy = (game?.players?.length ?? 0) === 0;
  const myTurn = !!curUnit && curUnit.side === "hero" && (legacy || !curUnit.ownerId || curUnit.ownerId === playerId);
  const skills = current?.skills ?? [];
  const activeSkill = combatMode === "skill" ? skills[combatSkillIdx] : undefined;
  const targetList =
    combatMode === "skill"
      ? activeSkill?.targets ?? []
      : combatMode === "push"
        ? current?.pushTargets ?? []
        : current?.attackTargets ?? [];
  const estimates = combatMode === "skill" ? activeSkill?.estimates : current?.attackEstimates;
  const onBottomEdge = !!curUnit && curUnit.y === combat.gridH - 1;

  return (
    <div className="map-controls">
      <div className="line">
        <strong>Combat · round {combat.round}</strong>
      </div>
      {/* Lot C5 : renforts imminents. (L'annonce des patterns de boss a été
          retirée — le boss attaque chaque tour, base ou spéciale ; lis sa menace
          en le tapant : cases orange de la télégraphie C2.) */}
      {!ended && !!combat.reinforceAt && !combat.reinforceDone && combat.round === combat.reinforceAt - 1 && (
        <div className="line" style={{ color: "#ffb454", fontSize: 12 }}>
          👹 Des renforts ennemis surgiront au prochain round !
        </div>
      )}

      {!ended && curUnit && curUnit.side === "hero" && !myTurn && (
        <div className="line" style={{ color: "#9fb2c9" }}>
          ⏳ Tour de <strong>&nbsp;{curUnit.name}</strong> (autre joueur)…
        </div>
      )}

      {!ended && curUnit && myTurn && (
        <>
          <div className="line" style={{ fontSize: 12, color: "#cbd6e6" }}>
            Tour de <strong>&nbsp;{curUnit.name}</strong> — clique une case verte pour bouger.
          </div>
          <div className="line">
            <button className={`small ${combatMode === "attack" ? "red" : ""}`} disabled={busy} onClick={() => setCombatMode("attack")}>
              ⚔️ Attaque
            </button>
            <button
              className={`small ${combatMode === "push" ? "red" : ""}`}
              disabled={busy}
              title="Pousser un ennemi d'une case : collision 2 dégâts, eau = piégé, chute ≥2 = +2"
              onClick={() => setCombatMode("push")}
            >
              👐 Pousser
            </button>
            <button className="small" disabled={busy} onClick={() => endTurn()}>
              ⏭ Fin du tour
            </button>
          </div>
          {/* Compétences iso de la CLASSE (une par bouton) — la capacité sur soi
              (Posture défensive…) part immédiatement, les autres arment le ciblage. */}
          {skills.length > 0 && (
            <div className="line">
              {skills.map((sk) => (
                <button
                  key={sk.idx}
                  className={`small skill ${combatMode === "skill" && combatSkillIdx === sk.idx ? "red" : ""}`}
                  disabled={busy}
                  title={sk.skill.desc || sk.skill.name}
                  onClick={() => selectCombatSkill(sk.idx)}
                >
                  ✨ {sk.skill.name}
                </button>
              ))}
            </div>
          )}
          {/* Actions C3 : Défendre (termine le tour), objets du sac, fuite au bord bas. */}
          <div className="line">
            <button
              className="small"
              disabled={busy}
              title="-50% dégâts subis jusqu'à ton prochain tour (termine le tour)"
              onClick={() => combatDefend()}
            >
              🛡️ Défendre
            </button>
            {(current?.items ?? []).map((it) => (
              <button
                key={it.name}
                className="small"
                disabled={busy}
                title={`+${it.heal} PV (consomme 1 ${it.name} du sac, termine le tour)`}
                onClick={() => combatUseItem(it.name)}
              >
                🧪 {it.name} ×{it.qty} <i className="dmg-est" style={{ color: "#9fe3b0" }}>+{it.heal}</i>
              </button>
            ))}
            <button
              className="small"
              disabled={busy || !onBottomEdge}
              title={onBottomEdge ? "Quitter le combat par le bord bas — pas de butin, le pack reste" : "Rejoins le bord bas de l'arène pour fuir"}
              onClick={() => combatFlee()}
            >
              🏃 Fuir
            </button>
          </div>
          {(combatMode === "attack" || combatMode === "skill" || combatMode === "push") && (
            <div className="line">
              {targetList && targetList.length > 0 ? (
                targetList.map((id) => {
                  const u = combat.units.find((x) => x.id === id);
                  const est = combatMode === "push" ? undefined : estimates?.[id];
                  return (
                    <button
                      key={id}
                      className="small red"
                      disabled={busy}
                      title={est?.rear ? "Attaque de dos : +25 %, ignore la couverture" : est?.cover ? "Cible à couvert : −25 % à distance" : ""}
                      onClick={() => combatUnitClick(id)}
                    >
                      {combatMode === "push" ? "👐" : "🎯"} {u?.name}
                      {est && (
                        <i className="dmg-est">
                          {est.rear ? "🗡" : est.cover ? "🛡" : ""}
                          {est.min === est.max ? `−${est.min}` : `−${est.min}…${est.max}`}
                        </i>
                      )}
                    </button>
                  );
                })
              ) : (
                <span style={{ fontSize: 12, color: "#9fb2c9" }}>
                  {combatMode === "push" ? "Aucun ennemi aligné à portée de poussée." : "Aucune cible à portée — déplace-toi."}
                </span>
              )}
            </div>
          )}
        </>
      )}

      {!ended && curUnit && curUnit.side !== "hero" && (
        <div className="line" style={{ color: "#9fb2c9" }}>L'ennemi agit…</div>
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
  const refreshCombat = useStore((s) => s.refreshCombat);
  // Rendu voxel expérimental (VOXEL-PLAN Phases 2+3) : les vues voxel parlent
  // le même contrat bus que les scènes Phaser — le reste de l'app est agnostique.
  const voxelMap = useStore((s) => s.settings.voxelMap);

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

  // Combat multijoueur : poll 3 s pour voir les tours des AUTRES joueurs (et le
  // sien arriver) — refreshCombat n'applique que les vrais changements et se
  // désamorce seul en solo legacy.
  useEffect(() => {
    if (view !== "combat") return;
    const id = setInterval(() => void refreshCombat(), 3000);
    return () => clearInterval(id);
  }, [view, refreshCombat]);

  return (
    <div className={active ? "map-host" : "map-host map-host-hidden"}>
      {voxelMap ? (
        view === "combat" ? <VoxelCombatView /> : <VoxelMapView active={active} />
      ) : (
        <PhaserGame active={active} />
      )}
      {view !== "combat" && <ActionMenu />}
      {view === "combat" ? (
        <>
          <InitiativeBar />
          <CombatEndScreen />
          <div className="map-bottom">
            <CombatHeroBar />
            <CombatControls />
          </div>
        </>
      ) : (
        <div className="map-bottom">
          <MapHeroBar />
          <MapControls />
        </div>
      )}
    </div>
  );
}
