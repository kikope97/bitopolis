import { TICKS_PER_MONTH } from '@bitopolis/shared';
import { TURN } from './balance.ts';
import { hash32 } from './hash.ts';
import { FIRST_NAMES, SURNAMES } from './names.ts';
import { pick } from './prng.ts';
import { goalFor, PROFESSIONS } from './social-core.ts';
import { type Citizen, DESIRES, FEARS, type GameState, NO_PROPERTY, randomTraits } from './state.ts';

/**
 * Vecinos nuevos (antes en tick.ts). 2.3: aparte y con pocas dependencias, para
 * poder crearlos también desde `createInitialState` (escenarios) sin el ciclo de
 * carga state → tick → commands → state.
 */

function uniqueName(state: GameState): string {
  const used = new Set(state.citizens.map((c) => c.name));
  for (let i = 0; i < 20; i++) {
    const n = `${pick(state.rng, FIRST_NAMES)} ${pick(state.rng, SURNAMES)}`;
    if (!used.has(n)) return n;
  }
  return `${pick(state.rng, FIRST_NAMES)} ${pick(state.rng, SURNAMES)} ${state.nextId}`;
}

/** Misma regla que `aiByShare` (turns.ts; lo comprueba un test): ¿piensa con IA el vecino `id`? */
export function byShare(state: GameState, id: number): boolean {
  return hash32(state.seed, id, 77) % 100 < (state.ai?.share ?? 0);
}

/** Vecino nuevo (llega de fuera o se independiza de su familia, v1.5). No lo añade al pueblo. */
export function newResident(state: GameState, opts: { age: number; surname?: string }): Citizen {
  // 2.0: en Modo IA, el % de vecinos con IA decide quién tiene nombre (y piensa con IA).
  const namedCount = state.citizens.filter((x) => x.named).length;
  const named = state.aiMode && state.ai ? namedCount < TURN.maxNamed && byShare(state, state.nextId) : namedCount < state.namedLimit;
  let name = uniqueName(state);
  // Con el apellido de la familia, que no se repita el nombre completo (ronda 11).
  if (opts.surname) {
    const used = new Set(state.citizens.map((x) => x.name));
    for (let i = 0; i < 20 && (i === 0 || used.has(name)); i++) name = `${uniqueName(state).split(' ')[0]} ${opts.surname}`;
    if (used.has(name)) name = `${name} ${state.nextId}`;
  }
  const c: Citizen = {
    id: state.nextId++,
    name,
    age: opts.age,
    money: 0,
    homeId: null,
    jobId: null,
    happiness: 55,
    arrivedMonth: Math.floor(state.tick / TICKS_PER_MONTH),
    named,
    traits: named ? randomTraits(state.rng) : { terco: 50, ahorro: 50, social: 50, ambicion: 50 },
    desire: named ? pick(state.rng, DESIRES) : 'prosperar',
    fear: named ? pick(state.rng, FEARS) : 'paro',
    cooldownUntil: 0,
    ...NO_PROPERTY,
    profession: named ? pick(state.rng, PROFESSIONS) : '',
    goal: 'ahorrar',
    relations: [],
    memories: [],
    summary: '',
  };
  if (named) {
    c.goal = goalFor(c.desire);
    c.memories.push({ tick: state.tick, kind: 'llego', about: [], importance: 2, valence: 1 });
  }
  return c;
}
