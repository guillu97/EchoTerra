import { useStore } from "../store";
import { NAV_TABS } from "../data/buildings";
import { heroesInTown, TOWN_TABS } from "../townUtils";
import type { Tab } from "../store";

// Bottom navigation — onglets parchemin gravés, avec la CARTE en bouton central
// surélevé (c'est l'écran principal du jeu, il mérite le pouce).
//
// Les onglets de ville ne sont ouverts que si l'un de MES héros est sur la case
// ville (le héros d'un autre joueur n'ouvre pas MA ville). Ils restent
// focusables et cliquables — `aria-disabled` plutôt que `disabled` — pour que le
// tap puisse expliquer POURQUOI c'est verrouillé : le `title=` d'avant était
// invisible au doigt, donc le verrou paraissait arbitraire.
export function BottomNav() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const notify = useStore((s) => s.notify);
  const inTown = heroesInTown(game, playerId).length > 0;

  // Badge « il se passe quelque chose ici » : chantiers ouverts côté Bâtir.
  // Volontairement factuel (nombre de chantiers en cours) plutôt qu'un calcul
  // d'accessibilité des matériaux, qui dupliquerait la logique de StructureTab
  // et dériverait d'elle.
  const openSites = (game?.town.buildings ?? []).filter((b) => b.underConstruction).length;

  const badgeFor = (id: string) => (id === "structure" && openSites > 0 ? openSites : 0);

  return (
    <nav className="bottom-nav" role="tablist" aria-label="Navigation principale">
      {NAV_TABS.map((t) => {
        const isTownTab = (TOWN_TABS as readonly string[]).includes(t.id);
        const locked = isTownTab && !inTown;
        const isMap = t.id === "map";
        const active = tab === t.id;
        const badge = badgeFor(t.id);

        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            aria-disabled={locked || undefined}
            className={`nav-tab${isMap ? " nav-center" : ""}${active ? " active" : ""}${
              locked ? " locked" : ""
            }`}
            onClick={() => {
              if (locked) {
                notify("Aucun de tes héros n'est en ville.", "warn");
                return;
              }
              setTab(t.id as Tab);
            }}
          >
            <span className="ni" aria-hidden="true">
              {locked ? "🔒" : t.icon}
            </span>
            <span className="nl">{t.label}</span>
            {badge > 0 && (
              <span className="nb" aria-label={`${badge} chantier${badge > 1 ? "s" : ""} en cours`}>
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
