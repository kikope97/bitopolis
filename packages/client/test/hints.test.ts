import { describe, expect, it } from 'vitest';
import { createInitialState, monthlyCostOf, OUTSIDE, runSimulation, transfer, TREASURY, type GameState } from '@bitopolis/sim';
import { nextHint, serviceCost } from '../src/hints.ts';

/** Un mes cerrado que deja `net` € (lo que entra menos el gasto corriente; sin obras). */
function closedMonth(s: GameState, net: number) {
  const running = 3_000;
  s.stats.push({ month: 1, population: s.citizens.length, treasury: s.treasury, happiness: 60, income: running + net, expenses: running, breakdown: { IBI: running + net, mantenimiento: -running } });
}

describe('2.8: «?» pone el dinero primero', () => {
  it('un servicio que deja el mes en pérdidas dice cuánto cuesta y cuánto se perdería', () => {
    const s = createInitialState({ seed: 1 });
    transfer(s, OUTSIDE, TREASURY, 50_000, 'subvencion');
    closedMonth(s, 500);
    const cost = monthlyCostOf('police', s).total;
    expect(cost).toBeGreaterThan(500);
    const c = serviceCost(s, 'police');
    expect(c.ok).toBe(false);
    expect(c.text).toMatch(/^Te costará .+\/mes y pasarías a perder ~.+\/mes\.$/);
    // Con el mes holgado, nada que decir.
    s.stats.at(-1)!.income += 100_000;
    expect(serviceCost(s, 'police')).toEqual({ text: '', ok: true });
  });

  it('con la caja corta, impuestos o esperar antes que el préstamo', () => {
    const s = createInitialState({ seed: 1 });
    s.treasury = 2_000;
    closedMonth(s, -1_500);
    const t = nextHint(s).text;
    expect(t).toMatch(/la caja aguanta/);
    expect(t.indexOf('impuestos')).toBeLessThan(t.indexOf('préstamo'));
  });

  it('cuando el progreso se para, dice cuántos vecinos faltan', () => {
    const { state: s } = runSimulation({ seed: 7, days: 12, profile: 'constructor', checkEveryDay: false });
    transfer(s, OUTSIDE, TREASURY, 50_000, 'subvencion');
    s.stats.length = 0;
    for (let i = 0; i < 10; i++) s.map.tiles[i] = 1;
    const t = nextHint(s).text;
    expect(t).toMatch(/Te (falta 1 vecino|faltan \d+ vecinos) para ampliar el ayuntamiento/);
    expect(t).not.toMatch(/\(s\)/);
  });

  it('«edificios» en plural, sin «(s)»', () => {
    const { state: s } = runSimulation({ seed: 7, days: 12, profile: 'constructor', checkEveryDay: false });
    transfer(s, OUTSIDE, TREASURY, 50_000, 'subvencion');
    s.stats.length = 0;
    for (let i = 0; i < 10; i++) s.map.tiles[i] = 1;
    for (const b of s.buildings) if (b.kind === 'house') b.hasWater = false;
    const t = nextHint(s).text;
    expect(t).toMatch(/^\d+ edificios? sin agua o luz/);
  });
});
