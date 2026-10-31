import { type GameState, inBounds, terrainAt } from './state.ts';
import { Terrain } from './terrain.ts';

/**
 * v1.8: nombre del barrio de un sitio, por lo que tiene cerca (el río, la
 * playa, la loma, el polígono) o por su posición respecto al ayuntamiento.
 * Determinista y sin estado: se recalcula cuando hace falta.
 */
export function barrioOf(state: GameState, x: number, y: number): string {
  const hall = state.buildings.find((b) => b.kind === 'townhall');
  const hx = hall?.x ?? Math.floor(state.map.w / 2);
  const hy = hall?.y ?? Math.floor(state.map.h / 2);
  if (Math.abs(x - hx) + Math.abs(y - hy) <= 3) return 'del Centro';
  const near = (t: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (inBounds(state, x + dx, y + dy) && terrainAt(state, x + dx, y + dy) === t) return true;
    return false;
  };
  if (near(Terrain.Sea, 3)) return 'de la Playa';
  if (near(Terrain.River, 3)) return 'del Río';
  if (near(Terrain.Hill, 2)) return 'de la Loma';
  if (state.buildings.some((b) => b.kind === 'factory' && Math.abs(b.x - x) + Math.abs(b.y - y) <= 4)) return 'del Polígono';
  const dx = x - hx;
  const dy = y - hy;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 'del Barrio Alto' : 'del Barrio Bajo';
  return dx > 0 ? 'de Levante' : 'de Poniente';
}
