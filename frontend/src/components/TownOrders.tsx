import { useState } from "react";
import { useStore } from "../store";

// L'ORDRE DU JOUR — ce que la ville demande, maintenant.
//
// Réponse au trou de rétention T3 (RETENTION-PLAN.md) : le joueur arrive deux fois par
// jour avec 18 PA, et jusqu'ici le jeu ne lui disait rien de ce dont la ville avait
// besoin. L'information existait — matériaux manquants, packs dans l'anneau, bâtiments
// abîmés — mais éparpillée sur trois onglets, et pour une session de cinq minutes cette
// reconstitution ÉTAIT le coût d'entrée.
//
// Tout vient du serveur (game/orders.go), entièrement dérivé de l'état : ce composant
// n'a aucune règle de jeu, il met en forme. Replié par défaut à la ligne la plus
// urgente pour ne pas manger l'écran du bourg — c'est un panneau d'affichage, pas un
// tableau de bord.
export function TownOrders() {
  const game = useStore((s) => s.game);
  const [open, setOpen] = useState(false);
  const orders = game?.town.orders ?? [];
  if (!game || game.status !== "active" || orders.length === 0) return null;

  const head = orders[0];
  const rest = orders.slice(1);
  const urgent = orders.some((o) => o.urgent);

  return (
    <div className={"orders" + (urgent ? " urgent" : "")}>
      <button
        className="orders-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? "Replier l'ordre du jour" : "Voir l'ordre du jour"}
      >
        <span className="orders-icon">{head.icon}</span>
        <span className="orders-text">{head.text}</span>
        {rest.length > 0 && <span className="orders-more">{open ? "▾" : `+${rest.length}`}</span>}
      </button>
      {open && rest.length > 0 && (
        <ul className="orders-list">
          {rest.map((o, i) => (
            <li key={i} className={o.urgent ? "urgent" : ""}>
              <span className="orders-icon">{o.icon}</span>
              <span>{o.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
