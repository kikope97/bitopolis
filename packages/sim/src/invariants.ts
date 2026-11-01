import { HOMES } from './balance.ts';
import { totalInternalMoney } from './money.ts';
import type { GameState } from './state.ts';
import { streetErrors } from './streets.ts';
import { tenderErrors } from './tenders.ts';

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
  for (const b of state.buildings) {
    if (b.cash < 0 || !Number.isInteger(b.cash)) errors.push(`empresa ${b.id} con caja inválida`);
  }
  for (const p of state.projects) {
    if (!state.buildings.some((b) => b.id === p.buildingId && !b.built)) errors.push(`obra huérfana ${p.buildingId}`);
  }
  const homeUse = new Map<number, number>();
  for (const c of state.citizens) if (c.homeId !== null) homeUse.set(c.homeId, (homeUse.get(c.homeId) ?? 0) + 1);
  for (const [id, n] of homeUse) {
    const b = state.buildings.find((x) => x.id === id);
    if (b && n > (HOMES[b.kind] ?? 0)) errors.push(`casa ${id} sobreocupada`);
  }
  const ids = new Set<number>();
  for (const x of [...state.citizens, ...state.buildings]) {
    if (ids.has(x.id)) errors.push(`id duplicado ${x.id}`);
    ids.add(x.id);
    if (x.id >= state.nextId) errors.push(`id ${x.id} >= nextId`);
  }
  // v1.9: la deuda de los vecinos se conserva y siempre es entera y no negativa.
  let liveDebt = 0;
  for (const c of state.citizens) {
    if (!c.debt) continue;
    for (const k of ['town', 'bank'] as const) {
      const v = c.debt[k];
      if (v < 0 || !Number.isInteger(v)) errors.push(`vecino ${c.id} con deuda inválida (${k})`);
      liveDebt += v;
    }
  }
  const dl = state.debtLedger;
  if (dl && liveDebt !== dl.created - dl.repaid - dl.written - dl.forgiven) errors.push(`deuda descuadrada: ${liveDebt - (dl.created - dl.repaid - dl.written - dl.forgiven)}`);
  const buildingIds = new Set(state.buildings.map((b) => b.id));
  for (const c of state.citizens) {
    if (c.homeId !== null && !buildingIds.has(c.homeId)) errors.push(`casa inexistente en ${c.id}`);
    if (c.jobId !== null && !buildingIds.has(c.jobId)) errors.push(`trabajo inexistente en ${c.id}`);
  }
  // 2.2: licitaciones (oferta válida, ids del contrato) y calles (sobre carretera o plaza).
  errors.push(...tenderErrors(state), ...streetErrors(state));
  return errors;
}

/** Dinero descuadrado (debe ser 0). */
export function moneyDrift(state: GameState): number {
  return totalInternalMoney(state) - (state.ledger.initialTotal + state.ledger.externalIn - state.ledger.externalOut);
}
