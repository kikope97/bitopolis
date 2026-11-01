import { describe, expect, it } from 'vitest';
import { createInitialState, FORMAT_VERSION, MIGRATIONS, migrate, migrate14Trash } from '../src/index.ts';

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
