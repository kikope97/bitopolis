import { describe, expect, it } from 'vitest';
import {
  type Building,
  coverageCtx,
  coverageOf,
  fireStationsFor,
  type GameState,
  homeSites,
  isHomeKind,
  missingServices,
  runSimulation,
  serviceCounts,
  serviceReach,
  stationsFor,
  trashServed,
  truckRoutes,
  updateNetworks,
} from '../src/index.ts';

/** 2.6 «Lo básico»: la ficha, «Qué falta», la carga y las comisarías y bomberos dicen lo mismo. */
const towns = new Map<number, GameState>();
function town(seed: number): GameState {
  if (!towns.has(seed)) towns.set(seed, runSimulation({ seed, days: 420, profile: 'constructor' }).state);
  return towns.get(seed)!;
}
const SEEDS = [1, 3, 4];
const homesOf = (s: GameState) => s.buildings.filter((b) => b.built && isHomeKind(b.kind));
const status = (s: GameState, b: { x: number; y: number }, key: string, ctx = coverageCtx(s)) => missingServices(s, b.x, b.y, ctx).find((n) => n.key === key)?.status ?? null;

describe.each(SEEDS)('cobertura de los servicios, semilla %i', (seed) => {
  it('colegio, salud y policía: cada vivienda la atiende uno (el más cercano), el mismo que dice «Qué falta», y los vecinos cuadran con serviceLoads', () => {
    const s = town(seed);
    const ctx = coverageCtx(s);
    const KEY = { school: 'colegio', clinic: 'salud', police: 'policia' } as const;
    let checked = 0;
    for (const kind of ['school', 'clinic', 'police'] as const) {
      // Lo que aún no se puede construir no sale en «Qué falta» (ctx.active).
      if (!ctx.active.includes(KEY[kind])) continue;
      const list = s.buildings.filter((b) => b.kind === kind && b.built && !b.damaged);
      const reach = list.map((b) => ({ b, r: serviceReach(s, b, ctx) }));
      const owner = new Map<number, { b: Building; full: boolean }>();
      for (const { b, r } of reach) {
        for (const id of r.homesServed) {
          expect(owner.has(id)).toBe(false);
          owner.set(id, { b, full: r.capacity!.full });
        }
        // Las personas que cuenta la ficha son las de serviceLoads.
        expect(r.capacity!.used).toBe(serviceCounts(s).get(b.id) ?? 0);
        expect(r.capacity!.of).toBeGreaterThan(0);
      }
      for (const h of homesOf(s)) {
        const st = status(s, h, KEY[kind], ctx);
        const o = owner.get(h.id);
        if (!o) expect(st).toBe('falta');
        else expect(st).toBe(o.full ? 'lleno' : null);
        if (kind === 'police') expect(stationsFor(s, h.x, h.y)[0]?.id).toBe(o?.b.id);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('bomberos: la zona de la ficha es la de fireStationsFor (con la colina)', () => {
    const s = town(seed);
    const ctx = coverageCtx(s);
    const reached = new Set(s.buildings.filter((b) => b.kind === 'firestation').flatMap((b) => serviceReach(s, b, ctx).homesInReach));
    for (const h of homesOf(s)) {
      expect(reached.has(h.id)).toBe(fireStationsFor(s, h.x, h.y).length > 0);
      expect(reached.has(h.id)).toBe(status(s, h, 'bomberos', ctx) === null || !ctx.active.includes('bomberos'));
    }
  });

  it('agua y luz: cada edificio con servicio tiene una planta, y la suma es lo que dicen las banderas', () => {
    const s = town(seed);
    // Las banderas son de la última hora: una obra terminada después aún no las tiene; se ponen al día.
    updateNetworks(s);
    for (const [kind, flag] of [['water', 'hasWater'], ['power', 'hasPower']] as const) {
      const plants = s.buildings.filter((b) => b.built && (kind === 'water' ? b.kind === 'water' : ['power', 'solar', 'wind'].includes(b.kind)));
      // Una planta puede gastar capacidad de otra (si la red le llega antes de encenderse): igual que en updateNetworks.
      const linked = plants.flatMap((p) => serviceReach(s, p).linked).filter((id) => !plants.some((p) => p.id === id));
      expect(new Set(linked).size).toBe(linked.length);
      const withFlag = s.buildings.filter((b) => b[flag] && !plants.includes(b)).map((b) => b.id);
      expect(new Set(linked)).toEqual(new Set(withFlag));
      for (const p of plants) {
        const r = serviceReach(s, p);
        expect(r.capacity!.used).toBeLessThanOrEqual(r.capacity!.of);
      }
    }
  });

  it('basura: lo que recoge cada camión es trashServed, y «lleno» va por trozo de red', () => {
    const s = town(seed);
    const ctx = coverageCtx(s);
    const served = trashServed(s);
    const linked = s.buildings.filter((b) => b.kind === 'cleanpoint').flatMap((b) => serviceReach(s, b, ctx).linked);
    expect(new Set(linked)).toEqual(new Set(served.keys()));
    for (const r of truckRoutes(s)) expect(serviceReach(s, s.buildings.find((b) => b.id === r.id)!, ctx).tiles).toEqual(r.roads);
  });

  it('es pura: no cambia el estado', () => {
    const s = town(seed);
    const before = JSON.stringify(s);
    for (const b of s.buildings) if (['school', 'water', 'cleanpoint', 'park', 'firestation'].includes(b.kind)) serviceReach(s, b);
    const hall = s.buildings[0]!;
    coverageOf(s, 'school', hall.x + 3, hall.y + 3);
    coverageOf(s, 'water', hall.x + 3, hall.y + 3);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('al colocar: las casas que «ganan» son las que dejan de pedir ese servicio al construirlo', () => {
    const s = town(seed);
    const ctx = coverageCtx(s);
    // Un sitio libre lejos del colegio más cercano, junto a una carretera.
    const free = homeSites(s).filter((p) => status(s, p, 'colegio', ctx) === 'falta');
    const spot = free[0] ?? homeSites(s)[0]!;
    const info = coverageOf(s, 'school', spot.x, spot.y);
    expect(info.id).toBe(null);
    const after: GameState = { ...s, buildings: [...s.buildings, { id: s.nextId, kind: 'school', x: spot.x, y: spot.y, built: true, hasWater: true, hasPower: true } as Building] };
    const ctx2 = coverageCtx(after);
    const gained = homeSites(s).filter((p) => status(s, p, 'colegio', ctx) === 'falta' && status(after, p, 'colegio', ctx2) !== 'falta');
    expect(new Set(info.gains.map((g) => `${g.x},${g.y}`))).toEqual(new Set(gained.map((g) => `${g.x},${g.y}`)));
  });
});
