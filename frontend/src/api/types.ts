// TypeScript mirror of the Go API DTOs (kept in sync by hand for the prototype).

export enum Biome {
  Water = 0,
  Sand = 1,
  Grass = 2,
  Forest = 3,
  Mountain = 4,
  Snow = 5,
}

export interface Stats {
  force: number;
  dexterite: number;
  agilite: number;
  endurance: number;
  athletisme: number;
  precision: number;
}

// One line of the town journal (Panel building) — mirrors game.TownLogEntry.
export interface TownLogEntry {
  at: string; // RFC3339 timestamp
  day: number;
  text: string;
}

// One message of the town board — mirrors game.ChatMessage. It NEVER arrives in
// the game payload (ClientView strips it, only town.chatCount survives): reading
// is gated per player, so the content comes from GET /town/chat.
export interface ChatMessage {
  id: string;
  at: string; // RFC3339 timestamp
  day: number;
  playerId: string;
  author: string;
  text: string; // already moderated server-side
  filtered?: boolean; // moderation masked at least one word
  remote?: boolean; // sent from the field, through the Poste
}

export interface Item {
  type: string;
  name: string;
  qty: number;
}

export interface Tile {
  biome: Biome;
  height: number;
  resources: number;
  monsterId?: string;
  ruinId?: string; // ruine-donjon posée sur la case (voir Ruin)
  discovered?: boolean; // fog of war: false until a hero has seen the tile (shared by all players)
}

// Ruine-donjon : bâtiment en ruine par biome — chantier de déblayage collectif
// (PA partagés) puis donjon à charges au butin rare.
export interface Ruin {
  id: string;
  type: string; // ferme | epave | sanctuaire | mine | tour | memorial
  name: string;
  icon: string;
  x: number;
  y: number;
  clearPa: number;
  paInvested: number;
  cleared: boolean;
  charges: number;
  // MÉMORIAL : une ruine qui fut la ville d'une VRAIE expédition précédente. Elle porte
  // son nom, la vague qui l'a emportée et ceux qui l'ont défendue (game/ruins.go).
  fellAtWave?: number;
  defenders?: string[];
}

// L'épitaphe d'un mémorial — « Tombée à la vague 19, défendue par Ana, Bo et Zoé ».
// Vide pour une ruine ordinaire. Miroir de Ruin.Epitaph() côté serveur.
export function ruinEpitaph(r: Ruin): string {
  if (!r.fellAtWave) return "";
  const d = r.defenders ?? [];
  if (d.length === 0) return `Tombée à la vague ${r.fellAtWave}. Nul ne se souvient de ses défenseurs.`;
  const names = d.length === 1 ? d[0] : `${d.slice(0, -1).join(", ")} et ${d[d.length - 1]}`;
  return `Tombée à la vague ${r.fellAtWave}, défendue par ${names}.`;
}

export interface Hero {
  id: string;
  name: string;
  x: number;
  y: number;
  pa: number;
  maxPa: number;
  hp: number;
  maxHp: number;
  stats: Stats;
  class: string;
  states: string[];
  inventory: Item[];
  bars: Record<string, number>;
  drewWaterDay: number;
  // Échéance de la prochaine FOUILLE AUTOMATIQUE (absent = le héros n'est pas
  // installé à récolter). La première fouille, payée 1 PA, l'installe ; la suite
  // est jouée par la simulation serveur, même sans personne connecté.
  forageAt?: string; // RFC3339
  classId: string;
  classTier: number;
  classBonuses: Stats;
}

// Class-evolution catalog (mirrors backend internal/game/classes.go).
export interface ClassSkill {
  name: string;
  scope: "map" | "iso";
  pa: number; // activation cost (0 = passif)
  desc: string;
  effects?: string;
}

export interface ClassDef {
  id: string;
  name: string;
  tier: number; // 1 = intermediate, 2 = advanced
  day: number; // game.day gate
  requires: string[] | null; // parent class ids (any-of; empty = from Sans classe)
  role: string;
  bonuses: Stats;
  paBonus: number;
  skills: ClassSkill[];
  appearance: { map: string; icon: string }; // character asset files (char-*)
}

export interface Monster {
  id: string;
  species: string;
  appearance?: string; // monsters/ asset file (mob-*)
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  stats: Stats;
  count: number;
}

export interface BuildReq {
  pa: number;
  materials: Item[];
  plan?: string; // blueprint item name required to open a fresh site ("" for upgrades)
}

export interface TownBuilding {
  id: string;
  name: string;
  built: boolean;
  underConstruction: boolean; // an open chantier (plan laid; visible on Home)
  paInvested: number; // labour poured into the open chantier so far (cost.pa = total)
  level: number;
  durability: number;
  maxDurability: number;
  capacity: number;
  maxCapacity: number;
  open: boolean;
  defense: number;
  cost: BuildReq;
  requires?: { building: string; level: number }[]; // tech-tree prerequisites
}

export interface Recipe {
  id: string;
  name: string;
  category: string;
  building: string;
  buildingLevel: number; // minimum level of that building (town crafts)
  outputType: string;
  outputName?: string;
  outputQty?: number;
  field: boolean; // craftable outside town
  paCost: number;
  ingredients: Item[];
  effects?: string;
}


export interface WaveHit {
  id: string;
  name: string;
  delta: number;
}

export interface WaveReport {
  wave: number;
  day: number;
  hordePower: number;
  defense: number;
  townDamage: number;
  townHpAfter: number;
  buildingsHit: WaveHit[];
  heroesHit: WaveHit[];
  monstersSpawned: number;
  at: string;
  gameOver: boolean;
}

// A human participant in one game (lobby/multiplayer). Each player owns a team of
// 3 heroes (GDD: 1 joueur = 3 héros).
export interface Player {
  id: string;
  name: string;
  heroIds: string[];
  host: boolean;
  bot: boolean; // computer-controlled player (added by the host in the lobby)
  userId?: string; // linked account (multi-device reconnect)
  joinedAt: string;
}

// A user account ("savoir qui est qui"). Email+password today; provider leaves room
// for Google OAuth (free) — Apple Sign-In is paid and not planned.
export interface User {
  id: string;
  email: string;
  name: string;
  provider: string;
}

// GET /api/auth/me/games: my games with my player id, for any-device resume.
export interface MyGameSummary extends GameSummary {
  myPlayerId: string;
}

// Lightweight game listing DTO returned by GET /api/games. Join codes are never
// listed (private lobbies are joined by sharing their code out-of-band).
export interface GameSummary {
  id: string;
  name: string;
  status: "lobby" | "active" | "gameover";
  visibility: "private" | "public";
  players: Player[];
  minPlayers: number;
  maxPlayers: number;
  day: number;
  waveNumber: number;
  createdAt: string;
  // Fenêtre d'accueil : une expédition publique LANCÉE reste rejoignable quelques
  // vagues (game.PublicJoinGraceWaves côté serveur). joinWavesLeft ne vaut que pour
  // une partie déjà en cours — un salon vaut 0 parce qu'il n'a pas encore commencé.
  joinOpen: boolean;
  joinWavesLeft: number;
}

// Nature d'une partie au classement : les trois ne se comparent pas (un run solo
// avec 4 bots ne joue pas comme une expédition publique à quatre humains).
export type LeaderboardMode = "solo" | "public" | "private";

// One town's record on the leaderboard (GET /api/leaderboard[?mode=]): survival and
// monsters slain, kept server-side even after the game itself is purged.
export interface ScoreEntry {
  gameId: string;
  townName: string;
  gameName: string;
  mode: LeaderboardMode;
  players: string[];
  days: number;
  waves: number;
  monstersKilled: number;
  gameOver: boolean;
  updatedAt: string;
}

export interface GameState {
  id: string;
  name?: string;
  seed: number;
  width: number;
  height: number;
  tiles: Tile[];
  heroes: Hero[];
  monsters: Record<string, Monster>;
  day: number;
  wave: number;
  waveNumber: number;
  nextWaveAt: string;
  status: "lobby" | "active" | "gameover";
  joinCode?: string;
  visibility?: "private" | "public"; // absent/"private" = player-created; "public" = server-created, auto-starts
  solo?: boolean; // partie solo (1 humain + bots) — classée à part au leaderboard
  minPlayers: number;
  maxPlayers: number;
  players: Player[];
  createdAt: string;
  startedAt?: string;
  kickVotes?: Record<string, string[]>; // public lobbies: target player id -> voter ids
  lastWave?: WaveReport;
  monstersKilled: number; // total creatures slain (leaderboard achievement)
  town: {
    name: string; // generated town name (server-side, townnames.go)
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    defense: number;
    buildings: TownBuilding[];
    storage: Item[];
    waterDrawnToday: string[];
    // Town journal (Panel building): in-town actions, newest first, capped server-side.
    log?: TownLogEntry[];
    // How many messages the board holds. The messages THEMSELVES never ride this
    // payload (see ChatMessage) — this count only feeds the ✉️ unread pip.
    chatCount?: number;
    reviveDay?: number; // Townhall resurrections performed today (allowance = level)
    revivesToday?: number;
  };
  activeCombat?: string;
  combats?: Record<string, Combat>;
  ruins?: Record<string, Ruin>;
}

export interface CombatUnit {
  id: string;
  name: string;
  side: "hero" | "monster";
  refId: string;
  kind: string;
  classId?: string; // hero class id
  appearance?: string; // asset file for the sprite
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  stats: Stats;
  states: string[];
  move: number;
  initiative: number;
  fled?: boolean; // a quitté l'arène par le bord bas (lot C3)
  ownerId?: string; // joueur propriétaire du héros ("" / absent = partie legacy)
  fx: number; // Facing (lot C4) : direction regardée — l'arc arrière prend +25 %
  fy: number;
  size?: number; // lot C5 : 2 = boss 2×2 (ancre = coin haut-gauche)
}

// A combat ability with its GDD grids (mirrors backend AttackDef).
export interface Skill {
  name: string;
  kind: string; // "base" | "special"
  desc?: string;
  targets: { dx: number; dy: number }[] | null;
  damage: { dx: number; dy: number }[] | null;
  dmgStat?: string;
  bonus?: number;
  stunPct?: number;
  root?: boolean;
  absorb?: boolean;
  selfShield?: boolean;
  buffAllies?: boolean;
}

// Case d'arène (lot C1) : hauteur + terrain tactique.
export interface CombatCell {
  height: number;
  blocked?: boolean; // rocher/arbre : infranchissable
  hazard?: string; // "water" | "ice" | "brambles"
}

// Un coup structuré du dernier lot d'actions (lot C2 — dégâts flottants).
export interface CombatHit {
  unitId: string;
  amount: number; // toujours > 0
  kind: "dmg" | "heal" | "hazard";
}

// Butin d'un héros à la victoire (écran de victoire C2).
export interface CombatReward {
  heroId: string;
  heroName: string;
  items: Item[];
}

export interface Combat {
  id: string;
  gameId: string;
  tileX: number;
  tileY: number;
  biome: Biome;
  gridW: number;
  gridH: number;
  heights: number[];
  cells?: CombatCell[];
  units: CombatUnit[];
  order: string[];
  turnIdx: number;
  round: number;
  status: "active" | "won" | "lost" | "fled";
  log: string[];
  seq: number; // s'incrémente à chaque action — le client diffe pour animer lastHits
  lastHits?: CombatHit[];
  rewards?: CombatReward[];
  participants?: string[]; // joueurs présents — les héros des absents sont joués par l'IA
  // Lot C5 : fenêtre de renforts (vague 4+). (Le boss n'annonce plus ses
  // patterns — il attaque chaque tour, base ou spéciale.)
  wave?: number;
  reinforceAt?: number;
  reinforceDone?: boolean;
  turnDeadline?: string; // instant limite du tour humain courant (multi ≥2 présents) — anti-blocage
}

// Objet du sac utilisable en combat (lot C3) — servi par combatResponse.
export interface CombatItem {
  name: string;
  qty: number;
  heal: number;
}

// Fourchette de dégâts prévisualisée, calculée par le serveur (lot C2).
export interface DamageEstimate {
  min: number;
  max: number;
  rear?: number; // 1 = attaque de dos (+25 %, ignore la couverture) — lot C4
  cover?: number; // 1 = cible à couvert (−25 % à distance) — lot C4
}

// Une compétence iso jouable ce tour (une par bouton) — servie par combatResponse.
export interface CombatSkill {
  idx: number;
  skill: Skill;
  targets: string[];
  estimates?: Record<string, DamageEstimate>;
  selfCast: boolean; // capacité sur soi (ex. Posture défensive) — pas de cible
}

export interface CombatCurrent {
  unitId: string;
  reachable: [number, number][];
  attackTargets: string[];
  skillTargets: string[];
  skill: Skill;
  skills?: CombatSkill[]; // toutes les compétences iso du héros actif
  attackEstimates?: Record<string, DamageEstimate>;
  skillEstimates?: Record<string, DamageEstimate>;
  pushTargets?: string[]; // Poussée (C3) : ennemis alignés à portée
  items?: CombatItem[]; // objets consommables du sac du héros actif (C3)
}

// Compétence de carte par classe (catalogue /api/mapskills), remplace la boule de feu.
export interface MapSkillDef {
  id: string;
  classId: string; // "" = héros sans classe (compétence de base)
  name: string;
  icon: string;
  pa: number;
  desc: string;
  kind: "blast" | "snipe";
  base: number;
  stat: string;
  loot: boolean;
}

export interface MapSkillReport {
  skillId: string;
  name: string;
  monsterId: string;
  species: string;
  damage: number;
  slain: number;
  killed: boolean;
  loot?: string;
  x: number;
  y: number;
}

// Cases menacées par un ennemi depuis sa position (télégraphie orange, lot C2).
export interface CombatThreat {
  unitId: string;
  cells: [number, number][];
}

export interface CombatResponse {
  combat: Combat;
  game: GameState;
  current?: CombatCurrent;
  threats?: CombatThreat[];
}
