import type { BuildKind } from '@bitopolis/shared';
import { BUILD } from './balance.ts';
import { isUnlocked } from './townhall.ts';
import { truckRouteOf } from './levels.ts';
import { serviceSaturation } from './economy.ts';
import { reaches, servingOf } from './reach.ts';
import { buildingAt, DIRS, footprint, type GameState, hasAdjacentRoad, inBounds, Tile, tileIndex, Zone } from './state.ts';
import { truckRoutes } from './trash-core.ts';

/**
 * v1.7 (propuesta del creador): qué servicio le falta a cada sitio. Lo usan la
 * capa «Qué falta», la ficha de cada edificio y el consejero. Función pura:
 * no toca el estado y no usa azar.
 */
export type NeedKey = 'agua' | 'luz' | 'colegio' | 'salud' | 'policia' | 'ocio' | 'bomberos' | 'basuras';
export const NEED_KEYS: NeedKey[] = ['agua', 'luz', 'colegio', 'salud', 'policia', 'ocio', 'bomberos', 'basuras'];
export const NEED_LABEL: Record<NeedKey, string> = {
  agua: 'agua',
  luz: 'luz',
  colegio: 'colegio',
  salud: 'centro de salud',
  policia: 'policía',
  ocio: 'parque o plaza',
  bomberos: 'bomberos',
  basuras: 'recogida de basura',
};
/** Qué edificios cubren cada necesidad por radio (agua y luz van por la red). */
export const NEED_KINDS: Record<NeedKey, string[]> = {
  agua: ['water'],
  luz: ['power'],
  colegio: ['school'],
  salud: ['clinic'],
  policia: ['police'],
  ocio: ['park', 'plaza', 'market'],
  // 2.1: en la colina solo llega el parque con cisterna (nivel 2).
  bomberos: ['firestation'],
  // 2.1: va por la ruta del camión (trash-core.ts), no por radio.
  basuras: ['cleanpoint'],
};

export interface CoverageNeed {
  key: NeedKey;
  /** «falta»: no llega; «lleno»: llega pero está saturado (por encima del 90 %). */
  status: 'falta' | 'lleno';
}

/** Carreteras conectadas a alguna planta (sin contar su capacidad): dónde llegaría el agua o la luz. */
export function networkRoads(state: GameState, kind: 'water' | 'power'): Set<number> {
  const out = new Set<number>();
  const queue: number[] = [];
  const { tiles, w } = state.map;
  for (const p of state.buildings) {
    // 2.4: la luz también sale de placas y molinos.
    if (!(p.kind === kind || (kind === 'power' && (p.kind === 'solar' || p.kind === 'wind'))) || !p.built) continue;
    for (const [dx, dy] of DIRS) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (!inBounds(state, x, y)) continue;
      const i = tileIndex(state, x, y);
      if (tiles[i] === Tile.Road && !out.has(i)) {
        out.add(i);
        queue.push(i);
      }
    }
  }
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % w;
    const y = Math.floor(i / w);
    for (const [dx, dy] of DIRS) {
      if (!inBounds(state, x + dx, y + dy)) continue;
      const j = tileIndex(state, x + dx, y + dy);
      if (tiles[j] === Tile.Road && !out.has(j)) {
        out.add(j);
        queue.push(j);
      }
    }
  }
  return out;
}

/** Necesidades que ya se pueden cubrir (si el servicio aún está bloqueado, no se pide). */
export function activeNeeds(state: GameState): NeedKey[] {
  const pop = state.citizens.length;
  return NEED_KEYS.filter((k) => {
    if (k === 'agua' || k === 'luz') return true;
    // v1.8: lo que ya se puede construir (nivel del ayuntamiento); el parque, desde 10 vecinos.
    if (k === 'ocio') return pop >= BUILD.park.unlockPop;
    // 2.1: la recogida, desde que se puede construir el punto limpio.
    if (k === 'basuras') return isUnlocked(state, 'cleanpoint') || state.buildings.some((b) => b.kind === 'cleanpoint');
    return isUnlocked(state, NEED_KINDS[k][0] as BuildKind);
  });
}

export interface CoverageCtx {
  water: Set<number>;
  power: Set<number>;
  /** 2.1: calles por las que pasa el camión de la basura. */
  trash: Set<number>;
  /** 2.6: trozo de la red de calles de cada carretera (−1 si no es carretera). */
  roadPart: Int32Array;
  /** 2.6: trozos de red donde un camión ya recorre todo lo que da (ahí falta ampliar el punto limpio u otro). */
  trashFullParts: Set<number>;
  active: NeedKey[];
}

/** 2.6: cada carretera, con el número de su trozo de red (las que se tocan, el mismo). */
export function roadParts(state: GameState): Int32Array {
  const { tiles, w } = state.map;
  const part = new Int32Array(tiles.length).fill(-1);
  let n = 0;
  for (let s = 0; s < tiles.length; s++) {
    if (tiles[s] !== Tile.Road || part[s] !== -1) continue;
    const queue = [s];
    part[s] = n;
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % w;
      const y = Math.floor(i / w);
      for (const [dx, dy] of DIRS) {
        if (!inBounds(state, x + dx, y + dy)) continue;
        const j = tileIndex(state, x + dx, y + dy);
        if (tiles[j] === Tile.Road && part[j] === -1) {
          part[j] = n;
          queue.push(j);
        }
      }
    }
    n++;
  }
  return part;
}

export function coverageCtx(state: GameState): CoverageCtx {
  const routes = truckRoutes(state);
  const trash = new Set(routes.flatMap((r) => r.roads));
  const roadPart = roadParts(state);
  const trashFullParts = new Set<number>();
  for (const r of routes) {
    const p = state.buildings.find((b) => b.id === r.id)!;
    if (r.roads.length < truckRouteOf(p)) continue;
    for (const i of r.roads) trashFullParts.add(roadPart[i]!);
  }
  return { water: networkRoads(state, 'water'), power: networkRoads(state, 'power'), trash, roadPart, trashFullParts, active: activeNeeds(state) };
}

/**
 * Lo que le falta al sitio (x, y). Si hay un edificio, se usan sus banderas
 * de agua y luz (que respetan la capacidad de las plantas); en un solar, si
 * alguna carretera vecina está en la red.
 */
export function missingServices(state: GameState, x: number, y: number, ctx: CoverageCtx = coverageCtx(state)): CoverageNeed[] {
  const out: CoverageNeed[] = [];
  const b = buildingAt(state, x, y);
  for (const key of ctx.active) {
    const status = needStatus(state, key, x, y, ctx, b);
    if (status) out.push({ key, status });
  }
  return out;
}

/** 2.6: cómo está UNA necesidad en (x, y): null si la tiene; si no, «falta» o «lleno». La usan `missingServices` y `coverageOf`. */
export function needStatus(state: GameState, key: NeedKey, x: number, y: number, ctx: CoverageCtx, b = buildingAt(state, x, y)): CoverageNeed['status'] | null {
  const roadNear = (set: Set<number>) => DIRS.some(([dx, dy]) => inBounds(state, x + dx, y + dy) && set.has(tileIndex(state, x + dx, y + dy)));
  if (key === 'agua' || key === 'luz') {
    if (b?.kind === 'water' || b?.kind === 'power' || b?.kind === 'solar' || b?.kind === 'wind') return null;
    const ok = b && b.built ? (key === 'agua' ? b.hasWater : b.hasPower) : roadNear(key === 'agua' ? ctx.water : ctx.power);
    return ok ? null : 'falta';
  }
  if (key === 'basuras') {
    // Llega si el camión pasa por alguna calle de al lado; «lleno» si en SU trozo de red hay un camión que no da para más (2.6).
    if (b?.kind === 'cleanpoint' || roadNear(ctx.trash)) return null;
    const full = DIRS.some(([dx, dy]) => inBounds(state, x + dx, y + dy) && ctx.trashFullParts.has(ctx.roadPart[tileIndex(state, x + dx, y + dy)]!));
    return full ? 'lleno' : 'falta';
  }
  // 2.6: el mismo alcance que la carga y la felicidad (reach.ts).
  const reach = state.buildings.filter((s) => NEED_KINDS[key].includes(s.kind) && reaches(state, s, x, y));
  const who = servingOf(reach, x, y);
  if (!who) return 'falta';
  // 2.6: «lleno» si el que atiende de verdad (el más cercano, como en serviceLoads) está saturado.
  return serviceSaturation(state, who.kind, who.id) < 0.9 ? 'lleno' : null;
}

/** 2.6: edificios donde vive gente (casas, bloques y vivienda protegida). */
export const isHomeKind = (kind: string): boolean => kind === 'house' || kind === 'res' || kind === 'vpo';

/** Sitios donde vive o vivirá gente: viviendas y solares de zona R. */
export function homeSites(state: GameState): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const homes = new Set<number>();
  for (const b of state.buildings) {
    if (isHomeKind(b.kind)) {
      out.push({ x: b.x, y: b.y });
      homes.add(b.y * state.map.w + b.x);
    }
  }
  // 2.3: casillas ocupadas por algún edificio (los 2×2 ocupan 4).
  const taken = new Set<number>();
  for (const b of state.buildings) for (const [x, y] of footprint(b)) taken.add(y * state.map.w + x);
  state.map.zones.forEach((z, i) => {
    if (z === Zone.R && !homes.has(i) && state.map.tiles[i] !== Tile.Road && !taken.has(i)) {
      out.push({ x: i % state.map.w, y: Math.floor(i / state.map.w) });
    }
  });
  return out;
}

/** Resumen para el consejero y la leyenda: cuántas viviendas (y solares R) carecen de cada cosa. */
export function coverageSummary(state: GameState): { key: NeedKey; falta: number; lleno: number }[] {
  const ctx = coverageCtx(state);
  const sum = new Map<NeedKey, { falta: number; lleno: number }>();
  for (const s of homeSites(state)) {
    for (const n of missingServices(state, s.x, s.y, ctx)) {
      const e = sum.get(n.key) ?? { falta: 0, lleno: 0 };
      e[n.status]++;
      sum.set(n.key, e);
    }
  }
  return NEED_KEYS.filter((k) => sum.has(k)).map((k) => ({ key: k, ...sum.get(k)! }));
}

/**
 * Solar de zona que nunca se construirá porque no toca ninguna carretera (el
 * crecimiento de `tick.ts` y las fincas solo eligen casillas con una carretera
 * al lado). Lo usan la franja, la ficha del solar y la hoja de demanda.
 */
export function zoneLotWithoutRoad(state: GameState, x: number, y: number): boolean {
  if (!inBounds(state, x, y)) return false;
  const i = tileIndex(state, x, y);
  const z = state.map.zones[i];
  if (z === undefined || z === Zone.None || state.map.tiles[i] === Tile.Road) return false;
  if (buildingAt(state, x, y)) return false;
  return !hasAdjacentRoad(state, x, y);
}

/** Cuántos solares de cada zona no tocan carretera (los ya construidos no cuentan). */
export function zonesWithoutRoad(state: GameState): { R: number; C: number; I: number; A: number } {
  const out = { R: 0, C: 0, I: 0, A: 0 };
  const { w, h, zones } = state.map;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const z = zones[y * w + x];
      if (!z || !zoneLotWithoutRoad(state, x, y)) continue;
      if (z === Zone.R) out.R++;
      else if (z === Zone.C) out.C++;
      else if (z === Zone.I) out.I++;
      else if (z === Zone.A) out.A++;
    }
  return out;
}
