import { TICKS_PER_DAY } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  applyExcursion,
  busDemandR,
  checkInvariants,
  type Citizen,
  computeDemand,
  createInitialState,
  directorMenu,
  excursionCandidate,
  extraAction,
  type GameState,
  happinessFactors,
  JOBS_OUTSIDE,
  MAINTENANCE,
  newBuilding,
  newResident,
  OUTSIDE,
  riders,
  TRANSIT,
  transitJobs,
  transitMonth,
  transitRuleAction,
  transfer,
  TREASURY,
  turnMenu,
  validateCommand,
  CARE,
  BUILD,
  BUILD_NAMES,
} from '../src/index.ts';

function blank(seed = 5): GameState {
  const s = createInitialState({ seed });
  for (const c of s.citizens) transfer(s, c.id, OUTSIDE, c.money);
  s.citizens = [];
  s.townhallLevel = 3;
  return s;
}

function station(s: GameState) {
  const b = newBuilding(s, 'busstation', 20, 20, TREASURY);
  b.built = true;
  return b;
}

function people(s: GameState, n: number, age = 35, money = 1_000): Citizen[] {
  const out: Citizen[] = [];
  for (let i = 0; i < n; i++) {
    const c = newResident(s, { age });
    s.citizens.push(c);
    transfer(s, OUTSIDE, c.id, money);
    out.push(c);
  }
  return out;
}

describe('estación de autobuses (2.4)', () => {
  it('el billete solo se cambia con la estación construida, y solo hay una', () => {
    const s = blank();
    expect(validateCommand(s, { type: 'SetBusFare', fare: 'caro' }).ok).toBe(false);
    station(s);
    expect(validateCommand(s, { type: 'SetBusFare', fare: 'normal' }).ok).toBe(false); // ya está
    expect(applyCommand(s, { type: 'SetBusFare', fare: 'caro' }).ok).toBe(true);
    expect(s.transit.fare).toBe('caro');
    s.citizens.push(...Array.from({ length: 40 }, () => newResident(s, { age: 30 })));
    const r = validateCommand(s, { type: 'Build', kind: 'busstation', x: 24, y: 24 });
    expect(r.ok).toBe(false);
  });

  it('con estación se encuentra y se conserva mejor el trabajo de fuera, y viene más gente', () => {
    const s = blank();
    people(s, 3);
    expect(transitJobs(s)).toEqual({ find: JOBS_OUTSIDE.findChance, lose: JOBS_OUTSIDE.loseChance });
    const R = computeDemand(s).R;
    const st = station(s);
    st.staff = 0; // sin puestos libres: solo cuenta la estación
    expect(transitJobs(s)).toEqual({ find: TRANSIT.findChance, lose: TRANSIT.loseChance });
    expect(busDemandR(s)).toBe(TRANSIT.demandR);
    expect(computeDemand(s).R - R).toBe(TRANSIT.demandR);
  });

  it('el billete va al ayuntamiento (en el parte y en el ledger) y el Consorcio paga la mitad del mantenimiento', () => {
    const s = blank();
    const st = station(s);
    const ps = people(s, 5);
    ps[0]!.unemployedSince = s.tick; // en paro: no va en autobús
    ps[1]!.age = CARE.pensionAge; // jubilado: tampoco
    expect(riders(s)).toBe(3);
    const caja = s.treasury;
    const extIn = s.ledger.externalIn;
    transitMonth(s, [], 1); // con turismo: sin excursionistas
    const fare = TRANSIT.fare.normal * TRANSIT.workDays;
    const consortium = Math.round(MAINTENANCE.busstation * TRANSIT.consortium);
    expect(s.month.breakdown['autobús']).toBe(3 * fare);
    expect(s.month.breakdown['Consorcio']).toBe(consortium);
    expect(s.treasury - caja).toBe(3 * fare + consortium);
    expect(s.ledger.externalIn - extIn).toBe(consortium);
    expect(s.transit.riders).toBe(3);
    expect(ps[2]!.money).toBe(1_000 - fare);
    void st;
    expect(checkInvariants(s)).toEqual([]);
  });

  it('sin turismo, los excursionistas gastan en las tiendas (de fuera, como ventas)', () => {
    const s = blank();
    station(s);
    people(s, 20);
    const shop = newBuilding(s, 'shop', 12, 12, OUTSIDE);
    shop.built = true;
    const extIn = s.ledger.externalIn;
    transitMonth(s, [shop], 0);
    const daytrips = Math.round((TRANSIT.daytripPer10 * 20 * 30) / 10);
    expect(shop.sales).toBe(daytrips);
    expect(s.ledger.externalIn - extIn).toBe(daytrips + Math.round(MAINTENANCE.busstation * TRANSIT.consortium));
    expect(checkInvariants(s)).toEqual([]);
  });

  it('va en autobús (+ánimo) y, con el billete caro, se queja', () => {
    const s = blank();
    station(s);
    const [c] = people(s, 1);
    expect(happinessFactors(s, c!).find((f) => f.label === 'Va en autobús al trabajo')?.value).toBe(TRANSIT.mood);
    s.transit.fare = 'caro';
    expect(happinessFactors(s, c!).find((f) => f.label.includes('caro'))?.value).toBe(TRANSIT.dearMood);
  });

  it('IA y reglas: el parado busca trabajo fuera en autobús (el motor decide si lo encuentra)', () => {
    const s = blank();
    const [c] = people(s, 1);
    c!.unemployedSince = s.tick;
    expect(turnMenu(s, c!).some((m) => m.accion === 'buscar_trabajo_fuera')).toBe(false);
    station(s);
    expect(turnMenu(s, c!).at(-1)!.accion).toBe('buscar_trabajo_fuera');
    c!.traits.ambicion = 80;
    expect(transitRuleAction(s, c!)).toBe('buscar_trabajo_fuera');
    for (let i = 0; i < 40 && c!.unemployedSince !== undefined; i++) extraAction(s, c!, 'buscar_trabajo_fuera', undefined);
    expect(c!.unemployedSince).toBeUndefined();
    expect(turnMenu(s, c!).some((m) => m.accion === 'buscar_trabajo_fuera')).toBe(false);
  });

  it('director: excursión de jubilados (buena), con estación y como mucho cada pocos meses', () => {
    const s = blank();
    people(s, 4, 70, 500);
    expect(excursionCandidate(s)).toBeNull();
    station(s);
    const cand = directorMenu(s).find((c) => c.kind === 'excursion');
    expect(cand).toBeDefined();
    expect(cand!.bad).toBe(false);
    expect(applyExcursion(s)).not.toBeNull();
    expect(s.citizens.every((c) => c.memories.some((m) => m.kind === 'excursion'))).toBe(true);
    expect(s.citizens.every((c) => c.money === 500 - TRANSIT.excursion.cost)).toBe(true);
    expect(excursionCandidate(s)).toBeNull();
    s.tick += (TRANSIT.excursion.everyDays + 1) * TICKS_PER_DAY;
    expect(excursionCandidate(s)).not.toBeNull();
    expect(checkInvariants(s)).toEqual([]);
  });
});

describe('nombres de los edificios de la 2.4', () => {
  it('todo lo que se construye tiene nombre en español (la interfaz y los textos lo usan)', () => {
    for (const k of Object.keys(BUILD)) expect(BUILD_NAMES[k], k).toBeTruthy();
    expect(BUILD_NAMES.busstation).toBe('Estación de autobuses');
    expect(BUILD_NAMES.nursery).toBe('Guardería');
    expect(BUILD_NAMES.residence).toBe('Residencia de mayores');
  });
});
