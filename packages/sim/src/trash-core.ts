// Sin dependencias en tiempo de carga (lo importan levels.ts y economy.ts; social.ts crearía un ciclo).
import { TRASH } from './balance.ts';
import { levelOf, truckRouteOf } from './levels.ts';
import { type Building, DIRS, type GameState, inBounds, Tile, tileIndex } from './state.ts';

/** 2.1: la parte pura de la basura (rutas del camión, quién tiene recogida, estado de cada edificio). Ver trash.ts. */
export type TrashState = 'limpio' | 'bolsas' | 'ratas';

/** ¿Se acumula ya la basura? */
export function trashActive(state: GameState): boolean {
  return !!state.trash && state.trash.start >= 0 && state.tick >= state.trash.start;
}

export function trashStateOf(b: Building): TrashState {
  const t = b.trash ?? 0;
  return t >= TRASH.ratsAt ? 'ratas' : t >= TRASH.dirtyAt ? 'bolsas' : 'limpio';
}

/**
 * Calles que recorre hoy el camión de cada punto limpio (en orden de recorrido:
 * de cerca a lejos por la red). Una calle que ya recorre otro camión no gasta
 * recorrido. Con nieve, cada camión llega a la mitad.
 */
export function truckRoutes(state: GameState, snow = false): { id: number; roads: number[] }[] {
  const { tiles, w } = state.map;
  const taken = new Set<number>();
  const out: { id: number; roads: number[] }[] = [];
  const plants = state.buildings.filter((b) => b.kind === 'cleanpoint' && b.built && !b.damaged).sort((a, b) => a.id - b.id);
  for (const p of plants) {
    let left = Math.round(truckRouteOf(p) * (snow ? TRASH.snowRoute : 1));
    const roads: number[] = [];
    const queue: number[] = [];
    const seen = new Set<number>();
    for (const [dx, dy] of DIRS) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (!inBounds(state, x, y)) continue;
      const i = tileIndex(state, x, y);
      if (tiles[i] === Tile.Road && !seen.has(i)) {
        seen.add(i);
        queue.push(i);
      }
    }
    for (let q = 0; q < queue.length && left > 0; q++) {
      const i = queue[q]!;
      if (!taken.has(i)) {
        taken.add(i);
        roads.push(i);
        left--;
      }
      const x = i % w;
      const y = Math.floor(i / w);
      for (const [dx, dy] of DIRS) {
        if (!inBounds(state, x + dx, y + dy)) continue;
        const j = tileIndex(state, x + dx, y + dy);
        if (tiles[j] === Tile.Road && !seen.has(j)) {
          seen.add(j);
          queue.push(j);
        }
      }
    }
    out.push({ id: p.id, roads });
  }
  return out;
}

/** Qué punto limpio atiende a cada edificio (el de la primera calle suya que recorre un camión). */
export function trashServed(state: GameState, snow = false): Map<number, Building> {
  const byRoad = new Map<number, Building>();
  for (const r of truckRoutes(state, snow)) {
    const p = state.buildings.find((b) => b.id === r.id)!;
    for (const i of r.roads) byRoad.set(i, p);
  }
  const out = new Map<number, Building>();
  if (!byRoad.size) return out;
  for (const b of state.buildings) {
    for (const [dx, dy] of DIRS) {
      if (!inBounds(state, b.x + dx, b.y + dy)) continue;
      const p = byRoad.get(tileIndex(state, b.x + dx, b.y + dy));
      if (p) {
        out.set(b.id, p);
        break;
      }
    }
  }
  return out;
}

/** Basura que genera un edificio al día. */
export function trashPerDay(b: Building, residents: number, workers: number): number {
  if (!b.built) return 0;
  const base = residents * TRASH.perResident + workers * TRASH.perWorker;
  return base > 0 ? base + (TRASH.activity[b.kind] ?? 0) : 0;
}

/** Lo que nota un vecino en su casa (para la felicidad). */
export function trashMood(state: GameState, home: Building): { label: string; value: number } | null {
  const dirt = state.fields.dirt?.[home.y * state.map.w + home.x] ?? 0;
  if (dirt >= TRASH.ratsField) return { label: 'Ratas en el barrio', value: -TRASH.ratsMood };
  if (dirt >= TRASH.dirtyField) return { label: 'Basura en la calle', value: -TRASH.dirtyMood };
  return null;
}

/**
 * Tasa de basuras de un vecino: solo con recogida; con reciclaje (nivel 2+), más barata.
 * Mientras el pueblo es pequeño (la basura aún no se acumula), el ayuntamiento la
 * recoge como siempre y cobra la tasa entera.
 */
export function trashFee(state: GameState, base: number, servedBy: Building | undefined): number {
  if (!trashActive(state)) return base;
  if (!servedBy) return 0;
  return levelOf(servedBy) >= 2 ? Math.round(base * (1 - TRASH.recyclingDiscount)) : base;
}

