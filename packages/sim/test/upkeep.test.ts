import { TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import { createInitialState, moneyDrift, Tile, upkeepMonth, upkeepOf, UPKEEP } from '../src/index.ts';

/** 2.6 (bloque D): gasto corriente que crece con el pueblo. */
describe('gasto corriente (2.6)', () => {
  const town = (level: number, months: number) => {
    const s = createInitialState({ seed: 3 });
    s.townhallLevel = level;
    s.tick = months * TICKS_PER_MONTH;
    while (s.citizens.length < 100) s.citizens.push({ ...s.citizens[0]!, id: 9000 + s.citizens.length });
    return s;
  };

  it('el primer año no cuesta nada (el principio de partida no se endurece)', () => {
    const u = upkeepOf(town(5, 11));
    expect(u).toEqual({ general: 0, roads: 0, houses: 0 });
  });

  it('crece con el nivel del ayuntamiento y entra entero al tercer año', () => {
    const [from, full] = UPKEEP.rampMonths;
    const mid = Math.round((from + full) / 2);
    expect(upkeepOf(town(4, full)).general).toBe(UPKEEP.perCitizen[4]! * 100);
    expect(upkeepOf(town(4, mid)).general).toBe(Math.round((UPKEEP.perCitizen[4]! * 100) / 2));
    expect(upkeepOf(town(5, full)).general).toBeGreaterThan(upkeepOf(town(3, full)).general);
    expect(upkeepOf(town(1, full)).general).toBe(0);
  });

  it('las calles de más y las casas municipales de más cuestan al mes', () => {
    const s = town(3, 40);
    const roads = s.map.tiles.filter((t) => t === Tile.Road).length;
    let extra = 0;
    for (let i = 0; i < s.map.tiles.length && extra < 10; i++) {
      if (s.map.tiles[i] === Tile.Grass) {
        s.map.tiles[i] = Tile.Road;
        extra++;
      }
    }
    expect(upkeepOf(s).roads).toBe(Math.max(0, roads + 10 - UPKEEP.freeRoads) * UPKEEP.road);
    const proto = { kind: 'house' as const, x: 0, y: 0, owner: 0, cash: 0, built: true, hasWater: true, hasPower: true, unpaidMonths: 0 };
    for (let i = 0; i < UPKEEP.freeHouses + 2; i++) s.buildings.push({ ...proto, id: 8000 + i });
    const houses = s.buildings.filter((b) => b.kind === 'house' && b.owner === 0).length;
    expect(upkeepOf(s).houses).toBe((houses - UPKEEP.freeHouses) * UPKEEP.municipalHouse);
  });

  it('el gasto sale de la caja hacia fuera y queda en el parte', () => {
    const s = town(4, 48);
    const before = s.treasury;
    const drift = moneyDrift(s);
    s.upkeepFrom = 0; // partida de la 2.6: el gasto se cobra desde el principio
    const u = upkeepOf(s);
    upkeepMonth(s);
    expect(s.treasury).toBe(before - u.general - u.roads - u.houses);
    expect(s.month.breakdown['servicios generales']).toBe(-u.general);
    expect(moneyDrift(s)).toBe(drift);
  });
});

describe('gasto corriente en partidas de antes de la 2.6', () => {
  it('una partida que ya pasa del mes 36 no lo paga de golpe: la rampa empieza al primer cobro', async () => {
    const { runSimulation, upkeepOf, upkeepMonth } = await import('../src/index.ts');
    const { state } = runSimulation({ seed: 3, days: 1200, profile: 'constructor', checkEveryDay: false });
    delete (state as { upkeepFrom?: number }).upkeepFrom;
    upkeepMonth(state);
    const u = upkeepOf(state);
    expect(u.general + u.roads + u.houses).toBe(0);
    expect(state.upkeepFrom).toBe(Math.floor(state.tick / TICKS_PER_MONTH));
  }, 120_000);
});
