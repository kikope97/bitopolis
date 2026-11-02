import { FIRE } from './balance.ts';
import { levelOf, radiusOf } from './levels.ts';
import { type Building, type GameState, terrainAt } from './state.ts';
import { Terrain } from './terrain.ts';

/**
 * 2.6 «Lo básico»: el predicado único del alcance de un servicio por radio.
 * Lo usan la carga de los servicios (`serviceLoads`), las comisarías
 * (`stationsFor`), los bomberos (`fireStationsFor`), la felicidad, «Qué falta»
 * (`missingServices`) y la ficha (`coverageOf`): todos dicen lo mismo.
 * Sin dependencias de economía ni de la simulación (no crea ciclos).
 */
export const manhattan = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** ¿Llega el servicio `s` a la casilla (x, y)? Rombo de `radiusOf` desde su casilla de origen; en la colina, los bomberos solo con cisterna. */
export function reaches(state: GameState, s: Building, x: number, y: number): boolean {
  if (!s.built || s.damaged) return false;
  const r = radiusOf(s);
  if (!r || Math.abs(s.x - x) + Math.abs(s.y - y) > r) return false;
  if (s.kind === 'firestation' && levelOf(s) < FIRE.hillLevel && terrainAt(state, x, y) === Terrain.Hill) return false;
  return true;
}

/** De los que llegan, el que atiende de verdad: el más cercano (a igual distancia, el de id menor), como en `serviceLoads`. */
export function servingOf<T extends { id: number; x: number; y: number }>(list: readonly T[], x: number, y: number): T | undefined {
  let best: T | undefined;
  let bd = Infinity;
  for (const s of list) {
    const d = Math.abs(s.x - x) + Math.abs(s.y - y);
    if (d < bd || (d === bd && best && s.id < best.id)) {
      best = s;
      bd = d;
    }
  }
  return best;
}

/** Casillas del rombo de radio `r` alrededor de (x, y) dentro del mapa (índices y·w + x). */
export function diamondTiles(state: GameState, x: number, y: number, r: number): number[] {
  const { w, h } = state.map;
  const out: number[] = [];
  for (let ty = Math.max(0, y - r); ty <= Math.min(h - 1, y + r); ty++) {
    const left = r - Math.abs(ty - y);
    for (let tx = Math.max(0, x - left); tx <= Math.min(w - 1, x + left); tx++) out.push(ty * w + tx);
  }
  return out;
}
