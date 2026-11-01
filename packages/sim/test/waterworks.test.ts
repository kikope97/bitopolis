import { TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  createInitialState,
  directorMenu,
  foundAssociation,
  type GameState,
  grievanceOf,
  greenFaction,
  newBuilding,
  OUTSIDE,
  pumpDirty,
  renewableFx,
  riverCourse,
  riverExit,
  riverLoad,
  runSimulation,
  startSpill,
  step,
  Terrain,
  Tile,
  updateFields,
  updateNetworks,
  updateRiver,
  validateCommand,
  waterworksMonth,
  WATERWORKS,
} from '../src/index.ts';

/**
 * Pueblo de prueba (ayuntamiento 3, 45 vecinos): un río de una casilla en la
 * columna 4 que baja de norte (nacimiento) a sur (salida, sin mar), una colina
 * en las columnas 40–44 y una calle en la fila 10.
 */
function fixture(): GameState {
  const s = createInitialState({ seed: 7 });
  const { w, h } = s.map;
  for (let i = 0; i < w * h; i++) {
    s.map.terrain[i] = Terrain.Flat;
    if (s.map.tiles[i] === Tile.Tree) s.map.tiles[i] = Tile.Grass;
  }
  for (let y = 0; y < h; y++) {
    s.map.terrain[y * w + 4] = Terrain.River;
    for (let x = 40; x <= 44; x++) s.map.terrain[y * w + x] = Terrain.Hill;
  }
  for (let x = 5; x < w; x++) s.map.tiles[10 * w + x] = Tile.Road;
  s.townhallLevel = 3;
  const t0 = s.treasury;
  s.treasury = 50_000;
  const base = s.citizens[0]!;
  for (let k = 0; k < 44; k++) s.citizens.push({ ...structuredClone(base), id: s.nextId++, jobId: null, homeId: null, named: k < 10, name: `Vecino ${k}` });
  s.ledger.initialTotal += 44 * base.money + 50_000 - t0;
  return s;
}

function built(s: GameState, kind: Parameters<typeof newBuilding>[1], x: number, y: number) {
  const b = newBuilding(s, kind, x, y, 0);
  b.built = true;
  return b;
}

const at = (s: GameState, x: number, y: number) => s.fields.river[y * s.map.w + x]!;

describe('río aguas abajo', () => {
  it('orden por BFS desde la salida (sin mar, la casilla de borde más alta)', () => {
    const s = fixture();
    const c = riverCourse(s);
    const h = s.map.h;
    expect(c.rivers).toHaveLength(1);
    expect(c.section[4]).toBe(h - 1);
    expect(c.section[(h - 1) * s.map.w + 4]).toBe(0);
  });

  it('lo que se echa se arrastra aguas abajo y se diluye', () => {
    const s = fixture();
    for (let k = 0; k < 5; k++) built(s, 'factory', 6, 3 + k); // a 2 casillas del río
    const load = riverLoad(s).value[0]!;
    const h = s.map.h;
    const sec = (y: number) => h - 1 - y;
    expect(load[sec(2)]).toBe(0); // aguas arriba, limpio
    const top = WATERWORKS.dump.factory! * 5;
    // Cada taller echa a su tramo; en el último ya baja todo.
    expect(load[sec(7)]).toBeGreaterThan(top * 0.85);
    expect(load[sec(7)]).toBeLessThan(top);
    // Y sigue bajando: a la salida, 4 % menos por casilla.
    expect(load[0]).toBeCloseTo(load[sec(7)]! * (1 - WATERWORKS.decayPerTile) ** sec(7), 6);
    for (let y = 8; y < h; y++) expect(load[sec(y)]!).toBeLessThan(load[sec(y - 1)]!);
    updateRiver(s);
    expect(at(s, 4, 7)).toBe(Math.round(load[sec(7)]!));
    expect(riverExit(s)).toBe(Math.round(load[0]!));
    expect(at(s, 10, 10)).toBe(0); // fuera del río
  });

  it('a más de `reach` casillas no se echa nada', () => {
    const s = fixture();
    built(s, 'factory', 4 + WATERWORKS.reach + 1, 5);
    expect(riverLoad(s).dumpers).toBe(0);
  });

  it('la depuradora quita el 85 % de lo que viene de arriba', () => {
    const s = fixture();
    for (let k = 0; k < 5; k++) built(s, 'factory', 6, 3 + k);
    built(s, 'res', 5, 12);
    const before = riverLoad(s).value[0]![0]!;
    built(s, 'sewage', 6, 20);
    const r = riverLoad(s);
    expect(r.treated).toBe(6);
    expect(r.value[0]![0]! / before).toBeCloseTo(1 - WATERWORKS.sewage.clean, 6);
    // Lo que se echa aguas abajo de la depuradora no se trata.
    built(s, 'factory', 6, 30);
    expect(riverLoad(s).treated).toBe(6);
  });

  it('la depuradora tiene que ir junto al río', () => {
    const s = fixture();
    expect(validateCommand(s, { type: 'Build', kind: 'sewage', x: 20, y: 9 })).toMatchObject({ ok: false });
    expect(validateCommand(s, { type: 'Build', kind: 'sewage', x: 7, y: 9 })).toEqual({ ok: true });
  });

  it('río sucio: la bomba pierde su +25 % y la orilla resta ánimo', () => {
    const s = fixture();
    expect(pumpDirty(s, 5, 9)).toBe(false);
    s.fields.river[9 * s.map.w + 4] = WATERWORKS.dirtyPump + 5;
    expect(pumpDirty(s, 5, 9)).toBe(true);
    // Con la bomba en la orilla, sucia, da agua solo a su capacidad base.
    const pump = built(s, 'water', 5, 9);
    built(s, 'power', 30, 9);
    for (let x = 6; x < 6 + 60; x++) if (x < s.map.w) built(s, 'res', x, 11);
    for (let x = 6; x < s.map.w && x < 40; x++) if (x !== 30) built(s, 'res', x, 9);
    updateNetworks(s);
    const dirty = s.buildings.filter((b) => b.hasWater && b !== pump).length;
    s.fields.river.fill(0);
    updateNetworks(s);
    const clean = s.buildings.filter((b) => b.hasWater && b !== pump).length;
    expect(clean).toBeGreaterThan(dirty);
  });

  it('multa trimestral de la Confederación, en el ledger', () => {
    const s = fixture();
    const mouth = (s.map.h - 1) * s.map.w + 4;
    s.fields.river[mouth] = WATERWORKS.fineAt + 10;
    s.tick = 4 * TICKS_PER_MONTH;
    const out0 = s.ledger.externalOut;
    const t0 = s.treasury;
    waterworksMonth(s);
    expect(s.treasury).toBe(t0); // no es fin de trimestre
    s.tick = 3 * TICKS_PER_MONTH;
    waterworksMonth(s);
    expect(s.treasury).toBe(t0 - WATERWORKS.fine);
    expect(s.ledger.externalOut - out0).toBe(WATERWORKS.fine);
    expect(s.month.breakdown['multa del río']).toBe(-WATERWORKS.fine);
    expect(s.events.at(-1)!.text).toContain('Confederación');
    expect(checkInvariants(s)).toEqual([]);
    // Con el río limpio, no hay multa.
    s.fields.river[mouth] = WATERWORKS.fineAt;
    s.tick = 6 * TICKS_PER_MONTH;
    waterworksMonth(s);
    expect(s.treasury).toBe(t0 - WATERWORKS.fine);
    expect(OUTSIDE).toBe(-1);
  });
});

describe('renovables', () => {
  it('el molino solo en la colina; las placas en llano o colina', () => {
    const s = fixture();
    const flat = validateCommand(s, { type: 'Build', kind: 'wind', x: 20, y: 9 });
    expect(flat.ok).toBe(false);
    expect(!flat.ok && flat.error).toContain('colina');
    expect(validateCommand(s, { type: 'Build', kind: 'wind', x: 41, y: 9 })).toEqual({ ok: true });
    expect(validateCommand(s, { type: 'Build', kind: 'solar', x: 20, y: 9 })).toEqual({ ok: true });
    expect(validateCommand(s, { type: 'Build', kind: 'solar', x: 42, y: 11 })).toEqual({ ok: true });
  });

  it('capacidad estacional: placas menos en invierno y con nieve; molino más con tormenta', () => {
    const s = fixture();
    s.weather = { kind: 'sol', until: 1e9 };
    s.tick = 0; // enero
    expect(renewableFx(s, 'solar')).toBe(WATERWORKS.solar.winter);
    s.weather.kind = 'nieve';
    expect(renewableFx(s, 'solar')).toBe(WATERWORKS.solar.snow);
    s.tick = 6 * TICKS_PER_MONTH + 1; // julio
    s.weather.kind = 'sol';
    expect(renewableFx(s, 'solar')).toBe(1);
    expect(renewableFx(s, 'wind')).toBe(1);
    s.weather.kind = 'tormenta';
    expect(renewableFx(s, 'wind')).toBe(WATERWORKS.wind.storm);

    // En la red: unas placas solas dan luz a 15 edificios en verano y a 9 en invierno.
    const solar = built(s, 'solar', 20, 9);
    for (let x = 6; x < s.map.w; x++) built(s, 'res', x, 11);
    s.weather.kind = 'sol';
    const lit = () => {
      updateNetworks(s);
      return s.buildings.filter((b) => b.hasPower && b.kind === 'res').length;
    };
    expect(lit()).toBe(WATERWORKS.solar.buildings);
    s.tick = 0;
    expect(lit()).toBe(Math.round(WATERWORKS.solar.buildings * WATERWORKS.solar.winter));
    // El molino, con tormenta, a 36.
    solar.built = false;
    built(s, 'wind', 41, 9);
    s.weather.kind = 'tormenta';
    expect(lit()).toBe(Math.round(WATERWORKS.wind.buildings * WATERWORKS.wind.storm));
  });

  it('el molino hace ruido (sin contaminar), contenta a los ecologistas y molesta a los jubilados cerca', () => {
    const s = fixture();
    expect(greenFaction(s)).toBe(0);
    built(s, 'wind', 41, 9);
    updateFields(s);
    const i = 9 * s.map.w + 41;
    expect(s.fields.noise[i]).toBeGreaterThanOrEqual(WATERWORKS.wind.noise);
    expect(s.fields.pollution[i]).toBe(0);
    expect(greenFaction(s)).toBe(WATERWORKS.greenPerRenewable);
    const home = built(s, 'res', 42, 11);
    home.hasWater = home.hasPower = true;
    const c = s.citizens[1]!;
    c.homeId = home.id;
    c.age = 70;
    expect(grievanceOf(s, c)).toBe('ruido_molinos');
    c.age = 40;
    expect(grievanceOf(s, c)).not.toBe('ruido_molinos');
  });
});

describe('IA: vertidos y «Salvemos el río»', () => {
  it('el director puede proponer un vertido (malo) si no hay depuradora', () => {
    const s = fixture();
    const f = built(s, 'factory', 6, 5);
    const v = directorMenu(s).find((c) => c.kind === 'vertido');
    expect(v).toMatchObject({ id: `vertido:${f.id}`, bad: true });
    const before = riverLoad(s).value[0]![0]!;
    expect(startSpill(s, f.id)).toBe(true);
    expect(riverLoad(s).value[0]![0]!).toBeCloseTo(before * WATERWORKS.spill.mult, 6);
    // Ya vierte: no se repite; con depuradora, tampoco.
    expect(directorMenu(s).some((c) => c.kind === 'vertido')).toBe(false);
    delete f.spill;
    built(s, 'sewage', 6, 30);
    expect(directorMenu(s).some((c) => c.kind === 'vertido')).toBe(false);
  });

  it('quien vive en la orilla de un río sucio se queja: «Salvemos el río»', () => {
    const s = fixture();
    const home = built(s, 'res', 5, 14);
    home.hasWater = home.hasPower = true;
    const c = s.citizens[1]!;
    c.homeId = home.id;
    expect(grievanceOf(s, c)).not.toBe('rio');
    s.fields.river[14 * s.map.w + 4] = 80;
    expect(grievanceOf(s, c)).toBe('rio');
    const a = foundAssociation(s, 'rio', [c]);
    expect(a.name).toBe('Asociación Salvemos el Río');
  });
});

describe('sin río', () => {
  it('un mapa llano no tiene río: todo a cero y sin depuradora', () => {
    const s = createInitialState({ seed: 3, terrain: 'llano' });
    expect(riverCourse(s).tiles).toHaveLength(0);
    for (let k = 0; k < 24 * 40; k++) step(s);
    expect(s.fields.river.every((v) => v === 0)).toBe(true);
    expect(riverExit(s)).toBe(0);
    s.townhallLevel = 3;
    const r = validateCommand(s, { type: 'Build', kind: 'sewage', x: 25, y: 23 });
    expect(r.ok).toBe(false);
  });

  it('el simulador con río y sin él cuadra (dinero y deudas)', () => {
    for (const terrain of ['llano', 'rio'] as const) {
      const { report } = runSimulation({ seed: 11, days: 200, profile: 'constructor', terrain });
      expect(report.invariantErrors).toEqual([]);
      expect(report.river.hasRiver).toBe(terrain === 'rio');
    }
  });
});
