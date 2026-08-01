import { create } from "zustand";
import { api, getAuthToken, setAuthToken } from "./api/client";
import type {
  ClassDef,
  CombatCurrent,
  CombatThreat,
  Combat,
  GameState,
  GameSummary,
  MapSkillDef,
  MyGameSummary,
  Recipe,
  User,
} from "./api/types";
import { bus, EV } from "./eventBus";
import { effectiveTownHeroId } from "./townUtils";
import { myActiveCombat } from "./combatUtils";

const LS_GAME = "echoterra:gameId"; // dernière partie active (pointeur générique)
const LS_SETTINGS = "echoterra:settings";
const LS_PLAYER_NAME = "echoterra:playerName";
// Per-game player identity: which player *I* am in that game (multiplayer lobby flow).
const lsPlayerKey = (gameId: string) => `echoterra:player:${gameId}`;

// Deux « créneaux » de partie en cours, indépendants : le joueur peut être dans
// UNE partie solo ET UNE partie publique/privée en même temps (mais pas deux
// publiques/privées). Le menu affiche un bouton « Reprendre » par créneau occupé.
export type GameSlot = "solo" | "mp";
const LS_SLOT: Record<GameSlot, string> = {
  solo: "echoterra:game:solo",
  mp: "echoterra:game:mp",
};
function rememberSlot(gameId: string, slot: GameSlot) {
  try {
    localStorage.setItem(LS_SLOT[slot], gameId);
    const other: GameSlot = slot === "solo" ? "mp" : "solo";
    if (localStorage.getItem(LS_SLOT[other]) === gameId) localStorage.removeItem(LS_SLOT[other]);
  } catch {
    /* ignore */
  }
}
// Id de la partie mémorisée dans un créneau (le menu lit ça pour décider quels
// boutons « Reprendre » afficher). Null si le créneau est vide.
export function slotGameId(slot: GameSlot): string | null {
  try {
    return localStorage.getItem(LS_SLOT[slot]);
  } catch {
    return null;
  }
}
// Oublie une partie de TOUS les créneaux (quittée, expulsée, terminée).
function forgetGameSlots(gameId: string) {
  try {
    (Object.keys(LS_SLOT) as GameSlot[]).forEach((s) => {
      if (localStorage.getItem(LS_SLOT[s]) === gameId) localStorage.removeItem(LS_SLOT[s]);
    });
    if (localStorage.getItem(LS_GAME) === gameId) localStorage.removeItem(LS_GAME);
  } catch {
    /* ignore */
  }
}
// Catégorise une partie : publique OU privée avec ≥2 humains = créneau « mp » ;
// sinon (solo, test rapide, privée pas encore rejointe) = créneau « solo ».
function slotForGame(g: { visibility?: string; players?: { bot: boolean }[] }): GameSlot {
  if (g.visibility === "public") return "mp";
  const humans = (g.players ?? []).filter((p) => !p.bot).length;
  return humans >= 2 ? "mp" : "solo";
}

// Toasts : un message éphémère, empilable, annoncé aux lecteurs d'écran.
export type ToastTone = "info" | "ok" | "warn" | "error";
export type Toast = { id: number; msg: string; tone: ToastTone };
const TOAST_MS = 4000;

type View = "map" | "combat";
type CombatMode = "move" | "attack" | "skill" | "push";

export type AppScreen = "loading" | "title" | "cinematic" | "game" | "editor" | "designer" | "voxelbench" | "voxeledit" | "charstudio" | "lobby" | "account";
export type Tab = "home" | "map" | "stock" | "structure" | "craft";
export type SettingsScreen = "menu" | "setting" | "language" | "notifications";

export interface Settings {
  music: number;
  sfx: number;
  fps: 30 | 60 | 120;
  quality: "Normal" | "Medium" | "High" | "Very high";
  language: string;
  notif: { loot: boolean; wave: boolean; actionPoint: boolean; communication: boolean };
  voxelSmooth: boolean; // carte : terrain CONTINU lissé (true) ou blocs discrets (false)
  voxelBeauty: boolean; // passe beauté Tier 1 : tone mapping ACES + bloom + ciel/brume (mode CINÉMATIQUE)
  /** Rendu divisionniste « Signac » (voir voxel/signacPass.ts). S'appuie sur la passe beauté. */
  voxelSignac: boolean;
  /** Dosage de la passe Signac, 0..1. */
  signacStrength: number;
  renderPreset?: number; // marqueur de migration des défauts de rendu (voir RENDER_PRESET)
}

// Bump pour (re)forcer UNE FOIS les défauts de rendu — voxel + cinématique max —
// même sur les installs qui avaient déjà des réglages sauvegardés.
const RENDER_PRESET = 1;

const DEFAULT_SETTINGS: Settings = {
  music: 80,
  sfx: 80,
  fps: 60,
  quality: "Very high", // rendu maximum par défaut
  language: "Français",
  notif: { loot: true, wave: true, actionPoint: true, communication: false },
  voxelSmooth: true,
  voxelBeauty: true, // mode CINÉMATIQUE (bloom + ACES) activé par défaut — décision utilisateur 2026-07-22
  voxelSignac: false, // opt-in : c'est un parti pris pictural fort, pas un défaut
  signacStrength: 0.6,
  renderPreset: RENDER_PRESET,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      let s: Settings = { ...DEFAULT_SETTINGS, ...saved };
      // migration UNIQUE : bascule voxel + rendu cinématique max sur les réglages
      // déjà sauvegardés (persistée pour ne pas réécraser un opt-out ultérieur).
      if (saved.renderPreset !== RENDER_PRESET) {
        s = { ...s, voxelSmooth: true, voxelBeauty: true, quality: "Very high", renderPreset: RENDER_PRESET };
        try { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); } catch { /* ignore */ }
      }
      return s;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

interface StoreState {
  // --- app shell ---
  appScreen: AppScreen;
  tab: Tab;
  settingsScreen: SettingsScreen | null;
  settings: Settings;
  heroOverlay?: string; // hero id whose character screen is open
  townStatusOpen: boolean; // town status panel overlay
  townJournalOpen: boolean; // town journal overlay (Panel building)
  cheatOpen: boolean;
  townHeroId?: string; // preferred hero paying for town work
  recipes: Recipe[];
  classes: ClassDef[];
  mapSkills: MapSkillDef[]; // catalogue des compétences de carte par classe

  // --- lobby / multiplayer ---
  playerId?: string; // my player id in the current game (undefined in legacy solo games)
  playerName: string; // persisted display name
  lobbies: GameSummary[]; // open lobbies (join screen)
  lobbyMode: "public" | "private"; // which lobby entry the menu opened
  showOthers: boolean; // map: other players' heroes (translucent sprites) — ON by default

  // --- user account ---
  user?: User; // logged-in account (undefined = anonymous, always allowed)
  myGames: MyGameSummary[]; // account screen: games I can resume from any device

  // --- game / map / combat ---
  game?: GameState;
  combat?: Combat;
  current?: CombatCurrent;
  combatThreats: CombatThreat[]; // cases menacées par ennemi (télégraphie C2)
  threatUnitId?: string; // ennemi dont on affiche la menace (tap sur l'unité)
  view: View;
  combatMode: CombatMode;
  combatSkillIdx: number; // compétence iso armée quand combatMode === "skill"
  selectedHeroId?: string;
  log: string[];
  busy: boolean;
  error?: string;
  toasts: Toast[];

  // shell actions
  setScreen: (s: AppScreen) => void;
  setTab: (t: Tab) => void;
  openSettings: (s: SettingsScreen) => void;
  closeSettings: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  openHero: (id: string) => void;
  closeHero: () => void;
  toggleTownStatus: (open?: boolean) => void;
  toggleTownJournal: (open?: boolean) => void;
  toggleCheat: () => void;
  startTestGame: () => Promise<void>;
  continueTestGame: () => Promise<void>;
  // lobby actions
  openLobby: (mode?: "public" | "private") => void;
  toggleOthers: () => void; // map: show/hide other players' heroes
  myHeroes: () => string[]; // my team's hero ids ([] in legacy solo)
  // account actions
  openAccount: () => void;
  registerAccount: (email: string, name: string, password: string) => Promise<void>;
  loginAccount: (email: string, password: string) => Promise<void>;
  loginGoogleAccount: (credential: string) => Promise<void>;
  logoutAccount: () => Promise<void>;
  fetchMyGames: () => Promise<void>;
  resumeGame: (g: MyGameSummary) => Promise<void>;
  resumeSlot: (slot: GameSlot) => Promise<void>; // menu: reprendre la partie d'un créneau
  setPlayerName: (name: string) => void;
  fetchLobbies: () => Promise<void>;
  createLobby: (opts: { name?: string; minPlayers: number; maxPlayers: number }) => Promise<void>;
  joinLobby: (code: string) => Promise<void>;
  startLobby: () => Promise<void>;
  refreshLobby: () => Promise<void>;
  leaveLobby: () => Promise<void>;
  kickFromLobby: (targetId: string) => Promise<void>;
  addBot: () => Promise<void>;
  startSoloBots: () => Promise<void>; // menu: private game with me + 4 bots, launched
  townAction: (
    buildingId: string,
    action: "build" | "restore" | "use" | "water" | "toggle" | "revive",
    points?: number,
  ) => Promise<void>;
  setTownHero: (id: string) => void;
  townDeposit: () => Promise<void>;
  craft: (recipeId: string) => Promise<void>;
  evolve: (classId: string) => Promise<void>;
  startAdventure: () => void; // Title "Start the game" -> cinematic
  enterGame: () => Promise<void>; // cinematic skip -> game home
  leaveTown: () => void; // settings -> back to title
  syncScene: () => void; // re-push current view to Phaser (on Map tab mount)
  refreshGame: () => Promise<void>; // silent refetch (wave polling / countdown reaching 0)

  // game actions
  newGame: () => Promise<void>;
  loadGame: (id: string) => Promise<void>;
  selectHero: (id: string) => void;
  focusHero: (id: string) => void; // sélectionne un héros ET recentre la caméra dessus
  move: (dx: number, dy: number) => Promise<void>;
  search: () => Promise<void>;
  hide: () => Promise<void>;
  escape: () => Promise<void>;
  castSkill: (skillId: string) => Promise<void>; // compétence de carte par classe
  drinkRation: () => Promise<void>; // boire une ration d'eau (+6 PA) du sac
  ruinClear: () => Promise<void>; // déblayer la ruine sous le héros (tous ses PA)
  ruinExplore: () => Promise<void>; // fouiller le donjon déblayé (2 PA)
  advance: (safe?: boolean) => Promise<void>;
  skipDay: () => Promise<void>;
  revealFog: (on: boolean) => Promise<void>;
  startCombat: () => Promise<void>;
  setCombatMode: (m: CombatMode) => void;
  selectCombatSkill: (idx: number) => void; // arme (ou lance si sur soi) une compétence iso
  combatTileClick: (x: number, y: number) => Promise<void>;
  combatUnitClick: (unitId: string) => Promise<void>;
  toggleThreat: (unitId: string) => void; // afficher/masquer les cases menacées d'un ennemi
  joinCombat: () => Promise<void>; // multijoueur : reprendre le contrôle de MES héros
  refreshCombat: () => Promise<void>; // poll du combat multijoueur (tours des autres)
  combatDefend: () => Promise<void>; // 🛡️ -50% subis jusqu'au prochain tour (C3)
  combatFlee: () => Promise<void>; // 🏃 fuir depuis le bord bas (C3)
  combatUseItem: (name: string) => Promise<void>; // 🧪 consommer un objet du sac (C3)
  endTurn: () => Promise<void>;
  returnToMap: () => void;
  pushLog: (msg: string) => void;
  notify: (msg: string, tone?: ToastTone) => void;
  dismissToast: (id: number) => void;
}

export const useStore = create<StoreState>((set, get) => {
  const pushLog = (msg: string) => set((s) => ({ log: [...s.log.slice(-40), msg] }));

  // File de toasts. Avant, un échec d'action posait `error` (une seule chaîne,
  // écrasée par l'action suivante) et `pushLog` écrivait dans un tableau que
  // AUCUN composant ne rendait : le retour utilisateur partait à la poubelle.
  let toastSeq = 0;
  const notify = (msg: string, tone: ToastTone = "info") => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, msg, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), TOAST_MS);
  };

  const renderMap = () => {
    const { game, selectedHeroId, showOthers, playerId } = get();
    const myHeroIds = game?.players?.find((p) => p.id === playerId)?.heroIds ?? [];
    bus.emit(EV.ShowScene, "map");
    bus.emit(EV.MapRender, { game, selectedHeroId, myHeroIds, showOthers });
  };

  const renderCombat = () => {
    const { combat, current, combatMode, combatSkillIdx, combatThreats, threatUnitId } = get();
    bus.emit(EV.ShowScene, "combat");
    bus.emit(EV.CombatRender, {
      combat,
      current,
      mode: combatMode,
      skillIdx: combatSkillIdx,
      threats: combatThreats,
      threatUnitId,
    });
  };

  const applyCombat = (resp: {
    combat: Combat;
    game: GameState;
    current?: CombatCurrent;
    threats?: CombatThreat[];
  }) => {
    // L'ennemi télégraphié peut être mort après ce lot d'actions — on nettoie.
    const threats = resp.threats ?? [];
    const keepThreat = threats.some((t) => t.unitId === get().threatUnitId);
    set({
      combat: resp.combat,
      current: resp.current,
      game: resp.game,
      combatThreats: threats,
      threatUnitId: keepThreat ? get().threatUnitId : undefined,
    });
    resp.combat.log.slice(-3).forEach((l) => pushLog(l));
    if (resp.combat.status !== "active") {
      pushLog(
        resp.combat.status === "won"
          ? "🏆 Victoire !"
          : resp.combat.status === "fled"
            ? "🏃 L'équipe s'est repliée."
            : "💀 Défaite…",
      );
      set({ combatMode: "move" });
    }
    renderCombat();
  };

  const withBusy = async (fn: () => Promise<void>) => {
    set({ busy: true, error: undefined });
    try {
      await fn();
    } catch (e: any) {
      set({ error: e.message });
      pushLog("⚠️ " + e.message);
      notify(e.message, "error");
    } finally {
      set({ busy: false });
    }
  };

  const loadCatalogs = async () => {
    if (get().recipes.length === 0) try { set({ recipes: await api.recipes() }); } catch { /* non-critical */ }
    if (get().classes.length === 0) try { set({ classes: await api.classes() }); } catch { /* non-critical */ }
    if (get().mapSkills.length === 0) try { set({ mapSkills: await api.mapSkills() }); } catch { /* non-critical */ }
  };

  // Adopt a (re)loaded game: remember it + my player identity, select my own hero.
  const adoptGame = (game: GameState, playerId?: string, slot?: GameSlot) => {
    localStorage.setItem(LS_GAME, game.id);
    rememberSlot(game.id, slot ?? slotForGame(game));
    if (playerId) localStorage.setItem(lsPlayerKey(game.id), playerId);
    const pid = playerId ?? localStorage.getItem(lsPlayerKey(game.id)) ?? undefined;
    const myFirstHero = game.players?.find((p) => p.id === pid)?.heroIds?.[0];
    // Reprise EN COMBAT : si un de mes héros est engagé dans un combat actif
    // (j'ai quitté le site en plein combat), on rentre DIRECT dans l'arène au lieu
    // d'atterrir sur la carte sans moyen d'y retourner.
    const mine = myActiveCombat(game, pid);
    set({
      game,
      playerId: pid,
      view: mine ? "combat" : "map",
      combat: mine, // affiche l'arène tout de suite depuis le payload
      current: undefined, // le tour courant est récupéré par le rejoin ci-dessous
      combatMode: "move",
      combatSkillIdx: 0,
      selectedHeroId: myFirstHero ?? game.heroes[0]?.id,
    });
    if (mine) {
      // multi : (ré)enregistre ma présence (JoinCombat idempotent) ; solo legacy
      // (sans playerId) : lit juste le combat pour récupérer le tour courant.
      const fetch = pid ? api.joinCombat(game.id, mine.id, pid) : api.getCombat(game.id, mine.id);
      void fetch.then(applyCombat).catch(() => {
        /* le bouton « Rejoindre le combat » de la carte reste un filet de sécurité */
      });
    }
  };

  const enterActiveGame = async () => {
    await loadCatalogs();
    // reprise EN COMBAT (adoptGame a posé view:"combat") → onglet Map (l'arène y
    // vit) ; sinon onglet Home par défaut.
    const inCombat = get().view === "combat" && !!get().combat;
    set({ appScreen: "game", tab: inCombat ? "map" : "home", settingsScreen: null });
  };

  // My team's hero ids in a multiplayer game (empty in legacy solo games).
  const myHeroIds = () => {
    const { game, playerId } = get();
    return game?.players?.find((p) => p.id === playerId)?.heroIds ?? [];
  };

  // In multiplayer, map/hero actions are limited to MY team (the server enforces it
  // too — this guard just gives instant feedback instead of a request round-trip).
  const ownsHero = (heroId?: string) => {
    const { game } = get();
    if (!game || !game.players?.length) return true; // legacy solo: control everyone
    if (heroId && myHeroIds().includes(heroId)) return true;
    pushLog("⚠️ Ce héros appartient à un autre joueur.");
    return false;
  };

  // The town worker paying PA: one of MY in-town heroes (the chosen one when it's
  // mine) — effectiveTownHeroId is ownership-aware, legacy solo included.
  const townWorkerId = () => {
    const { game, playerId, townHeroId } = get();
    return effectiveTownHeroId(game, playerId, townHeroId);
  };

  return {
    appScreen: "loading",
    tab: "home",
    settingsScreen: null,
    settings: loadSettings(),
    townStatusOpen: false,
    townJournalOpen: false,
    cheatOpen: false,
    recipes: [],
    classes: [],
    mapSkills: [],
    playerName: localStorage.getItem(LS_PLAYER_NAME) ?? "",
    lobbies: [],
    lobbyMode: "public" as const,
    showOthers: true,
    myGames: [],

    view: "map",
    combatMode: "move",
    combatSkillIdx: 0,
    combatThreats: [],
    log: [],
    busy: false,
    toasts: [],

    pushLog,
    notify,
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    setScreen: (s) => set({ appScreen: s }),
    setTab: (t) => {
      const g = get().game;
      const townTab = t === "home";
      if (townTab && g) {
        const inTown = g.heroes.some((h) => h.hp > 0 && h.x === g.town.x && h.y === g.town.y);
        if (!inTown) {
          get().pushLog("🏙️ Aucun héros dans la ville — onglet indisponible.");
          return;
        }
      }
      set({ tab: t });
      if (t === "map") setTimeout(() => get().syncScene(), 0);
    },

    openHero: (id) => set({ heroOverlay: id }),
    closeHero: () => set({ heroOverlay: undefined }),
    toggleTownStatus: (open) =>
      set((s) => ({ townStatusOpen: open === undefined ? !s.townStatusOpen : open })),
    toggleTownJournal: (open) =>
      set((s) => ({ townJournalOpen: open === undefined ? !s.townJournalOpen : open })),
    toggleCheat: () => set((s) => ({ cheatOpen: !s.cheatOpen })),
    startTestGame: () =>
      withBusy(async () => {
        const game = await api.createGame({ width: 22, height: 22 });
        localStorage.setItem(LS_GAME, game.id);
        rememberSlot(game.id, "solo");
        set({ game, view: "map", selectedHeroId: game.heroes[0]?.id, combat: undefined, current: undefined, playerId: undefined });
        pushLog(`Nouvelle partie — jour ${game.day}. La ville est à (${game.town.x}, ${game.town.y}).`);
        await enterActiveGame();
      }),

    continueTestGame: () =>
      withBusy(async () => {
        const saved = localStorage.getItem(LS_GAME);
        if (saved) {
          try {
            const game = await api.getGame(saved);
            adoptGame(game);
            if (game.status === "lobby") {
              // The saved game is still a waiting room: resume there instead.
              set({ appScreen: "lobby" });
              pushLog(`🎪 Retour au salon "${game.name}" (code ${game.joinCode}).`);
              return;
            }
            pushLog(`Partie reprise — jour ${game.day}, vague ${game.waveNumber}.`);
          } catch {
            localStorage.removeItem(LS_GAME);
            const game = await api.createGame({ width: 22, height: 22 });
            localStorage.setItem(LS_GAME, game.id);
            set({ game, view: "map", selectedHeroId: game.heroes[0]?.id, combat: undefined, current: undefined, playerId: undefined });
            pushLog("⚠️ Partie introuvable — nouvelle partie créée.");
          }
        } else {
          const game = await api.createGame({ width: 22, height: 22 });
          localStorage.setItem(LS_GAME, game.id);
          rememberSlot(game.id, "solo");
          set({ game, view: "map", selectedHeroId: game.heroes[0]?.id, combat: undefined, current: undefined, playerId: undefined });
          pushLog("Aucune partie sauvegardée — nouvelle partie créée.");
        }
        await enterActiveGame();
      }),

    // --- lobby / multiplayer -------------------------------------------------
    openLobby: (mode) => set({ appScreen: "lobby", lobbyMode: mode ?? "public", error: undefined }),

    toggleOthers: () => {
      set((s) => ({ showOthers: !s.showOthers }));
      if (get().view === "map") renderMap();
    },

    myHeroes: () => myHeroIds(),

    // --- user account ---------------------------------------------------------
    openAccount: () => set({ appScreen: "account", error: undefined }),

    registerAccount: (email, name, password) =>
      withBusy(async () => {
        const res = await api.register(email, name, password);
        setAuthToken(res.token);
        set({ user: res.user });
        get().setPlayerName(res.user.name);
        pushLog(`👤 Compte créé — bienvenue ${res.user.name} !`);
        await get().fetchMyGames();
      }),

    loginAccount: (email, password) =>
      withBusy(async () => {
        const res = await api.login(email, password);
        setAuthToken(res.token);
        set({ user: res.user });
        get().setPlayerName(res.user.name);
        pushLog(`👤 Connecté : ${res.user.name}.`);
        await get().fetchMyGames();
      }),

    loginGoogleAccount: (credential) =>
      withBusy(async () => {
        const res = await api.loginGoogle(credential);
        setAuthToken(res.token);
        set({ user: res.user });
        get().setPlayerName(res.user.name);
        pushLog(`👤 Connecté avec Google : ${res.user.name}.`);
        await get().fetchMyGames();
      }),

    logoutAccount: () =>
      withBusy(async () => {
        try {
          await api.logout();
        } catch {
          /* the token dies anyway */
        }
        setAuthToken(null);
        set({ user: undefined, myGames: [] });
        pushLog("👋 Déconnecté.");
      }),

    fetchMyGames: async () => {
      if (!get().user) return;
      try {
        set({ myGames: await api.myGames() });
      } catch {
        /* best-effort */
      }
    },

    // Resume one of MY games from any device: the server knows my player id.
    resumeGame: (g) =>
      withBusy(async () => {
        const game = await api.getGame(g.id);
        localStorage.setItem(lsPlayerKey(game.id), g.myPlayerId);
        adoptGame(game, g.myPlayerId);
        if (game.status === "lobby") {
          set({ appScreen: "lobby" });
          pushLog(`🎪 Retour au salon "${game.name}".`);
          return;
        }
        pushLog(`▶ Partie "${game.name || "sans nom"}" reprise — jour ${game.day}.`);
        await enterActiveGame();
      }),

    // Reprend la partie mémorisée dans un créneau (solo ou publique/privée). Le
    // menu n'affiche le bouton que si le créneau pointe une partie vivante.
    resumeSlot: (slot) =>
      withBusy(async () => {
        const id = localStorage.getItem(LS_SLOT[slot]);
        if (!id) return;
        try {
          const game = await api.getGame(id);
          if (game.status === "gameover") {
            localStorage.removeItem(LS_SLOT[slot]);
            pushLog("🪦 Cette partie est terminée.");
            return;
          }
          const pid = localStorage.getItem(lsPlayerKey(id)) ?? undefined;
          adoptGame(game, pid, slot);
          if (game.status === "lobby") {
            set({ appScreen: "lobby" });
            pushLog(`🎪 Retour au salon "${game.name}"${game.joinCode ? ` (code ${game.joinCode})` : ""}.`);
            return;
          }
          pushLog(`▶ Partie "${game.name || "Expédition"}" reprise — jour ${game.day}.`);
          await enterActiveGame();
        } catch {
          localStorage.removeItem(LS_SLOT[slot]);
          pushLog("⚠️ Partie introuvable — le créneau a été vidé.");
        }
      }),

    setPlayerName: (name) => {
      try {
        localStorage.setItem(LS_PLAYER_NAME, name);
      } catch {
        /* ignore */
      }
      set({ playerName: name });
    },

    fetchLobbies: async () => {
      try {
        set({ lobbies: await api.listGames("lobby") });
      } catch {
        /* listing is best-effort */
      }
    },

    createLobby: (opts) =>
      withBusy(async () => {
        const playerName = get().playerName.trim() || "Aventurier";
        const res = await api.createLobby({ ...opts, playerName, width: 22, height: 22 });
        adoptGame(res.game, res.player.id, "mp");
        pushLog(`🎪 Partie "${res.game.name}" créée — code ${res.game.joinCode}.`);
      }),

    joinLobby: (code) =>
      withBusy(async () => {
        const playerName = get().playerName.trim() || "Aventurier";
        const res = await api.joinByCode(code, playerName);
        adoptGame(res.game, res.player.id, "mp");
        pushLog(`🤝 Partie "${res.game.name}" rejointe (${res.game.players.length}/${res.game.maxPlayers} joueurs).`);
        // Joining a public game as its Nth player can trigger the auto-start:
        // in that case skip the waiting room entirely.
        if (res.game.status !== "lobby") {
          pushLog("⚔️ La partie démarre !");
          await enterActiveGame();
        }
      }),

    startLobby: () =>
      withBusy(async () => {
        const { game, playerId } = get();
        if (!game || !playerId) return;
        const next = await api.startGame(game.id, playerId);
        adoptGame(next);
        pushLog(`⚔️ La partie commence — jour ${next.day} !`);
        await enterActiveGame();
      }),

    refreshLobby: async () => {
      const { game, appScreen, playerId } = get();
      if (!game || appScreen !== "lobby") return;
      try {
        const next = await api.getGame(game.id);
        // Kicked (or identity lost) while waiting: back to the title screen.
        if (playerId && next.players?.length && !next.players.some((p) => p.id === playerId)) {
          localStorage.removeItem(lsPlayerKey(game.id));
          forgetGameSlots(game.id);
          set({ appScreen: "title", game: undefined, playerId: undefined });
          pushLog("🚪 Tu as été retiré du salon.");
          return;
        }
        adoptGame(next);
        if (next.status !== "lobby") {
          pushLog("⚔️ La partie démarre !");
          await enterActiveGame();
        }
      } catch {
        /* polling is best-effort */
      }
    },

    kickFromLobby: (targetId) =>
      withBusy(async () => {
        const { game, playerId } = get();
        if (!game || !playerId) return;
        const res = await api.kickPlayer(game.id, playerId, targetId);
        adoptGame(res.game);
        if (res.kicked) {
          pushLog("🚪 Joueur expulsé du salon.");
        } else {
          pushLog(`🗳️ Vote enregistré (${res.votes}/${res.needed} pour expulser).`);
        }
      }),

    startSoloBots: () =>
      withBusy(async () => {
        const playerName = get().playerName.trim() || "Aventurier";
        const res = await api.soloGame(playerName);
        adoptGame(res.game, res.player.id, "solo");
        pushLog(`🤖 Partie solo lancée : toi + 4 bots (${res.game.heroes.length} héros).`);
        await enterActiveGame();
      }),

    addBot: () =>
      withBusy(async () => {
        const { game, playerId } = get();
        if (!game || !playerId) return;
        const res = await api.addBot(game.id, playerId);
        adoptGame(res.game);
        pushLog(`🤖 ${res.player.name} rejoint la partie (bot).`);
      }),

    leaveLobby: () =>
      withBusy(async () => {
        const { game, playerId } = get();
        // Really leave the salon server-side (frees the slot; an emptied lobby is deleted).
        if (game && playerId && game.status === "lobby") {
          try {
            await api.leaveGame(game.id, playerId);
            localStorage.removeItem(lsPlayerKey(game.id));
            forgetGameSlots(game.id);
            pushLog("👋 Salon quitté.");
          } catch {
            /* leaving is best-effort — still return to the title screen */
          }
        }
        set({ appScreen: "title", game: undefined, playerId: undefined });
      }),

    townAction: (buildingId, action, points) =>
      withBusy(async () => {
        const { game, playerId } = get();
        if (!game) return;
        const heroId = townWorkerId();
        const next = await api.townAction(game.id, { buildingId, action, points, heroId, playerId });
        set({ game: next });
        renderMap();
      }),

    setTownHero: (id) => set({ townHeroId: id }),

    townDeposit: () =>
      withBusy(async () => {
        const { game, playerId } = get();
        if (!game) return;
        const res = await api.townDeposit(game.id, playerId);
        set({ game: res.game });
        pushLog(`📦 ${res.moved} objet(s) déposé(s) dans la Banque.`);
        renderMap();
      }),

    craft: (recipeId) =>
      withBusy(async () => {
        const { game, selectedHeroId, playerId } = get();
        if (!game) return;
        const inTown = game.heroes.some((h) => h.hp > 0 && h.x === game.town.x && h.y === game.town.y);
        // In town: the town worker crafts from the Maison (in multiplayer, always MY
        // hero). In the field: the selected hero crafts from their own bag.
        const heroId = inTown ? townWorkerId() : selectedHeroId;
        if (!inTown && !ownsHero(heroId)) return;
        const res = await api.craft(game.id, recipeId, heroId, playerId);
        set({ game: res.game });
        pushLog(
          inTown
            ? `⚒️ Fabriqué : ${res.crafted.name} → rangé dans la Banque.`
            : `⚒️ Fabriqué sur le terrain : ${res.crafted.name} → sac du héros.`,
        );
        renderMap();
      }),
    evolve: (classId) =>
      withBusy(async () => {
        const { game, heroOverlay, playerId } = get();
        if (!game || !heroOverlay) return;
        if (!ownsHero(heroOverlay)) return;
        const hero = game.heroes.find((h) => h.id === heroOverlay);
        const next = await api.evolve(game.id, heroOverlay, classId, playerId);
        const evolved = next.heroes.find((h) => h.id === heroOverlay);
        set({ game: next });
        pushLog(`✨ ${hero?.name ?? "Le héros"} évolue en ${evolved?.class ?? classId} !`);
        renderMap();
      }),

    openSettings: (s) => set({ settingsScreen: s }),
    closeSettings: () => set({ settingsScreen: null }),
    updateSettings: (patch) =>
      set((s) => {
        const next = { ...s.settings, ...patch };
        try {
          localStorage.setItem(LS_SETTINGS, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return { settings: next };
      }),

    startAdventure: () => set({ appScreen: "cinematic" }),

    enterGame: () =>
      withBusy(async () => {
        if (!get().game) {
          const saved = localStorage.getItem(LS_GAME);
          if (saved) {
            try {
              const game = await api.getGame(saved);
              adoptGame(game);
            } catch {
              localStorage.removeItem(LS_GAME);
            }
          }
          if (!get().game) await get().newGame();
        }
        if (get().game?.status === "lobby") {
          // A lobby cannot be played yet — go to the waiting room instead.
          set({ appScreen: "lobby" });
          return;
        }
        await enterActiveGame();
      }),

    leaveTown: () => set({ appScreen: "title", settingsScreen: null }),

    syncScene: () => {
      const { view } = get();
      if (view === "combat") renderCombat();
      else renderMap();
    },

    newGame: () =>
      withBusy(async () => {
        const game = await api.createGame({ width: 22, height: 22 });
        localStorage.setItem(LS_GAME, game.id);
        set({
          game,
          view: "map",
          selectedHeroId: game.heroes[0]?.id,
          combat: undefined,
          current: undefined,
          playerId: undefined,
        });
        void loadCatalogs(); // recettes / classes / compétences de carte
        pushLog(`Nouvelle partie — jour ${game.day}. La ville est à (${game.town.x}, ${game.town.y}).`);
      }),

    loadGame: (id: string) =>
      withBusy(async () => {
        const game = await api.getGame(id);
        set({ game, view: "map", selectedHeroId: game.heroes[0]?.id });
      }),

    selectHero: (id: string) => {
      // In multiplayer only MY heroes are selectable (others are mere map markers).
      const { game } = get();
      if (game?.players?.length && !myHeroIds().includes(id)) return;
      set({ selectedHeroId: id });
      renderMap();
    },

    // Select a hero and pan the map camera onto it. Used by the map hero bar so
    // the player immediately SEES who they picked — for an in-town hero the pan
    // lands on the town and its yellow exit diamonds, making "who leaves town"
    // one tap. Camera centering is deliberately NOT in selectHero (map taps
    // select a hero that is already on screen — panning then would be jarring).
    focusHero: (id: string) => {
      const { game } = get();
      if (game?.players?.length && !myHeroIds().includes(id)) return;
      const h = game?.heroes.find((x) => x.id === id);
      if (!h || h.hp <= 0) return;
      set({ selectedHeroId: id });
      renderMap();
      bus.emit(EV.MapFocusHero, { x: h.x, y: h.y });
    },

    move: (dx, dy) =>
      withBusy(async () => {
        const { game, selectedHeroId, playerId } = get();
        if (!game || !selectedHeroId) return;
        if (!ownsHero(selectedHeroId)) return;
        const before = game.heroes.find((h) => h.id === selectedHeroId);
        const next = await api.move(game.id, selectedHeroId, dx, dy, playerId);
        set({ game: next });
        // Sonde d'exploration : PA dépensé mais position inchangée = le héros a
        // découvert de l'EAU sous le brouillard et rebroussé chemin (serveur).
        const after = next.heroes.find((h) => h.id === selectedHeroId);
        if (before && after && after.x === before.x && after.y === before.y && after.pa < before.pa) {
          pushLog(`🌊 ${after.name} découvre de l'eau — impossible d'avancer, il rebrousse chemin (-1 PA).`);
        }
        // If the last hero just left town, leave any town-only tab.
        const inTown = next.heroes.some((h) => h.hp > 0 && h.x === next.town.x && h.y === next.town.y);
        const t = get().tab;
        if (!inTown && t === "home") {
          set({ tab: "map" });
        }
        renderMap();
      }),

    search: () =>
      withBusy(async () => {
        const { game, selectedHeroId, playerId } = get();
        if (!game || !selectedHeroId) return;
        if (!ownsHero(selectedHeroId)) return;
        const res = await api.search(game.id, selectedHeroId, playerId);
        set({ game: res.game });
        pushLog(`🔎 Fouille : ${res.loot.name} (${res.loot.type}).`);
        renderMap();
      }),

    hide: () =>
      withBusy(async () => {
        const { game, selectedHeroId, playerId } = get();
        if (!game || !selectedHeroId) return;
        if (!ownsHero(selectedHeroId)) return;
        const name = game.heroes.find((h) => h.id === selectedHeroId)?.name ?? "Le héros";
        const next = await api.hide(game.id, selectedHeroId, playerId);
        set({ game: next });
        pushLog(`🫥 ${name} se dissimule (épargné par la prochaine vague).`);
        renderMap();
      }),

    escape: () =>
      withBusy(async () => {
        const { game, selectedHeroId, playerId } = get();
        if (!game || !selectedHeroId) return;
        if (!ownsHero(selectedHeroId)) return;
        const before = game.heroes.find((h) => h.id === selectedHeroId);
        const next = await api.escape(game.id, selectedHeroId, playerId);
        const after = next.heroes.find((h) => h.id === selectedHeroId);
        set({ game: next });
        if (before && after && (before.x !== after.x || before.y !== after.y)) {
          pushLog(`🏃 ${after.name} bat en retraite vers la ville.`);
        } else {
          pushLog(`🏃 ${after?.name ?? "Le héros"} trébuche en fuyant (Blessé).`);
        }
        renderMap();
      }),

    drinkRation: () =>
      withBusy(async () => {
        const { game, selectedHeroId, playerId } = get();
        if (!game || !selectedHeroId) return;
        if (!ownsHero(selectedHeroId)) return;
        const name = game.heroes.find((h) => h.id === selectedHeroId)?.name ?? "Le héros";
        const next = await api.drinkRation(game.id, selectedHeroId, playerId);
        set({ game: next });
        pushLog(`💧 ${name} boit une ration d'eau (+${6} PA).`);
        renderMap();
      }),

    castSkill: (skillId) =>
      withBusy(async () => {
        const { game, selectedHeroId, playerId, mapSkills } = get();
        if (!game || !selectedHeroId) return;
        if (!ownsHero(selectedHeroId)) return;
        const name = game.heroes.find((h) => h.id === selectedHeroId)?.name ?? "Le héros";
        const sk = mapSkills.find((s) => s.id === skillId);
        const icon = sk?.icon ?? "✨";
        const res = await api.castSkill(game.id, selectedHeroId, skillId, playerId);
        set({ game: res.game });
        const r = res.report;
        if (r.killed) {
          pushLog(`${icon} ${name} anéantit le pack de ${r.species} avec ${r.name} (-${r.damage} PV) !`);
        } else if (r.slain > 0) {
          pushLog(`${icon} ${name} — ${r.name} sur ${r.species} : ${r.slain} abattu(s) (-${r.damage} PV).`);
        } else {
          pushLog(`${icon} ${name} lance ${r.name} sur ${r.species} (-${r.damage} PV).`);
        }
        if (r.loot) pushLog(`💰 ${name} rafle ${r.loot} au passage !`);
        renderMap();
      }),

    ruinClear: () =>
      withBusy(async () => {
        const { game, selectedHeroId, playerId } = get();
        if (!game || !selectedHeroId) return;
        if (!ownsHero(selectedHeroId)) return;
        const hero = game.heroes.find((h) => h.id === selectedHeroId);
        const res = await api.ruinClear(game.id, selectedHeroId, hero?.pa ?? 1, playerId);
        set({ game: res.game });
        const ru = res.ruin;
        pushLog(ru.cleared
          ? `⛏️ ${ru.icon} ${ru.name} est DÉBLAYÉE — le donjon est ouvert !`
          : `⛏️ ${hero?.name ?? "Le héros"} déblaie ${ru.name} (${ru.paInvested}/${ru.clearPa} PA).`);
        renderMap();
      }),

    ruinExplore: () =>
      withBusy(async () => {
        const { game, selectedHeroId, playerId } = get();
        if (!game || !selectedHeroId) return;
        if (!ownsHero(selectedHeroId)) return;
        const name = game.heroes.find((h) => h.id === selectedHeroId)?.name ?? "Le héros";
        const res = await api.ruinExplore(game.id, selectedHeroId, playerId);
        set({ game: res.game });
        const it = res.item;
        pushLog(`🏛️ ${name} explore le donjon et trouve ${it.qty > 1 ? it.qty + "× " : ""}${it.name} !`);
        renderMap();
      }),

    advance: (safe = false) =>
      withBusy(async () => {
        const { game } = get();
        if (!game) return;
        const next = await api.advance(game.id, safe);
        set({ game: next });
        const lw = next.lastWave;
        if (lw) {
          if (safe) {
            pushLog(`🛡️ Vague ${lw.wave} passée sans dégâts (debug) — ville intacte.`);
          } else {
            pushLog(`🌊 Vague ${lw.wave} forcée : -${lw.townDamage} PV ville (déf ${lw.defense} / horde ${lw.hordePower}).`);
            if (lw.gameOver) pushLog("💀 La ville est tombée…");
          }
        }
        renderMap();
      }),

    skipDay: () =>
      withBusy(async () => {
        const { game } = get();
        if (!game) return;
        await api.advance(game.id);
        const next = await api.advance(game.id);
        set({ game: next });
        const lw = next.lastWave;
        pushLog(`⏩ Jour ${next.day} — ${lw ? `vague ${lw.wave} : -${lw.townDamage} PV ville` : "avancé"}.`);
        if (lw?.gameOver) pushLog("💀 La ville est tombée…");
        renderMap();
      }),

    // DEBUG : lève (on) ou remet (off) le brouillard de guerre côté serveur. La vraie
    // carte explorée n'est pas modifiée — remettre le brouillard rend l'état réel.
    revealFog: (on) =>
      withBusy(async () => {
        const { game } = get();
        if (!game) return;
        const next = await api.revealFog(game.id, on);
        set({ game: next });
        pushLog(on ? "👁️ Brouillard levé (debug) — carte entière révélée." : "🌫️ Brouillard remis.");
        renderMap();
      }),

    refreshGame: async () => {
      const { game, view } = get();
      if (!game || view === "combat") return;
      try {
        const next = await api.getGame(game.id);
        const prevWave = game.lastWave?.wave ?? 0;
        set({ game: next });
        if (next.lastWave && next.lastWave.wave > prevWave) {
          const lw = next.lastWave;
          pushLog(`🌊 Vague ${lw.wave} : -${lw.townDamage} PV ville (déf ${lw.defense} / horde ${lw.hordePower}).`);
          if (lw.heroesHit.length) {
            pushLog(`⚔️ Hors ville : ${lw.heroesHit.map((h) => `${h.name} ${h.delta}`).join(", ")}.`);
          }
          if (lw.gameOver) pushLog("💀 La ville est tombée…");
        }
        renderMap();
      } catch {
        /* ignore polling errors */
      }
    },

    startCombat: () =>
      withBusy(async () => {
        const { game, selectedHeroId, playerId } = get();
        if (!game || !selectedHeroId) return;
        if (!ownsHero(selectedHeroId)) return;
        const resp = await api.startCombat(game.id, selectedHeroId, playerId);
        set({ view: "combat", combatMode: "move", tab: "map" });
        pushLog("⚔️ Le combat commence !");
        applyCombat(resp);
      }),

    setCombatMode: (m) => {
      set({ combatMode: m });
      renderCombat();
    },

    // Arme une compétence iso par index (bouton) : une capacité sur soi (Posture
    // défensive, Hurlement…) part IMMÉDIATEMENT ; sinon on passe en mode ciblage
    // "skill" en mémorisant l'index — le tap sur une cible verte la déclenche.
    selectCombatSkill: (idx) => {
      const { game, combat, current, playerId } = get();
      const sk = current?.skills?.[idx];
      if (!sk) return;
      if (sk.selfCast && game && combat) {
        void withBusy(async () => {
          const resp = await api.combatAction(game.id, combat.id, {
            unitId: current!.unitId,
            action: "skill",
            skillIdx: idx,
            targetId: current!.unitId,
            playerId,
          });
          bus.emit(EV.CombatAnim, { unitId: current!.unitId, kind: "skill" });
          set({ combatMode: "move", combatSkillIdx: 0 });
          applyCombat(resp);
        });
        return;
      }
      set({ combatMode: "skill", combatSkillIdx: idx });
      renderCombat();
    },

    combatTileClick: (x, y) =>
      withBusy(async () => {
        const { game, combat, current, playerId } = get();
        if (!game || !combat || !current) return;
        if (!current.reachable.some(([rx, ry]) => rx === x && ry === y)) return;
        const resp = await api.combatAction(game.id, combat.id, {
          unitId: current.unitId,
          action: "move",
          x,
          y,
          playerId,
        });
        applyCombat(resp);
      }),

    combatUnitClick: (unitId) =>
      withBusy(async () => {
        const { game, combat, current, combatMode, combatSkillIdx, playerId } = get();
        if (!game || !combat || !current) return;
        const list =
          combatMode === "skill"
            ? current.skills?.[combatSkillIdx]?.targets ?? []
            : combatMode === "push"
              ? current.pushTargets ?? []
              : current.attackTargets;
        if (!list.includes(unitId)) {
          // Pas une cible valide : taper un ennemi montre/masque ses cases
          // menacées (télégraphie C2) au lieu de ne rien faire.
          const u = combat.units.find((x) => x.id === unitId);
          if (u && u.side === "monster" && u.hp > 0) get().toggleThreat(unitId);
          return;
        }
        const resp = await api.combatAction(game.id, combat.id, {
          unitId: current.unitId,
          action: combatMode === "skill" ? "skill" : combatMode === "push" ? "push" : "attack",
          skillIdx: combatMode === "skill" ? combatSkillIdx : undefined,
          targetId: unitId,
          playerId,
        });
        bus.emit(EV.CombatAnim, { unitId: current.unitId, kind: combatMode === "skill" ? "skill" : "attack" });
        set({ combatMode: "move", combatSkillIdx: 0 });
        applyCombat(resp);
      }),

    endTurn: () =>
      withBusy(async () => {
        const { game, combat, current, playerId } = get();
        if (!game || !combat || !current) return;
        const resp = await api.combatAction(game.id, combat.id, {
          unitId: current.unitId,
          action: "end",
          playerId,
        });
        set({ combatMode: "move" });
        applyCombat(resp);
      }),

    toggleThreat: (unitId) => {
      set({ threatUnitId: get().threatUnitId === unitId ? undefined : unitId });
      renderCombat();
    },

    joinCombat: () =>
      withBusy(async () => {
        const { game, playerId } = get();
        const mine = myActiveCombat(game, playerId);
        if (!game || !mine) return;
        // multi : POST join (présence) ; solo legacy sans playerId : GET du combat.
        const resp = playerId
          ? await api.joinCombat(game.id, mine.id, playerId)
          : await api.getCombat(game.id, mine.id);
        set({ view: "combat", combatMode: "move", tab: "map" });
        pushLog("⚔️ Tu rejoins le combat !");
        applyCombat(resp);
      }),

    refreshCombat: async () => {
      // Poll silencieux du combat multijoueur : n'applique la réponse QUE si
      // quelque chose a bougé (seq / statut / unité au tour) — sinon applyCombat
      // re-pousserait les mêmes lignes de log toutes les 3 s.
      const { game, combat, current, busy } = get();
      if (!game || !combat || busy || combat.status !== "active") return;
      if ((game.players?.length ?? 0) === 0) return; // solo legacy : rien à synchroniser
      try {
        const resp = await api.getCombat(game.id, combat.id);
        const changed =
          resp.combat.seq !== combat.seq ||
          resp.combat.status !== combat.status ||
          resp.current?.unitId !== current?.unitId;
        if (changed) applyCombat(resp);
      } catch {
        /* poll silencieux */
      }
    },

    combatDefend: () =>
      withBusy(async () => {
        const { game, combat, current, playerId } = get();
        if (!game || !combat || !current) return;
        const resp = await api.combatAction(game.id, combat.id, {
          unitId: current.unitId,
          action: "defend",
          playerId,
        });
        set({ combatMode: "move" });
        applyCombat(resp);
      }),

    combatFlee: () =>
      withBusy(async () => {
        const { game, combat, current, playerId } = get();
        if (!game || !combat || !current) return;
        const resp = await api.combatAction(game.id, combat.id, {
          unitId: current.unitId,
          action: "flee",
          playerId,
        });
        set({ combatMode: "move" });
        applyCombat(resp);
      }),

    combatUseItem: (name) =>
      withBusy(async () => {
        const { game, combat, current, playerId } = get();
        if (!game || !combat || !current) return;
        const resp = await api.combatAction(game.id, combat.id, {
          unitId: current.unitId,
          action: "item",
          item: name,
          playerId,
        });
        set({ combatMode: "move" });
        applyCombat(resp);
      }),

    returnToMap: () => {
      set({ view: "map", combat: undefined, current: undefined, combatThreats: [], threatUnitId: undefined });
      renderMap();
    },
  };
});

// Dev-only handle for debugging from the browser console / automated checks.
if (import.meta.env.DEV) {
  (window as any).__eg = { store: useStore, bus, EV };
}

// Restore the account session at boot (silent — anonymous play stays possible).
if (getAuthToken()) {
  api
    .me()
    .then((res) => {
      useStore.setState({ user: res.user });
      if (!useStore.getState().playerName) useStore.getState().setPlayerName(res.user.name);
      void useStore.getState().fetchMyGames();
    })
    .catch(() => setAuthToken(null)); // expired/invalid token: drop it
}

// Wire Phaser pointer intents to store actions.
bus.on(EV.MapHeroClick, ({ heroId }) => useStore.getState().selectHero(heroId));
bus.on(EV.MapTileClick, ({ x, y }) => {
  const s = useStore.getState();
  const hero = s.game?.heroes.find((h) => h.id === s.selectedHeroId);
  if (!hero) return;
  const dx = x - hero.x;
  const dy = y - hero.y;
  if (Math.abs(dx) + Math.abs(dy) === 1) s.move(dx, dy);
});
bus.on(EV.CombatTileClick, ({ x, y }) => useStore.getState().combatTileClick(x, y));
bus.on(EV.CombatUnitClick, ({ unitId }) => useStore.getState().combatUnitClick(unitId));
