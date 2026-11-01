import type { BuildKind, Command, TaxLevel } from '@bitopolis/shared';
import { PLANT_CAPACITY, TRASH } from './balance.ts';
import { canUpgradeTownhall, nextLevel, zonesUnlocked } from './townhall.ts';
import { buildCost, validateCommand } from './commands.ts';
import { chance, type RngState, seedRng } from './prng.ts';
import { buildingAt, DIRS, type GameState, hasAdjacentRoad, Tile, tileIndex, Zone } from './state.ts';
import { freeHomes } from './tick.ts';
import { farmZoneUnlocked } from './farm.ts';

/**
 * Perfiles de jugador automático para el CLI headless. Cada perfil tiene su
 * propio PRNG (no toca el de la partida) y decide una vez al día.
 */
export interface Profile {
  name: string;
  decide(state: GameState, rng: RngState): Command[];
}

interface PlannerOpts {
  tax: TaxLevel;
  /** Dinero que intenta no gastar. */
  reserve: number;
  /** Probabilidad de actuar cada día. */
  activity: number;
  services: BuildKind[];
  /** Construye casas municipales aunque haya zonas. */
  municipalHousing: boolean;
  /** Un servicio de cada tipo por cada N vecinos (por defecto, solo uno). */
  servicesPer?: number;
  /** 2.2: fincas que quiere tener (pinta zona agraria lejos del centro). */
  farms?: number;
}

/** Solares libres junto a carretera, ordenados por distancia al centro. */
function freeSpots(state: GameState): { x: number; y: number; d: number }[] {
  const { w, h, tiles } = state.map;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const out: { x: number; y: number; d: number }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[tileIndex(state, x, y)] === Tile.Road || buildingAt(state, x, y)) continue;
      if (!hasAdjacentRoad(state, x, y)) continue;
      out.push({ x, y, d: Math.abs(x - cx) + Math.abs(y - cy) });
    }
  }
  return out.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
}

/** Calles planificadas: una espina vertical y calles horizontales cada 3 filas. */
function roadPlan(state: GameState): Command[] {
  const cx = Math.floor(state.map.w / 2);
  const cy = Math.floor(state.map.h / 2);
  const plan: Command[] = [];
  for (let k = 1; k <= 4; k++) {
    for (const sign of [1, -1]) {
      const y = cy + sign * 3 * k;
      const spineFrom = cy + sign * 3 * (k - 1);
      plan.push({ type: 'BuildRoad', x: cx + 4, y: Math.min(spineFrom, y), x2: cx + 4, y2: Math.max(spineFrom, y) });
      plan.push({ type: 'BuildRoad', x: cx - 8, y, x2: cx + 12, y2: y });
    }
  }
  plan.unshift({ type: 'BuildRoad', x: cx - 8, y: cy, x2: cx + 12, y2: cy });
  return plan;
}

function nextRoad(state: GameState): Command | null {
  for (const cmd of roadPlan(state)) if (validateCommand(state, cmd).ok) return cmd;
  return null;
}

/** Calles conectadas a las que da un edificio. */
function roadNetworkOf(state: GameState, b: { x: number; y: number }): Set<number> {
  const { w, tiles } = state.map;
  const out = new Set<number>();
  const queue: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= state.map.h) return;
    const i = y * w + x;
    if (tiles[i] === Tile.Road && !out.has(i)) {
      out.add(i);
      queue.push(i);
    }
  };
  for (const [dx, dy] of DIRS) push(b.x + dx, b.y + dy);
  while (queue.length) {
    const i = queue.pop()!;
    for (const [dx, dy] of DIRS) push((i % w) + dx, Math.floor(i / w) + dy);
  }
  return out;
}

function buildingKindOf(state: GameState, id: number): string | undefined {
  return state.buildings.find((b) => b.id === id)?.kind;
}

function planner(name: string, o: PlannerOpts): Profile {
  return {
    name,
    decide(state, rng) {
      const out: Command[] = [];
      // Un jugador razonable sube impuestos si el mes cierra en negativo y la caja baja.
      const lastMonth = state.stats.at(-1);
      const deficit = !!lastMonth && lastMonth.income < lastMonth.expenses && state.treasury < 10_000;
      const order: TaxLevel[] = ['low', 'medium', 'high'];
      const cur = order.indexOf(state.taxLevel);
      const pref = order.indexOf(o.tax);
      // Con déficit sube un nivel; con la caja sana (o por debajo de su preferencia) vuelve a su nivel.
      let target = cur;
      if (deficit) target = Math.min(2, Math.max(cur, pref) + 1);
      else if (state.treasury > 20_000 || cur < pref) target = pref;
      if (target !== cur) out.push({ type: 'SetTax', level: order[target]! });
      if (!chance(rng, o.activity)) return out;
      const pop = state.citizens.length;
      const has = (k: string) => state.buildings.some((b) => b.kind === k);
      const spots = freeSpots(state);
      const tryBuild = (kind: BuildKind): boolean => {
        if (state.treasury < buildCost(kind) + o.reserve) return false;
        for (const s of spots) {
          const cmd: Command = { type: 'Build', kind, x: s.x, y: s.y };
          if (validateCommand(state, cmd).ok) {
            out.push(cmd);
            return true;
          }
        }
        return false;
      };
      if (!has("water")) { tryBuild("water"); return out; }
      if (!has("power")) { tryBuild("power"); return out; }
      // Ampliar la red si algún edificio terminado se queda sin agua o luz.
      const built = state.buildings.filter((b) => b.built && b.kind !== 'water' && b.kind !== 'power' && b.kind !== 'farm');
      // No más plantas de las que el pueblo necesita (una nueva mal conectada no arregla nada).
      const enough = (k: 'water' | 'power') => state.buildings.filter((b) => b.kind === k).length >= Math.ceil(built.length / (PLANT_CAPACITY[k] * 0.75)) + 1;
      if (built.some((b) => !b.hasWater) && !enough('water') && !state.projects.some((p) => buildingKindOf(state, p.buildingId) === 'water')) {
        if (tryBuild('water')) return out;
      }
      if (built.some((b) => !b.hasPower) && !enough('power') && !state.projects.some((p) => buildingKindOf(state, p.buildingId) === 'power')) {
        if (tryBuild('power')) return out;
      }
      // 2.1: al avisar de la basura, un punto limpio; luego, otro junto a lo que se ensucia (uno por cada 40 vecinos como mucho).
      const first = (state.trash?.start ?? -1) >= 0 && !has('cleanpoint');
      const dirty = state.buildings.filter((b) => (b.trash ?? 0) >= TRASH.dirtyAt).sort((a, b) => (b.trash ?? 0) - (a.trash ?? 0) || a.id - b.id)[0];
      const points = state.buildings.filter((b) => b.kind === 'cleanpoint').length;
      const cpNear = first ? (dirty ?? state.buildings.filter((b) => b.kind === 'house' || b.kind === 'res').at(-1) ?? state.buildings.find((b) => b.kind === 'townhall')) : dirty && points < 1 + Math.floor(pop / 60) ? dirty : undefined;
      if (cpNear && !state.projects.some((p) => buildingKindOf(state, p.buildingId) === 'cleanpoint') && state.treasury >= buildCost('cleanpoint') + (first ? 0 : o.reserve / 2)) {
        // En la misma red de calles que lo sucio (si no, el camión no llegaría).
        const net = roadNetworkOf(state, cpNear);
        const onNet = (s: { x: number; y: number }) => DIRS.some(([dx, dy]) => net.has((s.y + dy) * state.map.w + s.x + dx));
        const near = spots.filter(onNet).sort((a, b) => Math.abs(a.x - cpNear.x) + Math.abs(a.y - cpNear.y) - (Math.abs(b.x - cpNear.x) + Math.abs(b.y - cpNear.y)));
        const spot = near.find((s) => validateCommand(state, { type: 'Build', kind: 'cleanpoint', x: s.x, y: s.y }).ok);
        if (spot) {
          out.push({ type: 'Build', kind: 'cleanpoint', x: spot.x, y: spot.y });
          return out;
        }
      }
      // v1.8: repara lo que rompieron los disturbios (2.1: o el fuego) si la caja lo permite.
      const broken = state.buildings.find((b) => b.damaged && b.damaged.repairUntil < 0);
      if (broken && state.treasury > broken.damaged!.cost + o.reserve) {
        out.push({ type: 'RepairBuilding', buildingId: broken.id });
        return out;
      }
      // v1.8: amplía el ayuntamiento en cuanto puede pagarlo sin tocar su reserva.
      const up = nextLevel(state);
      // El nivel 2 (las zonas) es lo primero; los demás, solo con el mes en positivo y colchón.
      const prev = state.stats.at(-1);
      const prudent = up && (up.level === 2 ? state.treasury >= up.cost : state.treasury >= up.cost * 2 + o.reserve && (!prev || prev.income >= prev.expenses));
      if (up && prudent && canUpgradeTownhall(state).ok) {
        out.push({ type: 'UpgradeTownhall' });
        return out;
      }
      const zonesOn = zonesUnlocked(state);
      // Un jugador razonable mira el parte: no añade servicios (y sus sueldos) con el mes en negativo.
      const last = state.stats.at(-1);
      if (zonesOn && (!last || last.income >= last.expenses)) {
        const count = (k: string) => state.buildings.filter((b) => b.kind === k).length;
        const wanted = o.servicesPer ? Math.ceil(pop / o.servicesPer) : 1;
        for (const kind of o.services) if (count(kind) < wanted && tryBuild(kind)) return out;
      }
      // Vivienda municipal al principio (o siempre, según el perfil).
      if ((!zonesOn || o.municipalHousing) && freeHomes(state) + state.projects.filter((p) => p.payer === 0).length * 3 < 3 && state.demand.R > 0) {
        if (tryBuild('house')) return out;
      }
      if (zonesOn) {
        const zoned = (z: number) =>
          spots.filter((s) => state.map.zones[tileIndex(state, s.x, s.y)] === z).length;
        const unzoned = spots.filter((s) => state.map.zones[tileIndex(state, s.x, s.y)] === Zone.None);
        const want: [number, 'R' | 'C' | 'I', number][] = [
          [Zone.R, 'R', state.demand.R],
          [Zone.C, 'C', state.demand.C],
          [Zone.I, 'I', state.demand.I],
        ];
        const taken = new Set<string>();
        // 2.2: el campo, lejos del centro (de dos en dos, según crecen las fincas).
        if (o.farms && farmZoneUnlocked(state).ok) {
          const farms = state.buildings.filter((b) => b.kind === 'farm').length;
          if (farms + zoned(Zone.A) < o.farms && zoned(Zone.A) < 2) {
            for (const s of [...unzoned].reverse().slice(0, 2)) {
              taken.add(`${s.x},${s.y}`);
              out.push({ type: 'Zone', zone: 'A', x: s.x, y: s.y, w: 1, h: 1 });
            }
          }
        }
        for (const [z, zone, demand] of want) {
          if (demand <= 15 || zoned(z) >= 3) continue;
          // La industria, lejos del centro.
          const list = (zone === 'I' ? [...unzoned].reverse() : unzoned).filter((s) => !taken.has(`${s.x},${s.y}`));
          for (const s of list.slice(0, 4)) {
            taken.add(`${s.x},${s.y}`);
            out.push({ type: 'Zone', zone, x: s.x, y: s.y, w: 1, h: 1 });
          }
        }
      }
      if (spots.length < 6 && state.treasury > o.reserve + 1_500) {
        const r = nextRoad(state);
        if (r) out.push(r);
      }
      return out;
    },
  };
}

export const PROFILES: Record<string, Profile> = {
  pasivo: { name: 'pasivo', decide: () => [] },
  casual: planner('casual', { tax: 'medium', reserve: 3_000, activity: 0.3, services: ['park'], municipalHousing: false }),
  // 2.2: un jugador casual que además pinta zona agraria (para medir el campo).
  campo: planner('campo', { tax: 'medium', reserve: 3_000, activity: 0.3, services: ['park'], municipalHousing: false, farms: 8 }),
  ahorrador: planner('ahorrador', { tax: 'low', reserve: 4_000, activity: 0.5, services: ['park'], municipalHousing: false }),
  agresivo: planner('agresivo', { tax: 'high', reserve: 2_000, activity: 0.6, services: ['park'], municipalHousing: false }),
  derrochador: planner('derrochador', {
    tax: 'low',
    reserve: 0,
    activity: 1,
    services: ['park', 'school', 'clinic', 'police'],
    municipalHousing: true,
    servicesPer: 6,
  }),
  constructor: planner('constructor', {
    tax: 'medium',
    reserve: 0,
    activity: 1,
    // 2.1: el constructor también pone bomberos.
    services: ['park', 'school', 'clinic', 'police', 'firestation'],
    municipalHousing: true,
  }),
};

export function profileRng(seed: number): RngState {
  return seedRng(seed ^ 0x5eed1e55);
}

