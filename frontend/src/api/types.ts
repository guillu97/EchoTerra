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
  discovered?: boolean; // fog of war: false until a hero has seen the tile (shared by all players)
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
  desc: string;
}

export interface ClassDef {
  id: string;
  name: string;
  tier: number; // 1 = intermediate, 2 = advanced
  role: string;
  bonuses: Stats;
  paBonus: number;
  skills: ClassSkill[];
}

export interface Monster {
  id: string;
  species: string;
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
  underConstruction: boolean; // site whose build has been started (visible on Home as a chantier)
  level: number;
  durability: number;
  maxDurability: number;
  capacity: number;
  maxCapacity: number;
  open: boolean;
  defense: number;
  cost: BuildReq;
}

export interface Recipe {
  id: string;
  name: string;
  category: string;
  building: string;
  outputType: string;
  field: boolean; // craftable outside town
  paCost: number;
  ingredients: Item[];
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

export interface GameState {
  id: string;
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
  status: "active" | "gameover";
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
  };
  activeCombat?: string;
  combats?: Record<string, Combat>;
}

export interface CombatUnit {
  id: string;
  name: string;
  side: "hero" | "monster";
  refId: string;
  kind: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  stats: Stats;
  states: string[];
  move: number;
  initiative: number;
}

export interface Skill {
  name: string;
  range: number;
  kind: "melee" | "ranged";
  effect: string;
}

export interface Combat {
  id: string;
  gameId: string;
  tileX: number;
  tileY: number;
  gridW: number;
  gridH: number;
  heights: number[];
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
