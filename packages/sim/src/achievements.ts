import { ruralShare } from './tourism.ts';
import { TICKS_PER_MONTH } from '@bitopolis/shared';
import type { LandmarkKind, ScenarioId } from '@bitopolis/shared';
import { addMoment } from './album.ts';
import { ACHIEVEMENTS, RANKS, TOURISM } from './balance.ts';
import { fmt, totalOwed } from './loans.ts';
import { ownIncome } from './money.ts';
import { type GameState, type MedalTrack, type MinAvgMax, type RecordKey, pushEvent } from './state.ts';

/**
 * 2.3: historia por años (`state.history`), récords (`state.records`) y
 * logros y medallas (`state.medals`). Umbrales en `ACHIEVEMENTS` (balance.ts);
 * la lista de logros con su comprobación va en `ACHIEVEMENT_LIST`.
 *
 * Todo por reglas (cero tokens de IA). Las medallas no dan dinero (eso sigue
 * en `OBJECTIVES`); las de oro dejan un momento en el álbum. Los encargos de la
 * 2.1 (`errands.medals`, un contador) salen aquí como un logro por tramos.
 */

export type AchievementTier = 'bronce' | 'plata' | 'oro';
export type AchievementGroup = 'crecimiento' | 'dinero' | 'obras' | 'gente' | 'politica' | 'desgracias' | 'escenarios' | 'turismo' | 'encargos';

export interface Achievement {
  id: string;
  /** Lo que se consiguió (se enseña al tenerla). */
  text: string;
  tier: AchievementTier;
  group: AchievementGroup;
  /** Qué hace falta (se enseña mientras falta). */
  hint: string;
  check: (state: GameState) => boolean;
  /** Cómo va (para la pista: «3 de 10»). */
  progress?: (state: GameState) => [number, number];
}

export const ACHIEVEMENT_GROUPS: Record<AchievementGroup, string> = {
  crecimiento: 'Crecimiento',
  dinero: 'Dinero',
  obras: 'Obras',
  gente: 'Gente',
  politica: 'Política',
  desgracias: 'Desgracias',
  escenarios: 'Escenarios',
  turismo: 'Turismo',
  encargos: 'Encargos',
};

const A = ACHIEVEMENTS;

// ——— Lo que miden los logros (exportado para la interfaz y los tests) ———

/** Meses cerrados seguidos (hasta hoy) sin préstamos ni caja en negativo, y sin vivir de lo prestado. */
export function debtFreeMonths(state: GameState): number {
  if ((state.loans ?? []).length) return 0;
  let n = 0;
  for (let i = state.stats.length - 1; i >= 0; i--) {
    const m = state.stats[i]!;
    const bd = m.breakdown ?? {};
    if (m.treasury < 0 || bd['préstamo'] || bd['préstamos'] || bd['intereses'] || ownIncome(m) < m.income) break;
    n++;
  }
  return n;
}

export const couples = (state: GameState): number => state.citizens.reduce((a, c) => a + (c.relations.some((r) => r.kind === 'pareja') ? 1 : 0), 0) >> 1;
export const owners = (state: GameState): number => state.citizens.reduce((a, c) => a + (c.owns ? 1 : 0), 0);
export const debtors = (state: GameState): number => state.citizens.reduce((a, c) => a + ((c.debt?.town ?? 0) + (c.debt?.bank ?? 0) > 0 ? 1 : 0), 0);

function parentsOf(state: GameState, id: number): number[] {
  return state.citizens.find((x) => x.id === id)?.parents ?? state.departed?.find((x) => x.id === id)?.parents ?? [];
}

/** Generaciones de la familia más larga con alguien vivo en el pueblo (1 sin padres conocidos). */
export function generations(state: GameState): number {
  let best = state.citizens.length ? 1 : 0;
  for (const c of state.citizens) {
    if (!c.parents?.length) continue;
    // Hasta 4 (más no hace falta): hijo → padres → abuelos → bisabuelos.
    let level = [c.id];
    let n = 1;
    while (n < 4) {
      const up = level.flatMap((id) => parentsOf(state, id)).filter((id) => state.citizens.some((x) => x.id === id) || state.departed?.some((x) => x.id === id));
      if (!up.length) break;
      level = up;
      n++;
    }
    best = Math.max(best, n);
  }
  return best;
}

/** Elecciones ganadas con rival (2.3, F3: sin oposición contaban y la medalla de oro llegaba sola a los 8 años). */
export const reelections = (state: GameState): number => state.politics.history.filter((e) => e.winner === 'player' && !e.unopposed).length;

/** Caja sin lo que se debe al banco. */
const ownCash = (state: GameState): number => state.treasury - totalOwed(state);


const landmarkDone = (state: GameState, kind: LandmarkKind) => (state.landmarks ?? []).some((l) => l.kind === kind && l.phase >= l.phases);
const scenarioWon = (state: GameState, id: ScenarioId) => state.scenario?.id === id && state.scenario.won === true;
const track = (state: GameState): MedalTrack => (state.medalTrack ??= {});

const LANDMARK_TEXT: Record<LandmarkKind, [string, AchievementTier]> = {
  bridge: ['el puente de piedra', 'bronce'],
  station: ['la estación de tren', 'plata'],
  fair: ['la feria regional', 'plata'],
  stadium: ['el estadio', 'oro'],
  cathedral: ['la catedral', 'oro'],
};

const POP_TIER: AchievementTier[] = ['bronce', 'plata', 'plata', 'oro'];
const RANK_TIER: AchievementTier[] = ['bronce', 'bronce', 'bronce', 'plata', 'oro'];
const ERRAND_TIER: AchievementTier[] = ['bronce', 'plata', 'oro'];

export const ACHIEVEMENT_LIST: Achievement[] = [
  // Crecimiento
  ...A.population.map(
    (n, i): Achievement => ({
      id: `vecinos_${n}`,
      text: `${n} vecinos en el pueblo`,
      tier: POP_TIER[i]!,
      group: 'crecimiento',
      hint: `Llega a ${n} vecinos`,
      check: (s) => s.citizens.length >= n,
      progress: (s) => [s.citizens.length, n],
    }),
  ),
  ...RANKS.map(
    (r, i): Achievement => ({
      id: `rango_${r.id}`,
      text: i === 0 ? 'Bitópolis nace como aldea' : `Bitópolis ya es ${r.name.toLowerCase()}`,
      tier: RANK_TIER[i]!,
      group: 'crecimiento',
      hint: i === 0 ? 'Cierra el primer mes con vecinos' : `Llega al rango de ${r.name.toLowerCase()} (${r.pop} vecinos y ayuntamiento ${r.townhall})`,
      check: (s) => (i === 0 ? s.citizens.length > 0 && s.stats.length > 0 : (s.rank?.level ?? 0) >= i),
    }),
  ),
  // Dinero
  {
    id: 'sin_deuda',
    text: `${A.noDebtYears} años sin deber nada`,
    tier: 'plata',
    group: 'dinero',
    hint: `Pasa ${A.noDebtYears} años sin préstamos ni caja en negativo`,
    check: (s) => debtFreeMonths(s) >= A.noDebtYears * 12,
    progress: (s) => [Math.min(debtFreeMonths(s), A.noDebtYears * 12), A.noDebtYears * 12],
  },
  {
    id: 'caja_100k',
    text: `${fmt(A.treasury)} € en la caja`,
    tier: 'oro',
    group: 'dinero',
    hint: `Ten ${fmt(A.treasury)} € en la caja al cerrar un mes (sin contar lo que debes al banco)`,
    // 2.3 (F3): lo prestado no cuenta (el perfil endeudado la ganaba al año pidiendo todo lo que le dejaban).
    check: (s) => ownCash(s) >= A.treasury,
    progress: (s) => [Math.max(0, Math.min(ownCash(s), A.treasury)), A.treasury],
  },
  {
    id: 'nota_a',
    text: 'Nota A con un préstamo vivo',
    tier: 'plata',
    group: 'dinero',
    hint: 'Pide un préstamo y mantén la nota A',
    check: (s) => s.rating === 'A' && (s.loans ?? []).some((l) => l.kind === 'banco'),
  },
  // Obras
  ...(Object.keys(LANDMARK_TEXT) as LandmarkKind[]).map(
    (k): Achievement => ({
      id: `obra_${k}`,
      text: `Terminada ${LANDMARK_TEXT[k][0]}`,
      tier: LANDMARK_TEXT[k][1],
      group: 'obras',
      hint: `Termina todas las fases de ${LANDMARK_TEXT[k][0]}`,
      check: (s) => landmarkDone(s, k),
    }),
  ),
  {
    id: 'obra_sin_parar',
    text: 'Una gran obra de un tirón',
    tier: 'plata',
    group: 'obras',
    hint: 'Termina una gran obra sin pararla nunca',
    check: (s) => (s.landmarks ?? []).some((l) => l.phase >= l.phases && !(s.medalTrack?.paused ?? []).includes(l.id)),
  },
  {
    id: 'patrimonio',
    text: 'El patrimonio del pueblo, restaurado',
    tier: 'plata',
    group: 'obras',
    hint: 'Construye el patrimonio del pueblo',
    check: (s) => s.buildings.some((b) => b.kind === 'heritage' && b.built),
  },
  // Gente
  {
    id: 'generaciones',
    text: `${A.generations} generaciones de una familia en el pueblo`,
    tier: 'oro',
    group: 'gente',
    hint: `Que una familia llegue a ${A.generations} generaciones (abuelos, hijos y nietos)`,
    check: (s) => generations(s) >= A.generations,
    progress: (s) => [Math.min(generations(s), A.generations), A.generations],
  },
  {
    id: 'parejas',
    text: `${A.couples} parejas en el pueblo`,
    tier: 'plata',
    group: 'gente',
    hint: `Que haya ${A.couples} parejas a la vez (el bar ayuda)`,
    check: (s) => couples(s) >= A.couples,
    progress: (s) => [Math.min(couples(s), A.couples), A.couples],
  },
  {
    id: 'propietarios',
    text: `${A.owners} vecinos con casa propia`,
    tier: 'plata',
    group: 'gente',
    hint: `Que ${A.owners} vecinos tengan casa en propiedad`,
    check: (s) => owners(s) >= A.owners,
    progress: (s) => [Math.min(owners(s), A.owners), A.owners],
  },
  {
    id: 'sin_deudores',
    text: 'Nadie debe nada en el pueblo',
    tier: 'plata',
    group: 'gente',
    hint: `Con ${A.noDebtorsPop} vecinos o más, que ninguno tenga deudas`,
    check: (s) => s.citizens.length >= A.noDebtorsPop && debtors(s) === 0,
  },
  // Política
  {
    id: 'reelegido',
    text: `Ganas ${A.reelected} elecciones`,
    tier: 'oro',
    group: 'politica',
    hint: `Gana ${A.reelected} elecciones con rival`,
    check: (s) => reelections(s) >= A.reelected,
    progress: (s) => [Math.min(reelections(s), A.reelected), A.reelected],
  },
  {
    id: 'promesas',
    text: `${A.promises} promesas cumplidas`,
    tier: 'plata',
    group: 'politica',
    hint: `Cumple ${A.promises} promesas del pleno`,
    check: (s) => (s.medalTrack?.kept?.length ?? 0) >= A.promises,
    progress: (s) => [Math.min(s.medalTrack?.kept?.length ?? 0, A.promises), A.promises],
  },
  {
    id: 'presupuestos',
    text: `${A.budgetYears} presupuestos aprobados seguidos`,
    tier: 'oro',
    group: 'politica',
    hint: `Aprueba el presupuesto ${A.budgetYears} años seguidos`,
    check: (s) => (s.medalTrack?.budget?.streak ?? 0) >= A.budgetYears,
    progress: (s) => [Math.min(s.medalTrack?.budget?.streak ?? 0, A.budgetYears), A.budgetYears],
  },
  // Desgracias
  {
    id: 'riadas',
    text: `${A.floods} riadas superadas`,
    tier: 'plata',
    group: 'desgracias',
    hint: `Supera ${A.floods} riadas del río`,
    check: (s) => (s.emergencies?.floods ?? 0) >= A.floods,
    progress: (s) => [Math.min(s.emergencies?.floods ?? 0, A.floods), A.floods],
  },
  {
    id: 'crisis_sin_cierres',
    text: 'Una crisis comarcal sin cerrar ninguna empresa',
    tier: 'oro',
    group: 'desgracias',
    hint: `Pasa una crisis de la comarca sin que cierre ninguna empresa (con ${A.crisisMinBusinesses} o más)`,
    check: (s) => (s.medalTrack?.cleanCrises ?? 0) >= 1,
  },
  // Escenarios
  ...(
    [
      ['quiebra', 'Sacas de la quiebra al pueblo'],
      ['vaciado', 'El pueblo que se vaciaba vuelve a llenarse'],
      ['riada', 'El pueblo se levanta tras la riada'],
    ] as const
  ).map(
    ([id, text]): Achievement => ({
      id: `escenario_${id}`,
      text,
      tier: 'oro',
      group: 'escenarios',
      hint: `Cumple la meta del escenario «${id === 'quiebra' ? 'Pueblo en quiebra' : id === 'vaciado' ? 'El pueblo que se vacía' : 'Tras la riada'}»`,
      check: (s) => scenarioWon(s, id),
    }),
  ),
  // Turismo
  {
    id: 'visitantes',
    text: `${A.visitors} visitantes en un mes`,
    tier: 'plata',
    group: 'turismo',
    hint: `Recibe ${A.visitors} visitantes en un mes`,
    check: (s) => (s.tourism?.visitors ?? 0) >= A.visitors,
    progress: (s) => [Math.min(s.tourism?.visitors ?? 0, A.visitors), A.visitors],
  },
  {
    id: 'entorno_protegido',
    text: 'Entorno protegido y sin turistificar',
    tier: 'oro',
    group: 'turismo',
    hint: `Protege el entorno del patrimonio ${A.protectedMonths} meses sin pasar del ${Math.round(TOURISM.touristified.share * 100)} % de casas rurales`,
    check: (s) => (s.medalTrack?.protectedMonths ?? 0) >= A.protectedMonths,
    progress: (s) => [Math.min(s.medalTrack?.protectedMonths ?? 0, A.protectedMonths), A.protectedMonths],
  },
  // Encargos (2.1): el contador `errands.medals` por tramos.
  ...A.errands.map(
    (n, i): Achievement => ({
      id: `encargos_${n}`,
      text: n === 1 ? 'Primer encargo cumplido' : `${n} encargos cumplidos`,
      tier: ERRAND_TIER[i]!,
      group: 'encargos',
      hint: n === 1 ? 'Cumple un encargo del pueblo a tiempo' : `Cumple ${n} encargos del pueblo a tiempo`,
      check: (s) => (s.errands?.medals ?? 0) >= n,
      progress: (s) => [Math.min(s.errands?.medals ?? 0, n), n],
    }),
  ),
];

const BY_ID = new Map(ACHIEVEMENT_LIST.map((a) => [a.id, a]));
export const achievementById = (id: string): Achievement | undefined => BY_ID.get(id);

// ——— Historia y récords ———

const RECORD_TEXT: Record<RecordKey, (v: number) => string> = {
  population: (v) => `${v} vecinos`,
  treasury: (v) => `${fmt(v)} € en caja`,
  happiness: (v) => `felicidad ${v}`,
  businesses: (v) => `${v} empresas`,
  visitors: (v) => `${v} visitantes`,
  income: (v) => `${fmt(v)} € de ingresos en un mes`,
};
export const RECORD_KEYS = Object.keys(RECORD_TEXT) as RecordKey[];
export const recordText = (k: RecordKey, v: number): string => RECORD_TEXT[k](v);

const mam = (vals: number[]): MinAvgMax => ({ min: Math.min(...vals), avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), max: Math.max(...vals) });
/** Año (1, 2…) de un mes de `stats` (`month` cuenta los meses cerrados). */
export const yearOfMonth = (month: number): number => Math.floor((Math.max(1, month) - 1) / 12) + 1;

/** Fin de mes (tras guardar `stats`): año en curso de `history` y récords nuevos. */
export function historyMonth(state: GameState): void {
  const last = state.stats.at(-1);
  if (!last) return;
  state.history ??= [];
  state.records ??= {};
  const year = yearOfMonth(last.month);
  const ms = state.stats.filter((m) => yearOfMonth(m.month) === year);
  const visitors = state.tourism?.visitors ?? 0;
  const prev = state.history.find((y) => y.year === year);
  // Los visitantes no están en `stats`: se acumulan sobre lo que ya había este año.
  const vis = prev && prev.months > 0 && prev.months < ms.length ? { min: Math.min(prev.visitors.min, visitors), avg: Math.round((prev.visitors.avg * prev.months + visitors) / (prev.months + 1)), max: Math.max(prev.visitors.max, visitors) } : { min: visitors, avg: visitors, max: visitors };
  const entry = {
    year,
    months: ms.length,
    population: mam(ms.map((m) => m.population)),
    treasury: mam(ms.map((m) => m.treasury)),
    happiness: mam(ms.map((m) => m.happiness)),
    jobless: mam(ms.map((m) => m.jobless ?? 0)),
    businesses: mam(ms.map((m) => m.businesses ?? 0)),
    visitors: vis,
  };
  if (prev) Object.assign(prev, entry);
  else {
    state.history.push(entry);
    state.history.sort((a, b) => a.year - b.year);
  }

  const now: Record<RecordKey, number> = {
    population: last.population,
    treasury: last.treasury,
    happiness: last.happiness,
    businesses: last.businesses ?? 0,
    visitors,
    income: ownIncome(last),
  };
  const notable: string[] = [];
  for (const k of RECORD_KEYS) {
    const v = now[k];
    const rec = state.records[k];
    if (rec && v <= rec.v) continue;
    if (!rec && v <= 0) continue;
    if (rec && v >= rec.v + Math.max(1, Math.round(Math.abs(rec.v) * A.recordMargin)) && rec.v > 0) notable.push(recordText(k, v));
    state.records[k] = { v, tick: state.tick };
  }
  const t = track(state);
  const gap = A.recordEveryMonths * TICKS_PER_MONTH;
  if (notable.length && last.month > A.recordAfterMonths && (t.lastRecord === undefined || state.tick - t.lastRecord >= gap)) {
    t.lastRecord = state.tick;
    pushEvent(state, 'info', `Récord del pueblo: ${notable.join(', ')}`);
  }
}

/** Para la crónica: los récords de este último mes («récord: 54 vecinos»), o null si no hay. */
export function newRecordLine(state: GameState): string | null {
  const since = state.tick - TICKS_PER_MONTH;
  const got = RECORD_KEYS.filter((k) => (state.records?.[k]?.tick ?? -1) > since && state.tick >= A.recordAfterMonths * TICKS_PER_MONTH);
  if (!got.length) return null;
  return `récord: ${got.map((k) => recordText(k, state.records[k]!.v)).join(', ')}`;
}

// ——— Medallas ———

/** Lo que hay que recordar de este mes (promesas, presupuesto, crisis, obras paradas, entorno). */
function trackMonth(state: GameState): void {
  const t = track(state);
  for (const p of state.promises ?? []) {
    if (p.status !== 'kept') continue;
    t.kept ??= [];
    if (t.kept.length < A.promises && !t.kept.includes(p.id)) t.kept.push(p.id);
  }
  const b = state.budget;
  if (b && b.status !== 'open' && t.budget?.year !== b.year) {
    t.budget = { year: b.year, streak: b.status === 'approved' ? (t.budget && t.budget.year === b.year - 1 ? t.budget.streak : 0) + 1 : 0 };
  }
  if (state.region?.phase === 'crisis') {
    t.crisis ??= { closures: 0 };
    t.crisis.closures += state.month.closures ?? 0;
  } else if (t.crisis) {
    if (t.crisis.closures === 0 && (state.stats.at(-1)?.businesses ?? 0) >= A.crisisMinBusinesses) t.cleanCrises = (t.cleanCrises ?? 0) + 1;
    t.crisis = null;
  }
  for (const l of state.landmarks ?? []) {
    if (l.paused && !(t.paused ??= []).includes(l.id)) t.paused.push(l.id);
  }
  if (state.tourism?.protectedId !== undefined && ruralShare(state) <= TOURISM.touristified.share) t.protectedMonths = (t.protectedMonths ?? 0) + 1;
  else if (t.protectedMonths) t.protectedMonths = 0;
}

/** La comprobación de un logro (un estado a medio migrar puede no tener todo: entonces, no). */
function passes(a: Achievement, state: GameState): boolean {
  try {
    return a.check(state);
  } catch {
    return false;
  }
}

/**
 * Da las medallas que ya se cumplen y devuelve las nuevas. `silent` (la
 * migración): sin avisos ni álbum.
 */
export function grantMedals(state: GameState, silent = false): string[] {
  state.medals ??= [];
  const have = new Set(state.medals.map((m) => m.id));
  const got: string[] = [];
  for (const a of ACHIEVEMENT_LIST) {
    if (have.has(a.id) || !passes(a, state)) continue;
    state.medals.push({ id: a.id, tick: state.tick });
    got.push(a.id);
  }
  if (silent || !got.length) return got;
  const hall = state.buildings.find((b) => b.kind === 'townhall') ?? { x: state.map.w >> 1, y: state.map.h >> 1 };
  for (const id of got) {
    const a = BY_ID.get(id)!;
    if (a.tier === 'oro') addMoment(state, `medalla_${id}`, `Medalla de oro: ${a.text}`, hall);
  }
  const first = BY_ID.get(got[0]!)!;
  pushEvent(state, 'milestone', got.length === 1 ? `Medalla de ${first.tier}: ${first.text}` : `${got.length} medallas nuevas: ${got.map((id) => BY_ID.get(id)!.text).join(' · ')}`);
  return got;
}

/**
 * Migración 15 → 16: las medallas que ya se tenían, en silencio (sin avisos
 * ni álbum). Las promesas cumplidas que aún se recuerdan cuentan.
 */
export function checkMedalsSilently(state: GameState): void {
  const kept = (state.promises ?? []).filter((p) => p.status === 'kept').map((p) => p.id).slice(0, A.promises);
  if (kept.length) track(state).kept = kept;
  grantMedals(state, true);
}

/** Fin de mes (tras `historyMonth` y los escenarios): medallas nuevas. */
export function achievementsMonth(state: GameState): void {
  trackMonth(state);
  grantMedals(state);
}
