import type { BigCompanyIncentive } from '@bitopolis/shared';
import type { CommandResult } from './commands.ts';
import type { GameState } from './state.ts';

/**
 * 2.3: ciclo comarcal (bonanza, normal, crisis), FEDER y la gran empresa.
 * Números en `REGION` (balance.ts); estado en `state.region` y `state.bigCompany`.
 * F0: solo las firmas; la lógica llega en F1.
 */

const NOT_YET: CommandResult = { ok: false, error: 'Aún no está disponible' };

export function canAnswerBigCompany(_state: GameState, _accept: boolean, _incentive: BigCompanyIncentive): CommandResult {
  return NOT_YET;
}
export function answerBigCompany(_state: GameState, _accept: boolean, _incentive: BigCompanyIncentive): void {}

/** Principio del fin de mes (antes de las nóminas): cambio de fase, avisos, FEDER y la gran empresa. */
export function regionMonth(_state: GameState): void {}
