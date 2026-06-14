import type { ClassDef, CombatResponse, FireballReport, GameState, Item, Recipe } from "./types";

// Relative base: Vite proxies /api to the Go backend during development.
async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error((data && data.error) || `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  createGame: (opts: { width?: number; height?: number; seed?: number } = {}) =>
    req<GameState>("POST", "/api/games", opts),

  getGame: (id: string) => req<GameState>("GET", `/api/games/${id}`),

  move: (gameId: string, heroId: string, dx: number, dy: number) =>
    req<GameState>("POST", `/api/games/${gameId}/heroes/${heroId}/move`, { DX: dx, DY: dy }),

  search: (gameId: string, heroId: string) =>
    req<{ loot: Item; game: GameState }>(
      "POST",
      `/api/games/${gameId}/heroes/${heroId}/search`,
      {},
    ),

  hide: (gameId: string, heroId: string) =>
    req<GameState>("POST", `/api/games/${gameId}/heroes/${heroId}/hide`, {}),

  escape: (gameId: string, heroId: string) =>
    req<GameState>("POST", `/api/games/${gameId}/heroes/${heroId}/escape`, {}),

  fireball: (gameId: string, heroId: string) =>
    req<{ report: FireballReport; game: GameState }>(
      "POST",
      `/api/games/${gameId}/heroes/${heroId}/fireball`,
      {},
    ),

  advance: (gameId: string) => req<GameState>("POST", `/api/games/${gameId}/advance`, {}),

  recipes: () => req<Recipe[]>("GET", "/api/recipes"),

  classes: () => req<ClassDef[]>("GET", "/api/classes"),

  evolve: (gameId: string, heroId: string, classId: string) =>
    req<GameState>("POST", `/api/games/${gameId}/heroes/${heroId}/evolve`, { classId }),

  townAction: (
    gameId: string,
    payload: {
      buildingId: string;
      action: "build" | "restore" | "use" | "water" | "toggle";
      points?: number;
      heroId?: string;
    },
  ) => req<GameState>("POST", `/api/games/${gameId}/town/action`, payload),

  townDeposit: (gameId: string) =>
    req<{ moved: number; game: GameState }>("POST", `/api/games/${gameId}/town/deposit`, {}),

  craft: (gameId: string, recipeId: string, heroId?: string) =>
    req<{ crafted: Item; game: GameState }>("POST", `/api/games/${gameId}/town/craft`, { recipeId, heroId }),

  startCombat: (gameId: string, heroId: string) =>
    req<CombatResponse>("POST", `/api/games/${gameId}/heroes/${heroId}/combat/start`, {}),

  getCombat: (gameId: string, combatId: string) =>
    req<CombatResponse>("GET", `/api/games/${gameId}/combat/${combatId}`),

  combatAction: (
    gameId: string,
    combatId: string,
    payload: { unitId: string; action: string; x?: number; y?: number; targetId?: string },
  ) => req<CombatResponse>("POST", `/api/games/${gameId}/combat/${combatId}/action`, payload),
};
