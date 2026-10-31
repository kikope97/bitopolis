import { TICKS_PER_DAY } from '@bitopolis/shared';
import { CRIME } from './balance.ts';
import { cellsOf, jailPlacesOf, radiusOf } from './levels.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { chance, nextInt } from './prng.ts';
import { charge, totalDebt } from './household.ts';
import { sellOnDeparture } from './economy.ts';
import { addMemory, onCitizenLeaves } from './social.ts';
import { type Building, type Citizen, type GameState, pushEvent } from './state.ts';

/**
 * v1.8: delincuencia. Las tiendas sufren robos según la delincuencia de la
 * zona. Si hay una comisaría cerca con calabozo libre, la policía detiene al
 * ladrón y se recupera lo robado. Los detenidos pasan a la cárcel si la hay;
 * si no, ocupan el calabozo un mes y, con los calabozos llenos, ya no se puede
 * detener a nadie más.
 */
export interface Justice {
  /** Calabozos ocupados: comisaría, hasta cuándo y si espera traslado a la cárcel. */
  cells: { stationId: number; until: number; toJail: boolean; citizenId?: number }[];
  /** Presos en la cárcel: hasta cuándo y, si es un vecino del pueblo, quién (v1.9). */
  jail: { until: number; citizenId?: number }[];
  /** Puntos calientes: robos sin resolver suben la inseguridad alrededor un tiempo. */
  hot: { x: number; y: number; until: number }[];
  robberies: number;
  arrests: number;
  /** Último aviso de calabozos llenos (para no repetirlo cada día). */
  fullWarned: number;
  /** Multas cobradas a los detenidos (total, en euros). */
  fines?: number;
  /** v1.9: robos en casas y los cometidos por vecinos del pueblo. */
  homeRobberies?: number;
  localThefts?: number;
}

export function emptyJustice(): Justice {
  return { cells: [], jail: [], hot: [], robberies: 0, arrests: 0, fullWarned: -1 };
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Comisarías que cubren un sitio (las más cercanas primero). */
export function stationsFor(state: GameState, x: number, y: number): Building[] {
  return state.buildings.filter((b) => b.kind === 'police' && b.built && dist(b, { x, y }) <= radiusOf(b)).sort((a, b) => dist(a, { x, y }) - dist(b, { x, y }));
}

export function cellsUsed(state: GameState, stationId: number): number {
  return (state.justice?.cells ?? []).filter((c) => c.stationId === stationId).length;
}

export function jailCapacity(state: GameState): number {
  return state.buildings.filter((b) => b.kind === 'jail' && b.built).reduce((a, b) => a + jailPlacesOf(b), 0);
}

/**
 * Intenta detener a `n` personas en (x, y). Devuelve cuántas se detienen.
 * `citizens`: si son vecinos, quiénes (en orden). `kind`: disturbios (unos días
 * de calabozo) o robo (condena como cualquier ladrón: calabozo o cárcel; pierde
 * el empleo y suma antecedentes).
 * Si hay comisaría cerca pero los calabozos están llenos, avisa (una vez al mes).
 */
export function tryArrest(state: GameState, x: number, y: number, n: number, citizens: Citizen[] = [], kind: 'riot' | 'theft' = 'riot'): number {
  const j = state.justice;
  if (!j) return 0;
  const stations = stationsFor(state, x, y);
  let done = 0;
  for (const s of stations) {
    while (done < n && cellsUsed(state, s.id) < cellsOf(s)) {
      const who = citizens[done];
      if (who && kind === 'riot') {
        // Un vecino detenido en unos disturbios: unos días de calabozo (y su multa), sin cárcel.
        j.cells.push({ stationId: s.id, until: state.tick + CRIME.riotDays * TICKS_PER_DAY, toJail: false, citizenId: who.id });
      } else {
        // Con cárcel y sitio, a los pocos días se les traslada; sin cárcel, cumplen en el calabozo.
        const toJail = j.jail.length + j.cells.filter((c) => c.toJail).length < jailCapacity(state);
        j.cells.push({ stationId: s.id, until: state.tick + (toJail ? CRIME.transferDays : CRIME.cellDays) * TICKS_PER_DAY, toJail, ...(who ? { citizenId: who.id } : {}) });
        if (who) {
          // v1.9: un vecino del pueblo detenido por robar: antecedentes y, entre rejas, pierde el empleo.
          who.record = (who.record ?? 0) + 1;
          who.jobId = null;
          addMemory(state, who, 'antecedentes', 5, -5);
        }
      }
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

/** Multa diaria de un detenido: el de fuera la paga su familia; el vecino, de su bolsillo o como deuda. */
function fine(state: GameState, citizenId: number | undefined): number {
  if (citizenId === undefined) return transfer(state, OUTSIDE, TREASURY, CRIME.finePerDay, 'multas');
  const who = state.citizens.find((x) => x.id === citizenId);
  return who ? charge(state, who, TREASURY, CRIME.finePerDay, 'multas') : 0;
}

/** Sale libre: con demasiados antecedentes, el vecino se va del pueblo. */
function released(state: GameState, citizenId: number | undefined): void {
  if (citizenId === undefined) return;
  const c = state.citizens.find((x) => x.id === citizenId);
  if (!c || (c.record ?? 0) < CRIME.recordLeave || state.citizens.length <= 1) return;
  sellOnDeparture(state, c);
  onCitizenLeaves(state, c);
  transfer(state, c.id, OUTSIDE, c.money);
  state.citizens = state.citizens.filter((x) => x !== c);
  pushEvent(state, 'departure', `${c.name} se va del pueblo al salir de la cárcel (tenía ${c.record} detenciones)`);
}

/** Cada día: multas, traslados y salidas, y robos en tiendas y casas. */
export function crimeDay(state: GameState): void {
  const j = state.justice;
  if (!j) return;
  // Multa diaria de cada detenido (petición del creador).
  let fines = 0;
  for (const c of j.cells) fines += fine(state, c.citizenId);
  for (const p of j.jail) fines += fine(state, p.citizenId);
  j.fines = (j.fines ?? 0) + fines;
  // Salen del calabozo: a la cárcel (si tocaba y hay sitio) o a la calle.
  for (const c of [...j.cells]) {
    if (c.until > state.tick) continue;
    j.cells = j.cells.filter((x) => x !== c);
    if (c.toJail && j.jail.length < jailCapacity(state)) j.jail.push({ until: state.tick + CRIME.jailDays * TICKS_PER_DAY, ...(c.citizenId !== undefined ? { citizenId: c.citizenId } : {}) });
    else released(state, c.citizenId);
  }
  for (const p of j.jail) if (p.until <= state.tick) released(state, p.citizenId);
  j.jail = j.jail.filter((p) => p.until > state.tick).slice(0, jailCapacity(state));
  j.hot = j.hot.filter((h) => h.until > state.tick);
  if (state.citizens.length < CRIME.minPop) return;
  const crimeAt = (x: number, y: number) => state.fields.crime[y * state.map.w + x] ?? 0;
  for (const b of state.buildings) {
    if (b.kind !== 'shop' || !b.built || b.damaged) continue;
    const p = CRIME.robBase * Math.max(0, crimeAt(b.x, b.y) - CRIME.robThreshold) / 50;
    if (!chance(state.rng, p)) continue;
    robbery(state, b);
  }
  // v1.9: robos en las casas (ladrones de fuera).
  for (const b of state.buildings) {
    if ((b.kind !== 'house' && b.kind !== 'res') || !b.built) continue;
    const p = CRIME.homeRobBase * Math.max(0, crimeAt(b.x, b.y) - CRIME.robThreshold) / 50;
    if (!chance(state.rng, p)) continue;
    homeRobbery(state, b, undefined);
  }
  // v1.9: ladrones del pueblo. Vecinos sin nombre, endeudados, sin dinero y sin trabajo en el
  // pueblo; nunca es una acción de la IA. Como mucho un robo así al día.
  for (const c of state.citizens) {
    if (c.named || c.jobId !== null || c.money > 0 || totalDebt(c) < CRIME.localDebt) continue;
    if (j.cells.some((x) => x.citizenId === c.id) || j.jail.some((x) => x.citizenId === c.id)) continue;
    const home = state.buildings.find((b) => b.id === c.homeId);
    const crime = home ? crimeAt(home.x, home.y) : 20;
    const p = CRIME.localBase * (1 + crime / 50) * (1 + 0.5 * (c.record ?? 0));
    if (!chance(state.rng, p)) continue;
    const targets = state.buildings.filter((b) => (b.kind === 'house' || b.kind === 'res') && b.built && b.id !== c.homeId);
    if (!targets.length) break;
    homeRobbery(state, targets[nextInt(state.rng, 0, targets.length - 1)]!, c);
    break;
  }
}

function robbery(state: GameState, b: Building): void {
  const j = state.justice;
  const name = b.name ?? 'una tienda';
  // v1.9: con la caja vacía no hay nada que llevarse: un intento, sin más.
  if (b.cash <= 0) {
    pushEvent(state, 'crime', `Intentan robar en ${name}, pero la caja está vacía`, { ref: b.id });
    return;
  }
  j.robberies++;
  const caught = tryArrest(state, b.x, b.y, 1);
  if (caught) {
    pushEvent(state, 'crime', `Roban en ${name}, pero la policía detiene al ladrón y devuelve lo robado`, { ref: b.id });
    return;
  }
  // Nunca más de lo que hay en la caja.
  const loss = transfer(state, b.id, OUTSIDE, Math.min(b.cash, CRIME.robLoss), 'robo');
  j.hot.push({ x: b.x, y: b.y, until: state.tick + CRIME.hotDays * TICKS_PER_DAY });
  const owner = state.citizens.find((c) => c.id === b.owner);
  if (owner) addMemory(state, owner, 'le_robaron', 4, -4);
  const why = stationsFor(state, b.x, b.y).length ? 'los calabozos están llenos' : 'no hay policía cerca';
  pushEvent(state, 'crime', `Roban en ${name}: se llevan ${loss} € y el ladrón escapa (${why})`, { ref: b.id });
}

/**
 * v1.9: robo en una casa. Se llevan el dinero de un vecino que vive en ella, nunca
 * más de lo que tiene ni del tope; si no tiene nada, no pasa nada. Con policía
 * cerca y calabozo libre, detienen al ladrón y no se pierde nada. Si no, la
 * víctima se queda sin ese dinero y puede no llegar a fin de mes (y endeudarse).
 */
function homeRobbery(state: GameState, b: Building, thief: Citizen | undefined): void {
  const j = state.justice;
  const living = state.citizens.filter((c) => c.homeId === b.id && c !== thief);
  const victim = living.filter((c) => c.money > 0).sort((a, c) => c.money - a.money)[0];
  if (!victim) return;
  j.robberies++;
  j.homeRobberies = (j.homeRobberies ?? 0) + 1;
  const who = thief ? `${thief.name}, del pueblo` : 'un ladrón de fuera';
  const caught = tryArrest(state, b.x, b.y, 1, thief ? [thief] : [], 'theft');
  if (caught) {
    pushEvent(state, 'crime', `Entran a robar en casa de ${victim.name}, pero la policía detiene a ${who}`, { ref: b.id });
    return;
  }
  const loss = transfer(state, victim.id, thief ? thief.id : OUTSIDE, Math.min(victim.money, CRIME.homeLoss), 'robo');
  j.hot.push({ x: b.x, y: b.y, until: state.tick + CRIME.hotDays * TICKS_PER_DAY });
  addMemory(state, victim, 'robo_en_casa', 4, -5);
  if (thief) j.localThefts = (j.localThefts ?? 0) + 1;
  const why = stationsFor(state, b.x, b.y).length ? 'los calabozos están llenos' : 'no hay policía cerca';
  const all = victim.money === 0 ? 'todos sus ahorros' : 'sus ahorros';
  pushEvent(state, 'crime', `Entran a robar en casa de ${victim.name}: se llevan ${loss} € de ${all} y el ladrón escapa (${why})`, { ref: b.id });
}

/** ¿Hay una cárcel cerca de la casa? (a los vecinos no les gusta) */
export function jailNear(state: GameState, home: { x: number; y: number }): boolean {
  return state.buildings.some((b) => b.kind === 'jail' && b.built && dist(b, home) <= CRIME.jailNuisanceRadius);
}
