import {
  barrioOf,
  buildingAt,
  CARE,
  type BuildingKind,
  BUILD_NAMES,
  type CoverageInfo,
  coverageCtx,
  coverageOf,
  diamondTiles,
  type GameState,
  hasReach,
  homeSites,
  NEED_KINDS,
  NEED_LABEL,
  type NeedKey,
  needStatus,
  radiusOf,
  serviceReach,
  serviceSaturation,
  siteNetworkWarn,
} from '@bitopolis/sim';
import { plural } from './i18n.ts';

/**
 * 2.6 «Lo básico» (queja de un jugador): la zona que cubre cada servicio, a
 * cuántas casas da servicio y su máximo; al colocarlo, lo que ganaría; y en
 * «Qué falta», filtrar por un servicio. Los números salen de `coverageOf`
 * (sim/src/service-reach.ts), el mismo cálculo que el motor.
 */
export interface ReachOverlay {
  /** Firma para la caché del tinte. */
  sig: string;
  /** Casillas tintadas: `full` con otra trama (lleno). */
  areas: { tiles: number[]; full: boolean }[];
  /** Las zonas son calles (red o ruta): se tinta la calle entera, más fuerte. */
  roads: boolean;
  /** Bordes de rombo: el propio (fuerte) y los de sus iguales (tenues, a trazos). */
  borders: { x: number; y: number; r: number; ghost: boolean }[];
  /** ✓ cubierta, ✗ sin servicio dentro, + la gana al colocarlo, • conectado a la red o a la ruta. */
  marks: { x: number; y: number; t: 'ok' | 'no' | 'plus' | 'link' }[];
  /** Velo oscuro fuera de las zonas (filtro de «Qué falta»). */
  veil: boolean;
}

const posOf = (state: GameState, id: number) => state.buildings.find((b) => b.id === id);

/** Nombre corto de un servicio para los textos. */
export function kindName(kind: string): string {
  return (BUILD_NAMES[kind] ?? kind).toLowerCase();
}
/** 2.8 (ronda 24): artículo de cada edificio (antes «el comisaría»). */
const FEMININE = new Set(['water', 'power', 'chapel', 'library', 'jail', 'civilprotection', 'police', 'plaza', 'shop', 'farm', 'station', 'fair', 'cathedral', 'bigfactory', 'nursery', 'residence', 'busstation', 'sewage', 'vpo', 'coop']);
const PLURAL = new Set(['res', 'solar']);
/** «el colegio del Centro», «la comisaría de la Huerta»… */
export function whereName(state: GameState, b: { kind: string; x: number; y: number }): string {
  const art = PLURAL.has(b.kind) ? 'las' : FEMININE.has(b.kind) ? 'la' : 'el';
  return `${art} ${kindName(b.kind)} ${barrioOf(state, b.x, b.y)}`;
}

/** Zona de un servicio ya puesto (al tocarlo). */
export function overlayFor(state: GameState, info: CoverageInfo): ReachOverlay {
  const marks: ReachOverlay['marks'] = [];
  for (const id of info.homesInReach) {
    const b = posOf(state, id);
    if (b) marks.push({ x: b.x, y: b.y, t: 'ok' });
  }
  const homes = new Set(info.homesInReach);
  for (const s of info.lacking) if (!marks.some((m) => m.x === s.x && m.y === s.y && m.t === 'no')) marks.push({ x: s.x, y: s.y, t: 'no' });
  // Lo marcado ✓ que en realidad está «falta/lleno» (otro lo atiende y está lleno): queda ✗.
  const bad = new Set(info.lacking.map((s) => `${s.x},${s.y}`));
  for (const m of marks) if (m.t === 'ok' && bad.has(`${m.x},${m.y}`)) m.t = 'no';
  // Ronda 22: también ✗ en las casas del pueblo a las que les falta este servicio (fuera de su radio).
  if (info.mode === 'radio' && info.need) {
    const ctx = coverageCtx(state);
    const seen = new Set(marks.map((m) => `${m.x},${m.y}`));
    for (const s of homeSites(state)) if (!seen.has(`${s.x},${s.y}`) && needStatus(state, info.need, s.x, s.y, ctx)) marks.push({ x: s.x, y: s.y, t: 'no' });
  }
  if (info.mode !== 'radio') {
    for (const id of info.linked) {
      if (homes.has(id)) continue;
      const b = posOf(state, id);
      if (b) marks.push({ x: b.x, y: b.y, t: 'link' });
    }
  }
  const borders: ReachOverlay['borders'] = [];
  if (info.mode === 'radio') {
    for (const o of info.overlaps) {
      const ob = posOf(state, o.id);
      if (ob) borders.push({ x: o.x, y: o.y, r: radiusFor(ob), ghost: true });
    }
    const self = info.id !== null ? posOf(state, info.id) : undefined;
    if (self) borders.push({ x: self.x, y: self.y, r: info.radius, ghost: false });
  }
  return {
    sig: `sel:${info.kind}:${info.id}:${info.tiles.length}:${state.tick >> 5}:${info.capacity?.full}`,
    areas: [{ tiles: info.tiles, full: !!info.capacity?.full }],
    roads: info.mode !== 'radio',
    borders,
    marks,
    veil: false,
  };
}

const radiusFor = (b: { kind: string; level?: number }) => (b.kind === 'nursery' ? CARE.nursery.radius : radiusOf(b as never));

/** Vista previa al colocar: el rombo nuevo, las casas que lo ganan (+) y los rombos tenues de los iguales. */
export function previewOverlay(state: GameState, info: CoverageInfo, x: number, y: number): ReachOverlay {
  const marks: ReachOverlay['marks'] = info.gains.map((g) => ({ x: g.x, y: g.y, t: 'plus' as const }));
  const borders: ReachOverlay['borders'] = [];
  if (info.mode === 'radio') {
    for (const b of state.buildings) {
      if (b.id === info.id || !b.built || b.damaged || !sameGroup(b.kind, info.kind)) continue;
      borders.push({ x: b.x, y: b.y, r: radiusFor(b), ghost: true });
    }
    borders.push({ x, y, r: info.radius, ghost: false });
  }
  return { sig: `pre:${info.kind}:${x},${y}:${info.tiles.length}:${state.tick >> 5}`, areas: [{ tiles: info.tiles, full: false }], roads: info.mode !== 'radio', borders, marks, veil: false };
}

function sameGroup(a: string, b: string): boolean {
  if (a === b) return true;
  const ocio = NEED_KINDS.ocio;
  const luz = ['power', 'solar', 'wind'];
  return (ocio.includes(a) && ocio.includes(b)) || (luz.includes(a) && luz.includes(b));
}

/** Filtro de «Qué falta» por un servicio: las zonas de todos los que lo dan (las llenas, con otra trama), velo fuera y ✗ en las casas sin él. */
export function filterOverlay(state: GameState, key: NeedKey): ReachOverlay {
  const ctx = coverageCtx(state);
  const areas: ReachOverlay['areas'] = [];
  const borders: ReachOverlay['borders'] = [];
  let roads = false;
  const kinds = key === 'luz' ? ['power', 'solar', 'wind'] : NEED_KINDS[key];
  for (const b of state.buildings) {
    if (!kinds.includes(b.kind) || !b.built || b.damaged) continue;
    if (key === 'agua' || key === 'luz' || key === 'basuras') {
      const info = serviceReach(state, b, ctx);
      areas.push({ tiles: info.tiles, full: !!info.capacity?.full });
      roads = true;
    } else {
      const r = radiusOf(b);
      // Bomberos sin cisterna: la colina no cuenta (se tinta solo lo que de verdad cubre).
      const tiles = diamondTiles(state, b.x, b.y, r).filter((i) => b.kind !== 'firestation' || (b.level ?? 1) >= 2 || state.map.terrain?.[i] !== 3);
      areas.push({ tiles, full: serviceSaturation(state, b.kind, b.id) < 0.9 });
      borders.push({ x: b.x, y: b.y, r, ghost: false });
    }
  }
  const marks: ReachOverlay['marks'] = [];
  if (ctx.active.includes(key)) for (const s of homeSites(state)) if (needStatus(state, key, s.x, s.y, ctx)) marks.push({ x: s.x, y: s.y, t: 'no' });
  return { sig: `flt:${key}:${state.tick >> 5}:${state.buildings.length}:${areas.length}`, areas, roads, borders, marks, veil: true };
}

/** El servicio que se construye para cada necesidad (la leyenda de «Qué falta»). */
export const TOOL_FOR_NEED: Record<NeedKey, BuildingKind> = { agua: 'water', luz: 'power', colegio: 'school', salud: 'clinic', policia: 'police', ocio: 'park', bomberos: 'firestation', basuras: 'cleanpoint' };

const pct = (used: number, of: number) => Math.round((100 * used) / Math.max(1, of));

/**
 * La línea grande de la ficha: «Da servicio a 12 viviendas (34 vecinos) ·
 * atiende a 41 de un máximo de 60 alumnos (68 %)».
 */
export function reachLine(state: GameState, info: CoverageInfo): { main: string; sub: string } {
  const homes = plural(info.homesServed.length, 'vivienda', 'viviendas');
  const people = plural(info.peopleServed, 'vecino', 'vecinos');
  const cap = info.capacity;
  const subs: string[] = [];
  if (info.mode === 'red') {
    const what = info.kind === 'water' ? 'agua' : 'luz';
    const main = `Da ${what} a ${cap!.used} de ${cap!.of} edificios${cap!.full ? ' (al máximo)' : ''}`;
    subs.push(`${homes} con ${what} gracias a ella (${people})`);
    if (info.lacking.length) subs.push(`${plural(info.lacking.length, 'casa', 'casas')} de su red sin ${what}: hace falta otra ${info.kind === 'water' ? 'bomba' : 'central'}`);
    return { main, sub: subs.join(' · ') };
  }
  if (info.mode === 'ruta') {
    const main = `Su camión recoge en ${plural(info.linked.length, 'edificio', 'edificios')} (${homes}) · recorre ${cap!.used} de ${cap!.of} calles${cap!.full ? ' (al máximo)' : ''}`;
    const full = info.lacking.filter((l) => l.status === 'lleno').length;
    if (full) subs.push(`${plural(full, 'casa', 'casas')} de sus calles se quedan sin camión: amplíalo o pon otro punto limpio`);
    return { main, sub: subs.join(' · ') };
  }
  if (cap && (cap.unit === 'vecinos' || cap.unit === 'alumnos')) {
    const who = cap.unit === 'alumnos' ? 'alumnos' : 'vecinos';
    const main = `${homes} · ${cap.used} de ${cap.of} ${who} (${cap.full ? 'lleno al ' : ''}${pct(cap.used, cap.of)} %)`;
    if (cap.unit === 'alumnos') subs.push(`en esas viviendas hay ${people}; cada vecino y cada hijo cuentan como alumno`);
    else subs.push(`en esas viviendas viven ${people}`);
    const far = info.homesInReach.length - info.homesServed.length;
    if (far > 0) subs.push(`${plural(far, 'otra', 'otras')} en su radio van a otro más cercano`);
    if (info.lacking.length) subs.push(`${plural(info.lacking.length, 'casa', 'casas')} de su zona lo tienen lleno`);
    return { main, sub: subs.join(' · ') };
  }
  const main = `${plural(info.homesInReach.length, 'vivienda', 'viviendas')} en su radio de ${info.radius} casillas (${people})`;
  if (cap?.unit === 'plazas') subs.push(`${cap.used} de ${cap.of} plazas ocupadas`);
  const no = info.lacking.filter((l) => l.status === 'falta').length;
  if (info.kind === 'firestation' && no) subs.push(`${plural(no, 'casa', 'casas')} de la colina sin cubrir hasta la cisterna (nivel 2)`);
  if (info.need && info.townLacking) subs.push(`${plural(info.townLacking, 'casa', 'casas')} del pueblo siguen sin ${NEED_LABEL[info.need]} cerca`);
  else if (info.need) subs.push(`a ninguna casa del pueblo le falta ${NEED_LABEL[info.need]}`);
  return { main, sub: subs.join(' · ') };
}

/** Las líneas de la barra al colocar: «+14 casas con colegio · atenderá a ~38 de 60», solapes y llenos. */
export function placeLines(state: GameState, what: string, x: number, y: number): { info: CoverageInfo; gain: string; warn: string[]; none: boolean } | null {
  if (what === 'road' || !hasReach(what)) return null;
  const kind = what as BuildingKind;
  const info = coverageOf(state, kind, x, y);
  const label = info.need ? NEED_LABEL[info.need] : kindName(kind);
  const cap = info.capacity;
  // Ronda 22: solo cuentan las viviendas hechas; los solares vacíos van aparte.
  const homes = info.gains.filter((g) => !!buildingAt(state, g.x, g.y)).length;
  const lots = info.gains.length - homes;
  let gain = `+${plural(homes, 'casa', 'casas')} con ${label}${lots ? ` (y ${plural(lots, 'solar', 'solares')})` : ''}`;
  if (info.mode === 'red') gain += ` · dará ${info.kind === 'water' ? 'agua' : 'luz'} a ${cap!.used} de ${cap!.of} edificios`;
  else if (info.mode === 'ruta') gain += ` · recorrerá ${cap!.used} de ${cap!.of} calles`;
  else if (cap && cap.unit !== 'plazas') gain += ` · atenderá a ~${cap.used} de ${cap.of}`;
  else gain += ` · ${plural(info.homesInReach.length, 'vivienda', 'viviendas')} en su radio`;
  const warn: string[] = siteNetworkWarn(state, kind, x, y);
  const over = info.overlaps.filter((o) => o.shared > 0 || info.mode !== 'radio').sort((a, b) => b.shared - a.shared)[0];
  if (over && info.mode === 'radio') warn.push(`⚠ Se solapa con ${whereName(state, over)} (${plural(over.shared, 'casa', 'casas')} en común)`);
  for (const o of info.overlaps) if (o.full && o.used !== undefined && o.of !== undefined) warn.push(`${cap0(whereName(state, o))} está ${FEMININE.has(o.kind) ? 'llena' : 'lleno'} (${o.used}/${o.of})`);
  return { info, gain, warn: warn.slice(0, 2), none: homes === 0 };
}
const cap0 = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;
