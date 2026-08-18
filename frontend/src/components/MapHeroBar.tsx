import { useStore } from "../store";
import { myTeamHeroes } from "../townUtils";
import { HeroChip } from "./HeroChip";
import { formatHMS, useForageRemaining } from "../useWave";
import { useT } from "../i18n/useT";
import { tx } from "../i18n/Trans";
import { stateLabel } from "../i18n/gameText";

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
  // ⚠ appelé pour son ABONNEMENT, pas pour sa valeur : les phrases ci-dessous
  // passent par `tx()` (qui n'est pas un crochet), donc sans ça le composant ne
  // se redessinerait pas quand la langue change sous lui.
  useT();
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
          {/* ⚠ l'emoji reste DANS le JSX et la phrase entière vit dans les huit
              langues : découper autour du gras ne marcherait qu'en français
              (l'allemand rejette le verbe à la fin, le japonais place le sujet
              ailleurs). `tx()` recoud le nœud <strong> à la place que la langue
              a choisie pour `{name}`. */}
          {snowedIn ? (
            <>❄️ {tx("map.hint.snow", { name: <strong>{selected.name}</strong> })}</>
          ) : forageIn !== null ? (
            <>
              🔄{" "}
              {tx("map.hint.forage", {
                name: <strong>{selected.name}</strong>,
                timer: <strong>{formatHMS(forageIn)}</strong>,
              })}
            </>
          ) : selInTown ? (
            <>🏰 {tx("map.hint.inTown", { name: <strong>{selected.name}</strong> })}</>
          ) : selected.states.includes("Tétanisé") ? (
            <>
              ⚠️{" "}
              {tx("map.hint.stuck", {
                name: <strong>{selected.name}</strong>,
                state: stateLabel("Tétanisé"),
              })}
            </>
          ) : cliffs > 0 ? (
            /* LE RELIEF : la seule raison pour laquelle une case voisine, praticable
               et découverte, refuse le pas. Sans cette phrase le joueur voit un
               losange ROUGE et doit deviner — or c'est justement le moment où on veut
               qu'il pense « je fais le tour, ou je chausse des bottes ». */
            <>
              ⛰️{" "}
              {tx(`map.hint.cliff.${(selected.climb ?? 1) < 2 ? "one" : "other"}`, {
                name: <strong>{selected.name}</strong>,
                n: selected.climb ?? 1,
              })}
            </>
          ) : (
            <>🎯 {tx("map.hint.selected", { name: <strong>{selected.name}</strong> })}</>
          )}
        </div>
      )}
    </div>
  );
}
