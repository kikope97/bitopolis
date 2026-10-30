import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  buildDecisionRequest,
  createInitialState,
  type GameState,
  hashState,
  parseDecisions,
  step,
} from '../src/index.ts';

/** Avanza hasta que haya una decisión pendiente (la llegada de un vecino con nombre). */
function withPending(seed = 4): GameState {
  const s = createInitialState({ seed });
  const cx = s.map.w / 2;
  const cy = s.map.h / 2;
  applyCommand(s, { type: 'Build', kind: 'house', x: cx + 2, y: cy + 1 });
  for (let i = 0; i < 24 * 60 && s.pending.length === 0; i++) step(s);
  return s;
}

describe('decisiones de vecinos con nombre', () => {
  it('la llegada de un vecino con nombre crea una decisión con acciones cerradas', () => {
    const s = withPending();
    expect(s.pending.length).toBe(1);
    const p = s.pending[0]!;
    expect(p.trigger).toBe('llegada');
    expect(p.actions).toContain('quedarse');
    expect(s.citizens.find((c) => c.id === p.citizenId)?.named).toBe(true);
  });

  it('si no llega decisión a tiempo, deciden las reglas con motivo', () => {
    const s = withPending();
    const id = s.pending[0]!.citizenId;
    for (let i = 0; i < 13; i++) step(s);
    expect(s.pending.length).toBe(0);
    const log = s.decisionLog.at(-1)!;
    expect(log).toMatchObject({ citizenId: id, source: 'rule' });
    expect(log.motivo.length).toBeGreaterThan(5);
    expect(s.events.some((e) => e.kind === 'decision' && e.ref === id)).toBe(true);
  });

  it('CitizenAct solo acepta acciones válidas y se reproduce igual', () => {
    const s = withPending();
    const p = s.pending[0]!;
    expect(applyCommand(s, { type: 'CitizenAct', citizenId: p.citizenId, action: 'irse', motivo: 'x', source: 'ai' }).ok).toBe(false);
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    const cmd = { type: 'CitizenAct', citizenId: p.citizenId, action: 'pedir:parque', motivo: 'Quiero un parque para pasear.', source: 'ai' } as const;
    expect(applyCommand(s, cmd).ok).toBe(true);
    applyCommand(copy, cmd);
    expect(hashState(copy)).toBe(hashState(s));
    expect(s.decisionLog.at(-1)).toMatchObject({ source: 'ai', action: 'pedir:parque' });
  });

  it('el prompt solo lleva datos del motor y un esquema con enums', () => {
    const s = withPending();
    const req = buildDecisionRequest(s, s.pending);
    expect(req.system).toContain('Bitópolis');
    const body = JSON.parse(req.user);
    expect(body.vecinos[0].acciones.length).toBeGreaterThan(1);
    const items = (req.schema as any).properties.decisiones.items.properties;
    expect(items.vecino.enum).toEqual(req.citizenIds);
    expect(items.accion.enum).toContain('quedarse');
  });

  it('valida la respuesta del LLM', () => {
    const s = withPending();
    const p = s.pending[0]!;
    const good = JSON.stringify({ decisiones: [{ vecino: p.citizenId, accion: 'quedarse', motivo: 'Me gusta el sitio.' }] });
    expect(parseDecisions(good, s.pending).decisions).toHaveLength(1);
    const wrong = JSON.stringify({ decisiones: [{ vecino: p.citizenId, accion: 'robar_banco', motivo: 'ja' }] });
    expect(parseDecisions(wrong, s.pending).invalid).toEqual([p.citizenId]);
    expect(parseDecisions('esto no es json', s.pending).error).toBeDefined();
    const fenced = '```json\n' + good + '\n```';
    expect(parseDecisions(fenced, s.pending).decisions).toHaveLength(1);
    const html = JSON.stringify({ decisiones: [{ vecino: p.citizenId, accion: 'quedarse', motivo: '<b>hola</b>' }] });
    expect(parseDecisions(html, s.pending).decisions[0]!.motivo).not.toContain('<');
  });
});
