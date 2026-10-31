/**
 * 2.1: encargos del pueblo. Hasta 3 a la vez, salidos del estado real (un
 * servicio que falta junto a la casa de un vecino, parados, delincuencia en su
 * calle, felicidad, deudas). El alcalde promete, aplaza o dice que no; si
 * cumple a tiempo, hay recompensa y medalla y el vecino lo recuerda. En Modo
 * IA, el director elige uno y escribe la carta con la que lo pide.
 */
import { TICKS_PER_DAY } from '@bitopolis/shared';
import { ERRANDS } from './balance.ts';
import { directorOwns } from './director-core.ts';
import { coverageCtx, missingServices, NEED_KINDS, NEED_LABEL, type NeedKey } from './coverage.ts';
import { totalDebt } from './household.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { addMemory } from './social.ts';
import { type Citizen, type GameState, pushEvent } from './state.ts';
import { isUnlocked } from './townhall.ts';

export const ERRAND_KINDS = ['servicio', 'paro', 'delincuencia', 'felicidad', 'deudas'] as const;
export type ErrandKind = (typeof ERRAND_KINDS)[number];

export interface Errand {
  id: number;
  /** «tipo:dato» (p. ej. «servicio:colegio_12»): el mismo id que ve el director. */
  key: string;
  kind: ErrandKind;
  /** Vecino que lo pide (0 si es el pueblo). */
  by: number;
  text: string;
  /** Carta con la que lo pide (la escribe la IA del director; si no, la plantilla). */
  story?: string;
  status: 'ofrecido' | 'aceptado';
  /** Hasta cuándo se puede responder (ofrecido) o cumplir (aceptado). */
  until: number;
  postponed?: boolean;
  reward: number;
  /** Meta numérica (según el tipo). */
  target: number;
}

export interface ErrandsState {
  list: Errand[];
  /** Encargos recientes (para no repetirlos en 60 días). */
  recent: { key: string; tick: number }[];
  medals: number;
  done: number;
  failed: number;
  nextOffer: number;
}

export interface ErrandCandidate {
  key: string;
  kind: ErrandKind;
  by: number;
  text: string;
  target: number;
  reward: number;
}

export function emptyErrands(tick = 0): ErrandsState {
  return { list: [], recent: [], medals: 0, done: 0, failed: 0, nextOffer: tick + ERRANDS.firstOfferDays * TICKS_PER_DAY };
}

const first = (c: Citizen) => c.name.split(' ')[0]!;
const crimeAt = (state: GameState, x: number, y: number) => state.fields.crime[y * state.map.w + x] ?? 0;
const jobless = (state: GameState) => state.citizens.filter((c) => c.jobId === null && c.unemployedSince !== undefined).length;
const debtors = (state: GameState) => state.citizens.filter((c) => totalDebt(c) > 0).length;
const avgHappy = (state: GameState) => (state.citizens.length ? state.citizens.reduce((a, c) => a + c.happiness, 0) / state.citizens.length : 0);
const SERVICE_KEYS: NeedKey[] = ['colegio', 'salud', 'policia', 'ocio'];
const WANT: Partial<Record<NeedKey, string>> = { colegio: 'un colegio', salud: 'un centro de salud', policia: 'una comisaría', ocio: 'un parque o una plaza' };

/** Encargos posibles ahora mismo (deterministas; sin los que ya están o se hicieron hace poco). */
export function errandCandidates(state: GameState): ErrandCandidate[] {
  const es = state.errands;
  if (!es || state.citizens.length < ERRANDS.minPop) return [];
  const busy = new Set([...es.list.map((e) => e.key), ...es.recent.filter((r) => state.tick - r.tick < ERRANDS.repeatDays * TICKS_PER_DAY).map((r) => r.key)]);
  const kindsBusy = new Set(es.list.map((e) => e.kind));
  const out: ErrandCandidate[] = [];
  const named = state.citizens.filter((c) => c.named);
  const ctx = coverageCtx(state);
  // Un servicio que falta junto a la casa de un vecino y que ya se puede construir.
  for (const c of named) {
    const home = state.buildings.find((b) => b.id === c.homeId);
    if (!home) continue;
    const miss = missingServices(state, home.x, home.y, ctx).find((m) => m.status === 'falta' && SERVICE_KEYS.includes(m.key) && isUnlocked(state, NEED_KINDS[m.key][0] as never));
    if (!miss) continue;
    const key = `servicio:${miss.key}_${c.id}`;
    if (busy.has(key) || out.some((o) => o.key.startsWith(`servicio:${miss.key}_`))) continue;
    out.push({ key, kind: 'servicio', by: c.id, text: `${first(c)} quiere ${WANT[miss.key] ?? NEED_LABEL[miss.key]} cerca de casa`, target: c.id, reward: ERRANDS.reward.servicio });
    if (out.filter((o) => o.kind === 'servicio').length >= 2) break;
  }
  const j = jobless(state);
  if (j >= ERRANDS.minJobless && !kindsBusy.has('paro') && !busy.has('paro:pueblo')) {
    const by = named.find((c) => c.jobId === null) ?? named[0];
    if (by) out.push({ key: 'paro:pueblo', kind: 'paro', by: by.id, text: `Que ${ERRANDS.jobsWanted} parados encuentren trabajo`, target: Math.max(0, j - ERRANDS.jobsWanted), reward: ERRANDS.reward.paro });
  }
  if (!kindsBusy.has('delincuencia')) {
    const c = named
      .filter((x) => {
        const h = state.buildings.find((b) => b.id === x.homeId);
        return h && crimeAt(state, h.x, h.y) >= ERRANDS.crimeFrom;
      })
      .sort((a, b) => a.id - b.id)[0];
    if (c && !busy.has(`delincuencia:${c.id}`)) out.push({ key: `delincuencia:${c.id}`, kind: 'delincuencia', by: c.id, text: `${first(c)} quiere poder volver tranquilo a casa: baja la delincuencia de su calle`, target: ERRANDS.crimeTo, reward: ERRANDS.reward.delincuencia });
  }
  const h = avgHappy(state);
  if (h < ERRANDS.happyBelow && !kindsBusy.has('felicidad') && !busy.has('felicidad:pueblo')) {
    const by = [...named].sort((a, b) => a.happiness - b.happiness || a.id - b.id)[0];
    if (by) out.push({ key: 'felicidad:pueblo', kind: 'felicidad', by: by.id, text: `Que el pueblo esté más contento (felicidad media de ${Math.round(h) + ERRANDS.happyGain})`, target: Math.round(h) + ERRANDS.happyGain, reward: ERRANDS.reward.felicidad });
  }
  const d = debtors(state);
  if (d >= ERRANDS.minDebtors && !kindsBusy.has('deudas') && !busy.has('deudas:pueblo')) {
    const by = named.find((c) => totalDebt(c) > 0) ?? named[0];
    if (by) out.push({ key: 'deudas:pueblo', kind: 'deudas', by: by.id, text: `Que ${ERRANDS.debtsWanted} vecinos salgan de deudas`, target: Math.max(0, d - ERRANDS.debtsWanted), reward: ERRANDS.reward.deudas });
  }
  return out;
}

/** ¿Se ha cumplido? */
function met(state: GameState, e: Errand): boolean {
  switch (e.kind) {
    case 'servicio': {
      const need = e.key.slice(e.key.indexOf(':') + 1).split('_')[0] as NeedKey;
      const c = state.citizens.find((x) => x.id === e.target);
      const home = c && state.buildings.find((b) => b.id === c.homeId);
      return !!home && !missingServices(state, home.x, home.y).some((m) => m.key === need && m.status === 'falta');
    }
    case 'paro':
      return jobless(state) <= e.target;
    case 'delincuencia': {
      const c = state.citizens.find((x) => x.id === e.by);
      const home = c && state.buildings.find((b) => b.id === c.homeId);
      return !!home && crimeAt(state, home.x, home.y) <= e.target;
    }
    case 'felicidad':
      return avgHappy(state) >= e.target;
    case 'deudas':
      return debtors(state) <= e.target;
  }
}

/** Ofrece un encargo (de las reglas o del director, con su carta). */
export function offerErrand(state: GameState, key: string, story?: string): Errand | null {
  const es = state.errands;
  if (!es) return null;
  const c = errandCandidates(state).find((x) => x.key === key);
  if (!c) return null;
  if (es.list.length >= ERRANDS.max) {
    // El del director (con historia) ocupa el sitio del ofrecido más antiguo sin historia.
    const old = es.list.find((e) => e.status === 'ofrecido' && !e.story);
    if (!story || !old) return null;
    es.list = es.list.filter((e) => e !== old);
  }
  const e: Errand = { id: state.nextId++, ...c, status: 'ofrecido', until: state.tick + ERRANDS.answerDays * TICKS_PER_DAY, ...(story ? { story } : {}) };
  es.list.push(e);
  const who = state.citizens.find((x) => x.id === c.by);
  pushEvent(state, 'info', `Encargo del pueblo: ${c.text} (Pueblo › Objetivos)`, who ? { ref: who.id } : {});
  return e;
}

/** Responder a un encargo ofrecido. */
export function canAnswerErrand(state: GameState, id: number, answer: string): { ok: true } | { ok: false; error: string } {
  const e = state.errands?.list.find((x) => x.id === id);
  if (!e) return { ok: false, error: 'Ese encargo ya no está' };
  if (e.status !== 'ofrecido') return { ok: false, error: 'Ya lo prometiste' };
  if (answer === 'mas_tarde' && e.postponed) return { ok: false, error: 'Ya lo aplazaste una vez' };
  return { ok: true };
}

export function answerErrand(state: GameState, id: number, answer: 'aceptar' | 'mas_tarde' | 'rechazar'): void {
  const es = state.errands!;
  const e = es.list.find((x) => x.id === id)!;
  const who = state.citizens.find((x) => x.id === e.by);
  if (answer === 'aceptar') {
    e.status = 'aceptado';
    e.until = state.tick + ERRANDS.days * TICKS_PER_DAY;
    if (who) addMemory(state, who, 'hablo_con_alcalde', 3, 2);
    pushEvent(state, 'info', `Prometes: ${e.text}. Tienes ${ERRANDS.days} días`, who ? { ref: who.id } : {});
  } else if (answer === 'mas_tarde') {
    e.postponed = true;
    e.until += ERRANDS.postponeDays * TICKS_PER_DAY;
  } else {
    es.list = es.list.filter((x) => x !== e);
    es.recent.push({ key: e.key, tick: state.tick });
    if (who) {
      addMemory(state, who, 'peticion_rechazada', 3, -2);
      who.grudge = Math.min(40, who.grudge + 2);
    }
  }
}

/** Cada día: encargos cumplidos, vencidos y, cada semana, nuevos (por reglas). */
export function errandsDay(state: GameState): void {
  const es = state.errands;
  if (!es) return;
  for (const e of [...es.list]) {
    const who = state.citizens.find((x) => x.id === e.by);
    if (e.status === 'aceptado' && met(state, e)) {
      es.list = es.list.filter((x) => x !== e);
      es.recent.push({ key: e.key, tick: state.tick });
      const paid = transfer(state, OUTSIDE, TREASURY, e.reward, 'encargo');
      es.medals++;
      es.done++;
      if (who) {
        addMemory(state, who, 'promesa_cumplida', 4, 4);
        who.grudge = Math.max(0, who.grudge - 3);
        who.attitude = Math.min(2, (who.attitude ?? 0) + 1);
      }
      pushEvent(state, 'milestone', `Encargo cumplido: ${e.text}. ${who ? `${first(who)} te lo agradece. ` : ''}Recompensa: ${paid} € y una medalla`, who ? { ref: who.id } : {});
    } else if (state.tick >= e.until) {
      es.list = es.list.filter((x) => x !== e);
      es.recent.push({ key: e.key, tick: state.tick });
      if (e.status === 'aceptado') {
        es.failed++;
        if (who) {
          addMemory(state, who, 'promesa_rota', 4, -4);
          who.grudge = Math.min(40, who.grudge + 4);
        }
        pushEvent(state, 'warning', `No cumpliste el encargo: ${e.text}${who ? `. ${first(who)} se acordará` : ''}`, who ? { ref: who.id } : {});
      }
    }
  }
  es.recent = es.recent.filter((r) => state.tick - r.tick < ERRANDS.repeatDays * TICKS_PER_DAY);
  if (state.tick < es.nextOffer) return;
  es.nextOffer = state.tick + ERRANDS.offerEveryDays * TICKS_PER_DAY;
  // Las reglas llenan; con director (Modo IA) dejan un hueco para el encargo con carta.
  const limit = directorOwns(state) ? ERRANDS.max - 1 : ERRANDS.max;
  for (const c of errandCandidates(state)) {
    if (es.list.length >= limit) break;
    offerErrand(state, c.key);
  }
}
