import { TICKS_PER_DAY, tickToDate } from '@bitopolis/shared';
import {
  BUDGET,
  BUILD,
  FESTIVAL,
  FESTIVAL_MONTH,
  GRANT_ADVANCE,
  GRANT_DEADLINE_DAYS,
  GRANT_EVERY_DAYS,
  GRANT_OFFER_DAYS,
  GRANT_PENALTY,
  SOCIAL_PLACES,
  TERRAIN,
  WAGE_OUTSIDE,
} from './balance.ts';
import { saturated } from './economy.ts';
import { hash32 } from './hash.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { factionOf, politicsActive } from './politics.ts';
import { type Faction, FACTIONS } from './politics-core.ts';
import { pick } from './prng.ts';
import { addMemory } from './social.ts';
import type { Building, BuildingKind, BudgetPlan, GameState } from './state.ts';
import { pushEvent, terrainAt } from './state.ts';
import { Terrain } from './terrain.ts';

/**
 * v1.5: el ayuntamiento por dentro.
 * - Presupuesto anual: cada enero se propone un plan y el pleno lo vota.
 * - Fiestas del pueblo: cada verano; si no las organizas, las montan los vecinos.
 * - Subvenciones de la Diputación: una obra con plazo; anticipo y, si no se
 *   termina a tiempo, reintegro con recargo.
 */

export const BUDGET_TEXT: Record<BudgetPlan, string> = {
  austero: 'Austero: −15 % de mantenimiento y −10 % de sueldos municipales; los servicios rinden algo menos',
  equilibrado: 'Equilibrado: todo como hasta ahora',
  inversor: 'Inversor: obras un 15 % más baratas, pero +10 % de mantenimiento',
};

/** Qué plan prefiere cada facción (además, si está contenta, apoya cualquiera). */
const LIKES: Record<Faction, BudgetPlan[]> = {
  jubilados: ['equilibrado', 'austero'],
  jovenes: ['inversor'],
  empresarios: ['austero'],
  ecologistas: ['equilibrado', 'inversor'],
};

export const budgetFx = (state: GameState) => BUDGET[state.budget.plan];

/** Coste de una obra con el presupuesto en vigor (materiales). */
export function materialsCost(state: GameState, kind: BuildingKind | 'road', x?: number, y?: number): number {
  // v1.7: en la colina, los materiales cuestan más (hay que allanar y subirlos).
  const hill = x !== undefined && y !== undefined && terrainAt(state, x, y) === Terrain.Hill ? TERRAIN.hillFactor : 1;
  return Math.round(BUILD[kind as keyof typeof BUILD].materials * budgetFx(state).materials * hill);
}

/**
 * Coste de referencia para la subvención: los materiales que de verdad se pagan
 * (con el presupuesto en vigor) y la mitad de la mano de obra de fuera, porque
 * suelen trabajar obreros del pueblo (ronda 11: con el precio de lista pagaba casi el 90 %).
 */
function estimatedCost(state: GameState, kind: BuildingKind): number {
  const s = BUILD[kind as keyof typeof BUILD];
  return materialsCost(state, kind) + Math.round((s.workers * s.days * WAGE_OUTSIDE) / 2);
}

/* ---------------- presupuesto ---------------- */

export function canProposeBudget(state: GameState): { ok: boolean; error?: string } {
  if (state.budget.status !== 'open') return { ok: false, error: 'El presupuesto se presenta en enero' };
  return { ok: true };
}

/** El pleno vota el presupuesto: cada facción según su gusto y su satisfacción. */
export function proposeBudget(state: GameState, plan: BudgetPlan): void {
  const b = state.budget;
  let yes = 0;
  let no = 0;
  if (!politicsActive(state)) {
    // Sin facciones todavía, cada vecino vota según lo contento que esté (ronda 11: salía todo por unanimidad).
    for (const c of state.citizens) if (c.happiness >= 55) yes++;
    else no++;
  } else {
    for (const f of FACTIONS) {
      const info = state.politics.factions[f];
      const members = state.citizens.filter((c) => factionOf(state, c) === f).length;
      if (LIKES[f].includes(plan) || info.satisfaction >= 65) yes += members;
      else no += members;
    }
  }
  b.votesFor = yes;
  b.votesAgainst = no;
  if (yes >= no) {
    b.plan = plan;
    b.status = 'approved';
    pushEvent(state, 'politics', `El pleno aprueba el presupuesto ${plan} (${yes} a favor, ${no} en contra)`);
  } else {
    b.status = 'prorrogado';
    pushEvent(state, 'politics', `El pleno rechaza el presupuesto ${plan} (${yes} a favor, ${no} en contra): se prorroga el ${b.plan}`);
  }
}

/* ---------------- fiestas ---------------- */

const PATRONS = ['San Ladrillo', 'Santa Farola', 'la Virgen del Píxel', 'San Bitorio', 'Santa Rotonda', 'la Cosecha', 'San Botijo', 'la Vendimia'];

export function festivalActive(state: GameState): boolean {
  return state.festival.until > state.tick;
}

export function canHoldFestival(state: GameState, size: 'pequena' | 'grande'): { ok: boolean; error?: string } {
  const d = tickToDate(state.tick);
  if (state.festival.year === d.year) return { ok: false, error: 'Este año ya hubo fiestas' };
  if (d.month < FESTIVAL_MONTH - 1 || d.month > FESTIVAL_MONTH) return { ok: false, error: 'Se pueden organizar del 1 de julio al 30 de agosto' };
  if (state.treasury < FESTIVAL[size].cost) return { ok: false, error: `Te faltan ${FESTIVAL[size].cost - Math.max(0, state.treasury)} € para las ${size === 'grande' ? 'grandes' : 'pequeñas'}` };
  return { ok: true };
}

export function holdFestival(state: GameState, size: 'pequena' | 'grande' | 'popular'): void {
  const f = FESTIVAL[size];
  const d = tickToDate(state.tick);
  if (f.cost) transfer(state, TREASURY, OUTSIDE, f.cost, 'fiestas');
  state.festival.year = d.year;
  state.festival.size = size;
  state.festival.until = state.tick + f.days * TICKS_PER_DAY;
  // Las tiendas del pueblo venden más esos días (gasto de forasteros y vecinos).
  for (const b of state.buildings) if (b.kind === 'shop' && b.built) transfer(state, OUTSIDE, b.id, f.spend * Math.max(1, state.citizens.length / 10));
  for (const c of state.citizens) if (c.named) addMemory(state, c, 'fue_a_las_fiestas', size === 'grande' ? 3 : 2, size === 'grande' ? 3 : 2);
  const name = state.festival.name ?? 'el pueblo';
  pushEvent(
    state,
    'milestone',
    size === 'popular' ? `Sin fiestas del ayuntamiento, los vecinos montan las de ${name} por su cuenta` : `¡Empiezan las fiestas de ${name}${size === 'grande' ? ', a lo grande' : ''}!`,
  );
}

/** Felicidad de las fiestas mientras dura su recuerdo. */
export function festivalMood(state: GameState): { label: string; value: number } | null {
  if (!festivalActive(state) || state.festival.size === 'none') return null;
  // v1.7: con ermita, las fiestas patronales alegran más.
  const chapel = state.buildings.some((b) => b.kind === 'chapel' && b.built) ? SOCIAL_PLACES.chapelFestivalMood : 0;
  return { label: `Fiestas de ${state.festival.name ?? 'el pueblo'}${chapel ? ' (con procesión a la ermita)' : ''}`, value: FESTIVAL[state.festival.size].mood + chapel };
}

/* ---------------- subvenciones ---------------- */

const GRANT_KINDS: BuildingKind[] = ['school', 'clinic', 'police', 'park', 'library', 'sports'];
// Solo se ofrece lo que ya se puede construir (ronda 11: salían comisarías imposibles).
const unlockOf = (k: BuildingKind) => BUILD[k as keyof typeof BUILD].unlockPop ?? 0;

function offerGrant(state: GameState): void {
  const options = GRANT_KINDS.filter(
    (k) => state.citizens.length >= unlockOf(k) && (!state.buildings.some((b) => b.kind === k) || saturated(state, k)),
  );
  if (!options.length) return;
  const kind = pick(state.rng, options);
  const share = [0.5, 0.6, 0.7][hash32(state.tick, kind.length) % 3]!;
  state.grants.push({
    id: state.nextId++,
    kind,
    share,
    offeredTick: state.tick,
    deadline: state.tick + (GRANT_OFFER_DAYS + GRANT_DEADLINE_DAYS) * TICKS_PER_DAY,
    status: 'offered',
    advance: 0,
    minId: 0,
  });
  const until = tickToDate(state.tick + GRANT_OFFER_DAYS * TICKS_PER_DAY);
  pushEvent(state, 'info', `La Diputación ofrece pagar el ${Math.round(share * 100)} % de ${GRANT_NAME[kind]}. Responde antes del ${until.day}/${until.month} (Pueblo › Ayuntamiento)`);
}

export const GRANT_NAME: Partial<Record<BuildingKind, string>> = {
  school: 'un colegio',
  clinic: 'un centro de salud',
  police: 'una comisaría',
  park: 'un parque',
  library: 'una biblioteca',
  sports: 'un polideportivo',
};

export function canAnswerGrant(state: GameState, grantId: number): { ok: boolean; error?: string } {
  const g = state.grants.find((x) => x.id === grantId);
  if (!g || g.status !== 'offered') return { ok: false, error: 'Esa oferta ya no está' };
  return { ok: true };
}

export function answerGrant(state: GameState, grantId: number, accept: boolean): void {
  const g = state.grants.find((x) => x.id === grantId)!;
  if (!accept) {
    g.status = 'declined';
    return;
  }
  g.status = 'accepted';
  g.minId = state.nextId;
  g.deadline = state.tick + GRANT_DEADLINE_DAYS * TICKS_PER_DAY;
  g.advance = Math.round(estimatedCost(state, g.kind) * GRANT_ADVANCE);
  transfer(state, OUTSIDE, TREASURY, g.advance, 'subvenciones');
  const until = tickToDate(g.deadline);
  pushEvent(state, 'info', `Subvención aceptada: anticipo de ${g.advance} €. Construye ${GRANT_NAME[g.kind]} y termínalo antes del ${until.day}/${until.month} del año ${until.year}`);
}

/** Al terminar una obra: si cumple una subvención aceptada y en plazo, se cobra el resto. */
export function onBuildingDone(state: GameState, b: Building): void {
  const g = state.grants.find((x) => x.status === 'accepted' && x.kind === b.kind && b.id >= x.minId && state.tick <= x.deadline);
  if (!g) return;
  const rest = Math.max(0, Math.round(estimatedCost(state, g.kind) * g.share) - g.advance);
  transfer(state, OUTSIDE, TREASURY, rest, 'subvenciones');
  g.status = 'paid';
  pushEvent(state, 'milestone', `La Diputación paga la subvención de ${GRANT_NAME[g.kind]}: ${rest} € más`);
}

/* ---------------- calendario ---------------- */

export function civicDay(state: GameState): void {
  const d = tickToDate(state.tick);
  const b = state.budget;
  // Enero: hay que presentar el presupuesto del año.
  if (d.month === 1 && b.year !== d.year) {
    b.year = d.year;
    b.status = 'open';
    b.votesFor = 0;
    b.votesAgainst = 0;
    pushEvent(state, 'politics', `Toca presentar el presupuesto del año ${d.year} antes de febrero (Pueblo › Ayuntamiento). Si no, se prorroga el ${b.plan}`);
  }
  if (b.status === 'open' && d.month > 1) {
    b.status = 'prorrogado';
    pushEvent(state, 'politics', `No se presentó el presupuesto: se prorroga el ${b.plan}`);
  }
  // Julio: los vecinos ponen nombre a las fiestas la primera vez.
  if (d.month === FESTIVAL_MONTH - 1 && d.day === 1 && state.festival.year !== d.year) {
    if (!state.festival.name) {
      const social = [...state.citizens].filter((c) => c.named).sort((x, y) => y.traits.social - x.traits.social || x.id - y.id)[0];
      state.festival.name = PATRONS[hash32(state.seed, 7) % PATRONS.length]!;
      if (social) pushEvent(state, 'info', `${social.name.split(' ')[0]} propone llamarlas «Fiestas de ${state.festival.name}»`, { ref: social.id });
    }
    pushEvent(state, 'info', `Se acercan las fiestas de ${state.festival.name}: puedes organizarlas en julio o agosto (Pueblo › Ayuntamiento)`);
  }
  // Septiembre sin fiestas: las montan los vecinos (pequeñas y gratis).
  if (d.month === FESTIVAL_MONTH + 1 && d.day === 1 && state.festival.year !== d.year && state.citizens.length >= 5) {
    if (!state.festival.name) state.festival.name = PATRONS[hash32(state.seed, 7) % PATRONS.length]!;
    holdFestival(state, 'popular');
  }
  // Subvenciones: las ofertas caducan; las aceptadas fuera de plazo se devuelven con recargo.
  for (const g of state.grants) {
    if (g.status === 'offered' && state.tick - g.offeredTick > GRANT_OFFER_DAYS * TICKS_PER_DAY) g.status = 'declined';
    if (g.status === 'accepted' && state.tick > g.deadline) {
      g.status = 'expired';
      const back = Math.round(g.advance * (1 + GRANT_PENALTY));
      transfer(state, TREASURY, OUTSIDE, back, 'reintegro de subvención');
      pushEvent(state, 'warning', `No se terminó ${GRANT_NAME[g.kind]} a tiempo: hay que devolver ${back} € a la Diputación`);
    }
  }
  if (state.grants.length > 20) state.grants = state.grants.slice(-20);
  const active = state.grants.some((g) => g.status === 'offered' || g.status === 'accepted');
  const last = Math.max(0, ...state.grants.map((g) => g.offeredTick));
  if (!active && state.citizens.length >= 10 && state.tick - last >= GRANT_EVERY_DAYS * TICKS_PER_DAY) offerGrant(state);
}

/** El gobierno rival también presenta presupuesto (el que gusta a su facción). */
export function rivalBudget(state: GameState, faction: Faction): void {
  if (state.budget.status === 'open') proposeBudget(state, LIKES[faction][0]!);
}
