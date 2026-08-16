// LA BARRE D'ACTION DU COMBAT.
//
// Ce qu'elle remplace : une pile de `.line` où douze petits boutons gris se
// suivaient sans hiérarchie — l'attaque, les compétences, Défendre, chaque potion,
// Fuir, Fin du tour, tous du même poids visuel. Impossible de voir d'un coup d'œil
// ce que le héros tient, ce qu'il peut atteindre, ni ce qui va coûter le tour.
//
// Trois rangs, et un seul message par rang :
//   1. QUI JOUE — nom, PV, l'ARME au poing (weapons.go), les DEUX JAUGES du tour
//      (déplacement / action) et le minuteur.
//   2. QUOI FAIRE — les actions, groupées : frapper / techniques / se protéger /
//      objets / se replier. Les capacités en RECHARGE portent leur compte à rebours.
//   3. SUR QUI — les cibles du mode armé, avec la fourchette de dégâts servie par
//      le serveur (le client ne calcule jamais un dégât) et la chance de critique.
//
// ⚠ LES DEUX JAUGES SONT LE CŒUR DE CETTE RÉVISION. Le serveur tenait déjà « un
// déplacement et une action par tour », mais ne le DISAIT nulle part : la barre
// n'affichait aucun budget, l'ennemi jouait son tour instantanément, et taper dix
// fois de suite sur le même bouton « marchait » — on croyait donc pouvoir enchaîner
// les attaques à volonté. Deux pastilles ⬤ / ○ règlent le malentendu, et le
// compte à rebours des recharges dit pourquoi le meilleur coup n'est pas toujours
// disponible.
//
// ⚠ LA TECHNIQUE D'ARME EST DANS LA MÊME LISTE que les compétences de classe
// (`current.skills`, drapeau `weapon`) : même indexation `skillIdx` côté serveur,
// mais un ACCENT différent — la classe dit ce que le héros sait, l'arme dit avec
// quoi. Les présenter pareil effacerait justement ce que ce lot ajoute.

import { useEffect, useState } from "react";
import { useStore } from "../store";
import { useTurnRemaining } from "../useWave";

// Icône par archétype d'arme (weapons.go). Mains nues = poing.
const WEAPON_ICON: Record<string, string> = {
  epee: "🗡️",
  dague: "🔪",
  lance: "🔱",
  arc: "🏹",
  baton: "🪄",
};
export function weaponIcon(kind?: string): string {
  return (kind && WEAPON_ICON[kind]) || "✊";
}

export function CombatControls() {
  const {
    combat, current, combatMode, combatSkillIdx, setCombatMode, selectCombatSkill, combatUnitClick,
    combatDefend, combatFlee, combatUseItem, combatSwapWeapon, endTurn, busy, game, playerId,
    setAimUnit,
  } = useStore();
  // Tiroirs : les objets et les armes du sac ne méritent pas une rangée
  // permanente — on ne s'en sert qu'à un moment précis du combat.
  const [drawer, setDrawer] = useState<"" | "items" | "swap">("");

  const curUnit = combat?.units.find((u) => u.id === current?.unitId);
  const ended = !combat || combat.status !== "active";
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
  const onBottomEdge = !!curUnit && curUnit.y === (combat?.gridH ?? 1) - 1;
  const turnLeft = useTurnRemaining(combat ?? undefined);
  const items = current?.items ?? [];
  const swaps = current?.swaps ?? [];

  // LES DEUX BUDGETS DU TOUR (backend combat.go, « économie du tour »). Le serveur
  // les sert explicitement ; on ne les déduit jamais de l'état de l'unité, sinon la
  // barre et le serveur pourraient se contredire au premier refus.
  const moved = current?.moved ?? curUnit?.moved ?? false;
  const acted = current?.acted ?? curUnit?.acted ?? false;
  const canMove = !moved && (current?.reachable?.length ?? 0) > 0;
  // Une action reste-t-elle ? C'est CE booléen qui éteint tout le rang « frapper » —
  // proposer un bouton que le serveur refusera est pire que ne pas le proposer.
  const canAct = !acted;

  // Raccourcis clavier — le combat est tour par tour, donc au clavier il se joue
  // vite ; au doigt rien ne change. Échap désarme le mode courant.
  useEffect(() => {
    if (ended || !myTurn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "a") setCombatMode("attack");
      else if (k === "e") setCombatMode("push");
      else if (k === "d") void combatDefend();
      else if (k === "escape") setCombatMode("move");
      else if (k === " " || k === "enter") void endTurn();
      else if (k >= "1" && k <= "9") {
        const sk = skills[Number(k) - 1];
        // ⚠ le raccourci obéit à la recharge comme le bouton : sinon le clavier
        // serait un contournement de la règle qu'on vient de poser.
        if (sk && !sk.cooldownLeft) selectCombatSkill(sk.idx);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ended, myTurn, skills, setCombatMode, selectCombatSkill, combatDefend, endTurn]);

  if (!combat) return null;

  // Les DEUX JAUGES du tour : dépensé = pastille creuse et barrée, disponible =
  // pastille pleine. Deux icônes plutôt que du texte — la barre est déjà dense, et
  // sur un téléphone un libellé de plus pousse les boutons hors de l'écran.
  const budget = myTurn && !ended && (
    <span className="cbt-budget" title="Un déplacement et une action par tour.">
      <i className={moved ? "spent" : "left"} title={moved ? "Déplacement dépensé" : "Déplacement disponible"}>
        🥾
      </i>
      <i className={acted ? "spent" : "left"} title={acted ? "Action dépensée" : "Action disponible"}>
        ⚔️
      </i>
    </span>
  );

  // Rang 1 — qui joue, avec quoi, et ce qu'il lui reste.
  const header = (
    <div className="cbt-head">
      <span className="cbt-round">Round {combat.round}</span>
      {curUnit && (
        <>
          <span className={`cbt-who ${myTurn ? "mine" : ""}`}>
            {curUnit.side === "hero" ? "🧑" : "👹"} {curUnit.name}
          </span>
          <span className="cbt-hp">
            <i style={{ width: `${Math.max(0, Math.min(100, (curUnit.hp / Math.max(1, curUnit.maxHp)) * 100))}%` }} />
            <b>{Math.max(0, curUnit.hp)}/{curUnit.maxHp}</b>
          </span>
          {curUnit.side === "hero" && (
            <span
              className="cbt-weapon"
              title={
                curUnit.weaponName
                  ? `${curUnit.weaponName}${curUnit.reach ? ` · portée ${curUnit.reach}` : ""}${curUnit.armor ? ` · armure ${curUnit.armor}` : ""}`
                  : "Mains nues — aucune technique d'arme"
              }
            >
              {weaponIcon(curUnit.weaponKind)} {curUnit.weaponName || "Mains nues"}
              {!!curUnit.reach && curUnit.reach > 1 && <i className="cbt-reach">⇢{curUnit.reach}</i>}
            </span>
          )}
          {budget}
        </>
      )}
      {turnLeft !== null && (
        <span className={`cbt-timer ${turnLeft <= 10 ? "urgent" : ""}`}>⏱ {turnLeft}s</span>
      )}
    </div>
  );

  if (ended) return <div className="cbt-bar">{header}</div>;

  if (curUnit && curUnit.side !== "hero") {
    return (
      <div className="cbt-bar">
        {header}
        <div className="cbt-hint">L'ennemi agit…</div>
      </div>
    );
  }
  if (curUnit && !myTurn) {
    return (
      <div className="cbt-bar">
        {header}
        <div className="cbt-hint">⏳ Tour d'un autre joueur…</div>
      </div>
    );
  }
  if (!curUnit) return <div className="cbt-bar">{header}</div>;

  // La phrase d'état du tour : elle dit ce qui RESTE, pas ce qui a été fait. C'est
  // la réponse directe au malentendu « je peux rejouer autant que je veux » — et
  // c'est aussi elle qui explique pourquoi la main n'est pas encore passée quand on
  // a frappé sans bouger.
  const stateHint = acted
    ? canMove
      ? "Action dépensée — il te reste ton déplacement (décroche, puis « Fin »)."
      : "Tour terminé…"
    : moved
      ? "Déplacement dépensé — il te reste ton action."
      : null;

  return (
    <div className="cbt-bar">
      {header}
      {!!combat.reinforceAt && !combat.reinforceDone && combat.round === combat.reinforceAt - 1 && (
        <div className="cbt-hint warn">👹 Des renforts ennemis surgiront au prochain round !</div>
      )}
      {stateHint && <div className="cbt-hint state">{stateHint}</div>}

      {/* Rang 2 — les actions. Tout ce qui consomme l'action s'éteint une fois
          l'action dépensée ; les recharges portent leur compte à rebours. */}
      <div className="cbt-actions">
        <button
          className={`cbt-act atk ${combatMode === "attack" ? "on" : ""}`}
          disabled={busy || !canAct}
          title={
            canAct
              ? `Attaque de base${curUnit.reach && curUnit.reach > 1 ? ` — portée ${curUnit.reach} (arme)` : " — au contact"} · jamais en recharge [A]`
              : "Action déjà dépensée ce tour"
          }
          onClick={() => { setDrawer(""); setCombatMode("attack"); }}
        >
          ⚔️<span>Attaque</span>
        </button>

        {skills.map((sk, i) => {
          const cd = sk.cooldownLeft ?? 0;
          const noTarget = !sk.selfCast && sk.targets.length === 0;
          return (
            <button
              key={sk.idx}
              className={`cbt-act ${sk.weapon ? "wpn" : "skill"} ${cd ? "cooling" : ""} ${
                combatMode === "skill" && combatSkillIdx === sk.idx ? "on" : ""
              }`}
              disabled={busy || !canAct || cd > 0 || noTarget}
              title={
                cd > 0
                  ? `${sk.skill.name} se recharge — disponible dans ${cd} tour${cd > 1 ? "s" : ""}`
                  : `${sk.skill.desc || sk.skill.name}${sk.weapon ? ` — technique de ${curUnit.weaponName}` : ""}${
                      sk.skill.cooldown ? ` · recharge ${sk.skill.cooldown} tours` : ""
                    }${noTarget ? " — aucune cible à portée" : ""} [${i + 1}]`
              }
              onClick={() => { setDrawer(""); selectCombatSkill(sk.idx); }}
            >
              {sk.weapon ? weaponIcon(curUnit.weaponKind) : "✨"}
              <span>{sk.skill.name}</span>
              {/* La recharge PRIME sur toute autre pastille : c'est la seule raison
                  d'extinction qui change d'un tour à l'autre, donc la seule que le
                  joueur doit pouvoir lire sans survoler. */}
              {cd > 0 ? (
                <i className="cbt-cd">⏳{cd}</i>
              ) : sk.skill.cooldown ? (
                <i className="cbt-cdmax" title={`Recharge : ${sk.skill.cooldown} tours`}>↻{sk.skill.cooldown}</i>
              ) : null}
            </button>
          );
        })}

        <button
          className={`cbt-act ${combatMode === "push" ? "on" : ""}`}
          disabled={busy || !canAct || (current?.pushTargets ?? []).length === 0}
          title="Pousser un ennemi d'une case : collision 2 dégâts, eau = piégé, chute ≥2 = +2 [E]"
          onClick={() => { setDrawer(""); setCombatMode("push"); }}
        >
          👐<span>Pousser</span>
        </button>

        <button
          className="cbt-act def"
          disabled={busy || !canAct}
          title="-50 % de dégâts subis jusqu'à ton prochain tour (dépense l'action) [D]"
          onClick={() => void combatDefend()}
        >
          🛡️<span>Défendre</span>
        </button>

        {items.length > 0 && (
          <button
            className={`cbt-act ${drawer === "items" ? "on" : ""}`}
            disabled={busy || !canAct}
            title="Consommer un objet du sac (dépense l'action)"
            onClick={() => setDrawer(drawer === "items" ? "" : "items")}
          >
            🧪<span>Objets</span><i className="cbt-n">{items.length}</i>
          </button>
        )}

        {swaps.length > 0 && (
          <button
            className={`cbt-act ${drawer === "swap" ? "on" : ""}`}
            disabled={busy || !canAct}
            title="Dégainer une autre arme du sac (dépense l'action)"
            onClick={() => setDrawer(drawer === "swap" ? "" : "swap")}
          >
            🔁<span>Arme</span><i className="cbt-n">{swaps.length}</i>
          </button>
        )}

        <button
          className="cbt-act"
          disabled={busy || !onBottomEdge}
          title={onBottomEdge ? "Quitter le combat par le bord bas — pas de butin, le pack reste" : "Rejoins le bord bas de l'arène pour fuir"}
          onClick={() => void combatFlee()}
        >
          🏃<span>Fuir</span><i className="cbt-end">⏻</i>
        </button>

        <button
          className={`cbt-act end ${acted ? "ready" : ""}`}
          disabled={busy}
          title="Fin du tour [Espace]"
          onClick={() => void endTurn()}
        >
          ⏭<span>Fin</span>
        </button>
      </div>

      {/* Tiroir OBJETS / ARMES — ouvert à la demande, jamais en permanence. */}
      {drawer === "items" && (
        <div className="cbt-drawer">
          {items.map((it) => (
            <button key={it.name} className="cbt-pick" disabled={busy} onClick={() => { setDrawer(""); void combatUseItem(it.name); }}>
              🧪 {it.name} ×{it.qty} <i className="heal">+{it.heal} PV</i>
            </button>
          ))}
        </div>
      )}
      {drawer === "swap" && (
        <div className="cbt-drawer">
          <div className="cbt-drawer-note">Changer d'arme dépense l'action du tour — mais change ta technique.</div>
          {swaps.map((w) => (
            <button key={w.name} className="cbt-pick" disabled={busy} onClick={() => { setDrawer(""); void combatSwapWeapon(w.name); }}>
              {weaponIcon(w.kind)} {w.name}
              {w.technique && <i className="tech">✨ {w.technique}</i>}
            </button>
          ))}
        </div>
      )}

      {/* Rang 3 — les cibles du mode armé. */}
      {(combatMode === "attack" || combatMode === "skill" || combatMode === "push") && (
        <div className="cbt-targets">
          {targetList.length > 0 ? (
            targetList.map((id) => {
              const u = combat.units.find((x) => x.id === id);
              const est = combatMode === "push" ? undefined : estimates?.[id];
              const lethal = !!est && !!u && est.min >= u.hp;
              // Un critique qui suffirait à tuer alors que le coup ordinaire ne le
              // ferait pas : c'est exactement le renseignement pour lequel la
              // précision existe, donc il se lit sur la cible.
              const critKill = !lethal && !!est?.critMax && !!u && est.critMax >= u.hp;
              return (
                <button
                  key={id}
                  className={`cbt-target ${lethal ? "lethal" : ""} ${critKill ? "critkill" : ""}`}
                  disabled={busy}
                  title={
                    [
                      est?.rear
                        ? "Attaque de dos : +25 %, ignore la couverture"
                        : est?.cover
                          ? "Cible à couvert : −25 % à distance"
                          : "",
                      est?.critPct ? `Coup critique ${est.critPct} % (précision) → ${est.critMax} dégâts` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  }
                  onClick={() => combatUnitClick(id)}
                  // Survoler (ou tabuler jusqu'à) une cible peint dans l'arène la
                  // ZONE que le coup va toucher : le Fauchage éclabousse, pas
                  // l'attaque de base — et ça ne se voyait qu'après avoir frappé.
                  onPointerEnter={() => setAimUnit(id)}
                  onPointerLeave={() => setAimUnit(undefined)}
                  onFocus={() => setAimUnit(id)}
                  onBlur={() => setAimUnit(undefined)}
                >
                  <b>{combatMode === "push" ? "👐" : lethal ? "☠️" : critKill ? "🎯" : "⚔️"} {u?.name}</b>
                  {u && <em>{Math.max(0, u.hp)}/{u.maxHp}</em>}
                  {est && (
                    <i className="dmg-est">
                      {est.rear ? "🗡" : est.cover ? "🛡" : ""}
                      {est.min === est.max ? `−${est.min}` : `−${est.min}…${est.max}`}
                      {!!est.critPct && <b className="crit">🎯{est.critPct}%</b>}
                    </i>
                  )}
                </button>
              );
            })
          ) : (
            <span className="cbt-hint">
              {combatMode === "push"
                ? "Aucun ennemi aligné à portée de poussée."
                : "Aucune cible à portée — déplace-toi (cases vertes)."}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
