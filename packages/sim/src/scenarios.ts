import type { GameState } from './state.ts';

/**
 * 2.3: escenarios al empezar (Libre, Pueblo en quiebra, El pueblo que se vacía,
 * Tras la riada). Números en `SCENARIOS` (balance.ts); estado en `state.scenario`.
 * F0: solo las firmas; la lógica llega en F1.
 */

/** Prepara el escenario de `state.scenario.id` tras el terreno (determinista; Libre no cambia nada). */
export function applyScenario(_state: GameState): void {}

/** Fin de mes (tras guardar `stats`): ¿se cumplió la meta o venció el plazo? */
export function scenariosMonth(_state: GameState): void {}
