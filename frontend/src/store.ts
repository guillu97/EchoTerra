import { create } from "zustand";
import { api, getAuthToken, setAuthToken } from "./api/client";
import type {
  ChatMessage,
  ClassDef,
  CombatCurrent,
  CombatThreat,
  Combat,
  GameState,
  GameSummary,
  Equipment,
  ItemEffects,
  MapSkillDef,
  MyGameSummary,
  Recipe,
  User,
  WaveReport,
} from "./api/types";
import { bus, EV } from "./eventBus";
import { effectiveTownHeroId } from "./townUtils";
import { myActiveCombat } from "./combatUtils";

const LS_GAME = "echoterra:gameId"; // dernière partie active (pointeur générique)
const LS_SETTINGS = "echoterra:settings";
const LS_PLAYER_NAME = "echoterra:playerName";
// Per-game player identity: which player *I* am in that game (multiplayer lobby flow).
const lsPlayerKey = (gameId: string) => `echoterra:player:${gameId}`;

// How many chat messages this DEVICE has already seen, per game. Read-state is
// deliberately local: the server has no business tracking who read what, and two
// devices of the same player legitimately carry different pips.
const lsChatSeenKey = (gameId: string) => `echoterra:chatSeen:${gameId}`;
function saveChatSeen(gameId: string | undefined, n: number) {
  if (!gameId) return;
  try {
    localStorage.setItem(lsChatSeenKey(gameId), String(n));
  } catch {
    /* ignore */
  }
}
export function loadChatSeen(gameId: string): number {
  try {
    return Number(localStorage.getItem(lsChatSeenKey(gameId))) || 0;
  } catch {
    return 0;
  }
}

// Dernière vague MONTRÉE au joueur sur cet appareil, avec les PV de la ville à ce
// moment-là. Sans cette trace, le cas le plus fréquent d'un jeu asynchrone était
// muet : on revient après quelques heures, l'état chargé contient DÉJÀ la
// nouvelle vague, il n'y a rien à diffé­rencier, et l'événement principal de la
// session passait inaperçu. Les PV mémorisés donnent le cumul réel des dégâts
// encaissés pendant l'absence.
const lsWaveSeenKey = (gameId: string) => `echoterra:waveSeen:${gameId}`;
function saveWaveSeen(gameId: string, wave: number, hp: number) {
  try {
    localStorage.setItem(lsWaveSeenKey(gameId), JSON.stringify({ wave, hp }));
  } catch {
    /* ignore */
  }
}
function loadWaveSeen(gameId: string): { wave: number; hp: number } | null {
  try {
    const raw = localStorage.getItem(lsWaveSeenKey(gameId));
    if (!raw) return null;
    const v = JSON.parse(raw) as { wave?: number; hp?: number };
    return typeof v.wave === "number" ? { wave: v.wave, hp: v.hp ?? 0 } : null;
  } catch {
    return null;
  }
}

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

export type AppScreen = "loading" | "title" | "cinematic" | "game" | "editor" | "designer" | "voxelbench" | "voxeledit" | "charstudio" | "lobby" | "account" | "leaderboard";
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
  /** Cadence de l'animation « au repos » des personnages et des monstres, en
   *  images/s (0 = figés tant que rien ne bouge — mode batterie). Le rendu
   *  voxel est ON-DEMAND : la respiration d'un monstre coûte un redraw complet
   *  de la scène, donc c'est bien une fréquence d'affichage qu'on règle ici.
   *  Ne borne QUE l'idle : un pas, une attaque, une mort gardent le plein rAF. */
  idleAnimFps: 0 | 8 | 15 | 30;
  /** Cadence des EFFETS DE MÉTÉO d'un thème (neige nordique + ciel couvert,
   *  vire-vents du désert — voir voxel/weather.ts), en images/s.
   *  ⚠ 0 ne fige pas l'effet : il ne l'existe PAS. La couche n'est pas
   *  construite, aucune géométrie n'est créée, aucune image n'est demandée — la
   *  carte reste le rendu 100 % on-demand qu'elle doit être sur téléphone.
   *  Un thème sans météo (tempéré) ne coûte rien quel que soit ce réglage. */
  weatherFps: 0 | 8 | 15 | 30;
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
  idleAnimFps: 15, // les monstres respirent sur la carte, sans y brûler la batterie
  weatherFps: 15, // il neige sur le nord et le désert roule ses vire-vents — coupable d'un tap

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
  townLedgerOpen: boolean; // registre de contribution (Panel building) — cf. TownLedger.tsx
  chatOpen: boolean; // messagerie de la ville (feuille ✉️)
  chat: ChatMessage[]; // board content — served by its own gated route, never by the game payload
  chatSeen: number; // how many messages this device had seen (drives the unread pip)
  chatLocked?: string; // server's reason when the board is out of reach (no hero in town, no Poste)
  // Cinématique de vague en cours (null = aucune). `waves` > 1 quand plusieurs
  // vagues sont tombées pendant une absence ; `townDamage` est le cumul réel
  // (PV de la ville avant/après), pas seulement celui du dernier rapport.
  waveCinema: { report: WaveReport; waves: number; townDamage: number } | null;
  // RATTRAPAGE EN COURS : le serveur a encore des vagues dues (payload `catchUp`).
  // Tant que c'est vrai, le minuteur de vague n'a plus de sens (il est à 0 par
  // construction) et la barre du haut le dit, au lieu d'afficher « 00:00 » sur un
  // monde qui, lui, est en train de bouger.
  catchingUp: boolean;
  cheatOpen: boolean;
  townHeroId?: string; // preferred hero paying for town work
  recipes: Recipe[];
  classes: ClassDef[];
  mapSkills: MapSkillDef[]; // catalogue des compétences de carte par classe
  itemEffects: ItemEffects; // ce qui se CONSOMME et ce que ça fait (backend game/items.go)
  equipment: Equipment; // ce qui se PORTE (backend game/equipment.go)

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
  aimUnitId?: string; // cible SURVOLÉE : l'arène y peint la zone d'impact du coup armé
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
  toggleTownLedger: (open?: boolean) => void;
  toggleChat: (open?: boolean) => void;
  dismissWaveCinema: () => void;
  refreshChat: () => Promise<void>; // sondage silencieux de la messagerie
  sendChat: (text: string) => Promise<void>;
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
    action: "build" | "restore" | "repair" | "use" | "water" | "toggle" | "revive" | "heal",
    points?: number,
  ) => Promise<void>;
  setTownHero: (id: string) => void;
  townDeposit: () => Promise<void>;
  scoutWave: () => Promise<void>; // monter à la Tour estimer la vague (collectif)
  setHeroOrder: (heroId: string, order: "" | "shelter" | "return") => Promise<void>;
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
  // Consommer un objet (nourriture, potion). En ville, le héros peut puiser dans la
  // réserve commune : il consomme SUR PLACE, il n'emporte rien (backend items.go).
  useItem: (heroId: string, item: string) => Promise<void>;
  // Porter un objet, ou libérer un emplacement (item vide).
  equipItem: (heroId: string, item: string, slot: string) => Promise<void>;
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
  setAimUnit: (unitId?: string) => void; // cible survolée : aperçu de la ZONE d'impact
  joinCombat: () => Promise<void>; // multijoueur : reprendre le contrôle de MES héros
  refreshCombat: () => Promise<void>; // poll du combat multijoueur (tours des autres)
  combatDefend: () => Promise<void>; // 🛡️ -50% subis jusqu'au prochain tour (C3)
  combatFlee: () => Promise<void>; // 🏃 fuir depuis le bord bas (C3)
  combatUseItem: (name: string) => Promise<void>; // 🧪 consommer un objet du sac (C3)
  combatSwapWeapon: (name: string) => Promise<void>; // 🔁 dégainer une autre arme (coûte le tour)
  endTurn: () => Promise<void>;
  returnToMap: () => void;
  pushLog: (msg: string) => void;
  notify: (msg: string, tone?: ToastTone) => void;
  dismissToast: (id: number) => void;
}

// predictMove applique LOCALEMENT un pas de héros, ou renvoie null si l'issue
// n'est pas certaine — auquel cas l'appelant attend simplement le serveur.
//
// C'est un MIROIR de game.MoveHero (backend/internal/game/actions.go) et il doit
// le rester : toute règle que le serveur ajoute et qu'on oublie ici produit un
// héros qui avance puis revient en arrière. D'où le parti pris : on ne prédit
// que ce qui est certain, et le doute vaut refus de prédire.
//
// Le cas qu'on ne PEUT pas prédire, et qui justifie à lui seul le `null` : une
// case sous le brouillard. Le serveur y renvoie une tuile vierge (fog.go), donc
// le client ignore son biome ; marcher sur de l'eau inconnue coûte 1 PA et
// laisse le héros sur place. Impossible à deviner — on attend.
function predictMove(game: GameState, heroId: string, dx: number, dy: number): GameState | null {
  const hero = game.heroes.find((h) => h.id === heroId);
  if (!hero) return null;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
  if (hero.hp <= 0 || hero.pa <= 0) return null;
  if (hero.states.includes("Tétanisé")) return null;
  // Héros engagé dans un combat : le serveur refuse. On ne cherche pas à le
  // déduire finement, la présence d'un combat actif suffit à s'abstenir.
  for (const id in game.combats ?? {}) {
    const c = game.combats![id];
    if (c.status === "active" && c.units.some((u) => u.side === "hero" && u.refId === heroId && u.hp > 0 && !u.fled)) {
      return null;
    }
  }
  const nx = hero.x + dx, ny = hero.y + dy;
  if (nx < 0 || ny < 0 || nx >= game.width || ny >= game.height) return null;
  const t = game.tiles[ny * game.width + nx];
  if (!t || !t.discovered) return null; // brume : issue inconnue (cf. ci-dessus)
  if (t.biome === 0) return null; // eau connue — le serveur refuse
  // LE RELIEF (backend climb.go) : une falaise plus haute que le franchissement du
  // héros est refusée. On ne prédit pas le refus, on s'abstient — le serveur rendra
  // le message qui explique quoi faire (contourner, ou gagner en athlétisme).
  const from = game.tiles[hero.y * game.width + hero.x];
  if (from && Math.abs((t.height ?? 0) - (from.height ?? 0)) > (hero.climb ?? 1)) return null;
  const gate = game.town.buildings?.find((b) => b.id === "gate");
  if (gate?.built && !gate.open) {
    const toTown = nx === game.town.x && ny === game.town.y;
    const fromTown = hero.x === game.town.x && hero.y === game.town.y;
    if (toTown || fromTown) return null; // porte close : la ville est scellée
  }

  const pa = hero.pa - 1;
  const states = hero.states.filter((s) => s !== "Caché"); // bouger rompt la discrétion
  if (pa === 0 && !states.includes("Fatigue")) states.push("Fatigue");
  return {
    ...game,
    heroes: game.heroes.map((h) =>
      // `forageAt` retombe : on ne récolte plus la case qu'on quitte (miroir du
      // StopForaging de MoveHero).
      h.id === heroId ? { ...h, x: nx, y: ny, pa, states, forageAt: undefined } : h,
    ),
  };
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

  // LE MOMENT DE LA VAGUE. La horde qui frappe est le battement du jeu, et c'était
  // jusqu'ici trois lignes de log. C'est aussi le pire moment côté client : le
  // serveur résout la vague (mesuré jusqu'à 1,3 s en local, davantage en
  // déploiement où la fonction se réveille) puis des centaines de monstres
  // apparaissent d'un coup, ce qui rend la frame suivante très lourde. La
  // cinématique couvre exactement cette fenêtre — voir WaveCinematic.tsx.
  //
  // `waves > 1` = on revient après une absence : une seule cinématique, avec le
  // cumul, plutôt que N d'affilée.
  const openWaveCinema = (report: WaveReport, waves: number, townDamage: number) => {
    const g = get().game;
    if (g) saveWaveSeen(g.id, report.wave, g.town.hp); // vu : ne pas la rejouer au prochain retour
    set({ waveCinema: { report, waves: Math.max(1, waves), townDamage: Math.max(0, townDamage) } });
  };

  // LE RATTRAPAGE. Une requête de joueur ne rejoue qu'une poignée de vagues
  // (game.RequestBudget : quelqu'un attend la réponse), donc au retour d'une
  // absence le serveur en garde en réserve et le dit — `game.catchUp`.
  //
  // Sans cette boucle, le seul relanceur était le sondage de 20 s de GameScreen :
  // le joueur voyait sa ville frappée UNE VAGUE TOUTES LES 20 SECONDES, minuteur
  // figé à 0, une cinématique à chaque fois — le rattrapage se jouait sous ses
  // yeux au lieu d'avoir déjà eu lieu. On relance donc tout de suite, et on
  // ACCUMULE : la cinématique n'est ouverte qu'à l'arrivée, une seule fois, avec
  // le total (même règle qu'au retour de partie, cf. waveCinemaOnEnter).
  const CATCHUP_POLL_MS = 250;
  // ⚠ BORNE DURE. `catchUp` dit « il reste des vagues dues » : si l'intervalle de
  // vague était réglé plus court que le temps de traiter une requête, la condition
  // ne retomberait JAMAIS et le client sonderait indéfiniment toutes les 600 ms.
  // Au-delà de cette borne on rend la main au sondage ordinaire de 20 s — le monde
  // avance quand même (battement + requêtes), on cesse juste de courir après lui.
  const CATCHUP_MAX_ROUNDS = 60;
  let catchUpBase: { wave: number; hp: number } | null = null; // état AVANT le rattrapage
  let catchUpTimer: ReturnType<typeof setTimeout> | null = null;
  let catchUpRounds = 0;
  const stopCatchUp = () => {
    if (catchUpTimer) clearTimeout(catchUpTimer);
    catchUpTimer = null;
    catchUpBase = null;
    catchUpRounds = 0;
    if (get().catchingUp) set({ catchingUp: false });
  };
  // UN tour de rattrapage : on fait avancer le monde par la route LÉGÈRE (elle ne
  // rend qu'un résumé) et on recommence tant qu'il reste du retard. L'état complet
  // de la partie — des centaines de ko sur une carte explorée — n'est rechargé
  // qu'une fois, à l'arrivée, par `refreshGame` : c'est lui qui ouvre la cinématique.
  //
  // Si la route échoue (réseau, ou un front servi par le CDN plus récent que le
  // backend), on retombe sur `refreshGame`, qui verra `catchUp` et reprogrammera —
  // c'est-à-dire l'ancienne boucle, en plus lourd mais fonctionnelle.
  const catchUpRound = async (gameId: string) => {
    try {
      const res = await api.catchUp(gameId);
      if (!res.done && get().game?.id === gameId && scheduleCatchUpPoll(gameId)) return;
    } catch {
      /* on laisse refreshGame décider de la suite */
    }
    await get().refreshGame();
  };

  // Relance le rattrapage tout de suite (et le signale à l'interface).
  // Renvoie false quand la borne est atteinte : l'appelant reprend le cours normal.
  const scheduleCatchUpPoll = (gameId: string): boolean => {
    if (++catchUpRounds > CATCHUP_MAX_ROUNDS) return false;
    if (!get().catchingUp) set({ catchingUp: true });
    if (catchUpTimer) clearTimeout(catchUpTimer);
    catchUpTimer = setTimeout(() => {
      catchUpTimer = null;
      // La partie a pu être quittée entre-temps : on ne réveille pas une boucle
      // sur un état qui n'est plus à l'écran.
      if (get().game?.id === gameId && get().appScreen === "game") void catchUpRound(gameId);
      else stopCatchUp();
    }, CATCHUP_POLL_MS);
    return true;
  };

  // À la reprise d'une partie : les vagues tombées pendant l'absence sont déjà
  // dans l'état chargé, il n'y a donc RIEN à diffé­rencier — c'est la trace locale
  // qui dit ce que ce joueur a déjà vu. Une seule cinématique pour tout le
  // rattrapage : en rejouer cinq d'affilée serait insupportable.
  const waveCinemaOnEnter = () => {
    const g = get().game;
    const lw = g?.lastWave;
    if (!g) return;
    const seen = loadWaveSeen(g.id);
    // Le serveur n'a pas fini de rejouer l'absence : rien à montrer MAINTENANT
    // (le bilan serait incomplet, et la suite arriverait derrière). On mémorise
    // le point de départ — la trace locale, donc le tout début de l'absence — et
    // la boucle de rattrapage ouvrira UNE cinématique quand le monde sera à jour.
    if (g.catchUp && g.status === "active") {
      catchUpBase = seen ?? { wave: lw?.wave ?? 0, hp: g.town.hp };
      scheduleCatchUpPoll(g.id);
      return;
    }
    if (!lw) return;
    if (!seen) {
      // Première ouverture sur cet appareil : on prend acte sans rien jouer (on
      // ne sait pas ce que le joueur a déjà vu ailleurs).
      saveWaveSeen(g.id, lw.wave, g.town.hp);
      return;
    }
    if (lw.wave <= seen.wave) return;
    openWaveCinema(lw, lw.wave - seen.wave, seen.hp - g.town.hp);
  };

  const renderMap = () => {
    const { game, selectedHeroId, showOthers, playerId } = get();
    const myHeroIds = game?.players?.find((p) => p.id === playerId)?.heroIds ?? [];
    bus.emit(EV.ShowScene, "map");
    bus.emit(EV.MapRender, { game, selectedHeroId, myHeroIds, showOthers });
  };

  // Numéro de séquence des pas : une réponse serveur doublée par un pas plus
  // récent est ignorée, sinon le héros reculerait le temps d'un aller-retour.
  let moveSeq = 0;

  const renderCombat = () => {
    const { combat, current, combatMode, combatSkillIdx, combatThreats, threatUnitId, aimUnitId } = get();
    bus.emit(EV.ShowScene, "combat");
    bus.emit(EV.CombatRender, {
      combat,
      current,
      mode: combatMode,
      skillIdx: combatSkillIdx,
      threats: combatThreats,
      threatUnitId,
      aimUnitId,
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
      aimUnitId: undefined, // l'aperçu de zone ne survit pas à un lot d'actions
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
    if (Object.keys(get().itemEffects).length === 0) try { set({ itemEffects: await api.items() }); } catch { /* non-critical */ }
    if (Object.keys(get().equipment).length === 0) try { set({ equipment: await api.equipment() }); } catch { /* non-critical */ }
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
    // Restore this device's read mark so re-entering a game doesn't light the ✉️
    // pip for messages already read, and fetch the board once (the panel and the
    // Ville bubble both read it).
    const gid = get().game?.id;
    if (gid) set({ chat: [], chatLocked: undefined, chatSeen: loadChatSeen(gid) });
    void get().refreshChat();
    // reprise EN COMBAT (adoptGame a posé view:"combat") → onglet Map (l'arène y
    // vit) ; sinon onglet Home par défaut.
    const inCombat = get().view === "combat" && !!get().combat;
    set({ appScreen: "game", tab: inCombat ? "map" : "home", settingsScreen: null });
    if (!inCombat) waveCinemaOnEnter(); // « voilà ce qui s'est passé pendant ton absence »
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
    townLedgerOpen: false,
    chatOpen: false,
    chat: [],
    chatSeen: 0,
    waveCinema: null,
    catchingUp: false,
    cheatOpen: false,
    recipes: [],
    classes: [],
    mapSkills: [],
    itemEffects: {},
    equipment: {},
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
    toggleTownLedger: (open) =>
      set((s) => ({ townLedgerOpen: open === undefined ? !s.townLedgerOpen : open })),

    toggleChat: (open) => {
      const next = open === undefined ? !get().chatOpen : open;
      set({ chatOpen: next });
      // Opening marks everything read AND refetches: the pip is driven by
      // town.chatCount (which rides the 20 s game poll), so the count is what we
      // acknowledge, not the length of the list we happen to hold.
      if (next) {
        set({ chatSeen: get().game?.town.chatCount ?? get().chat.length });
        saveChatSeen(get().game?.id, get().chatSeen);
        void get().refreshChat();
      }
    },

    refreshChat: async () => {
      const { game, playerId } = get();
      if (!game) return;
      try {
        const res = await api.townChat(game.id, playerId);
        set({ chat: res.messages, chatLocked: undefined });
        if (get().chatOpen) {
          const seen = game.town.chatCount ?? res.messages.length;
          set({ chatSeen: Math.max(seen, res.messages.length) });
          saveChatSeen(game.id, get().chatSeen);
        }
      } catch (e: any) {
        // 400 = the positional gate (no hero in town, no Poste). That is not an
        // error to toast — it is the state the panel is meant to explain.
        set({ chat: [], chatLocked: e?.message || "messagerie hors de portée" });
      }
    },

    sendChat: (text) =>
      withBusy(async () => {
        const { game, playerId } = get();
        if (!game || !text.trim()) return;
        const res = await api.townChatSend(game.id, text, playerId);
        set({ chat: res.messages, chatLocked: undefined, chatSeen: res.messages.length });
        saveChatSeen(game.id, res.messages.length);
        if (res.message.filtered) notify("Message envoyé — un mot a été masqué par la modération.", "warn");
      }),

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
        set({ lobbies: await api.listGames("open") });
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
        // Deux cas où l'on saute la salle d'attente : on est le joueur qui déclenche
        // le lancement automatique, ou l'on embarque dans une expédition DÉJÀ en route
        // (fenêtre d'accueil des parties publiques).
        if (res.game.status !== "lobby") {
          pushLog(
            res.game.waveNumber > 0
              ? `⚔️ Tu rejoins une expédition en route — jour ${res.game.day}, vague ${res.game.waveNumber}.`
              : "⚔️ La partie démarre !",
          );
          await enterActiveGame();
        }
      }),

    // La CONSIGNE d'un héros : ce qu'il fera seul juste avant la prochaine vague. Un
    // filet pour les soirées manquées — elle ne dure qu'une vague et ne combat jamais.
    setHeroOrder: (heroId, order) =>
      withBusy(async () => {
        const { game, playerId } = get();
        if (!game) return;
        adoptGame(await api.setHeroOrder(game.id, heroId, order, playerId ?? undefined));
        get().notify(
          order === "shelter"
            ? "🫥 Consigne posée : se cacher avant la vague"
            : order === "return"
            ? "🏰 Consigne posée : rentrer et déposer"
            : "Consigne retirée",
        );
      }),

    // Monter à la Tour de guet. C'est une manœuvre COLLECTIVE : chaque joueur qui s'y
    // colle resserre la fourchette pour toute la ville, et chacun ne compte qu'une fois
    // par vague (backend orders.go).
    scoutWave: () =>
      withBusy(async () => {
        const { game, playerId, townHeroId } = get();
        if (!game) return;
        const heroId = effectiveTownHeroId(game, playerId, townHeroId);
        if (!heroId) {
          get().notify("Il faut un de tes héros en ville pour monter à la Tour");
          return;
        }
        const res = await api.scoutWave(game.id, heroId, playerId ?? undefined);
        adoptGame(res.game);
        const f = res.forecast;
        get().notify(
          `🔭 Horde estimée entre ${f.min} et ${f.max} — fiable à ${f.precision}%` +
            (f.scouts > 1 ? ` (${f.scouts} observateurs)` : ""),
        );
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

        // DÉPLACEMENT OPTIMISTE. Le héros ne bougeait qu'à la réponse HTTP : un
        // aller-retour serveur (et, en déploiement, un réveil de fonction) entre
        // le doigt et le premier pixel — le jeu paraissait poisseux alors que
        // l'animation de marche, elle, était déjà là. On applique donc le pas
        // localement AVANT d'envoyer : l'animator voit la position changer et
        // joue la foulée immédiatement, la réponse arrive pendant le pas.
        //
        // On ne prédit QUE ce qui est certain (predictMove) : un pas sur une
        // case sous brume peut se solder par « c'est de l'eau, demi-tour, -1 PA »
        // et le client n'a aucun moyen de le savoir — il ne prédit pas ce
        // cas-là, il attend.
        const seq = ++moveSeq;
        const predicted = predictMove(game, selectedHeroId, dx, dy);
        if (predicted) {
          set({ game: predicted });
          renderMap();
        }

        let next: GameState;
        try {
          next = await api.move(game.id, selectedHeroId, dx, dy, playerId);
        } catch (e) {
          // Prédiction fausse (ou refus serveur) : on ne bricole pas un rollback
          // à la main, on redemande la vérité.
          if (predicted) await get().refreshGame();
          throw e;
        }
        // Une réponse dépassée par un pas plus récent ne doit pas ramener le
        // héros en arrière : c'est la dernière qui fait foi.
        if (seq !== moveSeq) return;
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

    useItem: (heroId, item) =>
      withBusy(async () => {
        const { game, playerId } = get();
        if (!game || !ownsHero(heroId)) return;
        const name = game.heroes.find((h) => h.id === heroId)?.name ?? "Le héros";
        const res = await api.useItem(game.id, heroId, item, playerId);
        set({ game: res.game });
        get().notify(`🍽️ ${name} utilise « ${item} » — ${res.effect?.desc ?? "c'est fait"}.`);
        renderMap();
      }),

    equipItem: (heroId, item, slot) =>
      withBusy(async () => {
        const { game, playerId } = get();
        if (!game || !ownsHero(heroId)) return;
        const next = await api.equip(game.id, heroId, item, slot, playerId);
        set({ game: next });
        get().notify(item ? `🗡️ Équipé : ${item}.` : "Emplacement libéré.");
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
        const prevHp = game.town.hp;
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
          // Même cinématique qu'une vraie vague : c'est aussi ce qui rend le
          // moment testable sans attendre l'horloge.
          openWaveCinema(lw, 1, prevHp - next.town.hp);
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
      if (!game) return;
      if (view === "combat") {
        // On ne raconte pas les vagues à quelqu'un qui joue son tour. La boucle
        // s'arrête ici plutôt que de tourner à vide : le sondage ordinaire la
        // relancera à la sortie de l'arène (le serveur annonce toujours son retard).
        stopCatchUp();
        return;
      }
      try {
        const next = await api.getGame(game.id);
        const prevWave = game.lastWave?.wave ?? 0;
        const prevHp = game.town.hp;
        set({ game: next });
        // Le serveur a-t-il fini de rejouer le temps écoulé ? Tant que non, on ne
        // montre rien : on note d'où l'on part et on relance aussitôt.
        const pending = !!next.catchUp && next.status === "active";
        if (next.lastWave && next.lastWave.wave > prevWave) {
          const lw = next.lastWave;
          pushLog(`🌊 Vague ${lw.wave} : -${lw.townDamage} PV ville (déf ${lw.defense} / horde ${lw.hordePower}).`);
          // `?? []` : les rapports déjà enregistrés portent `null` là où le type
          // annonce un tableau (nil côté Go). Sans ça, une vague sans héros
          // touché levait une TypeError ICI — avalée par le catch du sondage, qui
          // sautait alors le renderMap() : la carte ne se redessinait plus.
          const hit = lw.heroesHit ?? [];
          if (hit.length) {
            pushLog(`⚔️ Hors ville : ${hit.map((h) => `${h.name} ${h.delta}`).join(", ")}.`);
          }
          if (lw.gameOver) pushLog("💀 La ville est tombée…");
          if (!catchUpBase) catchUpBase = { wave: prevWave, hp: prevHp };
        }
        if (!pending || !scheduleCatchUpPoll(next.id)) {
          // Rattrapé (ou borne atteinte) : c'est ICI, et une seule fois, qu'on
          // raconte au joueur ce qui est tombé sur sa ville.
          const base = catchUpBase;
          stopCatchUp();
          const lw = next.lastWave;
          if (base && lw && lw.wave > base.wave) {
            openWaveCinema(lw, lw.wave - base.wave, base.hp - next.town.hp);
          }
        }
        renderMap();
      } catch {
        // Sondage en échec (réseau, réveil de la fonction) : on coupe la boucle
        // rapide. Sans ça `catchingUp` restait vrai SANS plus personne pour
        // sonder — la barre du haut affichait « Rattrapage… » indéfiniment.
        stopCatchUp();
      }
    },

    dismissWaveCinema: () => set({ waveCinema: null }),

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
      set({ combatMode: m, aimUnitId: undefined }); // l'aperçu de zone appartient au mode
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

    // Survoler une cible peint la ZONE que le coup armé va réellement toucher
    // (le Fauchage éclabousse, l'attaque de base non). Pas de redraw inutile :
    // c'est appelé à chaque mouvement de souris sur la liste de cibles.
    setAimUnit: (unitId) => {
      if (get().aimUnitId === unitId) return;
      set({ aimUnitId: unitId });
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

    // Dégainer une autre arme du sac (game.SwapWeapon) : ça COÛTE le tour, comme
    // consommer un objet — c'est le prix de porter deux registres de combat.
    combatSwapWeapon: (name) =>
      withBusy(async () => {
        const { game, combat, current, playerId } = get();
        if (!game || !combat || !current) return;
        const resp = await api.combatAction(game.id, combat.id, {
          unitId: current.unitId,
          action: "swap",
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
