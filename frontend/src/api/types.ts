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
  type: string; // ferme | epave | sanctuaire | mine | tour
  name: string;
  icon: string;
  x: number;
  y: number;
  clearPa: number;
  paInvested: number;
  cleared: boolean;
  charges: number;
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

export interface FireballReport {
  monsterId: string;
  species: string;
  damage: number;
  slain: number; // creatures removed from the pack by this cast
  killed: boolean; // the whole pack was destroyed
  x: number;
  y: number;
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
  minPlayers: number;
  maxPlayers: number;
  players: Player[];
  createdAt: string;
  startedAt?: string;
  kickVotes?: Record<string, string[]>; // public lobbies: target player id -> voter ids
  lastWave?: WaveReport;
  town: {
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
  status: "active" | "won" | "lost";
  log: string[];
}

export interface CombatCurrent {
  unitId: string;
  reachable: [number, number][];
  attackTargets: string[];
  skillTargets: string[];
  skill: Skill;
}

export interface CombatResponse {
  combat: Combat;
  game: GameState;
  current?: CombatCurrent;
}
