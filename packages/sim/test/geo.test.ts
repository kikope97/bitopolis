import { TICKS_PER_DAY, tickToDate } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  checkInvariants,
  createInitialState,
  flood,
  type GameState,
  migrate,
  OUTSIDE,
  riverBuildings,
  roadCost,
  runSimulation,
  seasonOf,
  step,
  TERRAIN,
  Terrain,
  Tile,
  transfer,
  TREASURY,
  validateCommand,
  validateCommand as v,
  weatherFx,
} from '../src/index.ts';

const idx = (s: GameState, x: number, y: number) => y * s.map.w + x;

describe('geografía (v1.7)', () => {
  it('el centro del pueblo siempre queda en llano y el terreno es determinista', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = createInitialState({ seed });
      const cx = Math.floor(s.map.w / 2);
      const cy = Math.floor(s.map.h / 2);
      for (let y = cy - 5; y <= cy + 5; y++) for (let x = cx - 7; x <= cx + 7; x++) expect(s.map.terrain[idx(s, x, y)]).toBe(Terrain.Flat);
      expect(createInitialState({ seed }).map.terrain).toEqual(s.map.terrain);
      // Nada de árboles en el agua.
      s.map.terrain.forEach((t, i) => {
        if (t === Terrain.River || t === Terrain.Sea) expect(s.map.tiles[i]).not.toBe(Tile.Tree);
      });
    }
  });

  it('la mayoría de pueblos tienen río y algunos, costa', () => {
    let rivers = 0;
    let seas = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const t = createInitialState({ seed }).map.terrain;
      if (t.includes(Terrain.River)) rivers++;
      if (t.includes(Terrain.Sea)) seas++;
    }
    expect(rivers).toBeGreaterThan(25);
    expect(seas).toBeGreaterThan(5);
    expect(seas).toBeLessThan(35);
  });

  it('en el río no se edifica, pero se puede tender un puente (más caro); en el mar, nada', () => {
    const s = createInitialState({ seed: 1 });
    transfer(s, OUTSIDE, TREASURY, 50_000, 'subvencion');
    const r = s.map.terrain.findIndex((t) => t === Terrain.River);
    const rx = r % s.map.w;
    const ry = Math.floor(r / s.map.w);
    expect(v(s, { type: 'Build', kind: 'house', x: rx, y: ry }).ok).toBe(false);
    expect(v(s, { type: 'Zone', zone: 'R', x: rx, y: ry, w: 1, h: 1 }).ok).toBe(false); // aún sin 10 vecinos
    expect(roadCost(s, rx, ry, rx, ry)).toBe(TERRAIN.bridgePerTile);
    const before = s.treasury;
    expect(applyCommand(s, { type: 'BuildRoad', x: rx, y: ry, x2: rx, y2: ry }).ok).toBe(true);
    expect(before - s.treasury).toBe(TERRAIN.bridgePerTile);
    expect(s.map.tiles[r]).toBe(Tile.Road);
    const sea = createInitialState({ seed: 4 });
    transfer(sea, OUTSIDE, TREASURY, 50_000, 'subvencion');
    const m = sea.map.terrain.findIndex((t) => t === Terrain.Sea);
    expect(validateCommand(sea, { type: 'BuildRoad', x: m % sea.map.w, y: Math.floor(m / sea.map.w), x2: m % sea.map.w, y2: Math.floor(m / sea.map.w) }).ok).toBe(false);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('en la colina los materiales cuestan un 50 % más', () => {
    const s = createInitialState({ seed: 1 });
    transfer(s, OUTSIDE, TREASURY, 50_000, 'subvencion');
    const h = s.map.terrain.findIndex((t, i) => t === Terrain.Hill && s.map.tiles[i] !== Tile.Road);
    const hx = h % s.map.w;
    const hy = Math.floor(h / s.map.w);
    // Carretera al lado para poder construir.
    s.map.tiles[idx(s, hx, hy + 1 < s.map.h ? hy + 1 : hy - 1)] = Tile.Road;
    const before = s.treasury;
    expect(applyCommand(s, { type: 'Build', kind: 'house', x: hx, y: hy }).ok).toBe(true);
    expect(before - s.treasury).toBe(Math.round(2_000 * TERRAIN.hillFactor));
  });
});

describe('estaciones y tiempo (v1.7)', () => {
  it('estaciones por mes', () => {
    expect(seasonOf(1)).toBe('invierno');
    expect(seasonOf(4)).toBe('primavera');
    expect(seasonOf(7)).toBe('verano');
    expect(seasonOf(10)).toBe('otono');
    expect(seasonOf(12)).toBe('invierno');
  });

  it('en un año hay de todo, sin nieve en verano ni calor en invierno, y el dinero se conserva', () => {
    const { state, report } = runSimulation({ seed: 5, days: 360, profile: 'constructor' });
    expect(report.invariantErrors).toEqual([]);
    void state;
    const s = createInitialState({ seed: 9 });
    const seen = new Map<string, Set<string>>();
    for (let i = 0; i < 360 * TICKS_PER_DAY; i++) {
      step(s);
      if (s.tick % TICKS_PER_DAY !== 1) continue;
      const season = seasonOf(tickToDate(s.tick).month);
      const set = seen.get(season) ?? new Set();
      set.add(s.weather.kind);
      seen.set(season, set);
    }
    expect(seen.get('verano')?.has('nieve')).toBeFalsy();
    expect(seen.get('invierno')?.has('calor')).toBeFalsy();
    const all = new Set([...seen.values()].flatMap((x) => [...x]));
    expect(all.size).toBeGreaterThanOrEqual(4);
  });

  it('con nieve las obras van a la mitad; con calor, la bomba da para menos', () => {
    const s = createInitialState({ seed: 1 });
    s.weather = { kind: 'nieve', until: s.tick + 10 * TICKS_PER_DAY };
    expect(weatherFx(s).build).toBe(0.5);
    s.weather = { kind: 'calor', until: s.tick + 10 * TICKS_PER_DAY };
    expect(weatherFx(s).water).toBeLessThan(1);
  });

  it('una tormenta puede anegar los edificios de la orilla; el ayuntamiento paga y el dinero se conserva', () => {
    let tested = 0;
    for (let seed = 1; seed <= 12 && tested < 2; seed++) {
      const { state: s } = runSimulation({ seed, days: 240, profile: 'constructor' });
      if (!riverBuildings(s).some((b) => b.built)) continue;
      transfer(s, OUTSIDE, TREASURY, 20_000, 'subvencion');
      const before = s.treasury;
      // Varias tormentas seguidas: alguna desborda el río.
      for (let k = 0; k < 10 && s.treasury === before; k++) flood(s);
      expect(s.treasury).toBeLessThan(before);
      expect(s.events.some((e) => e.text.startsWith('El río se desborda'))).toBe(true);
      expect(checkInvariants(s)).toEqual([]);
      tested++;
    }
    expect(tested).toBeGreaterThan(0);
  }, 60_000);
});

describe('migración 9 → 10', () => {
  it('los pueblos de antes quedan en llano y con tiempo despejado', () => {
    const v9 = JSON.parse(JSON.stringify(createInitialState({ seed: 1 })));
    v9.formatVersion = 9;
    delete v9.map.terrain;
    delete v9.weather;
    const m = migrate(v9);
    expect(m.formatVersion).toBeGreaterThanOrEqual(10);
    expect(m.map.terrain.every((t) => t === 0)).toBe(true);
    expect(m.map.terrain.length).toBe(m.map.w * m.map.h);
    expect(m.weather.kind).toBe('sol');
  });
});
