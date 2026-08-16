import { useState } from "react";
import { useStore } from "../store";
import { TownWorker } from "../components/TownWorker";
import { buildingName } from "../data/buildings";
import { heroesInTown, effectiveTownHeroId } from "../townUtils";

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
  if (!game) return null;

  const inTown = heroesInTown(game, playerId).length > 0;
  const actorId = inTown ? effectiveTownHeroId(game, playerId, townHeroId) : selectedHeroId;
  const actor = game.heroes.find((h) => h.id === actorId);
  const pa = actor?.pa ?? 0;
  const source = inTown ? game.town.storage ?? [] : actor?.inventory ?? [];
  const have = (name: string) => source.find((i) => i.name === name)?.qty ?? 0;
  const list = cat === "all" ? recipes : recipes.filter((r) => r.category === cat);
  // L'icône de la faveur est celle du PANTHÉON de cette terre (⚡ grec, 🔨 nordique,
  // ☥ égyptien) — servie par le payload, jamais recopiée ici.
  const favorIcon = game.theme?.pantheon?.favor ?? "⚡";

  return (
    <div className="panel-screen">
      <div className="ps-head">
        <div className="tabs-scroll">
          {CATS.map((c) => (
            <button key={c.id} className={cat === c.id ? "on" : ""} onClick={() => setCat(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <span className="tb-chip pa">⚡ {pa} PA</span>
      </div>

      {inTown ? (
        <TownWorker />
      ) : (
        <div className="craft-mode">🏕️ Terrain — {actor?.name ?? "—"} · recettes limitées (sac du héros)</div>
      )}
      <div className="cap">
        {inTown
          ? "Ingrédients pris dans la 🏦 Banque ; objets rangés dans la Banque."
          : "Ingrédients pris dans le sac du héros ; pas d'atelier/forge en expédition."}
      </div>

      <div className="ps-list">
        {list.length === 0 && <div className="empty">Aucune recette ici.</div>}
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
                  {r.name}
                  {outQty} <span className="tag-type">{r.outputType}</span>
                  {r.building && (
                    <span className={`tag-type ${missingBld ? "miss" : ""}`}>
                      {buildingName(r.building, bld?.name)}
                      {needLvl > 1 ? ` niv.${needLvl}` : ""}
                    </span>
                  )}
                  {!r.field && <span className="tag-type ttown">ville</span>}
                </div>
                <div className="ps-sub">
                  {r.ingredients.map((ing, i) => (
                    <span key={i} className={have(ing.name) >= ing.qty ? "ing ok" : "ing miss"}>
                      {ing.name} {have(ing.name)}/{ing.qty}
                      {i < r.ingredients.length - 1 ? " · " : ""}
                    </span>
                  ))}
                  {/* LA FAVEUR (backend mythic.go) : ce que l'offrande verse aux dieux.
                      Elle est mise en avant plutôt que noyée dans `effects`, parce que
                      c'est la SEULE raison de fabriquer une décoration. */}
                  {!!r.favor && (
                    <span className="ing favor">
                      {" "}
                      — {favorIcon} +{r.favor} faveur
                    </span>
                  )}
                  {r.effects && !r.favor && <span className="ing fx"> — {r.effects}</span>}
                </div>
              </div>
              <button
                className="ps-act"
                disabled={busy || blocked || missingBld || !enough || !canPay}
                title={
                  blocked
                    ? "Nécessite un bâtiment de la ville (atelier/forge)"
                    : missingBld
                    ? `Nécessite ${buildingName(r.building, bld?.name)} niveau ${needLvl}`
                    : !enough
                    ? "Ingrédients manquants"
                    : !canPay
                    ? "PA insuffisants"
                    : ""
                }
                onClick={() => craft(r.id)}
              >
                {blocked || missingBld ? "🔒" : r.building === "kitchen" ? "Cook" : "Craft"}
                <span className="c">-{r.paCost}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
