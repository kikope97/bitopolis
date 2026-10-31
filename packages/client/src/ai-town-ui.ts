import { tickToDate } from '@bitopolis/shared';
import { brewingNow, type Citizen, type GameState, planText } from '@bitopolis/sim';
import { formatDate } from './i18n.ts';
import type { SocialCtx } from './social-ui.ts';
import { h, sheet } from './ui.ts';

/**
 * 2.0: «Qué está pasando». Lo que decidió el pueblo en cada turno (la IA o, si
 * no llegó, la costumbre), con el porqué de cada vecino, lo que ha hecho el
 * alcalde y los planes y ultimátums en marcha.
 */
export function openWhatsHappening(ctx: SocialCtx, onCitizen: (id: number) => void): void {
  const s = ctx.state();
  const ai = s.ai;
  if (!ai) {
    sheet('Qué está pasando', h('p', { class: 'muted' }, 'Solo en Modo IA: allí el pueblo decide cada semana con la IA.'));
    return;
  }
  const body: (Node | string)[] = [];
  const who = (id: number) => s.citizens.find((c) => c.id === id);
  // Planes y ultimátums en marcha: lo que el jugador aún puede evitar.
  const plans = s.citizens.filter((c) => c.plan).sort((a, b) => a.plan!.until - b.plan!.until);
  // Avisos del director: lo malo siempre se anuncia antes, para que se pueda reaccionar.
  const brewing = brewingNow(s);
  if (plans.length || brewing.length) {
    body.push(h('h3', {}, 'Se está cociendo'));
    const ul = h('ul', { class: 'turn-lines' });
    for (const b of brewing) ul.append(h('li', { class: b.bad ? 'brewing bad' : 'brewing' }, h('span', { class: 'turn-line' }, `${b.bad ? '⚠ ' : ''}${b.text}`)));
    for (const c of plans.slice(0, 8)) {
      const days = Math.max(0, Math.ceil((c.plan!.until - s.tick) / 24));
      const b = h('button', { class: 'turn-line' }, h('strong', {}, c.name), ` ${planText(c.plan!)}`, h('span', { class: 'muted small' }, ` · quedan ${days} ${days === 1 ? 'día' : 'días'}`));
      b.addEventListener('click', () => onCitizen(c.id));
      ul.append(h('li', {}, b));
    }
    body.push(ul);
  }
  if (ai.turn) body.push(h('p', { class: 'muted small' }, `El pueblo está pensando la semana (turno ${ai.turn.n}).`));
  const turns = [...ai.log].reverse();
  if (!turns.length) body.push(h('p', { class: 'muted' }, 'Aún no ha pasado ninguna semana con la IA. Cada semana de juego, los vecinos con IA deciden qué hacer según lo que haces tú.'));
  for (const t of turns) {
    const d = tickToDate(t.tick);
    body.push(
      h(
        'h3',
        {},
        `${t.kind === 'rapida' ? 'Reacción' : 'Semana'} del ${formatDate(d)} `,
        h('span', { class: `turn-source ${t.source}` }, t.source === 'ia' ? '✦ IA' : 'por costumbre'),
      ),
    );
    if (t.focus) body.push(h('p', { class: 'turn-focus' }, t.focus));
    if (t.chronicle) body.push(h('p', { class: 'turn-chronicle' }, t.chronicle));
    if (!t.lines.length) body.push(h('p', { class: 'muted small' }, 'Semana tranquila: nadie hizo nada que contar.'));
    const ul = h('ul', { class: 'turn-lines' });
    for (const l of t.lines) {
      const c = who(l.id);
      // Ronda 16: el ✦ (suceso del director) no se lee; la etiqueta es corta.
      const director = l.text.startsWith('✦ ');
      const text = director ? l.text.slice(2) : l.text;
      const row = h(
        'button',
        { class: 'turn-line', 'aria-label': `${director ? 'Suceso: ' : ''}${text}${c ? '. Abrir su ficha' : ''}`, ...(c ? {} : { disabled: 'true' }) },
        director ? h('span', { 'aria-hidden': 'true' }, '✦ ') : '',
        text,
        l.motivo ? h('span', { class: 'turn-why' }, ` «${l.motivo}»`) : '',
      );
      if (c) row.addEventListener('click', () => onCitizen(c.id));
      ul.append(h('li', {}, row));
    }
    body.push(ul);
  }
  if (ai.mayor.length) {
    body.push(h('h3', {}, 'Lo que has hecho (lo verán en el próximo turno)'));
    body.push(h('ul', { class: 'turn-lines muted small' }, ...ai.mayor.slice(-6).map((m) => h('li', {}, `El alcalde ${m.text}`))));
  }
  sheet('Qué está pasando', ...body);
}

/** Resumen de un turno en una línea, para el aviso semanal. */
export function turnHeadline(s: GameState): string | null {
  const t = s.ai?.log.at(-1);
  if (!t) return null;
  // El foco del director, si lo hay, va primero.
  if (t.focus) return `${t.kind === 'rapida' ? 'El pueblo reacciona' : 'Esta semana en Bitópolis'}: ${t.focus}.`;
  const top = t.lines.slice(0, 2).map((l) => l.text);
  const head = t.kind === 'rapida' ? 'El pueblo reacciona' : 'Esta semana en Bitópolis';
  const body = top.length ? top.join('; ') : 'semana tranquila';
  const more = t.lines.length > 2 ? ` y ${t.lines.length - 2} más` : '';
  return `${head}${t.source === 'reglas' ? ' (por costumbre)' : ''}: ${body}${more}.`;
}

/** Lo que piensa y planea un vecino con IA (para su ficha). */
export function mindBox(s: GameState, c: Citizen): HTMLElement | null {
  if (!s.aiMode || !c.named) return null;
  const att = c.attitude ?? 0;
  const attText = att >= 2 ? 'muy a favor del alcalde' : att === 1 ? 'a favor del alcalde' : att === 0 ? 'ni a favor ni en contra del alcalde' : att === -1 ? 'en contra del alcalde' : 'muy en contra del alcalde';
  const box = h('section', { class: 'mind-box' }, h('p', { class: 'mind-tag' }, '✦ Piensa con IA', h('span', { class: 'muted small' }, ': decide cada semana lo que hace')));
  if (c.thought) box.append(h('p', { class: 'mind-thought' }, `«${c.thought}»`));
  box.append(h('p', { class: 'muted small' }, `Ahora mismo está ${attText}.`));
  if (c.plan) {
    const days = Math.max(0, Math.ceil((c.plan.until - s.tick) / 24));
    box.append(h('p', { class: 'mind-plan' }, `Su plan: ${planText(c.plan)} (quedan ${days} ${days === 1 ? 'día' : 'días'}).`));
  }
  if (c.notes?.length) {
    box.append(h('p', { class: 'muted small' }, 'Lo que ha apuntado estas semanas:'));
    box.append(h('ul', { class: 'mind-notes small' }, ...[...c.notes].reverse().map((n) => h('li', {}, `${formatDate(tickToDate(n.tick))}: ${n.text}`))));
  }
  if (c.spending) box.append(h('p', { class: 'muted small' }, c.spending.where === 'fuera' ? 'Compra sobre todo fuera del pueblo.' : c.spending.where === 'ahorrar' ? 'Está ahorrando: nada de caprichos.' : 'Compra en las tiendas del pueblo.'));
  return box;
}
