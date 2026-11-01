import { type LandmarkKind, TICKS_PER_DAY, tickToDate } from '@bitopolis/shared';
import { BUDGET, LANDMARKS, type LandmarkSpec, TERRAIN } from './balance.ts';
import type { CommandResult } from './commands.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { chance, pick } from './prng.ts';
import {
  type Building,
  buildingAt,
  buildingById,
  type Citizen,
  footprint,
  type GameState,
  type Grant,
  hasAdjacentRoad,
  inBounds,
  type Landmark,
  newBuilding,
  pushEvent,
  terrainAt,
  Tile,
  tileIndex,
  Zone,
} from './state.ts';
import { Terrain } from './terrain.ts';

// Ojo: fields.ts (que carga state.ts) importa este archivo: aquí solo módulos ligeros (sin commands.ts ni fire.ts).

/**
 * 2.3: grandes obras por fases (puente de piedra, estación, feria, estadio,
 * catedral). Números en `LANDMARKS` (balance.ts); estado en `state.landmarks`.
 *
 * - `StartLandmark` marca el solar (2×2, salvo el puente, que va sobre el río)
 *   y la Diputación ofrece cofinanciarla (`Grant.landmark`).
 * - `FundLandmarkPhase` paga una fase: solo si en ese momento se cumplen los
 *   vecinos, la felicidad media, el nivel del ayuntamiento y la caja (nunca
 *   con descubierto). Cada fase es un `Project` del mismo edificio.
 * - Entre fases puede quedarse parada sin perder nada; cada fase terminada ya
 *   da su parte del efecto (`landmarkProgress`).
 * - `PauseLandmark` para la fase en obra (la cuadrilla deja de trabajar y de
 *   cobrar) o la deja «parada por el alcalde» entre fases; otra vez, la reanuda.
 */

export const LANDMARK_KINDS: LandmarkKind[] = ['bridge', 'station', 'fair', 'stadium', 'cathedral'];

export const LANDMARK_NAMES: Record<LandmarkKind, string> = {
  bridge: 'Puente de piedra',
  station: 'Estación de tren',
  fair: 'Feria regional',
  stadium: 'Estadio',
  cathedral: 'Catedral',
};

/** Lo que hace cada obra terminada, en una línea (para la bandeja y la ficha). */
export const LANDMARK_EFFECT: Record<LandmarkKind, string> = {
  bridge: 'Riadas a la mitad en la orilla y el suelo de alrededor vale más',
  station: 'Más ganas de vivir aquí, más trabajo fuera y el viaje sale más barato',
  fair: 'En septiembre, las tiendas venden más y vienen el doble de visitantes',
  stadium: 'Más felicidad a 12 casillas y cuenta como polideportivo (los días de partido, ruido)',
  cathedral: 'Más felicidad en todo el pueblo y más atractivo para los visitantes',
};

export function isLandmarkKind(kind: string): kind is LandmarkKind {
  return (LANDMARK_KINDS as string[]).includes(kind);
}

export const specOf = (kind: LandmarkKind): LandmarkSpec => LANDMARKS.specs[kind];

/** La catedral está aplazada (plan v2.3): en el juego sale como «Más adelante». */
export const LANDMARK_LATER: LandmarkKind[] = ['cathedral'];

/** Coste de la fase siguiente (materiales, con el presupuesto en vigor y la colina). */
export function phaseCost(state: GameState, lm: { kind: LandmarkKind; buildingId?: number; discount?: number }): number {
  const b = lm.buildingId !== undefined ? buildingById(state, lm.buildingId) : undefined;
  const hill = b && terrainAt(state, b.x, b.y) === Terrain.Hill ? TERRAIN.hillFactor : 1;
  const cut = 1 - (lm.discount ?? 0);
  return Math.round(specOf(lm.kind).phaseCost * BUDGET[state.budget.plan].materials * hill * cut);
}

const avgHappiness = (state: GameState) => (state.citizens.length ? state.citizens.reduce((s, c) => s + c.happiness, 0) / state.citizens.length : 0);

export interface LandmarkReq {
  key: 'later' | 'townhall' | 'pop' | 'happiness' | 'needs' | 'cash';
  ok: boolean;
  /** «120 vecinos», «felicidad 60», «ayto. nivel 4», «ermita», «14.000 €». */
  short: string;
  /** Explicado: «120 vecinos (tienes 80)». */
  long: string;
}

/** Requisitos de la obra ahora mismo (para empezar o pagar una fase). */
export function landmarkReqs(state: GameState, kind: LandmarkKind, cost = phaseCost(state, { kind })): LandmarkReq[] {
  const s = specOf(kind);
  const pop = state.citizens.length;
  const happy = Math.round(avgHappiness(state));
  const lv = state.townhallLevel ?? 1;
  const out: LandmarkReq[] = [];
  if (LANDMARK_LATER.includes(kind)) out.push({ key: 'later', ok: false, short: 'más adelante', long: `${LANDMARK_NAMES[kind]}: llegará más adelante.` });
  out.push({ key: 'townhall', ok: lv >= s.townhall, short: `ayto. nivel\u00a0${s.townhall}`, long: `Ayuntamiento de nivel ${s.townhall} (tienes el ${lv})` });
  out.push({ key: 'pop', ok: pop >= s.pop, short: `${s.pop} vecinos`, long: `${s.pop} vecinos (tienes ${pop})` });
  out.push({ key: 'happiness', ok: happy >= s.happiness, short: `felicidad ${s.happiness}`, long: `Felicidad media de ${s.happiness} (ahora ${happy})` });
  if (s.needs) {
    const has = state.buildings.some((b) => b.kind === s.needs && b.built);
    out.push({ key: 'needs', ok: has, short: 'ermita', long: 'Una ermita en el pueblo' });
  }
  out.push({ key: 'cash', ok: state.treasury >= cost, short: `${cost.toLocaleString('es-ES')}\u00a0€`, long: `${cost.toLocaleString('es-ES')} € en caja para la fase (tienes ${Math.max(0, state.treasury).toLocaleString('es-ES')} €)` });
  return out;
}

/** El primer requisito que falta, como error del comando («Falta: 60 vecinos (tienes 20)»). */
const firstMissing = (reqs: LandmarkReq[]): { long: string } | undefined => {
  const r = reqs.find((x) => !x.ok);
  return r ? { long: r.key === 'later' ? r.long : `Falta: ${r.long}` } : undefined;
};

export const landmarkOf = (state: GameState, id: number): Landmark | undefined => state.landmarks.find((l) => l.id === id);
export const landmarkByBuilding = (state: GameState, buildingId: number): Landmark | undefined => state.landmarks.find((l) => l.buildingId === buildingId);

/** ¿Se puede poner aquí? (sin mirar requisitos de vecinos ni caja). */
export function landmarkSiteError(state: GameState, kind: LandmarkKind, x: number, y: number): string | null {
  const s = specOf(kind);
  const cells = footprint({ x, y, size: s.size === 2 ? 2 : undefined });
  if (cells.some(([cx, cy]) => !inBounds(state, cx, cy))) return 'Fuera del mapa';
  if (s.onRiver) {
    if (terrainAt(state, x, y) !== Terrain.River) return 'El puente de piedra va sobre el río';
    if (state.map.tiles[tileIndex(state, x, y)] === Tile.Road) return 'Ahí ya hay un puente de carretera: ponlo al lado';
    if (buildingAt(state, x, y)) return 'Ese sitio está ocupado';
    if (!hasAdjacentRoad(state, x, y)) return 'Necesita una carretera al lado';
    return null;
  }
  for (const [cx, cy] of cells) {
    const ter = terrainAt(state, cx, cy);
    if (ter === Terrain.River || ter === Terrain.Sea) return ter === Terrain.Sea ? 'Ahí está el mar' : 'Ahí pasa el río';
    if (state.map.tiles[tileIndex(state, cx, cy)] === Tile.Road || buildingAt(state, cx, cy)) return 'Ese sitio está ocupado (hacen falta 2×2 casillas libres)';
    if ((state.dikes ?? []).includes(tileIndex(state, cx, cy))) return 'Ahí hay un dique';
  }
  if (!cells.some(([cx, cy]) => hasAdjacentRoad(state, cx, cy))) return 'Necesita una carretera al lado';
  return null;
}

export function canStartLandmark(state: GameState, kind: LandmarkKind, x: number, y: number): CommandResult {
  if (state.landmarks.some((l) => l.kind === kind)) return { ok: false, error: `Ya hay ${LANDMARK_NAMES[kind].toLowerCase()} en el pueblo` };
  const miss = firstMissing(landmarkReqs(state, kind));
  if (miss) return { ok: false, error: miss.long };
  const site = landmarkSiteError(state, kind, x, y);
  if (site) return { ok: false, error: site };
  return { ok: true };
}

export function startLandmark(state: GameState, kind: LandmarkKind, x: number, y: number): void {
  const s = specOf(kind);
  const b = newBuilding(state, kind, x, y, TREASURY);
  if (s.size === 2) b.size = 2;
  b.name = LANDMARK_NAMES[kind];
  for (const [cx, cy] of footprint(b)) {
    const i = tileIndex(state, cx, cy);
    if (!s.onRiver) state.map.tiles[i] = Tile.Grass;
    state.map.zones[i] = Zone.None;
  }
  const lm: Landmark = { id: state.nextId++, kind, buildingId: b.id, phase: 0, phases: s.phases, phaseUntil: -1, spent: 0 };
  state.landmarks.push(lm);
  pushEvent(state, 'project', `Se marca el solar de ${LANDMARK_NAMES[kind].toLowerCase()}: ${s.phases} fases de ${phaseCost(state, lm).toLocaleString('es-ES')} €. Toca la obra para pagar la primera`, { ref: b.id });
  offerLandmarkGrant(state, lm);
}

export function canFundLandmarkPhase(state: GameState, id: number): CommandResult {
  const lm = landmarkOf(state, id);
  if (!lm || !buildingById(state, lm.buildingId)) return { ok: false, error: 'Esa obra ya no está' };
  if (lm.phase >= lm.phases) return { ok: false, error: 'Ya está terminada' };
  if (lm.phaseUntil !== -1) return { ok: false, error: `La fase ${lm.phase + 1} sigue en obra` };
  const miss = firstMissing(landmarkReqs(state, lm.kind, phaseCost(state, lm)));
  if (miss) return { ok: false, error: miss.long };
  return { ok: true };
}

/** Subvención aceptada que paga esta fase (la de la obra o el FEDER de la estación), la de más parte. */
export function grantFor(state: GameState, lm: Landmark): Grant | undefined {
  const own = state.grants.filter((g) => g.status === 'accepted' && (g.landmark === lm.id || (g.feder && g.kind === lm.kind && state.tick <= g.deadline)));
  return own.sort((a, b) => b.share - a.share || a.id - b.id)[0];
}

export function fundLandmarkPhase(state: GameState, id: number): void {
  const lm = landmarkOf(state, id)!;
  const s = specOf(lm.kind);
  const cost = phaseCost(state, lm);
  delete lm.discount;
  transfer(state, TREASURY, OUTSIDE, cost, 'obras');
  // La Diputación (o el FEDER) paga su parte de la fase a la vez.
  const g = grantFor(state, lm);
  const help = g ? transfer(state, OUTSIDE, TREASURY, Math.round(cost * g.share), 'subvenciones') : 0;
  lm.spent += cost - help;
  lm.paused = false;
  lm.phaseUntil = state.tick + s.days * TICKS_PER_DAY;
  state.projects.push({
    buildingId: lm.buildingId,
    payer: TREASURY,
    workersNeeded: s.workers,
    workerDaysNeeded: s.workers * s.days,
    workerDaysDone: 0,
    crew: [],
    outsideToday: 0,
    notify: false,
  });
  pushEvent(state, 'project', `Empieza la fase ${lm.phase + 1} de ${lm.phases} de ${LANDMARK_NAMES[lm.kind].toLowerCase()} (${cost.toLocaleString('es-ES')} €${help ? `; la ${g!.feder ? 'Unión Europea (FEDER)' : 'Diputación'} pone ${help.toLocaleString('es-ES')} €` : ''})`, { ref: lm.buildingId });
}

export function canPauseLandmark(state: GameState, id: number): CommandResult {
  const lm = landmarkOf(state, id);
  if (!lm || !buildingById(state, lm.buildingId)) return { ok: false, error: 'Esa obra ya no está' };
  if (lm.phase >= lm.phases) return { ok: false, error: 'Ya está terminada' };
  return { ok: true };
}

/** Para (o reanuda) la obra: la fase en marcha se queda sin cuadrilla (ni sueldos) hasta reanudarla. */
export function pauseLandmark(state: GameState, id: number): void {
  const lm = landmarkOf(state, id)!;
  const p = state.projects.find((x) => x.buildingId === lm.buildingId);
  lm.paused = !lm.paused;
  if (p) p.workersNeeded = lm.paused ? 0 : specOf(lm.kind).workers;
  pushEvent(state, 'info', `${LANDMARK_NAMES[lm.kind]}: ${lm.paused ? 'obra parada por el alcalde (no se pierde nada)' : 'se reanuda la obra'}`, { ref: lm.buildingId });
}

/** Parte de la obra hecha (0–1): fases terminadas ÷ fases, si el edificio está en pie. */
export function landmarkProgress(state: GameState, kind: LandmarkKind): number {
  let best = 0;
  for (const lm of state.landmarks) {
    if (lm.kind !== kind || lm.phase === 0) continue;
    const b = buildingById(state, lm.buildingId);
    if (!b || b.damaged) continue;
    best = Math.max(best, lm.phase / lm.phases);
  }
  return best;
}

const anchorOf = (state: GameState, kind: LandmarkKind): Building | undefined => {
  const lm = state.landmarks.find((l) => l.kind === kind && l.phase > 0);
  return lm ? buildingById(state, lm.buildingId) : undefined;
};

/** Centro de un edificio (los 2×2, entre sus 4 casillas). */
const centre = (b: Building) => ({ x: b.x + ((b.size ?? 1) - 1) / 2, y: b.y + ((b.size ?? 1) - 1) / 2 });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/* ---------------- efectos (los llaman tick, weather, fields, household y tourism) ---------------- */

/** Riadas en la orilla: el puente de piedra las reduce (×0,5 terminado). */
export function bridgeFloodFx(state: GameState): number {
  return 1 - LANDMARKS.effects.bridge.floodCut * landmarkProgress(state, 'bridge');
}

/** Demanda de vivienda que añade la estación. */
export function stationDemandR(state: GameState): number {
  return Math.round(LANDMARKS.effects.station.demandR * landmarkProgress(state, 'station'));
}

/** Factor de las plazas de trabajo fuera por la estación (1,25 terminada). */
export function stationJobsFx(state: GameState): number {
  return 1 + (LANDMARKS.effects.station.jobsOutside - 1) * landmarkProgress(state, 'station');
}

/** Lo que gana de más al día quien trabaja fuera (el viaje en tren cuesta un 30 % menos). */
export function stationCommuterBonus(state: GameState): number {
  const e = LANDMARKS.effects.station;
  return Math.round(e.trip * (1 - e.commuter) * landmarkProgress(state, 'station'));
}

/** Feria regional: factor de ventas de las tiendas este mes (en septiembre). */
export function fairSalesFx(state: GameState, month: number): number {
  const e = LANDMARKS.effects.fair;
  return month === e.month ? 1 + e.sales * landmarkProgress(state, 'fair') : 1;
}

/** Feria regional: factor de visitantes este mes (para el turismo). */
export function fairVisitorsFx(state: GameState, month: number): number {
  const e = LANDMARKS.effects.fair;
  return month === e.month ? 1 + (e.visitors - 1) * landmarkProgress(state, 'fair') : 1;
}

/**
 * Fin de mes, tras el gasto de los vecinos: si el mes que cierra es el de la
 * feria, los compradores de fuera dejan en cada tienda un 15 % más (terminada).
 */
export function fairMonth(state: GameState, shops: Building[]): void {
  const fx = fairSalesFx(state, tickToDate(state.tick - 1).month) - 1;
  if (fx <= 0) return;
  let total = 0;
  for (const b of shops) total += transfer(state, OUTSIDE, b.id, Math.round((b.sales ?? 0) * fx));
  for (const b of shops) b.sales = Math.round((b.sales ?? 0) * (1 + fx));
  if (total > 0) pushEvent(state, 'business', `La feria regional llena el pueblo de forasteros: las tiendas venden ${total.toLocaleString('es-ES')} € más`);
}

/** Atractivo que suman las grandes obras (para el turismo): puente +2, catedral +5. */
export function landmarkAttract(state: GameState): number {
  return LANDMARKS.effects.bridge.attract * landmarkProgress(state, 'bridge') + LANDMARKS.effects.cathedral.attract * landmarkProgress(state, 'cathedral');
}

/** El estadio cuenta como polideportivo (salud de los mayores, cobertura). */
export function countsAsSports(b: Building): boolean {
  return b.kind === 'sports' || (b.kind === 'stadium' && b.built && !b.damaged);
}

/** Felicidad de las grandes obras para un vecino (estadio cerca, catedral en el pueblo). */
export function landmarkMood(state: GameState, home: { x: number; y: number } | undefined): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = [];
  const st = anchorOf(state, 'stadium');
  if (st && home && !st.damaged && dist(centre(st), home) <= LANDMARKS.effects.stadium.radius) {
    const v = Math.round(LANDMARKS.effects.stadium.happiness * landmarkProgress(state, 'stadium'));
    if (v) out.push({ label: 'Estadio cerca', value: v });
  }
  const v = Math.round(LANDMARKS.effects.cathedral.happiness * landmarkProgress(state, 'cathedral'));
  if (v) out.push({ label: 'Orgullo de la catedral', value: v });
  return out;
}

/** Huellas en los campos: suelo alrededor del puente; ruido del estadio el día de partido. */
export function landmarkStamps(state: GameState, b: Building): { field: 'good' | 'noise' | 'emit'; radius: number; amount: number; x: number; y: number }[] {
  if (!isLandmarkKind(b.kind) || !b.built || b.damaged) return [];
  const p = landmarkProgress(state, b.kind);
  const out: { field: 'good' | 'noise' | 'emit'; radius: number; amount: number; x: number; y: number }[] = [];
  if (b.kind === 'bridge') out.push({ field: 'good', radius: LANDMARKS.effects.bridge.landRadius, amount: LANDMARKS.effects.bridge.land * p, x: b.x, y: b.y });
  if (b.kind === 'stadium' && matchDay(state)) out.push({ field: 'noise', radius: LANDMARKS.effects.stadium.noiseRadius, amount: LANDMARKS.effects.stadium.noise * p, x: b.x, y: b.y });
  if (b.kind === 'station' || b.kind === 'fair' || b.kind === 'cathedral') out.push({ field: 'good', radius: 6, amount: 6 * p, x: b.x, y: b.y });
  return out;
}

/** Partido en el estadio: un día al mes (`LANDMARKS.effects.stadium.matchDay`). */
export function matchDay(state: GameState): boolean {
  return tickToDate(state.tick).day === LANDMARKS.effects.stadium.matchDay;
}

/* ---------------- calendario ---------------- */

/** Fin de día: fases que terminan (su proyecto ya no está) y obras derribadas. */
export function landmarksDay(state: GameState): void {
  if (!state.landmarks.length) return;
  state.landmarks = state.landmarks.filter((l) => buildingById(state, l.buildingId));
  for (const lm of state.landmarks) {
    if (lm.phaseUntil === -1) continue;
    if (state.projects.some((p) => p.buildingId === lm.buildingId)) continue;
    lm.phase++;
    lm.phaseUntil = -1;
    const name = LANDMARK_NAMES[lm.kind];
    if (lm.phase >= lm.phases) {
      pushEvent(state, 'milestone', `¡Terminada ${lm.kind === 'bridge' || lm.kind === 'stadium' ? 'la obra del' : 'la obra de la'} ${name.toLowerCase()}! ${LANDMARK_EFFECT[lm.kind]}`, { ref: lm.buildingId });
      for (const g of state.grants) if (g.landmark === lm.id && g.status === 'accepted') g.status = 'paid';
    } else {
      pushEvent(state, 'built', `${name}: terminada la fase ${lm.phase} de ${lm.phases}. Ya se nota una parte; la fase ${lm.phase + 1} se paga cuando quieras`, { ref: lm.buildingId });
    }
  }
}

/** Fin de mes: mantenimiento (0,5 % de lo gastado) y, sin IA, alguna donación de los vecinos. */
export function landmarksMonth(state: GameState): void {
  for (const lm of state.landmarks) {
    if (lm.spent > 0) transfer(state, TREASURY, OUTSIDE, Math.round(lm.spent * LANDMARKS.upkeep), 'mantenimiento');
  }
  if (state.aiMode) return;
  // Modo normal: regla con dados (en Modo IA, la IA elige quién dona: `donar_obra`).
  for (const lm of landmarksInProgress(state)) {
    if (!chance(state.rng, LANDMARKS.donateChance)) continue;
    const who = donorCandidates(state, lm.id);
    if (who.length) applyDonation(state, pick(state.rng, who).citizenId, lm.id);
  }
}

/* ---------------- para la IA (F2): candidatos y aplicación ---------------- */

/** Obras empezadas y sin terminar (para `voluntarios_obra:<id>`, `polemica_obra:<id>` y `donar_obra:<id>`). */
export function landmarksInProgress(state: GameState): Landmark[] {
  return state.landmarks.filter((l) => l.phase < l.phases && buildingById(state, l.buildingId));
}

/** Quién puede donar a la obra y cuánto (2 % de sus ahorros): poco ahorrador de carácter y actitud ≥ 1 (en Modo normal, basta estar contento). */
export function donorCandidates(state: GameState, id: number): { citizenId: number; amount: number }[] {
  if (!landmarksInProgress(state).some((l) => l.id === id)) return [];
  const out: { citizenId: number; amount: number }[] = [];
  for (const c of state.citizens) {
    if (!canDonate(state, c)) continue;
    const amount = Math.floor(c.money * LANDMARKS.donateShare);
    if (amount >= LANDMARKS.donateMin) out.push({ citizenId: c.id, amount });
  }
  return out;
}

function canDonate(state: GameState, c: Citizen): boolean {
  if (c.traits.ahorro > LANDMARKS.donateMaxSaving) return false;
  if ((c.debt?.town ?? 0) + (c.debt?.bank ?? 0) > 0) return false;
  return state.aiMode ? (c.attitude ?? 0) >= LANDMARKS.donateMinAttitude : c.happiness >= 65;
}

/** Aplica una donación (el motor fija la cantidad). Devuelve lo donado (0 si ya no puede). */
export function applyDonation(state: GameState, citizenId: number, id: number): number {
  const c = state.citizens.find((x) => x.id === citizenId);
  const lm = landmarksInProgress(state).find((l) => l.id === id);
  if (!c || !lm || !canDonate(state, c)) return 0;
  const amount = Math.floor(c.money * LANDMARKS.donateShare);
  if (amount < LANDMARKS.donateMin) return 0;
  const paid = transfer(state, c.id, TREASURY, amount, 'donaciones');
  if (paid) pushEvent(state, 'info', `${c.name} dona ${paid.toLocaleString('es-ES')} € para ${LANDMARK_NAMES[lm.kind].toLowerCase()}`, { ref: c.id });
  return paid;
}

/** Voluntarios: la fase en obra avanza un 10 % más rápido (o la siguiente sale un 10 % más barata). */
export function applyVolunteers(state: GameState, id: number): boolean {
  const lm = landmarksInProgress(state).find((l) => l.id === id);
  if (!lm) return false;
  const p = state.projects.find((x) => x.buildingId === lm.buildingId);
  if (p) p.workerDaysNeeded = Math.max(p.workerDaysDone, Math.round(p.workerDaysNeeded * (1 - LANDMARKS.volunteersCut)));
  else lm.discount = LANDMARKS.volunteersCut;
  pushEvent(state, 'info', `Vecinos voluntarios echan una mano en ${LANDMARK_NAMES[lm.kind].toLowerCase()}`, { ref: lm.buildingId });
  return true;
}

/** Dónde puede ir una obra 2×2 (o el puente): primera casilla válida, de arriba abajo (para el simulador). */
export function landmarkSpot(state: GameState, kind: LandmarkKind, near?: { x: number; y: number }): { x: number; y: number } | null {
  const { w, h } = state.map;
  let best: { x: number; y: number; d: number } | null = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (landmarkSiteError(state, kind, x, y)) continue;
      const d = near ? dist(near, { x, y }) : 0;
      if (!best || d < best.d) best = { x, y, d };
      if (!near) return { x, y };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

/* ---------------- cofinanciación (civic.ts guarda la oferta en `state.grants`) ---------------- */

/** Parte que ofrece la Diputación: 30–50 % (60 % con el ayuntamiento 5), según la obra y la partida. */
export function landmarkGrantShare(state: GameState, lm: Landmark): number {
  const g = LANDMARKS.grant;
  if ((state.townhallLevel ?? 1) >= 5) return g.shareTop;
  const steps = [g.shareMin, (g.shareMin + g.shareMax) / 2, g.shareMax];
  return steps[(lm.id + state.seed) % steps.length]!;
}

function offerLandmarkGrant(state: GameState, lm: Landmark): void {
  const share = landmarkGrantShare(state, lm);
  state.grants.push({
    id: state.nextId++,
    kind: lm.kind,
    share,
    offeredTick: state.tick,
    // La oferta vale lo de siempre; aceptada, cubre todas las fases (no caduca).
    deadline: state.tick + LANDMARKS.grant.offerDays * TICKS_PER_DAY,
    status: 'offered',
    advance: 0,
    minId: 0,
    landmark: lm.id,
  });
  lm.grantId = state.grants.at(-1)!.id;
  pushEvent(state, 'info', `La Diputación ofrece pagar el ${Math.round(share * 100)} % de cada fase de ${LANDMARK_NAMES[lm.kind].toLowerCase()} (toca la obra para aceptarlo)`, { ref: lm.buildingId });
}
