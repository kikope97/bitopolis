import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  applyNeighborAct,
  checkInvariants,
  COMARCA,
  comarcaDay,
  comarcaMonth,
  createInitialState,
  createNeighbors,
  type GameState,
  hashState,
  neighborMenu,
  neighborTemplate,
  newBuilding,
  OUTSIDE,
  ruleNeighborPick,
  step,
  transfer,
  TREASURY,
  validateCommand,
  riverExit,
  Terrain,
  waterSurplus,
} from '../src/index.ts';

const days = (s: GameState, n: number) => {
  for (let i = 0; i < n * TICKS_PER_DAY; i++) step(s);
};

/** Pueblo pequeño con la comarca ya creada (sin pasar un mes entero). */
function town(seed = 3, opts: { aiMode?: boolean; pop?: number } = {}): GameState {
  const s = createInitialState({ seed, aiMode: opts.aiMode ?? false });
  const base = s.citizens[0]!;
  while (s.citizens.length < (opts.pop ?? 0)) s.citizens.push({ ...structuredClone(base), id: s.nextId++, money: 0, homeId: null, jobId: null, named: false, flow: [0, 0] });
  transfer(s, OUTSIDE, TREASURY, 50_000, 'subvencion');
  s.comarca.towns = createNeighbors(s);
  return s;
}

describe('la comarca (2.5, bloque I)', () => {
  it('los pueblos vecinos son deterministas con la semilla y se crean al primer cierre de mes', () => {
    const a = createNeighbors(createInitialState({ seed: 11 }));
    const b = createNeighbors(createInitialState({ seed: 11 }));
    expect(a).toEqual(b);
    expect(a).toHaveLength(COMARCA.towns);
    expect(new Set(a.map((t) => t.name)).size).toBe(a.length);
    expect(new Set(a.map((t) => t.mayor.personality)).size).toBe(a.length);
    const c = createNeighbors(createInitialState({ seed: 12 }));
    expect(c.map((t) => t.name).join()).not.toBe(a.map((t) => t.name).join());
    const s = createInitialState({ seed: 11 });
    expect(s.comarca.towns).toHaveLength(0);
    days(s, 30);
    expect(s.comarca.towns.map((t) => t.name)).toEqual(a.map((t) => t.name));
    expect(s.comarca.fair).not.toBeNull();
    expect(checkInvariants(s)).toEqual([]);
  });

  it('si un vecino atrae más que el nuestro (más de pullGap), se va el 2 % de los vecinos a ese pueblo', () => {
    const s = town(3, { pop: 50 });
    for (const c of s.citizens) c.happiness = 40;
    const t = s.comarca.towns[1]!;
    for (const x of s.comarca.towns) x.happiness = 45;
    t.happiness = 90;
    const before = s.citizens.length;
    const popBefore = t.pop;
    const gone: number[] = [];
    comarcaMonth(s, (c) => {
      gone.push(c.id);
      s.citizens = s.citizens.filter((x) => x !== c);
    });
    expect(gone).toHaveLength(Math.round(before * COMARCA.pullShare));
    expect(s.citizens.length).toBe(before - gone.length);
    expect(t.pop).toBeGreaterThan(popBefore - 10);
    expect(s.events.some((e) => e.text.includes(`a ${t.name}`))).toBe(true);
    // Sin diferencia de atractivo no se va nadie.
    const s2 = town(3, { pop: 50 });
    for (const c of s2.citizens) c.happiness = 60;
    for (const x of s2.comarca.towns) x.happiness = 60 - COMARCA.attractBase; // ronda 21: con su base, el mismo atractivo
    let left = 0;
    comarcaMonth(s2, () => left++);
    expect(left).toBe(0);
  });

  it('una oferta caduca sin respuesta (y empeora la relación); después ya no se puede aceptar', () => {
    const s = town();
    const t = s.comarca.towns[0]!;
    t.relation = 1;
    applyNeighborAct(s, t, 'ofrecer_acuerdo:cosecha', neighborTemplate(s, t, 'ofrecer_acuerdo:cosecha'), 'reglas');
    const o = s.comarca.offers.at(-1)!;
    expect(o.until - o.tick).toBe(COMARCA.offerDays * TICKS_PER_DAY);
    expect(validateCommand(s, { type: 'AnswerNeighbor', id: o.id, accept: true }).ok).toBe(true);
    s.tick = o.until;
    comarcaDay(s);
    expect(o.resolved).toBe('expired');
    expect(t.relation).toBe(1 + COMARCA.expireRelation); // ronda 21: dejarla caducar resta 2
    expect(validateCommand(s, { type: 'AnswerNeighbor', id: o.id, accept: true }).ok).toBe(false);
  });

  it('acuerdo de agua: el vecino paga el agua sobrante cada mes, la relación sube y el dinero se conserva', () => {
    const s = town();
    const pump = newBuilding(s, 'water', 20, 20, 0);
    pump.built = true;
    expect(waterSurplus(s)).toBeGreaterThan(0);
    const t = s.comarca.towns[0]!;
    applyNeighborAct(s, t, 'ofrecer_acuerdo:agua', 'Compartamos el agua.', 'reglas');
    const o = s.comarca.offers.at(-1)!;
    const rel = t.relation;
    expect(applyCommand(s, { type: 'AnswerNeighbor', id: o.id, accept: true }).ok).toBe(true);
    expect(o.dealUntil).toBe(s.tick + COMARCA.deals.months * TICKS_PER_MONTH);
    expect(t.relation).toBe(Math.min(2, rel + 1));
    // Un segundo acuerdo de agua no cabe mientras dure este.
    applyNeighborAct(s, s.comarca.towns[1]!, 'ofrecer_acuerdo:agua', 'También queremos agua.', 'reglas');
    expect(validateCommand(s, { type: 'AnswerNeighbor', id: s.comarca.offers.at(-1)!.id, accept: true }).ok).toBe(false);
    const before = s.month.breakdown.comarca ?? 0;
    comarcaMonth(s, () => undefined);
    expect((s.month.breakdown.comarca ?? 0) - before).toBe(waterSurplus(s) * COMARCA.deals.agua.perBuilding);
    days(s, 35);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('la bolsa semestral de la Diputación se reparte por puntuación (entra por OUTSIDE)', () => {
    const s = town(5, { pop: 30 });
    // Cierre de junio: el tick es el 1 de julio.
    s.tick = 6 * TICKS_PER_MONTH;
    const cash = s.treasury;
    s.comarca.towns[0]!.grantClaims = 2;
    comarcaMonth(s, () => undefined);
    expect(s.treasury).toBeGreaterThan(cash);
    expect(s.treasury - cash).toBeLessThan(COMARCA.grantPool);
    // Reparto hecho: los que pidieron vuelven a empezar (como mucho lo de este mes).
    expect(s.comarca.towns.every((t) => (t.grantClaims ?? 0) <= 1)).toBe(true);
    expect(s.events.some((e) => e.text.startsWith('La Diputación reparte la bolsa comarcal'))).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('río sucio a la salida: el pueblo de abajo se enfada', () => {
    const s = createInitialState({ seed: 3, terrain: 'rio' });
    s.comarca.towns = createNeighbors(s);
    const down = s.comarca.towns.find((t) => t.downstream)!;
    expect(down).toBeDefined();
    down.relation = 0;
    // Río limpio: nada.
    comarcaMonth(s, () => undefined);
    expect(s.comarca.riverAngry).toBeFalsy();
    // Río muy sucio a la salida: protesta y relación peor.
    const rel = down.relation;
    s.fields.river = s.map.terrain.map((t) => (t === Terrain.River ? 90 : 0));
    expect(riverExit(s)).toBeGreaterThan(COMARCA.riverAngry);
    comarcaMonth(s, () => undefined);
    expect(s.comarca.riverAngry).toBe(true);
    expect(down.relation).toBeLessThanOrEqual(rel);
    expect(s.events.some((e) => e.text.includes('río abajo, protesta'))).toBe(true);
    // Sin río, ningún pueblo queda río abajo.
    const flat = createInitialState({ seed: 3, terrain: 'llano' });
    expect(createNeighbors(flat).some((t) => t.downstream)).toBe(false);
  });

  it('feria comarcal: el anfitrión rota y, si es el pueblo, los forasteros gastan en las tiendas', async () => {
    const { fairHost, comarcaFair } = await import('../src/index.ts');
    const s = town();
    const hosts = [2030, 2031, 2032, 2033].map((y) => fairHost(s, y));
    for (let i = 1; i < hosts.length; i++) expect(hosts[i]).not.toBe(hosts[i - 1]);
    const shop = newBuilding(s, 'shop', 10, 10, 0);
    shop.built = true;
    // Cierre de septiembre del primer año.
    s.tick = 9 * TICKS_PER_MONTH;
    s.comarca.fair = { year: 1, host: 0 };
    const cash = shop.cash;
    comarcaFair(s, [shop]);
    expect(shop.cash - cash).toBe(COMARCA.fair.spendPerTown * s.comarca.towns.length);
    expect(s.comarca.lastPrize?.year).toBe(1);
    expect(checkInvariants(s)).toEqual([]);
  });
});

describe('alcaldes vecinos (2.5, bloque J)', () => {
  it('reglas de respaldo por personalidad, deterministas', () => {
    const s = town();
    const [a, b, c] = s.comarca.towns as [NonNullable<GameState['comarca']['towns'][0]>, NonNullable<GameState['comarca']['towns'][0]>, NonNullable<GameState['comarca']['towns'][0]>];
    a.mayor.personality = 'populista';
    a.relation = -1;
    expect(ruleNeighborPick(s, a)).toBe('criticar');
    b.mayor.personality = 'competidor';
    b.happiness = 30;
    expect(ruleNeighborPick(s, b)).toBe('bajar_impuestos');
    c.mayor.personality = 'cooperador';
    // Con una finca, el cooperador ofrece un acuerdo de cosecha.
    const farm = newBuilding(s, 'farm', 5, 5, 0);
    farm.built = true;
    expect(neighborMenu(s, c)).toContain('ofrecer_acuerdo:cosecha');
    expect(ruleNeighborPick(s, c)).toMatch(/^ofrecer_acuerdo:/);
    c.mayor.personality = 'prudente';
    expect(ruleNeighborPick(s, c)).toBe(ruleNeighborPick(structuredClone(s), structuredClone(c)));
    // Las plantillas no llevan cifras.
    for (const t of s.comarca.towns) for (const m of neighborMenu(s, t)) expect(neighborTemplate(s, t, m)).not.toMatch(/\d/);
  });

  it('Modo normal: deciden las reglas al cerrar el mes; Modo IA: se abre el turno y vence con reglas', () => {
    const s = town();
    comarcaMonth(s, () => undefined);
    expect(s.comarca.turn).toBeUndefined();
    expect(s.comarca.towns.every((t) => t.saidBy === 'reglas')).toBe(true);
    const ai = town(3, { aiMode: true });
    comarcaMonth(ai, () => undefined);
    expect(ai.comarca.turn).toBeDefined();
    expect(ai.comarca.towns.every((t) => !t.said)).toBe(true);
    ai.tick = ai.comarca.turn!.due;
    comarcaDay(ai);
    expect(ai.comarca.turn).toBeUndefined();
    expect(ai.comarca.towns.every((t) => t.saidBy === 'reglas')).toBe(true);
  });

  it('NeighborTurn es reproducible (mismo hash) y lo que no está en el menú lo deciden las reglas', () => {
    const s = town(3, { aiMode: true });
    comarcaMonth(s, () => undefined);
    const month = s.comarca.turn!.month;
    const [a, b] = s.comarca.towns;
    const picks = [
      { pueblo: a!.id, accion: 'felicitar', declaracion: 'Buenos vecinos, los de Bitópolis.' },
      { pueblo: b!.id, accion: 'ofrecer_acuerdo:luz', declaracion: 'Queremos vuestra luz.' },
    ];
    const x = structuredClone(s);
    const y = structuredClone(s);
    expect(validateCommand(x, { type: 'NeighborTurn', month: month + 1, picks }).ok).toBe(false);
    expect(applyCommand(x, { type: 'NeighborTurn', month, picks }).ok).toBe(true);
    expect(applyCommand(y, { type: 'NeighborTurn', month, picks }).ok).toBe(true);
    expect(hashState(x)).toBe(hashState(y));
    const xa = x.comarca.towns.find((t) => t.id === a!.id)!;
    expect(xa.lastAct).toBe('felicitar');
    expect(xa.saidBy).toBe('ia');
    // Sin luz sobrante, el acuerdo de luz no está en el menú: reglas.
    const xb = x.comarca.towns.find((t) => t.id === b!.id)!;
    expect(xb.lastAct).not.toBe('ofrecer_acuerdo:luz');
    expect(xb.saidBy).toBe('reglas');
    // Turno cerrado: un segundo no vale.
    expect(applyCommand(x, { type: 'NeighborTurn', month, picks }).ok).toBe(false);
    // Fuera del Modo IA, tampoco.
    const n = town();
    n.comarca.turn = { month, due: n.tick + 100 };
    expect(validateCommand(n, { type: 'NeighborTurn', month, picks }).ok).toBe(false);
  });
});
