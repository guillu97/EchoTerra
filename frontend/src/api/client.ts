import type {
  ClassDef,
  CombatResponse,
  FireballReport,
  GameState,
  GameSummary,
  Item,
  MyGameSummary,
  Player,
  Recipe,
  ScoreEntry,
  User,
} from "./types";

export interface JoinResponse {
  game: GameState;
  player: Player;
}

// Session token (user account). Kept in localStorage and sent as a Bearer header on
// every call — the server links players to accounts and enables multi-device resume.
const LS_TOKEN = "echoterra:authToken";

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(LS_TOKEN);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null) {
  try {
    if (token) localStorage.setItem(LS_TOKEN, token);
    else localStorage.removeItem(LS_TOKEN);
  } catch {
    /* ignore */
  }
}

// Relative base: Vite proxies /api to the Go backend during development.
async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
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

  // --- lobby / multiplayer ---
  listGames: (status?: "lobby" | "active" | "gameover") =>
    req<GameSummary[]>("GET", `/api/games${status ? `?status=${status}` : ""}`),

  createLobby: (opts: {
    name?: string;
    playerName: string;
    minPlayers?: number;
    maxPlayers?: number;
    width?: number;
    height?: number;
    seed?: number;
  }) => req<JoinResponse>("POST", "/api/games/lobby", opts),

  joinByCode: (code: string, playerName: string) =>
    req<JoinResponse>("POST", "/api/games/join", { code, playerName }),

  joinGame: (gameId: string, playerName: string) =>
    req<JoinResponse>("POST", `/api/games/${gameId}/join`, { playerName }),

  startGame: (gameId: string, playerId: string) =>
    req<GameState>("POST", `/api/games/${gameId}/start`, { playerId }),

  leaveGame: (gameId: string, playerId: string) =>
    req<{ left: boolean; deleted: boolean; game?: GameState }>(
      "POST",
      `/api/games/${gameId}/leave`,
      { playerId },
    ),

  // Private game: host kick (kicked=true immediately). Public game: registers an
  // expulsion vote — kicked flips once a majority of the other players agreed.
  kickPlayer: (gameId: string, playerId: string, targetId: string) =>
    req<{ game: GameState; kicked: boolean; votes?: number; needed?: number }>(
      "POST",
      `/api/games/${gameId}/kick`,
      { playerId, targetId },
    ),

  addBot: (gameId: string, playerId: string) =>
    req<JoinResponse>("POST", `/api/games/${gameId}/bots`, { playerId }),

  // One call for the menu's solo mode: private game with the player + 4 bots,
  // already launched.
  soloGame: (playerName: string) =>
    req<JoinResponse>("POST", "/api/games/solo", { playerName }),

  // --- user accounts (email+password et Google Sign-In; Apple = payant) ---
  // The server tells us at runtime whether Google is configured (empty = hidden).
  authConfig: () => req<{ googleClientId: string }>("GET", "/api/auth/config"),

  register: (email: string, name: string, password: string) =>
    req<{ user: User; token: string }>("POST", "/api/auth/register", { email, name, password }),

  login: (email: string, password: string) =>
    req<{ user: User; token: string }>("POST", "/api/auth/login", { email, password }),

  // credential = the ID token minted by Google Identity Services in the browser.
  loginGoogle: (credential: string) =>
    req<{ user: User; token: string }>("POST", "/api/auth/google", { credential }),

  logout: () => req<{ ok: boolean }>("POST", "/api/auth/logout", {}),

  me: () => req<{ user: User }>("GET", "/api/auth/me"),

  myGames: () => req<MyGameSummary[]>("GET", "/api/auth/me/games"),

  // Hero actions carry the acting player's id: multiplayer games enforce server-side
  // that a player only controls their OWN hero (legacy solo games ignore it).
  move: (gameId: string, heroId: string, dx: number, dy: number, playerId?: string) =>
    req<GameState>("POST", `/api/games/${gameId}/heroes/${heroId}/move`, { DX: dx, DY: dy, playerId }),

  search: (gameId: string, heroId: string, playerId?: string) =>
    req<{ loot: Item; game: GameState }>(
      "POST",
      `/api/games/${gameId}/heroes/${heroId}/search`,
      { playerId },
    ),

  hide: (gameId: string, heroId: string, playerId?: string) =>
    req<GameState>("POST", `/api/games/${gameId}/heroes/${heroId}/hide`, { playerId }),

  escape: (gameId: string, heroId: string, playerId?: string) =>
    req<GameState>("POST", `/api/games/${gameId}/heroes/${heroId}/escape`, { playerId }),

  fireball: (gameId: string, heroId: string, playerId?: string) =>
    req<{ report: FireballReport; game: GameState }>(
      "POST",
      `/api/games/${gameId}/heroes/${heroId}/fireball`,
      { playerId },
    ),

  advance: (gameId: string) => req<GameState>("POST", `/api/games/${gameId}/advance`, {}),

  recipes: () => req<Recipe[]>("GET", "/api/recipes"),

  classes: () => req<ClassDef[]>("GET", "/api/classes"),

  leaderboard: () => req<ScoreEntry[]>("GET", "/api/leaderboard"),

  evolve: (gameId: string, heroId: string, classId: string, playerId?: string) =>
    req<GameState>("POST", `/api/games/${gameId}/heroes/${heroId}/evolve`, { classId, playerId }),

  townAction: (
    gameId: string,
    payload: {
      buildingId: string;
      action: "build" | "restore" | "use" | "water" | "toggle";
      points?: number;
      heroId?: string;
      playerId?: string;
    },
  ) => req<GameState>("POST", `/api/games/${gameId}/town/action`, payload),

  townDeposit: (gameId: string, playerId?: string) =>
    req<{ moved: number; game: GameState }>("POST", `/api/games/${gameId}/town/deposit`, { playerId }),

  craft: (gameId: string, recipeId: string, heroId?: string, playerId?: string) =>
    req<{ crafted: Item; game: GameState }>("POST", `/api/games/${gameId}/town/craft`, {
      recipeId,
      heroId,
      playerId,
    }),

  startCombat: (gameId: string, heroId: string, playerId?: string) =>
    req<CombatResponse>("POST", `/api/games/${gameId}/heroes/${heroId}/combat/start`, { playerId }),

  getCombat: (gameId: string, combatId: string) =>
    req<CombatResponse>("GET", `/api/games/${gameId}/combat/${combatId}`),

  combatAction: (
    gameId: string,
    combatId: string,
    payload: {
      unitId: string;
      action: string;
      x?: number;
      y?: number;
      targetId?: string;
      playerId?: string;
    },
  ) => req<CombatResponse>("POST", `/api/games/${gameId}/combat/${combatId}/action`, payload),
};
