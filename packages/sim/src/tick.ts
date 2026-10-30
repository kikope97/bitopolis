import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { applyCommand } from './commands.ts';
import { chance, nextInt, pick } from './prng.ts';
import { type BuildingKind, type Citizen, type GameState, pushEvent } from './state.ts';

export const SALARY = 1_200;
export const RENT = 300;
export const PIE_PER_CITIZEN = 25;
export const TAX_RATE = { low: 0.06, medium: 0.12, high: 0.2 } as const;
export const LIVING_COST = 450;
export const DEBT_LIMIT = 10_000;

export const JOBS: Record<BuildingKind, number> = { townhall: 3, house: 0, water: 2, power: 2 };
export const MAINTENANCE: Record<BuildingKind, number> = { townhall: 100, house: 30, water: 200, power: 250 };

const NAMES = [
  'Ana', 'Pablo', 'Carmen', 'Javier', 'Elena', 'Diego', 'Rosa', 'Marcos', 'Nuria', 'Iker',
  'Marta', 'Andrés', 'Lola', 'Sergio', 'Inés', 'Raúl', 'Pilar', 'Hugo', 'Sara', 'Tomás',
];

function homeless(state: GameState): Citizen[] {
  return state.citizens.filter((c) => c.homeId === null);
}

function freeHouses(state: GameState) {
  const taken = new Set(state.citizens.map((c) => c.homeId));
  return state.buildings.filter((b) => b.kind === 'house' && !taken.has(b.id));
}

function vacancies(state: GameState) {
  const used = new Map<number, number>();
  for (const c of state.citizens) if (c.jobId !== null) used.set(c.jobId, (used.get(c.jobId) ?? 0) + 1);
  return state.buildings.filter((b) => JOBS[b.kind] > (used.get(b.id) ?? 0));
}

function targetHappiness(state: GameState, c: Citizen): number {
  let t = 60;
  if (c.homeId === null) t -= 15;
  if (c.jobId === null) t -= 12;
  t += { low: 8, medium: 0, high: -14 }[state.taxLevel];
  if (state.buildings.some((b) => b.kind === 'water')) t += 6;
  if (state.buildings.some((b) => b.kind === 'power')) t += 6;
  return Math.max(0, Math.min(100, t));
}

function endOfDay(state: GameState): void {
  // Asignación de casas y empleos por reglas (rutina, nunca IA).
  for (const c of homeless(state)) {
    const h = freeHouses(state)[0];
    if (h) c.homeId = h.id;
  }
  for (const c of state.citizens) {
    if (c.jobId !== null) continue;
    const v = vacancies(state)[0];
    if (v) c.jobId = v.id;
  }
  // Felicidad con inercia.
  for (const c of state.citizens) {
    c.happiness += (targetHappiness(state, c) - c.happiness) * 0.08;
  }
  // Llegadas: solo si hay casa libre.
  const avg = averageHappiness(state);
  if (freeHouses(state).length > 0 && chance(state.rng, 0.25 * (avg / 100))) {
    const c: Citizen = {
      id: state.nextId++,
      name: pick(state.rng, NAMES),
      age: nextInt(state.rng, 19, 70),
      money: 0,
      homeId: null,
      jobId: null,
      happiness: 55,
    };
    state.citizens.push(c);
    transfer(state, OUTSIDE, c.id, nextInt(state.rng, 800, 3_000));
    pushEvent(state, 'arrival', `${c.name} se muda al pueblo`);
  }
  // Salidas: infelices o arruinados. El dinero se va con ellos.
  for (const c of [...state.citizens]) {
    if (state.citizens.length <= 1) break;
    const broke = c.money === 0 && c.jobId === null;
    if ((c.happiness < 25 && chance(state.rng, 0.05)) || (broke && chance(state.rng, 0.1))) {
      transfer(state, c.id, OUTSIDE, c.money);
      state.citizens = state.citizens.filter((x) => x !== c);
      pushEvent(state, 'departure', `${c.name} se va del pueblo`);
    }
  }
}

function endOfMonth(state: GameState): void {
  const rate = TAX_RATE[state.taxLevel];
  for (const c of state.citizens) {
    if (c.jobId !== null) {
      transfer(state, TREASURY, c.id, SALARY);
      transfer(state, c.id, TREASURY, Math.round(SALARY * rate));
    }
    if (c.homeId !== null) transfer(state, c.id, TREASURY, RENT);
    transfer(state, c.id, OUTSIDE, LIVING_COST);
  }
  transfer(state, OUTSIDE, TREASURY, PIE_PER_CITIZEN * state.citizens.length);
  for (const b of state.buildings) transfer(state, TREASURY, OUTSIDE, MAINTENANCE[b.kind]);

  if (state.treasury < -DEBT_LIMIT) state.debtMonths++;
  else state.debtMonths = 0;
  if (state.debtMonths >= 3 && !state.bankrupt) {
    state.bankrupt = true;
    pushEvent(state, 'bankrupt', 'El ayuntamiento está en quiebra');
  }
  state.stats.push({
    month: Math.floor(state.tick / TICKS_PER_MONTH),
    population: state.citizens.length,
    treasury: state.treasury,
    happiness: Math.round(averageHappiness(state)),
    income: state.month.income,
    expenses: state.month.expenses,
  });
  state.month = { income: 0, expenses: 0 };
}

export function averageHappiness(state: GameState): number {
  if (state.citizens.length === 0) return 0;
  return state.citizens.reduce((s, c) => s + c.happiness, 0) / state.citizens.length;
}

/** Avanza una hora de juego. */
export function step(state: GameState): void {
  state.tick++;
  if (state.tick % TICKS_PER_DAY === 0) endOfDay(state);
  if (state.tick % TICKS_PER_MONTH === 0) endOfMonth(state);
}

/** Aplica los comandos de este tick y avanza. */
export function stepWithCommands(state: GameState, commands: readonly unknown[]): void {
  for (const cmd of commands) applyCommand(state, cmd);
  step(state);
}
