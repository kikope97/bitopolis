import { tickToDate } from '@bitopolis/shared';
import { type Errand, ERRANDS, type GameState, PRESS_SECTIONS } from '@bitopolis/sim';
import { formatDate, money } from './i18n.ts';
import type { SocialCtx } from './social-ui.ts';
import { h, sheet } from './ui.ts';

/**
 * 2.1: encargos del pueblo y El Eco de Bitópolis. Todo se responde con
 * botones (menú cerrado): nunca hay texto libre del jugador.
 */

const SECTION_LABEL: Record<string, string> = { sucesos: 'Sucesos', cartas: 'Cartas al director', anuncios: 'Anuncios y obras' };
const daysLeft = (s: GameState, until: number) => Math.max(0, Math.ceil((until - s.tick) / 24));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Una tarjeta por encargo, con sus botones. `refresh` vuelve a pintar la hoja. */
function errandCard(ctx: SocialCtx, e: Errand, refresh: () => void, onCitizen?: (id: number) => void): HTMLElement {
  const s = ctx.state();
  const who = s.citizens.find((c) => c.id === e.by);
  const card = h('article', { class: `errand ${e.status}` });
  card.append(h('p', { class: 'errand-title' }, h('strong', {}, e.text)));
  if (e.story) card.append(h('p', { class: 'errand-story' }, `«${e.story}»`, who ? h('span', { class: 'muted small' }, ` — ${who.name}`) : ''));
  else if (who) card.append(h('p', { class: 'muted small' }, `Lo pide ${who.name}`));
  const days = daysLeft(s, e.until);
  card.append(
    h(
      'p',
      { class: 'muted small' },
      e.status === 'aceptado' ? `Prometido · quedan ${plural(days, 'día', 'días')} · recompensa ${money(e.reward)} y una medalla` : `Por responder (${plural(days, 'día', 'días')}) · recompensa ${money(e.reward)}`,
    ),
  );
  const act = async (answer: 'aceptar' | 'mas_tarde' | 'rechazar') => {
    if (await ctx.command({ type: 'AnswerErrand', errandId: e.id, answer })) refresh();
  };
  const row = h('div', { class: 'row wrap errand-actions' });
  if (e.status === 'ofrecido') {
    const yes = h('button', { class: 'btn primary' }, 'Prometer');
    yes.addEventListener('click', () => void act('aceptar'));
    row.append(yes);
    if (!e.postponed) {
      const later = h('button', { class: 'btn' }, 'Más adelante');
      later.addEventListener('click', () => void act('mas_tarde'));
      row.append(later);
    }
    const no = h('button', { class: 'btn' }, 'No');
    no.addEventListener('click', () => void act('rechazar'));
    row.append(no);
  }
  if (who && onCitizen) {
    const see = h('button', { class: 'btn' }, `Ver a ${who.name.split(' ')[0]}`);
    see.addEventListener('click', () => onCitizen(who.id));
    row.append(see);
  }
  if (row.childNodes.length) card.append(row);
  return card;
}

/** Resumen para el panel Pueblo. */
export function errandsSummary(s: GameState): string {
  const es = s.errands;
  if (!es) return '';
  const offered = es.list.filter((e) => e.status === 'ofrecido').length;
  const promised = es.list.filter((e) => e.status === 'aceptado').length;
  const parts: string[] = [];
  if (offered) parts.push(plural(offered, 'encargo por responder', 'encargos por responder'));
  if (promised) parts.push(plural(promised, 'prometido', 'prometidos'));
  parts.push(plural(es.medals, 'medalla', 'medallas'));
  return parts.join(' · ');
}

export function openErrands(ctx: SocialCtx, onCitizen?: (id: number) => void): void {
  const s = ctx.state();
  const es = s.errands;
  const body: (Node | string)[] = [];
  if (!es || s.citizens.length < ERRANDS.minPop) {
    body.push(h('p', { class: 'muted' }, `Cuando el pueblo tenga ${ERRANDS.minPop} vecinos, te pedirán encargos: cosas concretas que hacen falta, con recompensa.`));
  } else {
    body.push(h('p', { class: 'muted small' }, `Cada semana el pueblo te pide algo que de verdad le falta. Si lo prometes y lo cumples a tiempo, la Diputación te premia y el vecino lo recuerda; si no, también. Llevas ${plural(es.medals, 'medalla', 'medallas')} (${es.done} cumplidos, ${es.failed} sin cumplir).`));
    if (!es.list.length) body.push(h('p', {}, 'Ahora mismo no hay encargos. El próximo llegará en unos días.'));
    for (const e of es.list) body.push(errandCard(ctx, e, () => openErrands(ctx, onCitizen), onCitizen));
  }
  sheet('Encargos del pueblo', ...body);
}

/** El Eco de Bitópolis: la última edición, su respuesta y las anteriores. */
export function openPress(ctx: SocialCtx, onRef?: (ref: number) => void): void {
  const s = ctx.state();
  const eds = [...(s.press?.editions ?? [])].reverse();
  const body: (Node | string)[] = [];
  if (!eds.length) {
    sheet('El Eco de Bitópolis', h('p', { class: 'muted' }, 'El periódico del pueblo sale cada semana. El primero, en unos días.'));
    return;
  }
  const paint = (ed: (typeof eds)[number], latest: boolean) => {
    const box = h('article', { class: `press-ed${latest ? ' latest' : ''}` });
    box.append(h('h3', { class: 'press-mast' }, `El Eco · nº ${ed.n} · ${formatDate(tickToDate(ed.tick))}`, ed.source === 'ia' ? h('span', { class: 'ai-badge', title: 'Escrito con IA' }, 'IA') : ''));
    for (const sec of PRESS_SECTIONS) {
      const hl = ed.headlines.find((x) => x.section === sec);
      if (!hl) continue;
      const line = h('p', { class: 'press-line' }, h('span', { class: 'press-sec' }, SECTION_LABEL[sec] ?? sec), h('span', { class: 'press-text' }, hl.text));
      if (hl.ref !== undefined && onRef) {
        const see = h('button', { class: 'btn small' }, 'Ver');
        see.setAttribute('aria-label', `Ver en el mapa: ${hl.text}`);
        see.addEventListener('click', () => onRef(hl.ref!));
        line.append(see);
      }
      box.append(line);
    }
    if (latest) {
      if (ed.answered) box.append(h('p', { class: 'muted small' }, `Ya contestaste en esta edición (${ed.answered}).`));
      else {
        box.append(h('p', { class: 'muted small' }, 'Contestar en el periódico (una vez por edición):'));
        const row = h('div', { class: 'row wrap' });
        const opts: [string, 'agradecer' | 'desmentir' | 'prometer', string][] = [
          ['Agradecer', 'agradecer', 'Gusta a quien ya te apoya'],
          ['Desmentir', 'desmentir', 'Calma un rumor; si no lo hay, queda raro'],
          ['Prometer', 'prometer', 'Promete el primer encargo pendiente'],
        ];
        const anyOffered = s.errands?.list.some((e) => e.status === 'ofrecido');
        for (const [label, answer, help] of opts) {
          const b = h('button', { class: 'btn', title: help, 'aria-label': `${label}: ${help}` }, label);
          if (answer === 'prometer' && !anyOffered) b.setAttribute('disabled', 'true');
          b.addEventListener('click', async () => {
            if (await ctx.command({ type: 'AnswerPress', edition: ed.n, answer })) openPress(ctx, onRef);
          });
          row.append(b);
        }
        box.append(row);
      }
    }
    return box;
  };
  body.push(paint(eds[0]!, true));
  if (eds.length > 1) {
    body.push(h('h3', {}, 'Números anteriores'));
    for (const ed of eds.slice(1)) body.push(paint(ed, false));
  }
  sheet('El Eco de Bitópolis', ...body);
}
