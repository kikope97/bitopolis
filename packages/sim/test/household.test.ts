import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  addDebt,
  applyCommand,
  charge,
  checkInvariants,
  CRIME,
  crimeDay,
  DEBT,
  type GameState,
  migrate,
  MIN_WAGE,
  OUTSIDE,
  pocketOf,
  runSimulation,
  step,
  totalDebt,
  transfer,
  TREASURY,
  tryArrest,
  validateCommand,
} from '../src/index.ts';

function town(): GameState {
  return runSimulation({ seed: 3, days: 500, profile: 'constructor', checkEveryDay: false }).state;
}

describe('economía de cada vecino (v1.9)', () => {
  it('lo que no puede pagar queda como deuda con quien cobra, y la deuda se conserva', () => {
    const s = town();
    const c = s.citizens[0]!;
    transfer(s, c.id, OUTSIDE, c.money);
    const paid = charge(s, c, TREASURY, 120, 'tasas');
    expect(paid).toBe(0);
    expect(c.debt!.town).toBe(120);
    expect(totalDebt(c)).toBe(120);
    expect(pocketOf(c)).toBe('endeudado');
    expect(checkInvariants(s)).toEqual([]);
  });

  it('las deudas se devuelven poco a poco; el ayuntamiento cobra un recargo único y el banco interés', () => {
    const s = town();
    const c = s.citizens.find((x) => x.jobId !== null)!;
    addDebt(s, c, 'town', 1_000);
    addDebt(s, c, 'bank', 1_000);
    const before = totalDebt(c);
    for (let i = 0; i < TICKS_PER_MONTH * 3; i++) step(s);
    const after = c.debt ? totalDebt(c) : 0;
    expect(after).toBeLessThan(before);
    expect(s.debtLedger.created).toBeGreaterThan(2_000); // intereses y recargo
    expect(checkInvariants(s)).toEqual([]);
  });

  it('el alcalde aplaza o perdona la deuda con el ayuntamiento', () => {
    const s = town();
    const c = s.citizens[1]!;
    addDebt(s, c, 'town', 600);
    expect(applyCommand(s, { type: 'SettleDebt', citizenId: c.id, mode: 'aplazar' }).ok).toBe(true);
    expect(c.debt!.plan!.perMonth).toBe(Math.ceil(600 / DEBT.planMonths));
    expect(validateCommand(s, { type: 'SettleDebt', citizenId: c.id, mode: 'aplazar' }).ok).toBe(false);
    expect(applyCommand(s, { type: 'SettleDebt', citizenId: c.id, mode: 'perdonar' }).ok).toBe(true);
    expect(c.debt?.town ?? 0).toBe(0);
    expect(s.debtLedger.forgiven).toBe(600);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('microcrédito: el ayuntamiento presta, salda primero lo del banco y se devuelve en cuotas', () => {
    const s = town();
    s.townhallLevel = 2;
    const c = s.citizens[2]!;
    transfer(s, c.id, OUTSIDE, c.money);
    addDebt(s, c, 'bank', 400);
    transfer(s, OUTSIDE, TREASURY, 20_000, 'subvencion');
    const caja = s.treasury;
    expect(applyCommand(s, { type: 'GrantMicrocredit', citizenId: c.id }).ok).toBe(true);
    expect(s.treasury).toBe(caja - 1_500);
    expect(c.debt!.bank).toBe(0);
    expect(c.debt!.town).toBeGreaterThanOrEqual(1_500);
    expect(c.debt!.plan).toBeTruthy();
    expect(checkInvariants(s)).toEqual([]);
  });

  it('sueldo mínimo: quien trabaja en una empresa cobra más; el empresario lo nota', () => {
    const s = town();
    const shop = s.buildings.find((b) => b.kind === 'shop' && b.built && s.citizens.some((c) => c.jobId === b.id))!;
    expect(shop).toBeTruthy();
    expect(applyCommand(s, { type: 'SetMinimumWage', level: 'high' }).ok).toBe(true);
    expect(s.minWage).toBe('high');
    transfer(s, OUTSIDE, shop.id, 50_000);
    const worker = s.citizens.find((c) => c.jobId === shop.id)!;
    const to = TICKS_PER_MONTH - (s.tick % TICKS_PER_MONTH);
    for (let i = 0; i < to; i++) step(s);
    expect(shop.books!.wages).toBeGreaterThanOrEqual(MIN_WAGE.high);
    expect(worker.last!.in).toBeGreaterThanOrEqual(MIN_WAGE.high);
    expect(s.stats.at(-1)!.wage).toBe(MIN_WAGE.high);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('un vecino del pueblo que roba y es detenido: antecedentes, pierde el empleo y la multa se vuelve deuda', () => {
    const s = town();
    const police = s.buildings.find((b) => b.kind === 'police' && b.built)!;
    const thief = s.citizens.find((c) => !c.named)!;
    thief.jobId = police.id;
    transfer(s, thief.id, OUTSIDE, thief.money);
    s.justice.cells = [];
    expect(tryArrest(s, police.x, police.y, 1, [thief], 'theft')).toBe(1);
    expect(thief.record).toBe(1);
    expect(thief.jobId).toBeNull();
    const before = thief.debt?.town ?? 0;
    s.tick += TICKS_PER_DAY;
    crimeDay(s);
    expect(thief.debt!.town - before).toBe(CRIME.finePerDay);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('en años de juego: pocos endeudados, deuda que no se dispara y el dinero y la deuda se conservan', () => {
    for (const profile of ['casual', 'constructor'] as const) {
      const { state, report } = runSimulation({ seed: 2, days: 1440, profile, checkEveryDay: false });
      expect(report.invariantErrors).toEqual([]);
      expect(checkInvariants(state)).toEqual([]);
      const debtors = state.citizens.filter((c) => totalDebt(c) > 0).length;
      expect(debtors / Math.max(1, state.citizens.length)).toBeLessThan(0.25);
      for (const c of state.citizens) expect(totalDebt(c)).toBeLessThan(20_000);
    }
  }, 120_000);

  it('migración 11→12: sueldo mínimo, contabilidad de la deuda y cárcel con presos identificados', () => {
    const { state } = runSimulation({ seed: 4, days: 200, profile: 'casual', checkEveryDay: false });
    const old = { ...structuredClone(state), formatVersion: 11 } as Record<string, unknown>;
    delete old.minWage;
    delete old.debtLedger;
    (old.justice as { jail: unknown[] }).jail = [123];
    const m = migrate(old);
    expect(m.minWage).toBe('none');
    expect(m.debtLedger.created).toBe(0);
    expect(m.justice.jail[0]).toEqual({ until: 123 });
  });
});
