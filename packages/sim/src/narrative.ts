import { tickToDate, TICKS_PER_DAY } from '@bitopolis/shared';
import { averageHappiness, freeHomes, happinessFactors, vacancies } from './tick.ts';
import { activeObjectives, lowerFirst, NEED_TEXT, needOf } from './social.ts';
import { daysToElection, FACTION_TEXT, politicsActive } from './politics.ts';
import { fmt, loanCapacity, loanLoad, monthlyQuotas } from './loans.ts';
import { LOANS } from './balance.ts';
import { ownIncome } from './money.ts';
import { nextLevel } from './townhall.ts';
import type { GameEvent, GameState } from './state.ts';
import { type Season, seasonOf } from './weather.ts';

/** Consejero (Modo normal): consejos por reglas con los datos reales. */
export type AdvisorQuestion = 'como_va' | 'que_cambiarias';

export function townFacts(state: GameState) {
  const last = state.stats.at(-1);
  const factors: Record<string, number> = {};
  for (const c of state.citizens) for (const f of happinessFactors(state, c)) if (f.value < 0) factors[f.label.split(' (')[0]!] = (factors[f.label.split(' (')[0]!] ?? 0) + 1;
  const worries = Object.entries(factors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n]) => ({ problema: k, vecinos: n }));
  return {
    poblacion: state.citizens.length,
    felicidad_media: Math.round(averageHappiness(state)),
    caja: state.treasury,
    saldo_ultimo_mes: last ? ownIncome(last) - last.expenses : 0,
    viviendas_libres: freeHomes(state),
    empleos_libres: vacancies(state),
    sin_trabajo_en_el_pueblo: state.citizens.filter((c) => c.jobId === null).length,
    demanda: state.demand,
    preocupaciones: worries,
    promesas_pendientes: state.promises.filter((p) => p.status === 'pending').map((p) => NEED_TEXT[p.need]),
    objetivos: activeObjectives(state).map((o) => o.text),
  };
}

export function ruleAdvice(state: GameState, q: AdvisorQuestion): string[] {
  const f = townFacts(state);
  if (q === 'como_va') {
    const lines = [
      `${f.poblacion === 1 ? 'Somos 1 vecino' : `Somos ${f.poblacion} vecinos`} y la felicidad media es ${f.felicidad_media} sobre 100.`,
      f.saldo_ultimo_mes >= 0 ? `La caja ganó ${f.saldo_ultimo_mes} € el mes pasado.` : `La caja perdió ${-f.saldo_ultimo_mes} € el mes pasado.`,
    ];
    if (f.preocupaciones[0]) lines.push(`Lo que más se oye en la calle: ${lowerFirst(f.preocupaciones[0].problema)} (${f.preocupaciones[0].vecinos} ${f.preocupaciones[0].vecinos === 1 ? 'vecino' : 'vecinos'}).`);
    // 2.2: préstamos (solo si los hay).
    if (state.loans?.length) lines.push(`Las cuentas tienen nota ${state.rating}: los préstamos se llevan ${fmt(monthlyQuotas(state))} € al mes (el ${Math.round(Math.min(9.99, loanLoad(state)) * 100)} % de lo que entra).`);
    return lines;
  }
  const lines: string[] = [];
  if (f.caja < 0) {
    lines.push('Primero, sanear la caja: sube un poco las tasas o frena las obras.');
    // Cada servicio cuesta sueldos y mantenimiento todos los meses: en deuda, lo que sobra se derriba.
    const parks = state.buildings.filter((b) => b.kind === 'park').length;
    if (state.bankrupt || f.caja < -5_000) lines.push(parks > Math.ceil(f.poblacion / 25) ? `Si no basta, derriba algún parque: tienes ${parks} y con ${Math.ceil(f.poblacion / 25)} llega.` : 'Si no basta, derriba lo que menos se usa: cada servicio cuesta sueldos y mantenimiento todos los meses.');
  }
  lines.push(...loanAdvice(state));
  if (f.promesas_pendientes.length) lines.push(`Cumple lo prometido antes de que venza: ${f.promesas_pendientes[0]}.`);
  const worry = f.preocupaciones[0]?.problema;
  if (worry === 'Sin agua' || worry === 'Sin luz') lines.push('Hay casas sin agua o sin luz: amplía la red o pon otra planta.');
  else if (worry === 'Contaminación') lines.push('La contaminación pesa: aleja la industria de las casas o pon un parque entre medias.');
  else if (worry === 'Inseguridad') lines.push('La gente no se siente segura: una comisaría cerca de las casas ayudaría.');
  else if (worry === 'Trabaja fuera') lines.push('Mucha gente trabaja fuera: crea empleo con zonas comerciales o industriales.');
  else if (worry) lines.push(`Ataca lo que más molesta: ${lowerFirst(worry)}.`);
  if (f.demanda.R > 40 && f.viviendas_libres < 3) lines.push('Hay demanda de vivienda: pinta más zona residencial con agua y luz.');
  // Elecciones: la facción más descontenta y lo que pide.
  if (politicsActive(state)) {
    const [name, worst] = Object.entries(state.politics.factions).sort((a, b) => a[1].satisfaction - b[1].satisfaction)[0]!;
    const months = Math.round(daysToElection(state) / 30);
    if (worst.demand && (months <= 12 || state.politics.approval < 55)) lines.push(`Quedan ${months} meses para votar. Los más descontentos son ${FACTION_TEXT[name as keyof typeof FACTION_TEXT].toLowerCase()}: piden ${worst.demand}.`);
  }
  if (lines.length === 0) lines.push(`Vamos bien. El siguiente objetivo: ${f.objetivos[0] ?? 'seguir creciendo'}.`);
  return lines.slice(0, 3);
}

/**
 * 2.2: consejo sobre los préstamos (por reglas, con los datos reales): con nota D
 * o mucha carga, no pedir más; un préstamo de tesorería se amortiza antes que
 * ninguno; con buena nota, un préstamo puede adelantar la ampliación del ayuntamiento.
 */
export function loanAdvice(state: GameState): string[] {
  const loans = state.loans ?? [];
  const load = loanLoad(state);
  if (state.rating === 'D') return ['Las cuentas tienen nota D y nadie presta al ayuntamiento: frena obras y servicios nuevos hasta que la caja respire.'];
  if (load >= LOANS.warnLoad) return [`Los préstamos se comen el ${Math.round(Math.min(9.99, load) * 100)} % de lo que ingresas: no pidas más hasta devolver alguno.`];
  const treasury = loans.find((l) => l.kind === 'tesoreria');
  if (treasury) return [state.treasury > treasury.left * 2 ? 'Tienes un préstamo de tesorería, el más caro: amortízalo ya, que la caja lo permite.' : 'La caja cerró un mes en negativo y el banco lo cubrió con un préstamo de tesorería, más caro: que no se repita, o la nota bajará a D.'];
  const up = nextLevel(state);
  const cap = loanCapacity(state);
  if (up && state.citizens.length >= up.pop && state.treasury < up.cost && (state.rating === 'A' || state.rating === 'B') && cap >= up.cost - state.treasury) {
    return [`Con nota ${state.rating}, el banco te presta hasta ${fmt(cap)} €: un préstamo adelantaría la ampliación del ayuntamiento (cuesta ${fmt(up.cost)} €).`];
  }
  return [];
}

/** Diario del pueblo (Modo normal): crónica a partir de los eventos. */
export interface DiaryEntry {
  /** Primer tick del día (el cliente la formatea igual que el HUD). */
  tick: number;
  date: string;
  lines: string[];
}

const DIARY_KINDS = new Set(['arrival', 'departure', 'built', 'business', 'decision', 'milestone', 'bankrupt', 'tax', 'info', 'politics', 'election', 'protest']);

const SEASON_IN: Record<Season, string> = { invierno: 'en invierno', primavera: 'en primavera', verano: 'en verano', otono: 'en otoño' };

/** La noticia de un suceso sin su motivo («Lucía se queda: «…»» → «Lucía se queda»). */
export function newsOf(text: string): string {
  const i = text.indexOf(': «');
  return i > 0 ? text.slice(0, i) : text;
}

/**
 * 2.1: la misma noticia de un vecino (o de un edificio) sale como mucho una
 * vez por estación en el diario: se queda la última y dice cuántas veces pasó.
 * Devuelve, por suceso que se queda, cuántas veces se repitió; los repetidos
 * que se quitan no están en el mapa.
 */
export function diaryRepeats(events: readonly GameEvent[]): Map<GameEvent, number> {
  const groups = new Map<string, GameEvent[]>();
  const keep = new Map<GameEvent, number>();
  for (const e of events) {
    if (e.ref === undefined || !['decision', 'info', 'business', 'politics'].includes(e.kind)) {
      keep.set(e, 1);
      continue;
    }
    const d = tickToDate(e.tick);
    // El invierno abarca diciembre y el enero siguiente: cuenta con el año de diciembre.
    const year = d.month === 12 ? d.year + 1 : d.year;
    const key = `${e.ref}|${newsOf(e.text)}|${year}|${seasonOf(d.month)}`;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  for (const list of groups.values()) keep.set(list.at(-1)!, list.length);
  return keep;
}

export function diary(state: GameState, maxDays = 12): DiaryEntry[] {
  const byDay = new Map<number, GameEvent[]>();
  const counts = diaryRepeats(state.events.filter((e) => DIARY_KINDS.has(e.kind)));
  const lineOf = (e: GameEvent) => {
    const n = counts.get(e) ?? 1;
    return n > 1 ? `${newsOf(e.text)} (${n} veces ${SEASON_IN[seasonOf(tickToDate(e.tick).month)]})` : e.text;
  };
  for (const e of state.events) {
    if (!DIARY_KINDS.has(e.kind) || !counts.has(e)) continue;
    const d = Math.floor(e.tick / TICKS_PER_DAY);
    const list = byDay.get(d) ?? [];
    list.push(e);
    byDay.set(d, list);
  }
  const days = [...byDay.keys()].sort((a, b) => b - a).slice(0, maxDays);
  return days.map((d) => {
    const evs = byDay.get(d)!;
    const date = tickToDate(d * TICKS_PER_DAY);
    // Solo se agrupan los forasteros; bebés e hijos que se independizan, cada uno con su línea.
    const own = (e: { kind: string; text: string }) => e.kind === 'arrival' && /bebé|independiza/.test(e.text);
    const arrivals = evs.filter((e) => e.kind === 'arrival' && !own(e)).length;
    const lines = evs.filter((e) => e.kind !== 'arrival' || own(e)).map(lineOf);
    if (arrivals === 1) lines.unshift(evs.find((e) => e.kind === 'arrival' && !own(e))!.text);
    else if (arrivals > 1) lines.unshift(`Llegan ${arrivals} vecinos nuevos al pueblo`);
    return { tick: d * TICKS_PER_DAY, date: `${date.day}/${date.month}, año ${date.year}`, lines };
  });
}

/** Lo que pedirían hoy los vecinos con nombre (para preparar el pleno). */
export function topNeeds(state: GameState): string[] {
  const counts: Record<string, number> = {};
  for (const c of state.citizens) if (c.named) counts[needOf(state, c)] = (counts[needOf(state, c)] ?? 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => NEED_TEXT[k as keyof typeof NEED_TEXT]);
}
