import { useState } from "react";
import { useStore } from "../store";
import { effectiveTownHeroId, heroesInTown, myTeamHeroes } from "../townUtils";
import { ItemGrid } from "../components/ItemGrid";
import { ItemSheet, itemWouldHelp } from "../components/ItemSheet";
import type { Item } from "../api/types";
import { useT } from "../i18n/useT";

const CATS = [
  { id: "all", label: "Tout", types: [] as string[] },
  { id: "conso", label: "Consommable", types: ["aliment", "eau", "consommable"] },
  { id: "plante", label: "Plante", types: ["plante"] },
  { id: "mineral", label: "Minerai", types: ["minerai"] },
  { id: "object", label: "Objet", types: ["objet"] },
  { id: "animal", label: "Animal", types: ["animal"] },
  { id: "arme", label: "Arme", types: ["arme"] },
];

// Stock = always accessible overview. MY heroes' personal bags only (another
// player's inventory is their business), plus the shared Bank storage when one of
// MY heroes is in town.
export function StockTab() {
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const deposit = useStore((s) => s.townDeposit);
  const busy = useStore((s) => s.busy);
  const useItem = useStore((s) => s.useItem);
  const equipItem = useStore((s) => s.equipItem);
  const itemEffects = useStore((s) => s.itemEffects);
  const equipment = useStore((s) => s.equipment);
  const [cat, setCat] = useState("all");
  // La FICHE d'objet ouverte : d'où elle vient (le sac d'un héros, ou la Banque)
  // détermine ce qu'on a le droit d'en faire — voir l'en-tête d'ItemSheet.
  const [sheet, setSheet] = useState<{ item: Item; heroId?: string } | null>(null);
  const { t } = useT();
  if (!game) return null;

  const active = CATS.find((c) => c.id === cat)!;
  const filt = (items: Item[]) => (active.types.length ? items.filter((i) => active.types.includes(i.type)) : items);
  const myHeroes = myTeamHeroes(game, playerId);
  const inTown = heroesInTown(game, playerId);
  const carried = inTown.reduce((s, h) => s + h.inventory.reduce((n, i) => n + i.qty, 0), 0);
  const townTotal = (game.town.storage ?? []).reduce((s, i) => s + i.qty, 0);

  return (
    <div className="panel-screen">
      <div className="ps-head">
        <div className="tabs-scroll">
          {CATS.map((c) => (
            <button key={c.id} className={cat === c.id ? "on" : ""} onClick={() => setCat(c.id)}>
              {t(c.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="ps-list">
        {myHeroes.map((h) => {
          const here = h.x === game.town.x && h.y === game.town.y;
          const carriedH = h.inventory.reduce((s, i) => s + i.qty, 0);
          return (
            <div className="stock-section" key={h.id}>
              <div className="stock-sec-head">
                🎒 {h.name}
                <span className={`tag-loc ${here ? "in" : "out"}`}>{here ? t("en ville") : t("en expédition")}</span>
                <span className="right muted">{t("{n} obj.", { n: carriedH })}</span>
              </div>
              {/* Taper un objet ouvre sa FICHE (ItemSheet) : ce que c'est, ce qu'il
                  fait, et les actions possibles. Auparavant un tap CONSOMMAIT l'objet
                  sans rien dire, et rien n'indiquait à quoi il servait — or le survol
                  n'existe pas sur un téléphone. */}
              <ItemGrid
                items={filt(h.inventory)}
                onOpen={(it) => setSheet({ item: it, heroId: h.id })}
                actionable={(it) => !!itemEffects[it.name] || !!equipment[it.name]}
              />
            </div>
          );
        })}

        {inTown.length > 0 ? (
          <div className="stock-section house">
            <div className="stock-sec-head">
              🏦 {t("Banque (ville)")}
              <span className="right muted">{townTotal}/2000</span>
            </div>
            <button className="small green dep" disabled={busy || carried === 0} onClick={() => deposit()}>
              📦 {t("Déposer le butin de mes héros en ville")} {carried > 0 ? `(${carried})` : ""}
            </button>
            <ItemGrid
              items={filt(game.town.storage ?? [])}
              onOpen={(it) => setSheet({ item: it })}
              actionable={(it) => !!itemEffects[it.name]}
            />
          </div>
        ) : (
          <div className="stock-note">
            🏙️{" "}
            {t(
              "Reviens en ville pour accéder au stock de la Banque. En expédition, un héros n'utilise que son propre inventaire.",
            )}
          </div>
        )}
      </div>

      {sheet && (() => {
        const owner = sheet.heroId ? myHeroes.find((h) => h.id === sheet.heroId) : undefined;
        // Depuis la BANQUE, c'est l'ouvrier de la ville qui consomme sur place (la
        // « cantine » de game/items.go) — il faut donc un héros dans les murs.
        const townHeroId = effectiveTownHeroId(game, playerId, useStore.getState().townHeroId);
        const actor = owner?.id ?? townHeroId;
        const actorHero = actor ? myHeroes.find((h) => h.id === actor) : undefined;
        const eff = itemEffects[sheet.item.name];
        // Le serveur refuse un objet qui n'apporterait rien : on éteint le bouton
        // plutôt que d'offrir une erreur, et on dit laquelle des deux raisons c'est.
        const helps = !!eff && !!actorHero && itemWouldHelp(actorHero, eff);
        return (
          <ItemSheet
            item={sheet.item}
            effect={itemEffects[sheet.item.name]}
            gear={equipment[sheet.item.name]}
            ownerName={owner ? owner.name : t("Banque")}
            canUse={helps}
            whyNoUse={
              !actorHero
                ? t("Il faut un de tes héros dans la ville pour puiser dans la Banque.")
                : t("{name} est déjà au mieux : cela ne servirait à rien maintenant.", { name: actorHero.name })
            }
            canEquip={!!owner}
            busy={busy}
            onUse={() => { if (actor) void useItem(actor, sheet.item.name); setSheet(null); }}
            onEquip={() => {
              const def = equipment[sheet.item.name];
              if (owner && def) void equipItem(owner.id, sheet.item.name, def.slot);
              setSheet(null);
            }}
            onClose={() => setSheet(null)}
          />
        );
      })()}
    </div>
  );
}
