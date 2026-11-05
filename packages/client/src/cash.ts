import type { BuildKind, Command } from '@bitopolis/shared';
import { BUILD, commandOutlay, type GameState, maintenanceByKind, materialsCost, monthlyCostOf, ownIncome, pendingWorksCost, runningExpenses, upkeepOf, WAGE_OUTSIDE, worksSpent } from '@bitopolis/sim';
import { money } from './i18n.ts';

/**
 * 2.7 «Construir y el dinero»: cuánto aguanta la caja, siempre con el gasto
 * corriente (mantenimiento, sueldos, gasto de cada vecino, cuotas) y nunca con
 * las obras, que se pagan una vez. Antes, el mes de la estación de tren hacía
 * creer que el pueblo gastaba 26.000 € al mes.
 */

/** Gasto corriente al mes estimado ahora: lo que hay construido y la plantilla municipal. */
export function runningEstimate(s: GameState): number {
  const maint = maintenanceByKind(s).reduce((a, x) => a + x.amount, 0);
  const upkeep = Object.values(upkeepOf(s)).reduce((a, v) => a + v, 0);
  let wages = 0;
  const byId = new Map(s.buildings.map((b) => [b.id, b]));
  for (const c of s.citizens) {
    const b = c.jobId === null ? undefined : byId.get(c.jobId);
    if (!b || !b.built || b.kind === 'shop' || b.kind === 'factory' || b.kind === 'farm' || b.kind === 'townhall') continue;
    const m = monthlyCostOf(b.kind as BuildKind, s);
    if (m.jobs > 0) wages += m.wages / m.jobs;
  }
  return Math.round(maint + upkeep + wages);
}

/** Lo que entra y lo que se gasta al mes sin obras (el mes pasado; sin mes cerrado, una estimación). */
export function monthFlow(s: GameState): { income: number; running: number; works: number; closed: boolean } {
  const last = s.stats.at(-1);
  if (!last) return { income: 0, running: runningEstimate(s), works: worksSpent(s.month), closed: false };
  return { income: ownIncome(last), running: Math.max(runningExpenses(last), runningEstimate(s)), works: worksSpent(last), closed: true };
}

/**
 * Meses que aguanta `cash` con lo que entra y el gasto corriente (más `extra` al
 * mes, lo que costará una obra nueva). `null` si el mes sale en positivo.
 */
export function runwayMonths(s: GameState, cash = s.treasury, extra = 0): number | null {
  const f = monthFlow(s);
  const net = f.income - f.running - extra;
  if (net >= 0) return null;
  return Math.max(0, cash) / -net;
}

/** «menos de un mes», «1 mes», «3 meses». */
export function monthsText(m: number): string {
  const n = Math.floor(m);
  return n < 1 ? 'menos de un mes' : n === 1 ? '1 mes' : `${n} meses`;
}

/**
 * Tras gastar `outlay` (y con lo que falta de las obras en marcha), cuánto
 * aguanta la caja si son menos de `under` meses: el aviso de la barra «Construir».
 */
export function runwayWarn(s: GameState, outlay: number, extraMonthly = 0, under = 2): string {
  const after = s.treasury - outlay - pendingWorksCost(s);
  if (after < 0) return '';
  const m = runwayMonths(s, after, extraMonthly);
  if (m === null || m >= under) return '';
  return `⚠ Tras esta obra, la caja aguanta ${monthsText(m)}`;
}

/** Lo que costará una orden al ayuntamiento como mucho (lo del motor). */
export const outlayOf = (s: GameState, cmd: Command) => commandOutlay(s, cmd);

/** «3000 € de materiales ahora + hasta 1200 € de obreros (4 × 3 días)», con la colina si toca. */
export function buildCostParts(s: GameState, kind: BuildKind, x: number, y: number): { now: number; labor: number; text: string } {
  const spec = BUILD[kind];
  const now = materialsCost(s, kind, x, y);
  const labor = spec.workers * spec.days * WAGE_OUTSIDE;
  return { now, labor, text: labor ? `${money(now)} ahora + hasta ${money(labor)} de obreros` : `${money(now)} ahora` };
}

/** «Gasto corriente 3200 € · Obras 32160 €» de un mes. */
export function splitText(m: { expenses: number; breakdown: Record<string, number> }): string {
  const w = worksSpent(m);
  return `Gasto corriente ${money(runningExpenses(m))}${w ? ` · Obras ${money(w)}` : ''}`;
}
