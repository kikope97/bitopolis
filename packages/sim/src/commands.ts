import { Command, type BuildKind } from '@bitopolis/shared';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { buildingAt, type GameState, inBounds, pushEvent, Tile, tileIndex } from './state.ts';

export const BUILD_COST: Record<BuildKind, number> = {
  road: 50,
  house: 4_000,
  water: 3_000,
  power: 3_500,
};

export type CommandResult = { ok: true } | { ok: false; error: string };

function hasAdjacentRoad(state: GameState, x: number, y: number): boolean {
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  return dirs.some(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    return inBounds(state, nx, ny) && state.map.tiles[tileIndex(state, nx, ny)] === Tile.Road;
  });
}

/** Valida sin aplicar. El motor es quien decide si un comando es legal. */
export function validateCommand(state: GameState, raw: unknown): CommandResult {
  const parsed = Command.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'comando mal formado' };
  const cmd = parsed.data;
  switch (cmd.type) {
    case 'SetTax':
      return { ok: true };
    case 'Build': {
      if (!inBounds(state, cmd.x, cmd.y)) return { ok: false, error: 'fuera del mapa' };
      const t = state.map.tiles[tileIndex(state, cmd.x, cmd.y)];
      if (t === Tile.Road || buildingAt(state, cmd.x, cmd.y)) return { ok: false, error: 'ocupado' };
      const cost = BUILD_COST[cmd.kind];
      if (state.treasury < cost) return { ok: false, error: 'sin dinero' };
      if (cmd.kind !== 'road' && !hasAdjacentRoad(state, cmd.x, cmd.y)) {
        return { ok: false, error: 'necesita carretera al lado' };
      }
      return { ok: true };
    }
    case 'Demolish': {
      if (!inBounds(state, cmd.x, cmd.y)) return { ok: false, error: 'fuera del mapa' };
      const b = buildingAt(state, cmd.x, cmd.y);
      if (b?.kind === 'townhall') return { ok: false, error: 'el ayuntamiento no se derriba' };
      const t = state.map.tiles[tileIndex(state, cmd.x, cmd.y)];
      if (!b && t !== Tile.Road) return { ok: false, error: 'nada que derribar' };
      return { ok: true };
    }
  }
}

export function applyCommand(state: GameState, raw: unknown): CommandResult {
  const v = validateCommand(state, raw);
  if (!v.ok) return v;
  const cmd = Command.parse(raw);
  switch (cmd.type) {
    case 'SetTax':
      if (state.taxLevel !== cmd.level) {
        state.taxLevel = cmd.level;
        pushEvent(state, 'tax', `Impuestos: ${cmd.level}`);
      }
      break;
    case 'Build': {
      transfer(state, TREASURY, OUTSIDE, BUILD_COST[cmd.kind]);
      const idx = tileIndex(state, cmd.x, cmd.y);
      if (cmd.kind === 'road') {
        state.map.tiles[idx] = Tile.Road;
      } else {
        state.map.tiles[idx] = Tile.Grass;
        state.buildings.push({ id: state.nextId++, kind: cmd.kind, x: cmd.x, y: cmd.y, owner: TREASURY });
        pushEvent(state, 'built', `Construido: ${cmd.kind}`);
      }
      break;
    }
    case 'Demolish': {
      const b = buildingAt(state, cmd.x, cmd.y);
      if (b) {
        state.buildings = state.buildings.filter((x) => x !== b);
        for (const c of state.citizens) {
          if (c.homeId === b.id) c.homeId = null;
          if (c.jobId === b.id) c.jobId = null;
        }
      } else {
        state.map.tiles[tileIndex(state, cmd.x, cmd.y)] = Tile.Grass;
      }
      break;
    }
  }
  return { ok: true };
}
