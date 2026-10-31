import type { BuildKind } from '@bitopolis/shared';
import { BUILD } from './balance.ts';
import { isUnlocked } from './townhall.ts';
import { radiusOf } from './levels.ts';
import { serviceSaturation } from './economy.ts';
import { DIRS, type GameState, inBounds, Tile, tileIndex, Zone } from './state.ts';

/**
 * v1.7 (propuesta del creador): qué servicio le falta a cada sitio. Lo usan la
 * capa «Qué falta», la ficha de cada edificio y el consejero. Función pura:
 * no toca el estado y no usa azar.
 */
export type NeedKey = 'agua' | 'luz' | 'colegio' | 'salud' | 'policia' | 'ocio';
export const NEED_KEYS: NeedKey[] = ['agua', 'luz', 'colegio', 'salud', 'policia', 'ocio'];
export const NEED_LABEL: Record<NeedKey, string> = {
  agua: 'agua',
  luz: 'luz',
  colegio: 'colegio',
  salud: 'centro de salud',
  policia: 'policía',
  ocio: 'parque o plaza',
};
/** Qué edificios cubren cada necesidad por radio (agua y luz van por la red). */
export const NEED_KINDS: Record<NeedKey, string[]> = {
  agua: ['water'],
  luz: ['power'],
  colegio: ['school'],
  salud: ['clinic'],
  policia: ['police'],
  ocio: ['park', 'plaza', 'market'],
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
    if (p.kind !== kind || !p.built) continue;
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
    return isUnlocked(state, NEED_KINDS[k][0] as BuildKind);
  });
}

export interface CoverageCtx {
  water: Set<number>;
  power: Set<number>;
  active: NeedKey[];
}
export function coverageCtx(state: GameState): CoverageCtx {
  return { water: networkRoads(state, 'water'), power: networkRoads(state, 'power'), active: activeNeeds(state) };
}

/**
 * Lo que le falta al sitio (x, y). Si hay un edificio, se usan sus banderas
 * de agua y luz (que respetan la capacidad de las plantas); en un solar, si
 * alguna carretera vecina está en la red.
 */
export function missingServices(state: GameState, x: number, y: number, ctx: CoverageCtx = coverageCtx(state)): CoverageNeed[] {
  const out: CoverageNeed[] = [];
  const b = state.buildings.find((q) => q.x === x && q.y === y);
  const roadNear = (set: Set<number>) =>
    DIRS.some(([dx, dy]) => inBounds(state, x + dx, y + dy) && set.has(tileIndex(state, x + dx, y + dy)));
  for (const key of ctx.active) {
    if (key === 'agua' || key === 'luz') {
      if (b?.kind === 'water' || b?.kind === 'power') continue;
      const ok = b && b.built ? (key === 'agua' ? b.hasWater : b.hasPower) : roadNear(key === 'agua' ? ctx.water : ctx.power);
      if (!ok) out.push({ key, status: 'falta' });
      continue;
    }
    const reach = state.buildings.filter(
      (s) => s.built && NEED_KINDS[key].includes(s.kind) && Math.abs(s.x - x) + Math.abs(s.y - y) <= radiusOf(s),
    );
    if (!reach.length) out.push({ key, status: 'falta' });
    // Llega, pero todos los que llegan están saturados (atienden a menos del 90 % de quien lo usa).
    else if (reach.every((s) => serviceSaturation(state, s.kind, s.id) < 0.9)) out.push({ key, status: 'lleno' });
  }
  return out;
}

/** Sitios donde vive o vivirá gente: viviendas y solares de zona R. */
export function homeSites(state: GameState): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const homes = new Set<number>();
  for (const b of state.buildings) {
    if (b.kind === 'house' || b.kind === 'res') {
      out.push({ x: b.x, y: b.y });
      homes.add(b.y * state.map.w + b.x);
    }
  }
  state.map.zones.forEach((z, i) => {
    if (z === Zone.R && !homes.has(i) && state.map.tiles[i] !== Tile.Road && !state.buildings.some((b) => b.y * state.map.w + b.x === i)) {
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
