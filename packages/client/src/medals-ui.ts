import { tickToDate } from '@bitopolis/shared';
import { ACHIEVEMENT_GROUPS, ACHIEVEMENT_LIST, type Achievement, type GameState } from '@bitopolis/sim';
import { formatDate } from './i18n.ts';
import { pixelIcon } from './icons.ts';
import { h, sheet } from './ui.ts';

/**
 * 2.3: medallas (Pueblo › Objetivos). Rejilla de 4 columnas de 72 px con el
 * icono de cada grupo y tipo; las que faltan, en gris con su pista. Al tocar
 * una se ve su texto y la fecha (o cómo va). Los encargos de la 2.1 salen aquí
 * como un logro por tramos (1, 5 y 15).
 */

const TIER_TEXT: Record<Achievement['tier'], string> = { bronce: 'Bronce', plata: 'Plata', oro: 'Oro' };

export function medalCount(state: GameState): { have: number; total: number } {
  const ids = new Set((state.medals ?? []).map((m) => m.id));
  return { have: ACHIEVEMENT_LIST.filter((a) => ids.has(a.id)).length, total: ACHIEVEMENT_LIST.length };
}

export function openMedals(state: GameState): void {
  const got = new Map((state.medals ?? []).map((m) => [m.id, m.tick]));
  const { have, total } = medalCount(state);
  const detail = h('div', { class: 'medal-detail', 'aria-live': 'polite' }, h('p', { class: 'muted' }, 'Toca una medalla para ver qué es y cuándo llegó.'));
  const grid = h('div', { class: 'medal-grid' });
  let selected: HTMLElement | null = null;
  for (const a of ACHIEVEMENT_LIST) {
    const tick = got.get(a.id);
    const has = tick !== undefined;
    const label = `${TIER_TEXT[a.tier]}, ${ACHIEVEMENT_GROUPS[a.group].toLowerCase()}: ${has ? a.text : `falta. ${a.hint}`}`;
    const b = h('button', { class: `medal-cell${has ? ` got tier-${a.tier}` : ' missing'}`, 'aria-label': label, 'data-id': a.id, 'aria-pressed': 'false' }, pixelIcon(`medal-${a.group}-${has ? a.tier : 'none'}`, 'px-icon medal-icon'));
    b.addEventListener('click', () => {
      selected?.setAttribute('aria-pressed', 'false');
      selected = b;
      b.setAttribute('aria-pressed', 'true');
      const p = a.progress?.(state);
      detail.replaceChildren(
        h('h3', { class: 'medal-title' }, pixelIcon(`medal-${a.group}-${has ? a.tier : 'none'}`), has ? a.text : a.hint),
        h('p', { class: 'muted small' }, `${TIER_TEXT[a.tier]} · ${ACHIEVEMENT_GROUPS[a.group]}`),
        h('p', {}, has ? `Conseguida el ${formatDate(tickToDate(Math.max(0, tick - 1)))}.` : `Aún no la tienes.${p ? ` Llevas ${p[0]} de ${p[1]}.` : ''}`),
      );
      detail.scrollIntoView?.({ block: 'nearest' });
    });
    grid.append(b);
  }
  sheet(
    'Medallas',
    h('p', {}, h('strong', {}, `${have} de ${total}`), ' medallas. No dan dinero: son el recuerdo de lo que ha logrado el pueblo. Las de oro dejan una foto en el álbum.'),
    detail,
    grid,
  );
}
