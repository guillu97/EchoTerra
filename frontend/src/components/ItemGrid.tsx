import type { Item } from "../api/types";
import { itemAssetUrl } from "../assets";

// Shared inventory renderer used by the Stock tab and the Hero screen so both views
// stay visually and behaviourally consistent.
export const TYPE_ICON: Record<string, string> = {
  aliment: "🍖",
  eau: "💧",
  plante: "🌿",
  minerai: "⛏️",
  objet: "📦",
  animal: "🐾",
  arme: "🗡️",
  consommable: "🧪",
  deco: "🪵",
};

export function ItemGrid({ items, empty = "— vide —" }: { items: Item[]; empty?: string }) {
  if (items.length === 0) return <div className="empty small">{empty}</div>;
  return (
    <div className="item-grid">
      {items.map((it) => {
        const url = itemAssetUrl(it);
        return (
          <div className="item-cell" key={it.name} title={it.name}>
            <div className="item-ic">
              {url ? (
                <img
                  src={url}
                  alt={it.name}
                  className="item-img"
                  onError={(e) => {
                    // fall back to the type emoji if the sprite is missing
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                    const sib = e.currentTarget.nextElementSibling as HTMLElement | null;
                    if (sib) sib.style.display = "";
                  }}
                />
              ) : null}
              <span style={url ? { display: "none" } : undefined}>{TYPE_ICON[it.type] ?? "❔"}</span>
            </div>
            <div className="item-qty">×{it.qty}</div>
            <div className="item-name">{it.name}</div>
          </div>
        );
      })}
    </div>
  );
}
