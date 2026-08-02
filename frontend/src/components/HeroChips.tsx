import { useStore } from "../store";
import { myTeamHeroes, effectiveTownHeroId } from "../townUtils";
import { HeroChip } from "./HeroChip";

// La liste des personnages de l'écran VILLE.
//
// Avant, cette colonne affichait la CLASSE de chaque héros et, tant qu'il n'en
// avait pas (c'est-à-dire toute la première journée), un libellé de secours codé
// en dur — « Pionnier », « Récupérateur », « Éclaireur » — qui n'était le nom de
// personne et ne correspondait à rien dans la partie. Une initiale dans une
// pastille et une ★ décorative complétaient le malentendu.
//
// C'est maintenant une vraie liste de persos : portrait, NOM, PV, PA, badge de
// lieu. Et taper un héros ne fait pas que le sélectionner : s'il est en ville,
// il devient l'OUVRIER qui paie les PA des chantiers et des actions (le même
// choix que `TownWorker`) — ce qui est précisément la décision qu'on prend sur
// cet écran.
export function HeroChips() {
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const selectedHeroId = useStore((s) => s.selectedHeroId);
  const townHeroId = useStore((s) => s.townHeroId);
  const selectHero = useStore((s) => s.selectHero);
  const setTownHero = useStore((s) => s.setTownHero);
  const openHero = useStore((s) => s.openHero);
  if (!game) return null;

  const roster = myTeamHeroes(game, playerId);
  if (roster.length === 0) return null;
  const workerId = effectiveTownHeroId(game, playerId, townHeroId);

  return (
    <div className="hero-chips">
      {roster.map((h) => {
        const inTown = h.hp > 0 && h.x === game.town.x && h.y === game.town.y;
        return (
          <HeroChip
            key={h.id}
            hero={h}
            layout="column"
            inTown={inTown}
            selected={h.id === selectedHeroId}
            note={
              inTown
                ? h.id === workerId
                  ? "⚒️ paie les PA"
                  : undefined
                : "🥾 en expédition"
            }
            onSelect={() => {
              selectHero(h.id);
              if (inTown) setTownHero(h.id);
            }}
            onOpenSheet={() => openHero(h.id)}
          />
        );
      })}
    </div>
  );
}
