import type {
  ChatMessage,
  Chronicle,
  ClassDef,
  ItemEffect,
  ItemEffects,
  CombatResponse,
  GameState,
  GameSummary,
  WaveForecast,
  Item,
  LeaderboardMode,
  MapSkillDef,
  MapSkillReport,
  MyGameSummary,
  Player,
  Recipe,
  Ruin,
  ScoreEntry,
  SeasonList,
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
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // `fetch` rejette avec « Failed to fetch » (ou « Load failed » sur Safari) :
    // illisible, et en anglais dans une interface française. Ce cas-là est en
    // pratique toujours le même — plus de réseau, ou serveur injoignable.
    throw new Error("Connexion au serveur perdue — vérifie ta connexion.");
  }
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Réponse non-JSON (page d'erreur d'un proxy, 502 HTML…).
      if (!res.ok) throw new Error(`Le serveur a répondu ${res.status}.`);
    }
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Le serveur a répondu ${res.status}.`);
  }
  return data as T;
}

export const api = {
  createGame: (opts: { width?: number; height?: number; seed?: number } = {}) =>
    req<GameState>("POST", "/api/games", opts),

  getGame: (id: string) => req<GameState>("GET", `/api/games/${id}`),

  // --- lobby / multiplayer ---
  // "open" = ce qu'on peut REJOINDRE : les salons et les expéditions publiques encore
  // dans leur fenêtre d'accueil. "lobby" ne rend que les salons non lancés.
  listGames: (status?: "open" | "lobby" | "active" | "gameover") =>
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

  // Monter à la Tour estimer la vague : chaque JOUEUR qui le fait resserre la
  // fourchette pour toute la ville (backend orders.go ScoutWave).
  // Poser la consigne permanente d'un héros (orders_standing.go).
  setHeroOrder: (gameId: string, heroId: string, order: string, playerId?: string) =>
    req<GameState>("POST", `/api/games/${gameId}/heroes/${heroId}/order`, { order, playerId }),

  scoutWave: (gameId: string, heroId: string, playerId?: string) =>
    req<{ forecast: WaveForecast; game: GameState }>("POST", `/api/games/${gameId}/town/scout`, {
      heroId,
      playerId,
    }),
  postRequest: (gameId: string, playerId: string, item: string, qty: number) =>
    req<{ game: GameState }>("POST", `/api/games/${gameId}/town/request`, { playerId, item, qty }),
  cancelRequest: (gameId: string, playerId: string, cancel: string) =>
    req<{ game: GameState }>("POST", `/api/games/${gameId}/town/request`, { playerId, cancel }),
  fillRequest: (gameId: string, requestId: string, heroId: string, playerId?: string) =>
    req<{ game: GameState }>("POST", `/api/games/${gameId}/town/request/fill`, {
      requestId,
      heroId,
      playerId,
    }),

  myGames: () => req<MyGameSummary[]>("GET", "/api/auth/me/games"),

  // Ma chronique : mes expéditions, mes totaux, mes titres (cosmétiques).
  myChronicle: () => req<Chronicle>("GET", "/api/auth/me/chronicle"),

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

  // Boire une ration d'eau du sac pour restaurer des PA (carte).
  drinkRation: (gameId: string, heroId: string, playerId?: string) =>
    req<GameState>("POST", `/api/games/${gameId}/heroes/${heroId}/drink`, { playerId }),

  // Compétence de carte par classe (remplace fireball/snipe) — skillId du catalogue.
  castSkill: (gameId: string, heroId: string, skillId: string, playerId?: string) =>
    req<{ report: MapSkillReport; game: GameState }>(
      "POST",
      `/api/games/${gameId}/heroes/${heroId}/skill`,
      { skillId, playerId },
    ),

  ruinClear: (gameId: string, heroId: string, points: number, playerId?: string) =>
    req<{ ruin: Ruin; game: GameState }>(
      "POST",
      `/api/games/${gameId}/heroes/${heroId}/ruin/clear`,
      { points, playerId },
    ),
  ruinExplore: (gameId: string, heroId: string, playerId?: string) =>
    req<{ item: Item; game: GameState }>(
      "POST",
      `/api/games/${gameId}/heroes/${heroId}/ruin/explore`,
      { playerId },
    ),

  advance: (gameId: string, safe = false) =>
    req<GameState>("POST", `/api/games/${gameId}/advance`, { safe }),

  revealFog: (gameId: string, on: boolean) =>
    req<GameState>("POST", `/api/games/${gameId}/reveal`, { on }),

  recipes: () => req<Recipe[]>("GET", "/api/recipes"),

  classes: () => req<ClassDef[]>("GET", "/api/classes"),

  mapSkills: () => req<MapSkillDef[]>("GET", "/api/mapskills"),

  // Classement des villes. Sans mode, tout est classé ensemble ; avec, on ne
  // compare que les parties de même nature (solo / publiques / privées).
  // Le classement est SAISONNIER : sans `season` le serveur rend la saison EN COURS,
  // "all" rend le palmarès de tous les temps, un identifiant rend une saison passée.
  leaderboard: (mode?: LeaderboardMode, season?: string) => {
    const q = new URLSearchParams();
    if (mode) q.set("mode", mode);
    if (season) q.set("season", season);
    const qs = q.toString();
    return req<ScoreEntry[]>("GET", `/api/leaderboard${qs ? `?${qs}` : ""}`);
  },

  seasons: () => req<SeasonList>("GET", "/api/seasons"),

  // Le catalogue de ce qui se consomme, et l'action de consommer.
  items: () => req<ItemEffects>("GET", "/api/items"),
  useItem: (gameId: string, heroId: string, item: string, playerId?: string) =>
    req<{ effect: ItemEffect; game: GameState }>(
      "POST",
      `/api/games/${gameId}/heroes/${heroId}/use`,
      { item, playerId },
    ),

  evolve: (gameId: string, heroId: string, classId: string, playerId?: string) =>
    req<GameState>("POST", `/api/games/${gameId}/heroes/${heroId}/evolve`, { classId, playerId }),

  townAction: (
    gameId: string,
    payload: {
      buildingId: string;
      action: "build" | "restore" | "repair" | "use" | "water" | "toggle" | "revive" | "heal";
      points?: number;
      heroId?: string;
      playerId?: string;
    },
  ) => req<GameState>("POST", `/api/games/${gameId}/town/action`, payload),

  townDeposit: (gameId: string, playerId?: string) =>
    req<{ moved: number; game: GameState }>("POST", `/api/games/${gameId}/town/deposit`, { playerId }),

  // Messagerie de la ville. Route DÉDIÉE (pas le payload de partie) : la lecture
  // est gatée par joueur — un héros en ville, ou la Poste construite. Le GET
  // porte le playerId en query (un GET n'a pas de corps).
  townChat: (gameId: string, playerId?: string) =>
    req<{ messages: ChatMessage[]; poste: boolean }>(
      "GET",
      `/api/games/${gameId}/town/chat${playerId ? `?playerId=${encodeURIComponent(playerId)}` : ""}`,
    ),

  townChatSend: (gameId: string, text: string, playerId?: string) =>
    req<{ message: ChatMessage; messages: ChatMessage[]; poste: boolean }>(
      "POST",
      `/api/games/${gameId}/town/chat`,
      { text, playerId },
    ),

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

  // Multijoueur : rejoindre un combat où figurent MES héros (jusqu'ici joués par l'IA).
  joinCombat: (gameId: string, combatId: string, playerId?: string) =>
    req<CombatResponse>("POST", `/api/games/${gameId}/combat/${combatId}/join`, { playerId }),

  combatAction: (
    gameId: string,
    combatId: string,
    payload: {
      unitId: string;
      action: string;
      x?: number;
      y?: number;
      targetId?: string;
      skillIdx?: number; // action "skill" : quelle compétence iso
      item?: string; // action "item" (C3) : nom de l'objet du sac
      playerId?: string;
    },
  ) => req<CombatResponse>("POST", `/api/games/${gameId}/combat/${combatId}/action`, payload),
};
