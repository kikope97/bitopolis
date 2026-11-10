import type { BuildKind, Command } from '@bitopolis/shared';
import { BUILD, commandOutlay, type GameState, maintenanceByKind, materialsCost, monthlyCostOf, monthNet, earlyRepaid, pendingWorksCost, runningExpenses, upkeepOf, WAGE_OUTSIDE, worksSpent } from '@bitopolis/sim';
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

/**
 * Lo que entra y lo que se gasta al mes sin obras (el mes pasado; sin mes cerrado, una estimación).
 * 2.8: con el mismo reparto que el motor (`monthNet`); el gasto corriente no baja de lo que
 * cuesta ya lo construido (`runningEstimate`), para que una obra recién acabada cuente.
 */
export function monthFlow(s: GameState): { income: number; running: number; works: number; closed: boolean } {
  const last = s.stats.at(-1);
  if (!last) return { income: 0, running: runningEstimate(s), works: worksSpent(s.month), closed: false };
  const n = monthNet(last);
  return { income: n.own, running: Math.max(n.running, runningEstimate(s)), works: n.works, closed: true };
}

/** 2.8: el neto del último mes cerrado (lo propio − el gasto corriente), o `null` sin mes cerrado. El mismo en todas partes. */
export function lastNet(s: GameState): number | null {
  const last = s.stats.at(-1);
  return last ? monthNet(last).net : null;
}

/** «+1.200 €» / «−800 €» (con su signo). */
export function netText(n: number): string {
  return `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;
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
  // 2.8: el mismo reparto que `monthNet` (lo amortizado, aparte).
  const w = worksSpent(m);
  const r = earlyRepaid(m);
  return `Gasto corriente ${money(runningExpenses(m))}${w ? ` · Obras ${money(w)}` : ''}${r ? ` · Amortizado ${money(r)}` : ''}`;
}

/**
 * 2.8 (ronda 24): la racha del escenario «Pueblo en quiebra» al cerrar el mes,
 * con el mismo neto que la cuenta el motor (`scenariosMonth`): «Racha: 3/13» o
 * «Racha rota: te faltaron 430 €». Vacío fuera de la quiebra o si ya terminó.
 */
export function streakText(s: GameState): string {
  const sc = s.scenario;
  const last = s.stats.at(-1);
  if (!sc || sc.id !== 'quiebra' || sc.done || sc.goal?.kind !== 'superavit' || !last) return '';
  const p = sc.goal.progress ?? 0;
  if (p > 0) return `Racha: ${p}/${sc.goal.target}`;
  const short = money(Math.max(1, -monthNet(last).net));
  const prev = s.stats.at(-2);
  return prev && monthNet(prev).net > 0 ? `Racha rota: te faltaron ${short}` : `Sin superávit este mes: te faltaron ${short} (racha 0/${sc.goal.target})`;
}
