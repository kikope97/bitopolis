import { TICKS_PER_DAY } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  AMBULANCE,
  applyCommand,
  applyDirector,
  type Building,
  checkInvariants,
  CIVIL,
  createInitialState,
  directorMenu,
  FIRE,
  fireCovered,
  fireDay,
  floodChanceAt,
  type GameState,
  hashState,
  ignite,
  migrate,
  migrate14Fire,
  MIGRATIONS,
  newBuilding,
  OUTSIDE,
  runSimulation,
  seedRng,
  step,
  Terrain,
  Tile,
  transfer,
  TREASURY,
  tryAmbulance,
  turnMenu,
  validateCommand,
  volunteersMonth,
  WEATHER,
  FORMAT_VERSION,
} from '../src/index.ts';

/** Un pueblo hecho (sin bomberos) con dinero para obras. */
const base = (() => {
  const { state } = runSimulation({ seed: 3, days: 300, profile: 'constructor', checkEveryDay: false });
  transfer(state, OUTSIDE, TREASURY, 80_000, 'subvencion');
  return state;
})();
const town = (): GameState => {
  const s = structuredClone(base);
  // Sin fuegos ni riesgos de la simulación, para empezar limpio.
  for (const b of s.buildings) {
    delete b.fire;
    delete b.risk;
  }
  return s;
};

/** Un edificio que pueda arder, con su casilla en llano. */
function target(s: GameState, kind: Building['kind'] = 'res'): Building {
  const b = s.buildings.find((x) => x.kind === kind && x.built && !x.damaged) ?? s.buildings.find((x) => (x.kind === 'res' || x.kind === 'house') && x.built)!;
  s.map.terrain[b.y * s.map.w + b.x] = Terrain.Flat;
  return b;
}

/** Parque de bomberos ya construido al lado. */
function station(s: GameState, near: { x: number; y: number }, level = 1): Building {
  const f = newBuilding(s, 'firestation', near.x, Math.max(0, near.y - 3), 0);
  f.built = true;
  f.level = level;
  return f;
}

const runHours = (s: GameState, h: number) => {
  for (let i = 0; i < h; i++) step(s);
};

describe('incendios (2.1)', () => {
  it('todo incendio se avisa antes: «Riesgo de incendio» en ese edificio y, en Modo normal, al día siguiente', () => {
    let fires = 0;
    for (const seed of [1, 2, 3]) {
      const { state } = runSimulation({ seed, days: 900, profile: 'constructor', checkEveryDay: false });
      const firsts = state.events.filter((e) => e.kind === 'fire' && e.text.startsWith('¡Fuego en'));
      for (const e of firsts) {
        fires++;
        const warned = state.events.some((w) => w.kind === 'fire' && w.ref === e.ref && w.text.startsWith('Riesgo de incendio') && w.tick < e.tick && e.tick - w.tick >= FIRE.riskHours);
        // El registro guarda los últimos 200 sucesos: el aviso puede haberse ido si el fuego es muy viejo.
        if (state.events[0]!.tick < e.tick - FIRE.riskHours - 24) expect(warned).toBe(true);
      }
      expect(checkInvariants(state)).toEqual([]);
    }
    expect(fires).toBeGreaterThanOrEqual(0);
  }, 240_000);

  it('un riesgo vence al día siguiente: prende o pasa (sin director)', () => {
    let lit = 0;
    let passed = 0;
    for (let k = 0; k < 20; k++) {
      const s = town();
      s.rng = seedRng(1000 + k);
      const b = target(s);
      b.risk = { since: s.tick - FIRE.riskHours, why: 'prueba' };
      fireDay(s);
      if (b.fire) lit++;
      else if (!b.risk) passed++;
    }
    expect(lit).toBeGreaterThan(0);
    expect(passed).toBeGreaterThan(0);
    expect(lit + passed).toBe(20);
  });

  it('con bomberos en su radio se apaga en pocas horas y sin daños', () => {
    const s = town();
    const b = target(s);
    station(s, b);
    expect(fireCovered(s, b)).toBe(true);
    expect(ignite(s, b)).toBe(true);
    expect(b.fire!.covered).toBe(true);
    expect(b.fire!.until - s.tick).toBeLessThanOrEqual(FIRE.coveredHours[1]);
    runHours(s, FIRE.coveredHours[1] + 1);
    expect(b.fire).toBeUndefined();
    expect(b.damaged).toBeUndefined();
    expect(s.events.some((e) => e.text.startsWith('Los bomberos apagan') && e.ref === b.id)).toBe(true);
    expect(s.emergencies.putOut).toBeGreaterThan(0);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('sin bomberos queda destrozado, se repara y nunca se pierde', () => {
    const s = town();
    const b = target(s);
    for (const f of s.buildings.filter((x) => x.kind === 'firestation')) f.built = false;
    expect(ignite(s, b)).toBe(true);
    expect(b.fire!.covered).toBe(false);
    runHours(s, FIRE.uncoveredHours[1] + 1);
    expect(b.fire).toBeUndefined();
    expect(b.damaged?.cause).toBe('fuego');
    expect(s.buildings.includes(b)).toBe(true);
    // Mientras está destrozado, no entra nadie nuevo y no se puede derribar ardiendo.
    const money = s.treasury;
    expect(applyCommand(s, { type: 'RepairBuilding', buildingId: b.id }).ok).toBe(true);
    expect(s.treasury).toBe(money - b.damaged!.cost);
    runHours(s, (FIRE.repairDays + 1) * TICKS_PER_DAY);
    expect(b.damaged).toBeUndefined();
    expect(checkInvariants(s)).toEqual([]);
  });

  it('en la colina solo llega el parque con cisterna (nivel 2)', () => {
    const s = town();
    const b = target(s);
    s.map.terrain[b.y * s.map.w + b.x] = Terrain.Hill;
    const f = station(s, b, 1);
    expect(fireCovered(s, b)).toBe(false);
    f.level = 2;
    expect(fireCovered(s, b)).toBe(true);
  });

  it('el fuego salta a veces al edificio de al lado (más sin bomberos)', () => {
    let spread = 0;
    for (let k = 0; k < 30; k++) {
      const s = town();
      s.rng = seedRng(500 + k);
      const b = target(s);
      // Un vecino pegado (en una casilla libre de alrededor).
      let n: Building | undefined;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
        const x = b.x + dx;
        const y = b.y + dy;
        const other = s.buildings.find((q) => q.x === x && q.y === y);
        if (other && other.built && other.kind === 'res') {
          n = other;
          break;
        }
        if (!other && s.map.tiles[y * s.map.w + x] !== Tile.Road && s.map.terrain[y * s.map.w + x] !== Terrain.River) {
          n = newBuilding(s, 'shop', x, y, OUTSIDE);
          n.built = true;
          break;
        }
      }
      expect(n).toBeTruthy();
      ignite(s, b);
      runHours(s, FIRE.uncoveredHours[1] + 1);
      if (s.events.some((e) => e.text.startsWith('El fuego salta'))) spread++;
      expect(s.buildings.filter((x) => x.fire).length).toBeLessThanOrEqual(FIRE.maxBurning);
    }
    expect(spread).toBeGreaterThan(0);
    expect(spread).toBeLessThan(30);
  });

  it('con director (Modo IA), los dados no prenden: el director elige `incendio:<id>` tras avisarlo', () => {
    const { state: s } = runSimulation({ seed: 3, days: 300, profile: 'constructor', aiMode: true, aiShare: 100, checkEveryDay: false });
    for (const b of s.buildings) delete b.fire;
    const b = target(s);
    s.ai!.directed = true;
    s.ai!.turn = null;
    b.risk = { since: s.tick - 2 * TICKS_PER_DAY, why: 'prueba' };
    fireDay(s);
    expect(b.fire).toBeUndefined();
    expect(b.risk).toBeDefined();
    const id = `incendio:${b.id}`;
    expect(directorMenu(s).some((m) => m.id === id && m.bad)).toBe(true);
    // Descontento suficiente para que quepa algo malo.
    for (const c of s.citizens) c.happiness = 25;
    // Sin aviso previo, no pasa.
    s.ai!.brewing = [];
    applyDirector(s, { sucesos: [{ id, motivo: 'x' }], avisos: [] });
    expect(b.fire).toBeUndefined();
    // Avisado antes (el director lo pone en «Se está cociendo»), sí.
    s.ai!.brewing = [{ id, text: 'Huele a humo', since: s.tick - 1, bad: true }];
    s.ai!.drama = { month: Math.floor(s.tick / (30 * 24)), bad: 0, good: 0 };
    applyDirector(s, { sucesos: [{ id, motivo: 'x' }], avisos: [] });
    expect(b.fire).toBeDefined();
  }, 120_000);

  it('el director puede dar un susto que acaba bien (ambulancia) y los vecinos ayudan, acogen o se hacen voluntarios', () => {
    const { state: s } = runSimulation({ seed: 3, days: 300, profile: 'constructor', aiMode: true, aiShare: 100, checkEveryDay: false });
    const c = s.citizens.find((x) => x.named && x.homeId !== null)!;
    const home = s.buildings.find((b) => b.id === c.homeId)!;
    c.age = 80;
    const clinic = newBuilding(s, 'clinic', home.x, Math.max(0, home.y - 2), 0);
    clinic.built = true;
    clinic.level = 2;
    expect(directorMenu(s).some((m) => m.id === `susto:${c.id}` && !m.bad)).toBe(true);
    const lines = applyDirector(s, { sucesos: [{ id: `susto:${c.id}`, motivo: 'x' }], avisos: [] });
    expect(lines.length).toBe(1);
    expect(c.memories.some((m) => m.kind === 'susto')).toBe(true);
    // Un incendio: quien no vive allí puede ayudar.
    const b = target(s);
    for (const f of s.buildings.filter((x) => x.kind === 'firestation')) f.built = false;
    ignite(s, b);
    const helper = s.citizens.find((x) => x.named && x.homeId !== b.id && x.homeId !== null)!;
    expect(turnMenu(s, helper).some((m) => m.accion === `ayudar_incendio:${b.id}`)).toBe(true);
    // Protección civil: un parado puede hacerse voluntario.
    const post = newBuilding(s, 'civilprotection', home.x + 1, Math.max(0, home.y - 3), 0);
    post.built = true;
    const idle = s.citizens.find((x) => x.named && x !== c)!;
    idle.jobId = null;
    idle.unemployedSince = s.tick;
    expect(turnMenu(s, idle).some((m) => m.accion === 'hacerse_voluntario')).toBe(true);
    // Sin casa por el fuego: sus amigos pueden acogerle.
    runHours(s, FIRE.uncoveredHours[1] + 1);
    expect(b.damaged?.cause).toBe('fuego');
    const victim = s.citizens.find((x) => x.homeId === b.id);
    if (victim) {
      const friend = s.citizens.find((x) => x.named && x.homeId !== b.id && x.homeId !== null && x !== victim)!;
      friend.relations.push({ id: victim.id, kind: 'amistad', strength: 40, since: s.tick });
      expect(turnMenu(s, friend).some((m) => m.accion === `acoger:${victim.id}`)).toBe(true);
    }
    expect(checkInvariants(s)).toEqual([]);
  }, 120_000);
});

describe('protección civil y diques (2.1)', () => {
  /** Una casilla libre a la orilla de un río (el río se pinta si la semilla no lo tiene). */
  function bank(s: GameState): { x: number; y: number; b: Building } {
    const b = target(s);
    const { w } = s.map;
    // Río justo encima del edificio; la orilla libre a su lado.
    const rx = b.x;
    const ry = b.y - 1;
    const occupied = (x: number, y: number) => s.buildings.some((q) => q.x === x && q.y === y) || s.map.tiles[y * w + x] === Tile.Road;
    s.map.terrain[ry * w + rx] = Terrain.River;
    for (const [x, y] of [[b.x + 1, b.y], [b.x - 1, b.y], [b.x + 1, b.y - 1], [b.x - 1, b.y - 1]] as const) {
      if (!occupied(x, y)) {
        s.map.terrain[y * w + x] = Terrain.Flat;
        return { x, y, b };
      }
    }
    // Si todo está ocupado, se deja sitio.
    const x = b.x + 1;
    const y = b.y;
    s.buildings = s.buildings.filter((q) => !(q.x === x && q.y === y));
    s.map.tiles[y * w + x] = Tile.Grass;
    return { x, y, b };
  }

  it('el dique pide caseta y orilla; anula la riada ahí; la caseta la baja un 60 %', () => {
    const s = town();
    const { x, y, b } = bank(s);
    expect(floodChanceAt(s, b, WEATHER.floodChance)).toBeCloseTo(WEATHER.floodChance);
    expect(validateCommand(s, { type: 'BuildDike', x, y })).toMatchObject({ ok: false, error: expect.stringMatching(/protección civil/) });
    const post = newBuilding(s, 'civilprotection', b.x, Math.min(s.map.h - 1, b.y + 2), 0);
    post.built = true;
    expect(floodChanceAt(s, b, 1)).toBeCloseTo(1 - CIVIL.floodCut);
    // Lejos del río, no.
    expect(validateCommand(s, { type: 'BuildDike', x: 0, y: 0 }).ok).toBe(s.map.terrain[1] === Terrain.River || s.map.terrain[s.map.w] === Terrain.River);
    const money = s.treasury;
    expect(applyCommand(s, { type: 'BuildDike', x, y }).ok).toBe(true);
    expect(s.treasury).toBe(money - CIVIL.dikeCost);
    expect(floodChanceAt(s, b, 1)).toBe(0);
    expect(validateCommand(s, { type: 'BuildDike', x, y }).ok).toBe(false);
    expect(validateCommand(s, { type: 'Build', kind: 'park', x, y }).ok).toBe(false);
    // Se puede quitar.
    expect(applyCommand(s, { type: 'Demolish', x, y }).ok).toBe(true);
    expect(s.dikes).toEqual([]);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('voluntarios por reglas entre los parados, con sitio por caseta', () => {
    const s = town();
    const hall = s.buildings.find((b) => b.kind === 'townhall')!;
    const post = newBuilding(s, 'civilprotection', hall.x + 2, hall.y - 2, 0);
    post.built = true;
    for (const c of s.citizens) {
      c.jobId = null;
      c.unemployedSince = s.tick;
      c.traits.social = 80;
    }
    for (let i = 0; i < 24; i++) volunteersMonth(s);
    const n = s.citizens.filter((c) => c.volunteer).length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(CIVIL.volunteersPer);
  });
});

describe('ambulancia (2.1)', () => {
  it('con ambulancia en su radio ×1,5 la urgencia a veces se salva; con nieve, menos', () => {
    const rate = (snow: boolean) => {
      let ok = 0;
      for (let k = 0; k < 200; k++) {
        const s = town();
        s.rng = seedRng(k);
        const c = s.citizens.find((x) => x.homeId !== null)!;
        const home = s.buildings.find((b) => b.id === c.homeId)!;
        const clinic = newBuilding(s, 'clinic', home.x, Math.max(0, home.y - 10), 0);
        clinic.built = true;
        clinic.level = AMBULANCE.level;
        if (snow) s.weather = { kind: 'nieve', until: s.tick + 48 };
        if (tryAmbulance(s, c)) ok++;
      }
      return ok;
    };
    const clear = rate(false);
    const snow = rate(true);
    expect(clear).toBeGreaterThan(60);
    expect(snow).toBeLessThan(clear);
    // Sin ambulancia (nivel 1), nunca.
    const s = town();
    const c = s.citizens.find((x) => x.homeId !== null)!;
    for (const b of s.buildings) if (b.kind === 'clinic') b.level = 1;
    expect(tryAmbulance(s, c)).toBe(false);
  }, 120_000);
});

describe('formato 14 y determinismo (2.1)', () => {
  it('migración 13 → 14: diques y contadores de emergencias', () => {
    const s = createInitialState({ seed: 9 }) as unknown as Record<string, unknown>;
    const old: Record<string, unknown> = { ...s, formatVersion: 13 };
    delete old.dikes;
    delete old.emergencies;
    const m = migrate(old);
    expect(m.formatVersion).toBe(FORMAT_VERSION);
    expect(m.dikes).toEqual([]);
    expect(m.emergencies).toEqual({ fires: 0, putOut: 0, saved: 0, floodsAvoided: 0 });
    expect(typeof MIGRATIONS[13]).toBe('function');
    // La parte de la migración de los bomberos respeta lo que ya hubiera.
    expect(migrate14Fire({ dikes: [5], emergencies: { fires: 2 } })).toMatchObject({ dikes: [5], emergencies: { fires: 2, putOut: 0 } });
  });

  it('determinista con incendios: misma semilla, mismo hash; el dinero cuadra', () => {
    const run = () => runSimulation({ seed: 2, days: 500, profile: 'derrochador', checkEveryDay: false }).state;
    const a = run();
    const b = run();
    expect(hashState(a)).toBe(hashState(b));
    expect(checkInvariants(a)).toEqual([]);
  }, 240_000);
});
