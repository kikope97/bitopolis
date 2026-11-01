import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  canJoinCoop,
  checkInvariants,
  COOP,
  coopFees,
  coopMenu,
  coopMonth,
  coopPriceFx,
  coopRuleAction,
  coopSurplus,
  coopVote,
  createInitialState,
  cropAt,
  extraAction,
  FARM,
  farmMonth,
  type GameState,
  joinCoop,
  moneyDrift,
  newBuilding,
  sellCoopSurplus,
  Terrain,
  Tile,
  totalDebt,
  turnMenu,
  validateCommand,
  Zone,
} from '../src/index.ts';

/** Pueblo llano con una calle en la fila 10, ayuntamiento de nivel 2 y 12 vecinos sin trabajo. */
function fixture(opts: { aiMode?: boolean } = {}) {
  const s = createInitialState({ seed: 11, aiMode: opts.aiMode });
  const { w, h } = s.map;
  for (let i = 0; i < w * h; i++) {
    s.map.terrain[i] = Terrain.Flat;
    if (s.map.tiles[i] === Tile.Tree) s.map.tiles[i] = Tile.Grass;
  }
  for (let x = 6; x < w; x++) s.map.tiles[10 * w + x] = Tile.Road;
  s.townhallLevel = 2;
  const base = s.citizens[0]!;
  for (let k = 0; k < 11; k++) s.citizens.push({ ...structuredClone(base), id: s.nextId++, jobId: null, named: k < 4, name: `Vecino ${k}` });
  s.ledger.initialTotal += 11 * base.money;
  return s;
}

function farmAt(s: GameState, x: number, y: number) {
  s.map.zones[y * s.map.w + x] = Zone.A;
  const b = newBuilding(s, 'farm', x, y, -1);
  b.built = true;
  b.crop = cropAt(s, x, y);
  b.yieldFx = FARM.start;
  return b;
}

function coopAt(s: GameState, x = 20, y = 11) {
  const b = newBuilding(s, 'coop', x, y, 0);
  b.built = true;
  return b;
}

/** Pone el reloj al día 1 del mes `month` (1–12) del año `year`. */
const at = (s: GameState, month: number, year = 1) => (s.tick = (year - 1) * 12 * TICKS_PER_MONTH + (month - 1) * TICKS_PER_MONTH);

describe('cooperativa agraria (2.5, bloque G)', () => {
  it('solo pueden ser socios quienes tienen finca, y solo con la cooperativa hecha', () => {
    const s = fixture();
    const f = farmAt(s, 10, 11);
    const [a, b] = s.citizens;
    a!.jobId = f.id;
    expect(canJoinCoop(s, a!)).toBe(false);
    coopAt(s);
    expect(canJoinCoop(s, a!)).toBe(true);
    expect(canJoinCoop(s, b!)).toBe(false);
    joinCoop(s, a!);
    expect(s.coop.members).toEqual([a!.id]);
    expect(s.coop.presidentId).toBe(a!.id);
    expect(canJoinCoop(s, a!)).toBe(false);
  });

  it('una sola cooperativa por pueblo', () => {
    const s = fixture();
    s.treasury = 100_000;
    for (let i = 0; i < 60; i++) s.citizens.push({ ...structuredClone(s.citizens[1]!), id: s.nextId++ });
    coopAt(s);
    const r = validateCommand(s, { type: 'Build', kind: 'coop', x: 30, y: 11 });
    expect(r.ok).toBe(false);
  });

  it('la cosecha de un socio se vende un 15 % más cara: el sobreprecio va a la caja de la cooperativa, sin crear dinero', () => {
    const s = fixture();
    const f = farmAt(s, 10, 11); // secano: cosecha en julio
    const c = s.citizens[1]!;
    c.jobId = f.id;
    const coop = coopAt(s);
    joinCoop(s, c);
    at(s, 8); // se cierra julio
    const before = moneyDrift(s);
    farmMonth(s);
    const sale = f.sales!;
    expect(sale).toBe(FARM.base.secano);
    coopMonth(s);
    expect(coopPriceFx(s)).toBe(COOP.priceFx);
    expect(coop.cash).toBe(Math.round(sale * COOP.priceFx));
    expect(coopSurplus(s)).toBe(Math.round(sale * COOP.surplusShare));
    expect(moneyDrift(s)).toBe(before);
  });

  it('nivel 2 (almazara o bodega): +25 %', () => {
    const s = fixture();
    const coop = coopAt(s);
    coop.level = 2;
    expect(coopPriceFx(s)).toBe(COOP.priceFxLevel2);
  });

  it('el reparto de diciembre conserva el dinero y da lo mismo a cada socio', () => {
    const s = fixture();
    const coop = coopAt(s);
    const fs = [farmAt(s, 10, 11), farmAt(s, 12, 11), farmAt(s, 14, 11)];
    const members = s.citizens.slice(1, 4);
    members.forEach((c, i) => {
      c.jobId = fs[i]!.id;
      joinCoop(s, c);
    });
    // Caja de la cooperativa: cuotas y sobreprecio del año (de fuera, con transfer).
    s.ledger.externalIn += 1_000;
    coop.cash = 1_000;
    s.coop.stock = 300;
    const money = members.map((c) => c.money);
    at(s, 1, 2); // se cierra diciembre del año 1
    const before = moneyDrift(s);
    coopMonth(s);
    expect(moneyDrift(s)).toBe(before);
    // 1.000 € + la mitad del excedente vendido fuera (150 €) = 1.150 → 383 cada uno y sobra 1.
    const each = Math.floor((1_000 + 300 * COOP.surplusOutsideFx) / 3);
    members.forEach((c, i) => expect(c.money - money[i]!).toBe(each));
    expect(s.coop.perMember).toBe(each);
    expect(s.coop.lastShare).toBe(each * 3);
    expect(coop.cash).toBe(1_150 - each * 3);
    expect(s.coop.stock).toBe(0);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('la cuota impagada queda como deuda; tras unos meses, baja', () => {
    const s = fixture();
    const coop = coopAt(s);
    const f = farmAt(s, 10, 11);
    const c = s.citizens[1]!;
    c.jobId = f.id;
    joinCoop(s, c);
    c.money = 5;
    const created = s.debtLedger.created;
    const before = moneyDrift(s);
    coopFees(s);
    expect(moneyDrift(s)).toBe(before);
    expect(coop.cash).toBe(5);
    expect(c.money).toBe(0);
    expect(totalDebt(c)).toBe(COOP.fee - 5);
    expect(s.debtLedger.created - created).toBe(COOP.fee - 5);
    for (let k = 1; k < COOP.dropAfter; k++) coopFees(s);
    expect(s.coop.members).not.toContain(c.id);
    expect(s.coop.presidentId).toBeNull();
  });

  it('quien deja la finca deja de ser socio', () => {
    const s = fixture();
    coopAt(s);
    const f = farmAt(s, 10, 11);
    const c = s.citizens[1]!;
    c.jobId = f.id;
    joinCoop(s, c);
    c.jobId = null;
    at(s, 3);
    coopMonth(s);
    expect(s.coop.members).toEqual([]);
  });

  it('presidente por votación determinista según la actitud de los socios', () => {
    const s = fixture();
    coopAt(s);
    const fs = [10, 12, 14, 16].map((x) => farmAt(s, x, 11));
    const cs = s.citizens.slice(1, 5);
    const att = [2, 2, -2, 1];
    cs.forEach((c, i) => {
      c.jobId = fs[i]!.id;
      c.attitude = att[i];
      c.traits = { ...c.traits, social: 50 };
      joinCoop(s, c);
    });
    const v1 = coopVote(s);
    const v2 = coopVote(structuredClone(s));
    expect(v1).toEqual(v2);
    expect(v1.reduce((a, x) => a + x.votes, 0)).toBe(4);
    // Los de actitud 2 se votan entre sí; el de 1 vota a uno de ellos: gana uno de los de 2.
    expect([cs[0]!.id, cs[1]!.id]).toContain(v1[0]!.id);
  });

  it('IA: hacerse_socio y darse_de_baja en el menú (al final) y en extraAction', () => {
    const s = fixture({ aiMode: true });
    coopAt(s);
    const f = farmAt(s, 10, 11);
    const c = s.citizens.find((x) => x.named)!;
    c.jobId = f.id;
    const menu = turnMenu(s, c).map((m) => m.accion);
    expect(menu.at(-1)).toBe('hacerse_socio');
    expect(extraAction(s, c, 'hacerse_socio', undefined)).toMatch(/socio/);
    expect(s.coop.members).toContain(c.id);
    // Recién entrado no puede darse de baja.
    expect(coopMenu(s, c)).toEqual([]);
    s.tick += COOP.minMonths * TICKS_PER_MONTH;
    expect(coopMenu(s, c)[0]!.accion).toBe('darse_de_baja');
    extraAction(s, c, 'darse_de_baja', undefined);
    expect(s.coop.members).not.toContain(c.id);
  });

  it('reglas: se apunta quien es sociable y puede pagar (sin dados)', () => {
    const s = fixture();
    coopAt(s);
    const f = farmAt(s, 10, 11);
    const c = s.citizens[1]!;
    c.jobId = f.id;
    c.money = 500;
    c.traits = { terco: 10, ahorro: 10, social: 90, ambicion: 10 };
    const days: (string | null)[] = [];
    for (let m = 0; m < 12; m++) {
      s.tick = m * TICKS_PER_MONTH + TICKS_PER_DAY;
      days.push(coopRuleAction(s, c));
    }
    expect(days).toContain('hacerse_socio');
    c.traits = { terco: 10, ahorro: 10, social: 10, ambicion: 10 };
    for (let m = 0; m < 12; m++) {
      s.tick = m * TICKS_PER_MONTH;
      expect(coopRuleAction(s, c)).toBeNull();
    }
  });

  it('excedente para la comarca: se vende con transfer y vuelve a cero', () => {
    const s = fixture();
    const coop = coopAt(s);
    s.coop.stock = 1_000;
    const before = moneyDrift(s);
    expect(sellCoopSurplus(s, 1.2, 400)).toBe(480);
    expect(coop.cash).toBe(480);
    expect(coopSurplus(s)).toBe(600);
    expect(moneyDrift(s)).toBe(before);
  });

  it('una partida entera con cooperativa y fincas no pierde dinero ni rompe invariantes', () => {
    const s = fixture();
    s.ledger.initialTotal += 50_000 - s.treasury;
    s.treasury = 50_000;
    const fs = [10, 12, 14].map((x) => farmAt(s, x, 11));
    s.citizens.slice(1, 4).forEach((c, i) => (c.jobId = fs[i]!.id));
    for (let i = 0; i < 30; i++) s.citizens.push({ ...structuredClone(s.citizens[5]!), id: s.nextId++, jobId: null });
    s.ledger.initialTotal += 30 * s.citizens[5]!.money;
    const r = applyCommand(s, { type: 'Build', kind: 'coop', x: 20, y: 11 });
    expect(r.ok).toBe(true);
    s.buildings.find((b) => b.kind === 'coop')!.built = true;
    s.projects = s.projects.filter((p) => s.buildings.find((b) => b.id === p.buildingId)?.kind !== 'coop');
    for (const c of s.citizens.slice(1, 4)) joinCoop(s, c);
    const start = moneyDrift(s);
    for (let m = 1; m < 15; m++) {
      at(s, (m % 12) + 1, 1 + Math.floor(m / 12));
      farmMonth(s);
      coopMonth(s);
      for (const f of fs) f.sales = 0;
      coopFees(s);
      expect(checkInvariants(s)).toEqual([]);
    }
    expect(moneyDrift(s)).toBe(start);
    // Hubo cosecha en julio (secano) y reparto al cerrar diciembre.
    expect(s.coop.shareYear).toBe(1);
    expect(s.coop.lastShare).toBeGreaterThan(0);
  });
});
