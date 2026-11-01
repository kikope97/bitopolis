import type { LandmarkKind } from '@bitopolis/shared';
import type { CommandResult } from './commands.ts';
import type { GameState } from './state.ts';

/**
 * 2.3: grandes obras por fases (puente de piedra, estación, feria, estadio,
 * catedral). Números en `LANDMARKS` (balance.ts); estado en `state.landmarks`.
 * F0: solo las firmas; la lógica llega en F1.
 */

const NOT_YET: CommandResult = { ok: false, error: 'Aún no está disponible' };

export function canStartLandmark(_state: GameState, _kind: LandmarkKind, _x: number, _y: number): CommandResult {
  return NOT_YET;
}
export function startLandmark(_state: GameState, _kind: LandmarkKind, _x: number, _y: number): void {}

export function canFundLandmarkPhase(_state: GameState, _id: number): CommandResult {
  return NOT_YET;
}
export function fundLandmarkPhase(_state: GameState, _id: number): void {}

export function canPauseLandmark(_state: GameState, _id: number): CommandResult {
  return NOT_YET;
}
export function pauseLandmark(_state: GameState, _id: number): void {}

/** Fin de día (tras las mejoras de servicios terminadas): fases que terminan. */
export function landmarksDay(_state: GameState): void {}

/** Fin de mes (tras el mantenimiento de los edificios): mantenimiento de las obras y cofinanciación. */
export function landmarksMonth(_state: GameState): void {}
