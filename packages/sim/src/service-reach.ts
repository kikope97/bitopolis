import { CARE, SERVICE, SERVICE_CAPACITY } from './balance.ts';
import { nurseryUse } from './care.ts';
import { coverageCtx, homeSites, isHomeKind, NEED_KINDS, NEED_KEYS, needStatus, type CoverageCtx, type NeedKey } from './coverage.ts';
import { serviceCounts, serviceSaturation } from './economy.ts';
import { plantCapacityOf, radiusOf, serviceCapacityOf, truckRouteOf } from './levels.ts';
import { diamondTiles, manhattan, reaches, servingOf } from './reach.ts';
import { type Building, type BuildingKind, DIRS, type GameState, inBounds, tileIndex } from './state.ts';
import { type NetworkTrace, updateNetworks } from './tick.ts';
import { trashServed, truckRoutes } from './trash-core.ts';

/**
 * 2.6 «Lo básico» (queja de un jugador: «al pinchar el colegio no sale la zona
 * que cubre ni a cuántas casas da servicio»). Lo que alcanza un servicio, de
 * verdad o si se pusiera en (x, y): las casillas (rombo, red de calles o ruta
 * del camión), las viviendas a las que da servicio, las que ganaría, con quién
 * se solapa y cuánto se usa. Función pura (no toca el estado ni el hash): usa
 * el mismo predicado (`reaches`) que la carga, la felicidad y «Qué falta».
 */
export type ReachMode = 'radio' | 'red' | 'ruta';

export interface ReachOverlap {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  /** Viviendas a las que llegan los dos. */
  shared: number;
  /** Uso del otro (si tiene capacidad). */
  used?: number;
  of?: number;
  full?: boolean;
}

export interface ReachCapacity {
  /** vecinos (colegio: alumnos, 1 por vecino y 1 por hijo), edificios (agua, luz), calles (camión) o plazas (guardería). */
  unit: 'vecinos' | 'alumnos' | 'edificios' | 'calles' | 'plazas';
  used: number;
  of: number;
  /** Lleno con el mismo criterio que «Qué falta» (el colegio, la salud y la policía, por debajo del 90 % de lo que piden). */
  full: boolean;
}

export interface CoverageInfo {
  kind: BuildingKind;
  /** null: hipotético (aún no está). */
  id: number | null;
  need: NeedKey | null;
  mode: ReachMode;
  radius: number;
  /** Casillas al alcance: el rombo, o las calles de su red o de su ruta (índices y·w + x). */
  tiles: number[];
  /** Red o ruta: edificios a los que da servicio. */
  linked: number[];
  /** Viviendas (ids) a su alcance (rombo) o en su red (agua, luz, basura). */
  homesInReach: number[];
  /** Viviendas a las que atiende de verdad (es el más cercano, su planta o su camión). */
  homesServed: number[];
  /** Vecinos que viven en esas viviendas. */
  peopleServed: number;
  /** Sitios (viviendas o solares R) a su alcance que siguen sin el servicio o con él lleno (✗). */
  lacking: { x: number; y: number; status: 'falta' | 'lleno' }[];
  /** Sitios que hoy no tienen el servicio y lo ganarían con este (sobre todo, al colocarlo). */
  gains: { x: number; y: number }[];
  overlaps: ReachOverlap[];
  capacity: ReachCapacity | null;
  /** Sitios del pueblo a los que les falta ese servicio (para «K sin parque cerca»). */
  townLacking: number;
}

const NETWORK: readonly string[] = ['water', 'power', 'solar', 'wind'];
const isNetwork = (kind: string) => NETWORK.includes(kind);
const netOf = (kind: string): 'water' | 'power' => (kind === 'water' ? 'water' : 'power');

/** La necesidad que cubre cada tipo (las placas y el molino, la luz). */
export function needOfKind(kind: string): NeedKey | null {
  if (kind === 'solar' || kind === 'wind') return 'luz';
  return NEED_KEYS.find((k) => NEED_KINDS[k].includes(kind)) ?? null;
}

/** ¿Tiene alcance que se pueda dibujar? (radio, red o ruta). */
export function hasReach(kind: string, level = 1): boolean {
  if (isNetwork(kind) || kind === 'cleanpoint' || kind === 'nursery') return true;
  return radiusOf({ kind, level } as Building) > 0;
}

/** Los que «son lo mismo» para el solape: los de su necesidad (parque, plaza y mercado: ocio) o los de su tipo. */
function groupOf(kind: string): string[] {
  const need = needOfKind(kind);
  if (need === 'luz') return ['power', 'solar', 'wind'];
  return need ? NEED_KINDS[need] : [kind];
}

const radiusFor = (b: Building) => (b.kind === 'nursery' ? CARE.nursery.radius : radiusOf(b));
/** Como `reaches`, pero la guardería con su radio propio (care.ts). */
function reachesAny(state: GameState, s: Building, x: number, y: number): boolean {
  if (s.kind === 'nursery') return s.built && !s.damaged && manhattan(s, { x, y }) <= CARE.nursery.radius;
  return reaches(state, s, x, y);
}

/** Red de agua y luz con quién sirve a quién, sin tocar el estado (sobre una copia de los edificios). */
const traceCache = new WeakMap<GameState, { key: string; trace: NetworkTrace }>();
export function networkTrace(state: GameState, extra?: Building): NetworkTrace {
  const key = `${state.tick}:${state.buildings.length}:${state.buildings.filter((b) => b.built).length}`;
  const hit = !extra ? traceCache.get(state) : undefined;
  if (hit && hit.key === key) return hit.trace;
  const copy: GameState = { ...state, buildings: [...state.buildings.map((b) => ({ ...b })), ...(extra ? [{ ...extra }] : [])] };
  const trace: NetworkTrace = { water: new Map(), power: new Map(), roads: new Map(), capacity: new Map() };
  updateNetworks(copy, trace);
  if (!extra) traceCache.set(state, { key, trace });
  return trace;
}

function fakeBuilding(state: GameState, kind: BuildingKind, x: number, y: number, level: number): Building {
  // Con el id siguiente: si empata en distancia con otro, atiende el otro (como pasará de verdad).
  return { id: state.nextId, kind, x, y, built: true, level, hasWater: false, hasPower: false } as Building;
}

function peopleIn(state: GameState, homes: Set<number>): number {
  return state.citizens.filter((c) => c.homeId !== null && homes.has(c.homeId)).length;
}

/** Lo que alcanza el edificio `b` (ya puesto). */
export function serviceReach(state: GameState, b: Building, ctx?: CoverageCtx): CoverageInfo {
  return coverageOf(state, b.kind, b.x, b.y, { building: b, ctx });
}

/**
 * Lo que alcanza un servicio de tipo `kind` en (x, y): el que ya está ahí o,
 * si no hay, uno nuevo de nivel `opts.level` (1 por defecto).
 */
export function coverageOf(state: GameState, kind: BuildingKind, x: number, y: number, opts: { level?: number; building?: Building; ctx?: CoverageCtx } = {}): CoverageInfo {
  const real = opts.building ?? state.buildings.find((b) => b.kind === kind && b.x === x && b.y === y);
  const b = real ?? fakeBuilding(state, kind, x, y, opts.level ?? 1);
  const hypo = !real;
  const ctx = opts.ctx ?? coverageCtx(state);
  const need = needOfKind(kind);
  const homes = state.buildings.filter((h) => h.built && isHomeKind(h.kind));
  const townLacking = need ? homeSites(state).filter((s) => status(state, need, s.x, s.y, ctx) === 'falta').length : 0;
  if (isNetwork(kind)) return networkReach(state, b, hypo, need, homes, ctx, townLacking);
  if (kind === 'cleanpoint') return routeReach(state, b, hypo, homes, ctx, townLacking);
  return radiusReach(state, b, hypo, need, homes, ctx, townLacking);
}

function radiusReach(state: GameState, b: Building, hypo: boolean, need: NeedKey | null, homes: Building[], ctx: CoverageCtx, townLacking: number): CoverageInfo {
  const r = radiusFor(b);
  const group = groupOf(b.kind);
  // Para el alcance, el hipotético cuenta como hecho (reachesAny pide built).
  const me: Building = { ...b, built: true, damaged: hypo ? undefined : b.damaged };
  const active = !hypo ? b.built && !b.damaged : true;
  const others = state.buildings.filter((o) => o.id !== b.id && group.includes(o.kind) && o.built && !o.damaged);
  const inReach = active ? homes.filter((h) => reachesAny(state, me, h.x, h.y)) : [];
  const capKind = !!SERVICE_CAPACITY[b.kind];
  // El que atiende a cada vivienda: el más cercano de su tipo (como serviceLoads).
  const servedBy = (h: Building) => servingOf([me, ...others.filter((o) => o.kind === b.kind && reachesAny(state, o, h.x, h.y))], h.x, h.y);
  const served = capKind ? inReach.filter((h) => servedBy(h) === me) : inReach;
  const servedSet = new Set(served.map((h) => h.id));
  let capacity: ReachCapacity | null = null;
  if (capKind) {
    const school = b.kind === 'school';
    const used = hypo
      ? state.citizens.filter((c) => c.homeId !== null && servedSet.has(c.homeId)).reduce((a, c) => a + (school ? 1 + (c.kids?.length ?? 0) : 1), 0)
      : (serviceCounts(state).get(b.id) ?? 0);
    capacity = { unit: school ? 'alumnos' : 'vecinos', used, of: serviceCapacityOf(me), full: hypo ? serviceCapacityOf(me) / Math.max(1, used) < 0.9 : serviceSaturation(state, b.kind, b.id) < 0.9 };
  } else if (b.kind === 'nursery') {
    capacity = { unit: 'plazas', used: hypo ? 0 : (nurseryUse(state).use.get(b.id) ?? 0), of: CARE.nursery.places, full: false };
    if (!hypo) capacity.full = capacity.used >= capacity.of;
  }
  const tiles = diamondTiles(state, b.x, b.y, r);
  const sites = homeSites(state).filter((s) => manhattan(s, b) <= r);
  const covered = (sx: number, sy: number) => others.some((o) => reachesAny(state, o, sx, sy));
  const lacking: CoverageInfo['lacking'] = [];
  const gains: CoverageInfo['gains'] = [];
  for (const s of sites) {
    const inside = reachesAny(state, me, s.x, s.y);
    if (hypo) {
      if (inside && !covered(s.x, s.y)) gains.push(s);
      continue;
    }
    const st = need ? status(state, need, s.x, s.y, ctx) : !inside && !covered(s.x, s.y) ? 'falta' : null;
    if (st) lacking.push({ x: s.x, y: s.y, status: st });
  }
  const overlaps: ReachOverlap[] = [];
  for (const o of others) {
    const ro = radiusFor(o);
    if (manhattan(o, b) > r + ro) continue;
    const shared = inReach.filter((h) => reachesAny(state, o, h.x, h.y)).length;
    const ov: ReachOverlap = { id: o.id, kind: o.kind, x: o.x, y: o.y, shared };
    if (SERVICE_CAPACITY[o.kind]) {
      ov.used = serviceCounts(state).get(o.id) ?? 0;
      ov.of = serviceCapacityOf(o);
      ov.full = serviceSaturation(state, o.kind, o.id) < 0.9;
    }
    overlaps.push(ov);
  }
  return {
    kind: b.kind,
    id: hypo ? null : b.id,
    need,
    mode: 'radio',
    radius: r,
    tiles,
    linked: [],
    homesInReach: inReach.map((h) => h.id),
    homesServed: served.map((h) => h.id),
    peopleServed: peopleIn(state, servedSet),
    lacking,
    gains,
    overlaps: overlaps.sort((a, c) => manhattan(a, b) - manhattan(c, b) || a.id - c.id),
    capacity,
    townLacking,
  };
}

function status(state: GameState, need: NeedKey, x: number, y: number, ctx: CoverageCtx) {
  return ctx.active.includes(need) ? needStatus(state, need, x, y, ctx) : null;
}

/** Sitios (viviendas o solares R) junto a alguna de estas calles. */
function sitesNear(state: GameState, roads: Set<number>): { x: number; y: number }[] {
  return homeSites(state).filter((s) => DIRS.some(([dx, dy]) => inBounds(state, s.x + dx, s.y + dy) && roads.has(tileIndex(state, s.x + dx, s.y + dy))));
}

function networkReach(state: GameState, b: Building, hypo: boolean, need: NeedKey | null, homes: Building[], ctx: CoverageCtx, townLacking: number): CoverageInfo {
  const net = netOf(b.kind);
  const trace = networkTrace(state, hypo ? b : undefined);
  const linked = [...trace[net]].filter(([, p]) => p === b.id).map(([id]) => id);
  const roads = trace.roads.get(b.id) ?? [];
  const roadSet = new Set(roads);
  const linkedSet = new Set(linked);
  const served = homes.filter((h) => linkedSet.has(h.id));
  const servedSet = new Set(served.map((h) => h.id));
  const flag = net === 'water' ? 'hasWater' : 'hasPower';
  const near = sitesNear(state, roadSet);
  const lacking: CoverageInfo['lacking'] = [];
  const gains: CoverageInfo['gains'] = [];
  for (const s of near) {
    const h = homes.find((x) => x.x === s.x && x.y === s.y);
    if (hypo) {
      // Gana si hoy no lo tiene y con la planta nueva sí (en un solar: si su calle aún no está en ninguna red).
      if (h ? !h[flag] && linkedSet.has(h.id) : !DIRS.some(([dx, dy]) => inBounds(state, s.x + dx, s.y + dy) && ctx[net].has(tileIndex(state, s.x + dx, s.y + dy)))) gains.push(s);
      continue;
    }
    if (need && h && !h[flag]) lacking.push({ x: s.x, y: s.y, status: 'falta' });
  }
  const of = trace.capacity.get(b.id) ?? plantCapacityOf(b);
  const overlaps: ReachOverlap[] = [];
  for (const o of state.buildings) {
    if (o.id === b.id || !o.built || !groupOf(b.kind).includes(o.kind)) continue;
    const theirs = new Set(trace.roads.get(o.id) ?? []);
    let touch = false;
    for (const i of roads)
      if (theirs.has(i)) {
        touch = true;
        break;
      }
    if (touch) overlaps.push({ id: o.id, kind: o.kind, x: o.x, y: o.y, shared: 0, used: [...trace[net].values()].filter((p) => p === o.id).length, of: trace.capacity.get(o.id) ?? plantCapacityOf(o) });
  }
  for (const o of overlaps) o.full = (o.used ?? 0) >= (o.of ?? 0);
  return {
    kind: b.kind,
    id: hypo ? null : b.id,
    need,
    mode: 'red',
    radius: 0,
    tiles: roads,
    linked,
    homesInReach: homes.filter((h) => DIRS.some(([dx, dy]) => inBounds(state, h.x + dx, h.y + dy) && roadSet.has(tileIndex(state, h.x + dx, h.y + dy)))).map((h) => h.id),
    homesServed: served.map((h) => h.id),
    peopleServed: peopleIn(state, servedSet),
    lacking,
    gains,
    overlaps,
    capacity: { unit: 'edificios', used: linked.length, of, full: linked.length >= of },
    townLacking,
  };
}

function routeReach(state: GameState, b: Building, hypo: boolean, homes: Building[], ctx: CoverageCtx, townLacking: number): CoverageInfo {
  const st = hypo ? { ...state, buildings: [...state.buildings, b] } : state;
  const route = truckRoutes(st).find((r) => r.id === b.id)?.roads ?? [];
  const servedMap = trashServed(st);
  const linked = [...servedMap].filter(([, p]) => p.id === b.id).map(([id]) => id);
  const linkedSet = new Set(linked);
  const served = homes.filter((h) => linkedSet.has(h.id));
  const servedSet = new Set(served.map((h) => h.id));
  const roadSet = new Set(route);
  // Su trozo de red: ahí, quien no tiene camión lo nota como «lleno» (no da para más).
  const parts = new Set(route.map((i) => ctx.roadPart[i]!));
  const partRoads = new Set<number>();
  ctx.roadPart.forEach((p, i) => p >= 0 && parts.has(p) && partRoads.add(i));
  const lacking: CoverageInfo['lacking'] = [];
  const gains: CoverageInfo['gains'] = [];
  if (hypo) {
    for (const s of sitesNear(state, roadSet)) if (!DIRS.some(([dx, dy]) => inBounds(state, s.x + dx, s.y + dy) && ctx.trash.has(tileIndex(state, s.x + dx, s.y + dy)))) gains.push(s);
  } else {
    for (const s of sitesNear(state, partRoads)) {
      const v = status(state, 'basuras', s.x, s.y, ctx);
      if (v) lacking.push({ x: s.x, y: s.y, status: v });
    }
  }
  const of = truckRouteOf({ ...b, built: true });
  const overlaps: ReachOverlap[] = [];
  for (const r of truckRoutes(st)) {
    if (r.id === b.id || !r.roads.some((i) => parts.has(ctx.roadPart[i]!))) continue;
    const o = state.buildings.find((x) => x.id === r.id)!;
    overlaps.push({ id: o.id, kind: o.kind, x: o.x, y: o.y, shared: 0, used: r.roads.length, of: truckRouteOf(o), full: r.roads.length >= truckRouteOf(o) });
  }
  return {
    kind: b.kind,
    id: hypo ? null : b.id,
    need: 'basuras',
    mode: 'ruta',
    radius: 0,
    tiles: route,
    linked,
    homesInReach: homes.filter((h) => DIRS.some(([dx, dy]) => inBounds(state, h.x + dx, h.y + dy) && partRoads.has(tileIndex(state, h.x + dx, h.y + dy)))).map((h) => h.id),
    homesServed: served.map((h) => h.id),
    peopleServed: peopleIn(state, servedSet),
    lacking,
    gains,
    overlaps,
    capacity: { unit: 'calles', used: route.length, of, full: route.length >= of },
    townLacking,
  };
}

/** Tipos con alcance que dibuja la ficha (para el cliente). */
export const REACH_KINDS: BuildingKind[] = [...(Object.keys(SERVICE) as BuildingKind[]), 'water', 'power', 'solar', 'wind', 'cleanpoint', 'nursery'];
