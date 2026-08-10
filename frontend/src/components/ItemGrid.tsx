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

// Emoji fallback for an item with no sprite: blueprints (Plan de …) read as 📐,
// everything else falls back to its category icon.
export function itemEmoji(it: Item): string {
  if (it.name.startsWith("Plan ")) return "📐";
  return TYPE_ICON[it.type] ?? "❔";
}

// `onUse` rend les objets CONSOMMABLES cliquables (nourriture, potions — cf. le backend
// game/items.go). Sans lui la grille reste une vitrine, ce qu'elle était : les vingt-six
// recettes du jeu produisaient des plats et des potions que personne ne pouvait avaler.
export function ItemGrid({
  items,
  empty = "— vide —",
  onUse,
  usable,
}: {
  items: Item[];
  empty?: string;
  onUse?: (it: Item) => void;
  usable?: (it: Item) => boolean;
}) {
  if (items.length === 0) return <div className="empty small">{empty}</div>;
  return (
    <div className="item-grid">
      {items.map((it) => {
        const url = itemAssetUrl(it);
        const canUse = !!onUse && (usable ? usable(it) : false);
        return (
          <div
            className={"item-cell" + (canUse ? " usable" : "")}
            key={it.name}
            title={canUse ? `${it.name} — utiliser` : it.name}
            role={canUse ? "button" : undefined}
            tabIndex={canUse ? 0 : undefined}
            onClick={canUse ? () => onUse!(it) : undefined}
            onKeyDown={canUse ? (e) => (e.key === "Enter" || e.key === " ") && onUse!(it) : undefined}
          >
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
              <span style={url ? { display: "none" } : undefined}>{itemEmoji(it)}</span>
            </div>
            <div className="item-qty">×{it.qty}</div>
            <div className="item-name">{it.name}</div>
          </div>
        );
      })}
    </div>
  );
}
