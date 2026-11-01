import { describe, expect, it } from 'vitest';
import { TICKS_PER_MONTH } from '@bitopolis/shared';
import { applyCommand, createInitialState, REGION, validateCommand } from '../src/index.ts';

/** 2.3 (F0): cimientos de las metas grandes. La lógica de cada bloque tiene sus propios tests. */
const NEW_COMMANDS = [
  { type: 'StartLandmark', kind: 'station', x: 10, y: 10 },
  { type: 'FundLandmarkPhase', id: 1 },
  { type: 'PauseLandmark', id: 1 },
  { type: 'SetTouristTax', level: 1 },
  { type: 'ProtectArea', heritageId: 1 },
  { type: 'AnswerBigCompany', accept: true, incentive: 'suelo_gratis' },
];

describe('metas grandes (2.3): estado y comandos', () => {
  it('una partida nueva empieza en Libre, comarca normal y sin obras, turismo ni medallas', () => {
    const s = createInitialState({ seed: 9 });
    expect(s.landmarks).toEqual([]);
    expect(s.tourism).toEqual({ visitors: 0, lastIncome: 0, tax: 0 });
    expect(s.scenario).toEqual({ id: 'libre', done: true });
    expect(s.region).toEqual({ phase: 'normal', until: REGION.firstMonths * TICKS_PER_MONTH, warned: false });
    expect(s.bigCompany).toBeNull();
    expect(s.history).toEqual([]);
    expect(s.records).toEqual({});
    expect(s.medals).toEqual([]);
    expect(createInitialState({ seed: 9, scenario: 'quiebra' }).scenario).toEqual({ id: 'quiebra', done: false });
  });
  it('los comandos nuevos están bien formados pero aún no están disponibles', () => {
    const s = createInitialState({ seed: 9 });
    // F1 (B): la tasa turística y el entorno protegido ya funcionan (tourism.test.ts).
    const done = new Set(['SetTouristTax', 'ProtectArea']);
    for (const cmd of NEW_COMMANDS.filter((c) => !done.has(c.type))) expect(applyCommand(s, cmd)).toEqual({ ok: false, error: 'Aún no está disponible' });
    expect(validateCommand(s, { type: 'SetTouristTax', level: 3 })).toEqual({ ok: false, error: 'comando mal formado' });
    expect(validateCommand(s, { type: 'StartLandmark', kind: 'castillo', x: 1, y: 1 })).toEqual({ ok: false, error: 'comando mal formado' });
    expect(validateCommand(s, { type: 'AnswerBigCompany', accept: true, incentive: 'regalo' })).toEqual({ ok: false, error: 'comando mal formado' });
  });
  it('en la oposición no se permiten', () => {
    const s = createInitialState({ seed: 9 });
    s.politics.mayor = 999_999;
    for (const cmd of NEW_COMMANDS) expect(validateCommand(s, cmd)).toMatchObject({ ok: false, error: expect.stringMatching(/oposición/) });
  });
});
