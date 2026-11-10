/**
 * 2.8 (ronda 24, parte A): los textos hablan como la pantalla.
 * - `verbo()`: «toca» con el dedo, «haz clic en» con el ratón.
 * - `tabName()`: el nombre que se ve en la pestaña ahora (en vertical «Carretera»,
 *   con texto grande o en horizontal «Calle»); mismo mapa de nombres cortos que el dock.
 * - `whereOf()`: «abajo», «a la derecha»… según dónde esté de verdad (en horizontal, el riel va a la derecha).
 */

export const coarse = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * «toca» / «haz clic en». Con `en: false`, «toca» / «haz clic» (para «toca aquí», «toca para verlo»).
 * Con `cap`, en mayúscula.
 */
export function verbo(o: { cap?: boolean; en?: boolean } = {}): string {
  const v = coarse() ? 'toca' : o.en === false ? 'haz clic' : 'haz clic en';
  return o.cap ? v[0]!.toUpperCase() + v.slice(1) : v;
}

/** Nombre corto de cada pestaña (lo usa el dock con texto grande o en horizontal). */
export const TAB_SHORT: Record<string, string> = { Carretera: 'Calle', Construir: 'Obras', Derribar: 'Quitar' };

const TAB_LONG: Record<string, string> = { inspect: 'Mirar', road: 'Carretera', build: 'Construir', demolish: 'Derribar', menu: 'Pueblo' };

/** ¿Se ve ahora el nombre corto de las pestañas? */
function shortTabs(): boolean {
  const s = document.querySelector<HTMLElement>('#tab-road .tl-short');
  if (!s) return false;
  return getComputedStyle(s).display !== 'none';
}

/**
 * Nombre que se lee ahora en la pestaña (`road`, `build`, `demolish`, `inspect`, `menu`).
 * La de obras se nombra siempre como pestaña («Construir»/«Obras»), aunque enseñe la herramienta elegida.
 */
export function tabName(id: keyof typeof TAB_LONG): string {
  const long = TAB_LONG[id] ?? id;
  return shortTabs() ? (TAB_SHORT[long] ?? long) : long;
}

/** Lo que pone ahora la pestaña de obras si enseña una herramienta («Agua»), o null. */
export function buildTabShows(): string | null {
  const el = document.querySelector<HTMLElement>('#tab-build .tl-long');
  const t = el?.textContent?.trim();
  return t && t !== 'Construir' ? t : null;
}

/** Dónde está un elemento en la pantalla: «abajo», «arriba», «a la derecha», «a la izquierda». */
export function whereOf(sel: string, fallback = 'abajo'): string {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el || typeof innerWidth !== 'number') return fallback;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return fallback;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  // Un riel alto y estrecho a un lado (horizontal): manda el lado.
  if (r.height > r.width && r.height > innerHeight * 0.5) return cx > innerWidth / 2 ? 'a la derecha' : 'a la izquierda';
  if (cy > innerHeight * 0.6) return 'abajo';
  if (cy < innerHeight * 0.3) return 'arriba';
  return cx > innerWidth / 2 ? 'a la derecha' : 'a la izquierda';
}

/** Lo ya visto, por partida y en este navegador (`bitopolis.once.<token>`). Sin almacenamiento, vale para la sesión. */
const memo = new Map<string, Record<string, number>>();
function onceAll(token: string): Record<string, number> {
  let v = memo.get(token);
  if (v) return v;
  try {
    v = JSON.parse(localStorage.getItem(`bitopolis.once.${token}`) ?? '{}') as Record<string, number>;
    if (typeof v !== 'object' || v === null) v = {};
  } catch {
    v = {};
  }
  memo.set(token, v);
  return v;
}
export function onceGet(token: string, key: string): number | undefined {
  const v = onceAll(token)[key];
  return typeof v === 'number' ? v : undefined;
}
export function onceSet(token: string, key: string, value: number): void {
  const all = onceAll(token);
  all[key] = value;
  try {
    localStorage.setItem(`bitopolis.once.${token}`, JSON.stringify(all));
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
}
