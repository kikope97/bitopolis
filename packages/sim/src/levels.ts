import { TICKS_PER_DAY } from '@bitopolis/shared';
import { BUILD, CRIME, JOBS, MAINTENANCE, PLANT_CAPACITY, SERVICE, SERVICE_CAPACITY, SERVICE_LEVELS as L, TRASH } from './balance.ts';
import { truckRoutes } from './trash-core.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import type { Building, BuildingKind, GameState } from './state.ts';

/**
 * v1.8 (petición del creador): niveles de los servicios. Un nivel más da más
 * radio, más capacidad (vecinos, casas con agua o luz, calabozos, plazas de
 * cárcel), algo más de felicidad y un empleo más; cuesta más mantenerlo.
 */
export const UPGRADABLE: BuildingKind[] = ['water', 'power', 'school', 'clinic', 'police', 'jail', 'park', 'library', 'sports', 'firestation', 'cleanpoint'];

export const levelOf = (b: Building): number => b.level ?? 1;
const mult = (b: Building) => L.capacity[levelOf(b) - 1] ?? 1;

export function radiusOf(b: Building): number {
  const base = SERVICE[b.kind]?.radius ?? 0;
  return base ? base + L.radiusPlus * (levelOf(b) - 1) : 0;
}
export function serviceHappiness(b: Building): number {
  const base = SERVICE[b.kind]?.happiness ?? 0;
  return base ? base + L.happinessPlus * (levelOf(b) - 1) : 0;
}
export function serviceCapacityOf(b: Building): number {
  return Math.round((SERVICE_CAPACITY[b.kind] ?? 0) * mult(b));
}
export function plantCapacityOf(b: Building): number {
  return b.kind === 'water' || b.kind === 'power' ? Math.round(PLANT_CAPACITY[b.kind] * mult(b)) : 0;
}
export function cellsOf(b: Building): number {
  return Math.round(CRIME.cellsPerStation * mult(b));
}
export function jailPlacesOf(b: Building): number {
  return Math.round(CRIME.jailCapacity * mult(b));
}
/** 2.1: casillas de carretera que recorre al día el camión de un punto limpio. */
export function truckRouteOf(b: Building): number {
  return b.kind === 'cleanpoint' ? Math.round(TRASH.route * mult(b)) : 0;
}
export function jobsOf(b: Building): number {
  const base = JOBS[b.kind];
  return base >= 2 ? base + L.jobsPlus * (levelOf(b) - 1) : base;
}
export function maintenanceOf(b: Building): number {
  return MAINTENANCE[b.kind] * (L.maintenance[levelOf(b) - 1] ?? 1);
}

/** Lo que cuesta subir al siguiente nivel. */
export function upgradeCost(b: Building): number {
  const next = levelOf(b) + 1;
  return Math.round(BUILD[b.kind as keyof typeof BUILD].materials * (L.cost[next] ?? 0));
}

/** Cuánto se usa (0–1+): vecinos atendidos, casas abastecidas, presos o vecinos en su radio frente a lo que da ahora. */
export function usageOf(state: GameState, b: Building, served?: number): { used: number; of: number } {
  const dist = (p: { x: number; y: number }) => Math.abs(p.x - b.x) + Math.abs(p.y - b.y);
  if (b.kind === 'water' || b.kind === 'power') {
    // En la red, entre todas las plantas del mismo tipo.
    const plants = state.buildings.filter((p) => p.kind === b.kind && p.built);
    const cap = plants.reduce((a, p) => a + plantCapacityOf(p), 0);
    const flag = b.kind === 'water' ? 'hasWater' : 'hasPower';
    const used = state.buildings.filter((x) => x.built && x.kind !== 'water' && x.kind !== 'power' && x[flag]).length;
    return { used, of: cap };
  }
  if (b.kind === 'jail') {
    const cap = state.buildings.filter((p) => p.kind === 'jail' && p.built).reduce((a, p) => a + jailPlacesOf(p), 0);
    return { used: state.justice?.jail.length ?? 0, of: cap };
  }
  if (b.kind === 'cleanpoint') {
    // 2.1: calles que recorre el camión frente a las que podría recorrer.
    const r = truckRoutes(state).find((x) => x.id === b.id);
    return { used: r?.roads.length ?? 0, of: truckRouteOf(b) };
  }
  if (SERVICE_CAPACITY[b.kind]) return { used: served ?? 0, of: serviceCapacityOf(b) };
  // Parques, biblioteca, polideportivo: vecinos que viven en su radio.
  const r = radiusOf(b);
  const homes = new Set(state.buildings.filter((x) => (x.kind === 'house' || x.kind === 'res') && dist(x) <= r).map((x) => x.id));
  return { used: state.citizens.filter((c) => c.homeId !== null && homes.has(c.homeId)).length, of: L.residents[levelOf(b) + 1] ?? 0 };
}

export interface UpgradeReq {
  label: string;
  ok: boolean;
}

/** Requisitos para subir de nivel, uno a uno (para la ficha). `served`: vecinos atendidos si es colegio, salud o policía. */
export function upgradeReqs(state: GameState, b: Building, served?: number): UpgradeReq[] {
  const next = levelOf(b) + 1;
  const reqs: UpgradeReq[] = [];
  const th = L.townhall[next] ?? 99;
  reqs.push({ label: `Ayuntamiento de nivel ${th}`, ok: (state.townhallLevel ?? 1) >= th });
  const pop = L.pop[next] ?? 0;
  reqs.push({ label: `${pop} vecinos en el pueblo`, ok: state.citizens.length >= pop });
  const u = usageOf(state, b, served);
  const residentsKind = !SERVICE_CAPACITY[b.kind] && b.kind !== 'water' && b.kind !== 'power' && b.kind !== 'jail' && b.kind !== 'cleanpoint';
  if (residentsKind) reqs.push({ label: `${u.of} vecinos viviendo cerca (hay ${u.used})`, ok: u.used >= u.of });
  else {
    const need = Math.ceil(u.of * L.usage);
    const what =
      b.kind === 'water' || b.kind === 'power' ? 'edificios conectados' : b.kind === 'jail' ? 'presos' : b.kind === 'cleanpoint' ? 'casillas de calle que recorre el camión' : 'vecinos atendidos';
    reqs.push({ label: `Que se use: ${need} ${what} (hay ${u.used})`, ok: u.used >= need });
  }
  const cost = upgradeCost(b);
  reqs.push({ label: `${cost} € en la caja`, ok: state.treasury >= cost });
  return reqs;
}

export function canUpgradeBuilding(state: GameState, b: Building | undefined, served?: number): { ok: true } | { ok: false; error: string } {
  if (!b || !UPGRADABLE.includes(b.kind)) return { ok: false, error: 'Este edificio no se puede mejorar' };
  if (!b.built) return { ok: false, error: 'Aún está en obras' };
  if (levelOf(b) >= L.maxLevel) return { ok: false, error: 'Ya está en su nivel más alto' };
  if (b.upgradeUntil !== undefined) return { ok: false, error: 'Ya se está mejorando' };
  if (b.damaged) return { ok: false, error: 'Primero hay que repararlo' };
  const miss = upgradeReqs(state, b, served).find((r) => !r.ok);
  return miss ? { ok: false, error: `Falta: ${miss.label}` } : { ok: true };
}

/** Empieza la obra de mejora (el servicio sigue abierto mientras tanto). */
export function startUpgrade(state: GameState, b: Building): void {
  const next = levelOf(b) + 1;
  transfer(state, TREASURY, OUTSIDE, upgradeCost(b), 'obras');
  b.upgradeUntil = state.tick + (L.days[next] ?? 4) * TICKS_PER_DAY;
}

/** Termina las mejoras que tocan. Devuelve los edificios que han subido. */
export function finishUpgrades(state: GameState): Building[] {
  const done: Building[] = [];
  for (const b of state.buildings) {
    if (b.upgradeUntil === undefined || b.upgradeUntil > state.tick) continue;
    b.level = levelOf(b) + 1;
    delete b.upgradeUntil;
    done.push(b);
  }
  return done;
}
