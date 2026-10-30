import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  BUILD_COST,
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
  it('rechaza construir sin carretera y cobra al construir', () => {
    const s = createInitialState({ seed: 1 });
    expect(applyCommand(s, { type: 'Build', kind: 'house', x: 0, y: 0 }).ok).toBe(false);
    const before = s.treasury;
    const cx = s.map.w / 2;
    const r = applyCommand(s, { type: 'Build', kind: 'house', x: cx + 2, y: s.map.h / 2 + 1 });
    expect(r.ok).toBe(true);
    expect(s.treasury).toBe(before - BUILD_COST.house);
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
  for (const profile of ['casual', 'constructor', 'agresivo']) {
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
