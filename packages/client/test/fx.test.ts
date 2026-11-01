import { describe, expect, it, vi } from 'vitest';

// fx.ts consulta el «movimiento reducido» del sistema: en Node se simula. Como un MediaQueryList
// de verdad, `matches` sigue al sistema en vivo (prefs.ts guarda la consulta, 2.5.1).
let reduced = false;
vi.stubGlobal('window', {
  matchMedia: () => ({
    get matches() {
      return reduced;
    },
  }),
});
const { shake, shakeOffset } = await import('../src/fx.ts');

describe('sacudida de cámara', () => {
  it('decae hasta cero y no se pasa de la amplitud', () => {
    shake(6, 500, 1000);
    for (let t = 1000; t < 1500; t += 16) {
      const [x, y] = shakeOffset(t);
      expect(Math.abs(x)).toBeLessThanOrEqual(6);
      expect(Math.abs(y)).toBeLessThanOrEqual(6);
    }
    expect(shakeOffset(1500)).toEqual([0, 0]);
  });

  it('una más débil no pisa a una más fuerte en curso', () => {
    shake(6, 500, 2000);
    shake(2, 500, 2010);
    const peak = Math.max(...Array.from({ length: 10 }, (_, i) => Math.abs(shakeOffset(2010 + i * 7)[0])));
    expect(peak).toBeGreaterThan(2);
  });

  it('con movimiento reducido no se mueve nada', () => {
    reduced = true;
    shake(6, 500, 3000);
    expect(shakeOffset(3100)).toEqual([0, 0]);
    reduced = false;
  });
});
