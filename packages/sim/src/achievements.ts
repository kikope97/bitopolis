import type { GameState } from './state.ts';

/**
 * 2.3: historia por años (`state.history`), récords (`state.records`) y
 * logros y medallas (`state.medals`). Umbrales en `ACHIEVEMENTS` (balance.ts);
 * la lista de logros con su comprobación va en `ACHIEVEMENT_LIST`.
 * F0: solo las firmas; la lógica llega en F1.
 */

export interface Achievement {
  id: string;
  text: string;
  tier: 'bronce' | 'plata' | 'oro';
  check: (state: GameState) => boolean;
}

export const ACHIEVEMENT_LIST: Achievement[] = [];

/** Fin de mes (tras guardar `stats`): año en curso de `history` y récords nuevos. */
export function historyMonth(_state: GameState): void {}

/** Fin de mes (tras `historyMonth` y los escenarios): medallas nuevas. */
export function achievementsMonth(_state: GameState): void {}
