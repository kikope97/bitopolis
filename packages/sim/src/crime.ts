import { TICKS_PER_DAY } from '@bitopolis/shared';
import { CRIME, SERVICE } from './balance.ts';
import { OUTSIDE, transfer } from './money.ts';
import { chance } from './prng.ts';
import { addMemory } from './social.ts';
import { type Building, type GameState, pushEvent } from './state.ts';

/**
 * v1.8: delincuencia. Las tiendas sufren robos según la delincuencia de la
 * zona. Si hay una comisaría cerca con calabozo libre, la policía detiene al
 * ladrón y se recupera lo robado. Los detenidos pasan a la cárcel si la hay;
 * si no, ocupan el calabozo un mes y, con los calabozos llenos, ya no se puede
 * detener a nadie más.
 */
export interface Justice {
  /** Calabozos ocupados: comisaría, hasta cuándo y si espera traslado a la cárcel. */
  cells: { stationId: number; until: number; toJail: boolean }[];
  /** Presos en la cárcel (hasta cuándo). */
  jail: number[];
  /** Puntos calientes: robos sin resolver suben la inseguridad alrededor un tiempo. */
  hot: { x: number; y: number; until: number }[];
  robberies: number;
  arrests: number;
  /** Último aviso de calabozos llenos (para no repetirlo cada día). */
  fullWarned: number;
}

export function emptyJustice(): Justice {
  return { cells: [], jail: [], hot: [], robberies: 0, arrests: 0, fullWarned: -1 };
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Comisarías que cubren un sitio (las más cercanas primero). */
export function stationsFor(state: GameState, x: number, y: number): Building[] {
  const r = SERVICE.police?.radius ?? 10;
  return state.buildings.filter((b) => b.kind === 'police' && b.built && dist(b, { x, y }) <= r).sort((a, b) => dist(a, { x, y }) - dist(b, { x, y }));
}

export function cellsUsed(state: GameState, stationId: number): number {
  return (state.justice?.cells ?? []).filter((c) => c.stationId === stationId).length;
}

export function jailCapacity(state: GameState): number {
  return state.buildings.filter((b) => b.kind === 'jail' && b.built).length * CRIME.jailCapacity;
}

/**
 * Intenta detener a `n` personas en (x, y). Devuelve cuántas se detienen.
 * Si hay comisaría cerca pero los calabozos están llenos, avisa (una vez al mes).
 */
export function tryArrest(state: GameState, x: number, y: number, n: number): number {
  const j = state.justice;
  if (!j) return 0;
  const stations = stationsFor(state, x, y);
  let done = 0;
  for (const s of stations) {
    while (done < n && cellsUsed(state, s.id) < CRIME.cellsPerStation) {
      // Con cárcel y sitio, a los pocos días se les traslada; sin cárcel, cumplen en el calabozo.
      const toJail = j.jail.length + j.cells.filter((c) => c.toJail).length < jailCapacity(state);
      j.cells.push({ stationId: s.id, until: state.tick + (toJail ? CRIME.transferDays : CRIME.cellDays) * TICKS_PER_DAY, toJail });
      done++;
    }
  }
  j.arrests += done;
  if (done < n && stations.length && state.tick - j.fullWarned > 30 * TICKS_PER_DAY) {
    j.fullWarned = state.tick;
    pushEvent(
      state,
      'crime',
      jailCapacity(state)
        ? 'Los calabozos y la cárcel están llenos: la policía no puede detener a nadie más'
        : 'Los calabozos de la comisaría están llenos: la policía no puede detener a nadie más. Hace falta una cárcel',
    );
  }
  return done;
}

/** Cada día: traslados y salidas, y robos en las tiendas. */
export function crimeDay(state: GameState): void {
  const j = state.justice;
  if (!j) return;
  // Salen del calabozo: a la cárcel (si tocaba y hay sitio) o a la calle.
  for (const c of [...j.cells]) {
    if (c.until > state.tick) continue;
    j.cells = j.cells.filter((x) => x !== c);
    if (c.toJail && j.jail.length < jailCapacity(state)) j.jail.push(state.tick + CRIME.jailDays * TICKS_PER_DAY);
  }
  j.jail = j.jail.filter((t) => t > state.tick).slice(0, jailCapacity(state));
  j.hot = j.hot.filter((h) => h.until > state.tick);
  if (state.citizens.length < CRIME.minPop) return;
  for (const b of state.buildings) {
    if (b.kind !== 'shop' || !b.built || b.damaged) continue;
    const crime = state.fields.crime[b.y * state.map.w + b.x] ?? 0;
    const p = CRIME.robBase * Math.max(0, crime - CRIME.robThreshold) / 50;
    if (!chance(state.rng, p)) continue;
    robbery(state, b);
  }
}

function robbery(state: GameState, b: Building): void {
  const j = state.justice;
  j.robberies++;
  const name = b.name ?? 'una tienda';
  const caught = tryArrest(state, b.x, b.y, 1);
  if (caught) {
    pushEvent(state, 'crime', `Roban en ${name}, pero la policía detiene al ladrón y devuelve lo robado`, { ref: b.id });
    return;
  }
  const loss = Math.min(b.cash, CRIME.robLoss);
  if (loss > 0) transfer(state, b.id, OUTSIDE, loss, 'robo');
  j.hot.push({ x: b.x, y: b.y, until: state.tick + CRIME.hotDays * TICKS_PER_DAY });
  const owner = state.citizens.find((c) => c.id === b.owner);
  if (owner) addMemory(state, owner, 'le_robaron', 4, -4);
  const why = stationsFor(state, b.x, b.y).length ? 'los calabozos están llenos' : 'no hay policía cerca';
  pushEvent(state, 'crime', `Roban en ${name}: se llevan ${loss} € y el ladrón escapa (${why})`, { ref: b.id });
}

/** ¿Hay una cárcel cerca de la casa? (a los vecinos no les gusta) */
export function jailNear(state: GameState, home: { x: number; y: number }): boolean {
  return state.buildings.some((b) => b.kind === 'jail' && b.built && dist(b, home) <= CRIME.jailNuisanceRadius);
}
