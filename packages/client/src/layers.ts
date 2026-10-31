import { coverageCtx, type GameState, homeSites, missingServices, pocketOf, radiusOf, type CoverageNeed, type NeedKey, SERVICE, trashServed, trashStateOf, truckRoutes } from '@bitopolis/sim';
import { PALETTE } from './palette.ts';
import { prefs } from './prefs.ts';
import { T } from './sprites.ts';

/**
 * Capas de datos (spec §5.1): felicidad, valor del suelo, cobertura de
 * servicios y contaminación. Cada nivel usa una trama distinta además del
 * color, para que el color nunca sea la única señal.
 */
export type LayerId = 'none' | 'missing' | 'happiness' | 'pocket' | 'land' | 'services' | 'pollution' | 'clean';

interface LayerDef {
  id: LayerId;
  label: string;
  /** Colores por nivel (0 = bajo … 3 = alto). */
  colors: [number, number, number, number];
  legend: { text: string; cls: string }[];
}

const GOOD: [number, number, number, number] = [2, 3, 4, 9];
const BAD: [number, number, number, number] = [12, 4, 3, 1];
/** Azul-amarillo (tritanopia): rampa de oscuro a claro sin azul ni amarillo. */
const GOOD_TRI: [number, number, number, number] = [1, 2, 20, 12];
const BAD_TRI: [number, number, number, number] = [12, 21, 2, 1];

/** Colores del nivel según el modo de daltonismo (la trama no cambia). */
function levelColor(colors: [number, number, number, number], lv: number): number {
  if (prefs().colorblind !== 'azul-amarillo') return colors[lv]!;
  return (colors === BAD ? BAD_TRI : GOOD_TRI)[lv]!;
}

export const LAYERS: LayerDef[] = [
  { id: 'none', label: 'Sin capa', colors: GOOD, legend: [] },
  // v1.7 (propuesta del creador): en cada vivienda y solar R, qué servicio le falta.
  { id: 'missing', label: 'Qué falta', colors: GOOD, legend: legend(['Faltan 3 o más', 'Faltan 2', 'Falta 1', 'Nada'], 'good') },
  { id: 'happiness', label: 'Felicidad de los vecinos', colors: GOOD, legend: legend(['Muy baja', 'Baja', 'Alta', 'Muy alta'], 'good') },
  // v1.9: cómo llegan a fin de mes los que viven en cada casa.
  { id: 'pocket', label: 'Bolsillo de los vecinos', colors: GOOD, legend: legend(['Endeudados', 'No llegan', 'Van justos', 'Holgados'], 'good') },
  { id: 'land', label: 'Valor del suelo', colors: GOOD, legend: legend(['Muy bajo', 'Bajo', 'Alto', 'Muy alto'], 'good') },
  { id: 'services', label: 'Cobertura de servicios', colors: GOOD, legend: legend(['Ninguno', '1 servicio', '2 servicios', '3 o más'], 'good') },
  { id: 'pollution', label: 'Contaminación', colors: BAD, legend: legend(['Limpio', 'Algo', 'Bastante', 'Mucha'], 'bad') },
  // 2.1: basura. Por dónde pasa el camión y cómo está cada edificio.
  { id: 'clean', label: 'Limpieza', colors: GOOD, legend: legend(['Ratas', 'Bolsas en la calle', 'Sin camión', 'Pasa el camión'], 'good') },
];

function legend(names: string[], kind: string) {
  return names.map((text, i) => ({ text, cls: `lv${i} ${kind}` }));
}

function values(state: GameState, layer: LayerId): (number | null)[] {
  const { w, h } = state.map;
  const n = w * h;
  if (layer === 'land') return state.fields.land;
  if (layer === 'pollution') return state.fields.pollution.map((v) => (v < 3 ? null : v));
  if (layer === 'missing') {
    const out: (number | null)[] = new Array(n).fill(null);
    for (const m of missingMarks(state)) {
      const weight = m.needs.reduce((a, x) => a + (x.status === 'falta' ? 1 : 0.5), 0);
      out[m.y * w + m.x] = weight === 0 ? 100 : weight <= 1 ? 60 : weight <= 2 ? 30 : 0;
    }
    return out;
  }
  if (layer === 'clean') {
    const out: (number | null)[] = new Array(n).fill(null);
    for (const r of truckRoutes(state)) for (const i of r.roads) out[i] = 90;
    const served = trashServed(state);
    const people = new Set<number>();
    for (const c of state.citizens) {
      if (c.homeId !== null) people.add(c.homeId);
      if (c.jobId !== null) people.add(c.jobId);
    }
    for (const b of state.buildings) {
      if (!b.built || (!people.has(b.id) && !b.trash)) continue;
      const st = trashStateOf(b);
      out[b.y * w + b.x] = st === 'ratas' ? 0 : st === 'bolsas' ? 30 : served.has(b.id) ? 100 : 60;
    }
    return out;
  }
  if (layer === 'services') {
    const kinds: Set<string>[] = Array.from({ length: n }, () => new Set());
    for (const b of state.buildings) {
      const s = SERVICE[b.kind];
      if (!s || !b.built) continue;
      // v1.8: el alcance crece con el nivel del servicio.
      const r = radiusOf(b);
      for (let y = Math.max(0, b.y - r); y <= Math.min(h - 1, b.y + r); y++) {
        for (let x = Math.max(0, b.x - r); x <= Math.min(w - 1, b.x + r); x++) {
          if (Math.abs(x - b.x) + Math.abs(y - b.y) <= r) kinds[y * w + x]!.add(b.kind);
        }
      }
    }
    return kinds.map((k) => Math.min(100, k.size * 34));
  }
  // Felicidad (o bolsillo): media de quienes viven en cada edificio.
  const out: (number | null)[] = new Array(n).fill(null);
  const sum = new Map<number, [number, number]>();
  const POCKET_VALUE = { endeudado: 0, no_llega: 30, justo: 60, holgado: 100 } as const;
  for (const c of state.citizens) {
    if (c.homeId === null) continue;
    const e = sum.get(c.homeId) ?? [0, 0];
    // Ronda 15: en el bolsillo cuenta el peor de la casa (la media escondía a los endeudados).
    if (layer === 'pocket') e[0] = e[1] === 0 ? POCKET_VALUE[pocketOf(c)] : Math.min(e[0], POCKET_VALUE[pocketOf(c)]);
    else e[0] += c.happiness;
    e[1]++;
    sum.set(c.homeId, e);
  }
  for (const b of state.buildings) {
    const e = sum.get(b.id);
    if (e) out[b.y * w + b.x] = layer === 'pocket' ? e[0] : e[0] / e[1];
  }
  return out;
}

let cache: { key: string; canvas: HTMLCanvasElement } | null = null;

/** Capa a escala 1 (una trama por casilla); se rehace cada día de juego. */
export function layerCanvas(state: GameState, layer: LayerId): HTMLCanvasElement | null {
  if (layer === 'none') return null;
  const key = `${layer}:${Math.floor(state.tick / 24)}:${state.buildings.length}:${prefs().colorblind}`;
  if (cache?.key === key) return cache.canvas;
  const def = LAYERS.find((l) => l.id === layer)!;
  const { w, h } = state.map;
  const c = cache?.canvas ?? document.createElement('canvas');
  c.width = w * T;
  c.height = h * T;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  const vals = values(state, layer);
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v === null || v === undefined) continue;
    const lv = v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3;
    const px = (i % w) * T;
    const py = Math.floor(i / w) * T;
    g.fillStyle = PALETTE[levelColor(def.colors, lv)]!;
    // Trama por nivel (bloques de 2×2): dispersa → media → damero → casi llena.
    for (let y = 0; y < T; y += 2) {
      for (let x = 0; x < T; x += 2) {
        const gx = x / 2;
        const gy = y / 2;
        const on =
          lv === 0 ? gx % 4 === 0 && gy % 4 === 0 : lv === 1 ? gx % 2 === 0 && gy % 2 === 0 : lv === 2 ? (gx + gy) % 2 === 0 : !(gx % 4 === 0 && gy % 4 === 0);
        if (on) g.fillRect(px + x, py + y, 2, 2);
      }
    }
  }
  cache = { key, canvas: c };
  return c;
}

/** Marca de felicidad sobre cada vivienda (nivel por trama y color). */
export function happinessMarks(state: GameState): { x: number; y: number; lv: number; color: number }[] {
  const vals = values(state, 'happiness');
  const out: { x: number; y: number; lv: number; color: number }[] = [];
  const { w } = state.map;
  vals.forEach((v, i) => {
    if (v === null || v === undefined) return;
    const lv = v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3;
    out.push({ x: i % w, y: Math.floor(i / w), lv, color: levelColor(GOOD, lv) });
  });
  return out;
}

/** Icono de cada necesidad (icons.ts). */
export const NEED_ICON: Record<NeedKey, string> = { agua: 'drop', luz: 'bolt', colegio: 'school', salud: 'health', policia: 'police', ocio: 'leaf', basuras: 'trash' };

let marksCache: { key: string; marks: { x: number; y: number; needs: CoverageNeed[] }[] } | null = null;
/** Lo que falta en cada vivienda o solar R (se rehace cada día de juego y al construir). */
export function missingMarks(state: GameState): { x: number; y: number; needs: CoverageNeed[] }[] {
  const key = `${Math.floor(state.tick / 24)}:${state.buildings.length}:${state.buildings.filter((b) => b.built).length}`;
  if (marksCache?.key === key) return marksCache.marks;
  const ctx = coverageCtx(state);
  const raw = homeSites(state).map((s) => ({ ...s, needs: missingServices(state, s.x, s.y, ctx) }));
  // Ronda 13: primero lo que falta (no lo lleno) y, entre eso, lo que falta en más casas del pueblo:
  // así el icono de cada casa señala la misma prioridad que la leyenda.
  const count = new Map<string, number>();
  for (const m of raw) for (const n of m.needs) if (n.status === 'falta') count.set(n.key, (count.get(n.key) ?? 0) + 1);
  const rank = (n: CoverageNeed) => (n.key === 'agua' || n.key === 'luz' ? -1e6 : 0) + (n.status === 'falta' ? -1000 - (count.get(n.key) ?? 0) : 0);
  const marks = raw.map((m) => ({ ...m, needs: [...m.needs].sort((a, b) => rank(a) - rank(b)) }));
  marksCache = { key, marks };
  return marks;
}
