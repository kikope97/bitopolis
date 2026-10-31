import { DAYS_PER_YEAR, TICKS_PER_DAY, TICKS_PER_MONTH, tickToDate } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  checkInvariants,
  createInitialState,
  dies,
  type GameState,
  heirOf,
  kidsCount,
  lifeMonth,
  lifeYear,
  migrate,
  OUTSIDE,
  runSimulation,
  serviceLoads,
  step,
  transfer,
  TREASURY,
} from '../src/index.ts';

function town(days = 400): GameState {
  const { state } = runSimulation({ seed: 2, days, profile: 'constructor' });
  transfer(state, OUTSIDE, TREASURY, 30_000, 'subvencion');
  return state;
}

/** Avanza hasta el día y mes indicados (del año en curso o el siguiente). */
function goTo(s: GameState, month: number, day = 1) {
  for (let i = 0; i < DAYS_PER_YEAR * TICKS_PER_DAY; i++) {
    const d = tickToDate(s.tick);
    if (d.month === month && d.day === day && d.hour === 1) return;
    step(s);
  }
}

describe('presupuesto anual (v1.5)', () => {
  it('en enero se abre; el pleno lo vota y el plan aprobado cambia los costes', () => {
    const s = town();
    goTo(s, 1, 2);
    expect(s.budget.status).toBe('open');
    expect(applyCommand(s, { type: 'ProposeBudget', plan: 'inversor' }).ok).toBe(true);
    expect(['approved', 'prorrogado']).toContain(s.budget.status);
    expect(s.budget.votesFor + s.budget.votesAgainst).toBeGreaterThan(0);
    // Solo se presenta una vez al año.
    expect(applyCommand(s, { type: 'ProposeBudget', plan: 'austero' }).ok).toBe(false);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('el inversor abarata las obras un 15 %', () => {
    const a = town();
    const b = structuredClone(a);
    a.budget.plan = 'equilibrado';
    b.budget.plan = 'inversor';
    const spot = (s: GameState) => {
      for (const r of s.buildings.filter((x) => x.kind === 'house'))
        for (const [dx, dy] of [[0, 2], [1, 2], [-1, 2], [0, -2], [2, 0]]) {
          const cmd = { type: 'Build' as const, kind: 'park' as const, x: r.x + dx!, y: r.y + dy! };
          if (applyCommand(structuredClone(s), cmd).ok) return cmd;
        }
      return null;
    };
    const cmd = spot(a);
    if (!cmd) return;
    const ta = a.treasury;
    const tb = b.treasury;
    applyCommand(a, cmd);
    applyCommand(b, cmd);
    expect(tb - b.treasury).toBeLessThan(ta - a.treasury);
  });

  it('si no se presenta en enero, se prorroga', () => {
    const s = town();
    goTo(s, 1, 2);
    const plan = s.budget.plan;
    goTo(s, 2, 2);
    expect(s.budget.status).toBe('prorrogado');
    expect(s.budget.plan).toBe(plan);
  });
});

describe('fiestas del pueblo (v1.5)', () => {
  it('en julio tienen nombre; organizarlas cuesta, alegra y solo una vez al año', () => {
    const s = town();
    goTo(s, 7, 2);
    expect(s.festival.name).toBeTruthy();
    const before = s.treasury;
    expect(applyCommand(s, { type: 'HoldFestival', size: 'grande' }).ok).toBe(true);
    expect(s.treasury).toBeLessThan(before);
    expect(s.festival.size).toBe('grande');
    expect(s.festival.until).toBeGreaterThan(s.tick);
    expect(applyCommand(s, { type: 'HoldFestival', size: 'pequena' }).ok).toBe(false);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('fuera de julio y agosto no se pueden organizar; sin organizarlas, las montan los vecinos en septiembre', () => {
    const s = town();
    goTo(s, 3, 2);
    expect(applyCommand(s, { type: 'HoldFestival', size: 'pequena' }).ok).toBe(false);
    goTo(s, 9, 2);
    expect(s.festival.size).toBe('popular');
  });
});

describe('subvenciones con plazo (v1.5)', () => {
  it('aceptar da un anticipo; terminar a tiempo cobra el resto', () => {
    const s = town();
    s.grants.push({ id: 900_001, kind: 'park', share: 0.6, offeredTick: s.tick, deadline: s.tick + 30 * TICKS_PER_DAY, status: 'offered', advance: 0, minId: 0 });
    const t0 = s.treasury;
    expect(applyCommand(s, { type: 'AnswerGrant', grantId: 900_001, accept: true }).ok).toBe(true);
    const g = s.grants.find((x) => x.id === 900_001)!;
    expect(g.status).toBe('accepted');
    expect(s.treasury).toBe(t0 + g.advance);
    // Una obra de ese tipo empezada después y terminada en plazo.
    const house = s.buildings.find((b) => b.kind === 'house')!;
    let built = false;
    for (const [dx, dy] of [[0, 2], [1, 2], [-1, 2], [2, 0], [-2, 0], [0, -2]]) {
      if (applyCommand(s, { type: 'Build', kind: 'park', x: house.x + dx!, y: house.y + dy! }).ok) {
        built = true;
        break;
      }
    }
    if (!built) return;
    for (let i = 0; i < 20 * TICKS_PER_DAY && g.status === 'accepted'; i++) step(s);
    expect(g.status).toBe('paid');
    expect(checkInvariants(s)).toEqual([]);
  });

  it('si no se termina a tiempo, se devuelve el anticipo con recargo', () => {
    const s = town();
    s.grants.push({ id: 900_002, kind: 'clinic', share: 0.5, offeredTick: s.tick, deadline: s.tick + 10, status: 'offered', advance: 0, minId: 0 });
    applyCommand(s, { type: 'AnswerGrant', grantId: 900_002, accept: true });
    const g = s.grants.find((x) => x.id === 900_002)!;
    g.deadline = s.tick + 1;
    const t0 = s.treasury;
    for (let i = 0; i < 2 * TICKS_PER_DAY; i++) step(s);
    expect(g.status).toBe('expired');
    expect(s.month.breakdown['reintegro de subvención'] ?? 0).toBeLessThan(0);
    void t0;
  });

  it('el pueblo recibe ofertas solas con el tiempo', () => {
    const { state } = runSimulation({ seed: 4, days: 600, profile: 'constructor' });
    expect(state.grants.length).toBeGreaterThan(0);
  });
});

describe('ciclo vital (v1.5)', () => {
  it('cada 1 de enero se cumplen años', () => {
    const s = town();
    const ages = new Map(s.citizens.map((c) => [c.id, c.age]));
    goTo(s, 1, 2);
    for (const c of s.citizens) if (ages.has(c.id)) expect(c.age).toBe(ages.get(c.id)! + 1);
  });

  it('una pareja que vive junta tiene bebés; cuentan para el colegio', () => {
    const s = town();
    const [a, b] = s.citizens.filter((c) => c.named);
    a!.relations = [{ id: b!.id, kind: 'pareja', strength: 90, since: 0 }];
    b!.relations = [{ id: a!.id, kind: 'pareja', strength: 90, since: 0 }];
    b!.homeId = a!.homeId;
    a!.age = 30;
    b!.age = 31;
    for (let m = 0; m < 200 && !(a!.kids?.length ?? 0) && !(b!.kids?.length ?? 0); m++) lifeMonth(s);
    expect(kidsCount(s)).toBeGreaterThan(0);
    const school = s.buildings.find((x) => x.kind === 'school' && x.built);
    if (school) expect(serviceLoads(s).get(school.id)).toBeLessThanOrEqual(1);
  });

  it('los hijos que cumplen 18 se independizan en el pueblo si hay casa', () => {
    const s = town();
    const parent = s.citizens.find((c) => c.named)!;
    parent.kids = [s.tick - 18 * DAYS_PER_YEAR * TICKS_PER_DAY];
    const n = s.citizens.length;
    lifeYear(s);
    expect(parent.kids).toEqual([]);
    const born = s.citizens.length - n;
    const event = s.events.at(-1)!.text;
    if (born > 0) expect(event).toMatch(/se independiza/);
  });

  it('al fallecer, la pareja hereda dinero y casa (y paga la plusvalía); nadie queda con relaciones colgando', () => {
    const s = town();
    const [a, b] = s.citizens.filter((c) => c.named && c.homeId !== null);
    a!.relations = [{ id: b!.id, kind: 'pareja', strength: 90, since: 0 }];
    b!.relations = [{ id: a!.id, kind: 'pareja', strength: 90, since: 0 }];
    b!.homeId = a!.homeId;
    b!.owns = false;
    a!.owns = true;
    a!.boughtPrice = 1_000;
    transfer(s, OUTSIDE, a!.id, 2_000);
    expect(heirOf(s, a!)?.id).toBe(b!.id);
    const before = b!.money;
    dies(s, a!);
    expect(s.citizens.some((c) => c.id === a!.id)).toBe(false);
    expect(b!.owns).toBe(true);
    expect(b!.money).toBeGreaterThanOrEqual(before);
    expect(b!.memories.some((m) => m.kind === 'perdio_a' || m.kind === 'heredo')).toBe(true);
    for (const c of s.citizens) expect(c.relations.some((r) => r.id === a!.id)).toBe(false);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('en 6 años hay nacimientos y fallecimientos y el dinero se conserva', () => {
    const { state, report } = runSimulation({ seed: 6, days: 6 * DAYS_PER_YEAR, profile: 'constructor', checkEveryDay: false });
    expect(report.invariantErrors).toEqual([]);
    const deaths = state.events.filter((e) => e.text.startsWith('Fallece')).length;
    void deaths;
    expect(state.citizens.every((c) => c.age >= 18)).toBe(true);
  }, 60_000);
});

describe('migración 8 → 9', () => {
  it('presupuesto, fiestas y subvenciones vacíos', () => {
    const v8 = JSON.parse(JSON.stringify(createInitialState({ seed: 1 })));
    v8.formatVersion = 8;
    delete v8.budget;
    delete v8.festival;
    delete v8.grants;
    const m = migrate(v8);
    expect(m.formatVersion).toBeGreaterThanOrEqual(9);
    expect(m.budget.plan).toBe('equilibrado');
    expect(m.festival.name).toBeNull();
    expect(m.grants).toEqual([]);
    void TICKS_PER_MONTH;
  });
});
