import type { TaxLevel } from '@bitopolis/shared';
import { chance, type RngState, seedRng } from './prng.ts';

/** Sube con cada cambio de forma del estado; ver migrations.ts. */
export const FORMAT_VERSION = 2;

export const MAP_W = 48;
export const MAP_H = 48;

/** Capa de suelo: índice por tile (y * w + x). */
export const Tile = { Grass: 0, Road: 1, Tree: 2 } as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

/** Capa de zonas. */
export const Zone = { None: 0, R: 1, C: 2, I: 3 } as const;
export type Zone = (typeof Zone)[keyof typeof Zone];

export type BuildingKind =
  | 'townhall'
  | 'water'
  | 'power'
  | 'park'
  | 'school'
  | 'clinic'
  | 'house'
  /** Crecen solos sobre zonas. */
  | 'res'
  | 'shop'
  | 'factory';

export interface Building {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  /** Propietario: 0 = ayuntamiento, -1 = inversor de fuera, otro = vecino. */
  owner: number;
  /** Caja propia (empresas). Euros enteros ≥ 0. */
  cash: number;
  /** false mientras es una obra. */
  built: boolean;
  /** Servicios recibidos por red (se recalculan cada día). */
  hasWater: boolean;
  hasPower: boolean;
  /** Meses seguidos sin poder pagar nóminas (empresas). */
  unpaidMonths: number;
}

/** Obra en curso: necesita obreros × días. */
export interface Project {
  buildingId: number;
  /** Quién paga la mano de obra: 0 ayuntamiento, -1 inversor de fuera. */
  payer: number;
  workersNeeded: number;
  workerDaysNeeded: number;
  workerDaysDone: number;
  /** Ids de vecinos trabajando hoy en la obra. */
  crew: number[];
  /** Obreros de fuera contratados hoy. */
  outsideToday: number;
  notify: boolean;
}

export interface Citizen {
  id: number;
  name: string;
  age: number;
  /** Euros enteros; nunca negativo. */
  money: number;
  homeId: number | null;
  /** Edificio donde trabaja, o null. */
  jobId: number | null;
  /** 0–100, con inercia. */
  happiness: number;
  /** Mes en que llegó. */
  arrivedMonth: number;
}

export type EventKind =
  | 'arrival'
  | 'departure'
  | 'built'
  | 'project'
  | 'bankrupt'
  | 'business'
  | 'tax'
  | 'warning'
  | 'info';

export interface GameEvent {
  tick: number;
  kind: EventKind;
  text: string;
  /** Edificio o vecino relacionado (para centrar la cámara). */
  ref?: number;
  /** El jugador pidió aviso. */
  notify?: boolean;
}

export interface MonthStat {
  month: number;
  population: number;
  treasury: number;
  happiness: number;
  income: number;
  expenses: number;
  /** Desglose del mes (por concepto). */
  breakdown: Record<string, number>;
}

export interface GameState {
  formatVersion: number;
  seed: number;
  rng: RngState;
  /** Horas de juego transcurridas. */
  tick: number;
  map: { w: number; h: number; tiles: number[]; zones: number[] };
  /** Caja del ayuntamiento. Negativa = deuda municipal. */
  treasury: number;
  taxLevel: TaxLevel;
  citizens: Citizen[];
  buildings: Building[];
  projects: Project[];
  nextId: number;
  /** Contabilidad para la invariante de conservación del dinero. */
  ledger: { initialTotal: number; externalIn: number; externalOut: number };
  /** Acumuladores del mes en curso (se vuelcan a stats). */
  month: {
    income: number;
    expenses: number;
    breakdown: Record<string, number>;
    /** Suma diaria del tipo impositivo: el tipo efectivo del mes es la media. */
    taxRateSum: number;
    taxDays: number;
  };
  /** Demanda RCI de -100 a 100 (se recalcula cada día). */
  demand: { R: number; C: number; I: number };
  /** Meses seguidos con deuda por encima del límite. */
  debtMonths: number;
  bankrupt: boolean;
  events: GameEvent[];
  stats: MonthStat[];
}

export interface NewGameOptions {
  seed: number;
}

export const INITIAL_SUBSIDY = 30_000;

export function createInitialState({ seed }: NewGameOptions): GameState {
  const rng = seedRng(seed);
  const tiles = new Array<number>(MAP_W * MAP_H).fill(Tile.Grass);
  const zones = new Array<number>(MAP_W * MAP_H).fill(Zone.None);
  const state: GameState = {
    formatVersion: FORMAT_VERSION,
    seed,
    rng,
    tick: 0,
    map: { w: MAP_W, h: MAP_H, tiles, zones },
    treasury: 0,
    taxLevel: 'medium',
    citizens: [],
    buildings: [],
    projects: [],
    nextId: 1,
    ledger: { initialTotal: 0, externalIn: 0, externalOut: 0 },
    month: { income: 0, expenses: 0, breakdown: {}, taxRateSum: 0, taxDays: 0 },
    demand: { R: 50, C: 0, I: 10 },
    debtMonths: 0,
    bankrupt: false,
    events: [],
    stats: [],
  };
  // Árboles dispersos (se talan gratis al construir encima).
  for (let i = 0; i < tiles.length; i++) {
    if (chance(rng, 0.07)) tiles[i] = Tile.Tree;
  }
  const cx = Math.floor(MAP_W / 2);
  const cy = Math.floor(MAP_H / 2);
  // Calle inicial delante del ayuntamiento.
  for (let x = cx - 3; x <= cx + 3; x++) tiles[cy * MAP_W + x] = Tile.Road;
  const hall = newBuilding(state, 'townhall', cx, cy - 1, 0);
  hall.built = true;
  tiles[hall.y * MAP_W + hall.x] = Tile.Grass;
  // Despejar alrededor del centro para que el comienzo sea legible.
  for (let y = cy - 2; y <= cy + 2; y++) {
    for (let x = cx - 4; x <= cx + 4; x++) if (tiles[y * MAP_W + x] === Tile.Tree) tiles[y * MAP_W + x] = Tile.Grass;
  }
  const first: Citizen = {
    id: state.nextId++,
    name: 'Lucía',
    age: 34,
    money: 1_500,
    homeId: null,
    jobId: hall.id,
    happiness: 60,
    arrivedMonth: 0,
  };
  state.citizens.push(first);
  state.treasury = INITIAL_SUBSIDY;
  state.ledger.initialTotal = INITIAL_SUBSIDY + first.money;
  pushEvent(state, 'info', 'La región aporta una subvención inicial de 30.000 €');
  return state;
}

export function newBuilding(state: GameState, kind: BuildingKind, x: number, y: number, owner: number): Building {
  const b: Building = {
    id: state.nextId++,
    kind,
    x,
    y,
    owner,
    cash: 0,
    built: false,
    hasWater: false,
    hasPower: false,
    unpaidMonths: 0,
  };
  state.buildings.push(b);
  return b;
}

export function tileIndex(state: GameState, x: number, y: number): number {
  return y * state.map.w + x;
}

export function inBounds(state: GameState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.map.w && y < state.map.h;
}

export function buildingAt(state: GameState, x: number, y: number): Building | undefined {
  return state.buildings.find((b) => b.x === x && b.y === y);
}

export function buildingById(state: GameState, id: number): Building | undefined {
  return state.buildings.find((b) => b.id === id);
}

export function pushEvent(
  state: GameState,
  kind: EventKind,
  text: string,
  extra: { ref?: number; notify?: boolean } = {},
): void {
  state.events.push({ tick: state.tick, kind, text, ...extra });
  if (state.events.length > 200) state.events.splice(0, state.events.length - 200);
}

export const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function hasAdjacentRoad(state: GameState, x: number, y: number): boolean {
  return DIRS.some(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    return inBounds(state, nx, ny) && state.map.tiles[tileIndex(state, nx, ny)] === Tile.Road;
  });
}
