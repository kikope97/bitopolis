import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  BUILD,
  cancelRefund,
  checkInvariants,
  computeDemand,
  createInitialState,
  demandFactors,
  fmt,
  type GameState,
  hashState,
  lotFree,
  lotServed,
  lotStatus,
  lotSummary,
  lotsLine,
  maintenanceByKind,
  maintenanceOf,
  materialsCost,
  monthlyCostOf,
  networkLoad,
  newBuilding,
  runSimulation,
  step,
  Tile,
  tileIndex,
  TREASURY,
  updateNetworks,
  Zone,
  zoneGate,
  ZONE_GROWTH,
} from '../src/index.ts';

/** Pueblos de varias formas (perfiles y semillas) para comparar con el motor. */
function towns(): GameState[] {
  return [
    runSimulation({ seed: 3, days: 200, profile: 'casual' }).state,
    runSimulation({ seed: 11, days: 420, profile: 'casual' }).state,
    runSimulation({ seed: 42, days: 300, profile: 'campo' }).state,
  ];
}

const clone = (s: GameState) => JSON.parse(JSON.stringify(s)) as GameState;

describe('networkLoad: el mismo reparto que updateNetworks, sin tocar el estado', { timeout: 120_000 }, () => {
  it('da los mismos edificios con agua y luz y las mismas carreteras', () => {
    for (const s of towns()) {
      const before = hashState(s);
      const load = networkLoad(s);
      expect(hashState(s)).toBe(before);
      const c = clone(s);
      const roads = updateNetworks(c);
      expect([...load.roads.water].sort()).toEqual([...roads.water].sort());
      expect([...load.roads.power].sort()).toEqual([...roads.power].sort());
      for (const b of c.buildings) {
        expect(load.has.water.has(b.id), `agua de ${b.kind} ${b.id}`).toBe(b.hasWater);
        expect(load.has.power.has(b.id), `luz de ${b.kind} ${b.id}`).toBe(b.hasPower);
      }
      // Cada planta da a lo sumo su capacidad, y lo que se queda sin servicio no lo tiene.
      for (const p of load.plants.values()) expect(p.served).toBeLessThanOrEqual(Math.max(0, p.capacity));
      for (const n of load.nets.values()) for (const id of n.left) expect(load.has[n.kind].has(id)).toBe(false);
    }
  });

  it('una bomba llena dice cuántos se quedan sin agua', () => {
    const s = createInitialState({ seed: 5 });
    const y = 20;
    for (let x = 2; x < 50; x++) s.map.tiles[tileIndex(s, x, y)] = Tile.Road;
    s.buildings = s.buildings.filter((b) => b.kind === 'townhall');
    const pump = newBuilding(s, 'water', 1, y, TREASURY);
    pump.built = true;
    const power = newBuilding(s, 'power', 2, y - 1, TREASURY);
    power.built = true;
    let n = 0;
    for (let x = 3; x < 50 && n < 60; x++) {
      for (const yy of [y - 1, y + 1]) {
        const b = newBuilding(s, 'house', x, yy, TREASURY);
        b.built = true;
        n++;
      }
    }
    const load = networkLoad(s);
    const p = load.plants.get(pump.id)!;
    const net = load.nets.get(p.net!)!;
    expect(p.served).toBe(p.capacity);
    // Las casas (y la central, que también gasta agua) que no caben.
    expect(net.served + net.left.length).toBe(n + 1);
    expect(net.left.length).toBe(n + 1 - p.capacity);
  });
});

describe('lotStatus: por qué no crece un solar (las condiciones de growZones)', { timeout: 120_000 }, () => {
  it('coincide con los solares que growZones puede elegir', () => {
    for (const s of towns()) {
      const c = clone(s);
      const served = updateNetworks(c);
      const load = networkLoad(s);
      const kinds = { [Zone.R]: ['R', 'res'], [Zone.C]: ['C', 'shop'], [Zone.I]: ['I', 'factory'] } as const;
      let checked = 0;
      for (let y = 0; y < s.map.h; y++) {
        for (let x = 0; x < s.map.w; x++) {
          const z = s.map.zones[y * s.map.w + x] as 1 | 2 | 3;
          const st = lotStatus(s, x, y, load);
          if (!kinds[z] || !lotFree(s, x, y)) {
            expect(st).toBeNull();
            continue;
          }
          const [zone, kind] = kinds[z];
          const engine = lotServed(c, served, x, y) && zoneGate(s, kind, s.demand[zone]) === null;
          expect(st!.grows, `solar ${x},${y} (${zone}): ${st!.text}`).toBe(engine);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
    }
  });

  it('explica cada motivo y lo que hay que hacer', () => {
    const s = createInitialState({ seed: 4 });
    s.buildings = s.buildings.filter((b) => b.kind === 'townhall');
    const y = 30;
    for (let x = 5; x <= 15; x++) s.map.tiles[tileIndex(s, x, y)] = Tile.Road;
    for (let x = 6; x <= 14; x++) s.map.zones[tileIndex(s, x, y + 1)] = Zone.R;
    s.map.zones[tileIndex(s, 6, y + 3)] = Zone.R;
    s.demand = { R: 40, C: 0, I: 0 };
    // Sin carretera.
    expect(lotStatus(s, 6, y + 3)!.reason).toBe('carretera');
    // Ni agua ni luz.
    let st = lotStatus(s, 8, y + 1)!;
    expect(st.reason).toBe('agua_luz');
    expect(st.action).toMatch(/bomba de agua/);
    // Con bomba en obras: solo cambia la acción.
    const pump = newBuilding(s, 'water', 5, y - 1, TREASURY);
    expect(lotStatus(s, 8, y + 1)!.action).toMatch(/en obras/);
    pump.built = true;
    st = lotStatus(s, 8, y + 1)!;
    expect(st.reason).toBe('luz');
    expect(st.text).toBe('La calle de al lado no tiene luz');
    const power = newBuilding(s, 'power', 15, y - 1, TREASURY);
    power.built = true;
    st = lotStatus(s, 8, y + 1)!;
    expect(st.grows).toBe(true);
    // Demanda baja: el motivo y el umbral.
    s.demand.R = 8;
    st = lotStatus(s, 8, y + 1)!;
    expect(st.reason).toBe('demanda');
    expect(st.text).toBe(`Demanda baja (R +8; hace falta más de ${ZONE_GROWTH.minDemand})`);
    // Lo propio del solar va antes que lo de la zona, pero cuenta todo.
    expect(lotStatus(s, 6, y + 3)!.reasons).toEqual(['carretera', 'demanda']);
    // Casas libres de sobra.
    s.demand.R = 40;
    for (let x = 6; x <= 7; x++) {
      const b = newBuilding(s, 'house', x, y - 1, TREASURY);
      b.built = true;
    }
    st = lotStatus(s, 8, y + 1)!;
    expect(st.reason).toBe('casas_libres');
    expect(st.text).toMatch(/^Hay 6 casas libres/);
    const sum = lotSummary(s);
    expect(sum.R.empty).toBe(10);
    expect(sum.R.blocked.casas_libres).toBe(9);
    expect(lotsLine(sum.R)).toBe('10 solares no pueden crecer: sobran casas (9), sin carretera (1)');
  });

  it('un solar sin luz no crece y, al llegar la luz, crece', () => {
    const s = createInitialState({ seed: 4 });
    const y = 30;
    for (let x = 5; x <= 15; x++) s.map.tiles[tileIndex(s, x, y)] = Tile.Road;
    for (let x = 6; x <= 14; x++) s.map.zones[tileIndex(s, x, y + 1)] = Zone.R;
    const pump = newBuilding(s, 'water', 5, y - 1, TREASURY);
    pump.built = true;
    const lots = () => s.buildings.filter((b) => b.kind === 'res').length;
    // Vecinos contentos: la demanda R se queda alta (la de prueba no tiene casa).
    const days = (n: number) => {
      for (let d = 0; d < n; d++) {
        for (const c of s.citizens) c.happiness = 90;
        for (let i = 0; i < TICKS_PER_DAY; i++) step(s);
      }
    };
    days(10);
    expect(lots()).toBe(0);
    expect(s.demand.R).toBeGreaterThan(ZONE_GROWTH.minDemand);
    expect(lotStatus(s, 8, y + 1)!.reason).toBe('luz');
    expect(lotSummary(s).dry.length).toBe(9);
    const power = newBuilding(s, 'power', 15, y - 1, TREASURY);
    power.built = true;
    days(10);
    expect(lots()).toBeGreaterThan(0);
  });
});

describe('demandFactors: de qué sale la demanda', { timeout: 120_000 }, () => {
  it('suma lo mismo que computeDemand', () => {
    const states = towns();
    states.push(createInitialState({ seed: 9 }));
    for (const s of states) {
      const d = computeDemand(s);
      const f = demandFactors(s);
      const total = (l: { value: number }[]) => Math.round(Math.max(-100, Math.min(100, l.reduce((a, x) => a + x.value, 0))));
      expect(total(f.R)).toBe(d.R);
      expect(total(f.C)).toBe(d.C);
      expect(total(f.I)).toBe(d.I);
      expect(f.R[0]).toEqual({ label: 'Ganas de venir a vivir (base)', value: 40 });
    }
  });
});

describe('lo que cuesta al mes', () => {
  it('monthlyCostOf: mantenimiento y sueldos de la plantilla', () => {
    expect(monthlyCostOf('school')).toEqual({ maintenance: 450, jobs: 3, wages: 3 * 700, total: 450 + 2100 });
    expect(monthlyCostOf('water')).toEqual({ maintenance: 150, jobs: 1, wages: 900, total: 1050 });
    expect(monthlyCostOf('road').total).toBe(0);
  });

  it('maintenanceByKind suma lo que se cobra de mantenimiento a fin de mes', () => {
    const s = runSimulation({ seed: 11, days: 420, profile: 'casual' }).state;
    // Sin obras en marcha: lo que hay construido no cambia al cerrar el mes.
    s.projects = [];
    for (const b of s.buildings) delete b.upgradeUntil;
    const expected = maintenanceByKind(s).reduce((a, x) => a + x.amount, 0);
    expect(expected).toBeGreaterThan(0);
    const school = maintenanceByKind(s).find((x) => x.kind === 'school');
    if (school) expect(school.amount).toBe(s.buildings.filter((b) => b.kind === 'school' && b.built).reduce((a, b) => a + maintenanceOf(b), 0));
    while ((s.tick + 1) % TICKS_PER_MONTH !== 0) step(s);
    step(s);
    const last = s.stats.at(-1)!;
    expect(-(last.breakdown['mantenimiento'] ?? 0)).toBe(expected);
  });
});

describe('cancelar una obra sin empezar devuelve los materiales', () => {
  function town() {
    const s = runSimulation({ seed: 3, days: 120, profile: 'casual' }).state;
    // Un sitio libre junto a una carretera.
    for (let y = 1; y < s.map.h - 1; y++) {
      for (let x = 1; x < s.map.w - 1; x++) {
        if (applyCommand(clone(s), { type: 'Build', kind: 'park', x, y }).ok) return { s, x, y };
      }
    }
    throw new Error('sin sitio');
  }

  it('el mismo día: se devuelve todo y el dinero cuadra', () => {
    const { s, x, y } = town();
    const t0 = s.treasury;
    const m0 = { ...s.month, breakdown: { ...s.month.breakdown } };
    expect(applyCommand(s, { type: 'Build', kind: 'park', x, y }).ok).toBe(true);
    const mat = materialsCost(s, 'park', x, y);
    expect(s.treasury).toBe(t0 - mat);
    const b = s.buildings.find((q) => q.x === x && q.y === y)!;
    expect(cancelRefund(s, b)).toBe(mat);
    expect(applyCommand(s, { type: 'Demolish', x, y }).ok).toBe(true);
    expect(s.treasury).toBe(t0);
    expect(s.month.income).toBe(m0.income);
    expect(s.month.expenses).toBe(m0.expenses);
    expect(s.month.breakdown['obras'] ?? 0).toBe(m0.breakdown['obras'] ?? 0);
    expect(s.events.at(-1)!.text).toBe(`Obra cancelada: Parque. Se devuelven ${fmt(mat)} € de materiales`);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('con un día de obra ya no se devuelve nada', () => {
    const { s, x, y } = town();
    expect(applyCommand(s, { type: 'Build', kind: 'park', x, y }).ok).toBe(true);
    const b = s.buildings.find((q) => q.x === x && q.y === y)!;
    while (s.projects.find((p) => p.buildingId === b.id)!.workerDaysDone === 0) step(s);
    expect(cancelRefund(s, b)).toBe(0);
    const t = s.treasury;
    expect(applyCommand(s, { type: 'Demolish', x, y }).ok).toBe(true);
    expect(s.treasury).toBe(t);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('se devuelve lo pagado, aunque el precio de hoy haya cambiado (ronda 22)', () => {
    const { s, x, y } = town();
    expect(applyCommand(s, { type: 'Build', kind: 'park', x, y }).ok).toBe(true);
    const paid = s.projects.at(-1)!.paid!;
    expect(paid).toBe(materialsCost(s, 'park', x, y));
    s.projects.at(-1)!.paid = paid - 100; // como si se hubiera pagado con otro plan del presupuesto
    const b = s.buildings.find((q) => q.x === x && q.y === y)!;
    expect(cancelRefund(s, b)).toBe(paid - 100);
  });

  it('«cancelOnly» no derriba una obra que ya empezó (ronda 22)', () => {
    const { s, x, y } = town();
    expect(applyCommand(s, { type: 'Build', kind: 'park', x, y }).ok).toBe(true);
    const b = s.buildings.find((q) => q.x === x && q.y === y)!;
    while (s.projects.find((p) => p.buildingId === b.id)!.workerDaysDone === 0) step(s);
    const r = applyCommand(s, { type: 'Demolish', x, y, cancelOnly: true });
    expect(r.ok).toBe(false);
    expect(s.buildings.some((q) => q.id === b.id)).toBe(true);
  });

  it('lo terminado y lo de otros no se devuelve', () => {
    const { s } = town();
    const done = s.buildings.find((b) => b.built && b.kind in BUILD && b.kind !== 'townhall')!;
    expect(cancelRefund(s, done)).toBe(0);
    const res = s.buildings.find((b) => b.kind === 'res' && !b.built);
    if (res) expect(cancelRefund(s, res)).toBe(0);
  });
});
