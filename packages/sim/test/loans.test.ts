import { type Command, TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  averageIncome,
  checkInvariants,
  createInitialState,
  DEBT_LIMIT,
  type GameState,
  hashState,
  LOANS,
  loanCapacity,
  loanAdvice,
  loanInvariants,
  loanLoad,
  loansMonth,
  nextInt,
  OUTSIDE,
  PROFILES,
  profileRng,
  quota,
  ratingOf,
  ruleAdvice,
  replay,
  runSimulation,
  seedRng,
  step,
  tae,
  turnShared,
  transfer,
  TREASURY,
  validateCommand,
} from '../src/index.ts';

/** Pueblo recién creado con `months` meses cerrados de `income` € y gastos `expenses`. */
function withBooks(income: number, expenses = income, months = 12): GameState {
  const s = createInitialState({ seed: 11 });
  for (let m = 1; m <= months; m++) s.stats.push({ month: m, population: 30, treasury: 0, happiness: 60, income, expenses, breakdown: {} } as GameState['stats'][number]);
  s.tick = months * TICKS_PER_MONTH;
  return s;
}

/** Cierra el mes en curso con estos ingresos y gastos (sin mover dinero) y llama a `loansMonth`. */
function closeMonth(s: GameState, income: number, expenses: number) {
  s.tick += TICKS_PER_MONTH;
  s.month = { ...s.month, income, expenses, breakdown: {} };
  loansMonth(s);
  s.stats.push({ month: s.stats.length + 1, population: 30, treasury: s.treasury, happiness: 60, income: s.month.income, expenses: s.month.expenses, breakdown: s.month.breakdown } as GameState['stats'][number]);
  s.month = { ...s.month, income: 0, expenses: 0, breakdown: {} };
}

describe('préstamos municipales (2.2)', () => {
  it('cuota fija entera: devuelve justo lo prestado en el plazo, con intereses', () => {
    expect(quota(12_000, 0.007, 24)).toBe(Math.ceil((12_000 * 0.007) / (1 - 1 / 1.007 ** 24)));
    expect(quota(12_000, 0, 12)).toBe(1_000);
    expect(tae(LOANS.rate.B)).toBeCloseTo(8.7, 1);
    const s = withBooks(10_000);
    transfer(s, OUTSIDE, TREASURY, 20_000, 'subvencion');
    const before = s.treasury;
    expect(applyCommand(s, { type: 'RequestLoan', amount: 12_000, months: 24 }).ok).toBe(true);
    expect(s.treasury).toBe(before + 12_000);
    const q = s.loans[0]!.quota;
    expect(Number.isInteger(q)).toBe(true);
    let paid = 0;
    for (let m = 0; m < 24; m++) {
      const t = s.treasury;
      closeMonth(s, 10_000, 5_000);
      paid += t - s.treasury;
      expect(loanInvariants(s)).toEqual([]);
    }
    expect(s.loans).toEqual([]);
    expect(s.loanLedger.repaid).toBe(12_000);
    // Lo pagado = capital + intereses; la última cuota ajusta el redondeo.
    expect(paid).toBe(12_000 + s.loanLedger.interest);
    expect(Math.abs(paid - q * 24)).toBeLessThan(q);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('valida importe, plazo, nota, capacidad y número de préstamos', () => {
    const fresh = createInitialState({ seed: 1 });
    expect(validateCommand(fresh, { type: 'RequestLoan', amount: 5_000, months: 12 })).toMatchObject({ ok: false, error: expect.stringMatching(/un mes entero/) });
    const s = withBooks(5_000);
    expect(validateCommand(s, { type: 'RequestLoan', amount: 1_500, months: 12 }).ok).toBe(false);
    expect(validateCommand(s, { type: 'RequestLoan', amount: 5_000, months: 36 }).ok).toBe(false);
    expect(validateCommand(s, { type: 'RequestLoan', amount: 300_000, months: 12 }).ok).toBe(false);
    // Nota B: hasta 1,2 veces lo que ingresa en un año (5.000 × 12 × 1,2 = 72.000).
    expect(loanCapacity(s)).toBe(72_000);
    expect(validateCommand(s, { type: 'RequestLoan', amount: 73_000, months: 48 })).toMatchObject({ ok: false, error: expect.stringMatching(/hasta 72\.000 €/) });
    s.rating = 'A';
    expect(loanCapacity(s)).toBe(120_000);
    s.rating = 'C';
    expect(loanCapacity(s)).toBe(36_000);
    s.rating = 'D';
    expect(validateCommand(s, { type: 'RequestLoan', amount: 1_000, months: 12 })).toMatchObject({ ok: false, error: expect.stringMatching(/nota D/) });
    s.rating = 'A';
    for (let i = 0; i < LOANS.maxLoans; i++) expect(applyCommand(s, { type: 'RequestLoan', amount: 1_000, months: 12 }).ok).toBe(true);
    expect(validateCommand(s, { type: 'RequestLoan', amount: 1_000, months: 12 })).toMatchObject({ ok: false, error: expect.stringMatching(/Como mucho 4/) });
    // Lo que ya se debe cuenta para el tope.
    expect(loanCapacity(s)).toBe(120_000 - 4_000);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('caja en negativo a fin de mes: préstamo de tesorería a 12 meses, más caro, y la nota baja (dos en un año: D)', () => {
    const s = withBooks(8_000);
    s.rating = 'B';
    transfer(s, TREASURY, OUTSIDE, s.treasury + 2_400, 'obras');
    expect(s.treasury).toBe(-2_400);
    closeMonth(s, 8_000, 8_000);
    expect(s.treasury).toBe(600);
    const t = s.loans[0]!;
    expect(t).toMatchObject({ kind: 'tesoreria', principal: 3_000, left: 3_000, monthsLeft: LOANS.treasuryMonths });
    expect(t.rate).toBeCloseTo(LOANS.rate.B * LOANS.treasuryPenalty, 6);
    expect(s.rating).toBe('C');
    expect(s.events.some((e) => e.text.includes('préstamo de tesorería'))).toBe(true);
    // Otra vez en negativo: se refinancia en el mismo préstamo y la nota cae a D.
    transfer(s, TREASURY, OUTSIDE, s.treasury + 500, 'obras');
    closeMonth(s, 8_000, 8_000);
    expect(s.loans.filter((l) => l.kind === 'tesoreria')).toHaveLength(1);
    expect(s.rating).toBe('D');
    // Con D ya no hay tesorería: la caja se queda en negativo.
    transfer(s, TREASURY, OUTSIDE, s.treasury + 1_000, 'obras');
    closeMonth(s, 8_000, 8_000);
    expect(s.treasury).toBeLessThan(0);
    expect(loanInvariants(s)).toEqual([]);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('nota por la carga: A (poca y 6 meses de superávit), B, C y D', () => {
    const s = withBooks(10_000, 8_000);
    s.month = { ...s.month, income: 5_000, expenses: 8_000 };
    expect(ratingOf(s)).toBe('B'); // el mes en curso no tiene superávit
    s.month = { ...s.month, income: 10_000, expenses: 8_000 };
    expect(ratingOf(s)).toBe('A');
    const loan = (q: number) => ({ id: 999, principal: 50_000, left: 50_000, quota: q, rate: 0.007, monthsLeft: 24, kind: 'banco' as const, tick: 0 });
    s.loans = [loan(1_500)];
    expect(ratingOf(s)).toBe('B');
    s.loans = [loan(2_500)];
    expect(ratingOf(s)).toBe('C');
    s.loans = [loan(3_600)];
    expect(ratingOf(s)).toBe('D');
    expect(loanLoad(s, true)).toBeCloseTo(0.36, 5);
    // Lo prestado no cuenta como ingreso.
    s.loans = [];
    s.stats.push({ month: 13, income: 60_000, expenses: 8_000, breakdown: { préstamo: 50_000 } } as unknown as GameState['stats'][number]);
    expect(averageIncome(s)).toBe(10_000);
  });

  it('quiebra: nota D y caja por debajo del límite tres meses seguidos (sin D no hay quiebra)', () => {
    const s = runSimulation({ seed: 4, days: 120, profile: 'casual' }).state;
    // Dos tesorerías recientes: D, y ya nadie cubre el hueco.
    s.loanLedger.treasuryTicks = [s.tick - 10, s.tick - 5];
    s.rating = 'D';
    transfer(s, TREASURY, OUTSIDE, s.treasury + DEBT_LIMIT * 3, 'obras');
    for (let m = 0; m < 3 && !s.bankrupt; m++) {
      do step(s);
      while (s.tick % TICKS_PER_MONTH !== 0);
    }
    expect(s.rating).toBe('D');
    expect(s.bankrupt).toBe(true);
    expect(s.events.some((e) => e.kind === 'bankrupt')).toBe(true);
    expect(validateCommand(s, { type: 'RequestLoan', amount: 1_000, months: 12 }).ok).toBe(false);
    expect(checkInvariants(s)).toEqual([]);
    // Con nota C, la misma caja se cubre con un préstamo de tesorería y no quiebra.
    const c = runSimulation({ seed: 4, days: 120, profile: 'casual' }).state;
    transfer(c, TREASURY, OUTSIDE, c.treasury + DEBT_LIMIT * 3, 'obras');
    do step(c);
    while (c.tick % TICKS_PER_MONTH !== 0);
    expect(c.treasury).toBeGreaterThanOrEqual(0);
    expect(c.loans.some((l) => l.kind === 'tesoreria')).toBe(true);
    expect(c.bankrupt).toBe(false);
  });

  it('amortizar: capital más comisión; la cuota baja y, si se paga todo, desaparece', () => {
    const s = withBooks(10_000);
    s.treasury = 40_000;
    applyCommand(s, { type: 'RequestLoan', amount: 20_000, months: 48 });
    const loan = s.loans[0]!;
    const q = loan.quota;
    const caja = s.treasury;
    expect(applyCommand(s, { type: 'RepayLoan', loanId: loan.id, amount: 10_000 }).ok).toBe(true);
    expect(s.treasury).toBe(caja - 10_000 - 100);
    expect(loan.left).toBe(10_000);
    expect(loan.quota).toBeLessThan(q);
    expect(validateCommand(s, { type: 'RepayLoan', loanId: 12345, amount: 10 }).ok).toBe(false);
    // Sin caja para el capital y la comisión, no se puede.
    s.treasury = 5_000;
    expect(validateCommand(s, { type: 'RepayLoan', loanId: loan.id, amount: 10_000 })).toMatchObject({ ok: false, error: expect.stringMatching(/No hay dinero/) });
    // Más de lo que queda: solo se paga lo que queda.
    s.treasury = 20_000;
    expect(applyCommand(s, { type: 'RepayLoan', loanId: loan.id, amount: 1_000_000 }).ok).toBe(true);
    expect(s.treasury).toBe(20_000 - 10_000 - 100);
    expect(s.loans).toEqual([]);
    expect(s.loanLedger.repaid).toBe(20_000);
    expect(validateCommand(s, { type: 'RepayLoan', loanId: loan.id, amount: 1 }).ok).toBe(false);
  });

  it('en la oposición no se pide prestado', () => {
    const s = withBooks(5_000);
    s.politics.mayor = 999_999;
    expect(validateCommand(s, { type: 'RequestLoan', amount: 1_000, months: 12 })).toMatchObject({ ok: false, error: expect.stringMatching(/oposición/) });
  });

  it('el perfil endeudado se endeuda y las invariantes aguantan cada día; la partida se reproduce igual', () => {
    const { state, report } = runSimulation({ seed: 6, days: 900, profile: 'endeudado', checkEveryDay: true });
    expect(report.invariantErrors).toEqual([]);
    expect(report.loans.requested).toBeGreaterThan(0);
    expect(report.loans.worst).not.toBe('A');
    expect(hashState(replay(6, report.commands, state.tick))).toBe(report.stateHash);
  }, 240_000);

  it('fuzz de 2.000 días: préstamos y amortizaciones al azar sobre el constructor, invariantes cada día', () => {
    const s = createInitialState({ seed: 21 });
    const prng = profileRng(21);
    const fuzz = seedRng(77);
    let ok = 0;
    for (let day = 0; day < 2_000; day++) {
      for (const cmd of PROFILES['constructor' as string]!.decide(s, prng)) applyCommand(s, cmd);
      const r = nextInt(fuzz, 0, 9);
      let cmd: Command | null = null;
      if (r === 0) cmd = { type: 'RequestLoan', amount: nextInt(fuzz, 1, 8) * 1_000, months: ([12, 24, 48] as const)[nextInt(fuzz, 0, 2)]! };
      else if (r === 1 && s.loans.length) cmd = { type: 'RepayLoan', loanId: s.loans[nextInt(fuzz, 0, s.loans.length - 1)]!.id, amount: nextInt(fuzz, 1, 3_000) };
      else if (r === 2) transfer(s, TREASURY, OUTSIDE, nextInt(fuzz, 0, 3_000), 'obras');
      if (cmd && applyCommand(s, cmd).ok) ok++;
      for (let h = 0; h < 24; h++) step(s);
      const errors = checkInvariants(s);
      if (errors.length) throw new Error(`día ${day}: ${errors.join('; ')}`);
    }
    expect(ok).toBeGreaterThan(10);
    expect(s.loans.length).toBeLessThanOrEqual(LOANS.maxLoans + 1);
  }, 240_000);

  it('el consejero avisa de la nota D, de la carga y de la tesorería; la IA solo ve la nota y una banda', () => {
    const s = withBooks(10_000);
    expect(loanAdvice(s)).toEqual([]);
    s.loans = [{ id: 900, principal: 3_000, left: 3_000, quota: 300, rate: 0.0105, monthsLeft: 12, kind: 'tesoreria', tick: s.tick }];
    s.loanLedger.lent = 3_000;
    expect(loanAdvice(s)[0]).toMatch(/tesorería/);
    s.loans[0]!.quota = 3_000;
    expect(loanAdvice(s)[0]).toMatch(/se comen el 30 %/);
    s.rating = 'D';
    expect(loanAdvice(s)[0]).toMatch(/nota D/);
    expect(ruleAdvice(s, 'que_cambiarias').join(' ')).toMatch(/nota D/);
    expect(ruleAdvice(s, 'como_va').join(' ')).toMatch(/préstamos se llevan 3\.000 € al mes/);
    const ai = runSimulation({ seed: 3, days: 20, profile: 'casual', aiMode: true }).state;
    ai.ai!.turn = { n: 1, kind: 'semana', opened: ai.tick, due: ai.tick + 10, ids: [] } as never;
    const line = turnShared(ai).match(/"cuentas":"([^"]*)"/)![1]!;
    expect(line).toBe('nota B (A la mejor, D sin crédito), carga de los préstamos sin deuda');
  });
});
