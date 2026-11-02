import { createInitialState, type GameState, newBuilding, OUTSIDE, Terrain, Tile, tileIndex, transfer, TREASURY, Zone } from '../packages/sim/src/index.ts';

/**
 * 2.6 «Lo básico»: pueblo de prueba para e2e/nucleo.spec.ts. Una calle (fila
 * `y`) con una bomba al principio y casas a los dos lados hasta pasarse de su
 * capacidad (`over` sin agua), sin central (sin luz), 4 solares de zona R en la
 * calle (no crecen: sin luz) y un hueco libre (`gap`) para poner y deshacer un parque.
 */
export const NUCLEO = { y: 30, x0: 6, lots: [30, 31, 32, 33], gap: 36, over: 4 };

export function nucleoTown(): GameState {
  const s = createInitialState({ seed: 4 });
  s.townhallLevel = 2;
  transfer(s, OUTSIDE, TREASURY, 30_000, 'subvencion');
  s.weather = { kind: 'sol', until: s.tick + 30 * 24 };
  const { y, x0, lots, gap, over } = NUCLEO;
  const x1 = 40;
  for (let x = 0; x < s.map.w; x++) for (let yy = y - 2; yy <= y + 2; yy++) s.map.terrain[tileIndex(s, x, yy)] = Terrain.Flat;
  for (let x = x0; x <= x1; x++) {
    s.map.tiles[tileIndex(s, x, y)] = Tile.Road;
    for (const yy of [y - 1, y + 1]) s.map.tiles[tileIndex(s, x, yy)] = Tile.Grass;
  }
  const pump = newBuilding(s, 'water', x0 - 1, y, TREASURY);
  pump.built = true;
  const capacity = 45;
  let n = 0;
  for (let x = x0; x <= x1 && n < capacity + over; x++) {
    for (const yy of [y - 1, y + 1]) {
      if (n >= capacity + over) break;
      if (yy === y + 1 && lots.includes(x)) continue;
      if (yy === y - 1 && x === gap) continue;
      const b = newBuilding(s, 'house', x, yy, TREASURY);
      b.built = true;
      n++;
    }
  }
  for (const x of lots) s.map.zones[tileIndex(s, x, y + 1)] = Zone.R;
  s.demand = { R: 40, C: 0, I: 0 };
  return s;
}
