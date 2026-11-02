/**
 * 2.6 (lo básico): cuándo aparece cada sistema. Sin dependencias en tiempo de
 * carga (lo importan dilemas, correos, comarca, gran empresa, encargos,
 * periódico y licitaciones).
 *
 * - `earlyReady`: los sucesos que piden respuesta llegan a partir de unos
 *   vecinos o de un nivel del ayuntamiento (`EARLY` en balance.ts), en Modo
 *   normal y con el director.
 * - `simpleTown`: «Pueblo sencillo» (opción al crear la partida, decisión del
 *   creador): sin encargos, El Eco, comarca, licitaciones ni dilemas. Va en el
 *   estado, así que el servidor lo reproduce igual.
 */
import { EARLY } from './balance.ts';
import type { GameState } from './state.ts';

export type EarlySystem = keyof typeof EARLY;

/** ¿Ha llegado ya el momento de este suceso? (vecinos o nivel del ayuntamiento, lo primero). */
export function earlyReady(state: GameState, sys: EarlySystem): boolean {
  const g = EARLY[sys];
  return state.citizens.length >= g.pop || (state.townhallLevel ?? 1) >= g.level;
}

/** Sistemas que «Pueblo sencillo» apaga. */
export type SimpleOff = 'errands' | 'press' | 'comarca' | 'tenders' | 'dilemmas';

/** ¿Es un «Pueblo sencillo»? */
export const simpleTown = (state: GameState): boolean => state.simple === true;

/** ¿Está encendido este sistema? (todo, salvo lo que apaga «Pueblo sencillo»). */
export function systemOn(state: GameState, _sys: SimpleOff): boolean {
  return !simpleTown(state);
}
