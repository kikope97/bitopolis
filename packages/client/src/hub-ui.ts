/**
 * 2.7 «Interfaz móvil 2.0»: piezas del panel «Pueblo» y de las fichas
 * (docs/propuestas/v2.7-interfaz-movil.md). Solo construyen DOM: lo que
 * enseñan lo decide quien las llama (game.ts, social-ui.ts, manage-ui.ts).
 *
 * - Panel: tarjetas de resumen (2×2), «Lo urgente» y una lista de filas.
 * - Fichas: cabecera (sprite y nombre), barra de estado (palabra y número),
 *   un botón principal y el detalle en bloques plegables que recuerdan si
 *   estaban abiertos (la ficha se rehace sola mientras corre el juego).
 */
import { pixelIcon } from './icons.ts';
import { h } from './ui.ts';

export type Tone = 'ok' | 'warn' | 'bad' | 'info';

/* ---------------- panel «Pueblo» ---------------- */

export interface StatCard {
  icon: string;
  label: string;
  /** La cifra grande. */
  value: string;
  /** Una línea con la tendencia o lo siguiente. */
  sub: string;
  /** ▲ ▼ o nada. */
  trend?: 'up' | 'down';
  tone?: Tone;
  /** Nombre accesible (debe empezar por lo que se ve, o decir lo mismo). */
  name: string;
  onClick: () => void;
}

/** Tarjeta de resumen: icono, rótulo, cifra y tendencia. Se toca entera. */
export function statCard(c: StatCard): HTMLElement {
  const b = h(
    'button',
    { class: `hub-stat${c.tone ? ` tone-${c.tone}` : ''}`, 'aria-label': c.name },
    h('span', { class: 'hs-head' }, pixelIcon(c.icon), h('span', { class: 'hs-label' }, c.label)),
    h('strong', { class: 'hs-value' }, c.value),
    h('span', { class: `hs-sub${c.trend ? ` ${c.trend}` : ''}` }, c.trend ? h('span', { 'aria-hidden': 'true' }, c.trend === 'up' ? '▲ ' : '▼ ') : '', c.sub),
  );
  b.addEventListener('click', c.onClick);
  return b;
}

export function statGrid(cards: HTMLElement[]): HTMLElement {
  return h('div', { class: 'hub-stats', role: 'group', 'aria-label': 'Resumen del pueblo' }, ...cards);
}

export interface UrgentItem {
  icon: string;
  tone: Tone;
  /** Qué pasa, en una frase corta. */
  text: string;
  /** El botón: «Ampliar», «Ver cuentas», «Ver dónde», «Responder». */
  action: string;
  onClick: () => void;
}

/** «Lo urgente»: hasta 3 tarjetas con su acción. Sin nada urgente, no sale. */
export function urgentBlock(items: UrgentItem[]): HTMLElement | '' {
  if (!items.length) return '';
  return h(
    'section',
    { class: 'hub-urgent', 'aria-labelledby': 'hub-urgent-h' },
    h('h3', { id: 'hub-urgent-h' }, 'Lo urgente'),
    ...items.slice(0, 3).map((u) => {
      const go = h('button', { class: `btn small${u.tone === 'bad' ? ' primary' : ''} hu-go` }, u.action);
      go.addEventListener('click', u.onClick);
      return h('div', { class: `card hu-card tone-${u.tone}` }, pixelIcon(u.icon), h('p', { class: 'hu-text' }, u.text), go);
    }),
  );
}

export interface ListRow {
  icon: string;
  title: string;
  /** Dato a la derecha (opcional). */
  datum?: string;
  /** Nombre accesible si no es el título (p. ej. «Préstamos · nota B»). */
  name?: string;
  attn?: boolean;
  fresh?: Node | '';
  hub?: string;
  onClick: () => void;
}

/** Fila de la lista: icono de 24 px, título y un dato; 48 px o más de alto. */
export function listRow(r: ListRow): HTMLElement {
  const b = h(
    'button',
    {
      class: `btn hub-row${r.attn ? ' attn' : ''}${r.fresh ? ' is-new' : ''}`,
      'aria-label': r.name ?? r.title,
      ...(r.fresh ? { 'aria-describedby': 'new-desc' } : {}),
      ...(r.hub ? { 'data-hub': r.hub } : {}),
    },
    pixelIcon(r.icon, 'px-icon hr-icon'),
    h('span', { class: 'hr-title' }, r.title),
    r.fresh || '',
    r.datum ? h('span', { class: 'hr-datum' }, r.datum) : '',
    h('span', { class: 'hr-go', 'aria-hidden': 'true' }, '›'),
  );
  b.addEventListener('click', r.onClick);
  return b;
}

/** Un grupo de la lista con su rótulo (vacío, no sale). */
export function listGroup(title: string, rows: HTMLElement[]): HTMLElement | '' {
  if (!rows.length) return '';
  return h('section', { class: 'hub-sec' }, h('h3', { class: 'hub-sec-h' }, title), h('div', { class: 'hub-grid hub-list' }, ...rows));
}

/* ---------------- fichas ---------------- */

/** Qué bloques plegables están abiertos (por clave), para que no se cierren al refrescarse la ficha. */
const folds = new Map<string, boolean>();

/** Bloque plegable que se acuerda de si estaba abierto. `open` es lo que hace la primera vez. */
export function fold(key: string, summary: string | Node, open: boolean, ...content: (Node | string)[]): HTMLDetailsElement {
  const d = h('details', { class: 'fold', 'data-fold': key }, h('summary', {}, summary), ...content) as HTMLDetailsElement;
  const init = folds.get(key) ?? open;
  d.open = init;
  // Solo se recuerda lo que cambia el jugador (abrirlo por defecto lanza un «toggle» que no es suyo).
  d.addEventListener('toggle', () => {
    if (d.open !== init || folds.has(key)) folds.set(key, d.open);
  });
  return d;
}

/** Barra de estado: palabra y número, con su color («Lleno 253 %», «Funciona», «Sin agua»). */
export function statusBar(tone: Tone, word: string, num?: string, extra?: string): HTMLElement {
  return h(
    'p',
    { class: `fc-status tone-${tone}`, role: 'status', 'data-test': 'fiche-status' },
    h('span', { class: 'fc-dot', 'aria-hidden': 'true' }),
    h('strong', {}, word),
    num ? h('span', { class: 'fc-num' }, num) : '',
    extra ? h('span', { class: 'fc-extra' }, extra) : '',
  );
}

/** Copia de un sprite (los de la caché no se pueden mover al DOM). */
export function spriteCopy(src: HTMLCanvasElement, cls = 'fc-sprite'): HTMLCanvasElement {
  const c = h('canvas', { class: cls, width: String(src.width), height: String(src.height), 'aria-hidden': 'true' }) as HTMLCanvasElement;
  c.getContext('2d')?.drawImage(src, 0, 0);
  return c;
}

/** Cabecera de la ficha: sprite pequeño y una o dos líneas (el nombre va en el título de la hoja). */
export function ficheHead(pic: HTMLCanvasElement | null, lines: (Node | string)[], status: HTMLElement, action?: HTMLElement | null): HTMLElement {
  return h(
    'div',
    { class: 'fc-head', 'data-test': 'fiche-head' },
    h('div', { class: 'fc-top' }, pic ?? '', h('div', { class: 'fc-lines' }, ...lines.filter((l) => l !== '').map((l) => h('p', { class: 'fc-line' }, l)))),
    status,
    action ? h('div', { class: 'fc-main' }, action) : '',
  );
}
