import { type Command, tickToDate } from '@bitopolis/shared';
import {
  activeDeal,
  fairHost,
  type GameState,
  type NeighborTown,
  OFFER_KINDS,
  OFFER_TEXT,
  offerEffect,
  PERSONALITY_TEXT,
  pullLeavers,
  relationText,
  SPECIALTY_TEXT,
  strongestPull,
  isFemaleName,
  ourAttract,
  townAttract,
  COMARCA,
} from '@bitopolis/sim';
import { formatDate } from './i18n.ts';
import { h, sheet, toast } from './ui.ts';

/**
 * 2.5 (bloques I y J): hoja «Comarca» (Pueblo › Comarca): una tarjeta por
 * pueblo vecino con su alcalde, la relación, lo último que dijo (✦ si lo dijo
 * la IA) y sus ofertas con Aceptar/Rechazar (≥ 44 px). Arriba, la feria
 * comarcal y si hay vecinos que se van a otro pueblo.
 */
export interface ComarcaCtx {
  state: () => GameState;
  command: (c: Command) => Promise<boolean>;
}

const FACTION: Record<string, string> = { jubilados: 'jubilados', jovenes: 'jóvenes', empresarios: 'empresarios', ecologistas: 'ecologistas' };
const SIZE = (n: number) => (n < 50 ? 'aldea muy pequeña' : n < 120 ? 'aldea' : n < 300 ? 'pueblo pequeño' : n < 800 ? 'pueblo' : 'pueblo grande');
const MOOD = (v: number) => (v < 40 ? 'descontentos' : v < 55 ? 'regular' : v < 70 ? 'contentos' : 'muy contentos');

/** Ofertas por responder (para el aviso del panel «Pueblo»). */
export function comarcaPending(state: GameState): number {
  return state.comarca?.offers.filter((o) => !o.resolved && o.until > state.tick).length ?? 0;
}

/** Resumen de una línea para la tarjeta «Comarca» del panel «Pueblo». */
export function comarcaSummary(state: GameState): string {
  const towns = state.comarca?.towns ?? [];
  if (!towns.length) return 'Los pueblos vecinos aparecen al cerrar el primer mes';
  const n = comarcaPending(state);
  const pull = strongestPull(state);
  const gone = pull ? pullLeavers(state) : 0;
  const away = gone > 0 ? ` · ${pull!.name} se lleva unos ${gone} vecinos al mes` : '';
  return (n ? `${n === 1 ? 'Una oferta' : `${n} ofertas`} de los pueblos vecinos por responder` : `${towns.length} pueblos vecinos`) + away;
}

function townCard(ctx: ComarcaCtx, state: GameState, t: NeighborTown): HTMLElement {
  const rel = relationText(t.relation);
  const card = h(
    'section',
    { class: 'hub-card comarca-town', 'data-town': String(t.id) },
    h('h3', {}, t.name),
    h('p', { class: 'hub-sum' }, `${SIZE(t.pop)} · vive ${SPECIALTY_TEXT[t.specialty].replace(/^el /, 'del ').replace(/^(la|los) /, 'de $1 ')} · vecinos ${MOOD(t.happiness)}`),
    h('p', {}, h('strong', {}, t.mayor.name), ` · ${isFemaleName(t.mayor.name) ? `alcaldesa ${PERSONALITY_TEXT[t.mayor.personality].replace(/o$/, 'a')}` : `alcalde ${PERSONALITY_TEXT[t.mayor.personality]}`}, de los ${FACTION[t.mayor.faction] ?? t.mayor.faction}`),
    h('p', { class: `comarca-rel rel-${t.relation < 0 ? 'bad' : t.relation > 0 ? 'good' : 'ok'}` }, `Relación: ${rel}${t.downstream ? ' · está río abajo' : ''}`),
  );
  if (t.said) {
    const when = t.saidTick !== undefined ? ` (${formatDate(tickToDate(t.saidTick))})` : '';
    card.append(h('blockquote', { class: 'comarca-said' }, `«${t.said}»`, h('span', { class: 'muted small' }, ` ${t.saidBy === 'ia' ? '✦ ' : ''}${when}`)));
  }
  for (const o of state.comarca.offers.filter((x) => x.townId === t.id)) {
    if (!o.resolved && o.until > state.tick) {
      const left = Math.max(1, Math.ceil((o.until - state.tick) / 24));
      const yes = h('button', { class: 'btn small primary', 'aria-label': `Aceptar el acuerdo de ${OFFER_TEXT[o.kind]} con ${t.name}` }, 'Aceptar');
      const no = h('button', { class: 'btn small', 'aria-label': `Rechazar el acuerdo de ${OFFER_TEXT[o.kind]} con ${t.name}` }, 'Rechazar');
      const answer = (accept: boolean) => async () => {
        if (await ctx.command({ type: 'AnswerNeighbor', id: o.id, accept })) {
          toast(accept ? `Acuerdo de ${OFFER_TEXT[o.kind]} con ${t.name}` : `Rechazas el acuerdo con ${t.name}`, { kind: 'info' });
          openComarca(ctx);
        }
      };
      yes.addEventListener('click', answer(true));
      no.addEventListener('click', answer(false));
      card.append(
        h(
          'div',
          { class: 'comarca-offer' },
          h('p', {}, h('strong', {}, `Ofrece un acuerdo de ${OFFER_TEXT[o.kind]}`), h('br', {}), h('span', { class: 'small' }, offerEffect(o.kind))),
          h('p', { class: 'muted small' }, `${left === 1 ? 'Queda 1 día' : `Quedan ${left} días`} para responder. Si no respondes, se lo tomará mal.`),
          h('div', { class: 'comarca-answer' }, yes, no),
        ),
      );
    } else if (o.resolved === 'accepted' && o.dealUntil !== undefined && o.dealUntil > state.tick) {
      card.append(h('p', { class: 'small' }, `Acuerdo de ${OFFER_TEXT[o.kind]} hasta el ${formatDate(tickToDate(o.dealUntil))}`));
    }
  }
  return card;
}

export function openComarca(ctx: ComarcaCtx): void {
  const state = ctx.state();
  const towns = state.comarca?.towns ?? [];
  const body: (Node | string)[] = [];
  if (!towns.length) {
    body.push(h('p', {}, 'Al cerrar el primer mes conocerás a los pueblos vecinos y a sus alcaldes.'));
  } else {
    const d = tickToDate(state.tick);
    const host = state.comarca.fair?.year === d.year ? state.comarca.fair.host : fairHost(state, d.year);
    const hostName = host === 0 ? 'en Bitópolis' : `en ${towns.find((t) => t.id === host)?.name ?? 'la comarca'}`;
    body.push(h('p', { class: 'muted' }, `Feria comarcal de septiembre: ${hostName}.${host === 0 ? ' Los forasteros gastarán en las tiendas del pueblo.' : ''}`));
    const pull = strongestPull(state);
    const n = pullLeavers(state);
    if (pull && n > 0) body.push(h('p', { class: 'comarca-warn' }, `${pull.name} atrae a los vecinos más que Bitópolis (${Math.round(townAttract(state, pull))} frente a ${Math.round(ourAttract(state))}; se van si la diferencia pasa de ${COMARCA.pullGap}): cada mes se pueden ir unos ${n}. Sube la felicidad o baja los impuestos.`));
    const deals = OFFER_KINDS.filter((k) => activeDeal(state, k));
    if (deals.length) body.push(h('p', { class: 'small' }, `Acuerdos en vigor: ${deals.map((k) => OFFER_TEXT[k]).join(', ')}.`));
    for (const t of towns) body.push(townCard(ctx, state, t));
  }
  sheet('Pueblos vecinos', ...body);
}
