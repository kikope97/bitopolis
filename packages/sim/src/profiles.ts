import type { BuildKind, Command, TaxLevel } from '@bitopolis/shared';
import { ZONE_UNLOCK_POP } from './balance.ts';
import { buildCost, validateCommand } from './commands.ts';
import { chance, type RngState, seedRng } from './prng.ts';
import { buildingAt, type GameState, hasAdjacentRoad, Tile, tileIndex, Zone } from './state.ts';
import { freeHomes } from './tick.ts';

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

function buildingKindOf(state: GameState, id: number): string | undefined {
  return state.buildings.find((b) => b.id === id)?.kind;
}

function planner(name: string, o: PlannerOpts): Profile {
  return {
    name,
    decide(state, rng) {
      const out: Command[] = [];
      if (state.taxLevel !== o.tax) out.push({ type: 'SetTax', level: o.tax });
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
      const built = state.buildings.filter((b) => b.built && b.kind !== 'water' && b.kind !== 'power');
      if (built.some((b) => !b.hasWater) && !state.projects.some((p) => buildingKindOf(state, p.buildingId) === 'water')) {
        if (tryBuild('water')) return out;
      }
      if (built.some((b) => !b.hasPower) && !state.projects.some((p) => buildingKindOf(state, p.buildingId) === 'power')) {
        if (tryBuild('power')) return out;
      }
      if (pop >= ZONE_UNLOCK_POP) {
        const count = (k: string) => state.buildings.filter((b) => b.kind === k).length;
        const wanted = o.servicesPer ? Math.ceil(pop / o.servicesPer) : 1;
        for (const kind of o.services) if (count(kind) < wanted && tryBuild(kind)) return out;
      }
      // Vivienda municipal al principio (o siempre, según el perfil).
      if ((pop < ZONE_UNLOCK_POP || o.municipalHousing) && freeHomes(state) + state.projects.filter((p) => p.payer === 0).length * 3 < 3 && state.demand.R > 0) {
        if (tryBuild('house')) return out;
      }
      if (pop >= ZONE_UNLOCK_POP) {
        const zoned = (z: number) =>
          spots.filter((s) => state.map.zones[tileIndex(state, s.x, s.y)] === z).length;
        const unzoned = spots.filter((s) => state.map.zones[tileIndex(state, s.x, s.y)] === Zone.None);
        const want: [number, 'R' | 'C' | 'I', number][] = [
          [Zone.R, 'R', state.demand.R],
          [Zone.C, 'C', state.demand.C],
          [Zone.I, 'I', state.demand.I],
        ];
        const taken = new Set<string>();
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
  ahorrador: planner('ahorrador', { tax: 'low', reserve: 4_000, activity: 0.5, services: ['park'], municipalHousing: false }),
  agresivo: planner('agresivo', { tax: 'high', reserve: 2_000, activity: 0.6, services: ['park'], municipalHousing: false }),
  derrochador: planner('derrochador', {
    tax: 'low',
    reserve: 0,
    activity: 1,
    services: ['park', 'school', 'clinic'],
    municipalHousing: true,
    servicesPer: 6,
  }),
  constructor: planner('constructor', {
    tax: 'medium',
    reserve: 0,
    activity: 1,
    services: ['park', 'school', 'clinic'],
    municipalHousing: true,
  }),
};

export function profileRng(seed: number): RngState {
  return seedRng(seed ^ 0x5eed1e55);
}

