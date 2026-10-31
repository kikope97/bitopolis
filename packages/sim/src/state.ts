import type { MinWageLevel } from './balance.ts';
import type { TownAi } from './turns.ts';
import { TICKS_PER_DAY, type TaxLevel } from '@bitopolis/shared';
import { emptyFields, type Fields } from './fields.ts';
import { chance, nextInt, type RngState, seedRng } from './prng.ts';
import type { Goal, Hook, Memory, Pleno, PromiseRecord, Relation } from './social.ts';
import { emptyPolitics, type Politics } from './politics-core.ts';
import { generateTerrain, isWater, Terrain } from './terrain.ts';
import type { Weather } from './weather.ts';
import type { Association } from './associations.ts';
import type { Moment } from './album.ts';
import type { Departed } from './family.ts';
// Solo el tipo: importar crime.ts aquí crea un ciclo al cargar (crime → social → commands → state).
import type { Justice } from './crime.ts';

/** Sube con cada cambio de forma del estado; ver migrations.ts. */
export const FORMAT_VERSION = 13;

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
  | 'police'
  | 'plaza'
  | 'market'
  /** v1.7: lugares de vida social. */
  | 'bar'
  | 'chapel'
  | 'cemetery'
  | 'library'
  | 'sports'
  | 'jail'
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
  /** v1.9: ventas del mes en curso y cuentas del mes pasado (salud de las empresas). */
  sales?: number;
  books?: { sales: number; wages: number; taxes: number };
  /** Ronda 15: plantilla a la que se ha recortado (si pierde dinero). */
  staff?: number;
  /** false mientras es una obra. */
  built: boolean;
  /** Servicios recibidos por red (se recalculan cada día). */
  hasWater: boolean;
  hasPower: boolean;
  /** v1.8: días seguidos sin agua / sin luz (para el icono de problema duradero). */
  dryDays?: number;
  darkDays?: number;
  /** v1.8: dañado en unos disturbios: no funciona hasta que se repara. */
  damaged?: { cost: number; repairUntil: number };
  /** v1.8: nivel del servicio (1–3; sin definir = 1) y fin de la obra de mejora. */
  level?: number;
  upgradeUntil?: number;
  /** Meses seguidos sin poder pagar nóminas (empresas). */
  unpaidMonths: number;
  /** Nombre propio (empresas fundadas por vecinos: «Panadería de Lucía»). */
  name?: string;
  /** Casa municipal a la venta (si no, en alquiler). */
  forSale?: boolean;
  /** Viviendas de una casa municipal que ya no son del ayuntamiento. */
  privateUnits?: number;
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
  /** Vecino con nombre: decide con IA (Modo IA) o con reglas narrativas. */
  named: boolean;
  /** Rasgos fijos 0–100. `terco` es la terquedad o irracionalidad. */
  traits: Traits;
  desire: Desire;
  fear: Fear;
  /** Profesión (de una lista del motor). */
  profession: string;
  /** Meta personal (derivada de su deseo). */
  goal: Goal;
  /** Relaciones con nombre (amistad, rivalidad, pareja, rencor). */
  relations: Relation[];
  /** Recuerdos (capa 2): plantillas del motor, máx. 5, por importancia. */
  memories: Memory[];
  /** Resumen narrativo (capa 3), se reescribe cada mes. */
  summary: string;
  /** No se le vuelve a preguntar antes de este tick. */
  cooldownUntil: number;
  /** Es dueño de la vivienda en la que vive. */
  owns: boolean;
  /** Precio al que la compró (para la plusvalía). */
  boughtPrice: number;
  /** Lo que le queda por pagar de hipoteca. */
  mortgage: number;
  /** A quién se la paga: 0 = ayuntamiento (vivienda municipal), -1 = banco. */
  mortgageTo: number;
  /** Su vivienda fue municipal: la reventa tiene precio máximo. */
  subsidized: boolean;
  /** v1.5: hijos que viven en casa (tick de nacimiento); a los 18 se independizan. */
  kids?: number[];
  /** Tick en que compró (no se revende con ganancia antes de 90 días). */
  boughtTick: number;
  /** Memoria de las subidas de impuestos (0–40): resta felicidad y se olvida despacio. */
  grudge: number;
  /** Voto decidido antes de las elecciones (solo vecinos con nombre; se borra al votar). */
  vote?: 'gobierno' | 'oposicion' | 'abstencion';
  /** v1.7: padres (si nació en el pueblo), para el árbol genealógico. */
  parents?: number[];
  /** v1.7: decisión sobre la manifestación de la asociación `id`: `id` si va, `-id` si no. */
  protest?: number;
  /** v1.9: lo que debe (al ayuntamiento y al banco o casero). Ver household.ts. */
  debt?: CitizenDebt;
  /** v1.9: ingresos y gastos del mes en curso [entra, sale] (los anota transfer). */
  flow?: [number, number];
  /** v1.9: el mes pasado: lo que entró, salió y devolvió de deudas. */
  last?: { in: number; out: number; repaid: number; owed?: number; grew?: number };
  /** v1.9: antecedentes penales (ladrones del pueblo). */
  record?: number;
  /** v1.9: meses seguidos sin pagar todo el alquiler privado / la hipoteca. */
  rentArrears?: number;
  missedQuotas?: number;
  /** v1.9: en paro (sin trabajo ni en el pueblo ni fuera): desde qué tick, y meses de prestación que le quedan. */
  unemployedSince?: number;
  benefitLeft?: number;
  /** v1.9: última vez que decidió qué hacer con sus deudas (tick). */
  debtAsked?: number;
  /** v1.9: tras un desahucio, nadie le alquila hasta este tick; tras un embargo, no puede comprar hasta este tick. */
  evictedUntil?: number;
  seizedUntil?: number;
  /** v1.9 (ronda 15): tras cerrar su negocio, no abre otro hasta este tick. */
  closedUntil?: number;
  /** 2.0: lo que decide la IA en cada turno (actitud hacia el alcalde −2…2, dónde gasta, su plan y lo que piensa). */
  attitude?: number;
  spending?: { where: 'pueblo' | 'fuera' | 'ahorrar'; shop?: number; leisure: boolean };
  plan?: { kind: 'irse_si_no' | 'protestar_si_no' | 'votar_en_contra_si_no'; need: string; until: number; since: number };
  thought?: string;
}

export interface CitizenDebt {
  /** Con el ayuntamiento (impuestos, tasas, alquiler municipal, multas, microcréditos). */
  town: number;
  /** Con el banco o el casero (de fuera). */
  bank: number;
  /** Desde cuándo debe (tick). */
  since: number;
  /** Deuda con el ayuntamiento nacida este mes y el anterior (para el recargo único). */
  fresh: number;
  aged: number;
  /** Aplazamiento concedido por el alcalde: cuota fija sin recargo hasta `until`. */
  plan?: { perMonth: number; until: number; kind?: 'aplazamiento' | 'microcredito' };
  /** v1.9.1: cuándo pidió al alcalde un aplazamiento (tick) que aún no tiene respuesta. */
  askedAt?: number;
}

export type TaxKey = 'ibi' | 'tasas' | 'plusvalia';

export interface Traits {
  terco: number;
  ahorro: number;
  social: number;
  ambicion: number;
}

export const DESIRES = ['trabajo_cerca', 'casa_propia', 'parque', 'tienda', 'tranquilidad', 'prosperar'] as const;
export type Desire = (typeof DESIRES)[number];
export const FEARS = ['paro', 'impuestos', 'soledad', 'ruido', 'deudas'] as const;
export type Fear = (typeof FEARS)[number];

/** Decisión pendiente de un vecino con nombre (detonante + acciones válidas). */
export interface Pending {
  citizenId: number;
  trigger: Trigger;
  actions: string[];
  createdTick: number;
  /** Si a este tick no ha llegado decisión (IA), decide la regla. */
  dueTick: number;
}

export type Trigger = 'llegada' | 'sin_trabajo' | 'infeliz' | 'subida_impuestos' | 'ahorros' | 'opinion' | 'comprar_casa' | 'emprender' | 'elecciones' | 'protesta' | 'deudas';

export interface DecisionLogEntry {
  tick: number;
  citizenId: number;
  trigger: Trigger;
  action: string;
  motivo: string;
  source: 'ai' | 'rule';
}

export type EventKind =
  | 'arrival'
  | 'departure'
  | 'built'
  | 'project'
  | 'bankrupt'
  | 'business'
  | 'tax'
  | 'decision'
  | 'milestone'
  | 'warning'
  | 'politics'
  | 'election'
  /** v1.7: manifestación ante el ayuntamiento (ref = id de la asociación). */
  | 'protest'
  /** v1.8: robos, detenciones y disturbios. */
  | 'crime'
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
  /** v1.9: impagos al ayuntamiento del mes, lo que le deben al cerrar, vecinos con deudas y en paro. */
  unpaid?: number;
  owed?: number;
  debtors?: number;
  jobless?: number;
  /** v1.9: salud de las empresas: margen medio, cuántas pierden dinero y sueldo medio en el pueblo. */
  margin?: number;
  losing?: number;
  wage?: number;
  businesses?: number;
  closures?: number;
  layoffs?: number;
}

export interface GameState {
  formatVersion: number;
  seed: number;
  rng: RngState;
  /** Horas de juego transcurridas. */
  tick: number;
  /** terrain (v1.7): 0 llano, 1 río, 2 mar, 3 colina (ver terrain.ts). */
  map: { w: number; h: number; tiles: number[]; zones: number[]; terrain: number[] };
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
    /** v1.9: lo que los vecinos no han podido pagar al ayuntamiento este mes, y lo que se da por perdido. */
    unpaid?: number;
    writtenOff?: number;
    /** Ronda 15: empresas que cerraron y despidos de este mes. */
    closures?: number;
    layoffs?: number;
    /** Suma diaria de los tipos: el tipo efectivo del mes es la media. */
    rateSums: Record<TaxKey, number>;
    taxDays: number;
  };
  /** Demanda RCI de -100 a 100 (se recalcula cada día). */
  demand: { R: number; C: number; I: number };
  /** Meses seguidos con deuda por encima del límite. */
  debtMonths: number;
  bankrupt: boolean;
  events: GameEvent[];
  stats: MonthStat[];
  /** Modo IA: las decisiones de los vecinos con nombre pueden venir del LLM. */
  aiMode: boolean;
  /** Máximo de vecinos con nombre. */
  namedLimit: number;
  pending: Pending[];
  decisionLog: DecisionLogEntry[];
  /** Nivel de impuestos al cerrar el día anterior (detonante de subidas). */
  prevTaxLevel: TaxLevel;
  /** Tributos separados (activos desde 50 vecinos). */
  taxes: Record<TaxKey, TaxLevel>;
  taxesSplit: boolean;
  prevTaxes: Record<TaxKey, TaxLevel>;
  /** Externalidades por casilla. */
  fields: Fields;
  /** Director de historias: ganchos activos. */
  hooks: Hook[];
  pleno: Pleno | null;
  promises: PromiseRecord[];
  lastPlenoTick: number;
  objectivesDone: string[];
  /** Edificios desbloqueados por hitos (plaza, mercado). */
  unlocked: string[];
  /** Elecciones, facciones y oposición (v1.0). */
  politics: Politics;
  /** v1.5: presupuesto del año, fiestas del pueblo y subvenciones de la Diputación. */
  budget: Budget;
  festival: Festival;
  grants: Grant[];
  /** v1.7: tiempo de hoy y hasta cuándo dura. */
  weather: Weather;
  /** v1.7: asociaciones vecinales. */
  associations: Association[];
  /** v1.7: momentos del álbum y fichas de quien ya no está (árbol genealógico). */
  album: Moment[];
  departed: Departed[];
  /** v1.8: nivel del ayuntamiento (1–5): desbloquea edificios y partes del juego. */
  townhallLevel: number;
  /** 2.0: turnos del pueblo con IA (solo en Modo IA). */
  ai?: TownAi;
  /** v1.9: sueldo mínimo obligatorio para las empresas del pueblo. */
  minWage: MinWageLevel;
  /** v1.9: contabilidad de la deuda de los vecinos (conservación: deuda viva = altas − pagos − incobrables − perdonadas). */
  debtLedger: { created: number; repaid: number; written: number; forgiven: number };
  /** v1.8: calabozos, cárcel y robos. */
  justice: Justice;
  /** Última despedida (como mucho una por semana). */
  lastDeathTick?: number;
}

export type BudgetPlan = 'austero' | 'equilibrado' | 'inversor';
export interface Budget {
  year: number;
  /** El plan en vigor (el aprobado o, si no, el prorrogado). */
  plan: BudgetPlan;
  /** open: enero, por aprobar; approved; prorrogado (rechazado o sin presentar). */
  status: 'open' | 'approved' | 'prorrogado';
  votesFor: number;
  votesAgainst: number;
}
export interface Festival {
  /** Nombre que le pusieron los vecinos (la primera vez). */
  name: string | null;
  /** Último año con fiestas. */
  year: number;
  size: 'none' | 'pequena' | 'grande' | 'popular';
  /** Mientras dure el buen recuerdo de las fiestas. */
  until: number;
}
export interface Grant {
  id: number;
  kind: BuildingKind;
  /** Parte del coste que paga la Diputación (0–1). */
  share: number;
  offeredTick: number;
  deadline: number;
  status: 'offered' | 'accepted' | 'paid' | 'expired' | 'declined';
  advance: number;
  /** Solo cuentan las obras empezadas después de aceptar (ids desde aquí). */
  minId: number;
}

export interface NewGameOptions {
  seed: number;
  aiMode?: boolean;
  namedLimit?: number;
  /** 2.0: % de vecinos con IA (Modo IA). */
  aiShare?: number;
}

export const INITIAL_SUBSIDY = 30_000;

export function createInitialState({ seed, aiMode = false, namedLimit = 20, aiShare = 50 }: NewGameOptions): GameState {
  const rng = seedRng(seed);
  const tiles = new Array<number>(MAP_W * MAP_H).fill(Tile.Grass);
  const zones = new Array<number>(MAP_W * MAP_H).fill(Zone.None);
  // v1.7: río, costa y colinas (el centro queda en llano).
  const terrain = generateTerrain(rng, MAP_W, MAP_H);
  const state: GameState = {
    formatVersion: FORMAT_VERSION,
    seed,
    rng,
    tick: 0,
    map: { w: MAP_W, h: MAP_H, tiles, zones, terrain },
    treasury: 0,
    taxLevel: 'medium',
    citizens: [],
    buildings: [],
    projects: [],
    nextId: 1,
    ledger: { initialTotal: 0, externalIn: 0, externalOut: 0 },
    month: { income: 0, expenses: 0, breakdown: {}, rateSums: { ibi: 0, tasas: 0, plusvalia: 0 }, taxDays: 0 },
    demand: { R: 50, C: 0, I: 10 },
    debtMonths: 0,
    bankrupt: false,
    events: [],
    stats: [],
    aiMode,
    namedLimit,
    pending: [],
    decisionLog: [],
    prevTaxLevel: 'medium',
    taxes: { ibi: 'medium', tasas: 'medium', plusvalia: 'medium' },
    taxesSplit: false,
    prevTaxes: { ibi: 'medium', tasas: 'medium', plusvalia: 'medium' },
    fields: emptyFields(MAP_W * MAP_H),
    hooks: [],
    pleno: null,
    promises: [],
    lastPlenoTick: -1,
    objectivesDone: [],
    unlocked: [],
    politics: emptyPolitics(),
    budget: { year: 1, plan: 'equilibrado', status: 'approved', votesFor: 0, votesAgainst: 0 },
    festival: { name: null, year: 0, size: 'none', until: 0 },
    grants: [],
    weather: { kind: 'sol', until: 2 * 24 },
    associations: [],
    album: [],
    departed: [],
    justice: { cells: [], jail: [], hot: [], robberies: 0, arrests: 0, fullWarned: -1 },
    townhallLevel: 1,
    // 2.0: turnos del pueblo con IA (en línea: turns.ts importa este módulo).
    ...(aiMode
      ? { ai: { share: Math.max(0, Math.min(100, Math.round(aiShare))), paceDays: 7, turn: null, lastN: 0, next: 7 * TICKS_PER_DAY, mayor: [], quick: null, lastQuick: -1e9, log: [] } }
      : {}),
    minWage: 'none',
    debtLedger: { created: 0, repaid: 0, written: 0, forgiven: 0 },
  };
  // Árboles dispersos (se talan gratis al construir encima).
  for (let i = 0; i < tiles.length; i++) {
    if (isWater(terrain[i])) continue;
    if (chance(rng, terrain[i] === Terrain.Hill ? 0.22 : 0.07)) tiles[i] = Tile.Tree;
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
    named: true,
    traits: randomTraits(rng),
    desire: 'prosperar',
    fear: 'paro',
    cooldownUntil: 0,
    ...NO_PROPERTY,
    profession: 'administrativa',
    goal: 'ahorrar',
    relations: [],
    memories: [{ tick: 0, kind: 'llego', about: [], importance: 2, valence: 0 }],
    summary: '',
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

export function randomTraits(rng: RngState): Traits {
  return { terco: nextInt(rng, 0, 100), ahorro: nextInt(rng, 0, 100), social: nextInt(rng, 0, 100), ambicion: nextInt(rng, 0, 100) };
}

export const NO_PROPERTY = { owns: false, boughtPrice: 0, mortgage: 0, mortgageTo: -1, subsidized: false, boughtTick: 0, grudge: 0 } as const;

/** Terreno de una casilla (v1.7). */
export function terrainAt(state: GameState, x: number, y: number): number {
  return state.map.terrain?.[y * state.map.w + x] ?? 0;
}
