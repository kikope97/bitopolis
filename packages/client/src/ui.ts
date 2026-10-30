/** Utilidades de interfaz: toasts, hojas inferiores y confirmaciones. */

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

export function toast(text: string, opts: { sticky?: boolean; kind?: 'info' | 'warn' | 'good'; onClick?: () => void } = {}) {
  const box = $('#toasts');
  const icon = { info: 'ℹ', warn: '⚠', good: '✔' }[opts.kind ?? 'info'];
  // Sin role propio: el contenedor #toasts ya es aria-live (evita anuncios dobles).
  const body = opts.onClick ? h('button', { class: 'toast-text toast-action' }, text) : h('span', { class: 'toast-text' }, text);
  const el = h('div', { class: `toast ${opts.kind ?? 'info'}` }, h('span', { class: 'toast-icon', 'aria-hidden': 'true' }, icon), body);
  if (opts.onClick) {
    el.classList.add('clickable');
    // Un botón de verdad: funciona con teclado (Enter/Espacio) y con lector de pantalla.
    body.addEventListener('click', () => {
      opts.onClick!();
      el.remove();
    });
  }
  if (opts.sticky) {
    el.classList.add('sticky');
    const x = h('button', { class: 'toast-close', 'aria-label': 'Cerrar aviso' }, '✕');
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      el.remove();
    });
    el.append(x);
  } else {
    setTimeout(() => el.remove(), 6000);
  }
  box.append(el);
  // Como mucho 2 avisos a la vista; los fijos (con ✕) se conservan antes.
  while (box.children.length > 2) {
    const victim = [...box.children].find((c) => !c.classList.contains('sticky')) ?? box.firstElementChild;
    victim?.remove();
  }
}

let openSheetEl: HTMLElement | null = null;
let lastFocus: HTMLElement | null = null;

export function closeSheet() {
  if (!openSheetEl) return;
  openSheetEl.remove();
  openSheetEl = null;
  lastFocus?.focus();
}

/** Hoja inferior (bottom sheet) al alcance del pulgar. */
export function sheet(title: string | Node, ...content: (Node | string)[]): HTMLElement {
  closeSheet();
  lastFocus = document.activeElement as HTMLElement | null;
  const close = h('button', { class: 'sheet-close', 'aria-label': 'Cerrar' }, '✕');
  close.addEventListener('click', closeSheet);
  const el = h(
    'section',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'sheet-title' },
    h('header', { class: 'sheet-head' }, h('h2', { id: 'sheet-title' }, title), close),
    h('div', { class: 'sheet-body' }, ...content),
  );
  document.body.append(el);
  openSheetEl = el;
  close.focus();
  return el;
}

export function isSheetOpen() {
  return openSheetEl !== null;
}

/** Confirmación para acciones caras o irreversibles. "No" es el botón principal. */
export function confirmDialog(title: string, text: string, yes: string): Promise<boolean> {
  return new Promise((resolve) => {
    const prev = document.activeElement as HTMLElement | null;
    const no = h('button', { class: 'btn primary' }, 'No');
    const ok = h('button', { class: 'btn danger' }, yes);
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
    no.focus();
  });
}

export function vibrate(ms: number) {
  try {
    if (localStorage.getItem('bitopolis.vibrate') === 'off') return;
  } catch {
    /* sin almacenamiento */
  }
  navigator.vibrate?.(ms);
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
