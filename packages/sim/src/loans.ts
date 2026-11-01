import { TICKS_PER_MONTH } from '@bitopolis/shared';
import { LOANS } from './balance.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { type GameState, type Loan, type Rating, pushEvent } from './state.ts';

/**
 * 2.2: préstamos municipales con calificación A–D (docs/propuestas/v2.2-economia-politica.md §1).
 *
 * - Préstamo pedido (`RequestLoan`): entra de fuera y se devuelve en cuota fija entera.
 * - Préstamo de tesorería: si a fin de mes la caja sigue en negativo, el hueco
 *   pasa solo a un préstamo a 12 meses con recargo (si ya hay uno, se refinancia).
 * - Nota mensual por la carga (cuotas ÷ ingresos medios de 12 meses).
 *
 * Todo en enteros y sin `Math.pow` (las potencias, multiplicando: igual en todos los motores).
 */

export const RATINGS: readonly Rating[] = ['A', 'B', 'C', 'D'];

/** (1 + r)^n multiplicando (determinista). */
function growth(rate: number, months: number): number {
  let g = 1;
  for (let i = 0; i < months; i++) g *= 1 + rate;
  return g;
}

/** Cuota fija entera (sistema francés) que devuelve `principal` en `months` meses. */
export function quota(principal: number, rate: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  if (rate <= 0) return Math.ceil(principal / months);
  const g = growth(rate, months);
  return Math.ceil((principal * rate * g) / (g - 1));
}

/** TAE en % con un decimal (para enseñarla). */
export function tae(rate: number): number {
  return Math.round((growth(rate, 12) - 1) * 1000) / 10;
}

/** Lo que entró este mes (o un mes de stats) sin contar lo prestado. */
function ownIncome(m: { income: number; breakdown: Record<string, number> }): number {
  return m.income - Math.max(0, m.breakdown['préstamo'] ?? 0);
}

/** Ingresos medios de los últimos 12 meses cerrados (sin préstamos). `withCurrent` suma el mes en curso. */
export function averageIncome(state: GameState, withCurrent = false): number {
  const months: { income: number; breakdown: Record<string, number> }[] = state.stats.slice(withCurrent ? -11 : -12);
  if (withCurrent) months.push(state.month);
  if (!months.length) return 0;
  return Math.round(months.reduce((a, m) => a + ownIncome(m), 0) / months.length);
}

/** Cuotas del mes de todos los préstamos vivos. */
export function monthlyQuotas(state: GameState): number {
  return (state.loans ?? []).reduce((a, l) => a + l.quota, 0);
}

/** Lo que se debe (capital pendiente). */
export function totalOwed(state: GameState): number {
  return (state.loans ?? []).reduce((a, l) => a + l.left, 0);
}

/** Carga: cuotas ÷ ingresos medios (0 sin préstamos). */
export function loanLoad(state: GameState, withCurrent = false): number {
  const q = monthlyQuotas(state);
  if (q <= 0) return 0;
  const inc = averageIncome(state, withCurrent);
  return inc > 0 ? q / inc : Infinity;
}

/** Banda de la carga, sin cifras (para el prompt y la interfaz). */
export function loadBand(load: number): 'sin deuda' | 'baja' | 'media' | 'alta' | 'muy alta' {
  if (load <= 0) return 'sin deuda';
  if (load < LOANS.load.A) return 'baja';
  if (load < LOANS.load.B) return 'media';
  if (load < LOANS.load.C) return 'alta';
  return 'muy alta';
}

/** Préstamos de tesorería en los últimos 12 meses. */
export function recentTreasuryLoans(state: GameState): number {
  const since = state.tick - 12 * TICKS_PER_MONTH;
  return (state.loanLedger?.treasuryTicks ?? []).filter((t) => t > since).length;
}

/**
 * Nota de las cuentas: A (< 10 % y 6 meses de superávit), B (< 20 %), C (< 35 %
 * o una tesorería en 12 meses), D (≥ 35 %, dos tesorerías o quiebra). Se calcula
 * al cerrar el mes, con el mes en curso dentro.
 */
export function ratingOf(state: GameState): Rating {
  const load = loanLoad(state, true);
  const treasuries = recentTreasuryLoans(state);
  if (state.bankrupt || treasuries >= 2 || load >= LOANS.load.C) return 'D';
  if (treasuries >= 1 || load >= LOANS.load.B) return 'C';
  if (load >= LOANS.load.A) return 'B';
  const months = [...state.stats.slice(-(LOANS.surplusMonths - 1)), state.month];
  const surplus = months.length >= LOANS.surplusMonths && months.every((m) => ownIncome(m) >= m.expenses);
  return surplus ? 'A' : 'B';
}

/** Lo que aún se puede pedir ahora (múltiplo de 1.000; 0 si no se puede). */
export function loanCapacity(state: GameState): number {
  const rating = state.rating ?? 'B';
  const room = LOANS.maxRatio[rating] * averageIncome(state) * 12 - totalOwed(state);
  return Math.max(0, Math.min(LOANS.max, Math.floor(room / LOANS.step) * LOANS.step));
}

/** Lo que costaría un préstamo pedido hoy. */
export function loanOffer(state: GameState, amount: number, months: number): { rate: number; quota: number; tae: number; total: number } {
  const rate = LOANS.rate[state.rating ?? 'B'];
  const q = quota(amount, rate, months);
  return { rate, quota: q, tae: tae(rate), total: q * months };
}

export function canRequestLoan(state: GameState, amount: number, months: number): { ok: true } | { ok: false; error: string } {
  if (!(LOANS.terms as readonly number[]).includes(months)) return { ok: false, error: 'Plazo no válido' };
  if (amount < LOANS.min || amount > LOANS.max || amount % LOANS.step !== 0) return { ok: false, error: 'Importe no válido' };
  if (state.bankrupt) return { ok: false, error: 'En quiebra nadie presta al ayuntamiento' };
  if ((state.rating ?? 'B') === 'D') return { ok: false, error: 'Con nota D el banco no presta: sanea las cuentas' };
  if (!state.stats.length) return { ok: false, error: 'El banco quiere ver las cuentas de un mes entero' };
  if ((state.loans ?? []).filter((l) => l.kind === 'banco').length >= LOANS.maxLoans) return { ok: false, error: `Como mucho ${LOANS.maxLoans} préstamos a la vez` };
  const cap = loanCapacity(state);
  if (amount > cap) return { ok: false, error: cap > 0 ? `Con la nota ${state.rating} te prestan hasta ${fmt(cap)} €` : `Con la nota ${state.rating} y lo que ya debes, no te prestan más` };
  return { ok: true };
}

export function requestLoan(state: GameState, amount: number, months: number): Loan {
  const { rate, quota: q } = loanOffer(state, amount, months);
  const loan: Loan = { id: state.nextId++, principal: amount, left: amount, quota: q, rate, monthsLeft: months, kind: 'banco', tick: state.tick };
  state.loans.push(loan);
  state.loanLedger.lent += amount;
  transfer(state, OUTSIDE, TREASURY, amount, 'préstamo');
  pushEvent(state, 'info', `El banco presta ${fmt(amount)} € a ${months} meses: ${fmt(q)} € al mes`, { notify: true });
  return loan;
}

/** Comisión de amortizar `amount` antes de tiempo. */
export function earlyFee(amount: number): number {
  return Math.ceil(amount * LOANS.earlyFee);
}

export function canRepayLoan(state: GameState, loanId: number, amount: number): { ok: true } | { ok: false; error: string } {
  const loan = (state.loans ?? []).find((l) => l.id === loanId);
  if (!loan) return { ok: false, error: 'Ese préstamo ya no existe' };
  const paid = Math.min(amount, loan.left);
  if (paid <= 0) return { ok: false, error: 'Importe no válido' };
  if (state.treasury < paid + earlyFee(paid)) return { ok: false, error: 'No hay dinero suficiente en la caja' };
  return { ok: true };
}

/** Amortiza antes de tiempo: capital + comisión; la cuota baja y el plazo sigue. */
export function repayLoan(state: GameState, loanId: number, amount: number): void {
  const loan = state.loans.find((l) => l.id === loanId)!;
  const paid = Math.min(amount, loan.left);
  const fee = earlyFee(paid);
  transfer(state, TREASURY, OUTSIDE, paid, 'préstamos');
  transfer(state, TREASURY, OUTSIDE, fee, 'préstamos');
  state.loanLedger.repaid += paid;
  state.loanLedger.interest += fee;
  loan.left -= paid;
  if (loan.left <= 0) {
    state.loans = state.loans.filter((l) => l.id !== loanId);
    pushEvent(state, 'info', `Préstamo devuelto del todo (comisión ${fmt(fee)} €)`);
  } else {
    loan.quota = quota(loan.left, loan.rate, loan.monthsLeft);
    pushEvent(state, 'info', `Amortizas ${fmt(paid)} €: la cuota baja a ${fmt(loan.quota)} €`);
  }
}

/** Paga la cuota de un préstamo (el último mes, todo lo que quede). */
function payQuota(state: GameState, loan: Loan): void {
  const interest = Math.round(loan.left * loan.rate);
  const capital = loan.monthsLeft <= 1 ? loan.left : Math.max(0, Math.min(loan.left, loan.quota - interest));
  transfer(state, TREASURY, OUTSIDE, capital + interest, 'préstamos');
  state.loanLedger.repaid += capital;
  state.loanLedger.interest += interest;
  loan.left -= capital;
  loan.monthsLeft--;
  if (loan.left <= 0) loan.monthsLeft = 0;
}

/**
 * Fin de mes: cuotas, préstamo de tesorería si la caja sigue en negativo y nota
 * nueva. Va después de todos los cobros y pagos del mes (tick.ts `endOfMonth`).
 */
export function loansMonth(state: GameState): void {
  state.loans ??= [];
  state.loanLedger ??= { lent: 0, repaid: 0, interest: 0, treasuryTicks: [] };
  for (const loan of state.loans) payQuota(state, loan);
  const done = state.loans.filter((l) => l.left <= 0);
  state.loans = state.loans.filter((l) => l.left > 0);
  for (const l of done) if (l.kind === 'banco') pushEvent(state, 'info', `Préstamo de ${fmt(l.principal)} € devuelto del todo`);
  const prev = state.rating ?? 'B';
  // Préstamo de tesorería: el hueco de la caja, redondeado al millar (con nota D, nadie lo da).
  if (state.treasury < 0 && prev !== 'D') {
    const gap = Math.ceil(-state.treasury / LOANS.step) * LOANS.step;
    const rate = Math.round(LOANS.rate[prev] * LOANS.treasuryPenalty * 10_000) / 10_000;
    const old = state.loans.find((l) => l.kind === 'tesoreria');
    if (old) {
      old.principal += gap;
      old.left += gap;
      old.rate = rate;
      old.monthsLeft = LOANS.treasuryMonths;
      old.quota = quota(old.left, rate, old.monthsLeft);
      old.tick = state.tick;
    } else {
      state.loans.push({ id: state.nextId++, principal: gap, left: gap, quota: quota(gap, rate, LOANS.treasuryMonths), rate, monthsLeft: LOANS.treasuryMonths, kind: 'tesoreria', tick: state.tick });
    }
    state.loanLedger.lent += gap;
    state.loanLedger.treasuryTicks.push(state.tick);
    transfer(state, OUTSIDE, TREASURY, gap, 'préstamo');
    pushEvent(state, 'warning', `La caja cerró el mes en negativo: el banco cubre ${fmt(gap)} € con un préstamo de tesorería a ${LOANS.treasuryMonths} meses (más caro, y la nota baja)`, { notify: true });
  }
  const since = state.tick - 12 * TICKS_PER_MONTH;
  state.loanLedger.treasuryTicks = state.loanLedger.treasuryTicks.filter((t) => t > since);
  const next = ratingOf(state);
  if (next !== prev) {
    const down = RATINGS.indexOf(next) > RATINGS.indexOf(prev);
    pushEvent(state, down ? 'warning' : 'info', down ? `Las cuentas bajan a nota ${next}: ${next === 'D' ? 'nadie presta más al ayuntamiento' : 'los préstamos salen más caros'}` : `Las cuentas suben a nota ${next}: los préstamos salen más baratos`);
  }
  state.rating = next;
}

/** 12.000 (con punto de millar; sin `toLocaleString`, que depende del motor y el texto entra en el hash). */
export function fmt(n: number): string {
  const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return n < 0 ? `−${s}` : s;
}
