import { DAYS_PER_MONTH, MONTHS_PER_YEAR, TICKS_PER_DAY, tickToDate } from '@bitopolis/shared';
import { canHoldFestival, DEBT, DILEMMA_TITLE, type GameState, GRANT_NAME, GRANT_OFFER_DAYS, ofGrant, OFFER_TEXT, seasonName, SEASONS } from '@bitopolis/sim';
import { plural } from './i18n.ts';

/**
 * 2.7 «Campana 2.0»: lo que espera respuesta del alcalde, sacado del estado
 * (no de los avisos): sale al llegar y se va solo cuando se responde o vence.
 * Cada cosa lleva su plazo (si lo hay) y una referencia `go` que abre la
 * tarjeta concreta (ver `goTo` en game.ts). Sirve a la pestaña «Te piden»,
 * al número de la campana y a «Hoy en Bitópolis».
 */
export interface Ask {
  /** Clave estable (para no repetir y para las pruebas). */
  key: string;
  text: string;
  /** Tick en que vence (sin definir: no tiene plazo). */
  due?: number;
  /** Qué abre (`th:grants`, `dilemma:12`, `c:40`…). */
  go: string;
  /** Texto del botón. */
  action: string;
}

const tickOf = (year: number, month: number, day: number) => (((year - 1) * MONTHS_PER_YEAR + (month - 1)) * DAYS_PER_MONTH + (day - 1)) * TICKS_PER_DAY;

export function pendingAsks(state: GameState): Ask[] {
  const out: Ask[] = [];
  const now = state.tick;
  const d = tickToDate(now);
  for (const dl of state.dilemmas ?? []) {
    if (dl.resolved || dl.until <= now) continue;
    out.push({ key: `dilemma:${dl.id}`, text: `Un asunto difícil: ${DILEMMA_TITLE[dl.kind].toLowerCase()}`, due: dl.until, go: `dilemma:${dl.id}`, action: 'Decidir' });
  }
  for (const g of state.grants) {
    if (g.status !== 'offered') continue;
    const due = g.offeredTick + (g.offerDays ?? GRANT_OFFER_DAYS) * TICKS_PER_DAY;
    if (due <= now) continue;
    const what = g.feder ? 'Fondos europeos (FEDER)' : `La Diputación paga el ${Math.round(g.share * 100)} % ${GRANT_NAME[g.kind] ? ofGrant(g.kind) : 'de una obra'}`;
    out.push({ key: `grant:${g.id}`, text: what, due, go: 'th:grants', action: 'Responder' });
  }
  const f = state.seasons?.current;
  if (f && f.status === 'comision' && f.asked) {
    const m = SEASONS.month[f.season]!;
    const day = SEASONS.day[f.season]!;
    out.push({ key: `fiesta:${f.season}:${f.year}`, text: `La comisión de festejos de ${seasonName(state, f.season)} pide presupuesto`, due: tickOf(f.year, m, day), go: 'th:seasons', action: 'Responder' });
  }
  if (state.festival.name && state.festival.year !== d.year && (d.month === 7 || d.month === 8) && canHoldFestival(state, 'pequena').ok) {
    out.push({ key: `patronales:${d.year}`, text: `Las fiestas de ${state.festival.name}: puedes organizarlas`, due: tickOf(d.year, 9, 1), go: 'th:festival', action: 'Organizar' });
  }
  if (state.budget.status === 'open' && state.budget.year === d.year) {
    out.push({ key: `budget:${d.year}`, text: `Presentar el presupuesto de ${d.year}`, due: tickOf(d.year, 2, 1), go: 'th:budget', action: 'Presentar' });
  }
  for (const o of state.comarca?.offers ?? []) {
    if (o.resolved || o.until <= now) continue;
    const town = state.comarca.towns.find((t) => t.id === o.townId);
    out.push({ key: `offer:${o.id}`, text: `${town?.name ?? 'Un pueblo vecino'} ofrece un acuerdo de ${OFFER_TEXT[o.kind]}`, due: o.until, go: 'comarca', action: 'Responder' });
  }
  const big = state.bigCompany;
  if (big?.status === 'oferta' && big.deadline > now) out.push({ key: `big:${big.offeredTick}`, text: `${big.name} quiere montar una fábrica (${big.jobs} empleos)`, due: big.deadline, go: 'region', action: 'Responder' });
  for (const e of state.errands?.list ?? []) {
    if (e.status !== 'ofrecido' || e.until <= now) continue;
    out.push({ key: `errand:${e.id}`, text: `Encargo: ${e.text}`, due: e.until, go: 'errands', action: 'Responder' });
  }
  for (const a of state.associations ?? []) {
    if (a.protestDay < 0 || a.protestDay <= now) continue;
    out.push({ key: `protest:${a.id}`, text: `La ${a.name} convoca una manifestación`, due: a.protestDay, go: 'th:associations', action: 'Reunirse' });
  }
  const debts = state.citizens.filter((c) => c.debt?.askedAt !== undefined);
  if (debts.length === 1) {
    const c = debts[0]!;
    out.push({ key: `debt:${c.id}`, text: `${c.name} pide aplazar lo que debe`, due: c.debt!.askedAt! + DEBT.answerDays * TICKS_PER_DAY, go: `c:${c.id}`, action: 'Responder' });
  } else if (debts.length > 1) {
    const due = Math.min(...debts.map((c) => c.debt!.askedAt! + DEBT.answerDays * TICKS_PER_DAY));
    out.push({ key: 'debts', text: `${plural(debts.length, 'vecino pide', 'vecinos piden')} aplazar lo que deben`, due, go: 'debtors', action: 'Ver' });
  }
  // Lo que vence antes, primero; lo que no tiene plazo, al final.
  return out.sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));
}

/** «Quedan 3 días», «vence hoy»… (en días de juego). */
export function dueText(now: number, due: number | undefined): string {
  if (due === undefined) return '';
  const days = Math.ceil((due - now) / TICKS_PER_DAY);
  if (days <= 0) return 'vence hoy';
  if (days === 1) return 'queda 1 día';
  if (days < 60) return `quedan ${days} días`;
  const months = Math.round(days / DAYS_PER_MONTH);
  return `quedan ${months} meses`;
}

/** ¿Va justo de plazo? (para pintarlo en rojo). */
export function dueSoon(now: number, due: number | undefined): boolean {
  return due !== undefined && due - now <= 3 * TICKS_PER_DAY;
}
