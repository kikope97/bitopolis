/**
 * 2.4 (bloque C): el río aguas abajo (`fields.river`), depuradora (`sewage`)
 * y renovables (`solar`, `wind`). Números en `WATERWORKS` (balance.ts).
 *
 * El río baja desde su nacimiento hasta su salida (el mar o el borde del
 * mapa). Su orden se calcula por BFS desde la salida y se guarda en memoria
 * (no en el estado: sale del terreno, que no cambia). Viviendas, tiendas y
 * talleres a ≤ `reach` casillas echan al tramo más cercano; lo que se echa se
 * arrastra aguas abajo y se diluye un `decayPerTile` por tramo. La depuradora
 * trata a los edificios que echan aguas arriba de ella (hasta su capacidad) y
 * les quita el 85 %.
 */
import { TICKS_PER_DAY, TICKS_PER_MONTH, tickToDate } from '@bitopolis/shared';
import { WATERWORKS as W } from './balance.ts';
import { directorOwns } from './director-core.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { factionOf } from './politics.ts';
import { chance } from './prng.ts';
import { addMemory } from './social.ts';
import { type Building, type BuildingKind, type Citizen, type GameState, pushEvent } from './state.ts';
import { Terrain } from './terrain.ts';
import { seasonOf } from './weather.ts';

const N8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;
const N4 = N8.slice(0, 4);

/* ---------------- el curso del río ---------------- */

export interface RiverCourse {
  /** Por casilla: tramo (casillas hasta la salida; 0 = la salida) o −1 si no es río. */
  section: Int32Array;
  /** Por casilla: a qué río pertenece (índice en `rivers`) o −1. */
  river: Int32Array;
  /** Cada río: cuántos tramos tiene y una casilla de su salida. */
  rivers: { sections: number; mouth: number }[];
  /** Las casillas de río (por río; del nacimiento a la salida). */
  tiles: number[];
}

const cache = new WeakMap<number[], { sig: number; w: number; course: RiverCourse }>();

/**
 * Orden del río (BFS desde la salida). Si hay mar, sale por las casillas que
 * tocan el mar; si no, por la casilla de borde de índice más alto (determinista:
 * terrain.ts no guarda hacia dónde corre). Sin río, nada.
 */
export function riverCourse(state: GameState): RiverCourse {
  const ter = state.map.terrain ?? [];
  const { w, h } = state.map;
  let sig = 0;
  for (let i = 0; i < ter.length; i++) if (ter[i] === Terrain.River) sig = (Math.imul(sig, 31) + i + 1) | 0;
  const hit = cache.get(ter);
  if (hit && hit.sig === sig && hit.w === w) return hit.course;
  const n = w * h;
  const section = new Int32Array(n).fill(-1);
  const river = new Int32Array(n).fill(-1);
  const rivers: RiverCourse['rivers'] = [];
  const isRiver = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && ter[y * w + x] === Terrain.River;
  const isSea = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && ter[y * w + x] === Terrain.Sea;
  for (let start = 0; start < n; start++) {
    if (ter[start] !== Terrain.River || river[start]! >= 0) continue;
    const id = rivers.length;
    // El río entero (vecinos en 8 direcciones: los meandros se tocan en diagonal).
    const members: number[] = [start];
    river[start] = id;
    for (let k = 0; k < members.length; k++) {
      const i = members[k]!;
      const x = i % w;
      const y = Math.floor(i / w);
      for (const [dx, dy] of N8) {
        if (!isRiver(x + dx, y + dy)) continue;
        const j = (y + dy) * w + x + dx;
        if (river[j]! >= 0) continue;
        river[j] = id;
        members.push(j);
      }
    }
    let seeds = members.filter((i) => N4.some(([dx, dy]) => isSea((i % w) + dx, Math.floor(i / w) + dy)));
    if (!seeds.length) {
      const border = members.filter((i) => i % w === 0 || i % w === w - 1 || i < w || i >= n - w);
      seeds = [Math.max(...(border.length ? border : members))];
    }
    const queue = [...seeds];
    for (const s of seeds) section[s] = 0;
    let max = 0;
    for (let k = 0; k < queue.length; k++) {
      const i = queue[k]!;
      const x = i % w;
      const y = Math.floor(i / w);
      for (const [dx, dy] of N8) {
        if (!isRiver(x + dx, y + dy)) continue;
        const j = (y + dy) * w + x + dx;
        if (section[j]! >= 0) continue;
        section[j] = section[i]! + 1;
        max = Math.max(max, section[j]!);
        queue.push(j);
      }
    }
    rivers.push({ sections: max + 1, mouth: seeds[0]! });
  }
  const tiles: number[] = [];
  for (let i = 0; i < n; i++) if (river[i]! >= 0) tiles.push(i);
  tiles.sort((a, b) => river[a]! - river[b]! || section[b]! - section[a]! || a - b);
  const course = { section, river, rivers, tiles };
  cache.set(ter, { sig, w, course });
  return course;
}

export const hasRiver = (state: GameState) => riverCourse(state).tiles.length > 0;

/** Casilla de río más cercana a ≤ `reach` (Manhattan; empate, la de índice menor), o −1. */
export function nearestRiverTile(state: GameState, x: number, y: number, reach = W.reach, course = riverCourse(state)): number {
  const w = state.map.w;
  let best = -1;
  let bestD = Infinity;
  for (const i of course.tiles) {
    const d = Math.abs((i % w) - x) + Math.abs(Math.floor(i / w) - y);
    if (d <= reach && (d < bestD || (d === bestD && i < best))) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/* ---------------- lo que echa cada uno y lo que baja ---------------- */

const spilling = (state: GameState, b: Building) => (b.spill ?? -1) > state.tick;

/** Lo que echa un edificio al río al día (0 si no echa). */
export function dumpOf(state: GameState, b: Building): number {
  if (!b.built || b.damaged) return 0;
  const d = W.dump[b.kind] ?? 0;
  return spilling(state, b) ? d * W.spill.mult : d;
}

export interface RiverLoad {
  /** Por río y tramo: suciedad (sin recortar a 100). */
  value: Float64Array[];
  /** Edificios que echan al río y cuántos trata la depuradora. */
  dumpers: number;
  treated: number;
}

/**
 * Lo que lleva el río en cada tramo. Se recorre del nacimiento a la salida:
 * cada tramo recibe lo de arriba (menos `decayPerTile`) más lo que echan a él.
 * En el tramo de una depuradora se quita `clean` a la parte que puede tratar
 * (los edificios de aguas arriba aún sin depurar, hasta su capacidad).
 */
export function riverLoad(state: GameState, course = riverCourse(state)): RiverLoad {
  const per = course.rivers.map((r) => ({ dump: new Float64Array(r.sections), count: new Int32Array(r.sections), cap: new Float64Array(r.sections) }));
  let dumpers = 0;
  let treated = 0;
  if (!course.tiles.length) return { value: [], dumpers, treated };
  for (const b of state.buildings) {
    const d = dumpOf(state, b);
    const plant = b.kind === 'sewage' && b.built && !b.damaged;
    if (!d && !plant) continue;
    const i = nearestRiverTile(state, b.x, b.y, W.reach, course);
    if (i < 0) continue;
    const r = per[course.river[i]!]!;
    const s = course.section[i]!;
    if (d) {
      r.dump[s]! += d;
      r.count[s]!++;
      dumpers++;
    }
    if (plant) r.cap[s]! += W.sewage.buildings;
  }
  const value = per.map((r) => {
    const out = new Float64Array(r.dump.length);
    let load = 0;
    let untreated = 0;
    for (let s = r.dump.length - 1; s >= 0; s--) {
      load = load * (1 - W.decayPerTile) + r.dump[s]!;
      untreated += r.count[s]!;
      const cap = r.cap[s]!;
      if (cap > 0 && untreated > 0) {
        const done = Math.min(untreated, cap);
        load *= 1 - W.sewage.clean * (done / untreated);
        untreated -= done;
        treated += done;
      }
      out[s] = load;
    }
    return out;
  });
  return { value, dumpers, treated };
}

/** Recalcula `fields.river` (0–100 en las casillas de río, 0 en las demás). */
export function updateRiver(state: GameState): void {
  const course = riverCourse(state);
  const n = state.map.w * state.map.h;
  const f = (state.fields.river ??= new Array(n).fill(0));
  if (!course.tiles.length) {
    if (f.some((v) => v)) f.fill(0);
    return;
  }
  const { value } = riverLoad(state, course);
  for (let i = 0; i < n; i++) {
    const r = course.river[i]!;
    f[i] = r < 0 ? 0 : Math.max(0, Math.min(100, Math.round(value[r]![course.section[i]!]!)));
  }
}

/** Cómo sale el río del pueblo (el peor de sus salidas; 0 sin río). */
export function riverExit(state: GameState): number {
  const course = riverCourse(state);
  let worst = 0;
  for (const i of course.tiles) if (course.section[i] === 0) worst = Math.max(worst, state.fields.river?.[i] ?? 0);
  return worst;
}

/** El tramo más sucio del pueblo. */
export function riverWorst(state: GameState): number {
  let worst = 0;
  for (const i of riverCourse(state).tiles) worst = Math.max(worst, state.fields.river?.[i] ?? 0);
  return worst;
}

/** Suciedad del río más alta a ≤ `r` casillas (en cuadrado) de (x, y). */
export function riverNear(state: GameState, x: number, y: number, r: number): number {
  const { w, h } = state.map;
  const f = state.fields.river ?? [];
  let worst = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      worst = Math.max(worst, f[ny * w + nx] ?? 0);
    }
  }
  return worst;
}

/** ¿El río junto a la bomba baja sucio? Entonces pierde su +25 %. */
export const pumpDirty = (state: GameState, x: number, y: number) => riverNear(state, x, y, 1) > W.dirtyPump;

/* ---------------- depuradora ---------------- */

/** La depuradora tiene que verter al río (a ≤ `reach` casillas). */
export function canBuildWaterworks(state: GameState, kind: string, x: number, y: number): { ok: true } | { ok: false; error: string } {
  if (kind === 'sewage') {
    if (!hasRiver(state)) return { ok: false, error: 'No hay río en el pueblo: la depuradora no tendría dónde verter' };
    if (nearestRiverTile(state, x, y) < 0) return { ok: false, error: `La depuradora tiene que estar a ${W.reach} casillas del río o menos` };
  }
  if (kind === 'wind' && (state.map.terrain?.[y * state.map.w + x] ?? Terrain.Flat) !== Terrain.Hill) return { ok: false, error: 'El molino va en la colina: ahí sopla el viento' };
  if (kind === 'solar') {
    const t = state.map.terrain?.[y * state.map.w + x] ?? Terrain.Flat;
    if (t !== Terrain.Flat && t !== Terrain.Hill) return { ok: false, error: 'Las placas van en llano o en la colina' };
  }
  return { ok: true };
}

/* ---------------- renovables ---------------- */

export const RENEWABLES = ['solar', 'wind'] as const;
export const isRenewable = (kind: BuildingKind | string): kind is 'solar' | 'wind' => kind === 'solar' || kind === 'wind';
/** ¿Da luz por la red? (la central y las renovables). */
export const isPowerPlant = (kind: BuildingKind | string) => kind === 'power' || isRenewable(kind);

/** Edificios a los que da luz una renovable, sin el tiempo. */
export function renewableCapacity(kind: BuildingKind | string): number {
  return kind === 'solar' ? W.solar.buildings : kind === 'wind' ? W.wind.buildings : 0;
}

/** Lo que rinde hoy con el tiempo y la estación: placas, menos en invierno y aún menos con nieve; molino, más con tormenta. */
export function renewableFx(state: GameState, kind: BuildingKind | string): number {
  const k = state.weather?.kind;
  if (kind === 'solar') {
    if (k === 'nieve') return W.solar.snow;
    return seasonOf(tickToDate(state.tick).month) === 'invierno' ? W.solar.winter : 1;
  }
  if (kind === 'wind') return k === 'tormenta' ? W.wind.storm : 1;
  return 1;
}

/* ---------------- ánimo, quejas y facciones ---------------- */

const windNear = (state: GameState, home: Building) =>
  state.buildings.some((b) => b.kind === 'wind' && b.built && !b.damaged && Math.abs(b.x - home.x) + Math.abs(b.y - home.y) <= W.wind.complainRadius);
const retiree = (c: Citizen) => c.age >= 62;

/** Felicidad: la orilla de un río sucio y, para los jubilados, el ruido de los molinos. */
export function waterworksMood(state: GameState, c: Citizen, home: Building | undefined): { label: string; value: number }[] {
  if (!home) return [];
  const out: { label: string; value: number }[] = [];
  if (riverNear(state, home.x, home.y, W.shoreRadius) > W.dirtyPump) out.push({ label: 'El río baja sucio', value: W.shoreMood });
  if (retiree(c) && windNear(state, home)) out.push({ label: 'Ruido de los molinos', value: -W.wind.retireeMood });
  return out;
}

/** Quejas para las asociaciones (associations.ts): «Salvemos el río» y el ruido de los molinos. */
export function waterGrievances(state: GameState, c: Citizen, home: Building): ['rio' | 'ruido_molinos', number][] {
  const out: ['rio' | 'ruido_molinos', number][] = [];
  const dirty = riverNear(state, home.x, home.y, W.shoreRadius);
  if (dirty > W.dirtyPump) out.push(['rio', 3 + (dirty - W.dirtyPump) / 10]);
  if (retiree(c) && windNear(state, home)) out.push(['ruido_molinos', W.wind.complainScore]);
  return out;
}

/** Ecologistas: satisfacción por las renovables y la depuradora (politics.ts). */
export function greenFaction(state: GameState): number {
  const built = (b: Building) => b.built && !b.damaged;
  const renewables = state.buildings.filter((b) => isRenewable(b.kind) && built(b)).length;
  const sewage = state.buildings.some((b) => b.kind === 'sewage' && built(b));
  return Math.min(W.greenMax, renewables * W.greenPerRenewable) + (sewage ? W.greenSewage : 0);
}

/** ¿Piden los ecologistas un río limpio? */
export const riverDirty = (state: GameState) => riverWorst(state) > W.dirtyPump;

/* ---------------- vertidos ---------------- */

const nameOf = (b: Building) => b.name ?? 'un taller';

/** Talleres a la orilla que podrían verter sin depurar (sin depuradora en el pueblo). */
export function spillCandidates(state: GameState): Building[] {
  if (!hasRiver(state) || state.buildings.some((b) => b.kind === 'sewage' && b.built && !b.damaged)) return [];
  return state.buildings.filter((b) => b.kind === 'factory' && b.built && !b.damaged && !spilling(state, b) && nearestRiverTile(state, b.x, b.y) >= 0).sort((a, b) => a.id - b.id);
}

/** Candidatos del director (director.ts los añade al final de su menú). */
export function waterworksCandidates(state: GameState): { id: string; kind: 'vertido'; bad: true; text: string; why: string }[] {
  const b = spillCandidates(state)[0];
  if (!b) return [];
  const course = riverCourse(state);
  const i = nearestRiverTile(state, b.x, b.y, W.reach, course);
  const d = Math.abs((i % state.map.w) - b.x) + Math.abs(Math.floor(i / state.map.w) - b.y);
  const now = riverExit(state);
  return [
    {
      id: `vertido:${b.id}`,
      kind: 'vertido',
      bad: true,
      text: `${nameOf(b)} vierte al río sin depurar`,
      why: `está a ${d} ${d === 1 ? 'casilla' : 'casillas'} del río, no hay depuradora${now ? ` y el río ya sale del pueblo a ${now}` : ''}`,
    },
  ];
}

/** Empieza un vertido: el taller echa `spill.mult` veces más durante unos días. */
export function startSpill(state: GameState, id: number): boolean {
  const b = spillCandidates(state).find((x) => x.id === id);
  if (!b) return false;
  b.spill = state.tick + W.spill.days * TICKS_PER_DAY;
  for (const c of state.citizens) if (c.named && factionOf(state, c) === 'ecologistas') addMemory(state, c, 'rumor', 3, W.spill.ecoMemory);
  pushEvent(state, 'warning', `${nameOf(b)} vierte al río: el agua baja turbia aguas abajo. Una depuradora lo evitaría`, { ref: b.id, notify: true });
  return true;
}

/** Cada día (tras los campos): el río y los vertidos que terminan. */
export function waterworksDay(state: GameState): void {
  for (const b of state.buildings) if (b.spill !== undefined && b.spill <= state.tick) delete b.spill;
  updateRiver(state);
}

/**
 * Cada mes: la multa trimestral de la Confederación si el río sale demasiado
 * sucio y, sin director, el vertido por reglas (respaldo).
 */
export function waterworksMonth(state: GameState): void {
  const month = Math.floor(state.tick / TICKS_PER_MONTH);
  const exit = riverExit(state);
  if (month % 3 === 0 && exit > W.fineAt) {
    transfer(state, TREASURY, OUTSIDE, W.fine, 'multa del río');
    pushEvent(state, 'warning', `La Confederación Hidrográfica multa al ayuntamiento con ${W.fine} €: el río sale del pueblo muy sucio (${exit}). Una depuradora aguas abajo lo arregla`, { notify: true });
  }
  if (!directorOwns(state)) {
    const b = spillCandidates(state)[0];
    if (b && chance(state.rng, W.spill.ruleChance)) startSpill(state, b.id);
  }
}
