import { Command, type BuildKind, type ZoneKind } from '@bitopolis/shared';
import { BUILD, WAGE_OUTSIDE, ZONE_COST_PER_TILE, ZONE_UNLOCK_POP } from './balance.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import {
  buildingAt,
  buildingById,
  type GameState,
  hasAdjacentRoad,
  inBounds,
  newBuilding,
  pushEvent,
  Tile,
  tileIndex,
  Zone,
} from './state.ts';

export type CommandResult = { ok: true } | { ok: false; error: string };

export const BUILD_NAMES: Record<string, string> = {
  townhall: 'Ayuntamiento',
  road: 'Carretera',
  house: 'Casa municipal',
  water: 'Bomba de agua',
  power: 'Central eléctrica',
  park: 'Parque',
  school: 'Colegio',
  clinic: 'Centro de salud',
  res: 'Viviendas',
  shop: 'Tienda',
  factory: 'Taller',
};

const ZONE_VALUE: Record<ZoneKind, number> = { none: Zone.None, R: Zone.R, C: Zone.C, I: Zone.I };

/** Coste total previsto (materiales + mano de obra al precio de fuera). */
export function buildCost(kind: BuildKind): number {
  const s = BUILD[kind];
  return s.materials + s.workers * s.days * WAGE_OUTSIDE;
}

function roadTiles(x: number, y: number, x2: number, y2: number): [number, number][] {
  const out: [number, number][] = [];
  if (x !== x2 && y !== y2) return out;
  const dx = Math.sign(x2 - x);
  const dy = Math.sign(y2 - y);
  let cx = x;
  let cy = y;
  for (;;) {
    out.push([cx, cy]);
    if (cx === x2 && cy === y2) break;
    cx += dx;
    cy += dy;
  }
  return out;
}

function roadNewTiles(state: GameState, x: number, y: number, x2: number, y2: number) {
  return roadTiles(x, y, x2, y2).filter(
    ([tx, ty]) => state.map.tiles[tileIndex(state, tx, ty)] !== Tile.Road && !buildingAt(state, tx, ty),
  );
}

/** Valida sin aplicar. El motor es quien decide si un comando es legal. */
export function validateCommand(state: GameState, raw: unknown): CommandResult {
  const parsed = Command.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'comando mal formado' };
  const cmd = parsed.data;
  const pop = state.citizens.length;
  switch (cmd.type) {
    case 'SetTax':
      return { ok: true };
    case 'Build': {
      if (cmd.kind === 'road') return validateCommand(state, { type: 'BuildRoad', x: cmd.x, y: cmd.y, x2: cmd.x, y2: cmd.y });
      if (!inBounds(state, cmd.x, cmd.y)) return { ok: false, error: 'Fuera del mapa' };
      const spec = BUILD[cmd.kind];
      if (pop < spec.unlockPop) return { ok: false, error: `Se desbloquea con ${spec.unlockPop} vecinos` };
      const t = state.map.tiles[tileIndex(state, cmd.x, cmd.y)];
      if (t === Tile.Road || buildingAt(state, cmd.x, cmd.y)) return { ok: false, error: 'Ese sitio está ocupado' };
      if (!hasAdjacentRoad(state, cmd.x, cmd.y)) return { ok: false, error: 'Necesita una carretera al lado' };
      if (state.treasury < buildCost(cmd.kind)) return { ok: false, error: 'No hay dinero suficiente' };
      return { ok: true };
    }
    case 'BuildRoad': {
      if (!inBounds(state, cmd.x, cmd.y) || !inBounds(state, cmd.x2, cmd.y2)) return { ok: false, error: 'Fuera del mapa' };
      if (cmd.x !== cmd.x2 && cmd.y !== cmd.y2) return { ok: false, error: 'La carretera debe ser recta' };
      const tiles = roadNewTiles(state, cmd.x, cmd.y, cmd.x2, cmd.y2);
      if (tiles.length === 0) return { ok: false, error: 'Ya hay carretera' };
      if (state.treasury < tiles.length * BUILD.road.materials) return { ok: false, error: 'No hay dinero suficiente' };
      return { ok: true };
    }
    case 'Zone': {
      if (cmd.zone !== 'none' && pop < ZONE_UNLOCK_POP) return { ok: false, error: `Las zonas se desbloquean con ${ZONE_UNLOCK_POP} vecinos` };
      if (!inBounds(state, cmd.x, cmd.y) || !inBounds(state, cmd.x + cmd.w - 1, cmd.y + cmd.h - 1)) {
        return { ok: false, error: 'Fuera del mapa' };
      }
      if (cmd.zone !== 'none' && state.treasury < cmd.w * cmd.h * ZONE_COST_PER_TILE) return { ok: false, error: 'No hay dinero suficiente' };
      return { ok: true };
    }
    case 'Demolish': {
      if (!inBounds(state, cmd.x, cmd.y)) return { ok: false, error: 'Fuera del mapa' };
      const b = buildingAt(state, cmd.x, cmd.y);
      if (b?.kind === 'townhall') return { ok: false, error: 'El ayuntamiento no se derriba' };
      const t = state.map.tiles[tileIndex(state, cmd.x, cmd.y)];
      if (!b && t !== Tile.Road) return { ok: false, error: 'No hay nada que derribar' };
      return { ok: true };
    }
    case 'NotifyProject':
      return state.projects.some((p) => p.buildingId === cmd.buildingId) ? { ok: true } : { ok: false, error: 'No hay obra' };
  }
}

/** Quita un edificio cuidando que su dinero y sus vecinos queden en orden. */
export function removeBuilding(state: GameState, id: number): void {
  const b = buildingById(state, id);
  if (!b) return;
  if (b.cash > 0) transfer(state, b.id, b.owner === TREASURY ? TREASURY : OUTSIDE, b.cash, 'cierres');
  state.buildings = state.buildings.filter((x) => x.id !== id);
  state.projects = state.projects.filter((p) => p.buildingId !== id);
  for (const c of state.citizens) {
    if (c.homeId === id) c.homeId = null;
    if (c.jobId === id) c.jobId = null;
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
        const name = { low: 'bajos', medium: 'medios', high: 'altos' }[cmd.level];
        pushEvent(state, 'tax', `El alcalde pone los impuestos ${name}`);
      }
      break;
    case 'Build': {
      if (cmd.kind === 'road') return applyCommand(state, { type: 'BuildRoad', x: cmd.x, y: cmd.y, x2: cmd.x, y2: cmd.y });
      const spec = BUILD[cmd.kind];
      transfer(state, TREASURY, OUTSIDE, spec.materials, 'obras');
      const idx = tileIndex(state, cmd.x, cmd.y);
      state.map.tiles[idx] = Tile.Grass;
      state.map.zones[idx] = Zone.None;
      const b = newBuilding(state, cmd.kind, cmd.x, cmd.y, TREASURY);
      state.projects.push({
        buildingId: b.id,
        payer: TREASURY,
        workersNeeded: spec.workers,
        workerDaysNeeded: spec.workers * spec.days,
        workerDaysDone: 0,
        crew: [],
        outsideToday: 0,
        notify: false,
      });
      pushEvent(state, 'project', `Empieza la obra: ${BUILD_NAMES[cmd.kind]}`, { ref: b.id });
      break;
    }
    case 'BuildRoad': {
      const tiles = roadNewTiles(state, cmd.x, cmd.y, cmd.x2, cmd.y2);
      transfer(state, TREASURY, OUTSIDE, tiles.length * BUILD.road.materials, 'obras');
      for (const [tx, ty] of tiles) {
        const i = tileIndex(state, tx, ty);
        state.map.tiles[i] = Tile.Road;
        state.map.zones[i] = Zone.None;
      }
      break;
    }
    case 'Zone': {
      const value = ZONE_VALUE[cmd.zone];
      let changed = 0;
      for (let y = cmd.y; y < cmd.y + cmd.h; y++) {
        for (let x = cmd.x; x < cmd.x + cmd.w; x++) {
          const i = tileIndex(state, x, y);
          if (state.map.tiles[i] === Tile.Road || buildingAt(state, x, y)) continue;
          if (state.map.zones[i] === value) continue;
          state.map.zones[i] = value;
          changed++;
        }
      }
      if (value !== Zone.None) transfer(state, TREASURY, OUTSIDE, changed * ZONE_COST_PER_TILE, 'obras');
      break;
    }
    case 'Demolish': {
      const b = buildingAt(state, cmd.x, cmd.y);
      if (b) removeBuilding(state, b.id);
      else state.map.tiles[tileIndex(state, cmd.x, cmd.y)] = Tile.Grass;
      break;
    }
    case 'NotifyProject': {
      const p = state.projects.find((x) => x.buildingId === cmd.buildingId);
      if (p) p.notify = cmd.on;
      break;
    }
  }
  return { ok: true };
}
