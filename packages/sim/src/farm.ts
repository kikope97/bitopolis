import { TICKS_PER_DAY, TICKS_PER_MONTH, tickToDate } from '@bitopolis/shared';
import { FARM, MIN_WAGE } from './balance.ts';
import { addMoment } from './album.ts';
import { hash32 } from './hash.ts';
import { OUTSIDE, transfer } from './money.ts';
import { chance, pick } from './prng.ts';
import { addMemory } from './social.ts';
import { type Building, type Citizen, type Crop, DIRS, type GameState, inBounds, newBuilding, pushEvent, terrainAt, Tile, tileIndex, Zone } from './state.ts';
import { isWater, Terrain } from './terrain.ts';
import { townLevel } from './townhall.ts';

/**
 * 2.2: el campo. En la zona A (agraria) crecen fincas junto a una carretera
 * (no necesitan agua ni luz). El cultivo sale del terreno: cerca del río,
 * regadío (huerta); en la colina, olivar o viñedo (por hash de la casilla);
 * en el resto, secano. Cada finca tiene un empleo fijo y, en el mes de la
 * cosecha, temporeros. Lo que vende es la base anual de su cultivo por el
 * factor del año, que se acumula cada día con el tiempo (weather.ts). Paga
 * IBI rústico y no cierra por un mes malo: vive de una cosecha al año.
 */

export const CROPS: readonly Crop[] = ['secano', 'regadio', 'olivar', 'vinedo'];

export const CROP_TEXT: Record<Crop, string> = { secano: 'Secano (cereal)', regadio: 'Regadío (huerta)', olivar: 'Olivar', vinedo: 'Viñedo' };
/** Para la franja al pintar la zona: «Aquí: regadío (río)». */
export const CROP_HINT: Record<Crop, string> = { secano: 'secano (cereal)', regadio: 'regadío (río)', olivar: 'olivar (colina)', vinedo: 'viñedo (colina)' };
/** Nombre de la finca en las frases. */
export const FARM_NAME: Record<Crop, string> = { secano: 'la finca de cereal', regadio: 'la huerta', olivar: 'el olivar', vinedo: 'el viñedo' };
export const HARVEST_NAME: Record<Crop, string> = { secano: 'la siega', regadio: 'la recogida de la huerta', olivar: 'la aceituna', vinedo: 'la vendimia' };
export const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const;

export const isFarm = (b: Building): boolean => b.kind === 'farm';

/** ¿Hay río a `FARM.riverReach` casillas o menos (también en diagonal)? */
export function nearRiver(state: GameState, x: number, y: number, reach: number = FARM.riverReach): boolean {
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (inBounds(state, x + dx, y + dy) && terrainAt(state, x + dx, y + dy) === Terrain.River) return true;
    }
  }
  return false;
}

/** El cultivo que corresponde a una casilla (determinista: solo depende del terreno y la semilla). */
export function cropAt(state: GameState, x: number, y: number): Crop {
  if (nearRiver(state, x, y)) return 'regadio';
  if (terrainAt(state, x, y) === Terrain.Hill) return hash32(state.seed, x, y, 22) % 2 === 0 ? 'olivar' : 'vinedo';
  return 'secano';
}

export const harvestMonthOf = (crop: Crop): number => FARM.harvestMonth[crop];

/** ¿Se puede pintar zona agraria? (nivel del ayuntamiento y vecinos) */
export function farmZoneUnlocked(state: GameState): { ok: true } | { ok: false; error: string } {
  if (townLevel(state) < FARM.level) return { ok: false, error: `La zona agraria se desbloquea con el ayuntamiento de nivel ${FARM.level}` };
  if (state.citizens.length < FARM.unlockPop) return { ok: false, error: `La zona agraria se desbloquea con ${FARM.unlockPop} vecinos` };
  return { ok: true };
}

/** Cosecha prevista con el factor de hoy. */
export function farmOutlook(b: Building): 'buena' | 'normal' | 'mala' {
  const fx = b.yieldFx ?? FARM.start;
  return fx >= FARM.goodFrom ? 'buena' : fx < FARM.badBelow ? 'mala' : 'normal';
}

/** Lo que vendería si cosechara hoy (euros enteros). */
export function expectedHarvest(b: Building): number {
  if (!b.crop) return 0;
  return Math.round(FARM.base[b.crop] * clampFx(b.yieldFx ?? FARM.start));
}

const clampFx = (v: number) => Math.max(FARM.min, Math.min(FARM.max, v));
/** Redondeo a diezmilésimas: el factor se guarda en el estado (JSON estable). */
const round4 = (v: number) => Math.round(v * 10_000) / 10_000;
/** Se guarda sin recortar a min–max (solo al vender): así un año húmedo y otro seco se compensan. */
const store = (v: number) => round4(Math.max(0, Math.min(FARM.cap, v)));

/** Fincas que cosechan este mes (las que funcionan y aún no han vendido este año). */
export function harvestingNow(state: GameState): Building[] {
  const d = tickToDate(state.tick);
  return state.buildings.filter((b) => isFarm(b) && b.built && !b.damaged && b.crop && harvestMonthOf(b.crop) === d.month && b.harvested !== d.year);
}

/* ---------------- el tiempo (lo llama weather.ts cada día) ---------------- */

/** Cada día: la lluvia suma, el calor resta y, en el mes de cosecha, la tormenta quita. */
export function farmWeatherDay(state: GameState): void {
  const kind = state.weather?.kind;
  if (!kind) return;
  const month = tickToDate(state.tick).month;
  for (const b of state.buildings) {
    if (!isFarm(b) || !b.built || !b.crop) continue;
    const sens = b.crop === 'regadio' ? FARM.irrigated : 1;
    // Cada día sin agua la tierra se seca un poco (así, un año normal acaba cerca de 1).
    let fx = (b.yieldFx ?? FARM.start) + FARM.dry * sens;
    if (kind === 'lluvia') fx += FARM.rain * sens;
    else if (kind === 'calor') fx += FARM.heat * sens;
    else if (kind === 'tormenta') {
      b.stormed = state.tick;
      if (harvestMonthOf(b.crop) === month) fx *= 1 + FARM.storm;
      else fx += FARM.rain * sens;
    }
    b.yieldFx = store(fx);
  }
}

/** Una riada sobre una finca: el regadío pierde gran parte de la cosecha (no hay obra que reparar). */
export function floodFarm(b: Building): void {
  if (b.crop !== 'regadio') return;
  b.yieldFx = store(((b.yieldFx ?? FARM.start) * (1 + FARM.flood)));
}

/* ---------------- crecimiento ---------------- */

/** Solares de zona A libres junto a una carretera. */
export function farmSpots(state: GameState): number[] {
  const { w, h, tiles, zones } = state.map;
  const taken = new Set(state.buildings.map((b) => b.y * w + b.x));
  const out: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (zones[i] !== Zone.A || tiles[i] === Tile.Road || taken.has(i) || isWater(state.map.terrain?.[i])) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    if (DIRS.some(([dx, dy]) => inBounds(state, x + dx, y + dy) && tiles[tileIndex(state, x + dx, y + dy)] === Tile.Road)) out.push(i);
  }
  return out;
}

/** Meses desde ahora hasta el final del mes de cosecha (1–12). */
function monthsToHarvest(state: GameState, crop: Crop): number {
  const m = tickToDate(state.tick).month;
  return ((harvestMonthOf(crop) - m + 12) % 12) + 1;
}

/** Cada día: si hay zona agraria con carretera y sitio, un inversor de fuera planta una finca. */
export function growFarms(state: GameState): void {
  // Sin zona A no se tira ningún dado (las partidas sin campo siguen igual).
  if (!state.map.zones.includes(Zone.A)) return;
  const farms = state.buildings.filter(isFarm).length;
  const factories = state.buildings.filter((b) => b.kind === 'factory').length;
  if (farms >= 1 + Math.min(Math.floor(state.citizens.length / FARM.popPerFarm), FARM.perFactory * factories)) return;
  const spots = farmSpots(state);
  if (!spots.length || !chance(state.rng, FARM.growChance)) return;
  const i = pick(state.rng, spots);
  const { w } = state.map;
  state.map.tiles[i] = Tile.Grass;
  const b = newBuilding(state, 'farm', i % w, Math.floor(i / w), OUTSIDE);
  const crop = cropAt(state, b.x, b.y);
  b.crop = crop;
  b.yieldFx = FARM.start;
  const d = tickToDate(state.tick);
  // Si ya no da tiempo a sembrar para la cosecha de este año, la primera es el año que viene.
  if (d.month >= harvestMonthOf(crop) - 1) b.harvested = d.year;
  const months = monthsToHarvest(state, crop) + (b.harvested === d.year ? 12 : 0);
  transfer(state, OUTSIDE, b.id, Math.min(FARM.cashCap, MIN_WAGE[state.minWage ?? 'none'] * months + FARM.seedExtra));
  const g = FARM.growth;
  state.projects.push({ buildingId: b.id, payer: OUTSIDE, workersNeeded: g.workers, workerDaysNeeded: g.workers * g.days, workerDaysDone: 0, crew: [], outsideToday: 0, notify: false });
}

/* ---------------- la cosecha (fin de mes) ---------------- */

/** ¿Está apuntado de temporero para la cosecha de este mes? */
const signedUp = (state: GameState, c: Citizen) => c.temporero !== undefined && state.tick - c.temporero <= TICKS_PER_MONTH + TICKS_PER_DAY;

/**
 * Al cerrar el mes de cosecha de cada finca: vende la cosecha (de fuera a la
 * finca), paga a los temporeros (primero los que se apuntaron, luego otros
 * vecinos sin trabajo y el resto, de fuera) y el factor vuelve a empezar.
 * Va antes de las nóminas: la venta entra en las cuentas del mes.
 */
export function farmMonth(state: GameState): void {
  // El mes que acaba de cerrar (este tick ya es el día 1 del siguiente).
  const d = tickToDate(state.tick - 1);
  const used = new Set<number>();
  let first = !state.album?.some((m) => m.kind === 'primera_cosecha');
  for (const b of state.buildings) {
    if (!isFarm(b) || !b.built || b.damaged || !b.crop || harvestMonthOf(b.crop) !== d.month || b.harvested === d.year) continue;
    const sale = expectedHarvest(b);
    const outlook = farmOutlook(b);
    transfer(state, OUTSIDE, b.id, sale);
    b.sales = (b.sales ?? 0) + sale;
    b.harvested = d.year;
    // Temporeros: los apuntados, luego vecinos sin trabajo; el resto viene de fuera.
    const locals = state.citizens
      .filter((c) => c.jobId === null && !used.has(c.id))
      .sort((x, y) => Number(signedUp(state, y)) - Number(signedUp(state, x)) || x.id - y.id)
      .slice(0, FARM.seasonal);
    for (const c of locals) {
      used.add(c.id);
      transfer(state, b.id, c.id, FARM.seasonalWage, 'temporeros');
      if (c.named) addMemory(state, c, 'temporada', 2, 1);
    }
    transfer(state, b.id, OUTSIDE, (FARM.seasonal - locals.length) * FARM.seasonalWage);
    b.yieldFx = FARM.start;
    const text = `${cap(HARVEST_NAME[b.crop])}: ${FARM_NAME[b.crop]} vende ${sale} € (cosecha ${outlook})${locals.length ? `, con ${locals.length === 1 ? 'un temporero' : `${locals.length} temporeros`} del pueblo` : ''}`;
    pushEvent(state, 'business', first ? `Primera cosecha del pueblo. ${text}` : text, { ref: b.id });
    // 2.2: «Primera cosecha» en el álbum (una sola vez).
    if (first) addMoment(state, 'primera_cosecha', `Primera cosecha: ${HARVEST_NAME[b.crop]} en ${FARM_NAME[b.crop]}`, b);
    first = false;
  }
  for (const c of state.citizens) if (c.temporero !== undefined && !signedUp(state, c)) delete c.temporero;
  for (const id of used) {
    const c = state.citizens.find((x) => x.id === id);
    if (c) delete c.temporero;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------------- IA: temporeros ---------------- */

/** ¿Puede apuntarse de temporero? (parado, en el mes de cosecha de alguna finca, sin apuntarse aún) */
export function canSignTemporero(state: GameState, c: Citizen): Building | undefined {
  if (c.jobId !== null || signedUp(state, c)) return undefined;
  return harvestingNow(state)[0];
}

export function signTemporero(state: GameState, c: Citizen): string {
  const b = canSignTemporero(state, c);
  if (!b || !b.crop) return 'no encuentra temporada en el campo';
  c.temporero = state.tick;
  return `se apunta de temporero para ${HARVEST_NAME[b.crop]}`;
}

/* ---------------- invariantes ---------------- */

export function farmInvariants(state: GameState): string[] {
  const errors: string[] = [];
  for (const b of state.buildings) {
    if (!isFarm(b)) continue;
    if (state.map.zones[tileIndex(state, b.x, b.y)] !== Zone.A) errors.push(`finca ${b.id} fuera de la zona agraria`);
    if (!b.crop || b.crop !== cropAt(state, b.x, b.y)) errors.push(`finca ${b.id} con cultivo incoherente con el terreno`);
    const fx = b.yieldFx ?? FARM.start;
    if (!(fx >= 0 && fx <= FARM.cap)) errors.push(`finca ${b.id} con factor de cosecha fuera de rango`);
  }
  return errors;
}

/* ---------------- director (Modo IA) ---------------- */

/** Fincas que cosechan este mes con una cosecha que merece fiesta (no mala). */
export function feastCandidates(state: GameState): Building[] {
  return harvestingNow(state)
    .filter((b) => farmOutlook(b) !== 'mala')
    .sort((a, b) => (b.yieldFx ?? 0) - (a.yieldFx ?? 0) || a.id - b.id);
}

/** Fincas con la cosecha aún en el campo y una tormenta reciente encima (el granizo, solo así). */
export function hailCandidates(state: GameState): Building[] {
  const year = tickToDate(state.tick).year;
  return state.buildings
    .filter((b) => isFarm(b) && b.built && !b.damaged && b.crop && b.harvested !== year && b.stormed !== undefined && state.tick - b.stormed <= FARM.hailDays * TICKS_PER_DAY)
    .sort((a, b) => b.stormed! - a.stormed! || a.id - b.id);
}

/** La fiesta de la cosecha (o de la vendimia): algo más de venta y alegría en el pueblo. */
export function harvestFeast(state: GameState, b: Building): boolean {
  if (!b.crop || !feastCandidates(state).includes(b)) return false;
  b.yieldFx = store((b.yieldFx ?? FARM.start) + FARM.feast);
  // Lo celebran quien trabaja en la finca y unos cuantos vecinos (siempre los mismos para este tick).
  const reach = [...state.citizens]
    .sort((x, y) => Number(y.jobId === b.id) - Number(x.jobId === b.id) || hash32(state.seed, x.id, state.tick) - hash32(state.seed, y.id, state.tick))
    .slice(0, FARM.feastReach);
  for (const c of reach) {
    c.grudge = Math.max(0, c.grudge - 1);
    if (c.named) addMemory(state, c, 'buena_cosecha', 3, 3);
  }
  pushEvent(state, 'milestone', `${b.crop === 'vinedo' ? 'Fiesta de la vendimia' : 'Fiesta de la cosecha'} en ${FARM_NAME[b.crop]}: el pueblo sale a celebrarlo`, { ref: b.id });
  return true;
}

/** Granizo: se pierde parte de la cosecha de la finca. */
export function hail(state: GameState, b: Building): boolean {
  if (!b.crop || !hailCandidates(state).includes(b)) return false;
  b.yieldFx = store(((b.yieldFx ?? FARM.start) * (1 + FARM.hail)));
  delete b.stormed;
  for (const c of state.citizens) if (c.jobId === b.id && c.named) addMemory(state, c, 'granizo', 3, -3);
  pushEvent(state, 'warning', `Cae una granizada sobre ${FARM_NAME[b.crop]}: se pierde parte de la cosecha (ahora se espera ${farmOutlook(b)})`, { ref: b.id, notify: true });
  return true;
}
