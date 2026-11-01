import type { CommandResult } from './commands.ts';
import type { GameState } from './state.ts';

/**
 * 2.3: turismo y patrimonio (visitantes, casas rurales, tasa turística y
 * entorno protegido). Números en `TOURISM` (balance.ts); estado en `state.tourism`.
 * F0: solo las firmas; la lógica llega en F1.
 */

const NOT_YET: CommandResult = { ok: false, error: 'Aún no está disponible' };

export function canSetTouristTax(_state: GameState, _level: 0 | 1 | 2): CommandResult {
  return NOT_YET;
}
export function setTouristTax(_state: GameState, _level: 0 | 1 | 2): void {}

export function canProtectArea(_state: GameState, _heritageId: number): CommandResult {
  return NOT_YET;
}
export function protectArea(_state: GameState, _heritageId: number): void {}

/** Fin de mes (tras dividendos y cierres, antes de la PIE): visitantes, casas rurales y tasa. */
export function tourismMonth(_state: GameState): void {}
