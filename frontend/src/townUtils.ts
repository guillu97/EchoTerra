import type { GameState, Hero } from "./api/types";

// My team's heroes. In a multiplayer game only the heroes owned by `playerId`
// count — town presence, PA pools and the Stock tab must never mix in another
// player's team. Legacy solo games (no players array) control every hero.
export function myTeamHeroes(g?: GameState, playerId?: string): Hero[] {
  if (!g) return [];
  if (!g.players?.length) return g.heroes;
  const mine = new Set(g.players.find((p) => p.id === playerId)?.heroIds ?? []);
  return g.heroes.filter((h) => mine.has(h.id));
}

// MY heroes physically standing on the town tile (they fund all town work with
// their PA). Another player's hero in town does NOT count for me: it can't open
// my Home tab, pay for my construction work, or show up as my town worker.
export function heroesInTown(g?: GameState, playerId?: string): Hero[] {
  if (!g) return [];
  return myTeamHeroes(g, playerId).filter((h) => h.hp > 0 && h.x === g.town.x && h.y === g.town.y);
}

// Action-point pool available to ME for town construction/actions.
export function townPA(g?: GameState, playerId?: string): number {
  return heroesInTown(g, playerId).reduce((s, h) => s + h.pa, 0);
}

// The hero who actually pays for town work: the preferred one if still mine and in
// town, otherwise my first hero in town.
export function effectiveTownHeroId(
  g?: GameState,
  playerId?: string,
  preferred?: string,
): string | undefined {
  const inTown = heroesInTown(g, playerId);
  if (preferred && inTown.some((h) => h.id === preferred)) return preferred;
  return inTown[0]?.id;
}

// Tabs that require one of MY heroes standing in town. Only Home (the city
// management screen) is gated. Stock/Structure/Craft are always viewable:
// Structure lets you consult the blueprints you plan to build (building itself
// needs town), and Craft works in the field with a reduced recipe set.
export const TOWN_TABS = ["home"] as const;
