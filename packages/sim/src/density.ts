/**
 * 2.5 (bloque F): densidad de las zonas R (`map.density`, `SetZoneDensity`)
 * y vivienda protegida (`vpo`) con sorteo determinista. Números en `DENSITY` y `VPO`.
 */
import type { CommandResult } from './commands.ts';
import type { GameState } from './state.ts';

export function densityAt(state: GameState, x: number, y: number): number {
  return state.map.density?.[y * state.map.w + x] ?? 0;
}

export function canSetZoneDensity(state: GameState, x: number, y: number, w: number, h: number, level: number): CommandResult {
  void state;
  void x;
  void y;
  void w;
  void h;
  void level;
  return { ok: false, error: 'Aún no disponible' };
}

export function setZoneDensity(state: GameState, x: number, y: number, w: number, h: number, level: number): void {
  const { w: W, h: H } = state.map;
  if (!state.map.density) state.map.density = new Array(W * H).fill(0);
  for (let yy = y; yy < Math.min(H, y + h); yy++) for (let xx = x; xx < Math.min(W, x + w); xx++) state.map.density[yy * W + xx] = level;
}
