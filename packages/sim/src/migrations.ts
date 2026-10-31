import { emptyPolitics } from './politics-core.ts';
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
  // 2 → 3 (v0.2): vecinos con nombre, rasgos, decisiones pendientes y log.
  2: (s) => ({
    ...s,
    formatVersion: 3,
    citizens: (s.citizens ?? []).map((c: Record<string, unknown>, i: number) => ({
      named: i < 5,
      traits: { terco: 50, ahorro: 50, social: 50, ambicion: 50 },
      desire: 'prosperar',
      fear: 'paro',
      memory: [],
      cooldownUntil: 0,
      ...c,
    })),
    aiMode: s.aiMode ?? false,
    namedLimit: s.namedLimit ?? 5,
    pending: s.pending ?? [],
    decisionLog: s.decisionLog ?? [],
    prevTaxLevel: s.prevTaxLevel ?? s.taxLevel ?? 'medium',
  }),
  // 3 → 4 (v0.3): tributos separados, vivienda en propiedad, memoria fiscal y externalidades.
  3: (s) => {
    const n = (s.map?.w ?? 48) * (s.map?.h ?? 48);
    const lvl = s.taxLevel ?? 'medium';
    const { taxRateSum: _old, ...month } = s.month ?? {};
    void _old;
    return {
      ...s,
      formatVersion: 4,
      citizens: (s.citizens ?? []).map((c: Record<string, unknown>) => ({ owns: false, boughtPrice: 0, mortgage: 0, mortgageTo: -1, subsidized: false, boughtTick: 0, grudge: 0, ...c })),
      taxes: s.taxes ?? { ibi: lvl, tasas: lvl, plusvalia: lvl },
      prevTaxes: s.prevTaxes ?? { ibi: lvl, tasas: lvl, plusvalia: lvl },
      taxesSplit: s.taxesSplit ?? false,
      month: { income: 0, expenses: 0, breakdown: {}, taxDays: 0, ...month, rateSums: month.rateSums ?? { ibi: 0, tasas: 0, plusvalia: 0 } },
      fields: s.fields ?? { pollution: new Array(n).fill(0), noise: new Array(n).fill(0), crime: new Array(n).fill(0), land: new Array(n).fill(50) },
    };
  },
  // 4 → 5 (v0.4): fichas completas, memoria en 3 capas, ganchos, plenos, objetivos.
  4: (s) => ({
    ...s,
    formatVersion: 5,
    citizens: (s.citizens ?? []).map((c: Record<string, any>) => {
      const { memory: _old, ...rest } = c;
      void _old;
      return { profession: c.named ? 'vecina' : '', goal: 'ahorrar', relations: [], memories: [], summary: '', ...rest };
    }),
    hooks: s.hooks ?? [],
    pleno: s.pleno ?? null,
    promises: s.promises ?? [],
    lastPlenoTick: s.lastPlenoTick ?? -1,
    objectivesDone: s.objectivesDone ?? [],
    unlocked: s.unlocked ?? [],
  }),
  // 5 → 6 (v1.0): política (elecciones cada 4 años, facciones y oposición).
  5: (s) => ({ ...s, formatVersion: 6, politics: s.politics ?? emptyPolitics(s.tick ?? 0) }),
  // 6 → 7 (v1.1): promesas del partido rival, mociones y dos exigencias por facción.
  6: (s) => ({
    ...s,
    formatVersion: 7,
    politics: {
      ...s.politics,
      lastMotion: s.politics?.lastMotion ?? -1,
      motions: s.politics?.motions ?? [],
      party: s.politics?.party ? { promises: [], ...s.politics.party } : null,
      factions: Object.fromEntries(Object.entries(s.politics?.factions ?? {}).map(([k, v]: [string, any]) => [k, { demands: v.demand ? [v.demand] : [], unmet: v.demand ? [v.demand] : [], ...v }])),
    },
  }),
  // 7 → 8 (v1.3): registro de lo que hace el gobierno rival.
  7: (s) => ({ ...s, formatVersion: 8, politics: { ...s.politics, log: s.politics?.log ?? [] } }),
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
