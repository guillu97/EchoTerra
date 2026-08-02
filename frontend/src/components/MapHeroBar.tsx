import { useStore } from "../store";
import { myTeamHeroes } from "../townUtils";
import { HeroChip } from "./HeroChip";
import { formatHMS, useForageRemaining } from "../useWave";

// Barre de sélection des héros, posée sur la carte (vue Map uniquement). Une
// pastille par héros de MON équipe : portrait, nom, barre de PV, PA, et un badge
// de lieu (🏰 en ville). Taper une pastille sélectionne le héros ACTIF (celui
// que les losanges jaunes déplacent) ET recentre la caméra dessus. C'est LE
// moyen simple de choisir qui sort de la ville (sélectionner puis taper une case
// adjacente) et qui je déplace — plus besoin du dropdown 🙂 pour ça.
//
// La pastille elle-même vit dans `HeroChip.tsx` : les trois listes de héros du
// jeu (ici, l'écran Ville, le dropdown de la TopBar) la partagent.
export function MapHeroBar() {
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const selectedHeroId = useStore((s) => s.selectedHeroId);
  const focusHero = useStore((s) => s.focusHero);
  const openHero = useStore((s) => s.openHero);
  // ⚠ avant tout retour anticipé : c'est un hook.
  const selected = game?.heroes.find((h) => h.id === selectedHeroId);
  const forageIn = useForageRemaining(selected);
  if (!game) return null;

  const roster = myTeamHeroes(game, playerId);
  if (roster.length === 0) return null;

  const selInTown = !!selected && selected.hp > 0 && selected.x === game.town.x && selected.y === game.town.y;

  return (
    <div className="map-herobar">
      <div className="mhb-row">
        {roster.map((h) => (
          <HeroChip
            key={h.id}
            hero={h}
            inTown={h.hp > 0 && h.x === game.town.x && h.y === game.town.y}
            selected={h.id === selectedHeroId}
            onSelect={() => focusHero(h.id)}
            onOpenSheet={() => openHero(h.id)}
          />
        ))}
      </div>
      {selected && selected.hp > 0 && (
        <div className="mhb-hint">
          {forageIn !== null ? (
            <>🔄 <strong>{selected.name}</strong> fouille sur place — prochaine trouvaille dans{" "}
              <strong>{formatHMS(forageIn)}</strong> (sans PA ; bouger l'interrompt).</>
          ) : selInTown ? (
            <>🏰 <strong>{selected.name}</strong> est en ville — tape une case adjacente pour le faire sortir.</>
          ) : selected.states.includes("Tétanisé") ? (
            <>⚠️ <strong>{selected.name}</strong> est Tétanisé — tue le pack ou fuis.</>
          ) : (
            <>🎯 <strong>{selected.name}</strong> sélectionné — tape les losanges jaunes pour le déplacer.</>
          )}
        </div>
      )}
    </div>
  );
}
