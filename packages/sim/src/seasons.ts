/**
 * 2.4 (bloque E): fiestas de temporada (romería, San Juan, patronales y
 * Navidad) con comisión de festejos, programa y presupuesto
 * (`ApproveFestival`). Números en `SEASONS` (balance.ts).
 */
import type { CommandResult } from './commands.ts';
import type { FestivalBudget, FestivalSeason, GameState } from './state.ts';

export function canApproveFestival(state: GameState, season: FestivalSeason, budget: FestivalBudget): CommandResult {
  void state;
  void season;
  void budget;
  return { ok: false, error: 'Aún no disponible' };
}

export function approveFestival(state: GameState, season: FestivalSeason, budget: FestivalBudget): void {
  const f = state.seasons.current;
  if (f && f.season === season) {
    f.budget = budget;
    f.status = 'aprobada';
  }
}
