/**
 * 2.6 «Lo básico» (bloque B): que el jugador entienda por qué pasan las cosas
 * del núcleo del city builder. Todo es de solo lectura: nada de aquí toca el
 * estado (ni el hash).
 *
 * - `networkLoad`: cuánto se usa cada bomba y central (lo mismo que reparte
 *   `updateNetworks`, sin tocar el estado; hay test de que coinciden).
 * - `lotStatus`/`lotSummary`: por qué un solar de zona no crece (las mismas
 *   condiciones que `growZones`).
 * - `monthlyCostOf`/`maintenanceByKind`: lo que cuesta al mes una obra antes de
 *   hacerla y el mantenimiento del pueblo por tipo de edificio.
 */
import type { BuildKind } from '@bitopolis/shared';
import { FOUND_MIN_MONEY, PUBLIC_SALARY, SERVICE, SERVICE_SALARY, TERRAIN, ZONE_GROWTH } from './balance.ts';
import { budgetFx } from './civic.ts';
import { networkRoads } from './coverage.ts';
import { jobsOf, maintenanceOf, plantCapacityOf } from './levels.ts';
import { type Building, type BuildingKind, DIRS, type GameState, hasAdjacentRoad, inBounds, Tile, tileIndex, Zone } from './state.ts';
import { freeHomes, isBusiness, lotFree, riverside, zoneGate } from './tick.ts';
import { townLevel } from './townhall.ts';
import { isPowerPlant, isRenewable, pumpDirty, renewableFx } from './waterworks.ts';
import { weatherFx } from './weather.ts';

export type NetKind = 'water' | 'power';

/** Una red: las carreteras unidas a una o varias plantas del mismo tipo. */
export interface NetInfo {
  kind: NetKind;
  /** Ids de las plantas que la alimentan (en el orden en que reparten). */
  plants: number[];
  /** Edificios que puede abastecer, con el tiempo de hoy. */
  capacity: number;
  /** Edificios abastecidos por estas plantas. */
  served: number;
  /** Edificios de la red que se quedan sin servicio (sin contar las plantas). */
  left: number[];
}

export interface PlantLoad {
  id: number;
  kind: NetKind;
  /** Lo que da con el tiempo de hoy (nieve, calor, río, viento…). */
  capacity: number;
  /** Lo que da sin el tiempo (la cifra de la ficha). */
  nominal: number;
  served: number;
  /** Clave de su red en `nets` (sin red si no toca carretera). */
  net: string | null;
}

export interface NetworkLoad {
  /** Carreteras con agua y con luz (lo mismo que devuelve `updateNetworks`). */
  roads: { water: Set<number>; power: Set<number> };
  /** Edificios con agua y con luz. */
  has: { water: Set<number>; power: Set<number> };
  plants: Map<number, PlantLoad>;
  nets: Map<string, NetInfo>;
  /** Red de cada carretera, por tipo. */
  roadNet: { water: Map<number, string>; power: Map<number, string> };
}

const isPlantOf = (b: Building, kind: NetKind) => b.kind === kind || (kind === 'power' && isRenewable(b.kind));

/** Lo que da una planta hoy (la misma cuenta que `updateNetworks`). */
function plantCapacityToday(state: GameState, plant: Building, kind: NetKind): number {
  let capacity = Math.round(plantCapacityOf(plant) * (isRenewable(plant.kind) ? renewableFx(state, plant.kind) : kind === 'water' ? weatherFx(state).water : weatherFx(state).power));
  if (kind === 'water' && riverside(state, plant.x, plant.y) && !pumpDirty(state, plant.x, plant.y)) capacity = Math.round(capacity * TERRAIN.riverPumpBonus);
  return capacity;
}

/**
 * El reparto de agua y luz de `updateNetworks`, sin tocar el estado, con lo que
 * usa cada planta y quién se queda sin servicio. Mismo orden y mismas reglas
 * (hay test de que da los mismos edificios y carreteras).
 */
export function networkLoad(state: GameState): NetworkLoad {
  const { w, tiles } = state.map;
  const out: NetworkLoad = {
    roads: { water: new Set(), power: new Set() },
    has: { water: new Set(), power: new Set() },
    plants: new Map(),
    nets: new Map(),
    roadNet: { water: new Map(), power: new Map() },
  };
  const byRoad = new Map<number, Building[]>();
  for (const b of state.buildings) {
    if (b.kind === 'farm') continue;
    for (const [dx, dy] of DIRS) {
      const nx = b.x + dx;
      const ny = b.y + dy;
      if (!inBounds(state, nx, ny)) continue;
      const i = tileIndex(state, nx, ny);
      if (tiles[i] !== Tile.Road) continue;
      const list = byRoad.get(i) ?? [];
      list.push(b);
      byRoad.set(i, list);
    }
  }
  for (const kind of ['water', 'power'] as const) {
    const has = out.has[kind];
    for (const plant of state.buildings) {
      if (!isPlantOf(plant, kind) || !plant.built) continue;
      has.add(plant.id);
      let capacity = plantCapacityToday(state, plant, kind);
      const load: PlantLoad = { id: plant.id, kind, capacity, nominal: plantCapacityOf(plant), served: 0, net: null };
      out.plants.set(plant.id, load);
      const queue: number[] = [];
      const seen = new Set<number>();
      for (const [dx, dy] of DIRS) {
        const nx = plant.x + dx;
        const ny = plant.y + dy;
        if (inBounds(state, nx, ny) && tiles[tileIndex(state, nx, ny)] === Tile.Road) {
          const i = tileIndex(state, nx, ny);
          queue.push(i);
          seen.add(i);
        }
      }
      // Su red: la de la primera carretera que ya tenga red, o una nueva con su id.
      if (queue.length) {
        const key = queue.map((i) => out.roadNet[kind].get(i)).find((k) => k !== undefined) ?? `${kind}:${plant.id}`;
        load.net = key;
        const net = out.nets.get(key) ?? { kind, plants: [], capacity: 0, served: 0, left: [] };
        net.plants.push(plant.id);
        net.capacity += capacity;
        out.nets.set(key, net);
      }
      while (queue.length > 0) {
        const i = queue.shift()!;
        out.roads[kind].add(i);
        if (load.net && !out.roadNet[kind].has(i)) out.roadNet[kind].set(i, load.net);
        for (const b of byRoad.get(i) ?? []) {
          if (has.has(b.id) || !b.built) continue;
          if (capacity <= 0) continue;
          has.add(b.id);
          capacity--;
          load.served++;
        }
        const x = i % w;
        const y = Math.floor(i / w);
        for (const [dx, dy] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(state, nx, ny)) continue;
          const j = tileIndex(state, nx, ny);
          if (tiles[j] === Tile.Road && !seen.has(j)) {
            seen.add(j);
            queue.push(j);
          }
        }
      }
      if (load.net) out.nets.get(load.net)!.served += load.served;
    }
    // Quién se queda sin servicio en cada red (las plantas no cuentan: no lo notan).
    const leftSeen = new Set<number>();
    for (const [i, key] of out.roadNet[kind]) {
      for (const b of byRoad.get(i) ?? []) {
        if (!b.built || has.has(b.id) || leftSeen.has(b.id) || b.kind === 'water' || isPowerPlant(b.kind)) continue;
        leftSeen.add(b.id);
        out.nets.get(key)!.left.push(b.id);
      }
    }
  }
  return out;
}

/** La red (agua o luz) de la planta, o la de la carretera al lado de un edificio. */
export function netOfBuilding(state: GameState, load: NetworkLoad, b: Building, kind: NetKind): NetInfo | null {
  const p = load.plants.get(b.id);
  if (p && p.kind === kind) return p.net ? load.nets.get(p.net)! : null;
  for (const [dx, dy] of DIRS) {
    if (!inBounds(state, b.x + dx, b.y + dy)) continue;
    const key = load.roadNet[kind].get(tileIndex(state, b.x + dx, b.y + dy));
    if (key) return load.nets.get(key)!;
  }
  return null;
}

/* ---------- solares que no crecen ---------- */

export type LotReason = 'carretera' | 'agua' | 'luz' | 'agua_luz' | 'demanda' | 'casas_libres' | 'ok';

export interface LotStatus {
  zone: 'R' | 'C' | 'I';
  /** ¿Puede levantarse aquí un edificio en cuanto toque? */
  grows: boolean;
  /** El motivo principal (lo propio del solar antes que lo de toda la zona). */
  reason: LotReason;
  /** Todos los motivos que lo paran, del principal al último. */
  reasons: LotReason[];
  /** «La calle de al lado no tiene luz». */
  text: string;
  /** Qué hacer: «Construye una central eléctrica…». */
  action: string;
  /** Lo que conviene saber aunque crezca (más lento, la bomba llena…). */
  note?: string;
}

const ZONE_KIND = { [Zone.R]: ['R', 'res'], [Zone.C]: ['C', 'shop'], [Zone.I]: ['I', 'factory'] } as const;
const sign = (v: number) => (v > 0 ? `+${v}` : String(v));

function plantWord(kind: NetKind): { name: string; the: string } {
  return kind === 'water' ? { name: 'bomba de agua', the: 'la bomba' } : { name: 'central eléctrica (o placas solares)', the: 'la central' };
}

/** Qué hacer cuando la calle no tiene agua o luz: hay planta, está en obras o no hay. */
function networkAction(state: GameState, kind: NetKind): string {
  const plants = state.buildings.filter((b) => isPlantOf(b, kind));
  const { name, the } = plantWord(kind);
  if (!plants.length) return `Construye una ${name} junto a una carretera unida a esta calle.`;
  if (!plants.some((b) => b.built)) return `${the[0]!.toUpperCase()}${the.slice(1)} está en obras: cuando se termine llegará ${kind === 'water' ? 'el agua' : 'la luz'} (si su carretera está unida a esta calle).`;
  return `Esta calle no está unida a la carretera de ${the}: únelas (o construye otra ${name} aquí al lado).`;
}

/**
 * Ronda 22: al colocar una obra en (x, y), qué red no llega a su calle
 * («⚠ Sin agua: esta calle no está unida a la carretera de la bomba…»).
 * Las plantas no se avisan de su propia red. Vacío si no toca carretera
 * (eso ya lo dice la validación) o si le llega todo.
 */
export function siteNetworkWarn(state: GameState, kind: string, x: number, y: number, roads?: Partial<Record<NetKind, Set<number>>>): string[] {
  const near: number[] = [];
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (inBounds(state, nx, ny) && state.map.tiles[tileIndex(state, nx, ny)] === Tile.Road) near.push(tileIndex(state, nx, ny));
  }
  if (!near.length) return [];
  const out: string[] = [];
  for (const net of ['water', 'power'] as const) {
    if (net === 'water' ? kind === 'water' : isPowerPlant(kind as BuildingKind) || isRenewable(kind as BuildingKind)) continue;
    const set = roads?.[net] ?? networkRoads(state, net);
    if (near.some((i) => set.has(i))) continue;
    out.push(`⚠ Sin ${net === 'water' ? 'agua' : 'luz'} aquí: ${networkAction(state, net)}`);
  }
  return out;
}

/**
 * 2.6: por qué un solar vacío de zona R, C o I no crece, con las mismas
 * condiciones que `growZones` (zona, libre, carretera con agua y luz al lado,
 * demanda por encima de `ZONE_GROWTH.minDemand` y, en R, menos de
 * `ZONE_GROWTH.maxFreeHomes` casas libres). `null` si no es un solar de esas zonas.
 * `load` y `free` se pueden pasar para no recalcularlos en cada casilla.
 */
export function lotStatus(state: GameState, x: number, y: number, load: NetworkLoad = networkLoad(state), free = freeHomes(state)): LotStatus | null {
  if (!inBounds(state, x, y)) return null;
  const i = tileIndex(state, x, y);
  const zk = ZONE_KIND[state.map.zones[i] as 1 | 2 | 3];
  if (!zk || !lotFree(state, x, y)) return null;
  const [zone, kind] = zk;
  const demand = state.demand[zone];
  const reasons: LotReason[] = [];
  const texts: Partial<Record<LotReason, { text: string; action: string }>> = {};
  let road: number | null = null;
  if (!hasAdjacentRoad(state, x, y)) {
    reasons.push('carretera');
    texts.carretera = { text: 'Falta carretera al lado', action: 'Pon una carretera junto al solar: por debajo van el agua y la luz.' };
  } else {
    let water = false;
    let power = false;
    for (const [dx, dy] of DIRS) {
      if (!inBounds(state, x + dx, y + dy)) continue;
      const j = tileIndex(state, x + dx, y + dy);
      const wj = load.roads.water.has(j);
      const pj = load.roads.power.has(j);
      water ||= wj;
      power ||= pj;
      if (wj && pj && road === null) road = j;
    }
    if (road === null) {
      const r: LotReason = !water && !power ? 'agua_luz' : !water ? 'agua' : !power ? 'luz' : 'agua_luz';
      reasons.push(r);
      const text = r === 'agua_luz' ? (water && power ? 'Ninguna calle de al lado tiene agua y luz a la vez' : 'La calle de al lado no tiene ni agua ni luz') : r === 'agua' ? 'La calle de al lado no tiene agua' : 'La calle de al lado no tiene luz';
      const action = r === 'agua' ? networkAction(state, 'water') : r === 'luz' ? networkAction(state, 'power') : `${!water ? networkAction(state, 'water') : ''} ${!power ? networkAction(state, 'power') : ''}`.trim() || 'Une esta calle con las de la bomba y la central.';
      texts[r] = { text, action };
    }
  }
  const gate = zoneGate(state, kind, demand, free);
  if (gate === 'demanda') {
    reasons.push('demanda');
    const why = zone === 'R' ? 'Sube con empleo, felicidad e impuestos razonables; baja con casas vacías y paro.' : zone === 'C' ? `Hace falta una tienda por cada 12 vecinos (hay ${state.citizens.length}).` : 'Vienen fábricas cuando hay gente sin trabajo en el pueblo.';
    texts.demanda = { text: `Demanda baja (${zone} ${sign(demand)}; hace falta más de ${ZONE_GROWTH.minDemand})`, action: why };
  } else if (gate === 'casas_libres') {
    reasons.push('casas_libres');
    texts.casas_libres = { text: `Hay ${free} casas libres: no se hacen más hasta que queden menos de ${ZONE_GROWTH.maxFreeHomes}`, action: 'Cuando se llenen, la zona seguirá creciendo.' };
  }
  if (!reasons.length) {
    const notes: string[] = [];
    if (kind === 'shop' && state.citizens.some((c) => c.money >= FOUND_MIN_MONEY)) notes.push('Va más lento: los locales se guardan para vecinos que quieren abrir su negocio.');
    // La bomba o la central que llega por esa calle, si va llena: el edificio nuevo se quedaría sin servicio.
    for (const k of ['water', 'power'] as const) {
      const key = road !== null ? load.roadNet[k].get(road) : undefined;
      const net = key ? load.nets.get(key) : undefined;
      if (net && net.served >= net.capacity) notes.push(`Ojo: ${plantWord(k).the} va llena (${net.served + net.left.length}/${net.capacity}): lo nuevo se quedará sin ${k === 'water' ? 'agua' : 'luz'}.`);
    }
    return {
      zone,
      grows: true,
      reason: 'ok',
      reasons: [],
      text: 'Puede crecer',
      action: `Cada día se levanta como mucho un edificio por zona; con más demanda (ahora ${zone} ${sign(demand)}), antes.`,
      ...(notes.length ? { note: notes.join(' ') } : {}),
    };
  }
  const main = reasons[0]!;
  return { zone, grows: false, reason: main, reasons, text: texts[main]!.text, action: texts[main]!.action };
}

export interface ZoneLots {
  /** Solares vacíos de la zona. */
  empty: number;
  /** Los que pueden crecer en cuanto toque. */
  ready: number;
  /** Los que no, por su motivo principal. */
  blocked: Partial<Record<LotReason, number>>;
}

/** 2.6: los solares vacíos de cada zona y por qué no crecen; `dry`, los que no crecen por agua o luz (para el mapa). */
export function lotSummary(state: GameState, load: NetworkLoad = networkLoad(state)): { R: ZoneLots; C: ZoneLots; I: ZoneLots; dry: { x: number; y: number; water: boolean; power: boolean }[] } {
  const out = { R: { empty: 0, ready: 0, blocked: {} }, C: { empty: 0, ready: 0, blocked: {} }, I: { empty: 0, ready: 0, blocked: {} }, dry: [] } as ReturnType<typeof lotSummary>;
  const free = freeHomes(state);
  const { w, h, zones } = state.map;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const z = zones[y * w + x];
      if (z !== Zone.R && z !== Zone.C && z !== Zone.I) continue;
      const s = lotStatus(state, x, y, load, free);
      if (!s) continue;
      const zl = out[s.zone];
      zl.empty++;
      if (s.grows) zl.ready++;
      else zl.blocked[s.reason] = (zl.blocked[s.reason] ?? 0) + 1;
      const net = s.reasons.find((r) => r === 'agua' || r === 'luz' || r === 'agua_luz');
      if (net) out.dry.push({ x, y, water: net !== 'luz', power: net !== 'agua' });
    }
  }
  return out;
}

/** «4 solares no pueden crecer: sin luz» (el motivo que más pesa en la zona), o '' si crecen todos. */
export function lotsLine(zl: ZoneLots): string {
  const names: Record<LotReason, string> = { carretera: 'sin carretera', agua: 'sin agua', luz: 'sin luz', agua_luz: 'sin agua ni luz', demanda: 'falta demanda', casas_libres: 'sobran casas', ok: '' };
  const list = (Object.entries(zl.blocked) as [LotReason, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const n = list.reduce((s, [, k]) => s + k, 0);
  if (!n) return '';
  return `${n} ${n === 1 ? 'solar no puede' : 'solares no pueden'} crecer: ${list.map(([r, k]) => (list.length > 1 ? `${names[r]} (${k})` : names[r])).join(', ')}`;
}

/* ---------- lo que cuesta al mes ---------- */

/** Sueldo que paga el ayuntamiento por cada empleo de un edificio municipal (como en `endOfMonth`). */
function publicWage(kind: string): number {
  return SERVICE[kind as BuildingKind] ? SERVICE_SALARY : PUBLIC_SALARY;
}

/**
 * 2.6: lo que costará al mes una obra nueva (nivel 1): mantenimiento y los
 * sueldos de su plantilla, con el presupuesto en vigor (sin estado, el normal).
 */
export function monthlyCostOf(kind: BuildKind, state?: GameState): { maintenance: number; jobs: number; wages: number; total: number } {
  if (kind === 'road') return { maintenance: 0, jobs: 0, wages: 0, total: 0 };
  const b = { kind, level: 1 } as Building;
  const fx = state ? budgetFx(state) : { maintenance: 1, salaries: 1 };
  const maintenance = Math.round(maintenanceOf(b) * fx.maintenance);
  const jobs = isBusiness(b) ? 0 : jobsOf(b);
  const wages = Math.round(publicWage(kind) * fx.salaries) * jobs;
  return { maintenance, jobs, wages, total: maintenance + wages };
}

/**
 * «−430 €/mes» o «−430 €/mes (mantenimiento y 3 sueldos)» (formato con `fmtMoney`, que pone el cliente).
 * 2.7: con «−»: es un gasto (con «+» se leía como ganancia).
 */
export function monthlyCostText(kind: BuildKind, fmtMoney: (n: number) => string, state?: GameState, long = false): string {
  const c = monthlyCostOf(kind, state);
  if (!c.total) return '';
  if (!long) return `−${fmtMoney(c.total)}/mes`;
  const parts = [c.maintenance ? 'mantenimiento' : '', c.jobs ? `${c.jobs} ${c.jobs === 1 ? 'sueldo' : 'sueldos'}` : ''].filter(Boolean);
  return `−${fmtMoney(c.total)}/mes (${parts.join(' y ')})`;
}

/**
 * 2.6: el mantenimiento de este mes por tipo de edificio: la misma cuenta que
 * `endOfMonth` (lo terminado, el ayuntamiento por su nivel, el presupuesto).
 */
export function maintenanceByKind(state: GameState): { kind: BuildingKind; count: number; amount: number }[] {
  const by = new Map<BuildingKind, { kind: BuildingKind; count: number; amount: number }>();
  const fx = budgetFx(state).maintenance;
  for (const b of state.buildings) {
    if (!b.built) continue;
    const amount = Math.round(maintenanceOf(b) * (b.kind === 'townhall' ? townLevel(state) : 1) * fx);
    if (amount <= 0) continue;
    const e = by.get(b.kind) ?? { kind: b.kind, count: 0, amount: 0 };
    e.count++;
    e.amount += amount;
    by.set(b.kind, e);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount || a.kind.localeCompare(b.kind));
}
