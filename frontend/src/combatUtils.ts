import type { Combat, GameState } from "./api/types";

// Le combat ACTIF (parmi game.combats) où figure au moins un de MES héros encore
// en lice — ou undefined. Plusieurs combats peuvent tourner en parallèle
// (chaque joueur le sien), donc on scanne tous les combats, pas seulement
// game.activeCombat.
export function myActiveCombat(game?: GameState, playerId?: string): Combat | undefined {
  if (!game?.combats) return undefined;
  const myIds = game.players?.find((p) => p.id === playerId)?.heroIds ?? game.heroes.map((h) => h.id);
  for (const id in game.combats) {
    const c = game.combats[id];
    if (c.status !== "active") continue;
    if (c.units.some((u) => u.side === "hero" && u.hp > 0 && !u.fled && myIds.includes(u.refId))) return c;
  }
  return undefined;
}
