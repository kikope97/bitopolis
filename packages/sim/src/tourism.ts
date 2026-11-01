import { TICKS_PER_MONTH, tickToDate } from '@bitopolis/shared';
import { busVisitorsFx } from './transit.ts';
import type { CommandResult } from './commands.ts';
import { LANDMARKS, REGION, TOURISM } from './balance.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { chance } from './prng.ts';
import { addMemory } from './social.ts';
import { type Building, buildingAt, type Citizen, type GameState, pushEvent, Tile, Zone } from './state.ts';
import { Terrain } from './terrain.ts';

/**
 * 2.3: turismo y patrimonio (visitantes, casas rurales, tasa turística y
 * entorno protegido). Números en `TOURISM` (balance.ts); estado en `state.tourism`.
 *
 * Atractivo = patrimonio + grandes obras (fases hechas) + fiestas del mes +
 * parques y árboles − contaminación media del pueblo; con el entorno
 * protegido, ×1,3. Visitantes/mes = atractivo × 6 × fase de la comarca ×
 * (1 − 12 % por nivel de tasa). La tasa (€/noche) va al ayuntamiento y cada
 * casa rural gana por visitante (con tope); todo entra de fuera (`turismo`).
 */

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/* ---------------- patrimonio ---------------- */

export type HeritageVariant = 'faro' | 'molino' | 'castillo' | 'rollo';

export const HERITAGE_NAMES: Record<HeritageVariant, string> = {
  faro: 'el faro',
  molino: 'el molino',
  castillo: 'el castillo',
  rollo: 'el rollo y la plaza porticada',
};

/** Forma del patrimonio según el terreno: junto al mar, faro; junto al río, molino; en la colina, castillo; si no, rollo con plaza porticada. */
export function heritageVariant(state: GameState, x: number, y: number): HeritageVariant {
  const { w, h } = state.map;
  const terrain = state.map.terrain ?? [];
  const r = TOURISM.heritage.nearWater;
  let sea = false;
  let river = false;
  for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
    for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
      if (Math.abs(xx - x) + Math.abs(yy - y) > r) continue;
      const t = terrain[yy * w + xx];
      if (t === Terrain.Sea) sea = true;
      else if (t === Terrain.River) river = true;
    }
  }
  if (sea) return 'faro';
  if (river) return 'molino';
  if (terrain[y * w + x] === Terrain.Hill) return 'castillo';
  return 'rollo';
}

export function heritageOf(state: GameState): Building | undefined {
  return state.buildings.find((b) => b.kind === 'heritage');
}

/** Uno por partida (se valida además del nivel y los vecinos de siempre). */
export function canBuildHeritage(state: GameState): CommandResult {
  return heritageOf(state) ? { ok: false, error: 'El pueblo ya tiene su patrimonio' } : { ok: true };
}

/** Patrimonio con el entorno protegido (si sigue en pie). */
export function protectedHeritage(state: GameState): Building | undefined {
  const id = state.tourism?.protectedId;
  if (id === undefined) return undefined;
  return state.buildings.find((b) => b.id === id && b.kind === 'heritage');
}

/** ¿Esta casilla está en el entorno protegido? (ni zona I ni fábricas nuevas; también para la gran empresa). */
export function protectedAt(state: GameState, x: number, y: number): boolean {
  const h = protectedHeritage(state);
  return !!h && dist(h, { x, y }) <= TOURISM.protect.radius;
}

/** Valida pintar zona I: no dentro del entorno protegido. */
export function canZoneProtected(state: GameState, zone: string, x: number, y: number, w: number, hgt: number): CommandResult {
  if (zone !== 'I' || !protectedHeritage(state)) return { ok: true };
  for (let yy = y; yy < y + hgt; yy++) for (let xx = x; xx < x + w; xx++) if (protectedAt(state, xx, yy)) return { ok: false, error: 'Entorno protegido: ahí no se puede poner industria' };
  return { ok: true };
}

/* ---------------- comandos ---------------- */

export function canSetTouristTax(state: GameState, level: 0 | 1 | 2): CommandResult {
  if ((state.tourism?.tax ?? 0) === level) return { ok: false, error: 'La tasa turística ya está así' };
  return { ok: true };
}

export function setTouristTax(state: GameState, level: 0 | 1 | 2): void {
  state.tourism.tax = level;
  pushEvent(state, 'tax', level === 0 ? 'Se quita la tasa turística' : `Tasa turística: ${level} € por noche`);
}

/** Proteger el entorno del patrimonio (o, si ya lo está, dejar de protegerlo). */
export function canProtectArea(state: GameState, heritageId: number): CommandResult {
  const b = state.buildings.find((x) => x.id === heritageId);
  if (!b || b.kind !== 'heritage') return { ok: false, error: 'Eso no es el patrimonio del pueblo' };
  if (!b.built) return { ok: false, error: 'El patrimonio aún está en obras' };
  return { ok: true };
}

export function protectArea(state: GameState, heritageId: number): void {
  if (state.tourism.protectedId === heritageId) {
    delete state.tourism.protectedId;
    pushEvent(state, 'politics', 'Se levanta la protección del entorno del patrimonio');
    return;
  }
  state.tourism.protectedId = heritageId;
  // Las casillas vacías de zona I del entorno dejan de serlo (las fábricas que ya hay se quedan).
  const { w, h, zones } = state.map;
  const hb = protectedHeritage(state)!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (zones[i] === Zone.I && protectedAt(state, x, y) && !buildingAt(state, x, y)) zones[i] = Zone.None;
    }
  }
  pushEvent(state, 'politics', `Entorno protegido alrededor ${HERITAGE_NAMES[heritageVariant(state, hb.x, hb.y)].replace(/^el /, 'del ')}: más visitantes, pero sin industria nueva. A los empresarios no les gusta`, { ref: hb.id });
}

/* ---------------- atractivo y visitantes ---------------- */

export interface Attraction {
  heritage: number;
  landmarks: number;
  festival: number;
  green: number;
  pollution: number;
  protect: number;
  total: number;
}

/** Contaminación media en las casillas con edificio (el pueblo, no el monte). */
function townPollution(state: GameState): number {
  let sum = 0;
  let n = 0;
  for (const b of state.buildings) {
    sum += state.fields.pollution[b.y * state.map.w + b.x] ?? 0;
    n++;
  }
  return n ? sum / n : 0;
}

export function attraction(state: GameState): Attraction {
  const her = state.buildings.some((b) => b.kind === 'heritage' && b.built && !b.damaged) ? TOURISM.heritage.attract : 0;
  // Grandes obras: cada fase terminada da su parte del atractivo (puente y catedral).
  let lm = 0;
  for (const l of state.landmarks ?? []) {
    const site = state.buildings.find((b) => b.id === l.buildingId);
    if (!site || site.damaged) continue; // una obra destrozada no atrae (ronda 19)
    const fx = LANDMARKS.effects[l.kind] as { attract?: number };
    if (fx.attract && l.phases > 0) lm += (fx.attract * Math.min(l.phase, l.phases)) / l.phases;
  }
  const festival = (state.festival?.until ?? -1) > state.tick - TICKS_PER_MONTH ? TOURISM.festivalAttract : 0;
  let trees = 0;
  for (const t of state.map.tiles) if (t === Tile.Tree) trees++;
  const parks = state.buildings.filter((b) => b.kind === 'park' && b.built && !b.damaged).length;
  const green = Math.min(TOURISM.treesMax, trees * TOURISM.perTree + parks * TOURISM.perPark);
  const pollution = townPollution(state) * TOURISM.pollution;
  const base = Math.max(0, her + lm + festival + green - pollution);
  const mult = protectedHeritage(state)?.built ? TOURISM.protect.attract : 1;
  const total = Math.round(base * mult * 10) / 10;
  return { heritage: her, landmarks: Math.round(lm * 10) / 10, festival, green: Math.round(green * 10) / 10, pollution: Math.round(pollution * 10) / 10, protect: mult, total };
}

/** Visitantes que vendrán este mes (el que acaba de cerrar) con lo que hay ahora. */
export function expectedVisitors(state: GameState, month = tickToDate(state.tick - 1).month): number {
  const a = attraction(state);
  if (a.total < TOURISM.minAttract) return 0;
  const phase = state.region?.phase ?? 'normal';
  const region = REGION.fx[phase]?.visitors ?? 1;
  const tax = 1 - TOURISM.taxDrop * (state.tourism?.tax ?? 0);
  const tv = (state.tourism?.tvUntil ?? -1) >= state.tick ? TOURISM.tvReport : 1;
  // Feria regional: en septiembre, más visitantes (cada fase hecha da su parte).
  let fair = 1;
  for (const l of state.landmarks ?? []) {
    if (l.kind !== 'fair' || l.phases <= 0 || month !== LANDMARKS.effects.fair.month) continue;
    fair = Math.max(fair, 1 + ((LANDMARKS.effects.fair.visitors - 1) * Math.min(l.phase, l.phases)) / l.phases);
  }
  // 2.4: con estación de autobuses, más visitantes.
  return Math.round(a.total * TOURISM.perAttract * region * tax * tv * fair * busVisitorsFx(state));
}

/* ---------------- casas rurales ---------------- */

const isHome = (b: Building) => (b.kind === 'house' || b.kind === 'res') && b.built;

/** Quien lleva la casa rural: el primer propietario que vive en ella. */
export function ruralHost(state: GameState, b: Building): Citizen | undefined {
  return state.citizens.filter((c) => c.homeId === b.id && c.owns).sort((a, x) => a.id - x.id)[0];
}

export function ruralHomes(state: GameState): Building[] {
  return state.buildings.filter((b) => b.rural && isHome(b));
}

/** Parte de las viviendas que son casas rurales (0–1). */
export function ruralShare(state: GameState): number {
  const homes = state.buildings.filter(isHome).length;
  return homes ? ruralHomes(state).length / homes : 0;
}

/** Turistificación: demasiadas casas rurales (sube el alquiler privado). */
export function touristified(state: GameState): boolean {
  return ruralShare(state) > TOURISM.touristified.share;
}

/** Alquiler privado del mes (con turistificación, +20 %). Lo usa `monthlyHousing`. */
export function privateRentFx(state: GameState): number {
  return touristified(state) ? 1 + TOURISM.touristified.rent : 1;
}

/** Visitantes que puede alojar una casa rural al mes. */
export const ruralCapacity = (): number => Math.floor((TOURISM.rural.beds * 30) / TOURISM.nights);

/** ¿Abriría ahora una casa rural más? (hay visitantes para todas, con la media del año: no por un mes de fiestas) */
export function ruralDemand(state: GameState): boolean {
  const n = ruralHomes(state).length;
  return (state.tourism?.avg ?? 0) / (n + 1) >= TOURISM.rural.minVisitors;
}

/** ¿Puede este vecino abrir una casa rural? (propietario de su vivienda, con dinero para la reforma) */
export function canOpenRural(state: GameState, c: Citizen): boolean {
  if (!c.owns || c.homeId === null || c.money < TOURISM.rural.openCost) return false;
  const home = state.buildings.find((b) => b.id === c.homeId);
  return !!home && isHome(home) && !home.rural && !home.damaged && (state.tourism?.visitors ?? 0) > 0;
}

/** Para la IA (`abrir_casa_rural`): propietarios que pueden abrir una casa rural. */
export function ruralCandidates(state: GameState): Citizen[] {
  return state.citizens.filter((c) => canOpenRural(state, c));
}

/** Aplica `abrir_casa_rural` a un vecino (la reforma se paga fuera). Devuelve si se abrió. */
export function openRural(state: GameState, c: Citizen): boolean {
  if (!canOpenRural(state, c)) return false;
  const home = state.buildings.find((b) => b.id === c.homeId)!;
  transfer(state, c.id, OUTSIDE, TOURISM.rural.openCost);
  home.rural = true;
  if (c.named) addMemory(state, c, 'abrio_negocio', 4, 3);
  pushEvent(state, 'business', `${c.name} abre una casa rural en su casa (${TOURISM.rural.beds} plazas)`, { ref: home.id });
  return true;
}

/** Para la IA (`quejarse_turistas`): inquilinos que notan la subida del alquiler o vecinos junto a una casa rural. */
export function complainCandidates(state: GameState): Citizen[] {
  const rural = ruralHomes(state);
  if (!rural.length) return [];
  const crowded = touristified(state);
  // Sin ruido ni alquileres disparados no hay de qué quejarse (ronda 19).
  if (!crowded && (state.tourism?.noiseUntil ?? -1) < state.tick) return [];
  return state.citizens.filter((c) => {
    if (c.homeId === null) return false;
    const home = state.buildings.find((b) => b.id === c.homeId);
    if (!home || home.rural) return false;
    if (crowded && !c.owns && home.kind === 'res') return true;
    return rural.some((r) => dist(r, home) <= TOURISM.noise.radius);
  });
}

/** Aplica `quejarse_turistas`: lo recuerda y queda en el registro. */
export function complainTourists(state: GameState, c: Citizen): boolean {
  if (!complainCandidates(state).includes(c)) return false;
  if (c.named) addMemory(state, c, 'discusion', 2, -2);
  pushEvent(state, 'info', `${c.name} se queja de los turistas: «${touristified(state) ? 'con tanta casa rural, los alquileres no hay quien los pague' : 'no hay quien duerma con tanto turista'}»`, { ref: c.id });
  return true;
}

/* ---------------- director (IA) ---------------- */

/** Para el director: `reportaje_tv` (bueno) si hay patrimonio en pie y no hubo reportaje en un año. */
export function tvReportCandidate(state: GameState): boolean {
  return state.buildings.some((b) => b.kind === 'heritage' && b.built && !b.damaged) && (state.tourism?.tvUntil ?? -1e9) < state.tick - 12 * TICKS_PER_MONTH;
}

/** Reportaje en la tele: visitantes ×1,5 durante un mes. */
export function applyTvReport(state: GameState): void {
  state.tourism.tvUntil = state.tick + TICKS_PER_MONTH;
  const h = heritageOf(state);
  pushEvent(state, 'milestone', `La tele hace un reportaje sobre ${h ? HERITAGE_NAMES[heritageVariant(state, h.x, h.y)] : 'el pueblo'}: este mes vendrán más visitantes`, { ref: h?.id });
}

/** Para el director: `turistas_ruido` (malo, avisado antes) si hay casas rurales y bastantes visitantes. */
export function touristNoiseCandidate(state: GameState): boolean {
  return ruralHomes(state).length > 0 && (state.tourism?.visitors ?? 0) >= TOURISM.noise.minVisitors && (state.tourism?.noiseUntil ?? -1) < state.tick;
}

/** Turistas ruidosos: un mes de mal humor alrededor de las casas rurales. */
export function applyTouristNoise(state: GameState): void {
  state.tourism.noiseUntil = state.tick + TICKS_PER_MONTH;
  pushEvent(state, 'warning', 'Quejas por el ruido de los turistas junto a las casas rurales');
}

/* ---------------- felicidad ---------------- */

/** Lo que el turismo suma o resta a la felicidad de un vecino (`happinessFactors`). */
export function tourismMood(state: GameState, c: Citizen, home: Building | undefined): { label: string; value: number }[] {
  if (!home || !state.tourism) return [];
  const out: { label: string; value: number }[] = [];
  if (!c.owns && home.kind === 'res' && touristified(state)) out.push({ label: 'Los alquileres suben por las casas rurales', value: TOURISM.touristified.renterMood });
  if ((state.tourism.noiseUntil ?? -1) >= state.tick && !home.rural && ruralHomes(state).some((r) => dist(r, home) <= TOURISM.noise.radius)) {
    out.push({ label: 'Ruido de los turistas', value: TOURISM.noise.mood });
  }
  return out;
}

/* ---------------- fin de mes ---------------- */

/** Fin de mes (tras dividendos y cierres, antes de la PIE): visitantes, casas rurales y tasa. */
export function tourismMonth(state: GameState): void {
  const t = state.tourism;
  if (!t) return;
  if (t.protectedId !== undefined && !protectedHeritage(state)) delete t.protectedId;
  // Una casa rural sin su dueño dentro deja de serlo.
  for (const b of state.buildings) if (b.rural && (!isHome(b) || !ruralHost(state, b))) b.rural = false;
  const visitors = expectedVisitors(state);
  t.visitors = visitors;
  t.avg = Math.round((((t.avg ?? 0) * 11 + visitors) / 12) * 10) / 10;
  // Tasa turística: € por noche y visitante, al ayuntamiento.
  const tax = visitors * t.tax * TOURISM.nights;
  transfer(state, OUTSIDE, TREASURY, tax, 'turismo');
  // Casas rurales: los visitantes se reparten entre todas, cada una con su tope.
  const rural = ruralHomes(state);
  let earned = 0;
  if (rural.length && visitors > 0) {
    const lodged = Math.min(visitors, rural.length * ruralCapacity());
    const each = lodged / rural.length;
    for (const b of rural) {
      const host = ruralHost(state, b)!;
      earned += transfer(state, OUTSIDE, host.id, Math.min(TOURISM.rural.maxMonth, Math.round(each * TOURISM.rural.perVisitor)), 'turismo');
    }
  }
  t.lastIncome = tax + earned;
  t.lastTax = tax;
  t.lastRural = earned;
  // Sin IA (o quien no piensa con IA): un propietario ambicioso abre casa rural si hay visitantes para ella.
  if (visitors <= 0) return;
  for (const c of state.citizens) {
    if (c.traits.ambicion < TOURISM.ruralAmbition || thinksWithAi(state, c) || !canOpenRural(state, c)) continue;
    if (!ruralDemand(state)) break;
    if (chance(state.rng, TOURISM.ruralChance)) openRural(state, c);
  }
}

/** Igual que `isAiCitizen` (turns.ts), sin importarlo: con IA, lo decide su turno. */
function thinksWithAi(state: GameState, c: Citizen): boolean {
  return state.aiMode && c.named && !!state.ai && state.ai.share > 0;
}
