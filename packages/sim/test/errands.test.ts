import { TICKS_PER_DAY } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import { applyCommand, checkInvariants, errandCandidates, migrate, parseDirector, runSimulation, step } from '../src/index.ts';
import { ERRANDS } from '../src/balance.ts';

describe('encargos del pueblo (2.1)', () => {
  it('salen del estado real, se prometen y, si se cumplen, pagan y dan medalla', () => {
    const { state, report } = runSimulation({ seed: 3, days: 220, profile: 'constructor', checkEveryDay: true });
    expect(report.invariantErrors).toEqual([]);
    const es = state.errands!;
    // Ya se han ofrecido encargos en estos meses (hechos, vencidos u ofrecidos ahora).
    expect(es.list.length + es.recent.length).toBeGreaterThan(0);
    const offered = es.list.find((e) => e.status === 'ofrecido');
    if (offered) {
      expect(applyCommand(state, { type: 'AnswerErrand', errandId: offered.id, answer: 'aceptar' }).ok).toBe(true);
      expect(offered.status).toBe('aceptado');
      expect(applyCommand(state, { type: 'AnswerErrand', errandId: offered.id, answer: 'aceptar' }).ok).toBe(false);
    }
    expect(es.list.length).toBeLessThanOrEqual(ERRANDS.max);
  }, 120_000);

  it('un encargo de felicidad cumplido paga la recompensa (dinero conservado)', () => {
    const { state } = runSimulation({ seed: 5, days: 150, profile: 'constructor' });
    const es = state.errands!;
    es.list = [];
    es.recent = [];
    for (const c of state.citizens) c.happiness = 40;
    const cand = errandCandidates(state).find((c) => c.kind === 'felicidad');
    expect(cand).toBeTruthy();
    const e = { id: state.nextId++, ...cand!, status: 'aceptado' as const, until: state.tick + 30 * TICKS_PER_DAY };
    es.list.push(e);
    const before = state.treasury;
    const medals = es.medals;
    // Se cumple: todos contentos (la felicidad se recalcula cada día; se fija justo antes del día).
    let guard = 0;
    while (es.list.includes(e) && guard++ < 24 * 3) {
      for (const c of state.citizens) c.happiness = 95;
      step(state);
    }
    expect(es.list.includes(e)).toBe(false);
    expect(es.medals).toBe(medals + 1);
    expect(state.treasury).toBeGreaterThan(before - 5000);
    expect(checkInvariants(state)).toEqual([]);
  }, 120_000);

  it('rechazar o aplazar: aplazar solo una vez; rechazar lo recuerda quien lo pidió', () => {
    const { state } = runSimulation({ seed: 7, days: 200, profile: 'constructor' });
    const es = state.errands!;
    es.list = [];
    es.recent = [];
    for (const c of state.citizens) c.happiness = 40;
    const cands = errandCandidates(state);
    expect(cands.length).toBeGreaterThan(0);
    const mk = (i: number) => ({ id: state.nextId++, ...cands[i % cands.length]!, status: 'ofrecido' as const, until: state.tick + 14 * TICKS_PER_DAY });
    const a = mk(0);
    es.list.push(a);
    expect(applyCommand(state, { type: 'AnswerErrand', errandId: a.id, answer: 'mas_tarde' }).ok).toBe(true);
    expect(applyCommand(state, { type: 'AnswerErrand', errandId: a.id, answer: 'mas_tarde' }).ok).toBe(false);
    const by = state.citizens.find((c) => c.id === a.by);
    const grudge = by?.grudge ?? 0;
    expect(applyCommand(state, { type: 'AnswerErrand', errandId: a.id, answer: 'rechazar' }).ok).toBe(true);
    expect(es.list.includes(a)).toBe(false);
    if (by) expect(by.grudge).toBeGreaterThan(grudge);
  }, 120_000);
});

describe('El Eco de Bitópolis (2.1)', () => {
  it('sale cada semana con titulares de lo que ha pasado; se contesta una vez', () => {
    const { state } = runSimulation({ seed: 3, days: 60, profile: 'constructor' });
    const p = state.press!;
    expect(p.editions.length).toBeGreaterThan(3);
    const ed = p.editions.at(-1)!;
    expect(ed.headlines.length).toBeGreaterThan(0);
    expect(ed.headlines.length).toBeLessThanOrEqual(3);
    expect(applyCommand(state, { type: 'AnswerPress', edition: ed.n, answer: 'agradecer' }).ok).toBe(true);
    expect(applyCommand(state, { type: 'AnswerPress', edition: ed.n, answer: 'desmentir' }).ok).toBe(false);
    if (p.editions.length > 1) expect(applyCommand(state, { type: 'AnswerPress', edition: p.editions[0]!.n, answer: 'agradecer' }).ok).toBe(false);
  }, 120_000);

  it('en Modo IA el director escribe los titulares y el encargo con su carta (validados)', () => {
    const { state } = runSimulation({ seed: 4, days: 200, profile: 'constructor', aiMode: true, aiShare: 100 });
    while (!state.ai!.turn || state.ai!.turn.kind !== 'semana') step(state);
    for (const c of state.citizens) c.happiness = 40;
    state.errands!.list = [];
    state.errands!.recent = [];
    const cands = errandCandidates(state);
    const t = state.ai!.turn!;
    const c = state.citizens.find((x) => t.ids.includes(x.id))!;
    const keep = { vecino: c.id, accion: 'seguir', gesto: { con: 0, tipo: 'ninguno' }, actitud: 0, gasto: { donde: 'pueblo', tienda: 0, ocio: false }, plan: { tipo: 'ninguno', necesidad: '', meses: 0 }, pensamiento: '', motivo: '' };
    const director = { sucesos: [], avisos: [], titulares: [{ seccion: 'anuncios' as const, texto: 'El pueblo estrena semana con ganas' }], ...(cands[0] ? { encargo: { id: cands[0].key, carta: 'Alcalde, nos hace falta.' } } : {}) };
    expect(applyCommand(state, { type: 'TownTurn', n: t.n, acts: [keep], director }).ok).toBe(true);
    expect(state.press!.editions.at(-1)!.source).toBe('ia');
    expect(state.press!.editions.at(-1)!.tick).toBe(state.tick);
    if (cands[0]) expect(state.errands!.list.some((e) => e.key === cands[0]!.key && e.story)).toBe(true);
    // parseDirector: ids de encargo fuera de la lista y textos con cifras inventadas fuera.
    const r = parseDirector(
      JSON.stringify({ sucesos: [], avisos: [], foco: '', cronica: '', titulares: [{ seccion: 'sucesos', sobre: 'n99', texto: 'Roban 98765 euros' }, { seccion: 'anuncios', sobre: '', texto: 'Fiesta en la plaza' }], encargo: { id: 'paro:otro', carta: 'x' } }),
      [],
      'datos',
      { news: [], errands: ['paro:pueblo'] },
    );
    expect(r!.director.titulares).toEqual([{ seccion: 'anuncios', texto: 'Fiesta en la plaza' }]);
    expect(r!.director.encargo).toBeUndefined();
    expect(checkInvariants(state)).toEqual([]);
  }, 120_000);

  it('migración 13→14: encargos y periódico vacíos', () => {
    const { state } = runSimulation({ seed: 4, days: 20, profile: 'casual' });
    const old = { ...structuredClone(state), formatVersion: 13 } as Record<string, unknown>;
    delete old.errands;
    delete old.press;
    const m = migrate(old);
    expect(m.errands!.list).toEqual([]);
    expect(m.press!.editions).toEqual([]);
  });
});
