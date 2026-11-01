import { TICKS_PER_DAY } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  ASSOCIATIONS,
  associationsDay,
  associationsMonth,
  barrioOf,
  checkInvariants,
  CRIME,
  crimeDay,
  type GameState,
  migrate,
  newBuilding,
  OUTSIDE,
  runSimulation,
  step,
  transfer,
  TREASURY,
  tryArrest,
  createInitialState,
} from '../src/index.ts';

function town(): GameState {
  const { state } = runSimulation({ seed: 1, days: 400, profile: 'constructor' });
  transfer(state, OUTSIDE, TREASURY, 60_000, 'subvencion');
  state.justice = { cells: [], jail: [], hot: [], robberies: 0, arrests: 0, fullWarned: -1 };
  return state;
}

function police(s: GameState): ReturnType<typeof newBuilding> {
  const hall = s.buildings.find((b) => b.kind === 'townhall')!;
  const p = newBuilding(s, 'police', hall.x + 1, hall.y - 2, 0);
  p.built = true;
  return p;
}

describe('delincuencia (v1.8)', () => {
  it('con comisaría cerca se detiene; los calabozos tienen límite y, llenos, ya no se detiene a nadie (avisa una vez)', () => {
    const s = town();
    s.buildings = s.buildings.filter((b) => b.kind !== 'police' && b.kind !== 'jail');
    const p = police(s);
    expect(tryArrest(s, p.x, p.y, CRIME.cellsPerStation + 2)).toBe(CRIME.cellsPerStation);
    expect(s.events.at(-1)!.text).toMatch(/calabozos.*llenos.*cárcel/);
    expect(tryArrest(s, p.x, p.y, 1)).toBe(0);
    // Sin cárcel, cumplen en el calabozo: al mes, quedan libres.
    for (let i = 0; i < CRIME.cellDays + 1; i++) {
      s.tick += TICKS_PER_DAY;
      crimeDay(s);
    }
    expect(s.justice.cells.length).toBe(0);
  });

  it('cada detenido paga una multa diaria al ayuntamiento (petición del creador)', () => {
    const s = town();
    const gone = new Set(s.buildings.filter((b) => b.kind === 'police' || b.kind === 'jail').map((b) => b.id));
    s.buildings = s.buildings.filter((b) => !gone.has(b.id));
    for (const c of s.citizens) if (c.jobId !== null && gone.has(c.jobId)) c.jobId = null;
    const p = police(s);
    expect(tryArrest(s, p.x, p.y, 1)).toBe(1);
    // Un vecino detenido en disturbios paga de su bolsillo.
    const vecino = s.citizens.find((c) => c.money > 100)!;
    expect(tryArrest(s, p.x, p.y, 1, [vecino])).toBe(1);
    const caja = s.treasury;
    const bolsillo = vecino.money;
    s.tick += TICKS_PER_DAY;
    crimeDay(s);
    expect(s.treasury).toBe(caja + 2 * CRIME.finePerDay);
    expect(vecino.money).toBe(bolsillo - CRIME.finePerDay);
    expect(s.justice.fines).toBe(2 * CRIME.finePerDay);
    // El vecino sale a los días de disturbios; el ladrón sigue.
    for (let i = 0; i < CRIME.riotDays; i++) {
      s.tick += TICKS_PER_DAY;
      crimeDay(s);
    }
    expect(s.justice.cells.some((c) => c.citizenId === vecino.id)).toBe(false);
    expect(s.justice.cells.length).toBe(1);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('con cárcel, los detenidos pasan a la cárcel y los calabozos se vacían en días', () => {
    const s = town();
    s.buildings = s.buildings.filter((b) => b.kind !== 'police' && b.kind !== 'jail');
    const p = police(s);
    const j = newBuilding(s, 'jail', p.x + 3, p.y, 0);
    j.built = true;
    expect(tryArrest(s, p.x, p.y, CRIME.cellsPerStation)).toBe(CRIME.cellsPerStation);
    for (let i = 0; i < CRIME.transferDays + 1; i++) {
      s.tick += TICKS_PER_DAY;
      crimeDay(s);
    }
    expect(s.justice.cells.length).toBe(0);
    expect(s.justice.jail.length).toBe(CRIME.cellsPerStation);
  });

  it('en años de juego hay robos; con policía, detenciones; el dinero se conserva', () => {
    let robberies = 0;
    let arrests = 0;
    for (const seed of [1, 2, 3]) {
      const { state, report } = runSimulation({ seed, days: 1440, profile: 'constructor', checkEveryDay: false });
      expect(report.invariantErrors).toEqual([]);
      robberies += state.justice.robberies;
      arrests += state.justice.arrests;
    }
    expect(robberies).toBeGreaterThan(0);
    expect(arrests).toBeGreaterThan(0);
  }, 120_000);
});

describe('manifestaciones que escalan y disturbios (v1.8)', () => {
  function withAssociation(): GameState {
    const s = town();
    // Sin colegios ni comisarías (y quien trabajaba allí, al paro).
    const gone = new Set(s.buildings.filter((b) => b.kind === 'school' || b.kind === 'police').map((b) => b.id));
    s.buildings = s.buildings.filter((b) => !gone.has(b.id));
    for (const c of s.citizens) if (c.jobId !== null && gone.has(c.jobId)) c.jobId = null;
    for (const c of s.citizens.slice(0, 8)) c.named = true;
    s.associations = [];
    associationsMonth(s);
    return s;
  }

  it('la asociación lleva el nombre de su barrio y cada manifestación es mayor', () => {
    const s = withAssociation();
    const a = s.associations[0]!;
    expect(a.name).toMatch(/^Asociación Vecinal (del|de la|de) /);
    const sizes: number[] = [];
    for (let k = 0; k < 3; k++) {
      const leader = s.citizens.find((c) => c.id === a.leaderId)!;
      leader.protest = a.id;
      a.protestDay = s.tick;
      associationsDay(s);
      const e = s.events.filter((x) => x.kind === 'protest').at(-1)!;
      sizes.push(Number(/unas (\d+) personas/.exec(e.text)![1]));
    }
    expect(sizes[1]!).toBeGreaterThan(sizes[0]!);
    expect(sizes[2]!).toBeGreaterThan(sizes[1]!);
    expect(s.events.filter((x) => x.kind === 'protest').at(-1)!.text).toMatch(/«¡.*!»/);
  });

  it('tras varias sin respuesta llegan disturbios que dañan tiendas; repararlas cuesta y vuelven a abrir', () => {
    const s = withAssociation();
    const a = s.associations[0]!;
    let riot = false;
    for (let k = 0; k < 20 && !riot; k++) {
      const leader = s.citizens.find((c) => c.id === a.leaderId)!;
      leader.protest = a.id;
      a.protestDay = s.tick;
      associationsDay(s);
      riot = s.events.some((x) => x.text.startsWith('Disturbios'));
    }
    expect(riot).toBe(true);
    expect((a.protests ?? 0)).toBeGreaterThan(ASSOCIATIONS.riotAfter);
    const broken = s.buildings.find((b) => b.damaged);
    if (!broken) return; // sin tiendas en el barrio
    const before = s.treasury;
    expect(applyCommand(s, { type: 'RepairBuilding', buildingId: broken.id }).ok).toBe(true);
    expect(before - s.treasury).toBe(ASSOCIATIONS.repairCost);
    for (let i = 0; i < (ASSOCIATIONS.repairDays + 1) * TICKS_PER_DAY; i++) step(s);
    expect(broken.damaged).toBeUndefined();
    expect(checkInvariants(s)).toEqual([]);
  });

  it('el barrio sale del sitio: junto al ayuntamiento, «del Centro»', () => {
    const s = createInitialState({ seed: 1 });
    const hall = s.buildings[0]!;
    expect(barrioOf(s, hall.x + 1, hall.y)).toBe('del Centro');
  });
});

describe('migración 10 → 11', () => {
  it('añade la justicia vacía', () => {
    const v10 = JSON.parse(JSON.stringify(createInitialState({ seed: 1 })));
    v10.formatVersion = 10;
    delete v10.justice;
    const m = migrate(v10);
    expect(m.formatVersion).toBeGreaterThanOrEqual(11);
    expect(m.justice.cells).toEqual([]);
  });
});
