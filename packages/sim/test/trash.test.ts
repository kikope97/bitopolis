import { TICKS_PER_DAY } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyDirector,
  canDump,
  checkInvariants,
  createInitialState,
  directorMenu,
  dumpTrash,
  extraAction,
  type GameState,
  happinessFactors,
  hashState,
  migrate,
  missingServices,
  monthlyHousing,
  monthRates,
  newBuilding,
  runSimulation,
  Tile,
  TRASH,
  trashDay,
  trashServed,
  trashStateOf,
  truckRouteOf,
  truckRoutes,
  turnMenu,
  updateFactions,
  updateFields,
  upgradeReqs,
} from '../src/index.ts';

/**
 * Un pueblo de prueba: una calle larga en la fila 30 que gira por la columna 47
 * (48 + 17 = 65 casillas, más de las 60 que recorre el camión), cuatro casas
 * en la calle y una al final del todo, con 3 vecinos cada una.
 */
function fixture(opts: { aiMode?: boolean; terco?: number } = {}) {
  const s = createInitialState({ seed: 5, aiMode: opts.aiMode });
  s.trash = { start: 0 };
  const { w } = s.map;
  for (let x = 0; x < w; x++) s.map.tiles[30 * w + x] = Tile.Road;
  for (let y = 31; y < 48; y++) s.map.tiles[y * w + 47] = Tile.Road;
  const homes = [];
  for (const [x, y] of [[2, 29], [5, 29], [20, 29], [40, 29], [46, 45]] as const) {
    s.map.tiles[y * w + x] = Tile.Grass;
    const b = newBuilding(s, 'house', x, y, 0);
    b.built = true;
    homes.push(b);
  }
  let id = 10_000;
  for (const b of homes) {
    for (let k = 0; k < 3; k++) s.citizens.push({ ...structuredClone(s.citizens[0]!), id: id++, homeId: b.id, jobId: null, named: k === 0, money: 1_000, traits: { terco: opts.terco ?? 90, ahorro: 50, social: 50, ambicion: 50 } });
  }
  return { s, homes };
}

function cleanPoint(s: GameState, level = 1) {
  s.map.tiles[31 * s.map.w + 0] = Tile.Grass;
  const p = newBuilding(s, 'cleanpoint', 0, 31, 0);
  p.built = true;
  if (level > 1) p.level = level;
  return p;
}

function days(s: GameState, n: number) {
  for (let i = 0; i < n; i++) {
    s.tick += TICKS_PER_DAY;
    trashDay(s);
    updateFields(s);
  }
}

describe('basura y punto limpio (2.1)', () => {
  it('sin recogida, la basura se acumula: bolsas, suciedad en la calle, ratas, menos felicidad y más delincuencia', () => {
    const { s, homes } = fixture({ terco: 10 });
    const clean = structuredClone(s);
    updateFields(clean);
    days(s, 1);
    // 3 vecinos × 2 al día.
    expect(homes[0]!.trash).toBe(3 * TRASH.perResident);
    expect(trashStateOf(homes[0]!)).toBe('limpio');
    days(s, 7);
    expect(trashStateOf(homes[0]!)).toBe('bolsas');
    const i = homes[0]!.y * s.map.w + homes[0]!.x;
    expect(s.fields.dirt[i]).toBeGreaterThanOrEqual(TRASH.dirtyField);
    const lucia = s.citizens.find((c) => c.homeId === homes[0]!.id)!;
    expect(happinessFactors(s, lucia)).toContainEqual({ label: 'Basura en la calle', value: -TRASH.dirtyMood });
    days(s, 14);
    expect(trashStateOf(homes[0]!)).toBe('ratas');
    expect(happinessFactors(s, lucia)).toContainEqual({ label: 'Ratas en el barrio', value: -TRASH.ratsMood });
    expect(s.events.some((e) => e.text.startsWith('Hay ratas en'))).toBe(true);
    // La delincuencia sube (hasta un 10 %) donde la calle está sucia.
    expect(s.fields.crime[i]!).toBeGreaterThan(clean.fields.crime[i]!);
    expect(s.fields.crime[i]!).toBeLessThanOrEqual(Math.ceil(clean.fields.crime[i]! * (1 + TRASH.crimeBoost)) + 1);
    // Tope.
    days(s, 30);
    expect(homes[0]!.trash).toBeLessThanOrEqual(TRASH.max);
  });

  it('el camión recorre sus casillas por la red desde el punto limpio y vacía lo que da a ellas; lo lejano, no', () => {
    const { s, homes } = fixture();
    const p = cleanPoint(s);
    const [route] = truckRoutes(s);
    expect(route!.roads.length).toBe(truckRouteOf(p));
    expect(route!.roads[0]).toBe(30 * s.map.w + 0);
    const served = trashServed(s);
    for (const b of homes.slice(0, 4)) expect(served.get(b.id)?.id).toBe(p.id);
    expect(served.has(homes[4]!.id)).toBe(false);
    days(s, 20);
    for (const b of homes.slice(0, 4)) expect(b.trash).toBeUndefined();
    expect(trashStateOf(homes[4]!)).not.toBe('limpio');
    expect(missingServices(s, homes[0]!.x, homes[0]!.y).some((n) => n.key === 'basuras')).toBe(false);
    // Al final de la calle: llega el camión, pero ya no da para más («lleno»).
    expect(missingServices(s, homes[4]!.x, homes[4]!.y)).toContainEqual({ key: 'basuras', status: 'lleno' });
    // El nivel 2 recorre más calles (y la mejora pide que ya se use).
    expect(upgradeReqs(s, p).find((r) => r.label.startsWith('Que se use'))?.ok).toBe(true);
    p.level = 2;
    expect(trashServed(s).has(homes[4]!.id)).toBe(true);
  });

  it('con nieve, el camión no llega a las calles nevadas del fondo ese día', () => {
    const { s, homes } = fixture();
    cleanPoint(s);
    s.weather = { kind: 'nieve', until: s.tick + 10 * TICKS_PER_DAY };
    expect(truckRoutes(s, true)[0]!.roads.length).toBe(Math.round(TRASH.route * TRASH.snowRoute));
    days(s, 1);
    expect(homes[0]!.trash).toBeUndefined();
    expect(homes[3]!.trash).toBe(3 * TRASH.perResident);
    s.weather = { kind: 'sol', until: s.tick + 10 * TICKS_PER_DAY };
    days(s, 1);
    expect(homes[3]!.trash).toBeUndefined();
  });

  it('la tasa de basuras solo se cobra con recogida; el reciclaje la abarata un 20 % y el compost da algo de ingreso', () => {
    const { s } = fixture();
    const base = monthRates(s).basuras;
    const fees = (st: GameState) => {
      const t = structuredClone(st);
      t.month.breakdown = {};
      monthlyHousing(t, monthRates(t));
      return { tasas: t.month.breakdown.tasas ?? 0, abono: t.month.breakdown.abono ?? 0 };
    };
    // Sin punto limpio, nadie paga la tasa.
    expect(fees(s).tasas).toBe(0);
    const p = cleanPoint(s);
    // 4 casas con camión × 3 vecinos (la del fondo no tiene).
    expect(fees(s)).toEqual({ tasas: 12 * base, abono: 0 });
    p.level = 2;
    // En el nivel 2 llega a todas.
    expect(fees(s)).toEqual({ tasas: 15 * Math.round(base * (1 - TRASH.recyclingDiscount)), abono: 0 });
    p.level = 3;
    expect(fees(s).abono).toBe(15 * TRASH.compostPerResident);
  });

  it('el reciclaje contenta a los ecologistas y, con la calle sucia, piden recogida', () => {
    const { s } = fixture();
    days(s, 25);
    updateFactions(s);
    const dirty = s.politics.factions.ecologistas;
    const p = cleanPoint(s);
    days(s, 3);
    updateFactions(s);
    const served = s.politics.factions.ecologistas;
    p.level = 2;
    updateFactions(s);
    const recycling = s.politics.factions.ecologistas;
    if (dirty.members > 0) expect(dirty.unmet).toContain('recogida de basura');
    expect(recycling.satisfaction).toBeGreaterThan(served.satisfaction);
  });

  it('empieza cuando se puede construir el punto limpio, con aviso; las partidas de antes tienen 60 días de gracia', () => {
    const s = createInitialState({ seed: 2 });
    expect(s.trash).toEqual({ start: -1 });
    trashDay(s);
    expect(s.trash!.start).toBe(-1);
    s.townhallLevel = 2;
    for (let i = 0; i < 25; i++) s.citizens.push({ ...structuredClone(s.citizens[0]!), id: 50_000 + i, money: 0 });
    trashDay(s);
    expect(s.trash!.start).toBe(s.tick + TRASH.warnDays * TICKS_PER_DAY);
    expect(s.events.at(-1)!.text).toMatch(/punto limpio/);
    // Una partida de antes (formato 13).
    const old = structuredClone(createInitialState({ seed: 2 })) as unknown as Record<string, any>;
    old.formatVersion = 13;
    old.tick = 5_000;
    delete old.trash;
    delete old.fields.dirt;
    const m = migrate(old);
    expect(m.formatVersion).toBe(14);
    expect(m.trash).toEqual({ start: -1, graceUntil: 5_000 + TRASH.graceDays * TICKS_PER_DAY });
    expect(m.fields.dirt).toHaveLength(m.map.w * m.map.h);
    m.townhallLevel = 2;
    for (let i = 0; i < 25; i++) m.citizens.push({ ...structuredClone(m.citizens[0]!), id: 60_000 + i, money: 0 });
    trashDay(m);
    expect(m.trash!.start).toBe(5_000 + TRASH.graceDays * TICKS_PER_DAY);
  });

  it('tirar la basura al monte: solo sin camión y con la basura en la puerta; contamina cerca y está mal visto', () => {
    const { s, homes } = fixture();
    const c = s.citizens.find((x) => x.homeId === homes[0]!.id && x.named)!;
    expect(canDump(s, c)).toBe(false);
    days(s, 8);
    expect(canDump(s, c)).toBe(true);
    expect(turnMenu(s, c).some((m) => m.accion === 'tirar_al_monte')).toBe(true);
    const i = homes[0]!.y * s.map.w + homes[0]!.x;
    const before = s.fields.pollution[i]!;
    const neighbour = s.citizens.find((x) => x.homeId === homes[1]!.id && x.named)!;
    expect(extraAction(s, c, 'tirar_al_monte', undefined)).toMatch(/monte/);
    expect(homes[0]!.trash).toBeUndefined();
    expect(s.fields.pollution[i]!).toBeGreaterThan(before);
    expect(c.memories.some((m) => m.kind === 'tiro_basura')).toBe(true);
    expect(neighbour.memories.some((m) => m.kind === 'vio_tirar_basura' && m.about.includes(c.id))).toBe(true);
    // Con camión ya no está en el menú.
    days(s, 8);
    cleanPoint(s, 2);
    expect(turnMenu(s, c).some((m) => m.accion === 'tirar_al_monte')).toBe(false);
    days(s, 1);
    expect(dumpTrash(s, c)).toBe('no tiene basura que tirar');
  });

  it('por reglas, el vecino terco con ratas en casa la tira al monte de vez en cuando', () => {
    const { s } = fixture();
    days(s, 60);
    expect(s.citizens.some((c) => c.memories.some((m) => m.kind === 'tiro_basura'))).toBe(true);
  });

  it('el director propone una plaga de ratas donde no pasa el camión (lo justifican los datos) y la extiende', () => {
    const { s, homes } = fixture({ aiMode: true });
    cleanPoint(s);
    days(s, 22);
    const menu = directorMenu(s);
    const far = menu.find((m) => m.id === `ratas:${homes[4]!.id}`);
    expect(far).toMatchObject({ kind: 'ratas', bad: true, owed: true });
    expect(menu.some((m) => m.id === `ratas:${homes[0]!.id}`)).toBe(false);
    // Lo malo, solo con aviso previo.
    s.ai!.brewing = [{ id: far!.id, text: 'aviso', since: s.tick - 1, bad: true }];
    const lines = applyDirector(s, { sucesos: [{ id: far!.id, motivo: 'la basura' }], avisos: [] });
    expect(lines).toHaveLength(1);
    expect(s.events.some((e) => e.text.includes('plaga de ratas'))).toBe(true);
    expect(s.citizens.some((c) => c.homeId === homes[4]!.id && c.memories.some((m) => m.kind === 'ratas'))).toBe(true);
  });

  it('en una partida larga, el pueblo construye su punto limpio; determinista y el dinero se conserva', () => {
    const a = runSimulation({ seed: 3, days: 500, profile: 'constructor' });
    const b = runSimulation({ seed: 3, days: 500, profile: 'constructor' });
    expect(hashState(a.state)).toBe(hashState(b.state));
    expect(checkInvariants(a.state)).toEqual([]);
    expect(a.report.invariantErrors).toEqual([]);
    expect(a.state.buildings.some((x) => x.kind === 'cleanpoint' && x.built)).toBe(true);
    expect(a.state.trash!.start).toBeGreaterThan(0);
  }, 120_000);
});
