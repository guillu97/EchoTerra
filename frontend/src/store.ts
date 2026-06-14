import { create } from "zustand";
import { api } from "./api/client";
import type { CombatCurrent, Combat, GameState, Recipe } from "./api/types";
import { bus, EV } from "./eventBus";
import { effectiveTownHeroId } from "./townUtils";

const LS_GAME = "echoterra:gameId";
const LS_SETTINGS = "echoterra:settings";

type View = "map" | "combat";
type CombatMode = "move" | "attack" | "skill";

export type AppScreen = "loading" | "title" | "cinematic" | "game";
export type Tab = "home" | "map" | "stock" | "structure" | "craft";
export type SettingsScreen = "menu" | "setting" | "language" | "notifications";

export interface Settings {
  music: number;
  sfx: number;
  fps: 30 | 60 | 120;
  quality: "Normal" | "Medium" | "High" | "Very high";
  language: string;
  notif: { loot: boolean; wave: boolean; actionPoint: boolean; communication: boolean };
}

const DEFAULT_SETTINGS: Settings = {
  music: 80,
  sfx: 80,
  fps: 60,
  quality: "Medium",
  language: "Français",
  notif: { loot: true, wave: true, actionPoint: true, communication: false },
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
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
  townHeroId?: string; // preferred hero paying for town work
  recipes: Recipe[];

  // --- game / map / combat ---
  game?: GameState;
  combat?: Combat;
  current?: CombatCurrent;
  view: View;
  combatMode: CombatMode;
  selectedHeroId?: string;
  log: string[];
  busy: boolean;
  error?: string;

  // shell actions
  setScreen: (s: AppScreen) => void;
  setTab: (t: Tab) => void;
  openSettings: (s: SettingsScreen) => void;
  closeSettings: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  openHero: (id: string) => void;
  closeHero: () => void;
  toggleTownStatus: (open?: boolean) => void;
  townAction: (
    buildingId: string,
    action: "build" | "restore" | "use" | "water" | "toggle",
    points?: number,
  ) => Promise<void>;
  setTownHero: (id: string) => void;
  townDeposit: () => Promise<void>;
  craft: (recipeId: string) => Promise<void>;
  startAdventure: () => void; // Title "Start the game" -> cinematic
  enterGame: () => Promise<void>; // cinematic skip -> game home
  leaveTown: () => void; // settings -> back to title
  syncScene: () => void; // re-push current view to Phaser (on Map tab mount)
  refreshGame: () => Promise<void>; // silent refetch (wave polling / countdown reaching 0)

  // game actions
  newGame: () => Promise<void>;
  loadGame: (id: string) => Promise<void>;
  selectHero: (id: string) => void;
  move: (dx: number, dy: number) => Promise<void>;
  search: () => Promise<void>;
  hide: () => Promise<void>;
  escape: () => Promise<void>;
  fireball: () => Promise<void>;
  advance: () => Promise<void>;
  startCombat: () => Promise<void>;
  setCombatMode: (m: CombatMode) => void;
  combatTileClick: (x: number, y: number) => Promise<void>;
  combatUnitClick: (unitId: string) => Promise<void>;
  endTurn: () => Promise<void>;
  returnToMap: () => void;
  pushLog: (msg: string) => void;
}

export const useStore = create<StoreState>((set, get) => {
  const pushLog = (msg: string) => set((s) => ({ log: [...s.log.slice(-40), msg] }));

  const renderMap = () => {
    const { game, selectedHeroId } = get();
    bus.emit(EV.ShowScene, "map");
    bus.emit(EV.MapRender, { game, selectedHeroId });
  };

  const renderCombat = () => {
    const { combat, current, combatMode } = get();
    bus.emit(EV.ShowScene, "combat");
    bus.emit(EV.CombatRender, { combat, current, mode: combatMode });
  };

  const applyCombat = (resp: { combat: Combat; game: GameState; current?: CombatCurrent }) => {
    set({ combat: resp.combat, current: resp.current, game: resp.game });
    resp.combat.log.slice(-3).forEach((l) => pushLog(l));
    if (resp.combat.status !== "active") {
      pushLog(resp.combat.status === "won" ? "🏆 Victoire !" : "💀 Défaite…");
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
    } finally {
      set({ busy: false });
    }
  };

  return {
    appScreen: "loading",
    tab: "home",
    settingsScreen: null,
    settings: loadSettings(),
    townStatusOpen: false,
    recipes: [],

    view: "map",
    combatMode: "move",
    log: [],
    busy: false,

    pushLog,

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

    townAction: (buildingId, action, points) =>
      withBusy(async () => {
        const { game, townHeroId } = get();
        if (!game) return;
        const heroId = effectiveTownHeroId(game, townHeroId);
        const next = await api.townAction(game.id, { buildingId, action, points, heroId });
        set({ game: next });
        renderMap();
      }),

    setTownHero: (id) => set({ townHeroId: id }),

    townDeposit: () =>
      withBusy(async () => {
        const { game } = get();
        if (!game) return;
        const res = await api.townDeposit(game.id);
        set({ game: res.game });
        pushLog(`📦 ${res.moved} objet(s) déposé(s) dans la Banque.`);
        renderMap();
      }),

    craft: (recipeId) =>
      withBusy(async () => {
        const { game, townHeroId, selectedHeroId } = get();
        if (!game) return;
        const inTown = game.heroes.some((h) => h.hp > 0 && h.x === game.town.x && h.y === game.town.y);
        // In town: the chosen town worker crafts from the Maison. In the field: the
        // selected hero crafts from their own bag (reduced recipe set).
        const heroId = inTown ? effectiveTownHeroId(game, townHeroId) : selectedHeroId;
        const res = await api.craft(game.id, recipeId, heroId);
        set({ game: res.game });
        pushLog(
          inTown
            ? `⚒️ Fabriqué : ${res.crafted.name} → rangé dans la Banque.`
            : `⚒️ Fabriqué sur le terrain : ${res.crafted.name} → sac du héros.`,
        );
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
              set({ game, selectedHeroId: game.heroes[0]?.id });
            } catch {
              localStorage.removeItem(LS_GAME);
            }
          }
          if (!get().game) await get().newGame();
        }
        if (get().recipes.length === 0) {
          try {
            set({ recipes: await api.recipes() });
          } catch {
            /* recipes are non-critical */
          }
        }
        set({ appScreen: "game", tab: "home", settingsScreen: null });
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
        });
        pushLog(`Nouvelle partie — jour ${game.day}. La ville est à (${game.town.x}, ${game.town.y}).`);
      }),

    loadGame: (id: string) =>
      withBusy(async () => {
        const game = await api.getGame(id);
        set({ game, view: "map", selectedHeroId: game.heroes[0]?.id });
      }),

    selectHero: (id: string) => {
      set({ selectedHeroId: id });
      renderMap();
    },

    move: (dx, dy) =>
      withBusy(async () => {
        const { game, selectedHeroId } = get();
        if (!game || !selectedHeroId) return;
        const next = await api.move(game.id, selectedHeroId, dx, dy);
        set({ game: next });
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
        const { game, selectedHeroId } = get();
        if (!game || !selectedHeroId) return;
        const res = await api.search(game.id, selectedHeroId);
        set({ game: res.game });
        pushLog(`🔎 Fouille : ${res.loot.name} (${res.loot.type}).`);
        renderMap();
      }),

    hide: () =>
      withBusy(async () => {
        const { game, selectedHeroId } = get();
        if (!game || !selectedHeroId) return;
        const name = game.heroes.find((h) => h.id === selectedHeroId)?.name ?? "Le héros";
        const next = await api.hide(game.id, selectedHeroId);
        set({ game: next });
        pushLog(`🫥 ${name} se dissimule (épargné par la prochaine vague).`);
        renderMap();
      }),

    escape: () =>
      withBusy(async () => {
        const { game, selectedHeroId } = get();
        if (!game || !selectedHeroId) return;
        const before = game.heroes.find((h) => h.id === selectedHeroId);
        const next = await api.escape(game.id, selectedHeroId);
        const after = next.heroes.find((h) => h.id === selectedHeroId);
        set({ game: next });
        if (before && after && (before.x !== after.x || before.y !== after.y)) {
          pushLog(`🏃 ${after.name} bat en retraite vers la ville.`);
        } else {
          pushLog(`🏃 ${after?.name ?? "Le héros"} trébuche en fuyant (Blessé).`);
        }
        renderMap();
      }),

    fireball: () =>
      withBusy(async () => {
        const { game, selectedHeroId } = get();
        if (!game || !selectedHeroId) return;
        const name = game.heroes.find((h) => h.id === selectedHeroId)?.name ?? "Le héros";
        const res = await api.fireball(game.id, selectedHeroId);
        set({ game: res.game });
        const r = res.report;
        if (r.killed) {
          pushLog(`🔥 ${name} carbonise le pack de ${r.species} (-${r.damage} PV) !`);
        } else if (r.slain > 0) {
          pushLog(`🔥 ${name} brûle ${r.species} : ${r.slain} abattu(s) (-${r.damage} PV).`);
        } else {
          pushLog(`🔥 ${name} lance une boule de feu sur ${r.species} (-${r.damage} PV).`);
        }
        renderMap();
      }),

    advance: () =>
      withBusy(async () => {
        const { game } = get();
        if (!game) return;
        const next = await api.advance(game.id);
        set({ game: next });
        const lw = next.lastWave;
        if (lw) {
          pushLog(`🌊 Vague ${lw.wave} forcée : -${lw.townDamage} PV ville (déf ${lw.defense} / horde ${lw.hordePower}).`);
          if (lw.gameOver) pushLog("💀 La ville est tombée…");
        }
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
        const { game, selectedHeroId } = get();
        if (!game || !selectedHeroId) return;
        const resp = await api.startCombat(game.id, selectedHeroId);
        set({ view: "combat", combatMode: "move", tab: "map" });
        pushLog("⚔️ Le combat commence !");
        applyCombat(resp);
      }),

    setCombatMode: (m) => {
      set({ combatMode: m });
      renderCombat();
    },

    combatTileClick: (x, y) =>
      withBusy(async () => {
        const { game, combat, current } = get();
        if (!game || !combat || !current) return;
        if (!current.reachable.some(([rx, ry]) => rx === x && ry === y)) return;
        const resp = await api.combatAction(game.id, combat.id, {
          unitId: current.unitId,
          action: "move",
          x,
          y,
        });
        applyCombat(resp);
      }),

    combatUnitClick: (unitId) =>
      withBusy(async () => {
        const { game, combat, current, combatMode } = get();
        if (!game || !combat || !current) return;
        const list = combatMode === "skill" ? current.skillTargets : current.attackTargets;
        if (!list.includes(unitId)) return;
        const resp = await api.combatAction(game.id, combat.id, {
          unitId: current.unitId,
          action: combatMode === "skill" ? "skill" : "attack",
          targetId: unitId,
        });
        set({ combatMode: "move" });
        applyCombat(resp);
      }),

    endTurn: () =>
      withBusy(async () => {
        const { game, combat, current } = get();
        if (!game || !combat || !current) return;
        const resp = await api.combatAction(game.id, combat.id, {
          unitId: current.unitId,
          action: "end",
        });
        set({ combatMode: "move" });
        applyCombat(resp);
      }),

    returnToMap: () => {
      set({ view: "map", combat: undefined, current: undefined });
      renderMap();
    },
  };
});

// Dev-only handle for debugging from the browser console / automated checks.
if (import.meta.env.DEV) {
  (window as any).__eg = { store: useStore, bus, EV };
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
