import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  businessTaxes,
  checkInvariants,
  createInitialState,
  cropAt,
  directorMenu,
  expectedHarvest,
  extraAction,
  FARM,
  farmMonth,
  farmOutlook,
  farmWeatherDay,
  floodFarm,
  type GameState,
  hashState,
  migrate,
  moneyDrift,
  monthRates,
  newBuilding,
  replay,
  runSimulation,
  step,
  Terrain,
  Tile,
  turnMenu,
  unitValue,
  validateCommand,
  Zone,
} from '../src/index.ts';

/**
 * Un pueblo de prueba con ayuntamiento de nivel 2 y 24 vecinos sin trabajo: un
 * río en la columna 4, una colina en las columnas 40–44 y una calle en la fila 10.
 */
function fixture(opts: { aiMode?: boolean } = {}) {
  const s = createInitialState({ seed: 7, aiMode: opts.aiMode });
  const { w, h } = s.map;
  for (let i = 0; i < w * h; i++) {
    s.map.terrain[i] = Terrain.Flat;
    if (s.map.tiles[i] === Tile.Tree) s.map.tiles[i] = Tile.Grass;
  }
  for (let y = 0; y < h; y++) {
    s.map.terrain[y * w + 4] = Terrain.River;
    for (let x = 40; x <= 44; x++) s.map.terrain[y * w + x] = Terrain.Hill;
  }
  for (let x = 6; x < w; x++) s.map.tiles[10 * w + x] = Tile.Road;
  s.townhallLevel = 2;
  const base = s.citizens[0]!;
  for (let k = 0; k < 23; k++) s.citizens.push({ ...structuredClone(base), id: s.nextId++, jobId: null, named: k < 3, name: `Vecino ${k}` });
  s.ledger.initialTotal += 23 * base.money;
  return s;
}

/** Finca ya construida en (x, y), en zona A. */
function farmAt(s: GameState, x: number, y: number) {
  s.map.zones[y * s.map.w + x] = Zone.A;
  const b = newBuilding(s, 'farm', x, y, -1);
  b.built = true;
  b.crop = cropAt(s, x, y);
  b.yieldFx = FARM.start;
  return b;
}

/** Pone el reloj al día `day` (1–30) del mes `month` (1–12) del año 1. */
const at = (s: GameState, month: number, day = 1) => (s.tick = (month - 1) * TICKS_PER_MONTH + (day - 1) * TICKS_PER_DAY);

describe('el campo (2.2)', () => {
  it('el cultivo sale del terreno: regadío junto al río, olivar o viñedo en la colina, secano en el resto', () => {
    const s = fixture();
    expect(cropAt(s, 5, 9)).toBe('regadio');
    expect(cropAt(s, 6, 20)).toBe('regadio');
    expect(cropAt(s, 7, 20)).toBe('secano');
    expect(cropAt(s, 20, 9)).toBe('secano');
    const hill = [40, 41, 42, 43, 44].map((x) => cropAt(s, x, 11));
    for (const c of hill) expect(['olivar', 'vinedo']).toContain(c);
    // Por hash: en una colina de 5 casillas salen los dos.
    expect(new Set([...hill, ...[40, 41, 42, 43, 44].map((x) => cropAt(s, x, 12))]).size).toBe(2);
    // Determinista.
    expect(cropAt(s, 42, 11)).toBe(cropAt(structuredClone(s), 42, 11));
  });

  it('la zona agraria pide ayuntamiento de nivel 2 y 20 vecinos', () => {
    const s = fixture();
    const cmd = { type: 'Zone', zone: 'A', x: 20, y: 11, w: 2, h: 1 } as const;
    expect(validateCommand(s, cmd).ok).toBe(true);
    s.townhallLevel = 1;
    expect(validateCommand(s, cmd)).toMatchObject({ ok: false, error: expect.stringContaining('nivel 2') });
    s.townhallLevel = 2;
    s.citizens = s.citizens.slice(0, 19);
    expect(validateCommand(s, cmd)).toMatchObject({ ok: false, error: expect.stringContaining('20 vecinos') });
  });

  it('crece una finca en la zona A con carretera (sin agua ni luz), con su cultivo, un empleo y sin descuadrar el dinero', () => {
    const s = fixture();
    expect(applyCommand(s, { type: 'Zone', zone: 'A', x: 20, y: 11, w: 3, h: 1 }).ok).toBe(true);
    expect(s.buildings.some((b) => b.kind === 'water' || b.kind === 'power')).toBe(false);
    for (let d = 0; d < 40 && !s.buildings.some((b) => b.kind === 'farm' && b.built); d++) for (let k = 0; k < TICKS_PER_DAY; k++) step(s);
    const farm = s.buildings.find((b) => b.kind === 'farm')!;
    expect(farm.built).toBe(true);
    expect(farm.crop).toBe('secano');
    expect(s.map.zones[farm.y * s.map.w + farm.x]).toBe(Zone.A);
    for (let k = 0; k < TICKS_PER_DAY * 2; k++) step(s);
    expect(s.citizens.filter((c) => c.jobId === farm.id)).toHaveLength(FARM.jobs);
    expect(checkInvariants(s)).toEqual([]);
    expect(moneyDrift(s)).toBe(0);
  });

  it('sin zona A no hay fincas ni se tira ningún dado de más', () => {
    const a = fixture();
    const b = structuredClone(a);
    for (let k = 0; k < 5 * TICKS_PER_DAY; k++) step(a);
    for (let k = 0; k < 5 * TICKS_PER_DAY; k++) step(b);
    expect(a.buildings.some((x) => x.kind === 'farm')).toBe(false);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('rendimiento con el tiempo fijado: la lluvia suma, el calor resta, el regadío lo nota poco y la tormenta del mes de cosecha quita un 15 %', () => {
    const s = fixture();
    at(s, 3);
    const dry = farmAt(s, 20, 11);
    const wet = farmAt(s, 5, 11);
    s.weather = { kind: 'lluvia', until: 1e9 };
    for (let i = 0; i < 10; i++) farmWeatherDay(s);
    expect(dry.yieldFx).toBeCloseTo(FARM.start + 10 * (FARM.rain + FARM.dry), 3);
    expect(wet.yieldFx).toBeCloseTo(FARM.start + 10 * FARM.irrigated * (FARM.rain + FARM.dry), 3);
    s.weather = { kind: 'calor', until: 1e9 };
    for (let i = 0; i < 20; i++) farmWeatherDay(s);
    expect(dry.yieldFx).toBeCloseTo(FARM.start + 10 * (FARM.rain + FARM.dry) + 20 * (FARM.heat + FARM.dry), 3);
    // Tormenta en julio (siega del secano): −15 %.
    at(s, FARM.harvestMonth.secano, 5);
    dry.yieldFx = 1;
    s.weather = { kind: 'tormenta', until: 1e9 };
    farmWeatherDay(s);
    expect(dry.yieldFx).toBeCloseTo((1 + FARM.dry) * (1 + FARM.storm), 3);
    expect(dry.stormed).toBe(s.tick);
    // Previsión: buena, normal o mala.
    dry.yieldFx = 1.2;
    expect(farmOutlook(dry)).toBe('buena');
    dry.yieldFx = 0.6;
    expect(farmOutlook(dry)).toBe('mala');
    dry.yieldFx = 1.9;
    // Se acumula sin recortar, pero se vende recortado.
    expect(expectedHarvest(dry)).toBe(Math.round(FARM.base.secano * FARM.max));
  });

  it('una riada se lleva el 60 % de la cosecha del regadío (y el secano no la nota)', () => {
    const s = fixture();
    const wet = farmAt(s, 5, 11);
    const dry = farmAt(s, 20, 11);
    floodFarm(wet);
    floodFarm(dry);
    expect(wet.yieldFx).toBeCloseTo(FARM.start * (1 + FARM.flood), 3);
    expect(dry.yieldFx).toBe(FARM.start);
  });

  it('la cosecha: vende con transfer al cerrar su mes, paga a los temporeros del pueblo, vuelve a empezar y sale en el álbum', () => {
    const s = fixture();
    const b = farmAt(s, 20, 11);
    b.yieldFx = 1.1;
    const fixed = s.citizens[1]!;
    fixed.jobId = b.id;
    // Un vecino se apunta de temporero (Modo IA): va el primero.
    const eager = s.citizens.at(-1)!;
    at(s, FARM.harvestMonth.secano, 10);
    expect(extraAction(s, eager, 'temporero', undefined)).toContain('temporero');
    at(s, FARM.harvestMonth.secano + 1, 1);
    const before = { treasury: s.treasury, eager: eager.money };
    farmMonth(s);
    const sale = Math.round(FARM.base.secano * 1.1);
    expect(b.cash).toBe(sale - FARM.seasonal * FARM.seasonalWage);
    expect(b.sales).toBe(sale);
    expect(b.harvested).toBe(1);
    expect(b.yieldFx).toBe(FARM.start);
    expect(eager.money).toBe(before.eager + FARM.seasonalWage);
    expect(eager.temporero).toBeUndefined();
    expect(s.treasury).toBe(before.treasury);
    expect(s.album.some((m) => m.kind === 'primera_cosecha')).toBe(true);
    expect(s.events.at(-1)!.text).toMatch(/^Primera cosecha del pueblo/);
    expect(moneyDrift(s)).toBe(0);
    // Ese año ya no vuelve a vender.
    farmMonth(s);
    expect(b.sales).toBe(sale);
  });

  it('IBI rústico: una finca paga el 30 % del IBI de su valor', () => {
    const s = fixture();
    const b = farmAt(s, 20, 11);
    b.cash = 5_000;
    const r = monthRates(s);
    businessTaxes(s, b, r);
    expect(5_000 - b.cash).toBe(Math.round((unitValue(s, b) * r.ibi * FARM.ibiRustic) / 12));
  });

  it('no cierra por un mes malo: aguanta sin pagar el sueldo hasta que se le acaba el plazo', () => {
    const s = fixture();
    const b = farmAt(s, 20, 11);
    s.citizens[1]!.jobId = b.id;
    b.unpaidMonths = 2;
    at(s, 2, 30);
    s.tick += TICKS_PER_DAY - 1;
    step(s);
    expect(s.buildings.includes(b)).toBe(true);
    expect(b.unpaidMonths).toBe(3);
  });

  it('invariantes: finca solo en zona A y con el cultivo de su terreno', () => {
    const s = fixture();
    const b = farmAt(s, 20, 11);
    expect(checkInvariants(s)).toEqual([]);
    b.crop = 'olivar';
    expect(checkInvariants(s).join()).toContain('cultivo incoherente');
    b.crop = 'secano';
    s.map.zones[11 * s.map.w + 20] = Zone.R;
    expect(checkInvariants(s).join()).toContain('fuera de la zona agraria');
  });

  it('Modo IA: «temporero» para parados en el mes de cosecha; la fiesta de la cosecha y el granizo (solo tras una tormenta) en el menú del director', () => {
    const s = fixture({ aiMode: true });
    const b = farmAt(s, 41, 11);
    const c = s.citizens[2]!;
    at(s, 3);
    expect(turnMenu(s, c).some((m) => m.accion === 'temporero')).toBe(false);
    expect(directorMenu(s).some((m) => m.id.startsWith('granizo:'))).toBe(false);
    at(s, FARM.harvestMonth[b.crop!], 3);
    expect(turnMenu(s, c).some((m) => m.accion === 'temporero')).toBe(true);
    c.jobId = s.buildings[0]!.id;
    expect(turnMenu(s, c).some((m) => m.accion === 'temporero')).toBe(false);
    const feast = directorMenu(s).find((m) => m.id === `cosecha:${b.id}`);
    expect(feast).toMatchObject({ kind: 'cosecha', bad: false });
    expect(feast!.text).toMatch(b.crop === 'vinedo' ? /vendimia/ : /cosecha/);
    s.weather = { kind: 'tormenta', until: s.tick + TICKS_PER_DAY };
    farmWeatherDay(s);
    expect(directorMenu(s).find((m) => m.id === `granizo:${b.id}`)).toMatchObject({ kind: 'granizo', bad: true });
  });

  it('migración 14 → 15: sin fincas, nada cambia salvo la versión', () => {
    const s = createInitialState({ seed: 3 }) as unknown as Record<string, unknown>;
    const old = { ...structuredClone(s), formatVersion: 14 };
    const m = migrate(old);
    expect(m.formatVersion).toBe(15);
    expect(m.buildings).toEqual((s as unknown as GameState).buildings);
    // Una finca sin factor (por si acaso) empieza con el inicial.
    const odd = { ...structuredClone(s), formatVersion: 14, buildings: [{ id: 1, kind: 'farm', crop: 'secano' }] };
    expect(migrate(odd).buildings[0]!.yieldFx).toBe(FARM.start);
  });

  it('determinista: el perfil «campo» da el mismo estado dos veces y al reproducir sus comandos', () => {
    const a = runSimulation({ seed: 11, days: 420, profile: 'campo' });
    const b = runSimulation({ seed: 11, days: 420, profile: 'campo' });
    expect(a.report.stateHash).toBe(b.report.stateHash);
    expect(a.state.buildings.some((x) => x.kind === 'farm')).toBe(true);
    expect(a.report.invariantErrors).toEqual([]);
    expect(hashState(replay(11, a.report.commands, a.state.tick))).toBe(a.report.stateHash);
  });
});
