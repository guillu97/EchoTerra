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
  const selTile = selected && !selInTown ? game.tiles[selected.y * game.width + selected.x] : undefined;
  const snowedIn = !!selTile?.covered;
  // Combien de voisines DÉCOUVERTES sont hors de portée d'escalade (backend
  // climb.go) — le miroir exact du filtre des losanges dans VoxelMapView.
  const cliffs =
    selected && !selInTown && selTile
      ? [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => {
          const nx = selected.x + dx, ny = selected.y + dy;
          if (nx < 0 || ny < 0 || nx >= game.width || ny >= game.height) return false;
          const t = game.tiles[ny * game.width + nx];
          return !!t && t.discovered && t.biome !== 0 &&
            Math.abs(t.height - selTile.height) > (selected.climb ?? 1);
        }).length
      : 0;

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
          {/* NEIGE FRAÎCHE (thème nordique) : c'est LA raison pour laquelle la récolte
              s'est arrêtée, et sans un mot ici le joueur ne peut pas la deviner. */}
          {snowedIn ? (
            <>❄️ <strong>{selected!.name}</strong> a la case ensevelie sous la neige — fouiller la
              dégage et relance la récolte.</>
          ) : forageIn !== null ? (
            <>🔄 <strong>{selected.name}</strong> fouille sur place — prochaine trouvaille dans{" "}
              <strong>{formatHMS(forageIn)}</strong> (sans PA ; bouger l'interrompt).</>
          ) : selInTown ? (
            <>🏰 <strong>{selected.name}</strong> est en ville — tape une case adjacente pour le faire sortir.</>
          ) : selected.states.includes("Tétanisé") ? (
            <>⚠️ <strong>{selected.name}</strong> est Tétanisé — tue le pack ou fuis.</>
          ) : cliffs > 0 ? (
            /* LE RELIEF : la seule raison pour laquelle une case voisine, praticable
               et découverte, refuse le pas. Sans cette phrase le joueur voit un
               losange ROUGE et doit deviner — or c'est justement le moment où on veut
               qu'il pense « je fais le tour, ou je chausse des bottes ». */
            <>⛰️ <strong>{selected.name}</strong> franchit {selected.climb ?? 1} niveau
              {(selected.climb ?? 1) > 1 ? "x" : ""} — les cases rouges sont trop escarpées :
              contourne, ou gagne en athlétisme (Bottes cloutées).</>
          ) : (
            <>🎯 <strong>{selected.name}</strong> sélectionné — tape les losanges jaunes pour le déplacer.</>
          )}
        </div>
      )}
    </div>
  );
}
