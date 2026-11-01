import { describe, expect, it } from 'vitest';
import { createInitialState, step, Tile, tileIndex, Zone, zoneLotWithoutRoad, zonesWithoutRoad } from '../src/index.ts';

describe('zonas sin carretera (aviso de la franja, la ficha y la demanda)', () => {
  it('un solar a dos casillas de la carretera cuenta como «sin carretera»; uno al lado, no', () => {
    const s = createInitialState({ seed: 4 });
    // Una carretera horizontal en la fila 2 y zona I en las filas 3 y 4.
    for (let x = 1; x <= 5; x++) s.map.tiles[tileIndex(s, x, 2)] = Tile.Road;
    for (let x = 1; x <= 5; x++) for (const y of [3, 4]) s.map.zones[tileIndex(s, x, y)] = Zone.I;
    expect(zoneLotWithoutRoad(s, 2, 3)).toBe(false);
    expect(zoneLotWithoutRoad(s, 2, 4)).toBe(true);
    // Sin zona no hay aviso.
    expect(zoneLotWithoutRoad(s, 2, 6)).toBe(false);
    expect(zonesWithoutRoad(s)).toEqual({ R: 0, C: 0, I: 5, A: 0 });
  });

  it('el motor nunca construye en esos solares', () => {
    const s = createInitialState({ seed: 4 });
    s.demand.I = 100;
    // Zona I lejos de todo: ninguna carretera al lado.
    for (let x = 1; x <= 5; x++) for (let y = 1; y <= 3; y++) s.map.zones[tileIndex(s, x, y)] = Zone.I;
    const n = zonesWithoutRoad(s).I;
    expect(n).toBe(15);
    for (let i = 0; i < 24 * 20; i++) step(s);
    expect(s.buildings.some((b) => b.x >= 1 && b.x <= 5 && b.y >= 1 && b.y <= 3)).toBe(false);
  });
});
