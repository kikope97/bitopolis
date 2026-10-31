import type { BuildKind } from '@bitopolis/shared';
import { BUILD } from './balance.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { type GameState, pushEvent } from './state.ts';

/**
 * v1.8 (petición del creador): el ayuntamiento es el centro del pueblo y sube
 * de nivel. Cada nivel pide vecinos y dinero y desbloquea edificios y partes
 * del juego. El nivel es lo único que decide qué está desbloqueado (cada nivel
 * ya exige su población).
 */
export interface TownhallLevel {
  level: number;
  /** Vecinos necesarios para subir a este nivel. */
  pop: number;
  /** Lo que cuesta la obra de ampliación. */
  cost: number;
  name: string;
  /** Lo que se desbloquea, en palabras (para la interfaz). */
  unlocks: string[];
}

export const TOWNHALL_LEVELS: TownhallLevel[] = [
  { level: 1, pop: 0, cost: 0, name: 'Casa consistorial', unlocks: ['carretera', 'casas', 'agua', 'luz', 'parque'] },
  { level: 2, pop: 10, cost: 3_000, name: 'Ayuntamiento con reloj', unlocks: ['zonas R, C e I', 'colegio', 'policía', 'bar', 'ermita', 'cementerio', 'bomberos', 'plenos'] },
  { level: 3, pop: 30, cost: 15_000, name: 'Ayuntamiento con balcón', unlocks: ['centro de salud', 'biblioteca', 'polideportivo', 'protección civil', 'Plaza Mayor (con su hito)'] },
  { level: 4, pop: 60, cost: 35_000, name: 'Casa del Pueblo', unlocks: ['cárcel', 'Mercado (con su hito)'] },
  { level: 5, pop: 120, cost: 70_000, name: 'Palacio Municipal', unlocks: ['más felicidad en todo el pueblo', 'más subvenciones de la Diputación'] },
];

/** Nivel de ayuntamiento que pide cada obra. */
export const BUILD_LEVEL: Record<BuildKind, number> = {
  road: 1,
  house: 1,
  water: 1,
  power: 1,
  park: 1,
  school: 2,
  police: 2,
  bar: 2,
  chapel: 2,
  cemetery: 2,
  clinic: 3,
  library: 3,
  sports: 3,
  plaza: 3,
  jail: 4,
  market: 4,
  // 2.1: emergencias.
  firestation: 2,
  civilprotection: 3,
};

export const townLevel = (state: GameState): number => state.townhallLevel ?? 1;
export const zonesUnlocked = (state: GameState): boolean => townLevel(state) >= 2;
export const plenoUnlocked = (state: GameState): boolean => townLevel(state) >= 2;

/** ¿Se puede construir ya? (nivel y vecinos; la Plaza y el Mercado, con su hito) */
export function isUnlocked(state: GameState, kind: BuildKind): boolean {
  if (townLevel(state) < BUILD_LEVEL[kind]) return false;
  if (kind === 'plaza' || kind === 'market') return state.unlocked.includes(kind);
  // Además del nivel, sus vecinos (petición del creador: «aparte de habitantes, nivel»).
  return state.citizens.length >= BUILD[kind].unlockPop;
}

export function nextLevel(state: GameState): TownhallLevel | null {
  return TOWNHALL_LEVELS[townLevel(state)] ?? null;
}

export function canUpgradeTownhall(state: GameState): { ok: true } | { ok: false; error: string } {
  const next = nextLevel(state);
  if (!next) return { ok: false, error: 'El ayuntamiento ya está en su nivel más alto' };
  if (state.citizens.length < next.pop) return { ok: false, error: `Hacen falta ${next.pop} vecinos (hay ${state.citizens.length})` };
  if (state.treasury < next.cost) return { ok: false, error: `Faltan ${next.cost - state.treasury} € en la caja (cuesta ${next.cost} €; hay ${state.treasury} €)` };
  return { ok: true };
}

export function upgradeTownhall(state: GameState): void {
  const next = nextLevel(state)!;
  transfer(state, TREASURY, OUTSIDE, next.cost, 'obras');
  state.townhallLevel = next.level;
  const hall = state.buildings.find((b) => b.kind === 'townhall');
  pushEvent(state, 'milestone', `El ayuntamiento sube a nivel ${next.level} (${next.name}): desbloquea ${next.unlocks.join(', ')}`, hall ? { ref: hall.id } : {});
}

/** Nivel que tendría un pueblo de antes (para la migración: no bloquear lo que ya tenía). */
export function levelForPop(pop: number): number {
  let lv = 1;
  for (const l of TOWNHALL_LEVELS) if (pop >= l.pop) lv = l.level;
  return lv;
}
