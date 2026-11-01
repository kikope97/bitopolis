import { LOANS } from './balance.ts';
import type { GameState } from './state.ts';

/**
 * 2.2: invariantes de los préstamos municipales. Σ `left` = `lent − repaid`;
 * importes enteros y no negativos; `monthsLeft > 0 ⇔ left > 0`; como mucho
 * `maxLoans` pedidos y uno de tesorería; nota válida.
 */
export function loanInvariants(state: GameState): string[] {
  const errors: string[] = [];
  const loans = state.loans ?? [];
  const ledger = state.loanLedger;
  if (!ledger) return loans.length ? ['préstamos sin contabilidad'] : [];
  let left = 0;
  for (const l of loans) {
    for (const k of ['principal', 'left', 'quota', 'monthsLeft'] as const) {
      if (!Number.isInteger(l[k]) || l[k] < 0) errors.push(`préstamo ${l.id} con ${k} inválido (${l[k]})`);
    }
    if (l.monthsLeft > 0 !== l.left > 0) errors.push(`préstamo ${l.id}: meses ${l.monthsLeft} y pendiente ${l.left} no cuadran`);
    if (l.left > l.principal) errors.push(`préstamo ${l.id} debe más de lo prestado`);
    left += l.left;
  }
  if (left !== ledger.lent - ledger.repaid) errors.push(`préstamos descuadrados: ${left - (ledger.lent - ledger.repaid)}`);
  if (!Number.isInteger(ledger.lent) || !Number.isInteger(ledger.repaid) || ledger.repaid > ledger.lent) errors.push('contabilidad de préstamos inválida');
  if (loans.length > LOANS.maxLoans + 1) errors.push(`demasiados préstamos (${loans.length})`);
  if (loans.filter((l) => l.kind === 'tesoreria').length > 1) errors.push('más de un préstamo de tesorería');
  if (!['A', 'B', 'C', 'D'].includes(state.rating)) errors.push(`nota inválida ${state.rating}`);
  return errors;
}
