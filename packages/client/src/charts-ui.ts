import { tickToDate } from '@bitopolis/shared';
import { type GameState, RECORD_KEYS, type RecordKey, recordText, yearOfMonth } from '@bitopolis/sim';
import { money, MONTHS, plural } from './i18n.ts';
import { PALETTE } from './palette.ts';
import { h, sheet } from './ui.ts';

/**
 * 2.3: «Historia» (Pueblo › Gente). Gráfica de 328×160 con la paleta: una
 * serie (vecinos, caja, felicidad, paro, empresas, visitantes) en 12 meses,
 * 5 años o todo. Los meses salen de `stats` (los últimos 120); «Todo» y los
 * visitantes, de `history` (un punto por año con su mínimo y su máximo).
 * Un dedo (o el ratón, o las flechas) sobre la gráfica enseña el valor.
 */

type SeriesId = 'population' | 'treasury' | 'happiness' | 'jobless' | 'businesses' | 'visitors';
type RangeId = '12' | '60' | 'todo';

const SERIES: { id: SeriesId; label: string; color: number; band: number }[] = [
  { id: 'population', label: 'Vecinos', color: 10, band: 8 },
  { id: 'treasury', label: 'Caja', color: 4, band: 17 },
  { id: 'happiness', label: 'Felicidad', color: 5, band: 24 },
  { id: 'jobless', label: 'Paro', color: 3, band: 16 },
  { id: 'businesses', label: 'Empresas', color: 61, band: 1 },
  { id: 'visitors', label: 'Visitantes', color: 63, band: 25 },
];
const RANGES: { id: RangeId; label: string; months: number }[] = [
  { id: '12', label: '12 meses', months: 12 },
  { id: '60', label: '5 años', months: 60 },
  { id: 'todo', label: 'Todo', months: Infinity },
];

const RECORD_LABEL: Record<RecordKey, string> = {
  population: 'Más vecinos',
  treasury: 'Más caja',
  happiness: 'Más felicidad',
  businesses: 'Más empresas',
  visitors: 'Más visitantes',
  income: 'Mejor mes de ingresos',
};

export interface ChartPoint {
  label: string;
  v: number;
  min?: number;
  max?: number;
}

const W = 328;
const H = 160;
const PAD = { l: 8, r: 8, t: 22, b: 20 };

export function formatValue(series: SeriesId, v: number): string {
  if (series === 'treasury') return money(v);
  if (series === 'happiness') return String(v);
  if (series === 'population') return plural(v, 'vecino', 'vecinos');
  if (series === 'jobless') return plural(v, 'en paro', 'en paro');
  if (series === 'businesses') return plural(v, 'empresa', 'empresas');
  return plural(v, 'visitante', 'visitantes');
}

const monthLabel = (m: number) => `${MONTHS[(Math.max(1, m) - 1) % 12]} A${yearOfMonth(m)}`;

/** Los puntos de una serie en un rango (por meses si se puede; si no, por años). */
export function chartPoints(state: GameState, series: SeriesId, range: RangeId): { points: ChartPoint[]; yearly: boolean } {
  const months = RANGES.find((r) => r.id === range)!.months;
  if (range === 'todo' || series === 'visitors') {
    const years = state.history ?? [];
    const take = range === 'todo' ? years : years.slice(-Math.ceil(months / 12));
    return { yearly: true, points: take.map((y) => ({ label: `Año ${y.year}`, v: y[series].avg, min: y[series].min, max: y[series].max })) };
  }
  const key = series as Exclude<SeriesId, 'visitors'>;
  return { yearly: false, points: state.stats.slice(-months).map((m) => ({ label: monthLabel(m.month), v: m[key] ?? 0 })) };
}

/** Texto para el lector de pantalla: de cuánto a cuánto, ahora y el máximo. */
export function chartSummary(series: SeriesId, range: RangeId, points: ChartPoint[], yearly: boolean): string {
  const s = SERIES.find((x) => x.id === series)!;
  const r = RANGES.find((x) => x.id === range)!;
  if (!points.length) return `${s.label}: aún no hay datos (se apuntan al cerrar cada mes).`;
  const last = points.at(-1)!;
  let top = points[0]!;
  let low = points[0]!;
  for (const p of points) {
    if ((p.max ?? p.v) > (top.max ?? top.v)) top = p;
    if ((p.min ?? p.v) < (low.min ?? low.v)) low = p;
  }
  return `${s.label}, ${r.label.toLowerCase()}${yearly ? ' (media de cada año)' : ''}: ${points.length === 1 ? 'un solo punto' : `de ${formatValue(series, points[0]!.v)} a ${formatValue(series, last.v)}`}. Máximo ${formatValue(series, top.max ?? top.v)} (${top.label}); mínimo ${formatValue(series, low.min ?? low.v)} (${low.label}).`;
}

function draw(canvas: HTMLCanvasElement, series: SeriesId, points: ChartPoint[], at: number | null): void {
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  if (canvas.width !== W * dpr) {
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = SERIES.find((x) => x.id === series)!;
  g.fillStyle = PALETTE[0];
  g.fillRect(0, 0, W, H);
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  g.font = '11px system-ui, sans-serif';
  if (!points.length) {
    g.fillStyle = PALETTE[13];
    g.fillText('Aún no hay datos: se apuntan al cerrar cada mes', PAD.l, H / 2);
    return;
  }
  let lo = Math.min(...points.map((p) => p.min ?? p.v));
  let hi = Math.max(...points.map((p) => p.max ?? p.v));
  if (series === 'happiness') {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 100);
  } else if (lo >= 0) lo = 0;
  if (hi === lo) hi = lo + 1;
  const x = (i: number) => PAD.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;
  // Rejilla: arriba, abajo y el cero si hay negativos.
  g.fillStyle = PALETTE[15];
  for (const v of [lo, hi, ...(lo < 0 && hi > 0 ? [0] : [])]) g.fillRect(PAD.l, Math.round(y(v)), iw, 1);
  // Banda del mínimo al máximo (por años).
  if (points.some((p) => p.min !== undefined)) {
    g.fillStyle = PALETTE[s.band]!;
    points.forEach((p, i) => {
      const top = y(p.max ?? p.v);
      const bot = y(p.min ?? p.v);
      const bw = points.length === 1 ? 12 : Math.max(3, Math.min(14, iw / points.length - 2));
      g.fillRect(Math.round(x(i) - bw / 2), Math.round(top), Math.round(bw), Math.max(2, Math.round(bot - top)));
    });
  }
  g.strokeStyle = PALETTE[s.color]!;
  g.lineWidth = 2;
  g.beginPath();
  points.forEach((p, i) => (i ? g.lineTo(x(i), y(p.v)) : g.moveTo(x(i), y(p.v))));
  g.stroke();
  if (points.length === 1) {
    g.fillStyle = PALETTE[s.color]!;
    g.fillRect(x(0) - 3, y(points[0]!.v) - 3, 6, 6);
  }
  // Máximo y mínimo de la escala, y las fechas de los extremos.
  g.fillStyle = PALETTE[13];
  g.textBaseline = 'top';
  g.fillText(formatValue(series, hi), PAD.l, 4);
  g.textBaseline = 'bottom';
  g.fillText(points[0]!.label, PAD.l, H - 2);
  const endLabel = points.at(-1)!.label;
  g.fillText(endLabel, W - PAD.r - g.measureText(endLabel).width, H - 2);
  if (at !== null && points[at]) {
    const p = points[at]!;
    g.fillStyle = PALETTE[12];
    g.fillRect(Math.round(x(at)), PAD.t, 1, ih);
    g.fillRect(Math.round(x(at)) - 3, Math.round(y(p.v)) - 3, 7, 7);
    g.fillStyle = PALETTE[s.color]!;
    g.fillRect(Math.round(x(at)) - 2, Math.round(y(p.v)) - 2, 5, 5);
  }
}

/** Hoja «Historia»: gráfica, chips de serie y de rango, y récords debajo. */
export function openHistory(state: GameState): void {
  let series: SeriesId = 'population';
  let range: RangeId = '12';
  let at: number | null = null;
  let data = chartPoints(state, series, range);

  const canvas = h('canvas', { class: 'history-chart', role: 'img', tabindex: '0', width: String(W), height: String(H) }) as HTMLCanvasElement;
  const readout = h('p', { class: 'history-readout', 'aria-live': 'polite' });
  const note = h('p', { class: 'muted small history-note' });
  const seriesBox = h('div', { class: 'seg history-series', role: 'radiogroup', 'aria-label': 'Qué se ve' });
  const rangeBox = h('div', { class: 'seg history-range', role: 'radiogroup', 'aria-label': 'Cuánto tiempo' });

  const showAt = () => {
    const p = at !== null ? data.points[at] : null;
    readout.textContent = p ? `${p.label}: ${formatValue(series, p.v)}${p.min !== undefined && p.max !== p.min ? ` (de ${formatValue(series, p.min)} a ${formatValue(series, p.max ?? p.v)})` : ''}` : data.points.length ? 'Toca la gráfica para ver cada valor.' : '';
    draw(canvas, series, data.points, at);
  };
  const refresh = () => {
    data = chartPoints(state, series, range);
    at = null;
    canvas.setAttribute('aria-label', chartSummary(series, range, data.points, data.yearly));
    note.textContent = data.yearly ? (series === 'visitors' && range !== 'todo' ? 'Los visitantes se apuntan por años: media, con la barra del mínimo al máximo.' : 'Un punto por año: la media, con la barra del mínimo al máximo.') : '';
    for (const b of seriesBox.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.id === series));
    for (const b of rangeBox.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.id === range));
    showAt();
  };
  for (const s of SERIES) {
    const b = h('button', { class: 'seg-btn', role: 'radio', 'data-id': s.id }, s.label);
    b.addEventListener('click', () => {
      series = s.id;
      refresh();
    });
    seriesBox.append(b);
  }
  for (const r of RANGES) {
    const b = h('button', { class: 'seg-btn', role: 'radio', 'data-id': r.id }, r.label);
    b.addEventListener('click', () => {
      range = r.id;
      refresh();
    });
    rangeBox.append(b);
  }
  const pick = (e: PointerEvent) => {
    const n = data.points.length;
    if (!n) return;
    const r = canvas.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / Math.max(1, r.width)) * W;
    const i = n === 1 ? 0 : Math.round(((fx - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1));
    at = Math.max(0, Math.min(n - 1, i));
    showAt();
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    pick(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || e.buttons) pick(e);
  });
  canvas.addEventListener('keydown', (e) => {
    const n = data.points.length;
    if (!n || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    at = Math.max(0, Math.min(n - 1, (at ?? n - 1) + (e.key === 'ArrowLeft' ? -1 : 1)));
    showAt();
  });

  sheet(
    'Historia',
    h('p', { class: 'muted small' }, state.history?.length ? `Bitópolis lleva ${plural(state.history.length, 'año', 'años')} de historia.` : 'La historia empieza a apuntarse al cerrar el primer mes.'),
    seriesBox,
    h('div', { class: 'history-wrap' }, canvas),
    readout,
    note,
    rangeBox,
    h('h3', {}, 'Récords del pueblo'),
    recordsList(state),
  );
  refresh();
}

function recordsList(state: GameState): HTMLElement {
  const items = RECORD_KEYS.filter((k) => state.records?.[k]).map((k) => {
    const r = state.records[k]!;
    const d = tickToDate(Math.max(0, r.tick - 1));
    return h('li', { class: 'history-record' }, h('strong', {}, RECORD_LABEL[k]), ` · ${recordText(k, r.v)}`, h('span', { class: 'muted' }, ` · ${MONTHS[d.month - 1]} del año ${d.year}`));
  });
  return items.length ? h('ul', { class: 'history-records' }, ...items) : h('p', { class: 'muted' }, 'Aún no hay récords: se apuntan al cerrar cada mes.');
}
