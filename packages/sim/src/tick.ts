import { errandsDay } from './errands.ts';
import { pressDay } from './press.ts';
import { TICKS_PER_DAY, TICKS_PER_MONTH, tickToDate } from '@bitopolis/shared';
import {
  BUSINESS_SEED_CASH,
  COMMUTER_DAILY,
  DEBT_INTEREST,
  FOUND_MIN_MONEY,
  DEBT_INTEREST_CAP,
  DEBT_INTEREST_HIGH,
  DEBT_INTEREST_STEP,
  DEBT_LIMIT,
  FACTORY_REVENUE_PER_WORKER,
  GROWTH,
  HOMES,
  PIE_PER_CITIZEN,
  DEBT,
  JOBS_OUTSIDE,
  MIN_WAGE,
  MIN_WAGE_FX,
  MIN_WAGE_STEP,
  PUBLIC_SALARY,
  SERVICE,
  SERVICE_SALARY,
  WAGE_LOCAL,
  WAGE_OUTSIDE,
  CRIME,
  SOCIAL_PLACES,
  TERRAIN,
  TURN,
  CIVIL,
  FIRE,
} from './balance.ts';
import { applyCommand, BUILD_NAMES, removeBuilding } from './commands.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { chance, nextInt, pick } from './prng.ts';
import { detectTriggers, onNamedArrival, resolveDuePending } from './decisions.ts';
import {
  accumulateRates,
  averageTaxMood,
  businessTaxes,
  maybeSplitTaxes,
  housingTroubles,
  monthlyHousing,
  monthlyMarket,
  monthRates,
  payDividends,
  sellOnDeparture,
  taxMood,
  updateGrudges,
  serviceSaturation,
} from './economy.ts';
import { budgetFx, civicDay, festivalMood, onBuildingDone } from './civic.ts';
import { updateFields } from './fields.ts';
import { trashDay, trashMood } from './trash.ts';
import { Terrain } from './terrain.ts';
import { weatherDay, weatherFx, weatherMood } from './weather.ts';
import { associationsDay, associationsMonth } from './associations.ts';
import { albumDay } from './album.ts';
import { rankDay } from './rank.ts';
import { crimeDay, jailNear } from './crime.ts';
import { townLevel, zonesUnlocked } from './townhall.ts';
import { finishUpgrades, jobsOf, maintenanceOf, plantCapacityOf, radiusOf, serviceHappiness } from './levels.ts';
import { lifeDay, lifeMonth, lifeYear } from './lifecycle.ts';
import { burntDown, fireDay, fireTick, volunteersMonth } from './fire.ts';
import { aiByShare, plansDay, turnsTick } from './turns.ts';
import { ruleTurn } from './decisions.ts';
import { basicLiving, drownedInDebt, economyStats, outsideJobsMonth, settleMonth, totalDebt, unansweredDeferrals } from './household.ts';
import { FIRST_NAMES, SURNAMES } from './names.ts';
import { addMemory, goalFor, memoryMood, onCitizenLeaves, PROFESSIONS, relationMood, socialDay } from './social.ts';
import { politicsDay } from './politics.ts';
import {
  type Building,
  type Citizen,
  DIRS,
  DESIRES,
  FEARS,
  type GameState,
  inBounds,
  randomTraits,
  newBuilding,
  NO_PROPERTY,
  pushEvent,
  terrainAt,
  Tile,
  tileIndex,
  Zone,
} from './state.ts';

/* ---------- consultas ---------- */

export function isBusiness(b: Building): boolean {
  return b.kind === 'shop' || b.kind === 'factory';
}

export function homeCapacity(b: Building): number {
  // 2.1: una casa destrozada por el fuego no admite a nadie nuevo hasta repararla.
  return b.built && !burntDown(b) ? (HOMES[b.kind] ?? 0) : 0;
}

export function jobCapacity(b: Building): number {
  // Ronda 15: una empresa que pierde dinero recorta plantilla (b.staff) antes de cerrar.
  // 2.1: lo destrozado por el fuego no contrata hasta repararlo.
  return b.built && !burntDown(b) ? Math.min(jobsOf(b), b.staff ?? Infinity) : 0;
}

export function occupants(state: GameState, b: Building): Citizen[] {
  return state.citizens.filter((c) => c.homeId === b.id);
}

export function freeHomes(state: GameState): number {
  const used = new Map<number, number>();
  for (const c of state.citizens) if (c.homeId !== null) used.set(c.homeId, (used.get(c.homeId) ?? 0) + 1);
  let free = 0;
  for (const b of state.buildings) free += Math.max(0, homeCapacity(b) - (used.get(b.id) ?? 0));
  return free;
}

export function vacancies(state: GameState): number {
  const used = new Map<number, number>();
  for (const c of state.citizens) if (c.jobId !== null) used.set(c.jobId, (used.get(c.jobId) ?? 0) + 1);
  let v = 0;
  for (const b of state.buildings) v += Math.max(0, jobCapacity(b) - (used.get(b.id) ?? 0));
  return v;
}

export function averageHappiness(state: GameState): number {
  if (state.citizens.length === 0) return 0;
  return state.citizens.reduce((s, c) => s + c.happiness, 0) / state.citizens.length;
}

/** ¿Hay río en una casilla vecina (incluidas las diagonales)? */
export function riverside(state: GameState, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && inBounds(state, x + dx, y + dy) && terrainAt(state, x + dx, y + dy) === Terrain.River) return true;
  return false;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/* ---------- redes de agua y luz ---------- */

/**
 * Las tuberías y el cableado van bajo las carreteras. Cada planta da servicio
 * por la red de carreteras conectada a ella, en orden de distancia, hasta su
 * capacidad. Devuelve qué tiles de carretera tienen agua y luz.
 */
export function updateNetworks(state: GameState): { water: Set<number>; power: Set<number> } {
  const { w, tiles } = state.map;
  for (const b of state.buildings) {
    b.hasWater = false;
    b.hasPower = false;
  }
  const roadsWith = { water: new Set<number>(), power: new Set<number>() };
  const byRoad = new Map<number, Building[]>();
  for (const b of state.buildings) {
    for (const [dx, dy] of DIRS) {
      const nx = b.x + dx;
      const ny = b.y + dy;
      if (!inBounds(state, nx, ny)) continue;
      const i = tileIndex(state, nx, ny);
      if (tiles[i] !== Tile.Road) continue;
      const list = byRoad.get(i) ?? [];
      list.push(b);
      byRoad.set(i, list);
    }
  }
  for (const kind of ['water', 'power'] as const) {
    const flag = kind === 'water' ? 'hasWater' : 'hasPower';
    for (const plant of state.buildings) {
      if (plant.kind !== kind || !plant.built) continue;
      plant[flag] = true;
      let capacity = Math.round(plantCapacityOf(plant) * (kind === 'water' ? weatherFx(state).water : weatherFx(state).power));
      // v1.7: una bomba a la orilla del río da agua a más edificios.
      if (kind === 'water' && riverside(state, plant.x, plant.y)) capacity = Math.round(capacity * TERRAIN.riverPumpBonus);
      const queue: number[] = [];
      const seen = new Set<number>();
      for (const [dx, dy] of DIRS) {
        const nx = plant.x + dx;
        const ny = plant.y + dy;
        if (inBounds(state, nx, ny) && tiles[tileIndex(state, nx, ny)] === Tile.Road) {
          const i = tileIndex(state, nx, ny);
          queue.push(i);
          seen.add(i);
        }
      }
      while (queue.length > 0) {
        const i = queue.shift()!;
        roadsWith[kind].add(i);
        for (const b of byRoad.get(i) ?? []) {
          if (b[flag] || !b.built) continue;
          if (capacity <= 0) continue;
          b[flag] = true;
          capacity--;
        }
        const x = i % w;
        const y = Math.floor(i / w);
        for (const [dx, dy] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(state, nx, ny)) continue;
          const j = tileIndex(state, nx, ny);
          if (tiles[j] === Tile.Road && !seen.has(j)) {
            seen.add(j);
            queue.push(j);
          }
        }
      }
    }
  }
  return roadsWith;
}

/* ---------- demanda RCI ---------- */

export function computeDemand(state: GameState): GameState['demand'] {
  const pop = state.citizens.length;
  const jobless = state.citizens.filter((c) => c.jobId === null).length;
  const shops = state.buildings.filter((b) => b.kind === 'shop').length;
  const factories = state.buildings.filter((b) => b.kind === 'factory').length;
  const free = freeHomes(state);
  const happy = averageHappiness(state);
  const clamp = (v: number) => Math.round(Math.max(-100, Math.min(100, v)));
  const zones = zonesUnlocked(state);
  const R = 40 + vacancies(state) * 5 - Math.max(0, free - 8) * 1.5 + (happy - 55) + averageTaxMood(state) - (zones ? jobless * 2 : 0);
  // v1.9: con sueldo mínimo alto, las empresas suben precios y hay algo menos de demanda comercial.
  const C = !zones ? 0 : (pop / 12 - shops) * 25 - MIN_WAGE_STEP[state.minWage ?? 'none'] * MIN_WAGE_FX.demandC;
  const I = !zones ? 0 : jobless * 6 - factories * 10 + 20;
  return { R: clamp(R), C: clamp(C), I: clamp(I) };
}

/* ---------- felicidad ---------- */

export function happinessFactors(state: GameState, c: Citizen): { label: string; value: number }[] {
  const f: { label: string; value: number }[] = [];
  const home = c.homeId !== null ? state.buildings.find((b) => b.id === c.homeId) : undefined;
  if (!home) f.push({ label: 'Sin casa', value: -20 });
  else {
    // 2.1: su casa quedó destrozada por el fuego (hasta que se repare).
    if (burntDown(home)) f.push({ label: 'El fuego le destrozó la casa', value: -FIRE.burntHomeMood });
    f.push({ label: c.owns ? 'Casa en propiedad' : 'Tiene casa', value: c.owns ? 11 : 8 });
    f.push(home.hasWater ? { label: 'Agua', value: 8 } : { label: 'Sin agua', value: -12 });
    f.push(home.hasPower ? { label: 'Luz', value: 8 } : { label: 'Sin luz', value: -12 });
    // Servicios con rendimiento decreciente: no se acumulan sin límite.
    let services = 0;
    const seen = new Set<string>();
    const full = new Set<string>();
    for (const b of state.buildings) {
      const s = SERVICE[b.kind];
      if (!s || !b.built || b.damaged || dist(b, home) > radiusOf(b)) continue;
      // Un servicio saturado rinde en proporción a los vecinos que puede atender.
      const load = serviceSaturation(state, b.kind, b.id);
      if (load < 0.9) full.add(b.kind);
      const hp = serviceHappiness(b);
      services += (seen.has(b.kind) ? hp / 2 : hp) * load * budgetFx(state).services;
      seen.add(b.kind);
    }
    if (services > 0) {
      const v = Math.round(10 * (1 - Math.exp(-services / 10)) * (state.bankrupt ? 0.5 : 1));
      if (v > 0) f.push({ label: `Servicios cerca (${[...seen].map((k) => BUILD_NAMES[k]!.toLowerCase()).join(', ')})`, value: v });
    }
    if (full.size) f.push({ label: `Servicio saturado (${[...full].map((k) => BUILD_NAMES[k]!.toLowerCase()).join(', ')})`, value: -2 });
    if (state.buildings.some((b) => b.kind === 'shop' && b.built && !b.damaged && dist(b, home) <= 6)) f.push({ label: 'Tienda cerca', value: 4 });
    if (jailNear(state, home)) f.push({ label: 'Cárcel cerca', value: -CRIME.jailNuisanceMood });
    const i = home.y * state.map.w + home.x;
    const pol = state.fields.pollution[i] ?? 0;
    const noise = state.fields.noise[i] ?? 0;
    const crime = state.fields.crime[i] ?? 0;
    if (pol > 20) f.push({ label: 'Contaminación', value: -Math.round((pol - 20) / 5) });
    if (noise > 25) f.push({ label: 'Ruido', value: -Math.round((noise - 25) / 6) });
    if (crime > 20) f.push({ label: 'Inseguridad', value: -Math.round((crime - 20) / 5) });
    // 2.1: basura sin recoger en su calle (bolsas o ratas).
    const dirty = trashMood(state, home);
    if (dirty) f.push(dirty);
  }
  if (c.jobId !== null) f.push({ label: 'Trabaja en el pueblo', value: 8 });
  else if (c.unemployedSince !== undefined) f.push({ label: 'En paro', value: -JOBS_OUTSIDE.mood });
  else f.push({ label: 'Trabaja fuera', value: -4 });
  if (c.mortgage > 0 && c.money < 300) f.push({ label: 'Le cuesta pagar la hipoteca', value: -6 });
  // v1.9 (petición del creador): deber dinero pesa; ir justo, algo.
  const owes = totalDebt(c);
  if (owes > 0) f.push({ label: 'Debe dinero', value: -Math.min(DEBT.moodMax, Math.round(DEBT.moodBase + owes / DEBT.moodPer)) });
  else if (c.money < DEBT.tightBelow) f.push({ label: 'Llega justo a fin de mes', value: -DEBT.tightMood });
  // v1.9: sueldo mínimo: lo agradece quien trabaja en una empresa del pueblo y lo nota quien la tiene.
  const step = MIN_WAGE_STEP[state.minWage ?? 'none'];
  if (step > 0) {
    const job = c.jobId !== null ? state.buildings.find((b) => b.id === c.jobId) : undefined;
    if (job && isBusiness(job)) f.push({ label: 'Mejor sueldo (sueldo mínimo)', value: MIN_WAGE_FX.workerMood * step });
    const employs = state.buildings.some((b) => b.owner === c.id && isBusiness(b) && state.citizens.some((x) => x.jobId === b.id));
    if (employs) f.push({ label: 'Le suben los costes (sueldo mínimo)', value: -MIN_WAGE_FX.ownerMood * step });
  }
  // Ronda 15: su negocio pierde dinero (se nota, con o sin sueldo mínimo).
  const losing = state.buildings.some((b) => b.owner === c.id && isBusiness(b) && b.books && b.books.sales - b.books.wages - b.books.taxes < 0);
  if (losing) f.push({ label: 'Su negocio pierde dinero', value: -5 });
  f.push(...taxMood(state, c));
  f.push(...relationMood(c));
  const mem = memoryMood(state, c);
  if (mem) f.push({ label: mem > 0 ? 'Buenos recuerdos recientes' : 'Malos recuerdos recientes', value: mem });
  if (state.bankrupt) f.push({ label: 'Ayuntamiento en quiebra', value: -8 });
  // v1.5: fiestas y familia.
  const fest = festivalMood(state);
  if (fest) f.push(fest);
  if (c.kids?.length) f.push({ label: c.kids.length === 1 ? 'Un hijo en casa' : `${c.kids.length} hijos en casa`, value: 3 });
  // v1.7: la biblioteca, para quien quiere prosperar; sin cementerio, el duelo pesa.
  if (home && c.desire === 'prosperar' && state.buildings.some((b) => b.kind === 'library' && b.built && !b.damaged && dist(b, home) <= radiusOf(b))) {
    f.push({ label: 'Biblioteca cerca para formarse', value: SOCIAL_PLACES.libraryProsper });
  }
  if (!state.buildings.some((b) => b.kind === 'cemetery' && b.built) && c.memories.some((m) => m.kind === 'perdio_a' && state.tick - m.tick < 360 * TICKS_PER_DAY)) {
    f.push({ label: 'Sin cementerio donde despedir a los suyos', value: -SOCIAL_PLACES.noCemeteryMood });
  }
  // 2.1: voluntario de protección civil.
  if (c.volunteer) f.push({ label: 'Voluntario de protección civil', value: CIVIL.volunteerMood });
  // v1.8: el Palacio Municipal (nivel 5) es motivo de orgullo.
  if (townLevel(state) >= 5) f.push({ label: 'Orgullo de su ayuntamiento', value: 2 });
  // v1.7: el calor sin sombra cerca.
  const heat = weatherMood(state, home);
  if (heat) f.push(heat);
  return f;
}

function targetHappiness(state: GameState, c: Citizen): number {
  const t = 38 + happinessFactors(state, c).reduce((s, x) => s + x.value, 0);
  return Math.max(0, Math.min(100, t));
}

/* ---------- obras ---------- */

function progressProjects(state: GameState): void {
  const busy = new Set<number>();
  for (const p of state.projects) {
    p.crew = [];
    for (const c of state.citizens) {
      if (p.crew.length >= p.workersNeeded) break;
      if (c.jobId === null && !busy.has(c.id)) {
        p.crew.push(c.id);
        busy.add(c.id);
      }
    }
    // Nunca se bloquea: lo que falte se contrata fuera, más caro.
    p.outsideToday = p.workersNeeded - p.crew.length;
    for (const id of p.crew) transfer(state, p.payer, id, WAGE_LOCAL, 'obras');
    transfer(state, p.payer, OUTSIDE, p.outsideToday * WAGE_OUTSIDE, 'obras');
    // v1.7: con nieve, las obras avanzan a la mitad (los sueldos se pagan igual).
    p.workerDaysDone += p.workersNeeded * weatherFx(state).build;
  }
  for (const p of [...state.projects]) {
    if (p.workerDaysDone < p.workerDaysNeeded) continue;
    const b = state.buildings.find((x) => x.id === p.buildingId);
    state.projects = state.projects.filter((x) => x !== p);
    if (!b) continue;
    b.built = true;
    pushEvent(state, 'built', `Terminada la obra: ${BUILD_NAMES[b.kind]}`, { ref: b.id, notify: p.notify });
    onBuildingDone(state, b);
  }
  // Quien trabajó hoy en una obra no cobra como commuter.
  for (const c of state.citizens) {
    // v1.9: quien está en paro no cobra (cobra la prestación al mes).
    if (c.jobId === null && c.unemployedSince === undefined && !busy.has(c.id)) transfer(state, OUTSIDE, c.id, COMMUTER_DAILY, 'commuter');
  }
}

/* ---------- crecimiento sobre zonas ---------- */

function growZones(state: GameState, served: { water: Set<number>; power: Set<number> }): void {
  const { w, h, tiles, zones } = state.map;
  const kinds = [
    [Zone.R, 'res', state.demand.R],
    [Zone.C, 'shop', state.demand.C],
    [Zone.I, 'factory', state.demand.I],
  ] as const;
  // Los locales comerciales se reservan para vecinos que quieren emprender.
  const localFounders = state.citizens.some((c) => c.money >= FOUND_MIN_MONEY);
  for (const [zone, kind, demand] of kinds) {
    if (demand <= 15) continue;
    if (kind === 'shop' && localFounders && chance(state.rng, 0.8)) continue;
    // No se construyen más viviendas si ya sobran.
    if (kind === 'res' && freeHomes(state) >= 6) continue;
    if (!chance(state.rng, Math.min(0.9, demand / 80))) continue;
    // Solares válidos: zona correcta, libre, junto a carretera con agua y luz.
    const spots: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (zones[i] !== zone || tiles[i] === Tile.Road) continue;
        if (state.buildings.some((b) => b.x === x && b.y === y)) continue;
        const ok = DIRS.some(([dx, dy]) => {
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(state, nx, ny)) return false;
          const j = tileIndex(state, nx, ny);
          return served.water.has(j) && served.power.has(j);
        });
        if (ok) spots.push(i);
      }
    }
    if (spots.length === 0) continue;
    const i = pick(state.rng, spots);
    tiles[i] = Tile.Grass;
    const b = newBuilding(state, kind, i % w, Math.floor(i / w), OUTSIDE);
    if (kind !== 'res') transfer(state, OUTSIDE, b.id, BUSINESS_SEED_CASH);
    const g = GROWTH[kind];
    state.projects.push({
      buildingId: b.id,
      payer: OUTSIDE,
      workersNeeded: g.workers,
      workerDaysNeeded: g.workers * g.days,
      workerDaysDone: 0,
      crew: [],
      outsideToday: 0,
      notify: false,
    });
  }
}

/* ---------- vecinos ---------- */

function uniqueName(state: GameState): string {
  const used = new Set(state.citizens.map((c) => c.name));
  for (let i = 0; i < 20; i++) {
    const n = `${pick(state.rng, FIRST_NAMES)} ${pick(state.rng, SURNAMES)}`;
    if (!used.has(n)) return n;
  }
  return `${pick(state.rng, FIRST_NAMES)} ${pick(state.rng, SURNAMES)} ${state.nextId}`;
}

function assignHomesAndJobs(state: GameState): void {
  const homeUse = new Map<number, number>();
  const jobUse = new Map<number, number>();
  for (const c of state.citizens) {
    if (c.homeId !== null) homeUse.set(c.homeId, (homeUse.get(c.homeId) ?? 0) + 1);
    if (c.jobId !== null) jobUse.set(c.jobId, (jobUse.get(c.jobId) ?? 0) + 1);
  }
  // v1.9: quien está detenido no busca trabajo; a quien desahuciaron nadie le alquila en unos meses.
  const detained = new Set<number>();
  for (const x of state.justice?.cells ?? []) if (x.citizenId !== undefined) detained.add(x.citizenId);
  for (const x of state.justice?.jail ?? []) if (x.citizenId !== undefined) detained.add(x.citizenId);
  for (const c of state.citizens) {
    if (c.homeId === null && !(c.evictedUntil !== undefined && c.evictedUntil > state.tick)) {
      const h = state.buildings.find((b) => homeCapacity(b) > (homeUse.get(b.id) ?? 0));
      if (h) {
        c.homeId = h.id;
        homeUse.set(h.id, (homeUse.get(h.id) ?? 0) + 1);
      }
    }
    if (c.jobId === null && !detained.has(c.id)) {
      // Prefiere el empleo más cercano a casa.
      const home = state.buildings.find((b) => b.id === c.homeId);
      let best: Building | undefined;
      for (const b of state.buildings) {
        if (jobCapacity(b) <= (jobUse.get(b.id) ?? 0)) continue;
        if (!best || (home && dist(b, home) < dist(best, home))) best = b;
      }
      if (best) {
        c.jobId = best.id;
        jobUse.set(best.id, (jobUse.get(best.id) ?? 0) + 1);
      }
    }
  }
}

function arrivals(state: GameState): void {
  const free = freeHomes(state);
  if (free === 0 || state.demand.R <= 0) return;
  const n = Math.min(free, chance(state.rng, state.demand.R / 100) ? (state.demand.R > 60 ? 2 : 1) : 0);
  for (let k = 0; k < n; k++) {
    const c = newResident(state, { age: nextInt(state.rng, 19, 72) });
    state.citizens.push(c);
    transfer(state, OUTSIDE, c.id, nextInt(state.rng, 600, 2_500));
    pushEvent(state, 'arrival', `${c.name} se muda al pueblo`, { ref: c.id });
    if (c.named) onNamedArrival(state, c);
  }
}

/** Vecino nuevo (llega de fuera o se independiza de su familia, v1.5). No lo añade al pueblo. */
export function newResident(state: GameState, opts: { age: number; surname?: string }): Citizen {
  {
    // 2.0: en Modo IA, el % de vecinos con IA decide quién tiene nombre (y piensa con IA).
    const namedCount = state.citizens.filter((x) => x.named).length;
    const named = state.aiMode && state.ai ? namedCount < TURN.maxNamed && aiByShare(state, state.nextId) : namedCount < state.namedLimit;
    let name = uniqueName(state);
    // Con el apellido de la familia, que no se repita el nombre completo (ronda 11).
    if (opts.surname) {
      const used = new Set(state.citizens.map((x) => x.name));
      for (let i = 0; i < 20 && (i === 0 || used.has(name)); i++) name = `${uniqueName(state).split(' ')[0]} ${opts.surname}`;
      if (used.has(name)) name = `${name} ${state.nextId}`;
    }
    const c: Citizen = {
      id: state.nextId++,
      name,
      age: opts.age,
      money: 0,
      homeId: null,
      jobId: null,
      happiness: 55,
      arrivedMonth: Math.floor(state.tick / TICKS_PER_MONTH),
      named,
      traits: named ? randomTraits(state.rng) : { terco: 50, ahorro: 50, social: 50, ambicion: 50 },
      desire: named ? pick(state.rng, DESIRES) : 'prosperar',
      fear: named ? pick(state.rng, FEARS) : 'paro',
      cooldownUntil: 0,
      ...NO_PROPERTY,
      profession: named ? pick(state.rng, PROFESSIONS) : '',
      goal: 'ahorrar',
      relations: [],
      memories: [],
      summary: '',
    };
    if (named) {
      c.goal = goalFor(c.desire);
      c.memories.push({ tick: state.tick, kind: 'llego', about: [], importance: 2, valence: 1 });
    }
    return c;
  }
}

/** Un vecino se va del pueblo por su propio pie (vende lo que tenga). */
export function leaveVoluntarily(state: GameState, c: Citizen): void {
  if (!state.citizens.includes(c) || state.citizens.length <= 1) return;
  sellOnDeparture(state, c);
  onCitizenLeaves(state, c);
  transfer(state, c.id, OUTSIDE, c.money);
  state.citizens = state.citizens.filter((x) => x !== c);
}

function departures(state: GameState): void {
  for (const c of [...state.citizens]) {
    if (state.citizens.length <= 1) break;
    // Los vecinos con nombre deciden irse ellos mismos (detonante «infeliz»).
    if (c.named) continue;
    const unhappy = c.happiness < 35 && chance(state.rng, 0.04);
    const broke = c.money === 0 && c.homeId === null && chance(state.rng, 0.1);
    // v1.9: ahogado por las deudas.
    const drowned = !unhappy && !broke && drownedInDebt(state, c) && chance(state.rng, DEBT.leaveChance);
    if (unhappy || broke || drowned) {
      sellOnDeparture(state, c);
      onCitizenLeaves(state, c);
      transfer(state, c.id, OUTSIDE, c.money);
      state.citizens = state.citizens.filter((x) => x !== c);
      const why = broke ? 'sin casa ni dinero' : drowned ? 'no puede con las deudas' : 'descontento';
      pushEvent(state, 'departure', `${c.name} se va del pueblo (${why})`);
    }
  }
}

/* ---------- día y mes ---------- */

function endOfDay(state: GameState): void {
  weatherDay(state);
  progressProjects(state);
  const served = updateNetworks(state);
  // v1.8: días seguidos sin agua o sin luz (el icono sobre la casa sale cuando dura).
  for (const b of state.buildings) {
    if (!b.built || b.kind === 'water' || b.kind === 'power') continue;
    b.dryDays = b.hasWater ? 0 : (b.dryDays ?? 0) + 1;
    b.darkDays = b.hasPower ? 0 : (b.darkDays ?? 0) + 1;
  }
  // v1.8: reparaciones de lo que rompieron los disturbios.
  for (const b of state.buildings) {
    if (b.damaged && b.damaged.repairUntil >= 0 && b.damaged.repairUntil <= state.tick) {
      delete b.damaged;
      pushEvent(state, 'info', `Reabre ${b.name ?? BUILD_NAMES[b.kind]?.toLowerCase()} tras la reparación`, { ref: b.id });
    }
  }
  // 2.1: el camión recoge y se amontona lo que no (antes de los campos: la suciedad sale de ahí).
  trashDay(state);
  updateFields(state);
  assignHomesAndJobs(state);
  // Inercia: la felicidad baja más rápido de lo que sube.
  for (const c of state.citizens) {
    const t = targetHappiness(state, c);
    c.happiness += (t - c.happiness) * (t < c.happiness ? 0.12 : 0.06);
  }
  state.demand = computeDemand(state);
  growZones(state, served);
  arrivals(state);
  departures(state);
  maybeSplitTaxes(state);
  updateGrudges(state);
  detectTriggers(state);
  socialDay(state);
  politicsDay(state);
  civicDay(state);
  // 1 de enero: cumpleaños, hijos que se independizan y fallecimientos (v1.5).
  const d = tickToDate(state.tick);
  if (d.month === 1 && d.day === 1 && state.tick > 0) lifeYear(state);
  lifeDay(state);
  associationsDay(state);
  crimeDay(state);
  // 2.1: riesgos e incendios.
  fireDay(state);
  // 2.0: planes y ultimátums de los vecinos que vencen.
  plansDay(state, (c) => leaveVoluntarily(state, c));
  // v1.9.1: peticiones de aplazamiento sin respuesta.
  unansweredDeferrals(state);
  // v1.8: mejoras de servicios terminadas.
  for (const b of finishUpgrades(state)) {
    pushEvent(state, 'built', `${b.name ?? BUILD_NAMES[b.kind] ?? b.kind} sube a nivel ${b.level}: llega más lejos y atiende a más gente`, { ref: b.id });
  }
  // 2.1: de aldea a ciudad (antes del álbum: la subida sale en la foto del día).
  rankDay(state);
  albumDay(state);
  // 2.1: encargos del pueblo y El Eco de Bitópolis.
  errandsDay(state);
  pressDay(state);
  accumulateRates(state);
}

/**
 * v1.9: las empresas pagan nóminas (con el sueldo mínimo que fije el ayuntamiento)
 * e impuestos con la caja del mes anterior, y apuntan sus cuentas para la «salud de
 * las empresas». Va antes que el gasto de los vecinos: todos los sueldos, primero.
 */
function businessPayroll(state: GameState, r: ReturnType<typeof monthRates>): void {
  const wage = MIN_WAGE[state.minWage ?? 'none'];
  for (const b of state.buildings) {
    if (!isBusiness(b) || !b.built) continue;
    const workers = state.citizens.filter((c) => c.jobId === b.id);
    if (b.kind === 'factory' && !b.damaged) {
      // Ronda 15: las fábricas repercuten la mitad de la subida del sueldo en sus precios.
      const rev = workers.length * (FACTORY_REVENUE_PER_WORKER + Math.round(0.5 * (wage - MIN_WAGE.none)));
      transfer(state, OUTSIDE, b.id, rev);
      b.sales = (b.sales ?? 0) + rev;
    }
    let paidAll = true;
    let wages = 0;
    for (const c of workers) {
      const p = transfer(state, b.id, c.id, wage);
      wages += p;
      if (p < wage) paidAll = false;
    }
    const before = b.cash;
    businessTaxes(state, b, r);
    b.books = { sales: b.sales ?? 0, wages, taxes: before - b.cash };
    b.sales = 0;
    // Ronda 15: si pierde dinero, despide a alguien en vez de ir a la quiebra; si va bien, vuelve a contratar.
    const profit = b.books.sales - b.books.wages - b.books.taxes;
    if (profit < 0 && workers.length > 1 && b.books.sales > 0) {
      const out = workers[workers.length - 1]!;
      out.jobId = null;
      addMemory(state, out, 'perdio_trabajo', 4, -4);
      b.staff = workers.length - 1;
      state.month.layoffs = (state.month.layoffs ?? 0) + 1;
    } else if (profit > wage && (b.staff ?? Infinity) < jobsOf(b)) b.staff = (b.staff ?? 0) + 1;
    b.unpaidMonths = paidAll ? 0 : b.unpaidMonths + 1;
  }
}

/** Tras el gasto del mes: dividendos y cierres de las empresas que no pagan. */
function payBusinesses(state: GameState): void {
  for (const b of state.buildings) if (isBusiness(b) && b.built) payDividends(state, b);
  for (const b of [...state.buildings]) {
    if (isBusiness(b) && b.unpaidMonths >= 2) {
      const wage = MIN_WAGE_STEP[state.minWage ?? 'none'] > 0 ? ` (sueldo mínimo ${MIN_WAGE[state.minWage]} €)` : '';
      pushEvent(state, 'business', `Cierra ${b.name ?? BUILD_NAMES[b.kind]?.toLowerCase()}: no puede pagar las nóminas${wage}`, { ref: b.id });
      // Ronda 15: el dueño lo sufre y se acuerda del ayuntamiento; tarda en volver a intentarlo.
      const owner = state.citizens.find((c) => c.id === b.owner);
      if (owner) {
        addMemory(state, owner, 'cerro_negocio', 5, -6);
        owner.closedUntil = state.tick + 6 * TICKS_PER_MONTH;
        if (wage) owner.grudge = Math.min(40, owner.grudge + 10);
      }
      state.month.closures = (state.month.closures ?? 0) + 1;
      removeBuilding(state, b.id);
    }
  }
}

function endOfMonth(state: GameState): void {
  associationsMonth(state);
  const r = monthRates(state);
  // Nóminas municipales (los sueldos no pagan impuesto municipal).
  for (const c of state.citizens) {
    const job = c.jobId !== null ? state.buildings.find((b) => b.id === c.jobId) : undefined;
    if (job && !isBusiness(job)) transfer(state, TREASURY, c.id, Math.round((SERVICE[job.kind] ? SERVICE_SALARY : PUBLIC_SALARY) * budgetFx(state).salaries), 'sueldos');
  }
  // v1.9: todos los sueldos primero; luego cada vecino paga lo básico, la vivienda y los
  // tributos (lo que no pueda, como deuda), devuelve deudas y, si le sobra, ocio.
  businessPayroll(state, r);
  outsideJobsMonth(state);
  // Las tiendas destrozadas en disturbios no venden hasta que se reparan (v1.8).
  const shops = state.buildings.filter((b) => b.kind === 'shop' && b.built && !b.damaged);
  basicLiving(state, shops);
  monthlyHousing(state, r);
  settleMonth(state, shops);
  housingTroubles(state);
  payBusinesses(state);
  // PIE: el Estado paga por vecino empadronado, más si el pueblo está contento.
  const pie = Math.round(PIE_PER_CITIZEN * state.citizens.length * Math.max(0.6, Math.min(1.2, averageHappiness(state) / 60)));
  transfer(state, OUTSIDE, TREASURY, pie, 'PIE');
  // El ayuntamiento cuesta más de mantener cuanto más grande (v1.8).
  for (const b of state.buildings) if (b.built) transfer(state, TREASURY, OUTSIDE, Math.round(maintenanceOf(b) * (b.kind === 'townhall' ? townLevel(state) : 1) * budgetFx(state).maintenance), 'mantenimiento');
  lifeMonth(state);
  // 2.1: voluntarios de protección civil (por reglas).
  volunteersMonth(state);
  if (state.treasury < 0) {
    const debt = -state.treasury;
    const interest = Math.min(debt, DEBT_INTEREST_STEP) * DEBT_INTEREST + Math.max(0, debt - DEBT_INTEREST_STEP) * DEBT_INTEREST_HIGH;
    // Tope: los intereses no pasan de una parte de lo ingresado en el mes (si no, la deuda no se paga nunca).
    const cap = Math.max(100, state.month.income * DEBT_INTEREST_CAP);
    transfer(state, TREASURY, OUTSIDE, Math.ceil(Math.min(interest, cap)), 'intereses');
  }
  monthlyMarket(state);

  if (state.treasury < -DEBT_LIMIT) state.debtMonths++;
  else state.debtMonths = 0;
  if (state.debtMonths >= 3 && !state.bankrupt) {
    state.bankrupt = true;
    pushEvent(state, 'bankrupt', 'El ayuntamiento está en quiebra: no se pueden empezar obras hasta sanear la caja');
  }
  if (state.bankrupt && state.treasury >= 0) {
    state.bankrupt = false;
    pushEvent(state, 'info', 'La caja vuelve a estar sana');
  }
  const net = state.month.income - state.month.expenses;
  if (net < 0 && state.treasury > 0 && state.treasury / -net < 3) {
    const months = Math.max(1, Math.floor(state.treasury / -net));
    pushEvent(state, 'warning', `A este ritmo, la caja aguanta ${months} ${months === 1 ? 'mes' : 'meses'}`);
  }
  state.stats.push({
    month: Math.floor(state.tick / TICKS_PER_MONTH),
    population: state.citizens.length,
    treasury: state.treasury,
    happiness: Math.round(averageHappiness(state)),
    income: state.month.income,
    expenses: state.month.expenses,
    breakdown: state.month.breakdown,
    ...economyStats(state),
  });
  if (state.stats.length > 120) state.stats.splice(0, state.stats.length - 120);
  state.month = { income: 0, expenses: 0, breakdown: {}, rateSums: { ibi: 0, tasas: 0, plusvalia: 0 }, taxDays: 0 };
}

/** Avanza una hora de juego. */
export function step(state: GameState): void {
  state.tick++;
  if (state.pending.length > 0) resolveDuePending(state);
  if (state.tick % TICKS_PER_DAY === 0) endOfDay(state);
  if (state.tick % TICKS_PER_MONTH === 0) endOfMonth(state);
  // 2.1: el fuego va por horas.
  fireTick(state);
  // 2.0: turnos del pueblo con IA (abrir, y si vencen sin respuesta, reglas).
  turnsTick(state, ruleTurn);
}

/** Aplica los comandos de este tick y avanza. */
export function stepWithCommands(state: GameState, commands: readonly unknown[]): void {
  for (const cmd of commands) applyCommand(state, cmd);
  step(state);
}

