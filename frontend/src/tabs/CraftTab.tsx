import { useState } from "react";
import { useStore } from "../store";
import { TownWorker } from "../components/TownWorker";
import { heroesInTown, effectiveTownHeroId } from "../townUtils";

const CATS = [
  { id: "conso", label: "Consommable" },
  { id: "potion", label: "Potion" },
  { id: "forge", label: "Forge" },
  { id: "deco", label: "Decoration" },
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
  const [cat, setCat] = useState("conso");
  if (!game) return null;

  const inTown = heroesInTown(game).length > 0;
  const actorId = inTown ? effectiveTownHeroId(game, townHeroId) : selectedHeroId;
  const actor = game.heroes.find((h) => h.id === actorId);
  const pa = actor?.pa ?? 0;
  const source = inTown ? game.town.storage ?? [] : actor?.inventory ?? [];
  const have = (name: string) => source.find((i) => i.name === name)?.qty ?? 0;
  const list = recipes.filter((r) => r.category === cat);

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
          const enough = r.ingredients.every((ing) => have(ing.name) >= ing.qty);
          const canPay = pa >= r.paCost;
          return (
            <div className="ps-row" key={r.id}>
              <div className="ps-ic">{r.building === "kitchen" ? "🍳" : "⚒️"}</div>
              <div className="ps-main">
                <div className="ps-title">
                  {r.name} <span className="tag-type">{r.outputType}</span>
                  {!r.field && <span className="tag-type ttown">ville</span>}
                </div>
                <div className="ps-sub">
                  {r.ingredients.map((ing, i) => (
                    <span key={i} className={have(ing.name) >= ing.qty ? "ing ok" : "ing miss"}>
                      {ing.name} {have(ing.name)}/{ing.qty}
                      {i < r.ingredients.length - 1 ? " · " : ""}
                    </span>
                  ))}
                </div>
              </div>
              <button
                className="ps-act"
                disabled={busy || blocked || !enough || !canPay}
                title={blocked ? "Nécessite un bâtiment de la ville (atelier/forge)" : !enough ? "Ingrédients manquants" : !canPay ? "PA insuffisants" : ""}
                onClick={() => craft(r.id)}
              >
                {blocked ? "🏙️ Ville" : r.building === "kitchen" ? "Cook" : "Craft"}
                <span className="c">-{r.paCost}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
