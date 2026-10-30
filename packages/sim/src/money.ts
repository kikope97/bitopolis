import type { GameState } from './state.ts';

/**
 * Único punto por el que se mueve el dinero. Las cuentas son el ayuntamiento
 * (0), los vecinos (su id) y "fuera" (-1), que representa todo lo externo:
 * región, Estado, proveedores. Lo que entra o sale de fuera se apunta en el
 * ledger para poder comprobar que el dinero se conserva.
 */
export const TREASURY = 0;
export const OUTSIDE = -1;

export function balanceOf(state: GameState, account: number): number {
  if (account === TREASURY) return state.treasury;
  if (account === OUTSIDE) return Infinity;
  const c = state.citizens.find((x) => x.id === account);
  if (!c) throw new Error(`cuenta desconocida ${account}`);
  return c.money;
}

function add(state: GameState, account: number, amount: number): void {
  if (account === TREASURY) {
    state.treasury += amount;
    return;
  }
  if (account === OUTSIDE) {
    if (amount > 0) state.ledger.externalOut += amount;
    else state.ledger.externalIn -= amount;
    return;
  }
  const c = state.citizens.find((x) => x.id === account);
  if (!c) throw new Error(`cuenta desconocida ${account}`);
  c.money += amount;
}

/**
 * Transfiere `amount` (entero ≥ 0). Los vecinos nunca bajan de cero: si no
 * tienen bastante se transfiere lo que haya. El ayuntamiento sí puede
 * endeudarse (caja negativa). Devuelve lo transferido.
 */
export function transfer(state: GameState, from: number, to: number, amount: number): number {
  let amt = Math.floor(amount);
  if (amt <= 0 || from === to) return 0;
  if (from !== TREASURY && from !== OUTSIDE) amt = Math.min(amt, balanceOf(state, from));
  if (amt <= 0) return 0;
  add(state, from, -amt);
  add(state, to, amt);
  if (to === TREASURY && from !== TREASURY) state.month.income += amt;
  if (from === TREASURY && to !== TREASURY) state.month.expenses += amt;
  return amt;
}

export function totalInternalMoney(state: GameState): number {
  let total = state.treasury;
  for (const c of state.citizens) total += c.money;
  return total;
}
