/**
 * 2.4 (bloque E): fiestas de temporada (romería, San Juan, patronales y
 * Navidad) con comisión de festejos, programa y presupuesto
 * (`ApproveFestival`). Números en `SEASONS` (balance.ts).
 *
 * - Un mes antes de cada fiesta se forma la comisión de festejos: 3 vecinos con
 *   nombre. En Modo IA, los vecinos con IA se apuntan en su turno
 *   (`apuntarse_comision`) y el primero que se apunta (el líder) elige el
 *   programa en su acto del `TownTurn` (`programa`); pasados `joinDays`, las
 *   reglas completan la comisión (los más sociables) y, si hace falta, el
 *   programa (según los rasgos del líder). En Modo normal, todo por reglas.
 * - Con la comisión lista, pide presupuesto al alcalde: `nada`, `poco` o `todo`
 *   (paga el 0/50/100 % y la comisión recauda el resto, 10 € por vecino con
 *   nombre que los tenga). Si no llega el dinero, se quitan los últimos actos
 *   del programa; sin ninguno, fiesta popular reducida. Con `nada`, la comisión
 *   se lo guarda (`grudge`). Sin respuesta a tiempo, la comisión hace lo que
 *   puede con lo recaudado (sin rencor). Si gobierna el rival, aprueba `poco`.
 * - Las patronales siguen pudiendo organizarse con `HoldFestival` (civic.ts):
 *   si el alcalde lo hace, la comisión se disuelve; si no hay comisión (pocos
 *   vecinos), siguen las populares de septiembre.
 *
 * El dinero solo se mueve con `transfer`/`charge` (ayuntamiento y vecinos a
 * fuera; el gasto de la fiesta, de fuera a las tiendas).
 */
import { TICKS_PER_DAY, tickToDate } from '@bitopolis/shared';
import { SEASONS } from './balance.ts';
import type { CommandResult } from './commands.ts';
import { flagRisk, fireStationsFor, placeName } from './fire.ts';
import { hash32 } from './hash.ts';
import { charge } from './household.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { addMemory } from './social.ts';
import type { Building, Citizen, FestivalBudget, FestivalSeason, GameState, SeasonFestival } from './state.ts';
import { pushEvent } from './state.ts';
import { isWater } from './terrain.ts';
import { isAiCitizen } from './turns.ts';

export const FESTIVAL_SEASONS: FestivalSeason[] = ['romeria', 'sanjuan', 'patronales', 'navidad'];
export const FESTIVAL_ACTS = ['verbena', 'procesion', 'concurso_paellas', 'hoguera', 'belen_viviente', 'mercadillo', 'fuegos', 'cabalgata'] as const;
export type FestivalAct = (typeof FESTIVAL_ACTS)[number];

export const SEASON_NAMES: Record<FestivalSeason, string> = {
  romeria: 'Romería',
  sanjuan: 'San Juan',
  patronales: 'Fiestas patronales',
  navidad: 'Navidad',
};

export const ACT_NAMES: Record<FestivalAct, string> = {
  verbena: 'Verbena',
  procesion: 'Procesión a la ermita',
  concurso_paellas: 'Concurso de paellas',
  hoguera: 'Hoguera',
  belen_viviente: 'Belén viviente',
  mercadillo: 'Mercadillo',
  fuegos: 'Fuegos artificiales',
  cabalgata: 'Cabalgata',
};

const first = (c: Citizen) => c.name.split(' ')[0]!;
const hasBuilt = (state: GameState, kind: Building['kind']) => state.buildings.some((b) => b.kind === kind && b.built && !b.damaged);

/** Nombre de la fiesta en una frase («la romería», «las fiestas de San Ladrillo»). */
export function seasonName(state: GameState, s: FestivalSeason): string {
  if (s === 'patronales') return `las fiestas de ${state.festival.name ?? 'el pueblo'}`;
  return s === 'romeria' ? 'la romería' : s === 'sanjuan' ? 'San Juan' : 'la Navidad';
}

/** Actos que caben ahora en el programa de una fiesta (la procesión, solo con ermita). */
export function availableActs(state: GameState, season: FestivalSeason): FestivalAct[] {
  return (SEASONS.menu[season] ?? []).filter((a) => a !== 'procesion' || hasBuilt(state, 'chapel')) as FestivalAct[];
}

/** Coste del programa (con las luces de Navidad, que van siempre). */
export function programCost(season: FestivalSeason, acts: readonly string[]): number {
  return (season === 'navidad' ? SEASONS.lights.cost : 0) + acts.reduce((s, a) => s + (SEASONS.acts[a]?.cost ?? 0), 0);
}

/** Lo que paga el ayuntamiento con cada presupuesto. */
export function townShare(season: FestivalSeason, acts: readonly string[], budget: FestivalBudget): number {
  return Math.round(programCost(season, acts) * (SEASONS.budgetShare[budget] ?? 0));
}

/** Día de la fiesta del año en curso (tick a las 0 h). */
function festivalTick(year: number, season: FestivalSeason): number {
  return (((year - 1) * 12 + (SEASONS.month[season]! - 1)) * 30 + (SEASONS.day[season]! - 1)) * TICKS_PER_DAY;
}

/** ¿La fiesta tiene lo que necesita para celebrarse? (la romería, una ermita). */
export function seasonPossible(state: GameState, season: FestivalSeason): boolean {
  return season !== 'romeria' || hasBuilt(state, 'chapel');
}

/* ---------------- comisión de festejos ---------------- */

/** ¿Se pueden apuntar vecinos a la comisión ahora? */
export function committeeOpen(state: GameState): boolean {
  const f = state.seasons?.current;
  return !!f && f.status === 'comision' && !f.asked && f.committee.length < SEASONS.committee;
}

/** Vecino con IA que puede apuntarse (con nombre, no está ya y no gobierna). */
export function canJoinCommittee(state: GameState, c: Citizen): boolean {
  const f = state.seasons?.current;
  return committeeOpen(state) && !!f && c.named && !f.committee.includes(c.id) && state.politics.mayor !== c.id && isAiCitizen(state, c);
}

export function joinCommittee(state: GameState, c: Citizen): string {
  const f = state.seasons.current;
  if (!f || !canJoinCommittee(state, c)) return 'al final no se apunta a la comisión de festejos';
  f.committee.push(c.id);
  return f.committee.length === 1 ? `se apunta a la comisión de festejos de ${seasonName(state, f.season)} y la encabeza` : `se apunta a la comisión de festejos de ${seasonName(state, f.season)}`;
}

/** Lo que se le cuenta a la IA del vecino (solo si puede apuntarse o encabeza la comisión sin programa). */
export function committeeBrief(state: GameState, c: Citizen): { fiesta: string; eres: string; actos_posibles: string[] } | null {
  const f = state.seasons?.current;
  if (!f || f.status !== 'comision' || f.asked || f.programBy) return null;
  const leads = f.committee[0] === c.id;
  const couldLead = f.committee.length === 0 && canJoinCommittee(state, c);
  if (!leads && !couldLead) return null;
  return { fiesta: SEASON_NAMES[f.season], eres: leads ? 'líder de la comisión' : 'puede encabezar la comisión si se apunta', actos_posibles: availableActs(state, f.season) };
}

/** Por reglas: los más sociables con nombre que aún no están (y no gobiernan). */
function fillCommittee(state: GameState, f: SeasonFestival): void {
  const pool = state.citizens
    .filter((c) => c.named && !f.committee.includes(c.id) && state.politics.mayor !== c.id)
    .sort((a, b) => b.traits.social - a.traits.social || a.id - b.id);
  for (const c of pool) {
    if (f.committee.length >= SEASONS.committee) break;
    f.committee.push(c.id);
  }
}

/** Gusto de un vecino por cada acto (según sus rasgos). */
function actScore(c: Citizen, a: FestivalAct): number {
  const t = c.traits;
  switch (a) {
    case 'verbena':
      return t.social;
    case 'procesion':
      return t.terco;
    case 'concurso_paellas':
      return (t.social + t.ahorro) / 2;
    case 'hoguera':
      return 1_000; // San Juan sin hoguera no es San Juan
    case 'belen_viviente':
      return (t.terco + t.social) / 2;
    case 'mercadillo':
      return t.ambicion;
    case 'fuegos':
      return (t.ambicion + 100 - t.ahorro) / 2;
    case 'cabalgata':
      return (t.social + t.ambicion) / 2;
  }
}

/** Programa por reglas: lo que más le gusta al líder; 3 actos si no es muy ahorrador, 2 si lo es. */
export function ruleProgram(state: GameState, leader: Citizen | undefined, season: FestivalSeason): FestivalAct[] {
  const acts = availableActs(state, season);
  const n = leader && leader.traits.ahorro >= 60 ? SEASONS.programMin : SEASONS.programMax;
  if (!leader) return acts.slice(0, SEASONS.programMin);
  return [...acts].sort((a, b) => actScore(leader, b) - actScore(leader, a) || acts.indexOf(a) - acts.indexOf(b)).slice(0, n);
}

/** Valida un programa propuesto por la IA: actos del menú, sin repetir, 2–3, y San Juan con hoguera. */
export function validProgram(state: GameState, season: FestivalSeason, raw: readonly string[]): FestivalAct[] | null {
  const ok = availableActs(state, season);
  const out: FestivalAct[] = [];
  for (const a of raw) if ((ok as string[]).includes(a) && !out.includes(a as FestivalAct)) out.push(a as FestivalAct);
  if (season === 'sanjuan' && !out.includes('hoguera')) out.unshift('hoguera');
  const list = out.slice(0, SEASONS.programMax);
  return list.length >= SEASONS.programMin ? list : null;
}

/** El líder de la comisión (con IA) propone el programa en su acto del turno. Devuelve el efecto o null. */
export function proposeProgram(state: GameState, c: Citizen, raw: readonly string[] | undefined): string | null {
  const f = state.seasons?.current;
  if (!raw?.length || !f || f.status !== 'comision' || f.asked || f.programBy || f.committee[0] !== c.id) return null;
  const list = validProgram(state, f.season, raw);
  if (!list) return null;
  f.program = list;
  f.programBy = 'ia';
  return `propone para ${seasonName(state, f.season)}: ${list.map((a) => ACT_NAMES[a].toLowerCase()).join(', ')}`;
}

function openCommittee(state: GameState, season: FestivalSeason, year: number): void {
  const named = state.citizens.filter((c) => c.named);
  if (state.citizens.length < SEASONS.minPop || !named.length || !seasonPossible(state, season)) return;
  if (state.seasons.held[season] === year) return;
  // Las patronales que ya organizó el alcalde (HoldFestival) no necesitan comisión.
  if (season === 'patronales' && state.festival.year === year) return;
  const ai = state.aiMode && named.some((c) => isAiCitizen(state, c));
  const joinDays = Math.min(20, Math.max(SEASONS.joinDays, (state.ai?.paceDays ?? 7) + 1));
  const f: SeasonFestival = {
    season,
    year,
    status: 'comision',
    committee: [],
    program: [],
    budget: null,
    opened: state.tick,
    joinUntil: ai ? state.tick + joinDays * TICKS_PER_DAY : state.tick,
    day: festivalTick(year, season),
  };
  state.seasons.current = f;
  if (ai) pushEvent(state, 'info', `Se busca gente para la comisión de festejos de ${seasonName(state, season)} (dentro de un mes)`);
  else closeCommittee(state, f);
}

/** La comisión se completa, elige programa (si no lo hizo la IA) y pide presupuesto. */
function closeCommittee(state: GameState, f: SeasonFestival): void {
  fillCommittee(state, f);
  const leader = state.citizens.find((c) => c.id === f.committee[0]);
  if (!f.programBy) {
    f.program = ruleProgram(state, leader, f.season);
    f.programBy = 'reglas';
  }
  f.asked = true;
  const names = f.committee.map((id) => state.citizens.find((c) => c.id === id)).filter((c): c is Citizen => !!c).map(first);
  const acts = f.program.map((a) => ACT_NAMES[a as FestivalAct].toLowerCase()).join(', ');
  // Si gobierna el rival, aprueba la mitad sin esperar.
  if (state.politics.mayor !== 'player') {
    f.budget = 'poco';
    f.status = 'aprobada';
    pushEvent(state, 'info', `La comisión de festejos de ${seasonName(state, f.season)} (${names.join(', ')}) prepara ${acts}; el gobierno pone la mitad`, leader ? { ref: leader.id } : {});
    return;
  }
  pushEvent(
    state,
    'politics',
    `La comisión de festejos de ${seasonName(state, f.season)} (${names.join(', ')}) pide presupuesto: ${acts} (${programCost(f.season, f.program)} €). Pueblo › Ayuntamiento`,
    { ...(leader ? { ref: leader.id } : {}), notify: true },
  );
}

/* ---------------- presupuesto ---------------- */

export function canApproveFestival(state: GameState, season: FestivalSeason, budget: FestivalBudget): CommandResult {
  const f = state.seasons?.current;
  if (!f || f.season !== season || f.status !== 'comision') return { ok: false, error: `No hay comisión de ${SEASON_NAMES[season].toLowerCase()} esperando presupuesto` };
  if (!f.asked) return { ok: false, error: 'La comisión aún está preparando el programa' };
  const pay = townShare(season, f.program, budget);
  if (pay > 0 && state.treasury < pay) return { ok: false, error: `Te faltan ${pay - Math.max(0, state.treasury)} € para pagar esa parte` };
  return { ok: true };
}

export function approveFestival(state: GameState, season: FestivalSeason, budget: FestivalBudget): void {
  const f = state.seasons.current;
  if (!f || f.season !== season) return;
  f.budget = budget;
  f.status = 'aprobada';
  const text =
    budget === 'todo'
      ? `El alcalde paga todo el programa de ${seasonName(state, season)}`
      : budget === 'poco'
        ? `El alcalde paga la mitad de ${seasonName(state, season)}; la comisión recaudará el resto`
        : `El alcalde no pone dinero para ${seasonName(state, season)}: la comisión hará lo que pueda`;
  pushEvent(state, 'politics', text);
}

/* ---------------- la fiesta ---------------- */

/**
 * Qué se puede pagar: el ayuntamiento pone su parte de lo que se haga y la
 * comisión, el resto (hasta 10 € por vecino con nombre que los tenga). Se
 * quitan actos del final del programa hasta que cuadre.
 */
export function festivalPlan(state: GameState, f: SeasonFestival, budget: FestivalBudget): { acts: string[]; town: number; collect: number; lights: boolean } {
  const cap = state.citizens.filter((c) => c.named && c.money >= SEASONS.collectPerNamed).length * SEASONS.collectPerNamed;
  const share = SEASONS.budgetShare[budget] ?? 0;
  const fits = (acts: string[]) => {
    const cost = programCost(f.season, acts);
    const town = Math.round(cost * share);
    return { town, collect: cost - town, ok: cost - town <= cap };
  };
  for (let n = f.program.length; n >= 1; n--) {
    const acts = f.program.slice(0, n);
    const r = fits(acts);
    if (r.ok) return { acts, town: r.town, collect: r.collect, lights: f.season === 'navidad' };
  }
  // Solo las luces de Navidad, si llegan.
  if (f.season === 'navidad' && fits([]).ok) {
    const r = fits([]);
    return { acts: [], town: r.town, collect: r.collect, lights: true };
  }
  return { acts: [], town: 0, collect: 0, lights: false };
}

/** El pueblo tiene río o mar (la hoguera de San Juan junto al agua). */
function hasWater(state: GameState): boolean {
  return (state.map.terrain ?? []).some((t) => isWater(t));
}

function celebrate(state: GameState, f: SeasonFestival): void {
  const silent = f.budget === null && state.politics.mayor === 'player';
  const budget: FestivalBudget = f.budget ?? (silent ? 'nada' : 'poco');
  const plan = festivalPlan(state, f, budget);
  // Dinero: la parte del ayuntamiento y la recaudación (todo a fuera: músicos, pólvora, comida).
  if (plan.town > 0) transfer(state, TREASURY, OUTSIDE, plan.town, 'fiestas');
  let collected = 0;
  if (plan.collect > 0) {
    for (const c of [...state.citizens].filter((x) => x.named && x.money >= SEASONS.collectPerNamed).sort((a, b) => a.id - b.id)) {
      if (collected >= plan.collect) break;
      collected += charge(state, c, OUTSIDE, Math.min(SEASONS.collectPerNamed, plan.collect - collected), 'fiestas');
    }
  }
  const reduced = plan.acts.length === 0;
  let mood = reduced ? SEASONS.popularMood : plan.acts.reduce((s, a) => s + (SEASONS.acts[a]?.mood ?? 0), 0);
  if (plan.lights) mood += SEASONS.lights.mood;
  if (f.season === 'sanjuan' && plan.acts.includes('hoguera') && hasWater(state)) mood += SEASONS.waterBonus;
  const noise = plan.acts.reduce((m, a) => Math.max(m, SEASONS.acts[a]?.noise ?? 0), 0);
  // Las tiendas venden más esos días (vecinos y forasteros).
  const spend = plan.acts.reduce((s, a) => s + (SEASONS.acts[a]?.spend ?? 0), 0);
  if (spend > 0) for (const b of state.buildings) if (b.kind === 'shop' && b.built && !b.damaged) transfer(state, OUTSIDE, b.id, spend * Math.max(1, state.citizens.length / 10));
  const days = SEASONS.moodDays[f.season] ?? 7;
  Object.assign(f, { status: 'celebrada', budget, held: plan.acts, mood, noise, until: state.tick + days * TICKS_PER_DAY, paid: { town: plan.town, collected }, ...(silent ? { silent: true } : {}) });
  state.seasons.held[f.season] = f.year;
  // Las patronales siguen contando como las fiestas del año (turismo, bar, septiembre).
  if (f.season === 'patronales') {
    state.festival.year = f.year;
    state.festival.size = budget === 'todo' ? 'grande' : budget === 'poco' ? 'pequena' : 'popular';
    state.festival.until = f.until!;
  }
  if (!reduced) for (const c of state.citizens) if (c.named) addMemory(state, c, 'fue_a_las_fiestas', 2, Math.min(3, Math.round(mood / 2)));
  // Con «nada», la comisión se lo guarda (sin respuesta, no: nadie les dijo que no).
  if (budget === 'nada' && !silent) for (const id of f.committee) { const c = state.citizens.find((x) => x.id === id); if (c) c.grudge += SEASONS.nadaGrudge; }
  const what = reduced ? (plan.lights ? 'solo las luces' : 'una fiesta popular, sin programa') : [...(plan.lights ? ['luces'] : []), ...plan.acts.map((a) => ACT_NAMES[a as FestivalAct].toLowerCase())].join(', ');
  pushEvent(state, 'milestone', `¡${seasonName(state, f.season).replace(/^./, (x) => x.toUpperCase())}! ${what}${silent ? ' (el ayuntamiento no contestó a la comisión)' : ''}`);
  // San Juan: las ascuas de la hoguera pueden dejar un riesgo de incendio (con su aviso).
  if (f.season === 'sanjuan' && plan.acts.includes('hoguera')) bonfireRisk(state);
}

function bonfireRisk(state: GameState): void {
  const hall = state.buildings.find((b) => b.kind === 'townhall');
  if (!hall) return;
  const near = state.buildings
    .filter((b) => ['house', 'res', 'shop', 'bar', 'market'].includes(b.kind) && b.built && !b.damaged && !b.fire && !b.risk)
    .sort((a, b) => Math.abs(a.x - hall.x) + Math.abs(a.y - hall.y) - (Math.abs(b.x - hall.x) + Math.abs(b.y - hall.y)) || a.id - b.id)[0];
  if (!near) return;
  const p = SEASONS.bonfireRisk * (fireStationsFor(state, near.x, near.y).length ? 0.5 : 1);
  if (hash32(state.seed, state.tick, 623) / 0x1_0000_0000 < p) flagRisk(state, near, `ascuas de la hoguera de San Juan junto a ${placeName(near)}`);
}

/** El alcalde organizó las patronales por su cuenta (HoldFestival): la comisión se disuelve. */
export function patronalesByTownhall(state: GameState): void {
  const f = state.seasons?.current;
  if (f && f.season === 'patronales' && (f.status === 'comision' || f.status === 'aprobada')) {
    f.status = 'cancelada';
    state.seasons.held.patronales = f.year;
  }
}

/** Cada día: abrir comisiones, cerrarlas y celebrar. */
export function seasonsDay(state: GameState): void {
  if (!state.seasons) return;
  const d = tickToDate(state.tick);
  const f = state.seasons.current;
  if (f && f.status === 'comision' && !f.asked && state.tick >= (f.joinUntil ?? 0)) closeCommittee(state, f);
  if (f && (f.status === 'comision' || f.status === 'aprobada') && d.month === SEASONS.month[f.season] && d.day === SEASONS.day[f.season]) {
    if (!f.asked) closeCommittee(state, f);
    celebrate(state, f);
  }
  for (const s of FESTIVAL_SEASONS) {
    const m = SEASONS.month[s]! - 1;
    if (d.month === m && d.day === SEASONS.day[s]) openCommittee(state, s, d.year);
  }
}

/* ---------------- efectos ---------------- */

/** Ánimo de la fiesta de temporada que se acaba de celebrar (mientras se recuerda). */
export function seasonMood(state: GameState): { label: string; value: number } | null {
  const f = state.seasons?.current;
  if (!f || f.status !== 'celebrada' || f.mood === undefined || (f.until ?? 0) <= state.tick) return null;
  const label = f.season === 'patronales' ? `Fiestas de ${state.festival.name ?? 'el pueblo'}` : f.season === 'navidad' ? 'Navidad en el pueblo (luces y belén)' : SEASON_NAMES[f.season];
  return { label, value: f.mood };
}

/** Ruido de las fiestas cerca del ayuntamiento los primeros días. */
export function seasonNoise(state: GameState, home: Building | undefined): { label: string; value: number } | null {
  const f = state.seasons?.current;
  if (!home || !f || f.status !== 'celebrada' || !f.noise || f.day === undefined || state.tick - f.day > SEASONS.noiseDays * TICKS_PER_DAY) return null;
  const hall = state.buildings.find((b) => b.kind === 'townhall');
  if (!hall || Math.abs(hall.x - home.x) + Math.abs(hall.y - home.y) > SEASONS.noiseRadius) return null;
  return { label: 'Ruido de las fiestas', value: -f.noise };
}
