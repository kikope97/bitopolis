import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  attraction,
  checkInvariants,
  complainCandidates,
  createInitialState,
  expectedVisitors,
  factionOf,
  type GameState,
  grievanceOf,
  happinessFactors,
  hashState,
  heritageVariant,
  moneyDrift,
  monthlyHousing,
  monthRates,
  OUTSIDE,
  transfer,
  TREASURY,
  newBuilding,
  openRural,
  PRIVATE_RENT,
  protectedAt,
  ruralCandidates,
  runSimulation,
  Terrain,
  TOURISM,
  tourismMonth,
  touristified,
  tvReportCandidate,
  applyTvReport,
  updateFactions,
  validateCommand,
  Zone,
} from '../src/index.ts';

/** Pueblo con vecinos de sobra y el ayuntamiento de nivel 3 (el patrimonio ya se puede construir). */
function town(seed = 7, pop = 45): GameState {
  const s = createInitialState({ seed });
  s.townhallLevel = 3;
  transfer(s, OUTSIDE, TREASURY, 50_000);
  const base = s.citizens[0]!;
  while (s.citizens.length < pop) s.citizens.push({ ...structuredClone(base), id: s.nextId++, name: `Vecino ${s.nextId}`, named: false, money: 0, homeId: null, jobId: null, owns: false });
  return s;
}

function spot(s: GameState, kind: 'heritage' | 'water' = 'heritage'): { x: number; y: number } {
  for (let y = 0; y < s.map.h; y++) for (let x = 0; x < s.map.w; x++) if (validateCommand(s, { type: 'Build', kind, x, y }).ok) return { x, y };
  throw new Error('sin sitio');
}

/** Patrimonio terminado (sin esperar la obra). */
function withHeritage(s: GameState) {
  const at = spot(s);
  expect(applyCommand(s, { type: 'Build', kind: 'heritage', ...at }).ok).toBe(true);
  const h = s.buildings.find((b) => b.kind === 'heritage')!;
  h.built = true;
  s.projects = s.projects.filter((p) => p.buildingId !== h.id);
  return h;
}

/** Vivienda privada con su dueño dentro. */
function ownedHome(s: GameState, x: number, y: number, ambition = 80) {
  const b = newBuilding(s, 'res', x, y, -1);
  b.built = true;
  const c = s.citizens.find((v) => v.homeId === null && !v.owns) ?? s.citizens.at(-1)!;
  c.homeId = b.id;
  c.owns = true;
  transfer(s, OUTSIDE, c.id, 5_000);
  c.traits.ambicion = ambition;
  return { b, c };
}

describe('patrimonio (2.3)', () => {
  it('su forma sale del terreno: faro, molino, castillo o rollo', () => {
    const s = createInitialState({ seed: 1 });
    s.map.terrain = new Array(s.map.w * s.map.h).fill(Terrain.Flat);
    const at = (x: number, y: number, t: number) => (s.map.terrain![y * s.map.w + x] = t);
    expect(heritageVariant(s, 10, 10)).toBe('rollo');
    at(10, 10, Terrain.Hill);
    expect(heritageVariant(s, 10, 10)).toBe('castillo');
    at(11, 10, Terrain.River);
    expect(heritageVariant(s, 10, 10)).toBe('molino');
    at(10, 12, Terrain.Sea);
    expect(heritageVariant(s, 10, 10)).toBe('faro');
  });

  it('pide nivel 3 y 40 vecinos, y solo hay uno por partida', () => {
    const s = town(7, 30);
    expect(validateCommand(s, { type: 'Build', kind: 'heritage', x: 0, y: 0 }).ok).toBe(false);
    const few = validateCommand(s, { type: 'Build', kind: 'heritage', ...spot(s, 'water') });
    expect(few.ok ? '' : few.error).toContain('40 vecinos');
    const t = town(7, 45);
    t.townhallLevel = 2;
    const lvl = validateCommand(t, { type: 'Build', kind: 'heritage', ...spot(t, 'water') });
    expect(lvl.ok ? '' : lvl.error).toContain('nivel 3');
    t.townhallLevel = 3;
    withHeritage(t);
    const again = validateCommand(t, { type: 'Build', kind: 'heritage', ...spot(t, 'water') });
    expect(again.ok ? '' : again.error).toContain('ya tiene');
    expect(checkInvariants(t)).toEqual([]);
  });

  it('trae visitantes; la tasa los baja un 12 % por nivel y paga al ayuntamiento', () => {
    const s = town();
    expect(expectedVisitors(s)).toBe(0);
    withHeritage(s);
    expect(attraction(s).heritage).toBe(TOURISM.heritage.attract);
    const v0 = expectedVisitors(s);
    expect(v0).toBeGreaterThan(0);
    expect(applyCommand(s, { type: 'SetTouristTax', level: 2 }).ok).toBe(true);
    expect(validateCommand(s, { type: 'SetTouristTax', level: 2 }).ok).toBe(false);
    const v2 = expectedVisitors(s);
    expect(v2).toBe(Math.round(attraction(s).total * TOURISM.perAttract * (1 - 2 * TOURISM.taxDrop)));
    expect(v2).toBeLessThan(v0);
    const before = s.treasury;
    tourismMonth(s);
    expect(s.tourism.visitors).toBe(v2);
    expect(s.tourism.lastTax).toBe(v2 * 2 * TOURISM.nights);
    expect(s.treasury - before).toBe(s.tourism.lastTax);
    expect(s.month.breakdown['turismo']).toBe(s.tourism.lastTax);
    expect(moneyDrift(s)).toBe(0);
  });

  it('el reportaje de la tele multiplica los visitantes un mes', () => {
    const s = town();
    withHeritage(s);
    const v = expectedVisitors(s);
    expect(tvReportCandidate(s)).toBe(true);
    applyTvReport(s);
    expect(tvReportCandidate(s)).toBe(false);
    expect(v).toBe(Math.round(attraction(s).total * TOURISM.perAttract));
    expect(expectedVisitors(s)).toBe(Math.round(attraction(s).total * TOURISM.perAttract * TOURISM.tvReport));
  });
});

describe('entorno protegido (2.3)', () => {
  it('sin zona I en el radio, atractivo ×1,3 y los empresarios lo notan', () => {
    const s = town();
    const h = withHeritage(s);
    const near = { x: h.x + 2, y: h.y };
    s.map.zones[near.y * s.map.w + near.x] = Zone.I;
    const a0 = attraction(s).total;
    updateFactions(s);
    const boss = s.citizens.find((c) => factionOf(s, c) === 'empresarios');
    const sat0 = s.politics.factions.empresarios.satisfaction;
    expect(applyCommand(s, { type: 'ProtectArea', heritageId: h.id }).ok).toBe(true);
    expect(s.tourism.protectedId).toBe(h.id);
    expect(protectedAt(s, near.x, near.y)).toBe(true);
    expect(s.map.zones[near.y * s.map.w + near.x]).toBe(Zone.None);
    const z = validateCommand(s, { type: 'Zone', zone: 'I', x: near.x, y: near.y, w: 1, h: 1 });
    expect(z.ok ? '' : z.error).toContain('protegido');
    expect(validateCommand(s, { type: 'Zone', zone: 'R', x: near.x, y: near.y, w: 1, h: 1 }).ok).toBe(true);
    expect(attraction(s).total).toBeCloseTo(a0 * TOURISM.protect.attract, 0);
    if (boss) {
      updateFactions(s);
      expect(s.politics.factions.empresarios.satisfaction).toBe(Math.max(0, sat0 + TOURISM.protect.ownerMood));
    }
    // Otra vez: se levanta la protección.
    expect(applyCommand(s, { type: 'ProtectArea', heritageId: h.id }).ok).toBe(true);
    expect(s.tourism.protectedId).toBeUndefined();
    expect(validateCommand(s, { type: 'ProtectArea', heritageId: 1 }).ok).toBe(false);
  });
});

describe('casas rurales (2.3)', () => {
  it('el dueño gana por visitante con tope; con demasiadas, sube el alquiler y nace la queja «vivienda»', () => {
    const s = town();
    withHeritage(s);
    s.tourism.visitors = 200;
    s.tourism.avg = 200;
    const hall = s.buildings[0]!;
    const { b, c } = ownedHome(s, hall.x - 3, hall.y - 3);
    expect(ruralCandidates(s)).toContain(c);
    expect(openRural(s, c)).toBe(true);
    expect(b.rural).toBe(true);
    expect(ruralCandidates(s)).not.toContain(c);
    // Un inquilino en una vivienda privada junto a la casa rural.
    const flat = newBuilding(s, 'res', hall.x - 3, hall.y - 1, -1);
    flat.built = true;
    const renter = s.citizens.find((v) => v.homeId === null && !v.owns)!;
    renter.homeId = flat.id;
    transfer(s, OUTSIDE, renter.id, 5_000);
    expect(touristified(s)).toBe(true); // 1 de 2 viviendas
    expect(happinessFactors(s, renter).some((f) => f.value === TOURISM.touristified.renterMood)).toBe(true);
    expect(grievanceOf(s, renter)).toBe('vivienda');
    expect(complainCandidates(s)).toContain(renter);
    const money = c.money;
    tourismMonth(s);
    expect(s.tourism.lastRural).toBeGreaterThan(0);
    expect(s.tourism.lastRural).toBeLessThanOrEqual(TOURISM.rural.maxMonth);
    expect(c.money - money).toBe(s.tourism.lastRural);
    // El alquiler privado sube un 20 % mientras dura la turistificación.
    const paid = () => {
      const m = renter.money;
      monthlyHousing(s, monthRates(s));
      return m - renter.money;
    };
    const dear = paid();
    b.rural = false;
    const normal = paid();
    b.rural = true;
    expect(dear - normal).toBe(Math.round(PRIVATE_RENT * (1 + TOURISM.touristified.rent)) - PRIVATE_RENT);
    expect(checkInvariants(s)).toEqual([]);
    // Si el dueño se va, deja de ser casa rural.
    c.homeId = null;
    tourismMonth(s);
    expect(b.rural).toBe(false);
  });
});

describe('turismo en la partida (2.3)', () => {
  it('casual a 4 años: patrimonio, visitantes y menos del 15 % de casas rurales; determinista', () => {
    const a = runSimulation({ seed: 42, days: 1460, profile: 'casual' });
    expect(a.report.invariantErrors).toEqual([]);
    expect(a.report.moneyDrift).toBe(0);
    expect(a.state.buildings.some((b) => b.kind === 'heritage')).toBe(true);
    const last = a.report.tourism.at(-1)!;
    expect(last.visitors).toBeGreaterThan(300);
    expect(last.ruralPct).toBeLessThan(15);
    const b = runSimulation({ seed: 42, days: 1460, profile: 'casual' });
    expect(hashState(b.state)).toBe(hashState(a.state));
  }, 600_000);
});
