import { tickToDate } from '@bitopolis/shared';
import { type GameState, MOTTOS, nextRank, PIECE_TEXT, rankCandidates, rankName, RANKS } from '@bitopolis/sim';
import { crestCanvas, crestOf } from './crest.ts';
import { formatDate, plural } from './i18n.ts';
import { h, sheet } from './ui.ts';

/**
 * 2.1: rango del pueblo en la interfaz: tarjeta del panel «Pueblo» y hoja
 * «Escudo y rango» (escudo grande, lema, qué falta y la votación abierta).
 */

/** «Para Villa: faltan 12 vecinos y el ayuntamiento a nivel 3». */
export function nextRankText(state: GameState): string {
  const n = nextRank(state);
  if (!n) return 'Ya es lo más alto: capital comarcal.';
  const parts: string[] = [];
  if (n.missingPop) parts.push(`${n.missingPop === 1 ? 'falta' : 'faltan'} ${plural(n.missingPop, 'vecino', 'vecinos')}`);
  if (n.missingHall) parts.push(`${parts.length ? 'y ' : 'falta '}el ayuntamiento a nivel ${n.townhall}`);
  return parts.length ? `Para ${n.name}: ${parts.join(' ')}.` : `${n.name}: mañana se celebra.`;
}

export function mottoText(state: GameState): string | null {
  const m = crestOf(state).crest.motto;
  return m ? MOTTOS[m] : null;
}

/** Tarjeta del panel «Pueblo» (se toca para abrir la hoja). */
export function rankCard(state: GameState, open: () => void): HTMLElement {
  const motto = mottoText(state);
  const vote = rankCandidates(state);
  const btn = h(
    'button',
    { class: 'rank-card', 'aria-label': `${rankName(state)}${motto ? `, lema «${motto}»` : ''}. Ver escudo y rango` },
    crestCanvas(state, 'crest crest-m'),
    h('span', { class: 'rank-text' }, h('strong', { class: 'rank-name' }, rankName(state)), motto ? h('em', { class: 'rank-motto' }, `«${motto}»`) : '', h('small', { class: 'muted' }, vote ? 'Los vecinos votan el escudo' : nextRankText(state))),
  );
  btn.addEventListener('click', open);
  return h('section', { class: 'hub-card rank-hub' }, btn);
}

export function openRank(state: GameState): void {
  const r = state.rank;
  const motto = mottoText(state);
  const vote = rankCandidates(state);
  const ladder = h(
    'ol',
    { class: 'rank-ladder' },
    ...RANKS.map((x, i) =>
      h('li', { class: i === (r?.level ?? 0) ? 'now' : i < (r?.level ?? 0) ? 'done' : '' }, h('strong', {}, x.name), ` · ${plural(x.pop, 'vecino', 'vecinos')}, ayuntamiento nivel ${x.townhall}`, i === (r?.level ?? 0) ? h('span', { class: 'visually-hidden' }, ' (ahora)') : ''),
    ),
  );
  const pieces = crestOf(state).crest.pieces.map((p) => PIECE_TEXT[p]);
  sheet(
    'Escudo y rango',
    h(
      'div',
      { class: 'rank-head' },
      crestCanvas(state, 'crest crest-l'),
      h('div', {}, h('p', { class: 'rank-name' }, rankName(state)), motto ? h('p', { class: 'rank-motto' }, `«${motto}»`) : h('p', { class: 'muted' }, 'Aún sin lema: lo votarán los vecinos al subir de rango.'), r ? h('p', { class: 'muted small' }, `Desde el ${formatDate(tickToDate(r.since))}`) : ''),
    ),
    h('p', {}, `En el escudo: ${pieces.join(', ')}.`),
    vote
      ? h('div', { class: 'rank-vote' }, h('h3', {}, 'Votación del escudo'), h('p', {}, `Los vecinos eligen entre ${vote.piezas.map((p) => p.texto).join(', ')} y el lema entre ${vote.lemas.map((l) => `«${l.texto}»`).join(', ')}. Se cierra el ${formatDate(tickToDate(vote.vence))}.`))
      : '',
    h('p', {}, nextRankText(state)),
    h('p', { class: 'muted small' }, 'El rango es el título del pueblo: cambia el cartel de la entrada, el escudo y los tejados. Lo que se puede construir depende del ayuntamiento.'),
    ladder,
  );
}
