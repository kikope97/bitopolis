/**
 * 2.4 (bloque B): estación de autobuses (`busstation`), billete (`SetBusFare`),
 * trabajo fuera y visitantes. Números en `TRANSIT` (balance.ts).
 *
 * Una sola estación, que cubre todo el pueblo: quien trabaja fuera va en
 * autobús (encuentra y conserva mejor el trabajo de fuera), viene más gente a
 * vivir, el billete va al ayuntamiento y el Consorcio paga la mitad del
 * mantenimiento. IA: el parado puede `buscar_trabajo_fuera` y el director
 * puede organizar una `excursion` de jubilados (suceso bueno).
 */
import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { JOBS_OUTSIDE, TRANSIT } from './balance.ts';
import { isRetired } from './care.ts';
import type { CommandResult } from './commands.ts';
import { directorOwns } from './director-core.ts';
import { charge, outsideJobsFx } from './household.ts';
import { maintenanceOf } from './levels.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { chance } from './prng.ts';
import { addMemory } from './social.ts';
import type { MenuItem } from './turns.ts';
import { type Building, type BusFare, type Citizen, type GameState, pushEvent } from './state.ts';

/** La estación que funciona (lo destrozado no lleva a nadie). */
export function busStation(state: GameState): Building | undefined {
  return state.buildings.find((b) => b.kind === 'busstation' && b.built && !b.damaged);
}

export function canSetBusFare(state: GameState, fare: BusFare): CommandResult {
  if (!state.buildings.some((b) => b.kind === 'busstation' && b.built)) return { ok: false, error: 'Primero hay que construir la estación de autobuses' };
  if (state.transit.fare === fare) return { ok: false, error: 'Ese billete ya está puesto' };
  return { ok: true };
}

export function setBusFare(state: GameState, fare: BusFare): void {
  state.transit.fare = fare;
}

/** Solo una estación por pueblo (cubre a todos). */
export function canBuildBusStation(state: GameState): CommandResult {
  if (state.buildings.some((b) => b.kind === 'busstation')) return { ok: false, error: 'Ya hay una estación de autobuses: llega a todo el pueblo' };
  return { ok: true };
}

/** Va en autobús: trabaja fuera (ni en paro ni jubilado) y hay estación. */
export function isRider(state: GameState, c: Citizen): boolean {
  return !!busStation(state) && c.jobId === null && c.unemployedSince === undefined && !isRetired(c);
}

export function riders(state: GameState): number {
  if (!busStation(state)) return 0;
  return state.citizens.filter((c) => isRider(state, c)).length;
}

/** Probabilidades al mes del trabajo de fuera (con estación, mejores). */
export function transitJobs(state: GameState): { find: number; lose: number } {
  return busStation(state) ? { find: TRANSIT.findByFare[state.transit.fare] ?? TRANSIT.findChance, lose: TRANSIT.loseChance } : { find: JOBS_OUTSIDE.findChance, lose: JOBS_OUTSIDE.loseChance };
}

/** Demanda de vivienda que añade la estación. */
export function busDemandR(state: GameState): number {
  return busStation(state) ? TRANSIT.demandR : 0;
}

/** Visitantes del turismo (×1,25 con autobús). */
export function busVisitorsFx(state: GameState): number {
  return busStation(state) ? TRANSIT.visitorsFx : 1;
}

/** Billete al mes por usuario. */
export function monthlyFare(state: GameState): number {
  return TRANSIT.fare[state.transit.fare] * TRANSIT.workDays;
}

/** Ánimo de quien va en autobús (y si el billete es caro). */
export function transitMood(state: GameState, c: Citizen): { label: string; value: number }[] {
  if (!isRider(state, c)) return [];
  const out = [{ label: 'Va en autobús al trabajo', value: TRANSIT.mood }];
  if (state.transit.fare === 'caro') out.push({ label: 'El billete del autobús es caro', value: TRANSIT.dearMood });
  if (state.transit.fare === 'gratis') out.push({ label: 'El autobús es gratis', value: TRANSIT.freeMood });
  return out;
}

/**
 * Cada mes (tras los tributos): los usuarios pagan el billete al ayuntamiento,
 * el Consorcio paga su parte del mantenimiento y, si el pueblo no tiene
 * turismo, vienen excursionistas de la comarca que gastan en las tiendas.
 * Sin director (Modo normal o IA caída), alguna excursión de jubilados por reglas.
 */
export function transitMonth(state: GameState, shops: Building[], visitors: number): void {
  const st = busStation(state);
  if (!st) {
    state.transit.riders = 0;
    return;
  }
  const fare = monthlyFare(state);
  let n = 0;
  for (const c of state.citizens) {
    if (!isRider(state, c)) continue;
    n++;
    // Ronda 20: cobro obligatorio: lo que no pueda pagar queda como deuda.
    if (fare > 0) charge(state, c, TREASURY, fare, 'autobús');
  }
  state.transit.riders = n;
  transfer(state, OUTSIDE, TREASURY, Math.round(maintenanceOf(st) * TRANSIT.consortium), 'Consorcio');
  // Excursionistas (solo si no hay turismo: con él, el autobús ya trae más visitantes).
  if (visitors <= 0 && shops.length) {
    const total = Math.round((TRANSIT.daytripPer10 * state.citizens.length * 30) / 10);
    const each = Math.floor(total / shops.length);
    for (const b of shops) {
      const got = transfer(state, OUTSIDE, b.id, each);
      b.sales = (b.sales ?? 0) + got;
    }
  }
  if (!directorOwns(state) && excursionCandidate(state) && chance(state.rng, TRANSIT.excursion.ruleChance)) applyExcursion(state);
}

/* ---------------- IA ---------------- */

/** Acciones del menú de la IA (al final del menú). */
export function transitMenu(state: GameState, c: Citizen): MenuItem[] {
  if (!busStation(state) || c.jobId !== null || c.unemployedSince === undefined || isRetired(c)) return [];
  // Ronda 20: una vez al mes (si no, la IA tiraba los dados cada semana).
  if (c.busSearch !== undefined && state.tick - c.busSearch < TICKS_PER_MONTH) return [];
  return [{ accion: 'buscar_trabajo_fuera', detalle: `buscar trabajo fuera del pueblo en autobús (está en paro; con la estación es más fácil encontrarlo)` }];
}

/** Por reglas: el parado ambicioso busca trabajo fuera en autobús. */
export function transitRuleAction(state: GameState, c: Citizen): string | null {
  return transitMenu(state, c).length && c.traits.ambicion >= TRANSIT.searchAmbition ? 'buscar_trabajo_fuera' : null;
}

/** Busca trabajo fuera: el motor decide si lo encuentra. */
export function searchJobOutside(state: GameState, c: Citizen): string {
  if (!transitMenu(state, c).length) return 'al final no busca trabajo fuera';
  c.busSearch = state.tick;
  // Ronda 20: la crisis de la comarca también cuenta, y la búsqueda solo da un empujón sobre la tirada del mes.
  if (chance(state.rng, Math.min(0.95, TRANSIT.searchBonus * outsideJobsFx(state)))) {
    delete c.unemployedSince;
    delete c.benefitLeft;
    if (c.named) pushEvent(state, 'info', `${c.name} encuentra trabajo fuera del pueblo: irá cada día en autobús`, { ref: c.id });
    return 'encuentra trabajo fuera y va en autobús';
  }
  return 'busca trabajo fuera en autobús, sin suerte de momento';
}

/** Jubilados que irían de excursión (los de nombre primero). */
function trippers(state: GameState): Citizen[] {
  return state.citizens
    .filter((c) => isRetired(c))
    .sort((a, b) => Number(b.named) - Number(a.named) || a.id - b.id)
    .slice(0, TRANSIT.excursion.max);
}

/** Candidato del director: excursión de jubilados en autobús (suceso bueno). */
export function excursionCandidate(state: GameState): { id: string; text: string; why: string } | null {
  if (!busStation(state)) return null;
  const ts = trippers(state);
  if (ts.length < TRANSIT.excursion.min) return null;
  const since = state.tick - TRANSIT.excursion.everyDays * TICKS_PER_DAY;
  if (state.citizens.some((c) => c.memories.some((m) => m.kind === 'excursion' && m.tick > since))) return null;
  return { id: 'excursion:jubilados', text: 'Los jubilados se van de excursión en autobús', why: `hay estación de autobuses y ${ts.length} jubilados en el pueblo` };
}

/** La excursión: los jubilados lo pasan bien (recuerdo), pagan un poco el viaje y comen fuera. */
export function applyExcursion(state: GameState): { id: number; text: string } | null {
  if (!excursionCandidate(state)) return null;
  const ts = trippers(state);
  for (const c of ts) {
    addMemory(state, c, 'excursion', 3, TRANSIT.excursion.mood);
    transfer(state, c.id, OUTSIDE, TRANSIT.excursion.cost);
  }
  pushEvent(state, 'info', `Excursión de los jubilados en autobús: ${ts.length} vecinos pasan el día fuera y vuelven contentos`, { ref: ts[0]?.id });
  return { id: ts[0]?.id ?? 0, text: 'Los jubilados se van de excursión en autobús' };
}
