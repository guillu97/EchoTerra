import type { Item } from "../api/types";
import { itemAssetUrl } from "../assets";
import { tName } from "../i18n";
import { useT } from "../i18n/useT";

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

// `onOpen` ouvre la FICHE de l'objet (ItemSheet) : ce que c'est, ce qu'il fait, et
// les actions possibles. La grille n'était qu'une vitrine — nom tronqué, aucune
// information, et un tap qui consommait l'objet SANS RIEN DIRE. `actionable`
// marque d'un liseré doré ceux sur lesquels il y a quelque chose à faire.
export function ItemGrid({
  items,
  empty,
  onOpen,
  actionable,
}: {
  items: Item[];
  /** Phrase affichée quand la grille est vide. Déjà traduite par l'appelant. */
  empty?: string;
  onOpen?: (it: Item) => void;
  actionable?: (it: Item) => boolean;
}) {
  const { t } = useT();
  if (items.length === 0) return <div className="empty small">{empty ?? t("— vide —")}</div>;
  return (
    <div className="item-grid">
      {items.map((it) => {
        const url = itemAssetUrl(it);
        const hot = !!actionable?.(it);
        return (
          <div
            className={"item-cell" + (hot ? " usable" : "")}
            key={it.name}
            title={tName(it.name)}
            role={onOpen ? "button" : undefined}
            tabIndex={onOpen ? 0 : undefined}
            onClick={onOpen ? () => onOpen(it) : undefined}
            onKeyDown={onOpen ? (e) => (e.key === "Enter" || e.key === " ") && onOpen(it) : undefined}
          >
            <div className="item-ic">
              {url ? (
                <img
                  src={url}
                  alt={tName(it.name)}
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
            <div className="item-name">{tName(it.name)}</div>
          </div>
        );
      })}
    </div>
  );
}
