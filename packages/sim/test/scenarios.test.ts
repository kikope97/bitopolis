import { describe, expect, it } from 'vitest';
import { TICKS_PER_MONTH } from '@bitopolis/shared';
import {
  aiByShare,
  checkInvariants,
  createInitialState,
  generateTerrain,
  hashState,
  replay,
  runSimulation,
  SCENARIOS,
  scenarioFx,
  scenarioStatus,
  seedRng,
  step,
  Terrain,
} from '../src/index.ts';
import { byShare } from '../src/resident.ts';

/** 2.3 (C): escenarios y mapas al empezar. */
const SCENARIO_IDS = ['libre', 'quiebra', 'vaciado', 'riada'] as const;
const SHAPES = ['aleatorio', 'rio', 'costa', 'colina', 'llano'] as const;

const count = (t: number[], v: number) => t.filter((x) => x === v).length;

describe('terreno con forma', () => {
  it('«aleatorio» es el mapa de siempre (mismos dados)', () => {
    for (const seed of [1, 2, 3, 42]) {
      expect(generateTerrain(seedRng(seed), 48, 48, 'aleatorio')).toEqual(generateTerrain(seedRng(seed), 48, 48));
    }
  });
  it('cada forma fuerza o quita costa, río y lomas; el centro siempre es llano', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const t = (shape: (typeof SHAPES)[number]) => generateTerrain(seedRng(seed), 48, 48, shape);
      const rio = t('rio');
      expect(count(rio, Terrain.River)).toBeGreaterThan(0);
      expect(count(rio, Terrain.Sea)).toBe(0);
      expect(count(t('costa'), Terrain.Sea)).toBeGreaterThan(0);
      const colina = t('colina');
      expect(count(colina, Terrain.Sea)).toBe(0);
      expect(count(colina, Terrain.Hill)).toBeGreaterThan(count(t('aleatorio'), Terrain.Hill));
      expect(t('llano').every((x) => x === Terrain.Flat)).toBe(true);
      for (const shape of SHAPES) {
        const m = t(shape);
        for (let y = 24 - 5; y <= 24 + 5; y++) for (let x = 24 - 7; x <= 24 + 7; x++) expect(m[y * 48 + x]).toBe(Terrain.Flat);
      }
    }
  });
  it('«Tras la riada» siempre tiene río, sea cual sea la forma', () => {
    for (const shape of SHAPES) {
      const s = createInitialState({ seed: 8, scenario: 'riada', terrain: shape });
      expect(count(s.map.terrain!, Terrain.River)).toBeGreaterThan(0);
    }
  });
});

describe('escenarios', () => {
  it('Libre y aleatorio por defecto: el mismo estado inicial y el mismo hash que antes', () => {
    for (const seed of [1, 7, 42]) {
      const a = createInitialState({ seed });
      const b = createInitialState({ seed, scenario: 'libre', terrain: 'aleatorio' });
      expect(hashState(b)).toBe(hashState(a));
      expect(a.citizens).toHaveLength(1);
      expect(a.buildings).toHaveLength(1);
      expect(a.treasury).toBe(30_000);
      expect(a.scenario).toEqual({ id: 'libre', done: true });
    }
  });
  it('cada escenario y terreno cuadra el dinero desde el tick 0 (y durante 2 meses)', () => {
    for (const scenario of SCENARIO_IDS) {
      for (const terrain of SHAPES) {
        const s = createInitialState({ seed: 5, scenario, terrain });
        expect(checkInvariants(s), `${scenario}/${terrain}`).toEqual([]);
        for (let t = 0; t < 2 * TICKS_PER_MONTH; t++) step(s);
        expect(checkInvariants(s), `${scenario}/${terrain} a los 2 meses`).toEqual([]);
      }
    }
  });
  it('misma semilla y escenario: mismo hash (y el replay con el mismo comienzo lo reproduce)', () => {
    for (const scenario of ['quiebra', 'vaciado', 'riada'] as const) {
      const a = runSimulation({ seed: 3, days: 120, profile: 'casual', scenario, terrain: 'rio' });
      const b = runSimulation({ seed: 3, days: 120, profile: 'casual', scenario, terrain: 'rio' });
      expect(b.report.stateHash).toBe(a.report.stateHash);
      expect(a.report.invariantErrors).toEqual([]);
      expect(hashState(replay(3, a.report.commands, a.state.tick, { scenario, terrain: 'rio' }))).toBe(a.report.stateHash);
      expect(hashState(createInitialState({ seed: 3, scenario }))).not.toBe(hashState(createInitialState({ seed: 3 })));
    }
  });
  it('Pueblo en quiebra: caja en negativo, vecinos resentidos y meta de superávit', () => {
    const s = createInitialState({ seed: 2, scenario: 'quiebra' });
    expect(s.treasury).toBe(SCENARIOS.quiebra.treasury);
    expect(s.citizens).toHaveLength(SCENARIOS.quiebra.citizens);
    expect(s.citizens.every((c) => c.grudge === SCENARIOS.quiebra.grudge && c.homeId !== null)).toBe(true);
    expect(s.debtMonths).toBe(SCENARIOS.quiebra.debtMonths);
    expect(s.townhallLevel).toBe(2);
    expect(s.scenario).toMatchObject({ id: 'quiebra', done: false, deadline: SCENARIOS.quiebra.deadlineMonths * TICKS_PER_MONTH, goal: { kind: 'superavit', target: 6 } });
    expect(scenarioStatus(s)?.monthsLeft).toBe(SCENARIOS.quiebra.deadlineMonths);
  });
  it('El pueblo que se vacía: mayores, casas vacías y demanda R baja el primer año', () => {
    const s = createInitialState({ seed: 2, scenario: 'vaciado' });
    expect(s.citizens).toHaveLength(SCENARIOS.vaciado.citizens);
    const old = s.citizens.filter((c) => c.age >= SCENARIOS.vaciado.ageMin && c.age <= SCENARIOS.vaciado.ageMax);
    expect(old).toHaveLength(SCENARIOS.vaciado.citizens - 1); // y Lucía, la administrativa
    const homes = s.buildings.reduce((n, b) => n + (b.kind === 'house' ? 3 : b.kind === 'res' ? 4 : 0), 0);
    expect(homes - s.citizens.length).toBe(SCENARIOS.vaciado.emptyHouses);
    expect(scenarioFx(s).demandR).toBe(SCENARIOS.vaciado.demandR);
    s.tick = SCENARIOS.vaciado.demandMonths * TICKS_PER_MONTH;
    expect(scenarioFx(s).demandR).toBe(0);
  });
  it('Tras la riada: edificios destrozados, ayuda de emergencia y riadas ×1,5 el primer año', () => {
    const s = createInitialState({ seed: 2, scenario: 'riada' });
    expect(s.buildings.filter((b) => b.damaged?.cause === 'riada')).toHaveLength(SCENARIOS.riada.damaged);
    // Nadie vive en una casa destrozada.
    const wrecked = new Set(s.buildings.filter((b) => b.damaged).map((b) => b.id));
    expect(s.citizens.every((c) => c.homeId !== null && !wrecked.has(c.homeId))).toBe(true);
    const g = s.grants.find((x) => x.emergency);
    expect(g).toMatchObject({ status: 'accepted', emergency: SCENARIOS.riada.grant, advance: SCENARIOS.riada.grant * SCENARIOS.riada.grantAdvance });
    expect(s.treasury).toBe(SCENARIOS.riada.treasury + g!.advance);
    expect(s.ledger.externalIn).toBe(g!.advance);
    expect(scenarioFx(s).flood).toBe(SCENARIOS.riada.floodFx);
  });
  it('cumplir da medalla y foto; sin hacer nada vence el plazo y sigue como Libre', () => {
    const won = runSimulation({ seed: 1, days: 30 * 18, profile: 'casual', scenario: 'vaciado' });
    expect(won.state.scenario).toMatchObject({ done: true, won: true });
    expect(won.state.medals.map((m) => m.id)).toContain('escenario:vaciado');
    expect(won.state.album.some((m) => m.kind === 'escenario_vaciado')).toBe(true);
    expect(scenarioStatus(won.state)).toBeNull();
    const lost = runSimulation({ seed: 1, days: 30 * 25, profile: 'pasivo', scenario: 'quiebra' });
    expect(lost.state.scenario).toMatchObject({ done: true, won: false });
    expect(lost.state.medals.some((m) => m.id === 'escenario:quiebra')).toBe(false);
    expect(lost.report.invariantErrors).toEqual([]);
  });
  it('la ayuda de la riada se cobra al reparar a tiempo y se devuelve con recargo si no', () => {
    const fixed = runSimulation({ seed: 2, days: 30 * 13, profile: 'casual', scenario: 'riada' });
    expect(fixed.state.grants.find((g) => g.emergency)?.status).toBe('paid');
    const idle = runSimulation({ seed: 2, days: 30 * 13, profile: 'pasivo', scenario: 'riada' });
    expect(idle.state.grants.find((g) => g.emergency)?.status).toBe('expired');
    expect(idle.state.stats.some((m) => 'reintegro de subvención' in m.breakdown)).toBe(true);
    expect(idle.report.invariantErrors).toEqual([]);
  });
  it('los vecinos de partida piensan con IA con la misma regla que los que llegan', () => {
    const s = createInitialState({ seed: 4, aiMode: true, aiShare: 50, scenario: 'quiebra' });
    for (let id = 1; id < 400; id++) expect(byShare(s, id)).toBe(aiByShare(s, id));
    expect(checkInvariants(s)).toEqual([]);
  });
});
