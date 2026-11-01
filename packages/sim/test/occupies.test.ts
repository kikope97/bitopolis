import { describe, expect, it } from 'vitest';
import { applyCommand, buildingAt, createInitialState, footprint, newBuilding, occupies, sizeOf, validateCommand, zoneChanges } from '../src/index.ts';

describe('occupies (2.3, edificios 2×2)', () => {
  it('un edificio normal solo ocupa su casilla', () => {
    const b = { x: 5, y: 7 };
    expect(sizeOf(b)).toBe(1);
    expect(occupies(b, 5, 7)).toBe(true);
    for (const [x, y] of [[6, 7], [5, 8], [4, 7], [5, 6], [6, 8]] as const) expect(occupies(b, x, y)).toBe(false);
    expect(footprint(b)).toEqual([[5, 7]]);
  });
  it('un 2×2 se ancla en (x, y) y ocupa también la derecha y abajo', () => {
    const b = { x: 5, y: 7, size: 2 as const };
    expect(sizeOf(b)).toBe(2);
    for (const [x, y] of [[5, 7], [6, 7], [5, 8], [6, 8]] as const) expect(occupies(b, x, y)).toBe(true);
    for (const [x, y] of [[4, 7], [7, 7], [5, 6], [5, 9], [7, 9], [4, 6]] as const) expect(occupies(b, x, y)).toBe(false);
    expect(footprint(b)).toEqual([[5, 7], [6, 7], [5, 8], [6, 8]]);
  });
  it('buildingAt, el derribo y las zonas ven las 4 casillas', () => {
    const s = createInitialState({ seed: 3 });
    const big = newBuilding(s, 'park', 4, 4, 0);
    big.size = 2;
    big.built = true;
    expect(buildingAt(s, 5, 5)?.id).toBe(big.id);
    expect(buildingAt(s, 6, 5)).toBeUndefined();
    // Construir encima de cualquier casilla: ocupado.
    expect(validateCommand(s, { type: 'Build', kind: 'house', x: 5, y: 4 })).toEqual({ ok: false, error: 'Ese sitio está ocupado' });
    // Las casillas del 2×2 no se pintan como zona.
    expect(zoneChanges(s, { x: 4, y: 4, w: 3, h: 3, zone: 'R' })).toEqual({ changed: 5, skipped: 4 });
    // Derribar desde la casilla de abajo a la derecha quita el edificio entero.
    expect(applyCommand(s, { type: 'Demolish', x: 5, y: 5 }).ok).toBe(true);
    expect(s.buildings.some((b) => b.id === big.id)).toBe(false);
  });
});
