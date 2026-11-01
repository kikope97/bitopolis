import { type Command, DAYS_PER_YEAR, type ScenarioId, type TerrainShape, TICKS_PER_DAY, TICKS_PER_MONTH, type TimedCommand } from '@bitopolis/shared';
import { applyCommand } from './commands.ts';
import { hashState } from './hash.ts';
import { checkInvariants, moneyDrift } from './invariants.ts';
import { PROFILES, profileRng } from './profiles.ts';
import { loanLoad, RATINGS, totalOwed } from './loans.ts';
import { createInitialState, type GameState, type Rating } from './state.ts';
import { averageHappiness, step } from './tick.ts';
import { ruralHomes, ruralShare } from './tourism.ts';
import { hasRiver, riverExit } from './waterworks.ts';

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
  /** 2.3: escenario y forma del terreno (por defecto, Libre y aleatorio: lo de siempre). */
  scenario?: ScenarioId;
  terrain?: TerrainShape;
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
  /** 2.2: préstamos municipales. */
  loans: LoanMetrics;
  /** 2.3: escenario (y si se ganó, y en qué mes). */
  scenario: { id: ScenarioId; terrain: TerrainShape; done: boolean; won: boolean; month: number | null };
  /** 2.3: turismo por año: visitantes, lo que dejaron (tasa y casas rurales) y casas rurales (% de las viviendas, máximo del año). */
  tourism: { year: number; visitors: number; tax: number; rural: number; houses: number; ruralPct: number }[];
  /** 2.4: el río a la salida por año (media y máximo de los cierres de mes), con o sin depuradora, y multas de la Confederación. */
  river: { hasRiver: boolean; years: { year: number; exitAvg: number; exitMax: number; sewage: number; renewables: number; fines: number }[] };
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
  const state = createInitialState({ seed: opts.seed, aiMode: opts.aiMode, aiShare: opts.aiShare, scenario: opts.scenario, terrain: opts.terrain });
  let scenarioMonth: number | null = null;
  const prng = profileRng(opts.seed);
  const commands: TimedCommand[] = [];
  const invariantErrors: string[] = [];
  let bankruptDay: number | null = null;
  let populationAt1Year: number | null = null;
  const eventCounts: Record<string, number> = {};
  const sales: SimReport['sales'] = [];
  const tourism: SimReport['tourism'] = [];
  const river: SimReport['river'] = { hasRiver: hasRiver(state), years: [] };
  let lastIn = state.ledger.externalIn;
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
      // 2.3: turismo del mes que acaba de cerrar.
      let t = tourism.find((r) => r.year === year);
      if (!t) tourism.push((t = { year, visitors: 0, tax: 0, rural: 0, houses: 0, ruralPct: 0 }));
      t.visitors += state.tourism.visitors;
      t.tax += state.tourism.lastTax ?? 0;
      t.rural += state.tourism.lastRural ?? 0;
      t.houses = Math.max(t.houses, ruralHomes(state).length);
      t.ruralPct = Math.max(t.ruralPct, Math.round(ruralShare(state) * 1000) / 10);
      // 2.4: el río a la salida.
      let rv = river.years.find((r) => r.year === year);
      if (!rv) river.years.push((rv = { year, exitAvg: 0, exitMax: 0, sewage: 0, renewables: 0, fines: 0 }));
      const exit = riverExit(state);
      const m = ((state.tick / TICKS_PER_MONTH - 1) % 12) + 1;
      rv.exitAvg = Math.round((rv.exitAvg * (m - 1) + exit) / m);
      rv.exitMax = Math.max(rv.exitMax, exit);
      rv.sewage = state.buildings.filter((b) => b.kind === 'sewage' && b.built).length;
      rv.renewables = state.buildings.filter((b) => (b.kind === 'solar' || b.kind === 'wind') && b.built).length;
      rv.fines += -(state.stats.at(-1)?.breakdown['multa del río'] ?? 0);
    }
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
    if (scenarioMonth === null && state.scenario.won) scenarioMonth = Math.round(state.tick / TICKS_PER_MONTH);
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
      sales,
      loans,
      scenario: { id: state.scenario.id, terrain: opts.terrain ?? 'aleatorio', done: state.scenario.done, won: !!state.scenario.won, month: scenarioMonth },
      tourism,
      river,
    },
  };
}

/** Reproduce una partida a partir de semilla + comandos. */
export function replay(seed: number, commands: readonly TimedCommand[], untilTick: number, start: { scenario?: ScenarioId; terrain?: TerrainShape } = {}): GameState {
  const state = createInitialState({ seed, ...start });
  let i = 0;
  while (state.tick < untilTick) {
    while (i < commands.length && commands[i]!.tick === state.tick) applyCommand(state, commands[i++]!.cmd);
    step(state);
  }
  return state;
}
