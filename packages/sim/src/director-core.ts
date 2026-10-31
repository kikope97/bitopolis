// Sin dependencias en tiempo de carga (lo importan crimen, asociaciones e historias).
import type { GameState } from './state.ts';

/** Algo que se está cociendo: el director lo avisa antes de que pase (si es malo, debe avisarse antes). */
export interface Brewing {
  /** Id del suceso en el menú del director (p. ej. «robo_tienda:42»). */
  id: string;
  text: string;
  /** Tick en el que se avisó. */
  since: number;
  bad: boolean;
}

/**
 * 2.0: en Modo IA, si el último turno lo dirigió la IA, robos de fuera,
 * asociaciones nuevas, manifestaciones por impaciencia e historias los elige
 * el director. Si no respondió, vuelven las reglas (tiran dados) de respaldo.
 */
export function directorOwns(state: GameState): boolean {
  return !!(state.aiMode && state.ai?.directed);
}
