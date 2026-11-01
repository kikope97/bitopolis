import { describe, expect, it } from 'vitest';
import { lowerFirst, pickTemplate, runSimulation, taxMood, worriesOf } from '../src/index.ts';

describe('textos de la ficha del vecino', () => {
  it('lowerFirst no estropea las siglas', () => {
    expect(lowerFirst('Tasas altas')).toBe('tasas altas');
    expect(lowerFirst('IBI alto')).toBe('IBI alto');
    expect(lowerFirst('IBI alto (sube el alquiler)')).toBe('IBI alto (sube el alquiler)');
    expect(lowerFirst('Ñ')).toBe('ñ');
  });

  it('una plantilla no se repite dos veces seguidas para el mismo vecino', () => {
    const { state } = runSimulation({ seed: 5, days: 60, profile: 'casual' });
    const c = state.citizens[0]!;
    const options = ['Frase uno.', 'Frase dos.', 'Frase tres.'];
    const first = pickTemplate(state, c, options);
    state.decisionLog.push({ tick: state.tick, citizenId: c.id, trigger: 'ahorros', action: 'ahorrar', motivo: `${first} Cada euro cuenta.`, source: 'rule' });
    expect(pickTemplate(state, c, options)).not.toBe(first);
  });

  it('lo que notan todos (los tributos) va detrás de lo propio si lo propio pesa', () => {
    const { state } = runSimulation({ seed: 5, days: 60, profile: 'casual' });
    state.taxLevel = 'high';
    state.prevTaxLevel = 'high';
    let checked = 0;
    for (const c of state.citizens) {
      const shared = new Set(taxMood(state, c).map((f) => f.label));
      const list = worriesOf(state, c);
      expect(list.every((f) => f.value < 0)).toBe(true);
      list.forEach((f, i) => {
        if (!shared.has(f.label)) return;
        // Nada propio que pese al menos la mitad queda detrás de un tributo.
        for (const g of list.slice(i + 1)) if (!shared.has(g.label)) expect(g.value > f.value / 2, JSON.stringify(list)).toBe(true);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(0);
  });
});
