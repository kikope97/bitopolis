import { TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createInitialState,
  type GameState,
  ibiForecast,
  LOANS,
  loanCapacity,
  loanLoad,
  monthNet,
  OUTSIDE,
  ratingAfter,
  ratingOf,
  runSimulation,
  step,
  taxLevels,
  transfer,
  TREASURY,
} from '../src/index.ts';

/** Pueblo recién creado con `months` meses cerrados de `income` € y gastos `expenses`. */
function withBooks(income: number, expenses = income, months = 12): GameState {
  const s = createInitialState({ seed: 11 });
  for (let m = 1; m <= months; m++) s.stats.push({ month: m, population: 30, treasury: 0, happiness: 60, income, expenses, breakdown: {} } as GameState['stats'][number]);
  s.tick = months * TICKS_PER_MONTH;
  return s;
}

describe('el dinero dice lo mismo en todas partes (2.8)', () => {
  it('monthNet: lo propio, el gasto corriente, las obras, lo amortizado y el préstamo, por separado', () => {
    const m = { income: 210_000, expenses: 60_000, breakdown: { IBI: 8_000, PIE: 2_000, préstamo: 200_000, sueldos: -10_000, obras: -30_000, 'reparaciones (incendio)': -5_000, amortización: -10_000, préstamos: -5_000 } };
    expect(monthNet(m)).toEqual({ own: 10_000, running: 15_000, works: 35_000, repaid: 10_000, loansIn: 200_000, net: -5_000, total: -50_000 });
  });

  it('el aviso «la caja aguanta N meses» no cuenta las obras', () => {
    const s = createInitialState({ seed: 3 });
    s.treasury = 240_000;
    // Un mes con 100.000 € de obras y el gasto corriente cubierto: no hay aviso.
    s.tick = TICKS_PER_MONTH - 1;
    transfer(s, TREASURY, OUTSIDE, 100_000, 'obras');
    step(s);
    expect(s.events.some((e) => e.text.includes('caja aguanta'))).toBe(false);
  });

  it('pedir el máximo no deja la nota en C ni en D; ratingAfter lo dice antes', () => {
    for (const months of LOANS.terms) {
      const s = withBooks(20_000, 18_000);
      s.rating = 'A';
      s.treasury = 5_000;
      const cap = loanCapacity(s, months);
      expect(cap).toBeGreaterThan(0);
      const after = ratingAfter(s, cap, months);
      expect(['A', 'B']).toContain(after);
      expect(applyCommand(s, { type: 'RequestLoan', amount: cap, months }).ok).toBe(true);
      // Con el dinero gastado (fuera de la caja), la carga sigue por debajo del umbral de la C.
      transfer(s, TREASURY, OUTSIDE, cap, 'obras');
      expect(loanLoad(s, true)).toBeLessThan(LOANS.load.B);
      expect(ratingOf(s)).toBe(after);
    }
  });

  it('si la caja cubre lo que se debe, la nota no baja de B', () => {
    const s = withBooks(10_000, 9_000);
    s.loans.push({ id: 900, principal: 100_000, left: 100_000, quota: 5_000, rate: 0.007, monthsLeft: 24, kind: 'banco', tick: s.tick });
    s.treasury = 50_000;
    expect(ratingOf(s)).toBe('D');
    s.treasury = 100_000;
    expect(ratingOf(s)).toBe('B');
    s.bankrupt = true;
    expect(ratingOf(s)).toBe('D');
  });

  it('amortizar no rompe los meses de superávit de la A', () => {
    const s = withBooks(10_000, 5_000);
    s.month = { ...s.month, income: 10_000, expenses: 55_000, breakdown: { IBI: 10_000, sueldos: -5_000, amortización: -50_000 } };
    expect(ratingOf(s)).toBe('A');
  });

  it('ibiForecast cuadra con el IBI cobrado (±3 %), también con densidad, fincas y gran empresa', () => {
    const kinds = new Set<string>();
    for (const [profile, seed, days] of [['constructor', 4, 720], ['campo', 2, 540], ['casual', 7, 900]] as const) {
      const { state } = runSimulation({ seed, days, profile, checkEveryDay: false });
      // Hasta la última hora del mes: lo que se cobrará al cerrarlo.
      while ((state.tick + 1) % TICKS_PER_MONTH !== 0) step(state);
      const lv = taxLevels(state).ibi;
      // El nivel no cambió en el mes (se cobra con el nivel medio del mes).
      const forecast = ibiForecast(state, lv);
      step(state);
      const got = state.stats.at(-1)!.breakdown['IBI'] ?? 0;
      expect(got).toBeGreaterThan(0);
      expect(Math.abs(forecast - got) / got, `${profile} ${seed}: ${forecast} frente a ${got}`).toBeLessThanOrEqual(0.03);
      if (state.buildings.some((b) => b.dense)) kinds.add('densidad');
      if (state.buildings.some((b) => b.kind === 'farm')) kinds.add('fincas');
      if (state.bigCompany) kinds.add('gran empresa');
    }
    // Las simulaciones cubren lo que faltaba en la estimación de antes.
    expect([...kinds].sort()).toEqual(['densidad', 'fincas', 'gran empresa']);
  }, 300_000);
});
