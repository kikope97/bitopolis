import { FORMAT_VERSION, type GameState } from './state.ts';

/**
 * Migraciones encadenadas: MIGRATIONS[n] convierte un estado de formatVersion
 * n a n+1. Cada una debe tener su test en test/migrations.test.ts.
 */
type Migration = (s: Record<string, any>) => Record<string, any>;

export const MIGRATIONS: Record<number, Migration> = {
  // 0 → 1: estados previos al campo `debtMonths`.
  0: (s) => ({ ...s, debtMonths: s.debtMonths ?? 0, bankrupt: s.bankrupt ?? false, formatVersion: 1 }),
  // 1 → 2 (v0.1): capa de zonas, obras, caja de empresas, redes y demanda.
  1: (s) => ({
    ...s,
    formatVersion: 2,
    map: { ...s.map, zones: s.map.zones ?? new Array(s.map.w * s.map.h).fill(0) },
    buildings: (s.buildings ?? []).map((b: Record<string, unknown>) => ({
      cash: 0,
      built: true,
      hasWater: false,
      hasPower: false,
      unpaidMonths: 0,
      ...b,
    })),
    citizens: (s.citizens ?? []).map((c: Record<string, unknown>) => ({ arrivedMonth: 0, ...c })),
    projects: s.projects ?? [],
    month: { breakdown: {}, taxRateSum: 0, taxDays: 0, ...s.month },
    demand: s.demand ?? { R: 0, C: 0, I: 0 },
    stats: (s.stats ?? []).map((m: Record<string, unknown>) => ({ breakdown: {}, ...m })),
  }),
};

export function migrate(raw: unknown): GameState {
  if (typeof raw !== 'object' || raw === null) throw new Error('estado inválido');
  let s = raw as Record<string, any>;
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
