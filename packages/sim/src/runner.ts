import { type Command, DAYS_PER_YEAR, TICKS_PER_DAY, TICKS_PER_MONTH, type TimedCommand } from '@bitopolis/shared';
import { applyCommand } from './commands.ts';
import { hashState } from './hash.ts';
import { checkInvariants, moneyDrift } from './invariants.ts';
import { PROFILES, profileRng } from './profiles.ts';
import { createInitialState, type GameState } from './state.ts';
import { averageHappiness, step } from './tick.ts';

export interface RunOptions {
  seed: number;
  days: number;
  profile: string;
  /** Comprobar invariantes cada día (más lento). */
  checkEveryDay?: boolean;
  /** 2.0: partida en Modo IA con este % de vecinos con IA. */
  aiMode?: boolean;
  aiShare?: number;
  /** 2.0: responde a un turno abierto (IA simulada o grabada); null = no responde (deciden las reglas). */
  onTurn?: (state: GameState) => Command | null;
}

export interface SimReport {
  seed: number;
  days: number;
  profile: string;
  final: { population: number; happiness: number; treasury: number; bankrupt: boolean };
  populationAt1Year: number | null;
  bankruptDay: number | null;
  moneyDrift: number;
  invariantErrors: string[];
  stateHash: string;
  events: Record<string, number>;
  commands: TimedCommand[];
  monthly: GameState['stats'];
  /**
   * 2.2: ventas de las empresas por año (tiendas, talleres y fincas), lo que entra
   * de fuera al pueblo (`income`: ventas fuera, sueldos de fuera, PIE, subvenciones…)
   * y la parte del campo: sobre las ventas (`farmShare`) y sobre lo que entra (`farmShareIn`).
   */
  sales: { year: number; shop: number; factory: number; farm: number; farms: number; income: number; farmShare: number; farmShareIn: number }[];
}

export function runSimulation(opts: RunOptions): { state: GameState; report: SimReport } {
  const profile = PROFILES[opts.profile];
  if (!profile) throw new Error(`perfil desconocido: ${opts.profile}`);
  const state = createInitialState({ seed: opts.seed, aiMode: opts.aiMode, aiShare: opts.aiShare });
  const prng = profileRng(opts.seed);
  const commands: TimedCommand[] = [];
  const invariantErrors: string[] = [];
  let bankruptDay: number | null = null;
  let populationAt1Year: number | null = null;
  const eventCounts: Record<string, number> = {};
  const sales: SimReport['sales'] = [];
  let lastIn = state.ledger.externalIn;

  for (let day = 0; day < opts.days; day++) {
    for (const cmd of profile.decide(state, prng)) {
      if (applyCommand(state, cmd).ok) commands.push({ tick: state.tick, cmd });
    }
    for (let h = 0; h < TICKS_PER_DAY; h++) {
      step(state);
      // 2.0: el turno se responde en cuanto se abre (como haría la IA a tiempo).
      if (opts.onTurn && state.ai?.turn && state.ai.turn.opened === state.tick) {
        const cmd = opts.onTurn(state);
        if (cmd && applyCommand(state, cmd).ok) commands.push({ tick: state.tick, cmd });
      }
    }
    if (state.bankrupt && bankruptDay === null) bankruptDay = day + 1;
    // 2.2: al cerrar cada mes, las ventas del mes de cada tipo de empresa (b.books).
    if (state.tick % TICKS_PER_MONTH === 0) {
      const year = Math.ceil(state.tick / TICKS_PER_MONTH / 12);
      let row = sales.find((r) => r.year === year);
      if (!row) sales.push((row = { year, shop: 0, factory: 0, farm: 0, farms: 0, income: 0, farmShare: 0, farmShareIn: 0 }));
      row.income += state.ledger.externalIn - lastIn;
      lastIn = state.ledger.externalIn;
      for (const b of state.buildings) {
        if ((b.kind === 'shop' || b.kind === 'factory' || b.kind === 'farm') && b.books) row[b.kind] += b.books.sales;
      }
      row.farms = state.buildings.filter((b) => b.kind === 'farm').length;
      const total = row.shop + row.factory + row.farm;
      row.farmShare = total ? Math.round((row.farm / total) * 1000) / 10 : 0;
      row.farmShareIn = row.income ? Math.round((row.farm / row.income) * 1000) / 10 : 0;
    }
    if (day + 1 === DAYS_PER_YEAR) populationAt1Year = state.citizens.length;
    if (opts.checkEveryDay) {
      for (const e of checkInvariants(state)) invariantErrors.push(`día ${day + 1}: ${e}`);
    }
    // Contar eventos nuevos (events es un búfer circular).
    const lastTick = state.tick;
    for (const e of state.events) {
      if (e.tick > lastTick - TICKS_PER_DAY && e.tick <= lastTick) eventCounts[e.kind] = (eventCounts[e.kind] ?? 0) + 1;
    }
  }
  invariantErrors.push(...checkInvariants(state));

  return {
    state,
    report: {
      seed: opts.seed,
      days: opts.days,
      profile: opts.profile,
      final: {
        population: state.citizens.length,
        happiness: Math.round(averageHappiness(state)),
        treasury: state.treasury,
        bankrupt: state.bankrupt,
      },
      populationAt1Year,
      bankruptDay,
      moneyDrift: moneyDrift(state),
      invariantErrors,
      stateHash: hashState(state),
      events: eventCounts,
      commands,
      monthly: state.stats,
      sales,
    },
  };
}

/** Reproduce una partida a partir de semilla + comandos. */
export function replay(seed: number, commands: readonly TimedCommand[], untilTick: number): GameState {
  const state = createInitialState({ seed });
  let i = 0;
  while (state.tick < untilTick) {
    while (i < commands.length && commands[i]!.tick === state.tick) applyCommand(state, commands[i++]!.cmd);
    step(state);
  }
  return state;
}
