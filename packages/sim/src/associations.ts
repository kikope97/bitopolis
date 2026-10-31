import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { ASSOCIATIONS } from './balance.ts';
import { coverageCtx, missingServices, type NeedKey } from './coverage.ts';
import { felt } from './economy.ts';
import { addMemory } from './social.ts';
import { type Citizen, type GameState, pushEvent } from './state.ts';

/**
 * v1.7: asociaciones vecinales y protestas. Cuando varios vecinos con nombre
 * comparten la misma queja, se organizan, piden una cosa concreta y, si nadie
 * les hace caso, se manifiestan ante el ayuntamiento. Todo determinista.
 */
export type Cause = NeedKey | 'ruido' | 'contaminacion' | 'inseguridad' | 'impuestos';
// Sin depender de otros módulos al cargar (hay importaciones circulares entre decisiones y asociaciones).
export const CAUSE_TEXT: Record<Cause, string> = {
  agua: 'agua',
  luz: 'luz',
  colegio: 'colegio',
  salud: 'centro de salud',
  policia: 'policía',
  ocio: 'parque o plaza',
  ruido: 'menos ruido',
  contaminacion: 'aire limpio',
  inseguridad: 'más seguridad',
  impuestos: 'impuestos más bajos',
};
/** Qué piden (una frase) y cómo se llaman. */
export const CAUSE_ASK: Record<Cause, string> = {
  agua: 'agua en sus casas',
  luz: 'luz en sus casas',
  colegio: 'un colegio cerca',
  salud: 'un centro de salud cerca',
  policia: 'una comisaría cerca',
  ocio: 'un parque o una plaza cerca',
  ruido: 'que baje el ruido del barrio',
  contaminacion: 'que se aleje la industria de las casas',
  inseguridad: 'policía en el barrio',
  impuestos: 'que bajen los impuestos',
};

export interface Association {
  id: number;
  name: string;
  cause: Cause;
  members: number[];
  leaderId: number;
  founded: number;
  /** Cuándo se manifestaron por última vez (o -1). */
  lastProtest: number;
  /** Día de la manifestación convocada (o -1). */
  protestDay: number;
  /** Promesa del alcalde: hasta cuándo tiene para cumplir (o -1). */
  promiseUntil: number;
  /** Última reunión con el alcalde (una al mes como mucho). */
  lastMeeting: number;
}

/** La queja principal de un vecino, si la tiene (lo que más le resta). */
export function grievanceOf(state: GameState, c: Citizen, ctx = coverageCtx(state)): Cause | null {
  const home = state.buildings.find((b) => b.id === c.homeId);
  if (!home) return null;
  const i = home.y * state.map.w + home.x;
  const scored: [Cause, number][] = [];
  for (const n of missingServices(state, home.x, home.y, ctx)) {
    if (n.status === 'falta') scored.push([n.key, n.key === 'agua' || n.key === 'luz' ? 12 : 5]);
  }
  const pol = state.fields.pollution[i] ?? 0;
  const noise = state.fields.noise[i] ?? 0;
  const crime = state.fields.crime[i] ?? 0;
  if (pol > 30) scored.push(['contaminacion', (pol - 20) / 5]);
  if (noise > 35) scored.push(['ruido', (noise - 25) / 6]);
  if (crime > 30) scored.push(['inseguridad', (crime - 20) / 5]);
  const lv = felt(state);
  if (lv.ibi === 'high' && lv.tasas === 'high') scored.push(['impuestos', 4 + c.grudge]);
  if (!scored.length) return null;
  scored.sort((a, b) => b[1] - a[1]);
  return scored[0]![0];
}

/** Cada mes: nacen asociaciones, se renuevan sus socios y, si consiguen lo que piden, lo celebran. */
export function associationsMonth(state: GameState): void {
  if (!state.associations || state.citizens.length < ASSOCIATIONS.minPop) return;
  const ctx = coverageCtx(state);
  const named = state.citizens.filter((c) => c.named);
  const byCause = new Map<Cause, Citizen[]>();
  for (const c of named) {
    const g = grievanceOf(state, c, ctx);
    if (!g) continue;
    byCause.set(g, [...(byCause.get(g) ?? []), c]);
  }
  // Las que ya existen: socios al día; si casi nadie sigue con la queja, celebran y se disuelven.
  for (const a of [...state.associations]) {
    const still = byCause.get(a.cause) ?? [];
    a.members = still.map((c) => c.id);
    if (still.length < ASSOCIATIONS.dissolveBelow) {
      const old = state.citizens.filter((c) => c.named && grievanceOf(state, c, ctx) !== a.cause);
      for (const c of old.slice(0, 6)) addMemory(state, c, 'logro_vecinal', 3, 3);
      pushEvent(state, 'politics', `La ${a.name} celebra que ya hay ${CAUSE_TEXT[a.cause]}. Se disuelve: misión cumplida`);
      state.associations = state.associations.filter((x) => x !== a);
      continue;
    }
    if (a.leaderId && !a.members.includes(a.leaderId)) a.leaderId = leaderOf(still).id;
    // Promesa vencida sin cumplir: se sienten engañados y salen a la calle.
    if (a.promiseUntil >= 0 && state.tick > a.promiseUntil) {
      a.promiseUntil = -1;
      for (const c of still) addMemory(state, c, 'promesa_rota', 4, -4);
      callProtest(state, a, true);
    } else if (
      a.protestDay < 0 &&
      a.promiseUntil < 0 &&
      // Tras una manifestación, esperan un mes más antes de la siguiente.
      state.tick - Math.max(a.founded, a.lastProtest, a.lastMeeting) >= (ASSOCIATIONS.patienceMonths + (a.lastProtest >= 0 ? 1 : 0)) * TICKS_PER_MONTH
    ) {
      callProtest(state, a, false);
    }
  }
  // Nuevas: una al mes como mucho, la de la queja más compartida.
  const fresh = [...byCause.entries()]
    .filter(([cause, cs]) => cs.length >= ASSOCIATIONS.minMembers && !state.associations.some((a) => a.cause === cause))
    .sort((a, b) => b[1].length - a[1].length)[0];
  if (fresh && state.associations.length < ASSOCIATIONS.max) {
    const [cause, cs] = fresh;
    const leader = leaderOf(cs);
    const a: Association = {
      id: state.nextId++,
      name: `Asociación de vecinos por ${CAUSE_TEXT[cause]}`,
      cause,
      members: cs.map((c) => c.id),
      leaderId: leader.id,
      founded: state.tick,
      lastProtest: -1,
      protestDay: -1,
      promiseUntil: -1,
      lastMeeting: -1,
    };
    state.associations.push(a);
    for (const c of cs) addMemory(state, c, 'asociacion', 3, 1);
    pushEvent(state, 'politics', `Nace la ${a.name}: ${cs.length} socios, con ${leader.name} al frente. Piden ${CAUSE_ASK[cause]} (Pueblo › Ayuntamiento)`, { ref: leader.id });
  }
}

function leaderOf(cs: Citizen[]): Citizen {
  return [...cs].sort((a, b) => b.traits.social - a.traits.social || a.id - b.id)[0]!;
}

/** Convoca una manifestación para dentro de unos días: cada socio decide si va (IA o reglas). */
function callProtest(state: GameState, a: Association, broken: boolean): void {
  a.protestDay = state.tick + ASSOCIATIONS.protestNoticeDays * TICKS_PER_DAY;
  pushEvent(
    state,
    'politics',
    `La ${a.name} convoca una manifestación ante el ayuntamiento en ${ASSOCIATIONS.protestNoticeDays} días${broken ? ': dicen que el alcalde no cumplió su promesa' : ''}. Piden ${CAUSE_ASK[a.cause]}`,
    { ref: a.leaderId },
  );
}

/** Cada día: el día de la manifestación se cuentan quienes van (los que decidieron «manifestarse»). */
export function associationsDay(state: GameState): void {
  for (const a of state.associations ?? []) {
    if (a.protestDay < 0 || state.tick < a.protestDay) continue;
    const marchers = state.citizens.filter((c) => a.members.includes(c.id) && c.protest === a.id);
    state.pending = state.pending.filter((p) => !(p.trigger === 'protesta' && a.members.includes(p.citizenId)));
    a.protestDay = -1;
    a.lastProtest = state.tick;
    for (const c of state.citizens) if (c.protest === a.id || c.protest === -a.id) delete c.protest;
    // Además de los socios con nombre, se suman vecinos anónimos del barrio.
    const crowd = marchers.length * 3 + Math.round(a.members.length * 1.5);
    for (const c of marchers) addMemory(state, c, 'se_manifesto', 4, -2);
    pushEvent(
      state,
      'protest',
      marchers.length
        ? `Manifestación ante el ayuntamiento: unas ${crowd} personas piden ${CAUSE_ASK[a.cause]}. Encabeza ${state.citizens.find((c) => c.id === a.leaderId)?.name ?? 'la asociación'}`
        : `La manifestación de la ${a.name} se queda en nada: casi nadie acude`,
      { ref: a.id },
    );
  }
}

/** ¿Puede el alcalde reunirse con la asociación? (una vez al mes) */
export function canMeetAssociation(state: GameState, id: number): { ok: true } | { ok: false; error: string } {
  const a = state.associations?.find((x) => x.id === id);
  if (!a) return { ok: false, error: 'Esa asociación ya no existe' };
  if (a.lastMeeting >= 0 && state.tick - a.lastMeeting < TICKS_PER_MONTH) return { ok: false, error: 'Ya os reunisteis este mes' };
  return { ok: true };
}

/**
 * Reunión con el alcalde: les promete solucionarlo en unos meses. Se calman
 * (y desconvocan la protesta), pero si no se cumple, vuelven más enfadados.
 */
export function meetAssociation(state: GameState, id: number): void {
  const a = state.associations.find((x) => x.id === id)!;
  a.lastMeeting = state.tick;
  a.promiseUntil = state.tick + ASSOCIATIONS.promiseMonths * TICKS_PER_MONTH;
  const called = a.protestDay >= 0;
  a.protestDay = -1;
  for (const c of state.citizens) {
    if (c.protest === a.id || c.protest === -a.id) delete c.protest;
    if (a.members.includes(c.id)) addMemory(state, c, 'hablo_con_alcalde', 2, 2);
  }
  state.pending = state.pending.filter((p) => !(p.trigger === 'protesta' && a.members.includes(p.citizenId)));
  pushEvent(
    state,
    'politics',
    `El alcalde se reúne con la ${a.name} y promete ${CAUSE_ASK[a.cause]} en ${ASSOCIATIONS.promiseMonths} meses${called ? '. Desconvocan la manifestación' : ''}`,
  );
}

/**
 * La asociación de la que es socio un vecino con una protesta convocada (para
 * su decisión). Solo deciden el líder y los primeros socios (como mucho
 * ASSOCIATIONS.deciders): así el diario no se llena y la IA no hace decenas de llamadas.
 */
export function protestFor(state: GameState, c: Citizen): Association | undefined {
  return state.associations?.find((a) => a.protestDay >= 0 && deciders(a).includes(c.id));
}
function deciders(a: Association): number[] {
  return [a.leaderId, ...a.members.filter((id) => id !== a.leaderId)].slice(0, ASSOCIATIONS.deciders);
}
