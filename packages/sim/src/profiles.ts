import type { BuildKind, Command } from '@bitopolis/shared';
import { BUILD_COST, validateCommand } from './commands.ts';
import { nextFloat, type RngState, seedRng } from './prng.ts';
import { type GameState, Tile, tileIndex } from './state.ts';

/**
 * Perfiles de jugador automático para el CLI headless. Cada perfil tiene su
 * propio PRNG (no toca el de la partida) y decide una vez al día.
 */
export interface Profile {
  name: string;
  decide(state: GameState, rng: RngState): Command[];
}

function findBuildSpot(state: GameState, kind: BuildKind): Command | null {
  const { w, h } = state.map;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const cmd: Command = { type: 'Build', kind, x, y };
      if (validateCommand(state, cmd).ok) return cmd;
    }
  }
  return null;
}

/** Alarga una calle desde el extremo de cualquier carretera existente. */
function extendRoad(state: GameState): Command | null {
  const { w, h, tiles } = state.map;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (tiles[tileIndex(state, x, y)] !== Tile.Road) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 2], [0, -2]] as const) {
        const cmd: Command = { type: 'Build', kind: 'road', x: x + dx, y: y + dy };
        if (validateCommand(state, cmd).ok) return cmd;
      }
    }
  }
  return null;
}

function builder(name: string, opts: { tax: 'low' | 'medium' | 'high'; houseChance: number; reserve: number }): Profile {
  return {
    name,
    decide(state, rng) {
      const out: Command[] = [];
      if (state.taxLevel !== opts.tax) out.push({ type: 'SetTax', level: opts.tax });
      const has = (k: string) => state.buildings.some((b) => b.kind === k);
      if (!has('water') && state.treasury > BUILD_COST.water + opts.reserve) {
        const c = findBuildSpot(state, 'water');
        if (c) return [...out, c];
      }
      if (!has('power') && state.treasury > BUILD_COST.power + opts.reserve) {
        const c = findBuildSpot(state, 'power');
        if (c) return [...out, c];
      }
      if (state.treasury > BUILD_COST.house + opts.reserve && nextFloat(rng) < opts.houseChance) {
        const c = findBuildSpot(state, 'house') ?? extendRoad(state);
        if (c) out.push(c);
      }
      return out;
    },
  };
}

export const PROFILES: Record<string, Profile> = {
  pasivo: { name: 'pasivo', decide: () => [] },
  casual: builder('casual', { tax: 'medium', houseChance: 0.05, reserve: 4_000 }),
  ahorrador: builder('ahorrador', { tax: 'low', houseChance: 0.03, reserve: 10_000 }),
  agresivo: builder('agresivo', { tax: 'high', houseChance: 0.05, reserve: 3_000 }),
  constructor: builder('constructor', { tax: 'medium', houseChance: 0.3, reserve: 0 }),
};

export function profileRng(seed: number): RngState {
  return seedRng(seed ^ 0x5eed1e55);
}
