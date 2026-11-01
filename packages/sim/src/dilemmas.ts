/**
 * 2.4 (bloque D): dilemas morales con datos reales (`ResolveDilemma`). El
 * motor ofrece las opciones y aplica sus efectos (`DILEMMA` en balance.ts);
 * la IA solo elige cuál sale y la presenta.
 */
import type { CommandResult } from './commands.ts';
import type { GameState } from './state.ts';

export function canResolveDilemma(state: GameState, id: number, option: string): CommandResult {
  const d = state.dilemmas.find((x) => x.id === id);
  if (!d || d.resolved) return { ok: false, error: 'Ese dilema ya no está abierto' };
  if (!d.options.includes(option)) return { ok: false, error: 'Esa opción no está' };
  return { ok: false, error: 'Aún no disponible' };
}

export function resolveDilemma(state: GameState, id: number, option: string): void {
  const d = state.dilemmas.find((x) => x.id === id);
  if (d) d.resolved = option;
}
