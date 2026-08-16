import { useState } from "react";
import { useStore } from "../store";
import { TownWorker } from "../components/TownWorker";
import { buildingName } from "../data/buildings";
import { heroesInTown, effectiveTownHeroId } from "../townUtils";
import { useT } from "../i18n/useT";

// « Tout » EN PREMIER et par défaut : les recettes sont réparties sur quatre catégories,
// et sans vue d'ensemble on ne peut pas comparer ce qu'on pourrait faire avec ce qu'on a
// — il fallait ouvrir les quatre onglets pour savoir. (Même convention que le Sac, qui
// commence lui aussi par « Tout ».)
const CATS = [
  { id: "all", label: "Tout" },
  { id: "conso", label: "Consommable" },
  { id: "potion", label: "Potion" },
  { id: "forge", label: "Forge" },
  { id: "deco", label: "Décoration" },
];

// Craft is always accessible. In town the chosen worker crafts from the Maison (full
// recipe set). In the field, the selected hero crafts from their own bag and only the
// "field" recipes are available (no workshop/forge outside the city).
export function CraftTab() {
  const game = useStore((s) => s.game);
  const recipes = useStore((s) => s.recipes);
  const craft = useStore((s) => s.craft);
  const busy = useStore((s) => s.busy);
  const selectedHeroId = useStore((s) => s.selectedHeroId);
  const townHeroId = useStore((s) => s.townHeroId);
  const playerId = useStore((s) => s.playerId);
  const [cat, setCat] = useState("all");
  const { t, tName, tDesc } = useT();
  if (!game) return null;

  const inTown = heroesInTown(game, playerId).length > 0;
  const actorId = inTown ? effectiveTownHeroId(game, playerId, townHeroId) : selectedHeroId;
  const actor = game.heroes.find((h) => h.id === actorId);
  const pa = actor?.pa ?? 0;
  const source = inTown ? game.town.storage ?? [] : actor?.inventory ?? [];
  const have = (name: string) => source.find((i) => i.name === name)?.qty ?? 0;
  const list = cat === "all" ? recipes : recipes.filter((r) => r.category === cat);

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
        <span className="tb-chip pa">⚡ {t("{n} PA", { n: pa })}</span>
      </div>

      {inTown ? (
        <TownWorker />
      ) : (
        <div className="craft-mode">
          🏕️ {t("Terrain — {name} · recettes limitées (sac du héros)", { name: actor?.name ?? "—" })}
        </div>
      )}
      <div className="cap">
        {inTown
          ? t("Ingrédients pris dans la 🏦 Banque ; objets rangés dans la Banque.")
          : t("Ingrédients pris dans le sac du héros ; pas d'atelier/forge en expédition.")}
      </div>

      <div className="ps-list">
        {list.length === 0 && <div className="empty">{t("Aucune recette ici.")}</div>}
        {list.map((r) => {
          const blocked = !inTown && !r.field; // needs a town building
          // In town, the recipe's building must be BUILT at its design level
          // (Kitchen niv.2 = plats raffinés, Workshop niv.3 = pièces avancées).
          const bld = r.building ? game.town.buildings.find((b) => b.id === r.building) : undefined;
          const needLvl = Math.max(1, r.buildingLevel || 1);
          const missingBld = inTown && !!r.building && (!bld || !bld.built || bld.level < needLvl);
          const enough = r.ingredients.every((ing) => have(ing.name) >= ing.qty);
          const canPay = pa >= r.paCost;
          const outQty = r.outputQty && r.outputQty > 1 ? ` ×${r.outputQty}` : "";
          return (
            <div className="ps-row" key={r.id}>
              <div className="ps-ic">{r.building === "kitchen" ? "🍳" : "⚒️"}</div>
              <div className="ps-main">
                <div className="ps-title">
                  {tName(r.name)}
                  {outQty} <span className="tag-type">{t(r.outputType)}</span>
                  {r.building && (
                    <span className={`tag-type ${missingBld ? "miss" : ""}`}>
                      {buildingName(r.building, bld?.name)}
                      {needLvl > 1 ? " " + t("niv.{n}", { n: needLvl }) : ""}
                    </span>
                  )}
                  {!r.field && <span className="tag-type ttown">{t("ville")}</span>}
                </div>
                <div className="ps-sub">
                  {r.ingredients.map((ing, i) => (
                    <span key={i} className={have(ing.name) >= ing.qty ? "ing ok" : "ing miss"}>
                      {tName(ing.name)} {have(ing.name)}/{ing.qty}
                      {i < r.ingredients.length - 1 ? " · " : ""}
                    </span>
                  ))}
                  {r.effects && <span className="ing fx"> — {tDesc(r.effects)}</span>}
                </div>
              </div>
              <button
                className="ps-act"
                disabled={busy || blocked || missingBld || !enough || !canPay}
                title={
                  blocked
                    ? t("Nécessite un bâtiment de la ville (atelier/forge)")
                    : missingBld
                    ? t("Nécessite {building} niveau {n}", {
                        building: buildingName(r.building, bld?.name),
                        n: needLvl,
                      })
                    : !enough
                    ? t("Ingrédients manquants")
                    : !canPay
                    ? t("PA insuffisants")
                    : ""
                }
                onClick={() => craft(r.id)}
              >
                {blocked || missingBld ? "🔒" : r.building === "kitchen" ? t("Cuisiner") : t("Fabriquer")}
                <span className="c">-{r.paCost}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
