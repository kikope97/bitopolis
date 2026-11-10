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

/**
 * 2.7: lo que se fue en obras (inversión) en un mes: materiales y cuadrillas,
 * ampliaciones, diques, sobrecostes y reparaciones. Lo devuelto al cancelar
 * una obra resta (va con el mismo concepto).
 */
export function worksSpent(m: { breakdown: Record<string, number> }): number {
  let out = 0;
  for (const [k, v] of Object.entries(m.breakdown)) if (k.startsWith('obras') || k.startsWith('reparaciones')) out -= v;
  return Math.max(0, out);
}

/** 2.8: lo devuelto antes de tiempo a un préstamo (no es gasto de cada mes; concepto «amortización»). */
export function earlyRepaid(m: { breakdown: Record<string, number> }): number {
  return Math.max(0, -(m.breakdown['amortización'] ?? 0));
}

/** 2.7: el gasto corriente de un mes (lo que sale sin contar las obras ni lo amortizado). */
export function runningExpenses(m: { expenses: number; breakdown: Record<string, number> }): number {
  return Math.max(0, m.expenses - worksSpent(m) - earlyRepaid(m));
}

/** 2.8: el dinero de un mes, partido de la misma forma en todas partes. */
export interface MonthNet {
  /** Lo que entró sin contar lo prestado. */
  own: number;
  /** El gasto corriente: lo que sale cada mes (sin obras ni amortizaciones). */
  running: number;
  /** Obras y reparaciones (se pagan una vez). */
  works: number;
  /** Préstamos devueltos antes de tiempo. */
  repaid: number;
  /** Préstamos recibidos (de tesorería incluidos). */
  loansIn: number;
  /** **El neto del mes**: lo propio menos el gasto corriente. */
  net: number;
  /** Lo que cambió la caja sin el préstamo: lo propio menos todo lo que salió. */
  total: number;
}

/**
 * 2.8 (ronda 24): un solo «neto del mes». Lo usan el aviso de la caja del motor,
 * la barra, el parte, «Hoy», el panel «Pueblo», Gestión y la nota del banco, para
 * que todos digan lo mismo. Puro.
 */
export function monthNet(m: { income: number; expenses: number; breakdown: Record<string, number> }): MonthNet {
  const own = ownIncome(m);
  const works = worksSpent(m);
  const repaid = earlyRepaid(m);
  const running = Math.max(0, m.expenses - works - repaid);
  return { own, running, works, repaid, loansIn: Math.max(0, m.breakdown['préstamo'] ?? 0), net: own - running, total: own - m.expenses };
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
