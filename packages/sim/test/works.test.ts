import { describe, expect, it } from 'vitest';
import { applyCommand, BUILD, commandOutlay, createInitialState, type GameState, pendingWorksCost, step, validateCommand, WAGE_OUTSIDE } from '../src/index.ts';

function houseSpot(s: GameState): { x: number; y: number } {
  for (let y = 0; y < s.map.h; y++) {
    for (let x = 0; x < s.map.w; x++) if (validateCommand(s, { type: 'Build', kind: 'house', x, y }).ok) return { x, y };
  }
  throw new Error('sin sitio');
}

describe('lo que falta por pagar de las obras (v1.9.1)', () => {
  it('una obra nueva cuenta toda la mano de obra y baja según avanza', () => {
    const s = createInitialState({ seed: 5 });
    expect(pendingWorksCost(s)).toBe(0);
    const at = houseSpot(s);
    const cmd = { type: 'Build' as const, kind: 'house' as const, ...at };
    const outlay = commandOutlay(s, cmd);
    const before = s.treasury;
    expect(applyCommand(s, cmd).ok).toBe(true);
    const labour = BUILD.house.workers * BUILD.house.days * WAGE_OUTSIDE;
    // Los materiales se pagan ya; la obra queda pendiente.
    expect(before - s.treasury + pendingWorksCost(s)).toBe(outlay);
    expect(pendingWorksCost(s)).toBe(labour);
    for (let i = 0; i < 48; i++) step(s);
    expect(pendingWorksCost(s)).toBeLessThan(labour);
    expect(pendingWorksCost(s)).toBeGreaterThanOrEqual(0);
  });

  it('quitar zona es gratis', () => {
    const s = createInitialState({ seed: 5 });
    expect(commandOutlay(s, { type: 'Zone', zone: 'none', x: 1, y: 1, w: 3, h: 3 })).toBe(0);
  });
});
