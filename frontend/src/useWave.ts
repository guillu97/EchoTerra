import { useEffect, useState } from "react";
import type { Combat, GameState, Hero } from "./api/types";

// Compte à rebours. Les heures ne s'affichent que si elles sont non nulles :
// « 00:08:16 » occupait la moitié de la barre du haut sur un téléphone et
// écrasait le nom de la ville, alors que les deux premiers chiffres étaient
// presque toujours des zéros.
export function formatHMS(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Seconds until the next wave, derived from the server-provided `nextWaveAt`.
export function useWaveRemaining(game?: GameState): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!game?.nextWaveAt) return 0;
  const target = new Date(game.nextWaveAt).getTime();
  return Math.max(0, Math.floor((target - now) / 1000));
}

// Secondes avant un instant serveur quelconque (null si l'instant n'est pas donné).
// Sert au compte à rebours de l'ESCORTE DE DÉPART, dont l'heure vient du serveur
// (`game.escortAt`) : le client ne recopie pas le délai, il le lirait de travers le jour
// où il changerait.
export function useCountdown(at?: string): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!at) return null;
  return Math.max(0, Math.floor((new Date(at).getTime() - now) / 1000));
}

// Secondes avant la prochaine FOUILLE AUTOMATIQUE d'un héros, dérivées de
// `hero.forageAt` (serveur). null = ce héros n'est pas installé à récolter.
//
// Le compte à rebours peut passer à 0 et y rester un instant : la récolte est
// jouée par la simulation, donc elle n'atterrit dans l'état du client qu'au
// sondage suivant (20 s). C'est voulu — afficher « 00:00 » quelques secondes
// est plus honnête que de faire semblant d'avoir déjà trouvé.
export function useForageRemaining(hero?: Hero): number | null {
  const [now, setNow] = useState(() => Date.now());
  const at = hero?.forageAt;
  useEffect(() => {
    if (!at) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [at]);
  if (!at) return null;
  return Math.max(0, Math.ceil((new Date(at).getTime() - now) / 1000));
}

// Secondes restantes avant l'expiration du tour de combat courant (multijoueur
// anti-blocage), dérivées de `combat.turnDeadline`. null = pas de minuteur (tour
// d'IA/monstre, ou combat solo/legacy).
export function useTurnRemaining(combat?: Combat): number | null {
  const [now, setNow] = useState(() => Date.now());
  const deadline = combat?.turnDeadline;
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline || !combat || combat.status !== "active") return null;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
}
