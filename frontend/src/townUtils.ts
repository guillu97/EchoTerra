import type { GameState, Hero } from "./api/types";

// Heroes physically standing on the town tile (they fund all town work with their PA).
export function heroesInTown(g?: GameState): Hero[] {
  if (!g) return [];
  return g.heroes.filter((h) => h.hp > 0 && h.x === g.town.x && h.y === g.town.y);
}

// Shared action-point pool available for town construction/actions.
export function townPA(g?: GameState): number {
  return heroesInTown(g).reduce((s, h) => s + h.pa, 0);
}

// The hero who actually pays for town work: the preferred one if still in town,
// otherwise the first hero in town.
export function effectiveTownHeroId(g?: GameState, preferred?: string): string | undefined {
  const inTown = heroesInTown(g);
  if (preferred && inTown.some((h) => h.id === preferred)) return preferred;
  return inTown[0]?.id;
}

// Tabs that require a hero standing in town. Only Home (the city management screen) is
// gated. Stock/Structure/Craft are always viewable: Structure lets you consult the
// blueprints you plan to build (building itself needs town), and Craft works in the
// field with a reduced recipe set.
export const TOWN_TABS = ["home"] as const;
