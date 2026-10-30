import { describe, expect, it } from 'vitest';
import { createInitialState, FORMAT_VERSION, MIGRATIONS, migrate } from '../src/index.ts';

describe('migraciones', () => {
  it('hay una migración por cada versión anterior', () => {
    for (let v = 0; v < FORMAT_VERSION; v++) expect(MIGRATIONS[v]).toBeTypeOf('function');
  });
  it('0 → 1 añade debtMonths y bankrupt', () => {
    const s = createInitialState({ seed: 1 }) as unknown as Record<string, unknown>;
    const old: Record<string, unknown> = { ...s, formatVersion: 0 };
    delete old.debtMonths;
    delete old.bankrupt;
    const m = migrate(old);
    expect(m.formatVersion).toBe(1);
    expect(m.debtMonths).toBe(0);
    expect(m.bankrupt).toBe(false);
  });
  it('rechaza estados de una versión futura', () => {
    expect(() => migrate({ formatVersion: FORMAT_VERSION + 1 })).toThrow();
  });
});
