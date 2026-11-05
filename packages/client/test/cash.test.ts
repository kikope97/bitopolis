import { describe, expect, it } from 'vitest';
import { createInitialState, OUTSIDE, runningExpenses, transfer, TREASURY, worksSpent, type GameState } from '@bitopolis/sim';
import { monthFlow, runwayMonths, runwayWarn, splitText } from '../src/cash.ts';
import { nextHint } from '../src/hints.ts';

/** Un mes cerrado con 3.200 € de gasto corriente y una estación de tren de 32.160 €. */
function withTrainMonth(s: GameState, income = 5_000) {
  s.stats.push({ month: 1, population: 20, treasury: s.treasury, happiness: 60, income, expenses: 35_360, breakdown: { IBI: income, mantenimiento: -2_000, calles: -1_200, obras: -32_160 } });
}

describe('2.7: gasto corriente y obras por separado', () => {
  it('las obras no cuentan como gasto de cada mes', () => {
    const m = { expenses: 35_360, breakdown: { mantenimiento: -2_000, calles: -1_200, obras: -32_160 } };
    expect(worksSpent(m)).toBe(32_160);
    expect(runningExpenses(m)).toBe(3_200);
    expect(splitText(m)).toBe('Gasto corriente 3200 € · Obras 32.160 €');
  });

  it('una obra cancelada (devuelta) resta de lo invertido', () => {
    expect(worksSpent({ breakdown: { obras: 0, 'obras (sobrecoste)': -500, 'reparaciones (incendio)': -300 } })).toBe(800);
  });

  it('el mes de la estación de tren no hace creer que la caja se acaba', () => {
    const s = createInitialState({ seed: 1 });
    transfer(s, OUTSIDE, TREASURY, 30_000, 'subvencion');
    withTrainMonth(s);
    const f = monthFlow(s);
    expect(f.works).toBe(32_160);
    expect(f.running).toBeLessThan(10_000);
    // Entran 5.000 y el gasto corriente es menor: el mes sale en positivo.
    expect(runwayMonths(s)).toBeNull();
  });

  it('avisa si tras una obra la caja aguanta menos de 2 meses', () => {
    const s = createInitialState({ seed: 1 });
    s.treasury = 6_000;
    withTrainMonth(s, 1_000);
    const running = monthFlow(s).running;
    expect(running).toBeGreaterThanOrEqual(3_200);
    expect(runwayWarn(s, 4_200, 1_050)).toMatch(/^⚠ Tras esta obra, la caja aguanta (menos de un mes|1 mes)$/);
    // Con caja de sobra, nada.
    transfer(s, OUTSIDE, TREASURY, 200_000, 'subvencion');
    expect(runwayWarn(s, 4_200, 1_050)).toBe('');
  });

  it('«?» pone el dinero primero si la caja aguanta menos de 3 meses', () => {
    const s = createInitialState({ seed: 1 });
    s.treasury = 4_000;
    withTrainMonth(s, 1_000);
    const hint = nextHint(s);
    expect(hint.text).toMatch(/la caja aguanta/);
    expect(hint.tool).toBeUndefined();
  });
});
