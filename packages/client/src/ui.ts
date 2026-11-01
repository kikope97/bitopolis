/** Utilidades de interfaz: toasts, hojas inferiores y confirmaciones. */
import { lowMotion, prefs } from './prefs.ts';

export function $(sel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`falta ${sel}`);
  return el;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export type ToastKind = 'info' | 'warn' | 'good';
export interface LogEntry {
  text: string;
  kind: ToastKind;
  at: number;
  /** Fecha del juego cuando llegó. */
  when: string;
  onClick?: () => void;
  /** Importante (fijo o con algo que hacer): cuenta en la campana hasta que se mira. */
  important: boolean;
}
/** v1.6: todos los avisos quedan en la campana (los 40 últimos). */
const log: LogEntry[] = [];
let unread = 0;
let logListener: ((unread: number) => void) | null = null;
let fallback: (() => void) | null = null;
let stamp: () => string = () => '';
export function toastLog(): readonly LogEntry[] {
  return log;
}
export function onToastLog(fn: (unread: number) => void, open: () => void, when: () => string): void {
  logListener = fn;
  fallback = open;
  stamp = when;
}
export function markLogRead(): void {
  unread = 0;
  logListener?.(0);
}
export function clearToastLog(): void {
  log.length = 0;
  unread = 0;
  logListener = null;
  fallback = null;
}

export function toast(text: string, opts: { sticky?: boolean; kind?: ToastKind; onClick?: () => void } = {}) {
  const box = $('#toasts');
  const important = !!opts.sticky || !!opts.onClick;
  const prev = log[0];
  if (prev && prev.text === text) prev.at = Date.now();
  else {
    log.unshift({ text, kind: opts.kind ?? 'info', at: Date.now(), when: stamp(), onClick: opts.onClick, important });
    if (log.length > 40) log.pop();
    if (important) {
      unread++;
      logListener?.(unread);
    }
  }
  // Compactos (v1.3): el mismo aviso otra vez no se apila; sube su contador «×2».
  const same = [...box.querySelectorAll<HTMLElement>('.toast')].find((t) => t.dataset.text === text && !t.classList.contains('clickable'));
  if (same) {
    const n = Number(same.dataset.count ?? '1') + 1;
    same.dataset.count = String(n);
    let badge = same.querySelector('.toast-count');
    // El contador es visual; al lector se le dice el aviso entero (ronda 09).
    if (!badge) same.querySelector('.toast-text')!.after((badge = h('span', { class: 'toast-count', 'aria-hidden': 'true' })));
    badge.textContent = `×${n}`;
    const live = document.querySelector('#sr-live');
    if (live) live.textContent = `${text} (${n} veces)`;
    // Se repitió: vuelve a contar el tiempo para que no desaparezca justo ahora.
    if (same.dataset.timer) {
      clearTimeout(Number(same.dataset.timer));
      same.dataset.timer = String(setTimeout(() => same.remove(), 6000));
    }
    return;
  }
  const icon = { info: 'ℹ', warn: '⚠', good: '✔' }[opts.kind ?? 'info'];
  // Sin role propio: el contenedor #toasts ya es aria-live (evita anuncios dobles).
  // En la partida, tocar un aviso sin acción abre la campana para leerlo entero (v1.6).
  const action = opts.onClick ?? fallback ?? undefined;
  const body = action ? h('button', { class: 'toast-text toast-action' }, text) : h('span', { class: 'toast-text' }, text);
  const el = h('div', { class: `toast ${opts.kind ?? 'info'}` }, h('span', { class: 'toast-icon', 'aria-hidden': 'true' }, icon), body);
  el.dataset.text = text;
  if (action) {
    el.classList.add('clickable');
    // Un botón de verdad: funciona con teclado (Enter/Espacio) y con lector de pantalla.
    body.addEventListener('click', () => {
      action();
      el.remove();
    });
  }
  const closeBtn = () => {
    const x = h('button', { class: 'toast-close', 'aria-label': 'Cerrar aviso' }, '✕');
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      el.remove();
    });
    el.append(x);
  };
  if (opts.sticky) {
    el.classList.add('sticky');
    // v1.4: fuera del modo tranquilo, también los fijos se van solos (siguen en la campana).
    if (!prefs().calm) el.dataset.timer = String(setTimeout(() => el.remove(), 15000));
    closeBtn();
  } else if (prefs().calm) {
    // Modo tranquilo: los avisos no caducan; se cierran a mano.
    el.classList.add('sticky');
    closeBtn();
  } else {
    el.dataset.timer = String(setTimeout(() => el.remove(), 6000));
  }
  box.append(el);
  // v1.6: en la partida, un solo aviso a la vista (el más nuevo); fuera, como mucho 2.
  const max = document.body.classList.contains('in-game') ? 1 : 2;
  while (box.children.length > max) box.firstElementChild?.remove();
}

/** Lo que hará la próxima hoja con su botón «‹» (volver al panel del que se abrió). */
let pendingBack: { label: string; fn: () => void } | null = null;
export function withBack(label: string, back: () => void, open: () => void): void {
  pendingBack = { label, fn: back };
  try {
    open();
  } finally {
    pendingBack = null;
  }
}

let openSheetEl: HTMLElement | null = null;
let lastFocus: HTMLElement | null = null;

/** La hoja abierta ahora (para refrescar solo la que toca). */
export function currentSheet(): HTMLElement | null {
  return openSheetEl;
}

let backBound = false;
function bindBack() {
  if (backBound) return;
  backBound = true;
  window.addEventListener('popstate', () => {
    if (openSheetEl) closeSheet(true);
  });
}

export function closeSheet(fromBack = false) {
  bindBack();
  if (!openSheetEl) return;
  // Cerrada con ✕ o Esc: se quita también la entrada del historial que puso la hoja.
  if (!fromBack && history.state?.sheet) history.back();
  document.body.classList.remove('election-night');
  openSheetEl.remove();
  openSheetEl = null;
  document.body.classList.remove('sheet-open');
  sheetWatch?.(null);
  // Si lo que tenía el foco ya no existe (p. ej. el aviso que abrió la hoja), al mapa.
  (lastFocus?.isConnected ? lastFocus : document.querySelector<HTMLElement>('#map'))?.focus();
}

function focusables(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter(
    (x) => !x.hasAttribute('disabled') && x.tabIndex >= 0 && x.offsetParent !== null,
  );
}

/** Hoja inferior (bottom sheet) al alcance del pulgar. */
export function sheet(title: string | Node, ...content: (Node | string)[]): HTMLElement {
  // Refresco de la misma hoja (p. ej. la ficha mientras el juego avanza): se cambia
  // solo el contenido y se conservan el foco y el scroll, sin volver a anunciarla.
  const titleText = typeof title === 'string' ? title : (title.textContent ?? '');
  if (openSheetEl && openSheetEl.querySelector('#sheet-title')?.textContent === titleText) {
    const body = openSheetEl.querySelector<HTMLElement>('.sheet-body')!;
    const items = focusables(openSheetEl);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const scroll = body.scrollTop;
    body.replaceChildren(...content);
    body.scrollTop = scroll;
    if (at >= 0) (focusables(openSheetEl)[at] ?? openSheetEl.querySelector<HTMLElement>('.sheet-close'))?.focus();
    return openSheetEl;
  }
  const keepFocus = openSheetEl ? lastFocus : (document.activeElement as HTMLElement | null);
  if (openSheetEl) {
    // Sustituir la hoja también quita el ambiente de la noche electoral (lo pone esa hoja después).
    document.body.classList.remove('election-night');
    openSheetEl.remove();
    openSheetEl = null;
  }
  lastFocus = keepFocus;
  // El botón atrás del móvil cierra la hoja en vez de salir de la partida (ronda 10).
  bindBack();
  if (!history.state?.sheet) history.pushState({ ...(history.state ?? {}), sheet: true }, '');
  const close = h('button', { class: 'sheet-close', 'aria-label': 'Cerrar' }, '✕');
  close.addEventListener('click', () => closeSheet());
  let back: HTMLElement | null = null;
  if (pendingBack) {
    const go = pendingBack.fn;
    back = h('button', { class: 'sheet-back', 'aria-label': `Volver a ${pendingBack.label}` }, '‹');
    back.addEventListener('click', go);
  }
  const el = h(
    'section',
    { class: 'sheet', role: 'dialog', 'aria-modal': String(!sidePanel()), 'aria-labelledby': 'sheet-title' },
    h('header', { class: 'sheet-head' }, back, h('h2', { id: 'sheet-title' }, title), close),
    h('div', { class: 'sheet-body' }, ...content),
  );
  // Trampa de foco: con el teclado, Tab no sale de la hoja hasta cerrarla (Esc o ✕).
  el.addEventListener('keydown', (e) => {
    // Como panel lateral (tableta, horizontal) no es modal: Tab puede salir al mapa (ronda 12).
    // El panel a pantalla completa (v1.8) sí es modal también en tableta.
    if (e.key !== 'Tab' || (sidePanel() && !el.classList.contains('full'))) return;
    const items = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled') && x.tabIndex >= 0 && x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0]!;
    const last = items.at(-1)!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  document.body.append(el);
  document.body.classList.add('sheet-open');
  openSheetEl = el;
  sheetWatch?.(titleText);
  close.focus();
  return el;
}

/** En tableta y en horizontal la hoja es un panel al lado del mapa (ver style.css). */
function sidePanel(): boolean {
  return matchMedia('(min-width: 720px) and (min-height: 540px), (orientation: landscape) and (max-height: 500px)').matches;
}

let sheetWatch: ((title: string | null) => void) | null = null;
/** Avisa al abrir o cerrar hojas (para marcar la pestaña «Pueblo»). */
export function onSheetChange(fn: ((title: string | null) => void) | null): void {
  sheetWatch = fn;
}

export function isSheetOpen() {
  return openSheetEl !== null;
}

/** Confirmación para acciones caras o irreversibles. "No" es el botón principal. */
/**
 * Diálogo de confirmación. Por defecto, para lo que no se deshace: «No» es el
 * principal y el sí va en rojo. Con `safe` (gastos normales, como convocar un
 * pleno), el sí es el principal y «No» un botón normal.
 */
export function confirmDialog(title: string, text: string, yes: string, opts: { safe?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const prev = document.activeElement as HTMLElement | null;
    const no = h('button', { class: opts.safe ? 'btn' : 'btn primary' }, 'No');
    const ok = h('button', { class: opts.safe ? 'btn primary' : 'btn danger' }, yes);
    const dlg = h(
      'div',
      { class: 'modal-backdrop' },
      h('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-t' },
        h('h2', { id: 'dlg-t' }, title),
        h('p', {}, text),
        h('div', { class: 'row' }, no, ok),
      ),
    );
    const done = (v: boolean) => {
      dlg.remove();
      prev?.focus();
      resolve(v);
    };
    no.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    dlg.addEventListener('keydown', (e) => e.key === 'Escape' && done(false));
    document.body.append(dlg);
    (opts.safe ? ok : no).focus();
  });
}

export function vibrate(ms: number) {
  if (!prefs().vibrate) return;
  navigator.vibrate?.(ms);
}

/** Movimiento reducido: sistema, preferencia o modo tranquilo. */
export const reducedMotion = lowMotion;
