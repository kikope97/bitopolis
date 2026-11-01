import { TICKS_PER_DAY, tickToDate } from '@bitopolis/shared';
import { BUILD, WEATHER } from './balance.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { chance, nextInt, type RngState } from './prng.ts';
import { addMemory } from './social.ts';
import { type Citizen, type GameState, inBounds, pushEvent, terrainAt } from './state.ts';
import { Terrain } from './terrain.ts';
import { floodChanceAt, floodRepairFactor, snowRoads } from './fire.ts';

/**
 * v1.7: estaciones y tiempo. Cada pocos días cambia el tiempo según la
 * estación. La nieve frena las obras y pide calefacción; el calor deja la
 * bomba de agua corta; las tormentas pueden desbordar el río.
 */
export type WeatherKind = 'sol' | 'nubes' | 'lluvia' | 'tormenta' | 'nieve' | 'calor';
export type Season = 'invierno' | 'primavera' | 'verano' | 'otono';
export interface Weather {
  kind: WeatherKind;
  /** Hasta cuándo dura (tick). */
  until: number;
}

export const WEATHER_TEXT: Record<WeatherKind, string> = {
  sol: 'Despejado',
  nubes: 'Nublado',
  lluvia: 'Lluvia',
  tormenta: 'Tormenta',
  nieve: 'Nieve',
  calor: 'Ola de calor',
};
export const SEASON_TEXT: Record<Season, string> = { invierno: 'Invierno', primavera: 'Primavera', verano: 'Verano', otono: 'Otoño' };

export function seasonOf(month: number): Season {
  if (month === 12 || month <= 2) return 'invierno';
  if (month <= 5) return 'primavera';
  if (month <= 8) return 'verano';
  return 'otono';
}

/** Probabilidades por estación (suman 1) y días que dura cada tipo. */
const TABLE: Record<Season, [WeatherKind, number][]> = {
  invierno: [['sol', 0.35], ['nubes', 0.25], ['lluvia', 0.15], ['nieve', 0.25]],
  primavera: [['sol', 0.4], ['nubes', 0.25], ['lluvia', 0.25], ['tormenta', 0.1]],
  verano: [['sol', 0.5], ['calor', 0.3], ['nubes', 0.1], ['tormenta', 0.1]],
  otono: [['sol', 0.3], ['nubes', 0.3], ['lluvia', 0.3], ['tormenta', 0.1]],
};
const DAYS: Record<WeatherKind, [number, number]> = { sol: [2, 5], nubes: [1, 3], lluvia: [1, 3], tormenta: [1, 1], nieve: [2, 4], calor: [3, 6] };

function roll(rng: RngState, season: Season): WeatherKind {
  let r = nextInt(rng, 0, 999) / 1000;
  for (const [k, p] of TABLE[season]) {
    if (r < p) return k;
    r -= p;
  }
  return 'sol';
}

/** Efectos del tiempo de hoy: obras, agua y luz (multiplicadores). */
export function weatherFx(state: GameState): { build: number; water: number; power: number } {
  const k = state.weather?.kind;
  return {
    build: k === 'nieve' ? WEATHER.snowBuild : 1,
    water: k === 'calor' ? WEATHER.heatWater : 1,
    power: k === 'nieve' ? WEATHER.snowPower : 1,
  };
}

/** Cada día: si toca, cambia el tiempo; la nieve cuesta quitarla. Se llama al empezar el día. */
export function weatherDay(state: GameState): void {
  if (!state.weather) return;
  if (state.tick >= state.weather.until) {
    const season = seasonOf(tickToDate(state.tick).month);
    let kind = roll(state.rng, season);
    // El primer mes, nada que frene el comienzo (la partida empieza en enero).
    if (state.tick < WEATHER.graceDays * TICKS_PER_DAY && (kind === 'nieve' || kind === 'calor' || kind === 'tormenta')) kind = 'nubes';
    const [a, b] = DAYS[kind];
    const prev = state.weather.kind;
    state.weather = { kind, until: state.tick + nextInt(state.rng, a, b) * TICKS_PER_DAY };
    if (kind !== prev) announce(state, kind);
    if (kind === 'tormenta') flood(state);
  }
  if (state.weather.kind === 'nieve') {
    // 2.1: en el radio de la protección civil, el quitanieves cuesta la mitad.
    const roads = snowRoads(state);
    const cost = Math.min(state.treasury > 0 ? state.treasury : 0, Math.round(roads * WEATHER.snowPerRoad));
    if (cost > 0) transfer(state, TREASURY, OUTSIDE, cost, 'quitanieves');
  }
}

function announce(state: GameState, kind: WeatherKind): void {
  if (kind === 'nieve') pushEvent(state, 'info', 'Nieva: las obras van más despacio, la central trabaja más (calefacción) y hay que quitar la nieve de las calles');
  else if (kind === 'calor') pushEvent(state, 'info', 'Ola de calor: la bomba de agua da para menos casas. Los parques dan sombra');
  else if (kind === 'tormenta') pushEvent(state, 'info', 'Tormenta sobre el pueblo');
}

/** Edificios a la orilla del río (casillas vecinas, también en diagonal). */
export function riverBuildings(state: GameState): GameState['buildings'] {
  return state.buildings.filter((b) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && inBounds(state, b.x + dx, b.y + dy) && terrainAt(state, b.x + dx, b.y + dy) === Terrain.River) return true;
      }
    }
    return false;
  });
}

/** La tormenta puede desbordar el río: los edificios de la orilla se anegan y el ayuntamiento repara. */
export function flood(state: GameState): void {
  const near = riverBuildings(state).filter((b) => b.built);
  if (!near.length) return;
  // 2.1: los diques y la protección civil frenan la riada (se tira el mismo dado para todos).
  const hit: GameState['buildings'] = [];
  let avoided = 0;
  for (const b of near) {
    if (!chance(state.rng, WEATHER.floodChance)) continue;
    // El dado ya salió: lo que lo evita es la protección (determinista con el mismo dado del motor).
    if (floodChanceAt(state, b, 1) < 1 && !chance(state.rng, floodChanceAt(state, b, 1))) avoided++;
    else hit.push(b);
  }
  if (avoided && state.emergencies) state.emergencies.floodsAvoided += avoided;
  if (!hit.length) {
    pushEvent(state, 'info', avoided ? `El río crece con la tormenta: los diques y la protección civil evitan que se aneguen ${avoided === 1 ? 'un edificio' : `${avoided} edificios`}` : 'El río crece con la tormenta, pero no se desborda');
    return;
  }
  let cost = 0;
  const people = new Set<Citizen>();
  for (const b of hit) {
    const spec = BUILD[b.kind as keyof typeof BUILD];
    cost += Math.round((spec?.materials ?? 2_000) * WEATHER.floodRepair * floodRepairFactor(state, b));
    for (const c of state.citizens) if (c.homeId === b.id || c.jobId === b.id) people.add(c);
  }
  transfer(state, TREASURY, OUTSIDE, cost, 'reparaciones (inundación)');
  for (const c of people) addMemory(state, c, 'inundacion', 3, -3);
  pushEvent(
    state,
    'info',
    `El río se desborda: ${hit.length === 1 ? 'se anega un edificio' : `se anegan ${hit.length} edificios`} de la orilla. Reparaciones: ${cost} €`,
    { ref: hit[0]!.id },
  );
}

/** Lo que el tiempo de hoy le hace a un vecino (calor sin sombra cerca). */
export function weatherMood(state: GameState, home: { x: number; y: number } | undefined): { label: string; value: number } | null {
  if (state.weather?.kind !== 'calor' || !home) return null;
  const shade = state.buildings.some((b) => b.built && (b.kind === 'park' || b.kind === 'plaza') && Math.abs(b.x - home.x) + Math.abs(b.y - home.y) <= 5);
  return shade ? null : { label: 'Ola de calor sin sombra cerca', value: -WEATHER.heatMood };
}
