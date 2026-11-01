import { TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_GROUPS,
  ACHIEVEMENT_LIST,
  achievementsMonth,
  checkInvariants,
  createInitialState,
  debtFreeMonths,
  type GameState,
  generations,
  grantMedals,
  hashState,
  historyMonth,
  migrate,
  newRecordLine,
  replay,
  runSimulation,
} from '../src/index.ts';

/** 2.3 (F1-D): historia por años, récords y medallas. */
describe('historia y récords', () => {
  it('cada año resume sus meses de stats y los récords son los máximos', () => {
    const { state, report } = runSimulation({ seed: 42, days: 30 * 30, profile: 'casual', checkEveryDay: false });
    expect(report.invariantErrors).toEqual([]);
    expect(state.history.map((y) => [y.year, y.months])).toEqual([
      [1, 12],
      [2, 12],
      [3, 6],
    ]);
    const y1 = state.stats.filter((m) => m.month <= 12);
    expect(state.history[0]!.population.max).toBe(Math.max(...y1.map((m) => m.population)));
    expect(state.history[0]!.population.min).toBe(Math.min(...y1.map((m) => m.population)));
    expect(state.records.population!.v).toBe(Math.max(...state.stats.map((m) => m.population)));
    expect(state.records.treasury!.v).toBe(Math.max(...state.stats.map((m) => m.treasury)));
    // La partida se reproduce igual (historia, récords y medallas incluidos).
    expect(hashState(replay(42, report.commands, state.tick))).toBe(report.stateHash);
  }, 240_000);

  it('el récord se avisa como mucho una vez al mes y no el primer año; newRecordLine lo resume', () => {
    const s = createInitialState({ seed: 3 });
    const close = (month: number, population: number) => {
      s.tick = month * TICKS_PER_MONTH;
      s.stats.push({ month, population, treasury: 1_000, happiness: 50, income: 100, expenses: 0, breakdown: {} });
      historyMonth(s);
    };
    for (let m = 1; m <= 12; m++) close(m, 10 + m);
    expect(s.events.filter((e) => e.text.startsWith('Récord'))).toEqual([]);
    close(13, 40);
    expect(s.events.filter((e) => e.text.startsWith('Récord')).map((e) => e.text)).toEqual(['Récord del pueblo: 40 vecinos']);
    expect(newRecordLine(s)).toBe('récord: 40 vecinos');
    // Mejora de menos del 10 %: se guarda pero no se avisa.
    close(14, 41);
    expect(s.records.population).toEqual({ v: 41, tick: 14 * TICKS_PER_MONTH });
    expect(s.events.filter((e) => e.text.startsWith('Récord'))).toHaveLength(1);
    expect(s.history.at(-1)).toMatchObject({ year: 2, months: 2, population: { min: 40, avg: 41, max: 41 } });
  });
});

describe('medallas', () => {
  it('unos 30 logros con id único, grupo, pista y los tres tipos', () => {
    expect(ACHIEVEMENT_LIST.length).toBeGreaterThanOrEqual(30);
    expect(new Set(ACHIEVEMENT_LIST.map((a) => a.id)).size).toBe(ACHIEVEMENT_LIST.length);
    for (const a of ACHIEVEMENT_LIST) {
      expect(ACHIEVEMENT_GROUPS[a.group]).toBeTruthy();
      expect(a.hint.length).toBeGreaterThan(5);
      expect(['bronce', 'plata', 'oro']).toContain(a.tier);
    }
    // Una partida nueva no tiene ninguna.
    expect(ACHIEVEMENT_LIST.filter((a) => a.check(createInitialState({ seed: 1 })))).toEqual([]);
  });

  it('los encargos de la 2.1 (errands.medals) salen como logro por tramos; el oro deja foto en el álbum', () => {
    const s = createInitialState({ seed: 5 });
    s.errands!.medals = 5;
    const album = s.album.length;
    achievementsMonth(s);
    expect(s.medals.map((m) => m.id)).toEqual(['encargos_1', 'encargos_5']);
    expect(s.events.at(-1)!.text).toMatch(/^2 medallas nuevas/);
    expect(s.album.length).toBe(album);
    s.errands!.medals = 15;
    s.tick += TICKS_PER_MONTH;
    achievementsMonth(s);
    expect(s.medals.at(-1)).toEqual({ id: 'encargos_15', tick: s.tick });
    expect(s.events.at(-1)!.text).toBe('Medalla de oro: 15 encargos cumplidos');
    expect(s.album.at(-1)!.kind).toBe('medalla_encargos_15');
    // No se repiten ni dan dinero.
    const t = s.treasury;
    achievementsMonth(s);
    expect(s.medals).toHaveLength(3);
    expect(s.treasury).toBe(t);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('presupuestos seguidos, crisis sin cierres, obra sin parar y entorno protegido se recuerdan entre meses', () => {
    const s = createInitialState({ seed: 6 });
    for (let y = 1; y <= 5; y++) {
      s.budget = { ...s.budget, year: y, status: 'approved' };
      achievementsMonth(s);
      achievementsMonth(s);
    }
    expect(s.medalTrack!.budget).toEqual({ year: 5, streak: 5 });
    expect(s.medals.map((m) => m.id)).toContain('presupuestos');
    s.budget = { ...s.budget, year: 6, status: 'prorrogado' };
    achievementsMonth(s);
    expect(s.medalTrack!.budget!.streak).toBe(0);

    s.stats.push({ month: 1, population: 10, treasury: 0, happiness: 50, income: 0, expenses: 0, breakdown: {}, businesses: 4 });
    s.region = { phase: 'crisis', until: 0, warned: false };
    s.month.closures = 1;
    achievementsMonth(s);
    s.region.phase = 'normal';
    achievementsMonth(s);
    expect(s.medalTrack!.cleanCrises ?? 0).toBe(0);
    s.region.phase = 'crisis';
    s.month.closures = 0;
    achievementsMonth(s);
    achievementsMonth(s);
    s.region.phase = 'normal';
    achievementsMonth(s);
    expect(s.medalTrack!.cleanCrises).toBe(1);
    expect(s.medals.map((m) => m.id)).toContain('crisis_sin_cierres');

    s.landmarks = [
      { id: 1, kind: 'bridge', buildingId: 0, phase: 1, phases: 3, phaseUntil: -1, spent: 0, paused: true },
      { id: 2, kind: 'station', buildingId: 0, phase: 3, phases: 3, phaseUntil: -1, spent: 0 },
    ];
    achievementsMonth(s);
    expect(s.medals.map((m) => m.id)).toEqual(expect.arrayContaining(['obra_station', 'obra_sin_parar']));
    expect(s.medals.map((m) => m.id)).not.toContain('obra_bridge');

    s.tourism.protectedId = 99;
    for (let i = 0; i < 12; i++) achievementsMonth(s);
    expect(s.medals.map((m) => m.id)).toContain('entorno_protegido');
  });

  it('sin deuda: meses seguidos sin préstamos ni caja en negativo', () => {
    const s = createInitialState({ seed: 7 });
    const m = (month: number, treasury: number, breakdown: Record<string, number> = {}) => ({ month, population: 5, treasury, happiness: 50, income: 100, expenses: 0, breakdown });
    s.stats = [m(1, -10), m(2, 5), m(3, 5, { préstamos: -50 }), m(4, 5), m(5, 5)];
    expect(debtFreeMonths(s)).toBe(2);
    s.loans = [{ id: 1 } as GameState['loans'][number]];
    expect(debtFreeMonths(s)).toBe(0);
  });

  it('generaciones: hijo, padres y abuelos (aunque ya no estén)', () => {
    const s = createInitialState({ seed: 8 });
    const c = s.citizens[0]!;
    expect(generations(s)).toBe(1);
    c.parents = [9_001];
    s.departed.push({ id: 9_001, name: 'Abuela', age: 80, reason: 'fallecio', tick: 0, parents: [9_002] } as GameState['departed'][number]);
    expect(generations(s)).toBe(2);
    s.departed.push({ id: 9_002, name: 'Bisabuelo', age: 90, reason: 'fallecio', tick: 0 } as GameState['departed'][number]);
    expect(generations(s)).toBe(3);
  });

  it('la migración 15 → 16 da en silencio las que ya se tenían (sin avisos ni álbum)', () => {
    const { state } = runSimulation({ seed: 42, days: 30 * 26, profile: 'casual' });
    const old = structuredClone(state) as unknown as Record<string, any>;
    old.formatVersion = 15;
    for (const k of ['medals', 'medalTrack', 'history', 'records']) delete old[k];
    const events = old.events.length;
    const album = old.album.length;
    const m = migrate(old);
    expect(m.medals.map((x) => x.id).sort()).toEqual(state.medals.map((x) => x.id).filter((id) => ACHIEVEMENT_LIST.find((a) => a.id === id)!.check(m)).sort());
    expect(m.medals.length).toBeGreaterThan(2);
    expect(m.medals.every((x) => x.tick === state.tick)).toBe(true);
    expect(m.events.length).toBe(events);
    expect(m.album.length).toBe(album);
    expect(checkInvariants(m)).toEqual([]);
    // Lo que ya tenía no se toca.
    expect(grantMedals(m, true)).toEqual([]);
  }, 240_000);
});
