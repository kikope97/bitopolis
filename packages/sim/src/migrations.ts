import { FORMAT_VERSION, type GameState } from './state.ts';

/**
 * Migraciones encadenadas: MIGRATIONS[n] convierte un estado de formatVersion
 * n a n+1. Cada una debe tener su test en test/migrations.test.ts.
 */
type Migration = (s: Record<string, unknown>) => Record<string, unknown>;

export const MIGRATIONS: Record<number, Migration> = {
  // 0 → 1: estados previos al campo `debtMonths`.
  0: (s) => ({ ...s, debtMonths: s.debtMonths ?? 0, bankrupt: s.bankrupt ?? false, formatVersion: 1 }),
};

export function migrate(raw: unknown): GameState {
  if (typeof raw !== 'object' || raw === null) throw new Error('estado inválido');
  let s = raw as Record<string, unknown>;
  let v = typeof s.formatVersion === 'number' ? s.formatVersion : 0;
  if (v > FORMAT_VERSION) throw new Error(`formatVersion ${v} es más nueva que este motor (${FORMAT_VERSION})`);
  while (v < FORMAT_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`falta la migración ${v} → ${v + 1}`);
    s = m(s);
    v = s.formatVersion as number;
  }
  return s as unknown as GameState;
}
