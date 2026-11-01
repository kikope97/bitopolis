import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  applyDonation,
  bridgeFloodFx,
  checkInvariants,
  createInitialState,
  donorCandidates,
  type GameState,
  hashState,
  LANDMARKS,
  landmarkMood,
  landmarkProgress,
  landmarkSpot,
  landmarksDay,
  landmarksMonth,
  moneyDrift,
  OUTSIDE,
  phaseCost,
  stationDemandR,
  step,
  Terrain,
  transfer,
  TREASURY,
  validateCommand,
} from '../src/index.ts';

const days = (s: GameState, n: number) => {
  for (let i = 0; i < n * TICKS_PER_DAY; i++) step(s);
};

/** Pueblo de prueba: ayuntamiento 3, `pop` vecinos contentos (sin dinero: no se crea de la nada) y caja. */
function town(pop = 70, cash = 100_000, seed = 5): GameState {
  const s = createInitialState({ seed });
  s.townhallLevel = 3;
  const base = s.citizens[0]!;
  while (s.citizens.length < pop) s.citizens.push({ ...structuredClone(base), id: s.nextId++, money: 0, homeId: null, jobId: null, named: false, flow: [0, 0] });
  for (const c of s.citizens) c.happiness = 70;
  transfer(s, OUTSIDE, TREASURY, cash, 'subvenciones');
  return s;
}

/** Los vecinos de prueba no tienen casa: se les devuelve la alegría antes de pagar otra fase. */
const happy = (s: GameState) => {
  for (const c of s.citizens) c.happiness = 70;
};

const hall = (s: GameState) => s.buildings.find((b) => b.kind === 'townhall')!;

function startStation(s: GameState) {
  const at = landmarkSpot(s, 'station', hall(s))!;
  expect(applyCommand(s, { type: 'StartLandmark', kind: 'station', ...at })).toEqual({ ok: true });
  return s.landmarks.at(-1)!;
}

describe('grandes obras por fases (2.3)', () => {
  it('pide vecinos, felicidad, nivel del ayuntamiento y caja, y lo explica', () => {
    const s = town(20, 0);
    const at = landmarkSpot(s, 'station', hall(s))!;
    expect(validateCommand(s, { type: 'StartLandmark', kind: 'station', ...at })).toEqual({ ok: false, error: expect.stringMatching(/60 vecinos \(tienes 20\)/) });
    const t = town(70, 0);
    transfer(t, TREASURY, OUTSIDE, t.treasury - 1_000, 'obras');
    expect(validateCommand(t, { type: 'StartLandmark', kind: 'station', ...at })).toEqual({ ok: false, error: expect.stringMatching(/en caja/) });
    const u = town(70);
    for (const c of u.citizens) c.happiness = 40;
    expect(validateCommand(u, { type: 'StartLandmark', kind: 'station', ...at })).toEqual({ ok: false, error: expect.stringMatching(/felicidad/) });
    u.townhallLevel = 2;
    expect(validateCommand(u, { type: 'StartLandmark', kind: 'station', ...at })).toEqual({ ok: false, error: expect.stringMatching(/ayuntamiento de nivel 3/) });
    // La catedral, más adelante.
    expect(validateCommand(town(200), { type: 'StartLandmark', kind: 'cathedral', ...at })).toEqual({ ok: false, error: expect.stringMatching(/más adelante/) });
  });

  it('empezar marca un solar 2×2 y la Diputación ofrece cofinanciarla; cada fase es una obra', () => {
    const s = town();
    const lm = startStation(s);
    const b = s.buildings.find((x) => x.id === lm.buildingId)!;
    expect(b.size).toBe(2);
    expect(b.built).toBe(false);
    expect(lm).toMatchObject({ phase: 0, phases: 3, phaseUntil: -1, spent: 0 });
    // Ocupa las 4 casillas y no se puede repetir.
    expect(validateCommand(s, { type: 'Build', kind: 'house', x: b.x + 1, y: b.y + 1 })).toEqual({ ok: false, error: 'Ese sitio está ocupado' });
    expect(validateCommand(s, { type: 'StartLandmark', kind: 'station', x: 1, y: 1 })).toMatchObject({ ok: false, error: expect.stringMatching(/Ya hay/) });
    const g = s.grants.find((x) => x.landmark === lm.id)!;
    expect(g.status).toBe('offered');
    expect(g.share).toBeGreaterThanOrEqual(LANDMARKS.grant.shareMin);
    expect(g.share).toBeLessThanOrEqual(LANDMARKS.grant.shareMax);
    expect(applyCommand(s, { type: 'AnswerGrant', grantId: g.id, accept: true }).ok).toBe(true);
    const before = s.treasury;
    const cost = phaseCost(s, lm);
    expect(applyCommand(s, { type: 'FundLandmarkPhase', id: lm.id })).toEqual({ ok: true });
    const help = Math.round(cost * g.share);
    expect(s.treasury).toBe(before - cost + help);
    expect(lm.spent).toBe(cost - help);
    expect(s.projects.some((p) => p.buildingId === b.id)).toBe(true);
    // Mientras dura la fase, no se paga otra.
    expect(validateCommand(s, { type: 'FundLandmarkPhase', id: lm.id })).toMatchObject({ ok: false, error: expect.stringMatching(/sigue en obra/) });
    days(s, LANDMARKS.specs.station.days + 2);
    expect(lm.phase).toBe(1);
    expect(lm.phaseUntil).toBe(-1);
    expect(b.built).toBe(true);
    // Cada fase ya da su parte del efecto.
    expect(landmarkProgress(s, 'station')).toBeCloseTo(1 / 3);
    expect(stationDemandR(s)).toBe(Math.round(LANDMARKS.effects.station.demandR / 3));
    // La fase 2 (con el edificio ya en pie, la obra sigue: el invariante lo admite).
    happy(s);
    expect(validateCommand(s, { type: 'FundLandmarkPhase', id: lm.id })).toEqual({ ok: true });
    expect(applyCommand(s, { type: 'FundLandmarkPhase', id: lm.id }).ok).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
    days(s, LANDMARKS.specs.station.days + 2);
    expect(lm.phase).toBe(2);
    expect(moneyDrift(s)).toBe(0);
  });

  it('nunca se paga una fase con descubierto y, entre fases, parada no pierde nada', () => {
    const s = town();
    const lm = startStation(s);
    transfer(s, TREASURY, OUTSIDE, s.treasury - phaseCost(s, lm) + 1, 'obras');
    expect(validateCommand(s, { type: 'FundLandmarkPhase', id: lm.id })).toMatchObject({ ok: false, error: expect.stringMatching(/en caja/) });
    transfer(s, OUTSIDE, TREASURY, 50_000, 'subvenciones');
    expect(applyCommand(s, { type: 'FundLandmarkPhase', id: lm.id }).ok).toBe(true);
    // Parar: la cuadrilla se va (sin sueldos ni avance) hasta reanudar.
    expect(applyCommand(s, { type: 'PauseLandmark', id: lm.id }).ok).toBe(true);
    const p = s.projects.find((x) => x.buildingId === lm.buildingId)!;
    expect(p.workersNeeded).toBe(0);
    const done = p.workerDaysDone;
    days(s, 20);
    expect(p.workerDaysDone).toBe(done);
    expect(lm.phase).toBe(0);
    expect(applyCommand(s, { type: 'PauseLandmark', id: lm.id }).ok).toBe(true);
    days(s, LANDMARKS.specs.station.days + 2);
    expect(lm.phase).toBe(1);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('mantenimiento: el 0,5 % de lo gastado al mes', () => {
    const s = town();
    const lm = startStation(s);
    lm.spent = 20_000;
    s.aiMode = true;
    const before = s.treasury;
    landmarksMonth(s);
    expect(before - s.treasury).toBe(Math.round(20_000 * LANDMARKS.upkeep));
  });

  it('el puente de piedra va sobre el río (no encima de un puente de carretera) y frena las riadas', () => {
    const s = town(50);
    const river: { x: number; y: number }[] = [];
    for (let y = 0; y < s.map.h; y++) for (let x = 0; x < s.map.w; x++) if (s.map.terrain![y * s.map.w + x] === Terrain.River) river.push({ x, y });
    expect(river.length).toBeGreaterThan(0);
    expect(validateCommand(s, { type: 'StartLandmark', kind: 'bridge', x: hall(s).x + 3, y: hall(s).y })).toMatchObject({ ok: false, error: expect.stringMatching(/río|ocupado/) });
    // Una calle hasta la orilla y el puente al lado.
    const r = river[Math.floor(river.length / 2)]!;
    const land = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: r.x + dx!, y: r.y + dy! })).find((t) => s.map.terrain![t.y * s.map.w + t.x] !== Terrain.River)!;
    s.map.tiles[land.y * s.map.w + land.x] = 1;
    expect(applyCommand(s, { type: 'StartLandmark', kind: 'bridge', x: r.x, y: r.y })).toEqual({ ok: true });
    const lm = s.landmarks.at(-1)!;
    expect(s.buildings.find((b) => b.id === lm.buildingId)!.size).toBeUndefined();
    expect(bridgeFloodFx(s)).toBe(1);
    lm.phase = 3;
    s.buildings.find((b) => b.id === lm.buildingId)!.built = true;
    expect(bridgeFloodFx(s)).toBe(1 - LANDMARKS.effects.bridge.floodCut);
  });

  it('el estadio alegra a 12 casillas; derribada, la obra desaparece', () => {
    const s = town(130);
    s.townhallLevel = 4;
    const at = landmarkSpot(s, 'stadium', hall(s))!;
    expect(applyCommand(s, { type: 'StartLandmark', kind: 'stadium', ...at }).ok).toBe(true);
    const lm = s.landmarks.at(-1)!;
    lm.phase = 3;
    s.buildings.find((b) => b.id === lm.buildingId)!.built = true;
    expect(landmarkMood(s, at)).toEqual([{ label: 'Estadio cerca', value: LANDMARKS.effects.stadium.happiness }]);
    expect(landmarkMood(s, { x: at.x + 30, y: at.y })).toEqual([]);
    expect(applyCommand(s, { type: 'Demolish', x: at.x + 1, y: at.y + 1 }).ok).toBe(true);
    landmarksDay(s);
    expect(s.landmarks).toEqual([]);
  });

  it('donaciones: 2 % de los ahorros, solo de quien no es ahorrador y está contento; el dinero se conserva', () => {
    const s = town();
    const lm = startStation(s);
    const c = s.citizens[0]!;
    transfer(s, c.id, OUTSIDE, c.money, 'otros');
    transfer(s, OUTSIDE, c.id, 5_000, 'otros');
    c.traits.ahorro = 20;
    c.happiness = 80;
    const who = donorCandidates(s, lm.id);
    expect(who).toContainEqual({ citizenId: c.id, amount: 100 });
    const before = s.treasury;
    expect(applyDonation(s, c.id, lm.id)).toBe(100);
    expect(s.treasury).toBe(before + 100);
    c.traits.ahorro = 90;
    expect(applyDonation(s, c.id, lm.id)).toBe(0);
    expect(moneyDrift(s)).toBe(0);
  });

  it('determinista: mismos comandos, mismo hash', () => {
    const run = () => {
      const s = town();
      const lm = startStation(s);
      applyCommand(s, { type: 'FundLandmarkPhase', id: lm.id });
      days(s, 40);
      return hashState(s);
    };
    expect(run()).toBe(run());
    expect(TICKS_PER_MONTH).toBe(30 * TICKS_PER_DAY);
  });
});
