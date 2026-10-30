import type { TaxLevel } from '@bitopolis/shared';
import { chance, type RngState, seedRng } from './prng.ts';

/** Sube con cada cambio de forma del estado; ver migrations.ts. */
export const FORMAT_VERSION = 1;

export const MAP_W = 48;
export const MAP_H = 48;

/** Capa de suelo: índice por tile (y * w + x). */
export const Tile = { Grass: 0, Road: 1, Tree: 2 } as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export type BuildingKind = 'townhall' | 'house' | 'water' | 'power';

export interface Building {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  /** Propietario: 0 = ayuntamiento, otro = id de vecino. */
  owner: number;
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
}

export interface GameEvent {
  tick: number;
  kind: 'arrival' | 'departure' | 'built' | 'bankrupt' | 'tax' | 'info';
  text: string;
}

export interface MonthStat {
  month: number;
  population: number;
  treasury: number;
  happiness: number;
  income: number;
  expenses: number;
}

export interface GameState {
  formatVersion: number;
  seed: number;
  rng: RngState;
  /** Horas de juego transcurridas. */
  tick: number;
  map: { w: number; h: number; tiles: number[] };
  /** Caja del ayuntamiento. Negativa = deuda municipal. */
  treasury: number;
  taxLevel: TaxLevel;
  citizens: Citizen[];
  buildings: Building[];
  nextId: number;
  /** Contabilidad para la invariante de conservación del dinero. */
  ledger: { initialTotal: number; externalIn: number; externalOut: number };
  /** Acumuladores del mes en curso (se vuelcan a stats). */
  month: { income: number; expenses: number };
  /** Meses seguidos con deuda por encima del límite. */
  debtMonths: number;
  bankrupt: boolean;
  events: GameEvent[];
  stats: MonthStat[];
}

export interface NewGameOptions {
  seed: number;
}

export const INITIAL_SUBSIDY = 20_000;

export function createInitialState({ seed }: NewGameOptions): GameState {
  const rng = seedRng(seed);
  const tiles = new Array<number>(MAP_W * MAP_H).fill(Tile.Grass);
  const state: GameState = {
    formatVersion: FORMAT_VERSION,
    seed,
    rng,
    tick: 0,
    map: { w: MAP_W, h: MAP_H, tiles },
    treasury: 0,
    taxLevel: 'medium',
    citizens: [],
    buildings: [],
    nextId: 1,
    ledger: { initialTotal: 0, externalIn: 0, externalOut: 0 },
    month: { income: 0, expenses: 0 },
    debtMonths: 0,
    bankrupt: false,
    events: [],
    stats: [],
  };
  // Árboles dispersos (decorativos, se talan al construir).
  for (let i = 0; i < tiles.length; i++) {
    if (chance(rng, 0.07)) tiles[i] = Tile.Tree;
  }
  const cx = Math.floor(MAP_W / 2);
  const cy = Math.floor(MAP_H / 2);
  // Calle inicial delante del ayuntamiento.
  for (let x = cx - 4; x <= cx + 4; x++) tiles[cy * MAP_W + x] = Tile.Road;
  const hall: Building = { id: state.nextId++, kind: 'townhall', x: cx, y: cy - 1, owner: 0 };
  state.buildings.push(hall);
  tiles[hall.y * MAP_W + hall.x] = Tile.Grass;
  const first: Citizen = {
    id: state.nextId++,
    name: 'Lucía',
    age: 34,
    money: 1_500,
    homeId: null,
    jobId: hall.id,
    happiness: 60,
  };
  state.citizens.push(first);
  state.treasury = INITIAL_SUBSIDY;
  state.ledger.initialTotal = INITIAL_SUBSIDY + first.money;
  return state;
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

export function pushEvent(state: GameState, kind: GameEvent['kind'], text: string): void {
  state.events.push({ tick: state.tick, kind, text });
  if (state.events.length > 200) state.events.splice(0, state.events.length - 200);
}
