/**
 * 2.4 (bloque B): estación de autobuses (`busstation`), billete (`SetBusFare`),
 * trabajo fuera y visitantes. Números en `TRANSIT` (balance.ts).
 */
import type { CommandResult } from './commands.ts';
import type { BusFare, GameState } from './state.ts';

export function canSetBusFare(state: GameState, fare: BusFare): CommandResult {
  void state;
  void fare;
  return { ok: false, error: 'Aún no disponible' };
}

export function setBusFare(state: GameState, fare: BusFare): void {
  state.transit.fare = fare;
}
