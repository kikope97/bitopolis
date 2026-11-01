import type { GameState } from './state.ts';

/**
 * Único punto por el que se mueve el dinero. Las cuentas son el ayuntamiento
 * (0), "fuera" (-1: región, Estado, proveedores, inversores), los vecinos y
 * las empresas (por su id). Lo que entra o sale de fuera se apunta en el
 * ledger para poder comprobar que el dinero se conserva.
 */
/** Ronda 18: lo que entró en un mes sin contar lo prestado (un préstamo no es superávit). */
export function ownIncome(m: { income: number; breakdown: Record<string, number> }): number {
  return m.income - Math.max(0, m.breakdown['préstamo'] ?? 0);
}

export const TREASURY = 0;
export const OUTSIDE = -1;

interface Holder {
  money?: number;
  cash?: number;
}

function holder(state: GameState, account: number): Holder {
  const c = state.citizens.find((x) => x.id === account);
  if (c) return c;
  const b = state.buildings.find((x) => x.id === account);
  if (b) return b;
  throw new Error(`cuenta desconocida ${account}`);
}

export function balanceOf(state: GameState, account: number): number {
  if (account === TREASURY) return state.treasury;
  if (account === OUTSIDE) return Infinity;
  const h = holder(state, account);
  return h.money ?? h.cash ?? 0;
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
  const h = holder(state, account) as Holder & { flow?: [number, number] };
  if (h.money !== undefined) {
    h.money += amount;
    // v1.9: balance del mes de cada vecino (lo que entra y lo que sale).
    const f = (h.flow ??= [0, 0]);
    if (amount > 0) f[0] += amount;
    else f[1] -= amount;
  } else h.cash = (h.cash ?? 0) + amount;
}

/**
 * Transfiere `amount` (entero ≥ 0). Vecinos y empresas nunca bajan de cero:
 * si no tienen bastante se transfiere lo que haya. El ayuntamiento sí puede
 * endeudarse (caja negativa). `concept` alimenta el parte mensual.
 * Devuelve lo transferido.
 */
export function transfer(state: GameState, from: number, to: number, amount: number, concept = 'otros'): number {
  let amt = Math.floor(amount);
  if (amt <= 0 || from === to) return 0;
  if (from !== TREASURY && from !== OUTSIDE) amt = Math.min(amt, balanceOf(state, from));
  if (amt <= 0) return 0;
  add(state, from, -amt);
  add(state, to, amt);
  const bd = state.month.breakdown;
  if (to === TREASURY) {
    state.month.income += amt;
    bd[concept] = (bd[concept] ?? 0) + amt;
  }
  if (from === TREASURY) {
    state.month.expenses += amt;
    bd[concept] = (bd[concept] ?? 0) - amt;
  }
  return amt;
}

export function totalInternalMoney(state: GameState): number {
  let total = state.treasury;
  for (const c of state.citizens) total += c.money;
  for (const b of state.buildings) total += b.cash;
  return total;
}
