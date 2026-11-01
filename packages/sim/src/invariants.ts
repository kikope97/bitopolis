import { LISTS } from './balance.ts';
import { homesOf } from './density.ts';
import { isLandmarkKind } from './landmarks.ts';
import { farmInvariants } from './farm.ts';
import { loanInvariants } from './invariants-loans.ts';
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
    // 2.3: las grandes obras siguen en pie mientras se hace la fase siguiente.
    if (!state.buildings.some((b) => b.id === p.buildingId && (!b.built || isLandmarkKind(b.kind)))) errors.push(`obra huérfana ${p.buildingId}`);
  }
  const homeUse = new Map<number, number>();
  for (const c of state.citizens) if (c.homeId !== null) homeUse.set(c.homeId, (homeUse.get(c.homeId) ?? 0) + 1);
  for (const [id, n] of homeUse) {
    const b = state.buildings.find((x) => x.id === id);
    if (b && n > homesOf(b)) errors.push(`casa ${id} sobreocupada`);
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
  // 2.2: fincas solo en zona agraria y con el cultivo de su terreno.
  errors.push(...farmInvariants(state));
  // 2.2: préstamos municipales.
  errors.push(...loanInvariants(state));
  errors.push(...listInvariants(state));
  return errors;
}

/** 2.2: candidaturas: como mucho `LISTS.max`, una por líder, con el líder en el pueblo y el partido principal dentro. */
export function listInvariants(state: GameState): string[] {
  const errors: string[] = [];
  const p = state.politics;
  if (!p) return errors;
  const lists = p.lists ?? [];
  if (lists.length > LISTS.max) errors.push(`${lists.length} candidaturas (máx. ${LISTS.max})`);
  const leaders = new Set<number>();
  for (const l of lists) {
    if (leaders.has(l.leaderId)) errors.push(`candidatura repetida del vecino ${l.leaderId}`);
    leaders.add(l.leaderId);
    if (!state.citizens.some((c) => c.id === l.leaderId)) errors.push(`candidatura sin líder (${l.leaderId})`);
  }
  if (p.party && !leaders.has(p.party.leaderId)) errors.push('el partido principal no está en las listas');
  if (!p.party && lists.length) errors.push('listas sin partido principal');
  if (p.mayor !== 'player' && p.party?.leaderId !== p.mayor) errors.push('gobierna alguien que no encabeza el partido');
  return errors;
}

/** Dinero descuadrado (debe ser 0). */
export function moneyDrift(state: GameState): number {
  return totalInternalMoney(state) - (state.ledger.initialTotal + state.ledger.externalIn - state.ledger.externalOut);
}
