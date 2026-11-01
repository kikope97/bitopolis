import { describe, expect, it } from 'vitest';
import { TICKS_PER_MONTH } from '@bitopolis/shared';
import { checkInvariants, createInitialState, FORMAT_VERSION, hashState, MIGRATIONS, migrate, migrate14Trash, migrate15Loans, migrate16History, migrate16Landmarks, migrate16Medals, migrate16Region, migrate16Scenario, migrate16Tourism, OUTSIDE, REGION, step, transfer, TREASURY } from '../src/index.ts';

describe('migración 13 → 14 (2.1)', () => {
  it('basura: campo de suciedad vacío y 60 días de gracia (migrate14Trash)', () => {
    const s = createInitialState({ seed: 4 }) as unknown as Record<string, any>;
    const v13: Record<string, any> = { ...s, formatVersion: 13, tick: 1_000, fields: { ...s.fields } };
    delete v13.trash;
    delete v13.fields.dirt;
    const m = migrate(v13);
    expect(m.formatVersion).toBe(FORMAT_VERSION);
    expect(m.trash).toEqual({ start: -1, graceUntil: 1_000 + 60 * 24 });
    expect(m.fields.dirt).toEqual(new Array(m.map.w * m.map.h).fill(0));
    // Lo que ya tenía no se toca.
    expect(migrate14Trash({ trash: { start: 7 }, map: { w: 1, h: 1 }, fields: { dirt: [3] } })).toMatchObject({ trash: { start: 7 }, fields: { dirt: [3] } });
  });
});

describe('migración 14 → 15 (2.2, préstamos)', () => {
  it('sin préstamos y nota B; una caja negativa heredada pasa a préstamo de tesorería al cerrar el mes (migrate15Loans)', () => {
    const s = createInitialState({ seed: 4 }) as unknown as Record<string, any>;
    const v14: Record<string, any> = structuredClone({ ...s, formatVersion: 14 });
    delete v14.loans;
    delete v14.rating;
    delete v14.loanLedger;
    const m = migrate(v14);
    expect(m.formatVersion).toBe(FORMAT_VERSION);
    expect(m.loans).toEqual([]);
    expect(m.rating).toBe('B');
    expect(m.loanLedger).toEqual({ lent: 0, repaid: 0, interest: 0, treasuryTicks: [] });
    expect(checkInvariants(m)).toEqual([]);
    // Caja negativa de antes (con el descubierto viejo): al siguiente fin de mes, préstamo de tesorería.
    transfer(m, TREASURY, OUTSIDE, m.treasury + 1_500, 'obras');
    while (m.tick < TICKS_PER_MONTH) step(m);
    expect(m.loans.filter((l) => l.kind === 'tesoreria')).toHaveLength(1);
    expect(m.treasury).toBeGreaterThanOrEqual(0);
    expect(checkInvariants(m)).toEqual([]);
    // Lo que ya tenía no se toca.
    expect(migrate15Loans({ loans: [{ id: 1 }], rating: 'C', loanLedger: { lent: 5 } })).toMatchObject({ loans: [{ id: 1 }], rating: 'C', loanLedger: { lent: 5 } });
  });
});

describe('migración 15 → 16 (2.3, metas grandes)', () => {
  const v15 = (tick: number) => {
    const s = createInitialState({ seed: 4 }) as unknown as Record<string, any>;
    const old: Record<string, any> = structuredClone({ ...s, formatVersion: 15, tick });
    for (const k of ['landmarks', 'tourism', 'scenario', 'region', 'bigCompany', 'history', 'records', 'medals']) delete old[k];
    return old;
  };
  it('añade obras, turismo, escenario Libre, comarca normal 18 meses y medallas vacías', () => {
    const m = migrate(v15(5_000));
    expect(m.formatVersion).toBe(FORMAT_VERSION);
    expect(m.landmarks).toEqual([]);
    expect(m.tourism).toEqual({ visitors: 0, lastIncome: 0, tax: 0 });
    expect(m.scenario).toEqual({ id: 'libre', done: true });
    expect(m.region).toEqual({ phase: 'normal', until: 5_000 + REGION.firstMonths * TICKS_PER_MONTH, warned: false });
    expect(m.bigCompany).toBeNull();
    expect(m.history).toEqual([]);
    expect(m.records).toEqual({});
    expect(m.medals).toEqual([]);
    expect(checkInvariants(m)).toEqual([]);
    // Una partida nueva y una migrada desde el mismo estado inicial quedan iguales.
    expect(hashState(migrate(v15(0)))).toBe(hashState(createInitialState({ seed: 4 })));
    // Y sigue jugándose.
    for (let i = 0; i < 24 * 31; i++) step(m);
    expect(checkInvariants(m)).toEqual([]);
  });
  it('reconstruye la historia por años y los récords desde stats (migrate16History)', () => {
    const stat = (month: number, population: number, treasury: number, extra: Record<string, number> = {}) => ({ month, population, treasury, happiness: 50 + month, income: 100 * month, expenses: 0, breakdown: {}, ...extra });
    const stats = [stat(1, 5, 1_000, { jobless: 1, businesses: 0 }), stat(6, 9, 4_000, { jobless: 3, businesses: 2 }), stat(12, 7, 2_000, { jobless: 2, businesses: 1 }), stat(13, 12, -500)];
    const m = migrate16History({ stats });
    expect(m.history).toEqual([
      { year: 1, months: 3, population: { min: 5, avg: 7, max: 9 }, treasury: { min: 1_000, avg: 2_333, max: 4_000 }, happiness: { min: 51, avg: 56, max: 62 }, jobless: { min: 1, avg: 2, max: 3 }, businesses: { min: 0, avg: 1, max: 2 }, visitors: { min: 0, avg: 0, max: 0 } },
      { year: 2, months: 1, population: { min: 12, avg: 12, max: 12 }, treasury: { min: -500, avg: -500, max: -500 }, happiness: { min: 63, avg: 63, max: 63 }, jobless: { min: 0, avg: 0, max: 0 }, businesses: { min: 0, avg: 0, max: 0 }, visitors: { min: 0, avg: 0, max: 0 } },
    ]);
    expect(m.records).toEqual({
      population: { v: 12, tick: 13 * TICKS_PER_MONTH },
      treasury: { v: 4_000, tick: 6 * TICKS_PER_MONTH },
      happiness: { v: 63, tick: 13 * TICKS_PER_MONTH },
      businesses: { v: 2, tick: 6 * TICKS_PER_MONTH },
      income: { v: 1_300, tick: 13 * TICKS_PER_MONTH },
    });
    // Sin stats, vacío; lo que ya tenía no se toca.
    expect(migrate16History({})).toMatchObject({ history: [], records: {} });
    expect(migrate16History({ history: [{ year: 9 }], records: { population: { v: 1, tick: 2 } }, stats })).toMatchObject({ history: [{ year: 9 }], records: { population: { v: 1, tick: 2 } } });
  });
  it('cada parte respeta lo que ya había', () => {
    expect(migrate16Landmarks({ landmarks: [{ id: 3 }] }).landmarks).toEqual([{ id: 3 }]);
    expect(migrate16Tourism({ tourism: { visitors: 9, lastIncome: 1, tax: 2 } }).tourism).toEqual({ visitors: 9, lastIncome: 1, tax: 2 });
    expect(migrate16Scenario({ scenario: { id: 'quiebra', done: false } }).scenario).toEqual({ id: 'quiebra', done: false });
    expect(migrate16Region({ region: { phase: 'crisis', until: 7, warned: true }, bigCompany: { name: 'X' } })).toMatchObject({ region: { phase: 'crisis', until: 7, warned: true }, bigCompany: { name: 'X' } });
    expect(migrate16Medals({ medals: [{ id: 'a', tick: 1 }] }).medals).toEqual([{ id: 'a', tick: 1 }]);
  });
});

describe('migraciones', () => {
  it('hay una migración por cada versión anterior', () => {
    for (let v = 0; v < FORMAT_VERSION; v++) expect(MIGRATIONS[v]).toBeTypeOf('function');
  });
  it('1 → 2 añade zonas, obras y campos de edificio', () => {
    const v1 = {
      formatVersion: 1,
      map: { w: 2, h: 2, tiles: [0, 0, 0, 0] },
      buildings: [{ id: 1, kind: 'townhall', x: 0, y: 0, owner: 0 }],
      citizens: [{ id: 2, name: 'Lucía', age: 34, money: 1, homeId: null, jobId: 1, happiness: 60 }],
      month: { income: 0, expenses: 0 },
      stats: [],
    };
    const m = migrate(v1);
    expect(m.formatVersion).toBe(FORMAT_VERSION);
    expect(m.map.zones).toEqual([0, 0, 0, 0]);
    expect(m.buildings[0]).toMatchObject({ cash: 0, built: true });
    expect(m.projects).toEqual([]);
    expect(m.month.taxDays).toBe(0);
  });
  it('0 → 1 añade debtMonths y bankrupt', () => {
    const s = createInitialState({ seed: 1 }) as unknown as Record<string, unknown>;
    const old: Record<string, unknown> = { ...s, formatVersion: 0 };
    delete old.debtMonths;
    delete old.bankrupt;
    const m = migrate(old);
    expect(m.formatVersion).toBe(FORMAT_VERSION);
    expect(m.debtMonths).toBe(0);
    expect(m.bankrupt).toBe(false);
  });
  it('rechaza estados de una versión futura', () => {
    expect(() => migrate({ formatVersion: FORMAT_VERSION + 1 })).toThrow();
  });
});

describe('migración 2 → 3', () => {
  it('añade vecinos con nombre, rasgos y decisiones', () => {
    const v2 = { formatVersion: 2, taxLevel: 'high', citizens: [{ id: 2, name: 'Lucía' }, { id: 3, name: 'Pablo' }] };
    const m = migrate(v2);
    expect(m.citizens[0]).toMatchObject({ named: true, memories: [], cooldownUntil: 0 });
    expect(m.pending).toEqual([]);
    expect(m.prevTaxLevel).toBe('high');
    expect(m.aiMode).toBe(false);
  });
});

describe('migración 13 → 14 (2.1, rangos)', () => {
  it('añade el rango que corresponde y el escudo del terreno, sin votación', () => {
    const s = createInitialState({ seed: 8 }) as unknown as Record<string, unknown>;
    const old: Record<string, unknown> = { ...structuredClone(s), formatVersion: 13 };
    delete old.rank;
    const m = migrate(old);
    expect(m.formatVersion).toBe(FORMAT_VERSION);
    expect(m.rank).toMatchObject({ level: 0, vote: null });
    expect(m.rank!.crest.pieces).toHaveLength(1);
  });
});
