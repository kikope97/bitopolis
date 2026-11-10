import { monthFlow } from './cash.ts';
import { TICKS_PER_DAY, tickToDate } from '@bitopolis/shared';
import { type GameState, hash32, professionOf, rankName } from '@bitopolis/sim';
import { type Ask, dueSoon, dueText } from './asks.ts';
import { formatDate, money, plural } from './i18n.ts';
import { portraitCanvas } from './social-ui.ts';
import { h } from './ui.ts';

/**
 * 2.7 «Hoy en Bitópolis» (sustituye a «Mientras no estabas», que ocupaba cinco
 * páginas y empezaba por lo que ya se ve arriba). Al volver tras una ausencia,
 * una sola tarjeta: cómo va el pueblo en una frase, hasta tres cosas que te
 * piden con su plazo, la cara del día y un gran «▶ Seguir». Mientras está
 * abierta, el juego espera en pausa; «▶ Seguir» lo pone a la velocidad guardada.
 */
export interface AwaySince {
  /** Tick desde el que se cuenta. */
  tick: number;
  pop: number;
  treasury: number;
  /** ¿Pasó el tiempo de juego desde la última visita? (si no, solo se cuenta lo pendiente). */
  advanced: boolean;
  rank: number;
}

/** Vecino del día: uno con nombre, fijo para cada día de juego. */
export function citizenOfDay(state: GameState): GameState['citizens'][number] | null {
  const named = state.citizens.filter((c) => c.named);
  const pool = named.length ? named : state.citizens;
  if (!pool.length) return null;
  return pool[hash32(state.seed, Math.floor(state.tick / TICKS_PER_DAY), 41) % pool.length]!;
}

const avgHappy = (s: GameState) => (s.citizens.length ? Math.round(s.citizens.reduce((a, c) => a + c.happiness, 0) / s.citizens.length) : 0);
const signed = (n: number) => (n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : money(0));

/** Cómo va el pueblo, en una frase y con cifras del estado. */
export function townLine(state: GameState): string {
  const happy = avgHappy(state);
  const last = state.stats.at(-1);
  const net = last ? last.income - last.expenses : 0;
  // 2.7: «va bien» mira el gasto corriente (un mes con una obra grande no es un mal mes).
  const f = monthFlow(state);
  const how = state.treasury < 0 || happy < 40 ? 'pasa un mal momento' : happy >= 65 && f.income - f.running >= 0 ? 'va bien' : 'va tirando';
  const month = last ? ` (el último mes, ${signed(net)})` : '';
  return `${rankName(state)} de Bitópolis ${how}: ${plural(state.citizens.length, 'vecino', 'vecinos')}, felicidad ${happy} de 100 y ${money(state.treasury)} en caja${month}.`;
}

/** Lo que ha cambiado desde la última visita (vacío si nada). */
export function sinceLine(state: GameState, since: AwaySince): string {
  const parts: string[] = [];
  const dp = state.citizens.length - since.pop;
  if (dp) parts.push(`${dp > 0 ? '+' : '−'}${plural(Math.abs(dp), 'vecino', 'vecinos')}`);
  const dm = state.treasury - since.treasury;
  if (since.advanced && dm) parts.push(`${signed(dm)} en caja`);
  if ((state.rank?.level ?? 0) > since.rank) parts.push(`ahora es ${rankName(state).toLowerCase()}`);
  const photos = (state.album ?? []).filter((m) => m.tick > since.tick).length;
  if (since.advanced && photos) parts.push(plural(photos, 'momento nuevo en el álbum', 'momentos nuevos en el álbum'));
  return parts.length ? `Desde tu última visita: ${parts.join(', ')}.` : '';
}

/** ¿Hay algo que contar? Si no, la tarjeta no sale. */
export function hoyHasNews(state: GameState, since: AwaySince, asks: readonly Ask[]): boolean {
  return asks.length > 0 || sinceLine(state, since) !== '';
}

export interface HoyActions {
  /** Velocidad a la que sigue («▶ Seguir a x3»). */
  speed: number;
  /** Lo que abre cada cosa que te piden (o nada si ya no existe). */
  go: (ref: string) => (() => void) | undefined;
  openCitizen: (id: number) => void;
  /** «▶ Seguir»: reanuda. */
  resume: () => void;
  /** Al cerrarse de cualquier forma. */
  closed: () => void;
}

let openEl: HTMLElement | null = null;
export const isHoyOpen = () => openEl !== null;
export function closeHoy(): void {
  openEl?.querySelector<HTMLButtonElement>('.hoy-close')?.click();
}

export function openHoy(state: GameState, since: AwaySince, asks: readonly Ask[], act: HoyActions): HTMLElement {
  closeHoy();
  const game = document.querySelector<HTMLElement>('#game');
  const prev = document.activeElement as HTMLElement | null;
  let done = false;
  const close = (then?: () => void) => {
    if (done) return;
    done = true;
    back.remove();
    openEl = null;
    if (game) game.inert = false;
    document.body.classList.remove('hoy-open');
    act.closed();
    if (then) then();
    else (prev?.isConnected ? prev : document.querySelector<HTMLElement>('#map'))?.focus();
  };
  const x = h('button', { class: 'hoy-close', 'aria-label': 'Cerrar (el juego sigue en pausa)' }, '✕');
  x.addEventListener('click', () => close());
  const date = h('p', { class: 'hoy-date' }, formatDate(tickToDate(state.tick)));
  const since2 = sinceLine(state, since);

  // Hasta tres cosas que te piden, con su plazo; al tocar una se abre su tarjeta.
  const list = asks.slice(0, 3);
  const asksBox = list.length
    ? h(
        'section',
        { class: 'hoy-asks', 'aria-labelledby': 'hoy-asks-t' },
        h('h3', { id: 'hoy-asks-t' }, asks.length > 3 ? `Te piden (${asks.length}; las 3 más urgentes)` : 'Te piden'),
        h(
          'ul',
          {},
          ...list.map((a) => {
            const fn = act.go(a.go);
            const due = dueText(state.tick, a.due);
            const b = h(
              'button',
              { class: 'hoy-ask', 'data-ask': a.key, ...(fn ? {} : { 'aria-disabled': 'true' }) },
              h('span', { class: 'hoy-ask-text' }, a.text),
              due ? h('span', { class: `ask-due${dueSoon(state.tick, a.due) ? ' soon' : ''}` }, `⏳ ${due}`) : '',
              h('span', { class: 'hoy-ask-go', 'aria-hidden': 'true' }, `${a.action} ›`),
            );
            if (fn) b.addEventListener('click', () => close(fn));
            return h('li', {}, b);
          }),
        ),
      )
    : '';

  // La cara del día: un vecino con su frase.
  const c = state.citizens.length ? citizenOfDay(state) : null;
  let face: HTMLElement | string = '';
  if (c) {
    // Su frase: lo que piensa (IA o reglas); si no, cómo anda. El resumen largo va en su ficha.
    const mood = c.happiness >= 70 ? 'Aquí se vive bien.' : c.happiness >= 45 ? 'Vamos tirando.' : 'Esto tiene que mejorar.';
    const said = c.thought?.trim() || mood;
    const who = h('button', { class: 'hoy-face', 'aria-label': `La cara del día: ${c.name}. Ver su ficha` }, portraitCanvas(c.id, 3, 'portrait hoy-portrait'), h('span', { class: 'hoy-who' }, h('strong', {}, c.name), h('span', { class: 'hoy-sub' }, `${c.age} años${c.profession ? ` · ${professionOf(c)}` : ''}`), h('span', { class: 'hoy-quote' }, `«${said}»`)));
    who.addEventListener('click', () => close(() => act.openCitizen(c.id)));
    face = h('section', { class: 'hoy-day', 'aria-label': 'La cara del día' }, h('h3', {}, 'La cara del día'), who);
  }

  const speed = Math.max(1, act.speed);
  const go = h('button', { class: 'btn primary big hoy-go' }, `▶ Seguir a x${speed}`);
  go.addEventListener('click', () => close(act.resume));
  const card = h(
    'section',
    { class: 'hoy', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'hoy-title', 'aria-describedby': 'hoy-line' },
    h('header', { class: 'hoy-head' }, h('div', {}, h('h2', { id: 'hoy-title' }, 'Hoy en Bitópolis'), date), x),
    h('p', { id: 'hoy-line', class: 'hoy-line' }, townLine(state), since2 ? h('span', { class: 'hoy-since' }, ` ${since2}`) : ''),
    asksBox,
    face,
    go,
  );
  const back = h('div', { class: 'hoy-backdrop' }, card);
  back.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const items = [...card.querySelectorAll<HTMLElement>('button:not([aria-disabled="true"])')];
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  // Tocar fuera de la tarjeta = cerrar (en pausa).
  back.addEventListener('click', (e) => e.target === back && close());
  if (game) game.inert = true;
  document.body.append(back);
  document.body.classList.add('hoy-open');
  openEl = back;
  go.focus();
  return back;
}
