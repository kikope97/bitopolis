/**
 * 2.1: «El Eco de Bitópolis», el periódico semanal. Tres titulares (sucesos,
 * cartas al director y anuncios) sacados de lo que ha pasado de verdad. En
 * Modo IA los escribe el director; si no, plantillas. El alcalde puede
 * contestar una vez por edición con un menú cerrado (nunca texto libre).
 */
import { TICKS_PER_DAY } from '@bitopolis/shared';
import { PRESS } from './balance.ts';
import { answerErrand } from './errands.ts';
import { addMemory } from './social.ts';
import { type GameEvent, type GameState, pushEvent } from './state.ts';

export const PRESS_SECTIONS = ['sucesos', 'cartas', 'anuncios'] as const;
export type PressSection = (typeof PRESS_SECTIONS)[number];
export const PRESS_ANSWERS = ['agradecer', 'desmentir', 'prometer'] as const;
export type PressAnswer = (typeof PRESS_ANSWERS)[number];

export interface Headline {
  section: PressSection;
  text: string;
  /** Vecino o edificio del que habla (para «Ver en el mapa»). */
  ref?: number;
}

export interface Edition {
  n: number;
  tick: number;
  source: 'ia' | 'reglas';
  headlines: Headline[];
  answered?: PressAnswer;
}

export interface PressState {
  editions: Edition[];
  last: number;
}

export const emptyPress = (): PressState => ({ editions: [], last: 0 });

const SECTION_OF: Partial<Record<GameEvent['kind'], PressSection>> = {
  crime: 'sucesos',
  protest: 'sucesos',
  departure: 'sucesos',
  warning: 'sucesos',
  bankrupt: 'sucesos',
  politics: 'cartas',
  decision: 'cartas',
  election: 'anuncios',
  built: 'anuncios',
  milestone: 'anuncios',
  business: 'anuncios',
  arrival: 'anuncios',
};
const PRIORITY: GameEvent['kind'][] = ['election', 'protest', 'crime', 'bankrupt', 'milestone', 'politics', 'departure', 'business', 'built', 'warning', 'decision', 'arrival'];

/** Noticias de la semana (para las plantillas y para el director, con su id «nX»). */
export function weekNews(state: GameState): { id: string; section: PressSection; text: string; ref?: number }[] {
  const since = state.tick - PRESS.everyDays * TICKS_PER_DAY;
  const seen = new Set<string>();
  const out: { id: string; section: PressSection; text: string; ref?: number }[] = [];
  const evs = state.events.filter((e) => e.tick >= since && SECTION_OF[e.kind]);
  for (const kind of PRIORITY) {
    for (const e of evs) {
      if (e.kind !== kind) continue;
      // Una noticia por texto (las repetidas no salen dos veces).
      const k = e.text.replace(/\d+/g, '#');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ id: `n${out.length + 1}`, section: SECTION_OF[e.kind]!, text: e.text, ...(e.ref !== undefined ? { ref: e.ref } : {}) });
      if (out.length >= 10) return out;
    }
  }
  return out;
}

/** Titulares por plantilla: el primero de cada sección (o lo que haya), sin repetir lo de las 2 ediciones anteriores. */
function ruleHeadlines(state: GameState): Headline[] {
  const tpl = (t: string) => t.replace(/\d+/g, '#');
  const recent = new Set((state.press?.editions.slice(-2) ?? []).flatMap((e) => e.headlines.map((h) => tpl(h.text))));
  const news = weekNews(state).filter((n) => !recent.has(tpl(n.text)));
  const out: Headline[] = [];
  for (const sec of PRESS_SECTIONS) {
    const n = news.find((x) => x.section === sec);
    if (n) out.push({ section: sec, text: n.text, ...(n.ref !== undefined ? { ref: n.ref } : {}) });
  }
  // Cartas: si no hubo nada político, un encargo pendiente del pueblo.
  if (!out.some((h) => h.section === 'cartas')) {
    const e = state.errands?.list.find((x) => x.status === 'ofrecido');
    if (e && !recent.has(tpl(`Carta al director: ${e.text}`))) out.push({ section: 'cartas', text: `Carta al director: ${e.text}`, ref: e.by || undefined });
  }
  // Anuncios: si no hubo obras ni llegadas, algo distinto cada semana (ronda 17: antes siempre «Semana tranquila»).
  if (!out.some((h) => h.section === 'anuncios')) {
    const n = state.citizens.length;
    const happy = n ? Math.round(state.citizens.reduce((a, c) => a + c.happiness, 0) / n) : 0;
    const shop = state.buildings.filter((b) => b.kind === 'shop' && b.built && (b.books?.sales ?? 0) > 0).sort((a, b) => (b.books?.sales ?? 0) - (a.books?.sales ?? 0) || a.id - b.id)[0];
    const oldest = [...state.citizens].filter((c) => c.named).sort((a, b) => b.age - a.age || a.id - b.id)[0];
    const pending = state.errands?.list.filter((e) => e.status === 'aceptado').length ?? 0;
    const fillers = [
      `El pueblo sigue con ${n} vecinos y felicidad ${happy}`,
      ...(shop ? [`${shop.name ?? 'Una tienda'} es la que más vende del pueblo este mes`] : []),
      ...(oldest ? [`${oldest.name}, con ${oldest.age} años, es la persona mayor del pueblo`] : []),
      ...(pending ? [`El alcalde tiene ${pending} ${pending === 1 ? 'encargo prometido' : 'encargos prometidos'} por cumplir`] : []),
    ].filter((t) => !recent.has(tpl(t)));
    const ed = (state.press?.editions.at(-1)?.n ?? 0) + 1;
    out.push({ section: 'anuncios', text: fillers.length ? fillers[ed % fillers.length]! : 'Semana tranquila en el pueblo' });
  }
  return out.slice(0, 3);
}

export function publishEdition(state: GameState, headlines: Headline[], source: 'ia' | 'reglas'): Edition | null {
  const p = state.press;
  if (!p || !headlines.length) return null;
  const ed: Edition = { n: (p.editions.at(-1)?.n ?? 0) + 1, tick: state.tick, source, headlines: headlines.slice(0, 3) };
  p.editions.push(ed);
  if (p.editions.length > PRESS.keep) p.editions.splice(0, p.editions.length - PRESS.keep);
  p.last = state.tick;
  pushEvent(state, 'info', `Sale El Eco de Bitópolis: «${ed.headlines[0]!.text}» (Pueblo › El Eco)`);
  return ed;
}

/** Cada día: si en una semana no ha salido el periódico (con la IA), sale por plantillas. */
export function pressDay(state: GameState): void {
  const p = state.press;
  if (!p || state.citizens.length === 0 || state.tick % TICKS_PER_DAY !== 0) return;
  if (state.tick - p.last < PRESS.everyDays * TICKS_PER_DAY) return;
  publishEdition(state, ruleHeadlines(state), 'reglas');
}

export function canAnswerPress(state: GameState, n: number, answer: string): { ok: true } | { ok: false; error: string } {
  const ed = state.press?.editions.find((e) => e.n === n);
  if (!ed) return { ok: false, error: 'Esa edición ya no está' };
  if (ed !== state.press!.editions.at(-1)) return { ok: false, error: 'Solo se contesta a la última edición' };
  if (ed.answered) return { ok: false, error: 'Ya contestaste en esta edición' };
  if (!(PRESS_ANSWERS as readonly string[]).includes(answer)) return { ok: false, error: 'Respuesta no válida' };
  if (answer === 'prometer' && !state.errands?.list.some((e) => e.status === 'ofrecido')) return { ok: false, error: 'No hay ningún encargo que prometer' };
  return { ok: true };
}

/** La respuesta del alcalde en el periódico: efectos pequeños y deterministas. */
export function answerPress(state: GameState, n: number, answer: PressAnswer): void {
  const ed = state.press!.editions.find((e) => e.n === n)!;
  ed.answered = answer;
  const named = state.citizens.filter((c) => c.named);
  if (answer === 'agradecer') {
    // A quien ya le apoya le gusta; a quien no, le parece propaganda.
    const fans = named.filter((c) => (c.attitude ?? 0) >= 0).slice(0, PRESS.reach);
    for (const c of fans) c.grudge = Math.max(0, c.grudge - 1);
    pushEvent(state, 'info', `El alcalde da las gracias al pueblo en El Eco. Lo agradecen ${fans.length} vecinos`);
    return;
  }
  if (answer === 'desmentir') {
    const rumor = ed.headlines.some((h) => /rumor|se comenta|dicen que/i.test(h.text));
    const reach = [...named].sort((a, b) => b.grudge - a.grudge || a.id - b.id).slice(0, PRESS.reach);
    for (const c of reach) {
      if (rumor) c.grudge = Math.max(0, c.grudge - 2);
      else c.grudge = Math.min(40, c.grudge + 1);
      addMemory(state, c, 'rumor', 2, rumor ? 1 : -1);
    }
    pushEvent(state, 'info', rumor ? 'El alcalde desmiente el rumor en El Eco: más de uno se queda más tranquilo' : 'El alcalde desmiente algo que nadie había dicho: en el bar se ríen');
    return;
  }
  // prometer: el primer encargo ofrecido pasa a prometido.
  const e = state.errands!.list.find((x) => x.status === 'ofrecido')!;
  answerErrand(state, e.id, 'aceptar');
}
