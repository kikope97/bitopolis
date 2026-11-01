import type { Moment } from './album.ts';
import type { Crest } from './rank-core.ts';
import { rankLevel, rankName } from './rank.ts';
import type { Building, GameState, Medal, Records, YearStat } from './state.ts';
import { averageHappiness } from './tick.ts';
import type { StreetName } from './streets.ts';
import type { Weather } from './weather.ts';

/**
 * 2.3: foto de solo lectura del pueblo para el enlace de vista (`/v/<token>`).
 * Lista blanca: solo lo que se ve en el mapa y el resumen público. Nunca lleva
 * `rng`, `seed`, `ai`, `pending`, `decisionLog`, vecinos (ni sus pensamientos,
 * deudas o dinero), caja propia de las empresas ni nada del servidor.
 * Si añades un campo aquí, añádelo también a la lista del test (view.test.ts).
 */
export interface ViewBuilding {
  id: number;
  kind: Building['kind'];
  x: number;
  y: number;
  built: boolean;
  hasWater: boolean;
  hasPower: boolean;
  level?: number;
  size?: 2;
  rural?: boolean;
  crop?: Building['crop'];
  name?: string;
  damaged?: { cause?: 'fuego' | 'riada' };
  fire?: boolean;
  trash?: number;
}

export interface ViewSnapshot {
  view: 1;
  tick: number;
  map: { w: number; h: number; tiles: number[]; zones: number[]; terrain: number[] };
  buildings: ViewBuilding[];
  projects: { buildingId: number; workerDaysDone: number; workerDaysNeeded: number }[];
  landmarks: { kind: string; buildingId: number; phase: number; phases: number }[];
  dikes: number[];
  streetNames: Omit<StreetName, 'citizenId'>[];
  townhallLevel: number;
  weather: Weather;
  crest: Crest | null;
  history: YearStat[];
  records: Records;
  medals: Medal[];
  album: Moment[];
  summary: { name: string; population: number; rank: string; rankLevel: number; happiness: number; visitors: number };
}

/** Nombre del pueblo (otro módulo puede añadir `state.townName`; si no, Bitópolis). */
export function townNameOf(state: GameState): string {
  const n = (state as unknown as { townName?: unknown }).townName;
  return typeof n === 'string' && n.trim() ? n.trim().slice(0, 40) : 'Bitópolis';
}

/** Copia de lo que se puede enseñar (pura: no toca el estado). */
export function viewSnapshot(state: GameState): ViewSnapshot {
  const building = (b: Building): ViewBuilding => {
    const v: ViewBuilding = { id: b.id, kind: b.kind, x: b.x, y: b.y, built: b.built, hasWater: b.hasWater, hasPower: b.hasPower };
    if (b.level !== undefined) v.level = b.level;
    if (b.size !== undefined) v.size = b.size;
    if (b.rural) v.rural = true;
    if (b.crop !== undefined) v.crop = b.crop;
    if (b.name !== undefined) v.name = b.name;
    if (b.damaged) v.damaged = b.damaged.cause ? { cause: b.damaged.cause } : {};
    if (b.fire) v.fire = true;
    if (b.trash !== undefined) v.trash = b.trash;
    return v;
  };
  const m = state.map;
  return {
    view: 1,
    tick: state.tick,
    map: { w: m.w, h: m.h, tiles: [...m.tiles], zones: [...m.zones], terrain: [...m.terrain] },
    buildings: state.buildings.map(building),
    projects: state.projects.map((p) => ({ buildingId: p.buildingId, workerDaysDone: p.workerDaysDone, workerDaysNeeded: p.workerDaysNeeded })),
    landmarks: (state.landmarks ?? []).map((l) => ({ kind: l.kind, buildingId: l.buildingId, phase: l.phase, phases: l.phases })),
    dikes: [...(state.dikes ?? [])],
    streetNames: (state.streetNames ?? []).map((s) => ({ x: s.x, y: s.y, axis: s.axis, name: s.name, tick: s.tick })),
    townhallLevel: state.townhallLevel,
    weather: { kind: state.weather.kind, until: state.weather.until },
    crest: state.rank ? structuredCrest(state.rank.crest) : null,
    history: (state.history ?? []).map((y) => JSON.parse(JSON.stringify(y)) as YearStat),
    records: JSON.parse(JSON.stringify(state.records ?? {})) as Records,
    medals: (state.medals ?? []).map((x) => ({ id: x.id, tick: x.tick })),
    album: (state.album ?? []).map((a) => {
      const o: Moment = { tick: a.tick, kind: a.kind, text: a.text, x: a.x, y: a.y };
      if (a.caption) o.caption = a.caption;
      return o;
    }),
    summary: {
      name: townNameOf(state),
      population: state.citizens.length,
      rank: rankName(state),
      rankLevel: rankLevel(state),
      happiness: Math.round(averageHappiness(state)),
      visitors: state.tourism?.visitors ?? 0,
    },
  };
}

function structuredCrest(c: Crest): Crest {
  return { field: c.field, split: c.split, pieces: [...c.pieces], motto: c.motto };
}
