import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import {
  BUSINESS_CASH_CAP,
  BUSINESS_SEED_CASH,
  COMMUTER_DAILY,
  DEBT_INTEREST,
  DEBT_LIMIT,
  FACTORY_REVENUE_PER_WORKER,
  GROWTH,
  HOMES,
  JOBS,
  LIVING_COST,
  LOCAL_SPEND_SHARE,
  MAINTENANCE,
  MUNICIPAL_RENT,
  PIE_PER_CITIZEN,
  PLANT_CAPACITY,
  PRIVATE_RENT,
  PRIVATE_SALARY,
  PROPERTY_BASE,
  PUBLIC_SALARY,
  SERVICE,
  TAX_HAPPINESS,
  TAX_RATE,
  WAGE_LOCAL,
  WAGE_OUTSIDE,
  ZONE_UNLOCK_POP,
} from './balance.ts';
import { applyCommand, BUILD_NAMES, removeBuilding } from './commands.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { chance, nextInt, pick } from './prng.ts';
import {
  type Building,
  type Citizen,
  DIRS,
  type GameState,
  inBounds,
  newBuilding,
  pushEvent,
  Tile,
  tileIndex,
  Zone,
} from './state.ts';

const FIRST_NAMES = [
  'Ana', 'Pablo', 'Carmen', 'Javier', 'Elena', 'Diego', 'Rosa', 'Marcos', 'Nuria', 'Iker',
  'Marta', 'Andrés', 'Lola', 'Sergio', 'Inés', 'Raúl', 'Pilar', 'Hugo', 'Sara', 'Tomás',
  'Julia', 'Álvaro', 'Irene', 'Mario', 'Alba', 'Rubén', 'Clara', 'Óscar', 'Noelia', 'Adrián',
  'Celia', 'Gonzalo', 'Paula', 'Víctor', 'Lorena', 'Emilio', 'Teresa', 'Jaime', 'Aitana', 'Félix',
];
const SURNAMES = [
  'García', 'López', 'Martín', 'Sánchez', 'Romero', 'Navarro', 'Torres', 'Gil', 'Ruiz', 'Molina',
  'Ortega', 'Delgado', 'Castro', 'Vidal', 'Rubio', 'Serrano', 'Marín', 'Iglesias', 'Pascual', 'Prieto',
];

/* ---------- consultas ---------- */

export function isBusiness(b: Building): boolean {
  return b.kind === 'shop' || b.kind === 'factory';
}

export function homeCapacity(b: Building): number {
  return b.built ? (HOMES[b.kind] ?? 0) : 0;
}

export function jobCapacity(b: Building): number {
  return b.built ? JOBS[b.kind] : 0;
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
      let capacity = PLANT_CAPACITY[kind];
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
  const R = 30 + vacancies(state) * 6 - Math.max(0, free - 6) * 3 + (happy - 55) + TAX_HAPPINESS[state.taxLevel] - (pop >= ZONE_UNLOCK_POP ? jobless * 2 : 0);
  const C = pop < ZONE_UNLOCK_POP ? 0 : (pop / 9 - shops) * 25;
  const I = pop < ZONE_UNLOCK_POP ? 0 : jobless * 6 - factories * 10 + 20;
  return { R: clamp(R), C: clamp(C), I: clamp(I) };
}

/* ---------- felicidad ---------- */

export function happinessFactors(state: GameState, c: Citizen): { label: string; value: number }[] {
  const f: { label: string; value: number }[] = [];
  const home = c.homeId !== null ? state.buildings.find((b) => b.id === c.homeId) : undefined;
  if (!home) f.push({ label: 'Sin casa', value: -20 });
  else {
    f.push({ label: 'Tiene casa', value: 8 });
    f.push(home.hasWater ? { label: 'Agua', value: 8 } : { label: 'Sin agua', value: -12 });
    f.push(home.hasPower ? { label: 'Luz', value: 8 } : { label: 'Sin luz', value: -12 });
    for (const b of state.buildings) {
      const s = SERVICE[b.kind];
      if (s && b.built && dist(b, home) <= s.radius && !f.some((x) => x.label === BUILD_NAMES[b.kind])) {
        f.push({ label: BUILD_NAMES[b.kind]!, value: s.happiness });
      }
      if (b.kind === 'factory' && b.built && dist(b, home) <= 3 && !f.some((x) => x.label === 'Contaminación')) {
        f.push({ label: 'Contaminación', value: -8 });
      }
      if (b.kind === 'shop' && b.built && dist(b, home) <= 6 && !f.some((x) => x.label === 'Tienda cerca')) {
        f.push({ label: 'Tienda cerca', value: 4 });
      }
    }
  }
  f.push(c.jobId !== null ? { label: 'Trabaja en el pueblo', value: 8 } : { label: 'Trabaja fuera', value: -4 });
  const tax = TAX_HAPPINESS[state.taxLevel];
  if (tax !== 0) f.push({ label: tax > 0 ? 'Impuestos bajos' : 'Impuestos altos', value: tax });
  return f;
}

function targetHappiness(state: GameState, c: Citizen): number {
  const t = 50 + happinessFactors(state, c).reduce((s, x) => s + x.value, 0);
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
    p.workerDaysDone += p.workersNeeded;
  }
  for (const p of [...state.projects]) {
    if (p.workerDaysDone < p.workerDaysNeeded) continue;
    const b = state.buildings.find((x) => x.id === p.buildingId);
    state.projects = state.projects.filter((x) => x !== p);
    if (!b) continue;
    b.built = true;
    pushEvent(state, 'built', `Terminada la obra: ${BUILD_NAMES[b.kind]}`, { ref: b.id, notify: p.notify });
  }
  // Quien trabajó hoy en una obra no cobra como commuter.
  for (const c of state.citizens) {
    if (c.jobId === null && !busy.has(c.id)) transfer(state, OUTSIDE, c.id, COMMUTER_DAILY, 'commuter');
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
  for (const [zone, kind, demand] of kinds) {
    if (demand <= 15) continue;
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
  for (const c of state.citizens) {
    if (c.homeId === null) {
      const h = state.buildings.find((b) => homeCapacity(b) > (homeUse.get(b.id) ?? 0));
      if (h) {
        c.homeId = h.id;
        homeUse.set(h.id, (homeUse.get(h.id) ?? 0) + 1);
      }
    }
    if (c.jobId === null) {
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
    const c: Citizen = {
      id: state.nextId++,
      name: uniqueName(state),
      age: nextInt(state.rng, 19, 72),
      money: 0,
      homeId: null,
      jobId: null,
      happiness: 55,
      arrivedMonth: Math.floor(state.tick / TICKS_PER_MONTH),
    };
    state.citizens.push(c);
    transfer(state, OUTSIDE, c.id, nextInt(state.rng, 600, 2_500));
    pushEvent(state, 'arrival', `${c.name} se muda al pueblo`, { ref: c.id });
  }
}

function departures(state: GameState): void {
  for (const c of [...state.citizens]) {
    if (state.citizens.length <= 1) break;
    const unhappy = c.happiness < 30 && chance(state.rng, 0.04);
    const broke = c.money === 0 && c.homeId === null && chance(state.rng, 0.1);
    if (unhappy || broke) {
      transfer(state, c.id, OUTSIDE, c.money);
      state.citizens = state.citizens.filter((x) => x !== c);
      const why = broke ? 'sin casa ni dinero' : 'descontento';
      pushEvent(state, 'departure', `${c.name} se va del pueblo (${why})`);
    }
  }
}

/* ---------- día y mes ---------- */

function endOfDay(state: GameState): void {
  progressProjects(state);
  const served = updateNetworks(state);
  assignHomesAndJobs(state);
  for (const c of state.citizens) c.happiness += (targetHappiness(state, c) - c.happiness) * 0.08;
  state.demand = computeDemand(state);
  growZones(state, served);
  arrivals(state);
  departures(state);
  state.month.taxRateSum += TAX_RATE[state.taxLevel];
  state.month.taxDays += 1;
}

function payBusinesses(state: GameState, rate: number): void {
  const shops = state.buildings.filter((b) => b.kind === 'shop' && b.built);
  // Gasto de los vecinos: una parte a tiendas del pueblo, el resto fuera.
  for (const c of state.citizens) {
    const spend = Math.min(c.money, LIVING_COST);
    const local = shops.length > 0 ? Math.floor(spend * LOCAL_SPEND_SHARE) : 0;
    if (local > 0) {
      const shop = shops[c.id % shops.length]!;
      transfer(state, c.id, shop.id, local);
      transfer(state, shop.id, TREASURY, Math.round(local * rate * 0.5), 'impuestos');
    }
    transfer(state, c.id, OUTSIDE, spend - local);
  }
  for (const b of state.buildings) {
    if (!isBusiness(b) || !b.built) continue;
    const workers = state.citizens.filter((c) => c.jobId === b.id);
    if (b.kind === 'factory') {
      const revenue = workers.length * FACTORY_REVENUE_PER_WORKER;
      transfer(state, OUTSIDE, b.id, revenue);
      transfer(state, b.id, TREASURY, Math.round(revenue * rate * 0.5), 'impuestos');
    }
    let paidAll = true;
    for (const c of workers) {
      const paid = transfer(state, b.id, c.id, PRIVATE_SALARY);
      if (paid < PRIVATE_SALARY) paidAll = false;
      transfer(state, c.id, TREASURY, Math.round(paid * rate), 'impuestos');
    }
    b.unpaidMonths = paidAll ? 0 : b.unpaidMonths + 1;
    // Beneficios por encima del colchón: dividendos al inversor de fuera.
    if (b.cash > BUSINESS_CASH_CAP) transfer(state, b.id, OUTSIDE, b.cash - BUSINESS_CASH_CAP);
    // Impuesto sobre el inmueble (lo paga el propietario de fuera).
    transfer(state, OUTSIDE, TREASURY, Math.round(PROPERTY_BASE * rate), 'impuestos');
  }
  for (const b of [...state.buildings]) {
    if (isBusiness(b) && b.unpaidMonths >= 2) {
      pushEvent(state, 'business', `Cierra ${BUILD_NAMES[b.kind]?.toLowerCase()}: no puede pagar las nóminas`, { ref: b.id });
      removeBuilding(state, b.id);
    }
  }
}

function endOfMonth(state: GameState): void {
  const rate = state.month.taxDays > 0 ? state.month.taxRateSum / state.month.taxDays : TAX_RATE[state.taxLevel];
  // Nóminas municipales.
  for (const c of state.citizens) {
    const job = c.jobId !== null ? state.buildings.find((b) => b.id === c.jobId) : undefined;
    if (job && !isBusiness(job)) {
      transfer(state, TREASURY, c.id, PUBLIC_SALARY, 'sueldos');
      transfer(state, c.id, TREASURY, Math.round(PUBLIC_SALARY * rate), 'impuestos');
    }
  }
  // Alquileres.
  for (const c of state.citizens) {
    const home = c.homeId !== null ? state.buildings.find((b) => b.id === c.homeId) : undefined;
    if (!home) continue;
    if (home.kind === 'house') transfer(state, c.id, TREASURY, MUNICIPAL_RENT, 'alquileres');
    else transfer(state, c.id, OUTSIDE, PRIVATE_RENT);
  }
  payBusinesses(state, rate);
  for (const b of state.buildings) {
    if (b.kind === 'res' && b.built) transfer(state, OUTSIDE, TREASURY, Math.round(PROPERTY_BASE * rate), 'impuestos');
  }
  transfer(state, OUTSIDE, TREASURY, PIE_PER_CITIZEN * state.citizens.length, 'PIE');
  for (const b of state.buildings) if (b.built) transfer(state, TREASURY, OUTSIDE, MAINTENANCE[b.kind], 'mantenimiento');
  if (state.treasury < 0) transfer(state, TREASURY, OUTSIDE, Math.ceil(-state.treasury * DEBT_INTEREST), 'intereses');

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
  });
  if (state.stats.length > 120) state.stats.splice(0, state.stats.length - 120);
  state.month = { income: 0, expenses: 0, breakdown: {}, taxRateSum: 0, taxDays: 0 };
}

/** Avanza una hora de juego. */
export function step(state: GameState): void {
  state.tick++;
  if (state.tick % TICKS_PER_DAY === 0) endOfDay(state);
  if (state.tick % TICKS_PER_MONTH === 0) endOfMonth(state);
}

/** Aplica los comandos de este tick y avanza. */
export function stepWithCommands(state: GameState, commands: readonly unknown[]): void {
  for (const cmd of commands) applyCommand(state, cmd);
  step(state);
}

