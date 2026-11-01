import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  attended,
  birthFx,
  CARE,
  careMenu,
  careMonth,
  careRuleAction,
  checkInvariants,
  childcareMonth,
  type Citizen,
  createInitialState,
  extraAction,
  type GameState,
  happinessFactors,
  isRetired,
  lifeMonth,
  newBuilding,
  newResident,
  nurseryUse,
  OUTSIDE,
  outsideJobsMonth,
  pensionsMonth,
  residenceFree,
  setRelation,
  step,
  totalDebt,
  transfer,
  TREASURY,
  turnMenu,
  validActions,
  validateCommand,
} from '../src/index.ts';

/** Pueblo vacío con el ayuntamiento de nivel 3 y sin vecinos. */
function blank(seed = 5): GameState {
  const s = createInitialState({ seed });
  for (const c of s.citizens) transfer(s, c.id, OUTSIDE, c.money);
  s.citizens = [];
  s.townhallLevel = 3;
  return s;
}

function built(s: GameState, kind: Parameters<typeof newBuilding>[1], x: number, y: number) {
  const b = newBuilding(s, kind, x, y, kind === 'house' ? OUTSIDE : TREASURY);
  b.built = true;
  return b;
}

function resident(s: GameState, age: number, homeId: number | null, money = 1_000): Citizen {
  const c = newResident(s, { age });
  c.homeId = homeId;
  s.citizens.push(c);
  transfer(s, OUTSIDE, c.id, money);
  return c;
}

/** Parejas (con nombre, 30 años, cada una en su casa) cerca de (cx, cy). */
function couples(s: GameState, n: number, cx = 10, cy = 10): [Citizen, Citizen][] {
  const out: [Citizen, Citizen][] = [];
  for (let i = 0; i < n; i++) {
    const h = built(s, 'house', cx + (i % 6), cy + Math.floor(i / 6));
    const a = resident(s, 30, h.id);
    const b = resident(s, 31, h.id);
    a.named = true;
    b.named = true;
    setRelation(s, a, b, 'pareja', 60);
    out.push([a, b]);
  }
  return out;
}

const births = (s: GameState) => s.citizens.reduce((n, c) => n + (c.kids?.length ?? 0), 0);

describe('guardería (2.4)', () => {
  it('la cuota solo se puede cambiar con la guardería construida', () => {
    const s = blank();
    expect(validateCommand(s, { type: 'SetCareFee', service: 'nursery', level: 'reducida' }).ok).toBe(false);
    built(s, 'nursery', 5, 5);
    expect(validateCommand(s, { type: 'SetCareFee', service: 'nursery', level: 'normal' }).ok).toBe(false); // ya está
    expect(applyCommand(s, { type: 'SetCareFee', service: 'nursery', level: 'gratis' }).ok).toBe(true);
    expect(s.care.nurseryFee).toBe('gratis');
    expect(validateCommand(s, { type: 'SetCareFee', service: 'residence', level: 'gratis' }).ok).toBe(false);
  });

  it('con plaza de guardería cerca, la natalidad sube ×1,5; sin sitio libre, no', () => {
    const s = blank();
    const [[a]] = couples(s, 1);
    expect(birthFx(s, a!, nurseryUse(s)).fx).toBe(1);
    const n = built(s, 'nursery', 12, 12);
    expect(birthFx(s, a!, nurseryUse(s)).fx).toBe(CARE.birthWithPlace);
    // Lejos (fuera del radio), no cuenta.
    n.x = 40;
    n.y = 40;
    expect(birthFx(s, a!, nurseryUse(s)).fx).toBe(1);
    n.x = 12;
    n.y = 12;
    // Llena: 20 niños pequeños de otra casa cercana.
    const h = built(s, 'house', 11, 11);
    const p = resident(s, 35, h.id);
    p.kids = Array.from({ length: CARE.nursery.places }, (_, i) => s.tick - i);
    expect(birthFx(s, a!, nurseryUse(s)).fx).toBe(1);
  });

  it('nacen más bebés en un pueblo con guardería (mismo pueblo, misma semilla)', () => {
    const run = (withNursery: boolean) => {
      const s = blank(11);
      couples(s, 60);
      if (withNursery) for (let k = 0; k < 3; k++) built(s, 'nursery', 12 + k, 9);
      for (let m = 0; m < 12; m++) {
        s.tick += TICKS_PER_MONTH;
        lifeMonth(s);
      }
      return births(s);
    };
    const without = run(false);
    const withN = run(true);
    expect(without).toBeGreaterThan(5);
    expect(withN).toBeGreaterThan(without);
  });

  it('sin plaza, el que menos cobra de la pareja deja su trabajo de fuera (una vez) y no busca otro mientras', () => {
    const s = blank(3);
    const [[a, b]] = couples(s, 1);
    a!.kids = [s.tick];
    a!.last = { in: 1_200, out: 0, repaid: 0, owed: 0, grew: 0 };
    b!.last = { in: 700, out: 0, repaid: 0, owed: 0, grew: 0 };
    for (let i = 0; i < 200 && b!.unemployedSince === undefined; i++) childcareMonth(s);
    expect(b!.unemployedSince).toBeDefined();
    expect(b!.benefitLeft).toBe(0);
    expect(b!.memories.some((m) => m.kind === 'deja_trabajo_crianza')).toBe(true);
    expect(a!.unemployedSince).toBeUndefined();
    // Una vez por bebé: el otro ya no lo deja.
    for (let i = 0; i < 100; i++) childcareMonth(s);
    expect(a!.unemployedSince).toBeUndefined();
    // Mientras cría sin plaza, no busca trabajo fuera.
    for (let i = 0; i < 30; i++) outsideJobsMonth(s);
    expect(b!.unemployedSince).toBeDefined();
    expect(checkInvariants(s)).toEqual([]);
  });

  it('con plaza de guardería nadie deja el trabajo', () => {
    const s = blank(3);
    const [[a, b]] = couples(s, 1);
    built(s, 'nursery', 11, 11);
    a!.kids = [s.tick];
    for (let i = 0; i < 100; i++) childcareMonth(s);
    expect(a!.unemployedSince).toBeUndefined();
    expect(b!.unemployedSince).toBeUndefined();
  });

  it('la cuota se cobra con charge: lo que no se paga queda como deuda con el ayuntamiento', () => {
    const s = blank();
    const [[a]] = couples(s, 1);
    built(s, 'nursery', 11, 11);
    a!.kids = [s.tick];
    transfer(s, a!.id, OUTSIDE, a!.money);
    const created = s.debtLedger.created;
    careMonth(s);
    expect(a!.debt?.town).toBe(CARE.nursery.fee.normal);
    expect(s.debtLedger.created - created).toBe(CARE.nursery.fee.normal);
    expect(checkInvariants(s)).toEqual([]);
  });
});

describe('residencia, pensión y mayores (2.4)', () => {
  it('pensión mínima desde fuera para los jubilados; no cobran como si trabajaran fuera', () => {
    const s = blank();
    const h = built(s, 'house', 10, 10);
    const old = resident(s, CARE.pensionAge, h.id, 0);
    const young = resident(s, 40, h.id, 0);
    expect(isRetired(old)).toBe(true);
    expect(isRetired(young)).toBe(false);
    const extIn = s.ledger.externalIn;
    pensionsMonth(s);
    expect(old.money).toBe(CARE.pension);
    expect(young.money).toBe(0);
    expect(s.ledger.externalIn - extIn).toBe(CARE.pension);
    // Un día de trabajo: el jubilado no cobra el sueldo de fuera.
    for (let i = 0; i < TICKS_PER_DAY; i++) step(s);
    expect(old.money).toBe(CARE.pension);
    expect(young.money).toBeGreaterThan(0);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('un mayor solo y sin hijos entra en la residencia si hay plaza; la cuota impagada la paga el hijo o queda como deuda', () => {
    const s = blank();
    built(s, 'residence', 20, 20);
    const h = built(s, 'house', 10, 10);
    const p = resident(s, 80, h.id, 0);
    careMonth(s);
    expect(p.care).toBe('residencia');
    expect(attended(p)).toBe(true);
    // Sin dinero y sin hijos: deuda del propio mayor con el ayuntamiento.
    expect(p.debt?.town).toBe(CARE.residence.fee.normal);
    // Con un hijo en el pueblo, el hijo paga lo que falta.
    const kid = resident(s, 50, h.id, 5_000);
    kid.parents = [p.id];
    transfer(s, OUTSIDE, p.id, 100);
    const caja = s.treasury;
    careMonth(s);
    expect(s.treasury - caja).toBe(CARE.residence.fee.normal);
    expect(kid.money).toBe(5_000 - (CARE.residence.fee.normal - 100));
    expect(totalDebt(p)).toBe(CARE.residence.fee.normal);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('un mayor atendido no se va por estar triste (el que no lo está, sí)', () => {
    const s = blank(9);
    built(s, 'residence', 20, 20);
    const h = built(s, 'house', 10, 10);
    const h2 = built(s, 'house', 12, 10);
    resident(s, 40, h.id, 5_000); // para que el pueblo no se quede vacío
    const cared = resident(s, 72, h2.id, 5_000);
    cared.care = 'residencia';
    const alone = resident(s, 72, h2.id, 5_000);
    cared.named = false;
    alone.named = false;
    // Con pareja en el pueblo no entra solo en la residencia: es el que no está atendido.
    const partner = resident(s, 70, h.id, 5_000);
    partner.named = false;
    setRelation(s, alone, partner, 'pareja', 60);
    expect(validActions(s, cared, 'infeliz')).not.toContain('irse');
    expect(validActions(s, alone, 'infeliz')).toContain('irse');
    for (let d = 0; d < 120; d++) {
      for (const c of s.citizens) c.happiness = 0;
      for (let i = 0; i < TICKS_PER_DAY; i++) step(s);
    }
    expect(s.citizens).toContain(cared);
    expect(alone.care).toBeUndefined();
    expect(s.citizens).not.toContain(alone);
  });

  it('la residencia baja el riesgo de morir y da ánimo («Bien atendido»)', () => {
    const s = blank();
    const h = built(s, 'house', 10, 10);
    const p = resident(s, 78, h.id);
    p.care = 'residencia';
    expect(happinessFactors(s, p).some((f) => f.label.startsWith('Bien atendido') && f.value === CARE.caredMood)).toBe(true);
  });

  it('el hijo decide: «llevar a la residencia» o «cuidar en casa» (menú con plazas y cuota reales, y reglas)', () => {
    const s = blank();
    s.aiMode = true;
    built(s, 'residence', 20, 20);
    const h = built(s, 'house', 10, 10);
    const h2 = built(s, 'house', 14, 10);
    const p = resident(s, 80, h.id);
    const kid = resident(s, 50, h2.id);
    kid.named = true;
    kid.parents = [p.id];
    const menu = careMenu(s, kid);
    expect(menu.map((m) => m.accion)).toEqual([`llevar_a_residencia:${p.id}`, `cuidar_en_casa:${p.id}`]);
    expect(menu[0]!.detalle).toContain(`quedan ${CARE.residence.places} plazas`);
    expect(menu[0]!.detalle).toContain(`${CARE.residence.fee.normal} €/mes`);
    expect(turnMenu(s, kid).map((m) => m.accion).slice(-2)).toEqual(menu.map((m) => m.accion));
    // Cuidar en casa: el mayor se muda con él (cabe y no tiene casa propia).
    expect(extraAction(s, kid, 'cuidar_en_casa', String(p.id))).toContain('cuida a');
    expect(p.care).toBe('casa');
    expect(p.homeId).toBe(h2.id);
    expect(careMenu(s, kid)).toEqual([]);
    expect(happinessFactors(s, kid).some((f) => f.value === CARE.homeCare.mood)).toBe(true);
    // Por reglas: el ahorrador, a la residencia (con plaza); el sociable sin plaza, en casa.
    delete p.care;
    kid.traits = { terco: 50, ahorro: 80, social: 50, ambicion: 30 };
    expect(careRuleAction(s, kid)).toBe(`llevar_a_residencia:${p.id}`);
    expect(extraAction(s, kid, 'llevar_a_residencia', String(p.id))).toContain('residencia');
    expect(p.care).toBe('residencia');
    expect(residenceFree(s)).toBe(CARE.residence.places - 1);
    // El hijo que cuida en casa trabaja menos; el dinero se conserva.
    delete p.care;
    extraAction(s, kid, 'cuidar_en_casa', String(p.id));
    kid.flow = [1_000, 0];
    const before = kid.money;
    careMonth(s);
    expect(before - kid.money).toBe(Math.round(1_000 * CARE.homeCare.wageCut));
    expect(checkInvariants(s)).toEqual([]);
  });

  it('una partida con guardería, residencia y estación conserva el dinero y la deuda', () => {
    const s = createInitialState({ seed: 42 });
    s.townhallLevel = 3;
    built(s, 'nursery', 20, 20);
    built(s, 'residence', 21, 20);
    built(s, 'busstation', 22, 20);
    for (let i = 0; i < TICKS_PER_MONTH * 6; i++) {
      step(s);
      if (i % TICKS_PER_MONTH === 0) expect(checkInvariants(s)).toEqual([]);
    }
    expect(checkInvariants(s)).toEqual([]);
  });
});
