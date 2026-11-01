/**
 * 2.4 (bloque A): guardería y residencia de mayores. Cuotas (`SetCareFee`),
 * natalidad con plaza, pensión mínima, mayores atendidos y la decisión
 * «llevar a la residencia o cuidar en casa». Números en `CARE` (balance.ts).
 */
import type { CommandResult } from './commands.ts';
import type { FeeLevel, GameState } from './state.ts';

export function canSetCareFee(state: GameState, service: 'nursery' | 'residence', level: FeeLevel): CommandResult {
  void state;
  void service;
  void level;
  return { ok: false, error: 'Aún no disponible' };
}

export function setCareFee(state: GameState, service: 'nursery' | 'residence', level: FeeLevel): void {
  if (service === 'nursery') state.care.nurseryFee = level;
  else state.care.residenceFee = level;
}
