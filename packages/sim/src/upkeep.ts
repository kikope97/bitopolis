import { TICKS_PER_MONTH } from '@bitopolis/shared';
import { HOMES, UPKEEP } from './balance.ts';
import { budgetFx } from './civic.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { type GameState, Tile } from './state.ts';
import { townLevel } from './townhall.ts';

/**
 * 2.6 (bloque D): gasto corriente que crece con el pueblo. Sin él, a media
 * partida los impuestos (que suben con los vecinos y el suelo) dejaban muy atrás
 * a un mantenimiento plano y la caja crecía sin freno.
 */

/** Gasto del mes por concepto (lo que cobra `upkeepMonth`, para el parte y las fichas). */
export function upkeepOf(state: GameState): { general: number; roads: number; houses: number } {
  const [from, full] = UPKEEP.rampMonths;
  const ramp = Math.max(0, Math.min(1, (state.tick / TICKS_PER_MONTH - from) / (full - from)));
  const fx = budgetFx(state).maintenance * ramp;
  const general = (UPKEEP.perCitizen[townLevel(state)] ?? 0) * state.citizens.length;
  let tiles = 0;
  for (const t of state.map.tiles) if (t === Tile.Road) tiles++;
  const roads = Math.max(0, tiles - UPKEEP.freeRoads) * UPKEEP.road;
  const houses = state.buildings.filter((b) => b.kind === 'house' && b.built && b.owner === TREASURY && (b.privateUnits ?? 0) < (HOMES.house ?? 0)).length;
  return {
    general: Math.round(general * fx),
    roads: Math.round(roads * fx),
    houses: Math.round(Math.max(0, houses - UPKEEP.freeHouses) * UPKEEP.municipalHouse * fx),
  };
}

export function upkeepMonth(state: GameState): void {
  const u = upkeepOf(state);
  transfer(state, TREASURY, OUTSIDE, u.general, 'servicios generales');
  transfer(state, TREASURY, OUTSIDE, u.roads, 'calles');
  transfer(state, TREASURY, OUTSIDE, u.houses, 'viviendas municipales');
}
