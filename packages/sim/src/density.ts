/**
 * 2.5 (bloque F): densidad de las zonas R (`map.density`, `SetZoneDensity`)
 * y vivienda protegida (`vpo`) con sorteo determinista. Números en `DENSITY` y `VPO`.
 *
 * - Densidad: el alcalde marca casillas de zona R como media o alta. Un bloque
 *   `res` en esa casilla crece (4 → 8 → 12 viviendas, `b.dense`) si el suelo vale
 *   y hay demanda; hace más ruido. Lo ya crecido no encoge si se baja la densidad.
 * - VPO: 6 pisos municipales a 120 €/mes (con `charge`: lo impagado, deuda). No se
 *   reparten como las demás casas: cada mes, sorteo por hash (sin dados) entre
 *   quienes la pidieron (`pedir_vpo`, IA o reglas) y los que menos ganan.
 *   La última vivienda, si la quieren dos familias, puede ser el dilema `ultima_vpo`.
 */
import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { DENSITY, HOMES, VPO } from './balance.ts';
import type { CommandResult } from './commands.ts';
import { hash32 } from './hash.ts';
import { charge } from './household.ts';
import { TREASURY } from './money.ts';
import { addMemory } from './social.ts';
import { type Building, type Citizen, type GameState, inBounds, pushEvent, Zone } from './state.ts';
import { townLevel } from './townhall.ts';

export function densityAt(state: GameState, x: number, y: number): number {
  return state.map.density?.[y * state.map.w + x] ?? 0;
}

/** Viviendas de un edificio (los bloques según lo que han crecido; la VPO, las suyas). */
export function homesOf(b: Building): number {
  if (b.kind === 'res') return DENSITY.homes[b.dense ?? 0] ?? HOMES.res ?? 0;
  if (b.kind === 'vpo') return VPO.homes;
  return HOMES[b.kind] ?? 0;
}

const DENSITY_NAMES = ['baja', 'media', 'alta'];

export function canSetZoneDensity(state: GameState, x: number, y: number, w: number, h: number, level: number): CommandResult {
  if (!inBounds(state, x, y) || !inBounds(state, x + w - 1, y + h - 1)) return { ok: false, error: 'Fuera del mapa' };
  const need = DENSITY.townhall[level] ?? 99;
  if (townLevel(state) < need) return { ok: false, error: `La densidad ${DENSITY_NAMES[level]} pide el ayuntamiento de nivel ${need}` };
  if (zoneTiles(state, x, y, w, h).length === 0) return { ok: false, error: 'Solo se puede cambiar la densidad de la zona residencial' };
  return { ok: true };
}

/** Casillas de zona R del rectángulo. */
function zoneTiles(state: GameState, x: number, y: number, w: number, h: number): number[] {
  const { w: W, h: H, zones } = state.map;
  const out: number[] = [];
  for (let yy = y; yy < Math.min(H, y + h); yy++) for (let xx = x; xx < Math.min(W, x + w); xx++) if (zones[yy * W + xx] === Zone.R) out.push(yy * W + xx);
  return out;
}

export function setZoneDensity(state: GameState, x: number, y: number, w: number, h: number, level: number): void {
  const { w: W, h: H } = state.map;
  if (!state.map.density) state.map.density = new Array(W * H).fill(0);
  for (const i of zoneTiles(state, x, y, w, h)) state.map.density[i] = level;
}

/* ---------------- crecimiento ---------------- */

/** Bloques que pueden crecer ahora (por id: sin dados). */
export function growableBlocks(state: GameState): Building[] {
  if (!state.map.density || state.demand.R <= DENSITY.minDemandR) return [];
  const { w, zones } = state.map;
  return state.buildings.filter((b) => {
    if (b.kind !== 'res' || !b.built || b.damaged) return false;
    const i = b.y * w + b.x;
    return zones[i] === Zone.R && densityAt(state, b.x, b.y) > (b.dense ?? 0) && (state.fields.land[i] ?? 0) > DENSITY.minLand;
  });
}

/**
 * Cada `everyDays` días, como mucho `perCheck` bloques suben un nivel (sin dados:
 * primero el de más suelo). Sin `map.density` no hace nada (partidas de antes).
 */
export function densityDay(state: GameState, freeHomes: number): void {
  if (!state.map.density) return;
  const day = Math.floor(state.tick / TICKS_PER_DAY);
  if (day % DENSITY.everyDays !== 0 || freeHomes >= DENSITY.maxFree) return;
  const w = state.map.w;
  const list = growableBlocks(state).sort((a, b) => (state.fields.land[b.y * w + b.x] ?? 0) - (state.fields.land[a.y * w + a.x] ?? 0) || a.id - b.id);
  for (const b of list.slice(0, DENSITY.perCheck)) {
    b.dense = (b.dense ?? 0) + 1;
    pushEvent(state, 'info', `Un bloque de pisos crece: ahora tiene ${homesOf(b)} viviendas`, { ref: b.id });
  }
}

/* ---------------- vivienda protegida ---------------- */

const isVpo = (state: GameState, id: number | null) => id !== null && state.buildings.some((b) => b.id === id && b.kind === 'vpo');

function detained(state: GameState): Set<number> {
  const out = new Set<number>();
  for (const x of [...(state.justice?.cells ?? []), ...(state.justice?.jail ?? [])]) if (x.citizenId !== undefined) out.add(x.citizenId);
  return out;
}

/** Lo que entró el mes pasado (sueldo, pensión, prestación…). */
export const incomeOf = (c: Citizen): number => c.last?.in ?? 0;

/** Quién puede optar a la VPO: adulto, sin casa en propiedad, fuera de la VPO, de la residencia y de la cárcel. */
export function vpoEligible(state: GameState, c: Citizen, jailed = detained(state)): boolean {
  return c.age >= 18 && !c.owns && !isVpo(state, c.homeId) && c.care !== 'residencia' && !jailed.has(c.id);
}

/** VPO construidas, sin daños, y sus pisos libres. */
export function vpoFree(state: GameState): { b: Building; free: number }[] {
  const use = new Map<number, number>();
  for (const c of state.citizens) if (c.homeId !== null) use.set(c.homeId, (use.get(c.homeId) ?? 0) + 1);
  return state.buildings.filter((b) => b.kind === 'vpo' && b.built && !b.damaged).map((b) => ({ b, free: Math.max(0, homesOf(b) - (use.get(b.id) ?? 0)) }));
}

/** ¿Hay una petición vigente? */
export const askedVpo = (state: GameState, c: Citizen): boolean => c.vpoAsk !== undefined && state.tick - c.vpoAsk < VPO.askMonths * TICKS_PER_MONTH;

/**
 * Bombo del sorteo: quienes la pidieron y los `pool` que menos ganan (en ese
 * orden: menos ingresos primero; empate, el id).
 */
export function vpoPool(state: GameState): Citizen[] {
  const jailed = detained(state);
  const all = state.citizens.filter((c) => vpoEligible(state, c, jailed)).sort((a, b) => incomeOf(a) - incomeOf(b) || a.id - b.id);
  const low = new Set(all.slice(0, VPO.pool));
  return all.filter((c) => low.has(c) || askedVpo(state, c));
}

/** Orden del sorteo (hash de la partida, el mes, el edificio y el vecino): igual en todos los motores. */
export function vpoDraw(state: GameState, b: Building, pool: Citizen[]): Citizen[] {
  const month = Math.floor(state.tick / TICKS_PER_MONTH);
  return [...pool].sort((x, y) => hash32(state.seed, month, b.id, x.id) - hash32(state.seed, month, b.id, y.id) || x.id - y.id);
}

/** Da un piso de la VPO a un vecino (y a su pareja si vive con él y cabe). Devuelve cuántos entran. */
export function giveVpo(state: GameState, b: Building, c: Citizen, room: number): number {
  if (room <= 0) return 0;
  const before = c.homeId;
  const movers = [c];
  const partner = c.relations.find((r) => r.kind === 'pareja');
  const p = partner ? state.citizens.find((x) => x.id === partner.id) : undefined;
  if (p && room >= 2 && before !== null && p.homeId === before && !p.owns) movers.push(p);
  for (const m of movers) {
    m.homeId = b.id;
    m.rentArrears = 0;
    delete m.vpoAsk;
  }
  c.happiness = Math.min(100, c.happiness + VPO.winMood);
  if (c.named) addMemory(state, c, 'piso_protegido', 4, 4);
  pushEvent(state, 'info', `${c.name} recibe un piso de la vivienda protegida (${VPO.rent} € al mes)`, { ref: c.id });
  return movers.length;
}

/**
 * Cada mes: sorteo de los pisos libres. Una VPO con el dilema `ultima_vpo`
 * abierto espera a que decida el alcalde.
 */
export function vpoMonth(state: GameState): void {
  const waiting = new Set(state.dilemmas.filter((d) => d.kind === 'ultima_vpo' && !d.resolved).map((d) => d.buildingId));
  for (const { b, free } of vpoFree(state)) {
    if (free <= 0 || waiting.has(b.id)) continue;
    let room = free;
    for (const c of vpoDraw(state, b, vpoPool(state))) {
      if (room <= 0) break;
      if (!vpoEligible(state, c)) continue; // ya entró con su pareja
      room -= giveVpo(state, b, c, room);
    }
  }
}

/** Alquiler de la VPO: cada vecino que vive en ella paga `VPO.rent` (lo que no pueda, deuda). */
export function vpoRentMonth(state: GameState): void {
  const ids = new Set(state.buildings.filter((b) => b.kind === 'vpo' && b.built && b.damaged?.cause !== 'fuego').map((b) => b.id));
  if (!ids.size) return;
  for (const c of state.citizens) if (c.homeId !== null && ids.has(c.homeId)) charge(state, c, TREASURY, VPO.rent, 'alquileres');
}

/** Quién vive en una VPO y lo que paga (para la ficha). */
export function vpoTenants(state: GameState, b: Building): { citizen: Citizen; rent: number; debt: number }[] {
  return state.citizens.filter((c) => c.homeId === b.id).map((c) => ({ citizen: c, rent: VPO.rent, debt: c.debt?.town ?? 0 }));
}

/* ---------------- IA: pedir_vpo ---------------- */

/** ¿Puede pedir una VPO? Hay pisos libres (o casi), opta y no lo pidió ya. */
export function canAskVpo(state: GameState, c: Citizen): boolean {
  if (state.politics.mayor === c.id || askedVpo(state, c)) return false;
  if (!vpoFree(state).some((x) => x.free > 0)) return false;
  return vpoEligible(state, c);
}

/** Acción del menú del turno (al final del menú). */
export function vpoMenu(state: GameState, c: Citizen): { accion: string; detalle?: string }[] {
  if (!canAskVpo(state, c)) return [];
  const free = vpoFree(state).reduce((s, x) => s + x.free, 0);
  return [{ accion: 'pedir_vpo', detalle: `pedir un piso de la vivienda protegida (${VPO.rent} €/mes; ${free === 1 ? 'queda 1 libre' : `quedan ${free} libres`}; se sortea cada mes entre quienes lo piden y los que menos ganan)` }];
}

/** Por reglas: pide quien gana poco y no tiene casa propia. */
export function vpoRuleAction(state: GameState, c: Citizen): string | null {
  return canAskVpo(state, c) && incomeOf(c) < VPO.askIncome ? 'pedir_vpo' : null;
}

export function askVpo(state: GameState, c: Citizen): string {
  if (!canAskVpo(state, c)) return 'al final no pide la vivienda protegida';
  c.vpoAsk = state.tick;
  return 'pide un piso de la vivienda protegida y entra en el sorteo';
}
