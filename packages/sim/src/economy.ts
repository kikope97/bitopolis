import { TICKS_PER_MONTH, type TaxLevel } from '@bitopolis/shared';
import {
  TAX_RELIEF_DAYS,
  BUSINESS_CASH_CAP,
  DOWN_PAYMENT,
  FOUND_CHANCE,
  FOUND_COST,
  FOUND_MIN_MONEY,
  FOUND_SEED,
  GROWTH,
  GRUDGE_DECAY,
  GRUDGE_MAX,
  GRUDGE_RAISE,
  HOMES,
  JOBS,
  IBI_MOOD_OWNER,
  IBI_MOOD_RENTER,
  IBI_RATE,
  MORTGAGE_INTEREST,
  MORTGAGE_MONTHS,
  MUNICIPAL_PRICE_CAP,
  MUNICIPAL_RENT,
  PLUSVALIA_MOOD_OWNER,
  PLUSVALIA_RATE,
  PRIVATE_RENT,
  PROPERTY_VALUE,
  RESALE_LOCK_TICKS,
  SHOP_NAMES,
  SHOP_TYPES,
  TASA_BASURAS,
  TASA_TERRAZAS,
  TASAS_MOOD,
  TAX_SPLIT_POP,
  TRANSACTION_COST,
  BUY_CHANCE,
  SERVICE_CAPACITY,
  DEBT,
  MIN_WAGE,
  MIN_WAGE_STEP,
  MIN_WAGE_FX,
} from './balance.ts';
import { hash32 } from './hash.ts';
import { charge, totalDebt } from './household.ts';
import { radiusOf, serviceCapacityOf } from './levels.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { chance } from './prng.ts';
import { addMemory, onBusinessFounded } from './social.ts';
import {
  type Building,
  type BuildingKind,
  type Citizen,
  DIRS,
  type GameState,
  inBounds,
  newBuilding,
  pushEvent,
  type TaxKey,
  Tile,
  tileIndex,
  Zone,
} from './state.ts';

/* ---------------- niveles y tipos ---------------- */

const LEVEL_INDEX: Record<TaxLevel, number> = { low: 0, medium: 1, high: 2 };
export const TAX_KEYS: TaxKey[] = ['ibi', 'tasas', 'plusvalia'];

/** Niveles efectivos: antes de 50 vecinos, los tres siguen al impuesto único. */
export function taxLevels(state: GameState): Record<TaxKey, TaxLevel> {
  return state.taxesSplit ? state.taxes : { ibi: state.taxLevel, tasas: state.taxLevel, plusvalia: state.taxLevel };
}

/** Interpola una tabla low/medium/high con un nivel medio 0–2. */
function lerp(table: Record<TaxLevel, number>, avg: number): number {
  return avg <= 1 ? table.low + (table.medium - table.low) * avg : table.medium + (table.high - table.medium) * (avg - 1);
}

/** Al cerrar el día: suma los niveles (el tipo del mes es la media). */
export function accumulateRates(state: GameState): void {
  const lv = taxLevels(state);
  for (const k of TAX_KEYS) state.month.rateSums[k] += LEVEL_INDEX[lv[k]];
  state.month.taxDays += 1;
}

export interface MonthRates {
  ibi: number;
  basuras: number;
  terrazas: number;
  plusvalia: number;
}

export function monthRates(state: GameState): MonthRates {
  const lv = taxLevels(state);
  const avg = (k: TaxKey) => (state.month.taxDays > 0 ? state.month.rateSums[k] / state.month.taxDays : LEVEL_INDEX[lv[k]]);
  return {
    ibi: lerp(IBI_RATE, avg('ibi')),
    basuras: Math.round(lerp(TASA_BASURAS, avg('tasas'))),
    terrazas: Math.round(lerp(TASA_TERRAZAS, avg('tasas'))),
    plusvalia: lerp(PLUSVALIA_RATE, avg('plusvalia')),
  };
}

/** A partir de 50 vecinos se separan los tributos (spec §5.4). */
export function maybeSplitTaxes(state: GameState): void {
  if (state.taxesSplit || state.citizens.length < TAX_SPLIT_POP) return;
  state.taxesSplit = true;
  state.taxes = { ibi: state.taxLevel, tasas: state.taxLevel, plusvalia: state.taxLevel };
  state.prevTaxes = { ...state.taxes };
  pushEvent(state, 'info', 'Con 50 vecinos, el impuesto único se separa en IBI, tasas y plusvalía');
}

/* ---------------- memoria fiscal ---------------- */

/** Las subidas se recuerdan (por grupo afectado) y se olvidan muy despacio. */
export function updateGrudges(state: GameState): void {
  const up = (a: TaxLevel, b: TaxLevel) => LEVEL_INDEX[b] - LEVEL_INDEX[a];
  if (!state.taxesSplit) {
    const d = up(state.prevTaxLevel, state.taxLevel);
    if (d > 0) {
      for (const c of state.citizens) {
        c.grudge += GRUDGE_RAISE.all * d;
        if (c.named) addMemory(state, c, 'subida_impuestos', 3, -2);
      }
    }
  } else {
    for (const k of TAX_KEYS) {
      const d = up(state.prevTaxes[k], state.taxes[k]);
      if (d <= 0) continue;
      for (const c of state.citizens) {
        const owner = c.owns || state.buildings.some((b) => b.owner === c.id);
        if (k === 'tasas' || owner) c.grudge += GRUDGE_RAISE[k] * d;
      }
    }
    state.prevTaxes = { ...state.taxes };
  }
  for (const c of state.citizens) c.grudge = Math.min(GRUDGE_MAX, c.grudge * GRUDGE_DECAY);
}

/** Efecto de los tributos en un vecino según su grupo. */
/** Nivel que notan los vecinos: una bajada tarda en sentirse (ronda 06: bajar justo antes de votar no cuela). */
export function felt(state: GameState): Record<TaxKey, TaxLevel> {
  const lv = taxLevels(state);
  const p = state.politics?.perceivedTax;
  if (!p) return lv;
  const names: TaxLevel[] = ['low', 'medium', 'high'];
  const pick = (k: TaxKey) => names[Math.max(names.indexOf(lv[k]), Math.round(p[k]))]!;
  return { ibi: pick('ibi'), tasas: pick('tasas'), plusvalia: pick('plusvalia') };
}

/** Cada día: el nivel notado sube al momento y baja 1/TAX_RELIEF_DAYS por día. */
export function updateFeltTaxes(state: GameState): void {
  const lv = taxLevels(state);
  const names: TaxLevel[] = ['low', 'medium', 'high'];
  for (const k of ['ibi', 'tasas', 'plusvalia'] as const) {
    const cur = names.indexOf(lv[k]);
    const p = state.politics.perceivedTax;
    p[k] = cur >= p[k] ? cur : Math.max(cur, p[k] - 1 / TAX_RELIEF_DAYS);
  }
}

export function taxMood(state: GameState, c: Citizen): { label: string; value: number }[] {
  const lv = felt(state);
  const out: { label: string; value: number }[] = [];
  const tasas = TASAS_MOOD[lv.tasas];
  if (tasas) out.push({ label: tasas > 0 ? 'Tasas bajas' : 'Tasas altas', value: tasas });
  const ibi = c.owns ? IBI_MOOD_OWNER[lv.ibi] : IBI_MOOD_RENTER[lv.ibi];
  if (ibi) out.push({ label: ibi > 0 ? 'IBI bajo' : c.owns ? 'IBI alto' : 'IBI alto (sube el alquiler)', value: ibi });
  const plus = c.owns ? PLUSVALIA_MOOD_OWNER[lv.plusvalia] : 0;
  if (plus) out.push({ label: plus > 0 ? 'Plusvalía baja' : 'Plusvalía alta', value: plus });
  if (c.grudge >= 1) out.push({ label: 'Recuerda las subidas de impuestos', value: -Math.round(c.grudge * 0.5) });
  return out;
}

/** Efecto medio de los tributos (para la demanda de vivienda). */
export function averageTaxMood(state: GameState): number {
  if (state.citizens.length === 0) return 0;
  return state.citizens.reduce((s, c) => s + taxMood(state, c).reduce((a, f) => a + f.value, 0), 0) / state.citizens.length;
}

/* ---------------- valor de los inmuebles ---------------- */

/** Valor de mercado de una vivienda/local: base × barrio × demanda. */
export function unitValue(state: GameState, b: Building): number {
  const base = PROPERTY_VALUE[b.kind] ?? 0;
  const land = state.fields.land[tileIndex(state, b.x, b.y)] ?? 50;
  const demand = 1 + Math.max(0, Math.min(100, state.demand.R)) / 300;
  return Math.round((base * (0.6 + (land / 100) * 0.9) * demand) / 10) * 10;
}

export function salePrice(state: GameState, b: Building): number {
  const v = unitValue(state, b);
  return b.kind === 'house' ? Math.min(v, MUNICIPAL_PRICE_CAP) : v;
}

function municipalUnits(b: Building): number {
  return b.kind === 'house' ? Math.max(0, (HOMES.house ?? 0) - (b.privateUnits ?? 0)) : 0;
}

/** ¿Puede comprar la vivienda en la que vive? */
export function canBuyHome(state: GameState, c: Citizen): boolean {
  if (c.owns || c.homeId === null) return false;
  // v1.9: con deudas, o tras un embargo reciente, el banco no le da hipoteca.
  if (totalDebt(c) > 0 || (c.seizedUntil !== undefined && c.seizedUntil > state.tick)) return false;
  const home = state.buildings.find((b) => b.id === c.homeId);
  if (!home || !home.built) return false;
  if (home.kind === 'house' && !home.forSale) return false;
  if (home.kind !== 'house' && home.kind !== 'res') return false;
  const price = salePrice(state, home);
  return c.money >= Math.ceil(price * (DOWN_PAYMENT + TRANSACTION_COST)) + 300;
}

/** Compra con entrada e hipoteca. Si es municipal, el dinero va al ayuntamiento. */
export function buyHome(state: GameState, c: Citizen): boolean {
  if (!canBuyHome(state, c)) return false;
  const home = state.buildings.find((b) => b.id === c.homeId)!;
  const price = salePrice(state, home);
  const down = Math.ceil(price * DOWN_PAYMENT);
  if (home.kind === 'house') {
    // Vivienda municipal: el ayuntamiento cobra la entrada y los gastos ahora,
    // y el resto en cuotas (no hay banco que adelante el dinero).
    transfer(state, c.id, TREASURY, down + Math.ceil(price * TRANSACTION_COST), 'venta de viviendas');
    home.privateUnits = (home.privateUnits ?? 0) + 1;
    c.mortgageTo = TREASURY;
    c.subsidized = true;
  } else {
    transfer(state, c.id, OUTSIDE, down + Math.ceil(price * TRANSACTION_COST));
    c.mortgageTo = OUTSIDE;
    c.subsidized = false;
  }
  c.owns = true;
  c.boughtPrice = price;
  c.mortgage = price - down;
  c.boughtTick = state.tick;
  if (c.named) addMemory(state, c, 'compro_casa', 4, 4);
  pushEvent(state, 'info', `${c.name} compra la vivienda en la que vive`, { ref: c.id });
  return true;
}

/** Al irse, un propietario vende a precio de mercado y paga la plusvalía. */
export function sellOnDeparture(state: GameState, c: Citizen): void {
  for (const b of state.buildings) if (b.owner === c.id) b.owner = OUTSIDE;
  if (!c.owns) return;
  const home = state.buildings.find((b) => b.id === c.homeId);
  if (!home) return;
  // La vivienda que fue municipal mantiene el precio máximo al revenderla.
  const market = c.subsidized ? Math.min(unitValue(state, home), MUNICIPAL_PRICE_CAP) : unitValue(state, home);
  // Antes de 90 días no hay ganancia (anti-especulación).
  const price = state.tick - c.boughtTick < RESALE_LOCK_TICKS ? Math.min(market, c.boughtPrice) : market;
  if (home.kind === 'house') {
    // La vivienda vuelve al ayuntamiento, que paga el precio y cobra lo que se le debía.
    transfer(state, TREASURY, c.id, price, 'recompra de viviendas');
    charge(state, c, c.mortgageTo, c.mortgage, 'cuotas de vivienda');
    home.privateUnits = Math.max(0, (home.privateUnits ?? 0) - 1);
  } else {
    transfer(state, OUTSIDE, c.id, price);
    charge(state, c, c.mortgageTo, c.mortgage, 'cuotas de vivienda');
  }
  const gain = Math.max(0, price - c.boughtPrice);
  const rate = monthRates(state).plusvalia;
  if (gain > 0) charge(state, c, TREASURY, Math.round(gain * rate), 'plusvalía');
  c.owns = false;
  c.mortgage = 0;
}

/**
 * v1.9: consecuencias de no pagar la vivienda. Tras varias cuotas de hipoteca sin
 * pagar, el banco ejecuta y vende la vivienda (lo que falte queda como deuda) y el
 * vecino sigue en ella de alquiler. Tras varios meses sin pagar el alquiler privado,
 * desahucio. La vivienda municipal no desahucia: el alcalde aplaza o perdona.
 */
export function housingTroubles(state: GameState): void {
  for (const c of state.citizens) {
    if (c.owns && (c.missedQuotas ?? 0) >= DEBT.foreclosureMonths) {
      sellOnDeparture(state, c);
      c.missedQuotas = 0;
      c.seizedUntil = state.tick + 12 * TICKS_PER_MONTH;
      addMemory(state, c, 'embargado', 5, -6);
      pushEvent(state, 'info', `El banco se queda la vivienda de ${c.name}: llevaba ${DEBT.foreclosureMonths} cuotas de hipoteca sin pagar. Sigue en ella de alquiler`, { ref: c.id });
    } else if (!c.owns && c.homeId !== null && (c.rentArrears ?? 0) >= DEBT.evictMonths) {
      c.homeId = null;
      c.rentArrears = 0;
      c.evictedUntil = state.tick + DEBT.evictedMonths * TICKS_PER_MONTH;
      addMemory(state, c, 'desahuciado', 6, -6);
      pushEvent(state, 'info', `Desahucian a ${c.name}: debía ${DEBT.evictMonths} meses de alquiler`, { ref: c.id });
    }
  }
}

/* ---------------- empresas de vecinos ---------------- */

/** Solar libre en zona comercial con agua y luz (el motor lo comprueba). */
export function freeShopLot(state: GameState): number | null {
  const { w, h, tiles, zones } = state.map;
  const occupied = new Set(state.buildings.map((b) => b.y * w + b.x));
  // Carreteras con agua y luz: las que tocan edificios servidos.
  const served = new Set<number>();
  for (const b of state.buildings) {
    if (!b.hasWater || !b.hasPower) continue;
    for (const [dx, dy] of DIRS) {
      const nx = b.x + dx;
      const ny = b.y + dy;
      if (inBounds(state, nx, ny) && tiles[tileIndex(state, nx, ny)] === Tile.Road) served.add(tileIndex(state, nx, ny));
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (zones[i] !== Zone.C || tiles[i] === Tile.Road || occupied.has(i)) continue;
      const near = DIRS.some(([dx, dy]) => inBounds(state, x + dx, y + dy) && served.has(tileIndex(state, x + dx, y + dy)));
      if (near) return i;
    }
  }
  return null;
}

/**
 * v1.9 (ronda 15): la caja inicial de un negocio tiene que cubrir una nómina al
 * sueldo vigente; con el sueldo mínimo alto hace falta más dinero para empezar y se
 * abren menos (antes abrían y cerraban en bucle).
 */
export function foundSeed(state: GameState): number {
  // Ronda 15: una nómina (con dos casi no se fundaban empresas y no había empresarios vecinos).
  return Math.max(FOUND_SEED, MIN_WAGE[state.minWage ?? 'none'] * JOBS.shop);
}

export function canFound(state: GameState, c: Citizen): boolean {
  // Con el sueldo mínimo alto, montar un negocio sale menos a cuenta (hace falta más demanda).
  const step = MIN_WAGE_STEP[state.minWage ?? 'none'];
  // Quien acaba de cerrar no vuelve a abrir enseguida.
  if (c.closedUntil !== undefined && c.closedUntil > state.tick) return false;
  return c.money >= Math.max(FOUND_MIN_MONEY, FOUND_COST + foundSeed(state)) && state.demand.C > 10 + step * 100 * MIN_WAGE_FX.foundPenalty && freeShopLot(state) !== null;
}

export function shopTypesFor(state: GameState, c: Citizen): string[] {
  const a = SHOP_TYPES[hash32(state.seed, c.id) % SHOP_TYPES.length]!;
  const b = SHOP_TYPES[hash32(c.id, state.seed, 3) % SHOP_TYPES.length]!;
  return a === b ? [a] : [a, b];
}

/** Un vecino funda una empresa con su dinero: local, caja inicial y empleo. */
export function foundBusiness(state: GameState, c: Citizen, type: string): boolean {
  if (!canFound(state, c)) return false;
  const lot = freeShopLot(state)!;
  const { w } = state.map;
  state.map.tiles[lot] = Tile.Grass;
  const b = newBuilding(state, 'shop', lot % w, Math.floor(lot / w), c.id);
  b.name = `${SHOP_NAMES[type] ?? 'Tienda'} de ${c.name.split(' ')[0]}`;
  transfer(state, c.id, OUTSIDE, FOUND_COST);
  transfer(state, c.id, b.id, foundSeed(state));
  const g = GROWTH.shop;
  state.projects.push({
    buildingId: b.id,
    payer: OUTSIDE,
    workersNeeded: g.workers,
    workerDaysNeeded: g.workers * g.days,
    workerDaysDone: 0,
    crew: [],
    outsideToday: 0,
    notify: false,
  });
  if (c.named) addMemory(state, c, 'abrio_negocio', 5, 4);
  onBusinessFounded(state, c);
  pushEvent(state, 'business', `${c.name} abre ${b.name.toLowerCase().startsWith('bar') ? 'un' : 'una'} ${b.name}`, { ref: b.id });
  return true;
}

/** Dividendos de una empresa: al vecino dueño o, si no, fuera. */
export function payDividends(state: GameState, b: Building): void {
  if (b.cash <= BUSINESS_CASH_CAP) return;
  const owner = b.owner > 0 && state.citizens.some((c) => c.id === b.owner) ? b.owner : OUTSIDE;
  transfer(state, b.id, owner, b.cash - BUSINESS_CASH_CAP);
}

/* ---------------- cobros mensuales ---------------- */

/** Vivienda (alquiler, hipoteca, IBI) y tasas de cada hogar. */
export function monthlyHousing(state: GameState, r: MonthRates): void {
  const byHome = new Map<number, Citizen[]>();
  for (const c of state.citizens) {
    if (c.homeId === null) continue;
    const list = byHome.get(c.homeId) ?? [];
    list.push(c);
    byHome.set(c.homeId, list);
  }
  for (const b of state.buildings) {
    if (!b.built || (b.kind !== 'house' && b.kind !== 'res')) continue;
    const residents = byHome.get(b.id) ?? [];
    const ibi = Math.round((unitValue(state, b) * r.ibi) / 12);
    let municipal = municipalUnits(b);
    for (const c of residents) {
      // v1.9: lo que no puede pagar queda como deuda (charge), y se cuentan los meses de impago.
      if (c.owns) {
        // Cuota de amortización + interés sobre lo pendiente. Los intereses impagados son deuda;
        // la cuota impagada sigue en la hipoteca y cuenta para la ejecución.
        const interest = Math.ceil(c.mortgage * MORTGAGE_INTEREST);
        const quota = Math.min(c.mortgage, Math.ceil(c.boughtPrice / MORTGAGE_MONTHS));
        charge(state, c, c.mortgageTo, interest, 'cuotas de vivienda');
        const paid = transfer(state, c.id, c.mortgageTo, quota, 'cuotas de vivienda');
        c.mortgage -= paid;
        c.missedQuotas = paid < quota ? (c.missedQuotas ?? 0) + 1 : 0;
        charge(state, c, TREASURY, ibi, 'IBI');
      } else if (municipal > 0) {
        municipal--;
        charge(state, c, TREASURY, MUNICIPAL_RENT, 'alquileres');
      } else {
        // El casero (de fuera) paga el IBI y lo repercute en el alquiler.
        const paid = charge(state, c, OUTSIDE, PRIVATE_RENT + ibi);
        c.rentArrears = paid < PRIVATE_RENT + ibi ? (c.rentArrears ?? 0) + 1 : 0;
        transfer(state, OUTSIDE, TREASURY, ibi, 'IBI');
      }
      charge(state, c, TREASURY, r.basuras, 'tasas');
    }
    // Viviendas privadas vacías: el dueño de fuera paga su IBI.
    const capacity = HOMES[b.kind] ?? 0;
    const privateEmpty = b.kind === 'res' ? capacity - residents.length : Math.max(0, (b.privateUnits ?? 0) - residents.filter((c) => c.owns).length);
    if (privateEmpty > 0) transfer(state, OUTSIDE, TREASURY, ibi * privateEmpty, 'IBI');
  }
}

/** IBI y terrazas de las empresas (de su caja). */
export function businessTaxes(state: GameState, b: Building, r: MonthRates): void {
  transfer(state, b.id, TREASURY, Math.round((unitValue(state, b) * r.ibi) / 12), 'IBI');
  if (b.kind === 'shop') transfer(state, b.id, TREASURY, r.terrazas, 'tasas');
}

/** Mercado mensual: inquilinos estadísticos que compran y vecinos que emprenden. */
export function monthlyMarket(state: GameState): void {
  for (const c of state.citizens) {
    if (c.named) continue; // los vecinos con nombre deciden ellos (detonantes)
    // Si puede las dos cosas, decide al azar si compra o emprende.
    const foundFirst = canFound(state, c) && chance(state.rng, 0.5);
    if (!foundFirst && canBuyHome(state, c) && chance(state.rng, BUY_CHANCE)) buyHome(state, c);
    else if (canFound(state, c) && chance(state.rng, FOUND_CHANCE)) foundBusiness(state, c, shopTypesFor(state, c)[0]!);
  }
}

/**
 * Carga de cada servicio con capacidad (v1.4, aplazado de la ronda 09): cada
 * vecino cuenta para el edificio más cercano de ese tipo que le alcanza, así
 * que un colegio en una esquina vacía no alivia al del barrio lleno.
 * 1 = da abasto; menos de 1 = saturado. Se calcula una vez por hora de juego.
 */
const loadCache = new WeakMap<GameState, { key: string; loads: Map<number, number>; count: Map<number, number> }>();
export function serviceLoads(state: GameState): Map<number, number> {
  const key = `${state.tick}:${state.citizens.length}:${state.buildings.length}`;
  const hit = loadCache.get(state);
  if (hit && hit.key === key) return hit.loads;
  const served = state.buildings.filter((b) => b.built && SERVICE_CAPACITY[b.kind]);
  const count = new Map<number, number>(served.map((b) => [b.id, 0]));
  const byId = new Map(state.buildings.map((b) => [b.id, b]));
  for (const c of state.citizens) {
    const home = c.homeId !== null ? byId.get(c.homeId) : undefined;
    if (!home) continue;
    const nearest = new Map<BuildingKind, { id: number; d: number }>();
    for (const b of served) {
      const d = Math.abs(b.x - home.x) + Math.abs(b.y - home.y);
      if (d > radiusOf(b)) continue;
      const best = nearest.get(b.kind);
      if (!best || d < best.d || (d === best.d && b.id < best.id)) nearest.set(b.kind, { id: b.id, d });
    }
    // Al colegio van los niños de la casa (v1.5); a los demás servicios, cada vecino.
    for (const [kind, { id }] of nearest) count.set(id, count.get(id)! + (kind === 'school' ? 1 + (c.kids?.length ?? 0) : 1));
  }
  const loads = new Map<number, number>();
  for (const b of served) loads.set(b.id, Math.min(1, serviceCapacityOf(b) / Math.max(1, count.get(b.id)!)));
  loadCache.set(state, { key, loads, count });
  return loads;
}

/** v1.8: vecinos que usa cada colegio, centro de salud o comisaría (para su nivel). */
export function serviceCounts(state: GameState): Map<number, number> {
  serviceLoads(state);
  return loadCache.get(state)!.count;
}

/** Cobertura de un edificio de servicio, o del peor de ese tipo si no se dice cuál. */
export function serviceSaturation(state: GameState, kind: BuildingKind, buildingId?: number): number {
  if (!SERVICE_CAPACITY[kind]) return 1;
  const loads = serviceLoads(state);
  if (buildingId !== undefined) return loads.get(buildingId) ?? 1;
  let worst = 1;
  for (const b of state.buildings) if (b.kind === kind && b.built) worst = Math.min(worst, loads.get(b.id) ?? 1);
  return worst;
}

/**
 * Saturado de verdad: por debajo del 90 % (con 61 vecinos y un colegio no
 * hace falta otro) y sin otro de ese tipo ya en obras (ronda 09).
 */
export function saturated(state: GameState, kind: BuildingKind): boolean {
  if (state.buildings.some((b) => b.kind === kind && !b.built)) return false;
  return serviceSaturation(state, kind) < 0.9;
}
