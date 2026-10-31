import { TICKS_PER_DAY, DAYS_PER_YEAR } from '@bitopolis/shared';
import {
  ADULT_AGE,
  BIRTH_CHANCE_ADULT,
  BIRTH_CHANCE_COUPLE,
  DEATH_RATE_MAX,
  DEATH_RATE_PER_YEAR_OVER,
  DEATH_START_AGE,
  KIDS_MAX,
} from './balance.ts';
import { monthRates, sellOnDeparture, unitValue } from './economy.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { chance } from './prng.ts';
import { addMemory } from './social.ts';
import type { Citizen, GameState } from './state.ts';
import { pushEvent } from './state.ts';
import { freeHomes, newResident } from './tick.ts';

/**
 * Ciclo vital (v1.5): cumpleaños, nacimientos, hijos que se independizan,
 * fallecimientos y herencias. Determinista (PRNG de la partida).
 */

const YEAR_TICKS = DAYS_PER_YEAR * TICKS_PER_DAY;
const first = (c: Citizen) => c.name.split(' ')[0]!;
const surname = (c: Citizen) => c.name.split(' ').slice(1, 2).join(' ') || 'García';

/** A quién pasa lo suyo: su pareja o, si no, su amistad más fuerte en el pueblo. */
export function heirOf(state: GameState, c: Citizen): Citizen | undefined {
  const rels = [...c.relations].sort((a, b) => (a.kind === 'pareja' ? -1 : b.kind === 'pareja' ? 1 : b.strength - a.strength));
  for (const r of rels) {
    if (r.kind !== 'pareja' && r.kind !== 'amistad') continue;
    const h = state.citizens.find((x) => x.id === r.id);
    if (h) return h;
  }
  return undefined;
}

/** Fallece un vecino: herencia (dinero, casa, negocio y plusvalía municipal), duelo y baja. */
export function dies(state: GameState, c: Citizen): void {
  const heir = heirOf(state, c);
  // Negocios: a quien hereda o, si no hay, a un inversor de fuera.
  for (const b of state.buildings) if (b.owner === c.id) b.owner = heir ? heir.id : OUTSIDE;
  const home = state.buildings.find((b) => b.id === c.homeId);
  if (c.owns && home && heir && heir.homeId === c.homeId && !heir.owns) {
    // La casa pasa a quien vivía con él o ella; el ayuntamiento cobra la plusvalía (como en la realidad).
    const gain = Math.max(0, unitValue(state, home) - c.boughtPrice);
    heir.owns = true;
    heir.boughtPrice = c.boughtPrice;
    heir.boughtTick = c.boughtTick;
    heir.mortgage = c.mortgage;
    heir.mortgageTo = c.mortgageTo;
    heir.subsidized = c.subsidized;
    c.owns = false;
    c.mortgage = 0;
    transfer(state, c.id, TREASURY, Math.round(gain * monthRates(state).plusvalia), 'plusvalía');
  } else {
    sellOnDeparture(state, c);
  }
  if (heir) {
    transfer(state, c.id, heir.id, c.money);
    addMemory(state, heir, 'heredo', 3, 2, [c.id]);
    const kids = c.kids ?? [];
    if (kids.length && c.relations.some((r) => r.id === heir.id && r.kind === 'pareja')) heir.kids = [...(heir.kids ?? []), ...kids].slice(0, KIDS_MAX + 2);
  } else {
    // Sin nadie en el pueblo: lo hereda la familia de fuera.
    transfer(state, c.id, OUTSIDE, c.money);
  }
  // Duelo: quien lo quería lo recuerda.
  for (const o of state.citizens) {
    const r = o.relations.find((x) => x.id === c.id);
    if (!r) continue;
    if (r.kind === 'pareja' || r.kind === 'amistad') addMemory(state, o, 'perdio_a', r.kind === 'pareja' ? 5 : 3, r.kind === 'pareja' ? -7 : -4, [c.id]);
    o.relations = o.relations.filter((x) => x.id !== c.id);
  }
  state.pending = state.pending.filter((p) => p.citizenId !== c.id);
  state.citizens = state.citizens.filter((x) => x !== c);
  pushEvent(state, 'departure', `Fallece ${c.name} a los ${c.age} años${heir ? `. Hereda ${first(heir)}` : ''}`, heir ? { ref: heir.id } : {});
}

/** Una vez al año (1 de enero): cumpleaños, hijos que cumplen 18 y fallecimientos. */
export function lifeYear(state: GameState): void {
  for (const c of state.citizens) c.age++;
  // Hijos que se hacen mayores: se independizan en el pueblo si hay casa; si no, se van a estudiar fuera.
  for (const c of [...state.citizens]) {
    const kids = c.kids ?? [];
    const grown = kids.filter((t) => state.tick - t >= ADULT_AGE * YEAR_TICKS);
    if (!grown.length) continue;
    c.kids = kids.filter((t) => !grown.includes(t));
    for (let i = 0; i < grown.length; i++) {
      if (freeHomes(state) > 0) {
        const kid = newResident(state, { age: ADULT_AGE, surname: surname(c) });
        state.citizens.push(kid);
        transfer(state, c.id, kid.id, Math.min(c.money, 500));
        pushEvent(state, 'arrival', `${kid.name}, de la familia de ${first(c)}, se independiza y se queda en el pueblo`, { ref: kid.id });
      } else {
        pushEvent(state, 'info', `Un hijo de ${first(c)} cumple 18 y se va a estudiar fuera: no hay casa libre`, { ref: c.id });
      }
    }
  }
  // Fallecimientos (los líderes políticos no: la política tiene su propio ciclo).
  const protectedIds = new Set([state.politics.party?.leaderId, typeof state.politics.mayor === 'number' ? state.politics.mayor : undefined]);
  for (const c of [...state.citizens]) {
    if (state.citizens.length <= 2 || c.age < DEATH_START_AGE || protectedIds.has(c.id)) continue;
    const p = Math.min(DEATH_RATE_MAX, (c.age - DEATH_START_AGE + 2) * DEATH_RATE_PER_YEAR_OVER);
    if (chance(state.rng, p)) dies(state, c);
  }
}

/** Cada mes: nacimientos (parejas que viven juntas y, en general, adultos jóvenes). */
export function lifeMonth(state: GameState): void {
  for (const a of state.citizens) {
    if (!a.named) continue;
    for (const r of a.relations) {
      if (r.kind !== 'pareja' || r.id < a.id) continue; // cada pareja una vez
      const b = state.citizens.find((x) => x.id === r.id);
      if (!b || b.homeId === null || b.homeId !== a.homeId) continue;
      const young = Math.min(a.age, b.age);
      if (young < 20 || young > 42 || (a.kids ?? []).length >= KIDS_MAX) continue;
      if (!chance(state.rng, BIRTH_CHANCE_COUPLE)) continue;
      a.kids = [...(a.kids ?? []), state.tick];
      addMemory(state, a, 'nacio_hijo', 5, 5);
      addMemory(state, b, 'nacio_hijo', 5, 5);
      pushEvent(state, 'arrival', `¡Nace un bebé en casa de ${first(a)} y ${first(b)}!`, { ref: a.id });
    }
  }
  for (const c of state.citizens) {
    if (c.named || c.homeId === null || c.age < 20 || c.age > 42 || (c.kids ?? []).length >= KIDS_MAX) continue;
    if (chance(state.rng, BIRTH_CHANCE_ADULT)) c.kids = [...(c.kids ?? []), state.tick];
  }
}

/** Niños del pueblo (cuentan para el colegio y en el censo). */
export function kidsCount(state: GameState): number {
  return state.citizens.reduce((n, c) => n + (c.kids?.length ?? 0), 0);
}
