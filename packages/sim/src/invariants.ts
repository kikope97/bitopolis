import { totalInternalMoney } from './money.ts';
import type { GameState } from './state.ts';

/** Devuelve la lista de invariantes rotas (vacía si todo cuadra). */
export function checkInvariants(state: GameState): string[] {
  const errors: string[] = [];
  const expected = state.ledger.initialTotal + state.ledger.externalIn - state.ledger.externalOut;
  const actual = totalInternalMoney(state);
  if (actual !== expected) errors.push(`dinero descuadrado: ${actual - expected}`);
  for (const c of state.citizens) {
    if (c.money < 0) errors.push(`vecino ${c.id} con dinero negativo`);
    if (!Number.isInteger(c.money)) errors.push(`vecino ${c.id} con dinero no entero`);
  }
  if (!Number.isInteger(state.treasury)) errors.push('caja no entera');
  const ids = new Set<number>();
  for (const x of [...state.citizens, ...state.buildings]) {
    if (ids.has(x.id)) errors.push(`id duplicado ${x.id}`);
    ids.add(x.id);
    if (x.id >= state.nextId) errors.push(`id ${x.id} >= nextId`);
  }
  const buildingIds = new Set(state.buildings.map((b) => b.id));
  for (const c of state.citizens) {
    if (c.homeId !== null && !buildingIds.has(c.homeId)) errors.push(`casa inexistente en ${c.id}`);
    if (c.jobId !== null && !buildingIds.has(c.jobId)) errors.push(`trabajo inexistente en ${c.id}`);
  }
  return errors;
}

/** Dinero descuadrado (debe ser 0). */
export function moneyDrift(state: GameState): number {
  return totalInternalMoney(state) - (state.ledger.initialTotal + state.ledger.externalIn - state.ledger.externalOut);
}
