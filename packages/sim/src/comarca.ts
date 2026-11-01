/**
 * 2.5 (bloques I y J): los pueblos vecinos (`state.comarca`), simulados como
 * resumen una vez al mes; competencia por vecinos, bolsa de subvenciones,
 * excedentes, alcaldes con IA (`AnswerNeighbor`) y feria comarcal. Números en `COMARCA`.
 */
import type { CommandResult } from './commands.ts';
import type { GameState } from './state.ts';

export function canAnswerNeighbor(state: GameState, id: number, accept: boolean): CommandResult {
  void accept;
  const o = state.comarca.offers.find((x) => x.id === id);
  if (!o || o.resolved) return { ok: false, error: 'Esa oferta ya no está' };
  return { ok: false, error: 'Aún no disponible' };
}

export function answerNeighbor(state: GameState, id: number, accept: boolean): void {
  const o = state.comarca.offers.find((x) => x.id === id);
  if (o && !o.resolved) o.resolved = accept ? 'accepted' : 'rejected';
}
