import { type Command, DAYS_PER_YEAR, TICKS_PER_DAY, type TimedCommand } from '@bitopolis/shared';
import { applyCommand } from './commands.ts';
import { hashState } from './hash.ts';
import { checkInvariants, moneyDrift } from './invariants.ts';
import { PROFILES, profileRng } from './profiles.ts';
import { loanLoad, RATINGS, totalOwed } from './loans.ts';
import { createInitialState, type GameState, type Rating } from './state.ts';
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
  /** 2.2: préstamos municipales. */
  loans: LoanMetrics;
}

export interface LoanMetrics {
  rating: Rating;
  /** La peor nota y meses en cada una. */
  worst: Rating;
  months: Record<Rating, number>;
  /** Carga máxima de un mes (cuotas ÷ ingresos medios), en %. */
  maxLoadPct: number;
  /** Préstamos pedidos (y lo pedido) y de tesorería. */
  requested: number;
  requestedAmount: number;
  treasury: number;
  /** Lo que se debe al final y los intereses y comisiones pagados. */
  owed: number;
  interest: number;
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
  const loans: LoanMetrics = { rating: state.rating, worst: state.rating, months: { A: 0, B: 0, C: 0, D: 0 }, maxLoadPct: 0, requested: 0, requestedAmount: 0, treasury: 0, owed: 0, interest: 0 };
  let statsSeen = 0;
  let treasurySeen = -1;

  for (let day = 0; day < opts.days; day++) {
    for (const cmd of profile.decide(state, prng)) {
      if (applyCommand(state, cmd).ok) {
        commands.push({ tick: state.tick, cmd });
        if (cmd.type === 'RequestLoan') {
          loans.requested++;
          loans.requestedAmount += cmd.amount;
        }
      }
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
    // 2.2: al cerrar cada mes, la nota y la carga.
    for (const t of state.loanLedger.treasuryTicks) {
      if (t > treasurySeen) {
        loans.treasury++;
        treasurySeen = t;
      }
    }
    const closed = state.stats.at(-1)?.month ?? 0;
    if (closed !== statsSeen) {
      statsSeen = closed;
      loans.months[state.rating]++;
      if (RATINGS.indexOf(state.rating) > RATINGS.indexOf(loans.worst)) loans.worst = state.rating;
      const load = loanLoad(state);
      if (Number.isFinite(load)) loans.maxLoadPct = Math.max(loans.maxLoadPct, Math.round(load * 100));
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
  loans.rating = state.rating;
  loans.owed = totalOwed(state);
  loans.interest = state.loanLedger.interest;

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
      loans,
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
