import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { stationJobsFx } from './landmarks.ts';
import { regionFx } from './region.ts';
import {
  CARE,
  DEBT,
  GRUDGE_MAX,
  JOBS_OUTSIDE,
  LIVING_BASIC,
  LIVING_CUSHION,
  LIVING_EXTRA,
  LOCAL_SPEND_SHARE,
  MICROCREDIT,
  MIN_WAGE,
} from './balance.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { chance } from './prng.ts';
import { addMemory } from './social.ts';
import { type Building, type Citizen, type CitizenDebt, type GameState, pushEvent } from './state.ts';
import { isRetired, nurseryUse, raisingAtHome } from './care.ts';
import { transitJobs } from './transit.ts';

/**
 * v1.9 (petición del creador): la economía de cada vecino. Cada uno tiene su
 * balance del mes y, si no le llega para pagar, se endeuda: con el
 * ayuntamiento (impuestos, tasas, alquiler municipal, multas) o con el banco o
 * el casero. La deuda no es dinero: es lo que debe. El dinero sigue sin bajar
 * de cero y se mueve solo con transfer(); cada pago de deuda es un transfer a
 * quien la cobra. La deuda se conserva: viva = altas − pagos − incobrables − perdonadas.
 */

export const totalDebt = (c: Citizen): number => (c.debt ? c.debt.town + c.debt.bank : 0);

function debtOf(state: GameState, c: Citizen): CitizenDebt {
  return (c.debt ??= { town: 0, bank: 0, since: state.tick, fresh: 0, aged: 0 });
}

function tidy(c: Citizen): void {
  if (c.debt && c.debt.town <= 0 && c.debt.bank <= 0) delete c.debt;
}

/** Apunta una deuda nueva (lo que no pudo pagar, intereses, recargos o un préstamo). */
export function addDebt(state: GameState, c: Citizen, kind: 'town' | 'bank', amount: number): void {
  const n = Math.floor(amount);
  if (n <= 0) return;
  const d = debtOf(state, c);
  if (d.town + d.bank === 0) d.since = state.tick;
  d[kind] += n;
  if (kind === 'town') d.fresh += n;
  state.debtLedger.created += n;
}

/**
 * Cobro obligatorio: paga lo que pueda y el resto queda como deuda con quien
 * cobra (el ayuntamiento o, si no, el banco o casero). Devuelve lo pagado.
 */
export function charge(state: GameState, c: Citizen, to: number, amount: number, concept?: string): number {
  const want = Math.floor(amount);
  if (want <= 0) return 0;
  const paid = transfer(state, c.id, to, want, concept);
  const missing = want - paid;
  if (missing > 0) {
    addDebt(state, c, to === TREASURY ? 'town' : 'bank', missing);
    if (to === TREASURY) state.month.unpaid = (state.month.unpaid ?? 0) + missing;
  }
  return paid;
}

/** Paga deuda con dinero suyo: primero al ayuntamiento, luego al banco. Devuelve lo pagado. */
export function payDebt(state: GameState, c: Citizen, max: number): number {
  const d = c.debt;
  if (!d) return 0;
  let left = Math.floor(max);
  let paid = 0;
  for (const kind of ['town', 'bank'] as const) {
    if (left <= 0) break;
    const amt = Math.min(left, d[kind]);
    const p = transfer(state, c.id, kind === 'town' ? TREASURY : OUTSIDE, amt, kind === 'town' ? 'deudas cobradas' : undefined);
    d[kind] -= p;
    if (kind === 'town') d.aged = Math.max(0, d.aged - p);
    left -= p;
    paid += p;
  }
  state.debtLedger.repaid += paid;
  tidy(c);
  return paid;
}

/** Lo que se va (o muere sin herencia que lo cubra): lo que deba es incobrable. */
export function writeOffDebt(state: GameState, c: Citizen): number {
  const t = totalDebt(c);
  if (t > 0) {
    state.debtLedger.written += t;
    if (c.debt!.town > 0) state.month.writtenOff = (state.month.writtenOff ?? 0) + c.debt!.town;
  }
  delete c.debt;
  return t;
}

/** El alcalde aplaza la deuda con el ayuntamiento (cuota fija sin recargo) o la perdona. */
export function settleDebt(state: GameState, c: Citizen, mode: 'aplazar' | 'perdonar'): void {
  const d = c.debt;
  if (!d || d.town <= 0) return;
  if (mode === 'perdonar') {
    state.debtLedger.forgiven += d.town;
    d.town = 0;
    d.fresh = 0;
    d.aged = 0;
    delete d.plan;
    tidy(c);
    return;
  }
  d.plan = { perMonth: Math.ceil(d.town / DEBT.planMonths), until: state.tick + DEBT.planMonths * TICKS_PER_MONTH, kind: 'aplazamiento' };
  delete d.askedAt;
  d.fresh = 0;
  d.aged = 0;
}

/**
 * v1.9.1: quien pidió un aplazamiento y en DEBT.answerDays no lo tiene (ni se le
 * perdonó ni ha saldado lo que debe al ayuntamiento) se lo guarda: un recuerdo
 * «sin_respuesta» y algo de rencor. Una vez al día, sin azar.
 */
export function unansweredDeferrals(state: GameState): void {
  for (const c of state.citizens) {
    const d = c.debt;
    if (d?.askedAt === undefined) continue;
    if (d.plan || d.town <= 0) {
      delete d.askedAt;
      continue;
    }
    if (state.tick - d.askedAt < DEBT.answerDays * TICKS_PER_DAY) continue;
    delete d.askedAt;
    addMemory(state, c, 'sin_respuesta', 3, DEBT.unansweredMood);
    c.grudge = Math.min(GRUDGE_MAX, c.grudge + DEBT.unansweredGrudge);
  }
}

export function canSettleDebt(state: GameState, c: Citizen | undefined, mode: 'aplazar' | 'perdonar'): { ok: true } | { ok: false; error: string } {
  if (!c) return { ok: false, error: 'Ese vecino ya no vive en el pueblo' };
  if (!c.debt || c.debt.town <= 0) return { ok: false, error: 'No debe nada al ayuntamiento' };
  if (mode === 'aplazar' && c.debt.plan && c.debt.plan.until > state.tick) return { ok: false, error: 'Ya tiene un aplazamiento' };
  return { ok: true };
}

/** Microcrédito municipal: el ayuntamiento presta y el vecino lo devuelve en cuotas sin intereses. */
export function canMicrocredit(state: GameState, c: Citizen | undefined): { ok: true } | { ok: false; error: string } {
  if (!c) return { ok: false, error: 'Ese vecino ya no vive en el pueblo' };
  if ((state.townhallLevel ?? 1) < MICROCREDIT.townhallLevel) return { ok: false, error: `Los microcréditos llegan con el ayuntamiento de nivel ${MICROCREDIT.townhallLevel}` };
  if (c.debt?.plan && c.debt.plan.until > state.tick) return { ok: false, error: 'Ya está devolviendo un préstamo o un aplazamiento' };
  if (totalDebt(c) === 0 && c.unemployedSince === undefined && c.money >= LIVING_CUSHION) return { ok: false, error: 'No lo necesita: ni debe dinero ni está en paro' };
  if (state.treasury < MICROCREDIT.amount) return { ok: false, error: `Hacen falta ${MICROCREDIT.amount} € en la caja` };
  return { ok: true };
}

export function grantMicrocredit(state: GameState, c: Citizen): void {
  transfer(state, TREASURY, c.id, MICROCREDIT.amount, 'microcréditos');
  addDebt(state, c, 'town', MICROCREDIT.amount);
  const d = c.debt!;
  // Es un préstamo, no un impago: sin recargo.
  d.fresh = Math.max(0, d.fresh - MICROCREDIT.amount);
  d.plan = { perMonth: Math.ceil(d.town / MICROCREDIT.months), until: state.tick + MICROCREDIT.months * TICKS_PER_MONTH, kind: 'microcredito' };
  d.since = state.tick;
  // Con el dinero, primero salda lo que debe al banco o al casero.
  if (d.bank > 0) {
    const p = transfer(state, c.id, OUTSIDE, Math.min(d.bank, c.money));
    d.bank -= p;
    state.debtLedger.repaid += p;
  }
}

/** Gasto del vecino: una parte en las tiendas del pueblo (cuenta como venta), el resto fuera. */
function spend(state: GameState, c: Citizen, amount: number, shops: Building[]): number {
  const total = Math.min(c.money, Math.floor(amount));
  if (total <= 0) return 0;
  // 2.0: dónde compra lo decide la IA (en el pueblo, fuera, y en qué tienda); comer, se come siempre.
  const pref = c.spending?.where;
  const share = pref === 'fuera' ? LOCAL_SPEND_SHARE / 2 : pref === 'pueblo' ? Math.min(0.85, LOCAL_SPEND_SHARE + 0.2) : LOCAL_SPEND_SHARE;
  const local = shops.length > 0 ? Math.floor(total * share) : 0;
  if (local > 0) {
    const chosen = c.spending?.shop !== undefined ? shops.find((b) => b.id === c.spending!.shop) : undefined;
    const shop = chosen ?? shops[c.id % shops.length]!;
    const got = transfer(state, c.id, shop.id, local);
    shop.sales = (shop.sales ?? 0) + got;
  }
  transfer(state, c.id, OUTSIDE, total - local);
  return total;
}

/** Gasto básico (comida, ropa, transporte): lo primero que paga cada vecino. */
export function basicLiving(state: GameState, shops: Building[]): void {
  // 2.4: en la residencia la comida va incluida (gastan menos).
  for (const c of state.citizens) spend(state, c, c.care === 'residencia' ? LIVING_BASIC * CARE.residence.livingShare : LIVING_BASIC, shops);
}

/** Tras vivienda y tributos: devolver deudas y, si le queda colchón, algo de ocio. */
export function settleMonth(state: GameState, shops: Building[]): void {
  for (const c of state.citizens) {
    const income = c.flow?.[0] ?? 0;
    let repaid = 0;
    const d = c.debt;
    if (d) {
      const planned = d.plan && d.plan.until > state.tick ? Math.min(d.plan.perMonth, d.town) : 0;
      if (planned > 0) {
        const p = transfer(state, c.id, TREASURY, planned, 'deudas cobradas');
        d.town -= p;
        state.debtLedger.repaid += p;
        repaid += p;
      }
      if (c.debt) repaid += payDebt(state, c, Math.max(DEBT.repayMin, Math.round(income * DEBT.repayShare)) - repaid);
    }
    // Ocio: con colchón y sin deudas; con IA, solo si quiere darse ese gusto (o no ahorra).
    const wantsLeisure = c.spending ? c.spending.leisure && c.spending.where !== 'ahorrar' : true;
    if (!c.debt && wantsLeisure && c.money - LIVING_EXTRA >= LIVING_CUSHION) spend(state, c, LIVING_EXTRA, shops);
    // Intereses del banco y recargo único del ayuntamiento sobre lo que lleva un mes sin pagar.
    const dd = c.debt;
    if (dd) {
      if (dd.bank > 0) addDebt(state, c, 'bank', Math.ceil(dd.bank * DEBT.bankInterest));
      const inPlan = dd.plan && dd.plan.until > state.tick;
      if (!inPlan && dd.aged > 0) {
        const s = Math.round(Math.min(dd.aged, dd.town) * DEBT.townSurcharge);
        if (s > 0) {
          dd.town += s;
          state.debtLedger.created += s;
        }
      }
      dd.aged = inPlan ? 0 : dd.fresh;
      dd.fresh = 0;
      if (dd.plan && dd.plan.until <= state.tick) delete dd.plan;
    }
    const f = c.flow ?? [0, 0];
    // Ronda 15: cuánto creció (o bajó) lo que debe este mes, para la ficha.
    const owed = totalDebt(c);
    c.last = { in: f[0], out: f[1], repaid, owed, grew: owed - (c.last?.owed ?? 0) };
    c.flow = [0, 0];
  }
}

/** 2.3: plazas de trabajo fuera: la comarca (bonanza ×1,3, crisis ×0,6) y la estación (×1,25). */
export function outsideJobsFx(state: GameState): number {
  return regionFx(state).jobsOutside * stationJobsFx(state);
}

/** Paro real: quien no trabaja en el pueblo puede perder su trabajo de fuera, o encontrar uno. */
export function outsideJobsMonth(state: GameState): void {
  // 2.4: con estación de autobuses se encuentra y se conserva mejor (transit.ts); los jubilados ya no buscan.
  const odds = transitJobs(state);
  const nm = nurseryUse(state);
  for (const c of state.citizens) {
    if (c.jobId !== null || isRetired(c)) {
      delete c.unemployedSince;
      delete c.benefitLeft;
      continue;
    }
    if (c.unemployedSince === undefined) {
      if (chance(state.rng, odds.lose / outsideJobsFx(state))) {
        c.unemployedSince = state.tick;
        c.benefitLeft = JOBS_OUTSIDE.benefitMonths;
        // Ronda 15: que el paro deje rastro (recuerdo y, con nombre, en el diario).
        addMemory(state, c, 'en_paro', 4, -4);
        if (c.named) pushEvent(state, 'info', `${c.name} se queda sin su trabajo de fuera: cobrará el paro ${JOBS_OUTSIDE.benefitMonths} meses`, { ref: c.id });
      }
    } else if (!raisingAtHome(state, c, nm) && chance(state.rng, Math.min(0.95, odds.find * outsideJobsFx(state)))) {
      delete c.unemployedSince;
      delete c.benefitLeft;
    } else if ((c.benefitLeft ?? 0) > 0) {
      // La prestación la paga el Estado (de fuera).
      transfer(state, OUTSIDE, c.id, JOBS_OUTSIDE.benefit);
      c.benefitLeft = (c.benefitLeft ?? 0) - 1;
    }
  }
}

/** ¿Cómo va? Para la ficha y la capa «Bolsillo». */
export type Pocket = 'holgado' | 'justo' | 'no_llega' | 'endeudado';
export function pocketOf(c: Citizen): Pocket {
  if (totalDebt(c) > 0) return 'endeudado';
  if (c.last && c.last.in < c.last.out && c.money < DEBT.tightBelow) return 'no_llega';
  if (c.money < DEBT.tightBelow) return 'justo';
  return 'holgado';
}

/** Deuda en tramos (lo que ve la IA: nunca la cifra). */
export function debtBand(c: Citizen): 'ninguna' | 'poca' | 'bastante' | 'mucha' {
  const t = totalDebt(c);
  if (t <= 0) return 'ninguna';
  if (t < 500) return 'poca';
  if (t < 2_000) return 'bastante';
  return 'mucha';
}

/** Métricas del mes para el parte: impagos, deuda viva con el ayuntamiento, endeudados, paro y empresas. */
export function economyStats(state: GameState): {
  unpaid: number;
  owed: number;
  debtors: number;
  jobless: number;
  margin: number;
  losing: number;
  wage: number;
  businesses: number;
  closures: number;
  layoffs: number;
} {
  let owed = 0;
  let debtors = 0;
  let jobless = 0;
  for (const c of state.citizens) {
    if (c.debt) {
      owed += c.debt.town;
      if (totalDebt(c) > 0) debtors++;
    }
    if (c.jobId === null && c.unemployedSince !== undefined) jobless++;
  }
  const biz = state.buildings.filter((b) => (b.kind === 'shop' || b.kind === 'factory') && b.built && b.books);
  const margins = biz.map((b) => b.books!.sales - b.books!.wages - b.books!.taxes);
  return {
    unpaid: state.month.unpaid ?? 0,
    owed,
    debtors,
    jobless,
    margin: margins.length ? Math.round(margins.reduce((a, m) => a + m, 0) / margins.length) : 0,
    losing: margins.filter((m) => m < 0).length,
    wage: MIN_WAGE[state.minWage ?? 'none'],
    businesses: biz.length,
    closures: state.month.closures ?? 0,
    layoffs: state.month.layoffs ?? 0,
  };
}

/** Quien se va del pueblo (o muere): salda lo que pueda con lo que tiene; el resto es incobrable. */
export function leaveTown(state: GameState, c: Citizen): void {
  if (!c.debt) return;
  payDebt(state, c, c.money);
  writeOffDebt(state, c);
}

/** Vecinos sin nombre que se van ahogados por las deudas (sin dinero y debiendo varios meses de ingresos). */
export function drownedInDebt(state: GameState, c: Citizen): boolean {
  const owes = totalDebt(c);
  if (owes <= 0 || c.money > 0) return false;
  const income = Math.max(1, c.last?.in ?? 0);
  return owes > income * DEBT.leaveMonths;
}
