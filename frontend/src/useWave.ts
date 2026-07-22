import { useEffect, useState } from "react";
import type { Combat, GameState } from "./api/types";

export function formatHMS(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
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
