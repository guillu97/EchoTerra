import type { Item } from "../api/types";

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
      {items.map((it) => (
        <div className="item-cell" key={it.name} title={it.name}>
          <div className="item-ic">{TYPE_ICON[it.type] ?? "❔"}</div>
          <div className="item-qty">×{it.qty}</div>
          <div className="item-name">{it.name}</div>
        </div>
      ))}
    </div>
  );
}
