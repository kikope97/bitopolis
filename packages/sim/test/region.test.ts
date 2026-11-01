import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  announceEre,
  applyCommand,
  bigFactory,
  bigFactorySpot,
  checkInvariants,
  createInitialState,
  ereCandidate,
  type GameState,
  hireCandidates,
  hireForBigCompany,
  landmarkSpot,
  moneyDrift,
  newBuilding,
  OUTSIDE,
  outsideJobsFx,
  phaseCost,
  REGION,
  regionMonth,
  step,
  transfer,
  TREASURY,
  validateCommand,
  Zone,
} from '../src/index.ts';

const days = (s: GameState, n: number) => {
  for (let i = 0; i < n * TICKS_PER_DAY; i++) step(s);
};

function town(pop = 90, cash = 100_000, seed = 5): GameState {
  const s = createInitialState({ seed });
  s.townhallLevel = 3;
  const base = s.citizens[0]!;
  while (s.citizens.length < pop) s.citizens.push({ ...structuredClone(base), id: s.nextId++, money: 0, homeId: null, jobId: null, named: false, flow: [0, 0] });
  for (const c of s.citizens) c.happiness = 70;
  transfer(s, OUTSIDE, TREASURY, cash, 'subvenciones');
  return s;
}

/** Fines de mes seguidos (solo la comarca). */
function months(s: GameState, n: number) {
  for (let i = 0; i < n; i++) {
    s.tick += TICKS_PER_MONTH;
    regionMonth(s);
  }
}

/** Zona industrial 2×2 junto a la calle del ayuntamiento, y luz. */
function industry(s: GameState) {
  const hall = s.buildings.find((b) => b.kind === 'townhall')!;
  const at = landmarkSpot(s, 'station', { x: hall.x + 6, y: hall.y })!;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [2, 1]] as const) s.map.zones[(at.y + dy) * s.map.w + at.x + dx] = Zone.I;
  const p = newBuilding(s, 'power', 0, 0, TREASURY);
  p.built = true;
  return at;
}

describe('ciclo comarcal (2.3)', () => {
  it('cada fase dura 18–36 meses, se avisa 2 meses antes y la siguiente sale de la cadena de Markov', () => {
    const s = town(20);
    const seen = new Set<string>();
    let warnedBefore = 0;
    let changes = 0;
    for (let m = 0; m < 360; m++) {
      const prev = s.region.phase;
      const until = s.region.until;
      const warned = s.region.warned;
      months(s, 1);
      seen.add(s.region.phase);
      if (s.region.phase !== prev) {
        changes++;
        if (warned || s.tick - TICKS_PER_MONTH >= until - REGION.warnMonths * TICKS_PER_MONTH) warnedBefore++;
        const len = (s.region.until - s.tick) / TICKS_PER_MONTH;
        expect(len).toBeGreaterThanOrEqual(REGION.minMonths);
        expect(len).toBeLessThanOrEqual(REGION.maxMonths);
      }
    }
    expect(seen).toEqual(new Set(['normal', 'bonanza', 'crisis']));
    expect(changes).toBeGreaterThan(3);
    expect(warnedBefore).toBe(changes);
    expect(s.events.some((e) => /Se está cociendo una crisis/.test(e.text))).toBe(true);
  });

  it('la fase mueve el trabajo de fuera', () => {
    const s = town(20);
    s.region.phase = 'crisis';
    expect(outsideJobsFx(s)).toBe(REGION.fx.crisis.jobsOutside);
    s.region.phase = 'bonanza';
    expect(outsideJobsFx(s)).toBe(REGION.fx.bonanza.jobsOutside);
  });

  it('en crisis, el FEDER paga el 60–70 % de las fases de la estación', () => {
    const s = town(70);
    s.region.until = s.tick + TICKS_PER_MONTH;
    s.region.warned = true;
    s.region.next = 'crisis';
    months(s, 1);
    expect(s.region.phase).toBe('crisis');
    const g = s.grants.find((x) => x.feder)!;
    expect(g).toMatchObject({ kind: 'station', federFor: 'station', status: 'offered' });
    expect(applyCommand(s, { type: 'AnswerGrant', grantId: g.id, accept: true }).ok).toBe(true);
    const at = landmarkSpot(s, 'station', s.buildings[0]!)!;
    expect(applyCommand(s, { type: 'StartLandmark', kind: 'station', ...at }).ok).toBe(true);
    const lm = s.landmarks[0]!;
    const before = s.treasury;
    const cost = phaseCost(s, lm);
    expect(applyCommand(s, { type: 'FundLandmarkPhase', id: lm.id }).ok).toBe(true);
    expect(before - s.treasury).toBe(cost - Math.round(cost * g.share));
    expect(g.share).toBeGreaterThanOrEqual(REGION.feder.shareMin);
    expect(moneyDrift(s)).toBe(0);
  });
});

describe('la gran empresa (2.3)', () => {
  it('con 80 vecinos, 6 casillas I y luz, llega la oferta; aceptada, una fábrica 2×2 que paga sueldos e IBI', () => {
    const s = town(90);
    months(s, 1);
    expect(s.bigCompany).toBeNull();
    industry(s);
    months(s, 1);
    expect(s.bigCompany).toMatchObject({ status: 'oferta', jobs: REGION.bigCompany.jobs });
    expect(validateCommand(s, { type: 'AnswerBigCompany', accept: true, incentive: 'ibi_bonificado' })).toEqual({ ok: true });
    const spot = bigFactorySpot(s)!;
    applyCommand(s, { type: 'AnswerBigCompany', accept: true, incentive: 'ibi_bonificado' });
    const b = bigFactory(s)!;
    expect(b).toMatchObject({ kind: 'bigfactory', size: 2, x: spot.x, y: spot.y, owner: OUTSIDE, built: false });
    expect(validateCommand(s, { type: 'AnswerBigCompany', accept: false, incentive: 'ninguno' })).toMatchObject({ ok: false });
    days(s, REGION.bigCompany.days + 3);
    expect(b.built).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
    // Contrata (por reglas, como cualquier empleo; o la IA con `contrata_vecinos`).
    const free = hireCandidates(s);
    expect(free.free).toBeGreaterThan(0);
    const before = s.treasury;
    for (const id of free.citizenIds.slice(0, 3)) expect(hireForBigCompany(s, id)).toBe(true);
    const w = s.citizens.find((c) => c.jobId === b.id)!;
    const money = w.money;
    s.tick = Math.ceil(s.tick / TICKS_PER_MONTH) * TICKS_PER_MONTH;
    regionMonth(s);
    expect(w.money).toBeGreaterThan(money);
    expect(s.treasury - before).toBe(Math.round(REGION.bigCompany.ibi * (1 - REGION.bigCompany.ibiDiscount)));
    expect(moneyDrift(s)).toBe(0);
  });

  it('en crisis avisa con 3 meses de un ERE o de que se va; el ERE deja la mitad', () => {
    const s = town(90);
    industry(s);
    months(s, 1);
    applyCommand(s, { type: 'AnswerBigCompany', accept: true, incentive: 'ninguno' });
    const b = bigFactory(s)!;
    b.built = true;
    s.projects = s.projects.filter((p) => p.buildingId !== b.id);
    expect(s.bigCompany!.jobs).toBe(REGION.bigCompany.jobsNoIncentive);
    expect(ereCandidate(s)).toEqual({ company: s.bigCompany!.name, jobs: REGION.bigCompany.jobsNoIncentive });
    expect(announceEre(s)).toBe(true);
    expect(s.bigCompany!.status).toBe('ere');
    expect(ereCandidate(s)).toBeNull();
    months(s, REGION.bigCompany.warnMonths);
    expect(b.staff).toBe(Math.round(REGION.bigCompany.jobsNoIncentive * REGION.bigCompany.ereKeep));
  });

  it('rechazarla: se van a otro pueblo', () => {
    const s = town(90);
    industry(s);
    months(s, 1);
    expect(applyCommand(s, { type: 'AnswerBigCompany', accept: false, incentive: 'ninguno' }).ok).toBe(true);
    expect(s.bigCompany!.status).toBe('rechazada');
    months(s, 3);
    expect(s.bigCompany!.status).toBe('rechazada');
  });
});
