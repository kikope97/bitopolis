/**
 * 2.5 «Comarca» (bloque H): el buzón del pueblo. Cartas de los que se fueron
 * (`state.letters`), de la más nueva a la más vieja. Al abrir una se lee la
 * plantilla del motor al momento y, en Modo IA, la carta que redacta la IA (el
 * servidor la guarda en caché; no entra en el estado). Lo leído se apunta en
 * este dispositivo (`localStorage`), no en la partida.
 */
import { tickToDate } from '@bitopolis/shared';
import { type GameState, type Letter, letterFromName, letterText, letterToName } from '@bitopolis/sim';
import { api } from './api.ts';
import { formatDate, plural } from './i18n.ts';
import { pixelIcon } from './icons.ts';
import { h, sheet } from './ui.ts';

const readKey = (token: string) => `bitopolis.cartas.${token}`;

function readSet(token: string): Set<number> {
  try {
    const raw = JSON.parse(localStorage.getItem(readKey(token)) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is number => typeof x === 'number') : []);
  } catch {
    return new Set();
  }
}

function markRead(token: string, id: number): void {
  const s = readSet(token);
  s.add(id);
  try {
    localStorage.setItem(readKey(token), JSON.stringify([...s].slice(-100)));
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

/** Cartas sin leer (para destacar el botón del buzón). */
export function unreadLetters(state: GameState, token: string): number {
  const read = readSet(token);
  return state.letters.filter((l) => !read.has(l.id)).length;
}

/** Cartas que ha recibido un vecino (para su ficha). */
export const lettersTo = (state: GameState, id: number): Letter[] => state.letters.filter((l) => l.to === id);

const first = (name: string) => name.split(' ')[0]!;
/** Texto con IA ya leído en esta sesión (para no volver a pedirlo). */
const aiText = new Map<string, string>();

export interface MailCtx {
  token: string;
  state: () => GameState;
  /** Abre la ficha de un vecino (toque en su nombre). */
  openCitizen: (id: number) => void;
}

/** Hoja del buzón (`.half`); con `onlyTo`, solo las cartas de ese vecino. */
export function openMailbox(ctx: MailCtx, onlyTo?: number): void {
  const state = ctx.state();
  const read = readSet(ctx.token);
  const letters = [...state.letters].filter((l) => onlyTo === undefined || l.to === onlyTo).reverse();
  const body: (Node | string)[] = [];
  if (!state.buildings.some((b) => b.kind === 'post' && b.built)) body.push(h('p', { class: 'muted small' }, 'Sin oficina de correos no llegan cartas (Construir › Cuidados › Correos).'));
  if (!letters.length) body.push(h('p', { class: 'muted' }, onlyTo === undefined ? 'Todavía no ha llegado ninguna carta.' : 'No ha recibido ninguna carta.'));
  else body.push(h('p', { class: 'muted small' }, `${plural(letters.length, 'carta', 'cartas')} de vecinos que se fueron. Toca una para leerla.`));
  const list = h('ul', { class: 'mailbox' });
  for (const l of letters) {
    const from = letterFromName(state, l);
    const to = letterToName(state, l);
    const text = h('div', { class: 'letter-text', 'aria-live': 'polite', hidden: '' });
    const unread = !read.has(l.id);
    const head = h(
      'button',
      { class: `person-row letter-row${unread ? ' unread' : ''}`, 'data-letter': String(l.id), 'aria-expanded': 'false' },
      pixelIcon('letter'),
      h('span', {}, h('strong', {}, `De ${first(from)} para ${first(to)}`), h('small', {}, ` · ${formatDate(tickToDate(l.tick))}${l.template === 'vuelvo' ? ' · ¡vuelve!' : ''}${unread ? ' · sin leer' : ''}`)),
    );
    head.addEventListener('click', () => {
      const open = text.hidden;
      text.hidden = !open;
      head.setAttribute('aria-expanded', String(open));
      if (!open) return;
      head.classList.remove('unread');
      markRead(ctx.token, l.id);
      void fill(ctx, l, text);
    });
    const who = h('button', { class: 'btn small' }, `Ficha de ${first(to)}`);
    who.addEventListener('click', () => ctx.openCitizen(l.to));
    const living = state.citizens.some((c) => c.id === l.to);
    text.append(h('p', { class: 'letter-body' }, letterText(state, l)), living && onlyTo === undefined ? who : '');
    list.append(h('li', {}, head, text));
  }
  body.push(list);
  const title = onlyTo === undefined ? 'Buzón del pueblo' : `Cartas para ${first(letterToName(state, { id: 0, from: 0, to: onlyTo, tick: 0, template: '' }))}`;
  sheet(title, ...body).classList.add('half');
}

/** Pone la carta de la IA si la hay (en Modo IA); si no, se queda la plantilla. */
async function fill(ctx: MailCtx, l: Letter, box: HTMLElement): Promise<void> {
  const state = ctx.state();
  if (!state.aiMode) return;
  const key = `${ctx.token}:${l.id}`;
  const p = box.querySelector('.letter-body')!;
  const put = (t: string) => p.replaceChildren(t, ' ', h('span', { class: 'ai-badge' }, 'IA'));
  const cached = aiText.get(key);
  if (cached) return put(cached);
  box.classList.add('thinking');
  try {
    const r = await api.letter(ctx.token, l.id);
    if (r.text) {
      aiText.set(key, r.text);
      put(r.text);
    }
  } catch {
    /* se queda la plantilla */
  } finally {
    box.classList.remove('thinking');
  }
}
