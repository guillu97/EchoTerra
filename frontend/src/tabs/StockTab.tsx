import { useState } from "react";
import { useStore } from "../store";
import { heroesInTown } from "../townUtils";
import { ItemGrid } from "../components/ItemGrid";
import type { Item } from "../api/types";

const CATS = [
  { id: "all", label: "Tout", types: [] as string[] },
  { id: "conso", label: "Consommable", types: ["aliment", "eau", "consommable"] },
  { id: "plante", label: "Plante", types: ["plante"] },
  { id: "mineral", label: "Mineral", types: ["minerai"] },
  { id: "object", label: "Object", types: ["objet"] },
  { id: "animal", label: "Animal", types: ["animal"] },
  { id: "arme", label: "Arme", types: ["arme"] },
];

// Stock = always accessible overview. Each hero's personal bag (click to open the hero
// screen's Inventory), plus the shared Maison storage when a hero is in town.
export function StockTab() {
  const game = useStore((s) => s.game);
  const deposit = useStore((s) => s.townDeposit);
  const busy = useStore((s) => s.busy);
  const [cat, setCat] = useState("all");
  if (!game) return null;

  const active = CATS.find((c) => c.id === cat)!;
  const filt = (items: Item[]) => (active.types.length ? items.filter((i) => active.types.includes(i.type)) : items);
  const inTown = heroesInTown(game);
  const carried = inTown.reduce((s, h) => s + h.inventory.reduce((n, i) => n + i.qty, 0), 0);
  const townTotal = (game.town.storage ?? []).reduce((s, i) => s + i.qty, 0);

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
      </div>

      <div className="ps-list">
        {game.heroes.map((h) => {
          const here = h.x === game.town.x && h.y === game.town.y;
          const carriedH = h.inventory.reduce((s, i) => s + i.qty, 0);
          return (
            <div className="stock-section" key={h.id}>
              <div className="stock-sec-head">
                🎒 {h.name}
                <span className={`tag-loc ${here ? "in" : "out"}`}>{here ? "en ville" : "en expédition"}</span>
                <span className="right muted">{carriedH} obj.</span>
              </div>
              <ItemGrid items={filt(h.inventory)} />
            </div>
          );
        })}

        {inTown.length > 0 ? (
          <div className="stock-section house">
            <div className="stock-sec-head">
              🏦 Banque (ville)
              <span className="right muted">{townTotal}/2000</span>
            </div>
            <button className="small green dep" disabled={busy || carried === 0} onClick={() => deposit()}>
              📦 Déposer le butin des héros en ville {carried > 0 ? `(${carried})` : ""}
            </button>
            <ItemGrid items={filt(game.town.storage ?? [])} />
          </div>
        ) : (
          <div className="stock-note">
            🏙️ Reviens en ville pour accéder au stock de la <b>Banque</b>. En expédition, un héros n'utilise que son propre inventaire.
          </div>
        )}
      </div>
    </div>
  );
}
