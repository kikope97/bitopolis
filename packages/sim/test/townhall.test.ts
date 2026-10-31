import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  checkInvariants,
  createInitialState,
  migrate,
  OUTSIDE,
  runSimulation,
  TOWNHALL_LEVELS,
  transfer,
  TREASURY,
  validateCommand,
} from '../src/index.ts';

describe('ayuntamiento por niveles (v1.8)', () => {
  it('empieza en nivel 1: sin zonas ni plenos, y el colegio pide nivel 2', () => {
    const s = createInitialState({ seed: 5 });
    expect(s.townhallLevel).toBe(1);
    const z = validateCommand(s, { type: 'Zone', zone: 'R', x: 1, y: 1, w: 1, h: 1 });
    expect(z.ok).toBe(false);
    const b = validateCommand(s, { type: 'Build', kind: 'school', x: 1, y: 1 });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toMatch(/nivel 2/);
    expect(validateCommand(s, { type: 'UpgradeTownhall' }).ok).toBe(false);
  });

  it('subir de nivel pide vecinos y dinero, cobra la obra y desbloquea', () => {
    const { state } = runSimulation({ seed: 2, days: 60, profile: 'pasivo' });
    const s = state;
    while (s.citizens.length < TOWNHALL_LEVELS[1]!.pop) s.citizens.push({ ...s.citizens[0]!, id: 9000 + s.citizens.length });
    transfer(s, OUTSIDE, TREASURY, 10_000, 'subvencion');
    const before = s.treasury;
    expect(applyCommand(s, { type: 'UpgradeTownhall' }).ok).toBe(true);
    expect(s.townhallLevel).toBe(2);
    expect(s.treasury).toBe(before - TOWNHALL_LEVELS[1]!.cost);
    expect(s.events.some((e) => e.text.startsWith('El ayuntamiento sube a nivel 2'))).toBe(true);
    const z = validateCommand(s, { type: 'Zone', zone: 'R', x: 1, y: 1, w: 1, h: 1 });
    expect(z.ok ? '' : z.error).not.toMatch(/nivel/);
  });

  it('los perfiles amplían el ayuntamiento y el dinero se conserva', () => {
    const { state } = runSimulation({ seed: 42, days: 400, profile: 'constructor' });
    expect(state.townhallLevel).toBeGreaterThanOrEqual(2);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('migración 10→11: un pueblo de antes recibe el nivel de su población', () => {
    const { state } = runSimulation({ seed: 3, days: 300, profile: 'constructor' });
    const old = { ...structuredClone(state), formatVersion: 10 } as Record<string, unknown>;
    delete old.townhallLevel;
    delete old.justice;
    const m = migrate(old);
    expect(m.townhallLevel).toBeGreaterThanOrEqual(2);
  });
});
