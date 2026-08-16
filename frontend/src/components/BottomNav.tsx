import { useStore } from "../store";
import { NAV_TABS } from "../data/buildings";
import { heroesInTown, TOWN_TABS } from "../townUtils";
import { assetUrl, type AssetKey } from "../assets";
import type { Tab } from "../store";
import { useT } from "../i18n/useT";

// Bottom navigation — onglets parchemin gravés, avec la CARTE en bouton central
// surélevé (c'est l'écran principal du jeu, il mérite le pouce).
//
// Les onglets de ville ne sont ouverts que si l'un de MES héros est sur la case
// ville (le héros d'un autre joueur n'ouvre pas MA ville). Ils restent
// focusables et cliquables — `aria-disabled` plutôt que `disabled` — pour que le
// tap puisse expliquer POURQUOI c'est verrouillé : le `title=` d'avant était
// invisible au doigt, donc le verrou paraissait arbitraire.
function NavIcon({ id, fallback }: { id: string; fallback: string }) {
  const url = assetUrl(`nav-${id}` as AssetKey);
  return url ? <img src={url} alt="" /> : <>{fallback}</>;
}

export function BottomNav() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const notify = useStore((s) => s.notify);
  const inTown = heroesInTown(game, playerId).length > 0;
  const { t } = useT();

  // Badge « il se passe quelque chose ici » : chantiers ouverts côté Bâtir.
  // Volontairement factuel (nombre de chantiers en cours) plutôt qu'un calcul
  // d'accessibilité des matériaux, qui dupliquerait la logique de StructureTab
  // et dériverait d'elle.
  const openSites = (game?.town.buildings ?? []).filter((b) => b.underConstruction).length;

  const badgeFor = (id: string) => (id === "structure" && openSites > 0 ? openSites : 0);

  return (
    <nav className="bottom-nav" role="tablist" aria-label={t("Navigation principale")}>
      {NAV_TABS.map((nav) => {
        const isTownTab = (TOWN_TABS as readonly string[]).includes(nav.id);
        const locked = isTownTab && !inTown;
        const isMap = nav.id === "map";
        const active = tab === nav.id;
        const badge = badgeFor(nav.id);

        return (
          <button
            key={nav.id}
            role="tab"
            aria-selected={active}
            aria-disabled={locked || undefined}
            className={`nav-tab${isMap ? " nav-center" : ""}${active ? " active" : ""}${
              locked ? " locked" : ""
            }`}
            onClick={() => {
              if (locked) {
                notify(t("Aucun de tes héros n'est en ville."), "warn");
                return;
              }
              setTab(nav.id as Tab);
            }}
          >
            <span className="ni" aria-hidden="true">
              {locked ? (
                "🔒"
              ) : (
                // Les PNG peints `ui/nav-*` existaient déjà dans le dépôt mais
                // n'étaient utilisés nulle part : la barre affichait des emoji,
                // qui changent de dessin selon la plateforme. Emoji en repli si
                // le sondage d'assets n'a pas trouvé le fichier.
                <NavIcon id={nav.id} fallback={nav.icon} />
              )}
            </span>
            <span className="nl">{t(nav.label)}</span>
            {badge > 0 && (
              <span
                className="nb"
                aria-label={badge > 1 ? t("{n} chantiers en cours", { n: badge }) : t("1 chantier en cours")}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
