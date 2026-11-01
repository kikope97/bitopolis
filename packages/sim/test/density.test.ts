import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  canResolveDilemma,
  checkInvariants,
  type Citizen,
  createInitialState,
  DENSITY,
  densityAt,
  densityDay,
  dilemmaCandidates,
  extraAction,
  freeHomes,
  type GameState,
  homeCapacity,
  homesOf,
  newBuilding,
  newResident,
  openDilemma,
  OUTSIDE,
  resolveDilemma,
  transfer,
  TREASURY,
  turnMenu,
  updateFields,
  validateCommand,
  VPO,
  vpoDraw,
  vpoMonth,
  vpoPool,
  vpoRentMonth,
  vpoRuleAction,
  Zone,
} from '../src/index.ts';

function blank(seed = 5): GameState {
  const s = createInitialState({ seed });
  for (const c of s.citizens) transfer(s, c.id, OUTSIDE, c.money);
  s.citizens = [];
  s.townhallLevel = 3;
  return s;
}

function people(s: GameState, n: number, money = 500, named = false): Citizen[] {
  const out: Citizen[] = [];
  for (let i = 0; i < n; i++) {
    const c = newResident(s, { age: 35 });
    c.named = named;
    s.citizens.push(c);
    transfer(s, OUTSIDE, c.id, money);
    out.push(c);
  }
  return out;
}

/** Zona R de 3×3 en (20,20) con un bloque `res` en el centro. */
function block(s: GameState): ReturnType<typeof newBuilding> {
  for (let y = 19; y <= 21; y++) for (let x = 19; x <= 21; x++) s.map.zones[y * s.map.w + x] = Zone.R;
  const b = newBuilding(s, 'res', 20, 20, OUTSIDE);
  b.built = true;
  return b;
}

function vpo(s: GameState, x = 10, y = 10) {
  const b = newBuilding(s, 'vpo', x, y, TREASURY);
  b.built = true;
  return b;
}

/** Condiciones para crecer: suelo y demanda por encima del mínimo, día de mirar. */
function ready(s: GameState, b: { x: number; y: number }) {
  s.fields.land[b.y * s.map.w + b.x] = DENSITY.minLand + 10;
  s.demand.R = DENSITY.minDemandR + 10;
  s.tick = DENSITY.everyDays * TICKS_PER_DAY * 10;
}

describe('densidad de las zonas R (2.5)', () => {
  it('validación: solo zona R, dentro del mapa y con el nivel de ayuntamiento', () => {
    const s = blank();
    block(s);
    expect(validateCommand(s, { type: 'SetZoneDensity', x: 0, y: 0, w: 2, h: 2, level: 1 }).ok).toBe(false); // no es zona R
    expect(validateCommand(s, { type: 'SetZoneDensity', x: s.map.w - 1, y: 0, w: 3, h: 1, level: 1 }).ok).toBe(false); // fuera
    s.townhallLevel = 1;
    expect(validateCommand(s, { type: 'SetZoneDensity', x: 19, y: 19, w: 3, h: 3, level: 1 }).ok).toBe(false);
    s.townhallLevel = 2;
    expect(validateCommand(s, { type: 'SetZoneDensity', x: 19, y: 19, w: 3, h: 3, level: 1 }).ok).toBe(true);
    expect(validateCommand(s, { type: 'SetZoneDensity', x: 19, y: 19, w: 3, h: 3, level: 2 }).ok).toBe(false);
    s.townhallLevel = 3;
    // El rectángulo puede pisar casillas que no son R: solo cambian las R.
    expect(applyCommand(s, { type: 'SetZoneDensity', x: 18, y: 18, w: 5, h: 5, level: 2 }).ok).toBe(true);
    expect(densityAt(s, 20, 20)).toBe(2);
    expect(densityAt(s, 18, 18)).toBe(0);
  });

  it('un bloque crece a 4/8/12 viviendas, nivel a nivel, si el suelo y la demanda lo permiten', () => {
    const s = blank();
    const b = block(s);
    expect(homesOf(b)).toBe(4);
    applyCommand(s, { type: 'SetZoneDensity', x: 19, y: 19, w: 3, h: 3, level: 2 });
    ready(s, b);
    // Sin demanda no crece.
    s.demand.R = DENSITY.minDemandR;
    densityDay(s, 0);
    expect(b.dense ?? 0).toBe(0);
    // Sin suelo, tampoco.
    ready(s, b);
    s.fields.land[b.y * s.map.w + b.x] = DENSITY.minLand;
    densityDay(s, 0);
    expect(b.dense ?? 0).toBe(0);
    // Con viviendas libres de sobra, tampoco.
    ready(s, b);
    densityDay(s, DENSITY.maxFree);
    expect(b.dense ?? 0).toBe(0);
    // Un día que no toca mirar, tampoco.
    s.tick += TICKS_PER_DAY;
    densityDay(s, 0);
    expect(b.dense ?? 0).toBe(0);
    ready(s, b);
    densityDay(s, 0);
    expect(b.dense).toBe(1);
    expect(homesOf(b)).toBe(DENSITY.homes[1]);
    expect(homeCapacity(b)).toBe(8);
    densityDay(s, 0);
    expect(b.dense).toBe(2);
    expect(homeCapacity(b)).toBe(12);
    // Ya en lo más alto: no pasa de ahí.
    densityDay(s, 0);
    expect(b.dense).toBe(2);
    // Bajar la densidad no encoge lo construido (y no lo hace crecer más).
    applyCommand(s, { type: 'SetZoneDensity', x: 19, y: 19, w: 3, h: 3, level: 0 });
    densityDay(s, 0);
    expect(homesOf(b)).toBe(12);
    // Caben 12 vecinos sin que salte la invariante de casa sobreocupada.
    for (const c of people(s, 12)) c.homeId = b.id;
    expect(freeHomes(s)).toBe(0);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('sin `map.density` (partidas de antes), nada cambia', () => {
    const s = blank();
    const b = block(s);
    ready(s, b);
    delete s.map.density;
    densityDay(s, 0);
    expect(b.dense).toBeUndefined();
    expect(homesOf(b)).toBe(4);
  });

  it('ruido: +10 por nivel en la casilla del bloque', () => {
    const s = blank();
    const b = block(s);
    updateFields(s);
    const i = b.y * s.map.w + b.x;
    const base = s.fields.noise[i]!;
    b.dense = 1;
    updateFields(s);
    expect(s.fields.noise[i]! - base).toBe(DENSITY.noisePerLevel);
    b.dense = 2;
    updateFields(s);
    expect(s.fields.noise[i]! - base).toBe(2 * DENSITY.noisePerLevel);
  });
});

describe('vivienda protegida (2.5)', () => {
  it('no se reparte como una casa: no cuenta para las llegadas', () => {
    const s = blank();
    const v = vpo(s);
    expect(homesOf(v)).toBe(VPO.homes);
    expect(homeCapacity(v)).toBe(0);
  });

  it('sorteo determinista entre los que menos ganan (y quienes la pidieron)', () => {
    const s = blank();
    const v = vpo(s);
    const all = people(s, 14);
    all.forEach((c, k) => (c.last = { in: 400 + k * 100, out: 0, repaid: 0 }));
    const rich = all.at(-1)!;
    rich.vpoAsk = s.tick; // pidió: entra en el bombo aunque gane más
    const pool = vpoPool(s);
    expect(pool).toHaveLength(VPO.pool + 1);
    expect(pool.slice(0, VPO.pool)).toEqual(all.slice(0, VPO.pool));
    expect(pool).toContain(rich);
    // Mismo estado → mismo orden; clonado también.
    const copy = structuredClone(s);
    expect(vpoDraw(s, v, pool).map((c) => c.id)).toEqual(vpoDraw(copy, copy.buildings.find((b) => b.id === v.id)!, vpoPool(copy)).map((c) => c.id));
    const rng = JSON.stringify(s.rng);
    vpoMonth(s);
    expect(JSON.stringify(s.rng)).toBe(rng); // sin dados
    const tenants = s.citizens.filter((c) => c.homeId === v.id);
    expect(tenants).toHaveLength(VPO.homes);
    for (const c of tenants) expect(pool).toContain(c);
    vpoMonth(copy);
    expect(copy.citizens.filter((c) => c.homeId === v.id).map((c) => c.id)).toEqual(tenants.map((c) => c.id));
    // Lleno: el mes siguiente no entra nadie más.
    vpoMonth(s);
    expect(s.citizens.filter((c) => c.homeId === v.id)).toHaveLength(VPO.homes);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('alquiler de 120 € al ayuntamiento con charge: lo que no se paga, deuda', () => {
    const s = blank();
    const v = vpo(s);
    const [rich, poor] = people(s, 2, 0);
    transfer(s, OUTSIDE, rich!.id, 500);
    transfer(s, OUTSIDE, poor!.id, 50);
    rich!.homeId = v.id;
    poor!.homeId = v.id;
    const t0 = s.treasury;
    const rent0 = s.month.breakdown.alquileres ?? 0;
    const debt0 = s.debtLedger.created;
    vpoRentMonth(s);
    expect(rich!.money).toBe(500 - VPO.rent);
    expect(poor!.money).toBe(0);
    expect(poor!.debt?.town).toBe(VPO.rent - 50);
    expect(s.treasury - t0).toBe(VPO.rent + 50);
    // En el parte, como alquileres; la deuda, en el libro de deudas.
    expect((s.month.breakdown.alquileres ?? 0) - rent0).toBe(VPO.rent + 50);
    expect(s.debtLedger.created - debt0).toBe(VPO.rent - 50);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('IA: pedir_vpo al final del menú, solo con pisos libres; y por reglas si gana poco', () => {
    const s = blank();
    const [c] = people(s, 1, 500, true);
    c!.last = { in: 300, out: 0, repaid: 0 };
    expect(turnMenu(s, c!).some((m) => m.accion === 'pedir_vpo')).toBe(false);
    const v = vpo(s);
    expect(turnMenu(s, c!).at(-1)?.accion).toBe('pedir_vpo');
    expect(vpoRuleAction(s, c!)).toBe('pedir_vpo');
    expect(extraAction(s, c!, 'pedir_vpo', undefined)).toContain('sorteo');
    expect(c!.vpoAsk).toBe(s.tick);
    // Ya lo pidió: no vuelve a salir en unos meses.
    expect(turnMenu(s, c!).some((m) => m.accion === 'pedir_vpo')).toBe(false);
    // Quien gana bien no la pide por reglas.
    const [d] = people(s, 1, 500, true);
    d!.last = { in: 2_000, out: 0, repaid: 0 };
    expect(vpoRuleAction(s, d!)).toBeNull();
    // Quien ya vive en la VPO, tampoco.
    s.tick += VPO.askMonths * TICKS_PER_MONTH;
    c!.homeId = v.id;
    expect(vpoRuleAction(s, c!)).toBeNull();
  });

  it('dilema «la última VPO»: el motor da las opciones y la VPO espera a que decida el alcalde', () => {
    const s = blank();
    const v = vpo(s);
    // Hasta `minPop` vecinos para que haya dilemas; cinco ya viven en la VPO.
    const all = people(s, 45, 500);
    for (const c of all.slice(0, VPO.homes - 1)) c.homeId = v.id;
    for (const c of all) c.last = { in: 1_500, out: 0, repaid: 0 };
    const [x, y] = people(s, 2, 500, true);
    x!.last = { in: 200, out: 0, repaid: 0 };
    y!.last = { in: 300, out: 0, repaid: 0 };
    const cand = dilemmaCandidates(s).find((d) => d.kind === 'ultima_vpo');
    expect(cand?.citizenIds).toEqual([x!.id, y!.id]);
    expect(cand?.options).toEqual(['vpo_primero', 'vpo_segundo', 'vpo_sorteo']);
    const d = openDilemma(s, cand!.key)!;
    expect(d).toBeTruthy();
    // Con el dilema abierto, el sorteo del mes no toca ese piso.
    vpoMonth(s);
    expect(s.citizens.filter((c) => c.homeId === v.id)).toHaveLength(VPO.homes - 1);
    expect(canResolveDilemma(s, d.id, 'vpo_segundo').ok).toBe(true);
    const moodX = x!.happiness;
    resolveDilemma(s, d.id, 'vpo_segundo');
    expect(y!.homeId).toBe(v.id);
    expect(x!.homeId).not.toBe(v.id);
    expect(x!.happiness).toBeLessThan(moodX);
    expect(x!.grudge).toBeGreaterThan(0);
    expect(canResolveDilemma(s, d.id, 'vpo_primero').ok).toBe(false); // ya cerrado
    expect(checkInvariants(s)).toEqual([]);
  });

  it('dilema por sorteo: gana uno de los dos, el mismo en cualquier motor', () => {
    const s = blank();
    const v = vpo(s);
    const all = people(s, 45, 500);
    for (const c of all.slice(0, VPO.homes - 1)) c.homeId = v.id;
    for (const c of all) c.last = { in: 1_500, out: 0, repaid: 0 };
    const [x, y] = people(s, 2, 500, true);
    x!.last = { in: 200, out: 0, repaid: 0 };
    y!.last = { in: 300, out: 0, repaid: 0 };
    const key = dilemmaCandidates(s).find((d) => d.kind === 'ultima_vpo')!.key;
    const copy = structuredClone(s);
    const d = openDilemma(s, key)!;
    const d2 = openDilemma(copy, key)!;
    resolveDilemma(s, d.id, 'vpo_sorteo');
    resolveDilemma(copy, d2.id, 'vpo_sorteo');
    const win = [x!, y!].filter((c) => c.homeId === v.id);
    expect(win).toHaveLength(1);
    expect(copy.citizens.find((c) => c.homeId === v.id && c.named)?.id).toBe(win[0]!.id);
    // Por sorteo, nadie guarda rencor al alcalde.
    expect(x!.grudge + y!.grudge).toBe(0);
  });
});
