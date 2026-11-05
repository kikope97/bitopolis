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
  /** 2.7: tick del juego cuando llegó (para agrupar por semana). */
  tick?: number;
  /** Solo en esta sesión (las funciones no se guardan). */
  onClick?: () => void;
  /** 2.7: qué abre, guardable (`b:12`, `th:grants`…; lo resuelve game.ts al tocarlo). */
  go?: string;
  /** Importante (fijo o con algo que hacer): cuenta en la campana hasta que se mira. */
  important: boolean;
}
/** v1.6: todos los avisos quedan en la campana. 2.7: los 60 últimos, guardados por partida en el navegador. */
const LOG_MAX = 60;
const log: LogEntry[] = [];
let unread = 0;
let logListener: ((unread: number) => void) | null = null;
let fallback: (() => void) | null = null;
let stamp: () => string = () => '';
export interface LogStore {
  token: string;
  tick: () => number;
  /** De una referencia guardada a lo que abre (o nada si ya no existe). */
  resolve: (go: string) => (() => void) | undefined;
}
let store: LogStore | null = null;
let saveTimer = 0;
const logKey = (token: string) => `bitopolis.log.${token}`;
function writeLog(s: LogStore) {
  try {
    localStorage.setItem(logKey(s.token), JSON.stringify({ v: 1, unread, log: log.map(({ onClick: _f, ...e }) => e) }));
  } catch {
    /* sin almacenamiento: la campana vale para esta visita */
  }
}
function saveLog() {
  const s = store;
  if (!s || saveTimer) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    writeLog(s);
  }, 250);
}
function loadLog(token: string) {
  log.length = 0;
  unread = 0;
  try {
    const raw = JSON.parse(localStorage.getItem(logKey(token)) ?? 'null') as { v?: number; unread?: number; log?: LogEntry[] } | null;
    if (raw?.v !== 1 || !Array.isArray(raw.log)) return;
    for (const e of raw.log.slice(0, LOG_MAX)) {
      if (!e || typeof e.text !== 'string') continue;
      if (e.go !== undefined && typeof e.go !== 'string') delete (e as { go?: unknown }).go;
      log.push({ ...e, kind: e.kind === 'warn' || e.kind === 'good' ? e.kind : 'info', important: !!e.important });
    }
    unread = Math.max(0, Math.min(log.length, Number(raw.unread) || 0));
  } catch {
    /* guardado roto: se empieza de cero */
  }
}
export function toastLog(): readonly LogEntry[] {
  return log;
}
/** Lo que hace tocar una entrada: en esta sesión, su función; tras recargar, su referencia. */
export function entryAction(e: LogEntry): (() => void) | undefined {
  return e.onClick ?? (e.go ? store?.resolve(e.go) : undefined);
}
export function onToastLog(fn: (unread: number) => void, open: () => void, when: () => string, persist?: LogStore): void {
  logListener = fn;
  fallback = open;
  stamp = when;
  store = persist ?? null;
  if (persist) loadLog(persist.token);
  fn(unread);
}
export function markLogRead(): void {
  unread = 0;
  logListener?.(0);
  saveLog();
}
export function clearToastLog(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (store) writeLog(store);
  }
  log.length = 0;
  unread = 0;
  logListener = null;
  fallback = null;
  store = null;
}

/**
 * 2.7: el aviso cabe en dos líneas. Si el texto es largo, la píldora enseña la
 * primera frase entera (nunca cortada con «…»); la campana guarda el texto completo.
 */
export function toastHeadline(text: string): string {
  if (text.length <= 84) return text;
  const m = /^(.{20,96}?)(?:\. |: | — |; )/.exec(text);
  return m ? m[1]!.replace(/[.,;:]$/, '') : text;
}

/** Qué dice el botón del aviso según lo que abre. */
function goLabel(go: string | undefined): string {
  if (!go) return 'Ver';
  if (/^(b|at):/.test(go)) return 'Ir allí';
  if (/^(th:|dilemma:|comarca|region|errands|debtors|c:)/.test(go)) return 'Responder';
  return 'Ver';
}

/**
 * Un aviso. `go` es una referencia que se guarda con la campana (`b:12`,
 * `th:grants`, `dilemma:3`…): al tocarlo, también tras recargar, abre lo mismo.
 * `onClick` manda si se da (solo vale en esta visita).
 */
/** Ronda 23: a x10, los avisos fijos que no son urgentes se van solos a los 6 s. */
let fastToasts = false;
export function setFastToasts(on: boolean): void {
  fastToasts = on;
}

export function toast(text: string, opts: { sticky?: boolean; kind?: ToastKind; onClick?: () => void; go?: string } = {}) {
  const box = $('#toasts');
  const goFn = opts.go && store ? store.resolve(opts.go) : undefined;
  const own = opts.onClick ?? goFn;
  const important = !!opts.sticky || !!own;
  const prev = log[0];
  if (prev && prev.text === text) prev.at = Date.now();
  else {
    log.unshift({ text, kind: opts.kind ?? 'info', at: Date.now(), when: stamp(), tick: store?.tick(), onClick: opts.onClick, go: opts.go, important });
    if (log.length > LOG_MAX) log.pop();
    if (important) {
      unread++;
      logListener?.(unread);
    }
  }
  saveLog();
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
  const action = own ?? fallback ?? undefined;
  // 2.7: la píldora, en dos líneas como mucho; con algo que hacer, el botón lo dice («Responder», «Ir allí»).
  const shown = document.body.classList.contains('in-game') ? toastHeadline(text) : text;
  const label = own ? goLabel(opts.go) : shown !== text ? 'Más' : '';
  const body = action
    ? h('button', { class: 'toast-text toast-action' }, shown, label ? h('span', { class: 'toast-go' }, ` ${label} ›`) : '')
    : h('span', { class: 'toast-text' }, shown);
  const el = h('div', { class: `toast ${opts.kind ?? 'info'}` }, h('span', { class: 'toast-icon', 'aria-hidden': 'true' }, icon), body);
  if (own) el.dataset.go = opts.go ?? 'fn';
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
  // Ronda 23: con una hoja abierta, lo que trae una acción va solo a la campana (antes tapaba las filas
  // de la hoja y se quedaba con el toque); lo demás (errores, confirmaciones) se ve arriba y no se toca.
  if (document.body.classList.contains('in-game') && document.body.classList.contains('sheet-open')) {
    if (own) return;
    el.classList.add('passive');
  }
  // A x10 los fijos de poca urgencia no se quedan: siguen en la campana y en «Te piden».
  if (fastToasts && opts.sticky && opts.kind !== 'warn' && el.dataset.timer) {
    clearTimeout(Number(el.dataset.timer));
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
  draggable(el);
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

/*
 * 2.7: hojas en tres alturas que se arrastran (solo en el móvil en vertical; en tableta y en
 * horizontal son un panel lateral). Asomada (≈35 %, el mapa y el edificio a la vista), media
 * (≈60 %) y completa (hasta la barra de arriba, sin taparla). El asa y la cabecera se arrastran;
 * hacia abajo desde la asomada, se cierra. La altura elegida va en `data-snap`; sin ella manda la
 * clase: `.half` (fichas) en media, `.half[data-start="peek"]` en asomada y el resto en completa.
 */
const SNAPS = ['peek', 'mid', 'full'] as const;
export type SheetSnap = (typeof SNAPS)[number];
const SNAP_NAME: Record<SheetSnap, string> = { peek: 'asomada', mid: 'media', full: 'completa' };

/** La altura de la hoja ahora (la elegida al arrastrar o la que le toca por su clase). */
export function sheetSnap(el: HTMLElement): SheetSnap {
  const s = el.dataset.snap as SheetSnap | undefined;
  if (s && SNAPS.includes(s)) return s;
  if (el.classList.contains('half') && !el.classList.contains('full')) return el.dataset.start === 'peek' ? 'peek' : 'mid';
  return 'full';
}

/** Alturas en px de las tres posiciones (entre la barra de arriba y el dock). */
function snapHeights(): Record<SheetSnap, number> {
  const css = getComputedStyle(document.documentElement);
  const px = (v: string, d: number) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
  const inGame = document.body.classList.contains('in-game');
  const top = inGame ? px(css.getPropertyValue('--top-h'), 44) : 8;
  const dock = px(css.getPropertyValue('--dock-h'), 0);
  const room = Math.max(120, window.innerHeight - top - dock);
  return { peek: Math.min(room, Math.round(window.innerHeight * 0.35)), mid: Math.min(room, Math.round(window.innerHeight * 0.6)), full: room };
}

export function setSheetSnap(el: HTMLElement, snap: SheetSnap): void {
  el.dataset.snap = snap;
  el.querySelector('.sheet-grip')?.setAttribute('aria-label', `Alto de la hoja: ${SNAP_NAME[snap]}. Toca para cambiarlo`);
}

function draggable(el: HTMLElement): void {
  const grip = h('button', { class: 'sheet-grip', type: 'button', 'aria-label': 'Cambiar el alto de la hoja' });
  el.prepend(grip);
  const head = el.querySelector<HTMLElement>('.sheet-head')!;
  let drag: { id: number; y0: number; t0: number; h0: number; from: SheetSnap; moved: boolean; y: number; t: number; v: number } | null = null;
  let justDragged = false;
  // Toque sin arrastrar (o Intro): sube un escalón; desde la completa, vuelve a la asomada.
  grip.addEventListener('click', () => {
    if (justDragged) return;
    const now = sheetSnap(el);
    setSheetSnap(el, now === 'full' ? 'peek' : SNAPS[SNAPS.indexOf(now) + 1]!);
  });
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const i = SNAPS.indexOf(sheetSnap(el)) + (e.key === 'ArrowUp' ? 1 : -1);
    if (i < 0) closeSheet();
    else setSheetSnap(el, SNAPS[Math.min(i, SNAPS.length - 1)]!);
  });
  const start = (e: PointerEvent) => {
    if (sidePanel() || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // Los botones de la cabecera (‹ y ✕) siguen siendo botones.
    const t = e.target as HTMLElement;
    if (t !== grip && t.closest('button, a, input, select')) return;
    drag = { id: e.pointerId, y0: e.clientY, t0: e.timeStamp, h0: el.getBoundingClientRect().height, from: sheetSnap(el), moved: false, y: e.clientY, t: e.timeStamp, v: 0 };
  };
  const move = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dy) < 6) return;
      drag.moved = true;
      el.classList.add('dragging');
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* sin captura: sigue funcionando mientras el dedo esté encima */
      }
    }
    // Velocidad (px/ms, + hacia abajo), suavizada con el último tramo.
    const dt = Math.max(1, e.timeStamp - drag.t);
    drag.v = 0.6 * ((e.clientY - drag.y) / dt) + 0.4 * drag.v;
    drag.y = e.clientY;
    drag.t = e.timeStamp;
    const max = snapHeights().full;
    el.style.height = `${Math.round(Math.max(48, Math.min(max, drag.h0 - dy)))}px`;
    e.preventDefault();
  };
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    justDragged = true;
    setTimeout(() => (justDragged = false), 0);
    el.classList.remove('dragging');
    const now = el.getBoundingClientRect().height;
    el.style.height = '';
    if (e.type === 'pointercancel') return;
    const hs = snapHeights();
    const dy = e.clientY - d.y0;
    const fast = Math.abs(d.v) > 0.45 && Math.abs(dy) > 24;
    // Hacia abajo: desde la asomada (o por debajo de ella) se cierra.
    if (dy > 0 && (now < hs.peek * 0.7 || (d.from === 'peek' && (fast || dy > 48)))) {
      closeSheet();
      return;
    }
    let to: SheetSnap;
    if (fast) {
      const i = SNAPS.indexOf(d.from) + (d.v < 0 ? 1 : -1);
      to = SNAPS[Math.max(0, Math.min(SNAPS.length - 1, i))]!;
    } else {
      to = SNAPS.reduce((best, s) => (Math.abs(hs[s] - now) < Math.abs(hs[best] - now) ? s : best), d.from);
    }
    setSheetSnap(el, to);
  };
  for (const target of [grip, head]) {
    target.addEventListener('pointerdown', start);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }
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
      h('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-t', 'aria-describedby': 'dlg-d' },
        h('h2', { id: 'dlg-t' }, title),
        h('p', { id: 'dlg-d' }, text),
        h('div', { class: 'row' }, no, ok),
      ),
    );
    // 2.7: el foco no sale del diálogo; lo de detrás queda inerte (el tabulador no llega al juego).
    const behind = [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.inert);
    const done = (v: boolean) => {
      dlg.remove();
      for (const el of behind) el.inert = false;
      prev?.focus();
      resolve(v);
    };
    no.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done(false);
      else if (e.key === 'Tab') {
        // Por si el navegador no conoce `inert`: el tabulador da la vuelta entre los dos botones.
        const first = no;
        const last = ok;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    for (const el of behind) el.inert = true;
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
