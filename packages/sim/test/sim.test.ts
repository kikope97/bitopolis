import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  BUILD,
  buildCost,
  checkInvariants,
  createInitialState,
  hashState,
  nextU32,
  replay,
  runSimulation,
  seedRng,
  step,
} from '../src/index.ts';

describe('prng', () => {
  it('la misma semilla da la misma secuencia', () => {
    const a = seedRng(42);
    const b = seedRng(42);
    const sa = Array.from({ length: 50 }, () => nextU32(a));
    const sb = Array.from({ length: 50 }, () => nextU32(b));
    expect(sa).toEqual(sb);
    expect(new Set(sa).size).toBe(50);
  });
  it('semillas distintas divergen', () => {
    expect(nextU32(seedRng(1))).not.toBe(nextU32(seedRng(2)));
  });
});

describe('estado', () => {
  it('es JSON plano y sobrevive a un ida y vuelta', () => {
    const s = createInitialState({ seed: 7 });
    for (let i = 0; i < 24 * 40; i++) step(s);
    const copy = JSON.parse(JSON.stringify(s));
    expect(hashState(copy)).toBe(hashState(s));
    step(s);
    step(copy);
    expect(hashState(copy)).toBe(hashState(s));
  });
});

describe('comandos', () => {
  it('rechaza construir sin carretera y cobra los materiales al empezar la obra', () => {
    const s = createInitialState({ seed: 1 });
    expect(applyCommand(s, { type: 'Build', kind: 'house', x: 0, y: 0 }).ok).toBe(false);
    const before = s.treasury;
    const cx = s.map.w / 2;
    const r = applyCommand(s, { type: 'Build', kind: 'house', x: cx + 2, y: s.map.h / 2 + 1 });
    expect(r.ok).toBe(true);
    expect(s.treasury).toBe(before - BUILD.house.materials);
    expect(s.projects).toHaveLength(1);
    expect(buildCost('house')).toBeGreaterThan(BUILD.house.materials);
    expect(checkInvariants(s)).toEqual([]);
  });
  it('la obra termina aunque no haya obreros locales (se contratan fuera)', () => {
    const s = createInitialState({ seed: 1 });
    const cx = s.map.w / 2;
    applyCommand(s, { type: 'Build', kind: 'water', x: cx + 2, y: s.map.h / 2 + 1 });
    for (let i = 0; i < 24 * (BUILD.water.days + 1); i++) step(s);
    expect(s.projects).toHaveLength(0);
    expect(s.buildings.find((b) => b.kind === 'water')?.built).toBe(true);
    expect(s.events.some((e) => e.kind === 'built')).toBe(true);
  });
  it('las zonas se desbloquean con 10 vecinos', () => {
    const s = createInitialState({ seed: 1 });
    expect(applyCommand(s, { type: 'Zone', zone: 'R', x: 1, y: 1, w: 2, h: 2 }).ok).toBe(false);
  });
  it('carretera recta en un solo comando', () => {
    const s = createInitialState({ seed: 1 });
    expect(applyCommand(s, { type: 'BuildRoad', x: 2, y: 2, x2: 7, y2: 2 }).ok).toBe(true);
    expect(applyCommand(s, { type: 'BuildRoad', x: 2, y: 2, x2: 7, y2: 3 }).ok).toBe(false);
    expect(checkInvariants(s)).toEqual([]);
  });
  it('rechaza comandos mal formados', () => {
    const s = createInitialState({ seed: 1 });
    expect(applyCommand(s, { type: 'Hack', money: 1e9 }).ok).toBe(false);
    expect(applyCommand(s, { type: 'Build', kind: 'house', x: -1, y: 2 }).ok).toBe(false);
  });
  it('no se puede derribar el ayuntamiento', () => {
    const s = createInitialState({ seed: 1 });
    const hall = s.buildings[0]!;
    expect(applyCommand(s, { type: 'Demolish', x: hall.x, y: hall.y }).ok).toBe(false);
  });
});

describe('invariantes', () => {
  for (const profile of ['casual', 'constructor', 'agresivo', 'derrochador']) {
    it(`${profile}: el dinero se conserva 365 días`, () => {
      const { report } = runSimulation({ seed: 123, days: 365, profile, checkEveryDay: true });
      expect(report.invariantErrors).toEqual([]);
      expect(report.moneyDrift).toBe(0);
    });
  }
  it('semilla + comandos reproduce la partida', () => {
    const { state, report } = runSimulation({ seed: 9, days: 120, profile: 'constructor' });
    const again = replay(9, report.commands, state.tick);
    expect(hashState(again)).toBe(hashState(state));
  });
});

describe('golden', () => {
  it('snapshot del día 90 (seed 42, casual)', () => {
    const { report } = runSimulation({ seed: 42, days: 90, profile: 'casual' });
    expect({ hash: report.stateHash, final: report.final }).toMatchSnapshot();
  });
});

describe('rendimiento', () => {
  it('365 días simulados tardan menos de 10 s', () => {
    const t0 = performance.now();
    runSimulation({ seed: 5, days: 365, profile: 'constructor' });
    expect(performance.now() - t0).toBeLessThan(10_000);
  });
});

describe('economía', () => {
  it('el pueblo puede crecer', () => {
    const { report } = runSimulation({ seed: 42, days: 365, profile: 'casual' });
    expect(report.final.population).toBeGreaterThanOrEqual(10);
  });
  it('el pueblo puede quebrar', () => {
    const { report } = runSimulation({ seed: 42, days: 365, profile: 'derrochador' });
    expect(report.bankruptDay).not.toBeNull();
  });
  it('el impuesto efectivo es la media del mes (subirlo el último día no rinde)', () => {
    const base = createInitialState({ seed: 3 });
    const trick = createInitialState({ seed: 3 });
    for (let i = 0; i < 24 * 30 - 2; i++) {
      step(base);
      step(trick);
    }
    applyCommand(trick, { type: 'SetTax', level: 'high' });
    step(base);
    step(trick);
    step(base);
    step(trick);
    expect(trick.treasury - base.treasury).toBeLessThan(5);
  });
});
