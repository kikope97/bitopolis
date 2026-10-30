import type { BuildKind } from '@bitopolis/shared';
import type { BuildingKind } from './state.ts';

/** Todos los números de equilibrio en un solo sitio (euros enteros). */

export interface BuildSpec {
  /** Materiales: se pagan al empezar la obra. */
  materials: number;
  workers: number;
  days: number;
  /** Población mínima para desbloquear. */
  unlockPop: number;
}

export const BUILD: Record<BuildKind, BuildSpec> = {
  road: { materials: 40, workers: 0, days: 0, unlockPop: 0 },
  house: { materials: 2_000, workers: 5, days: 3, unlockPop: 0 },
  water: { materials: 3_000, workers: 4, days: 3, unlockPop: 0 },
  power: { materials: 4_000, workers: 4, days: 3, unlockPop: 0 },
  park: { materials: 1_200, workers: 2, days: 2, unlockPop: 10 },
  school: { materials: 5_000, workers: 5, days: 4, unlockPop: 10 },
  clinic: { materials: 5_000, workers: 5, days: 4, unlockPop: 10 },
};

/** Obras que crecen solas sobre zonas (las paga un inversor de fuera). */
export const GROWTH: Record<'res' | 'shop' | 'factory', { workers: number; days: number }> = {
  res: { workers: 4, days: 3 },
  shop: { workers: 3, days: 3 },
  factory: { workers: 5, days: 4 },
};

export const ZONE_COST_PER_TILE = 5;
export const ZONE_UNLOCK_POP = 10;

/** Jornal diario de un obrero local y de uno de fuera (más caro). */
export const WAGE_LOCAL = 60;
export const WAGE_OUTSIDE = 100;

export const JOBS: Record<BuildingKind, number> = {
  townhall: 1,
  water: 1,
  power: 1,
  park: 1,
  school: 3,
  clinic: 3,
  house: 0,
  res: 0,
  shop: 3,
  factory: 5,
};

export const HOMES: Partial<Record<BuildingKind, number>> = { house: 3, res: 4 };

export const MAINTENANCE: Record<BuildingKind, number> = {
  townhall: 100,
  water: 150,
  power: 200,
  park: 100,
  school: 450,
  clinic: 450,
  house: 20,
  res: 0,
  shop: 0,
  factory: 0,
};

/** Radio de cobertura de los servicios (tiles) y su efecto en la felicidad. */
export const SERVICE: Partial<Record<BuildingKind, { radius: number; happiness: number }>> = {
  park: { radius: 5, happiness: 6 },
  school: { radius: 8, happiness: 5 },
  clinic: { radius: 8, happiness: 5 },
};

/** Edificios a los que llega cada planta por la red. */
export const PLANT_CAPACITY = { water: 30, power: 40 } as const;

export const PUBLIC_SALARY = 900;
export const PRIVATE_SALARY = 900;
/** Lo que gana al día quien trabaja fuera del pueblo. */
export const COMMUTER_DAILY = 28;
export const LIVING_COST = 450;
/** Parte del gasto que va a tiendas del pueblo si las hay. */
export const LOCAL_SPEND_SHARE = 0.45;
export const FACTORY_REVENUE_PER_WORKER = 1_250;
export const MUNICIPAL_RENT = 250;
export const PRIVATE_RENT = 280;
/** Base del impuesto sobre inmuebles privados (al mes). */
export const PROPERTY_BASE = 500;
export const PIE_PER_CITIZEN = 40;
/** Impuesto único: tipo sobre sueldos, ventas e inmuebles. */
export const TAX_RATE = { low: 0.04, medium: 0.07, high: 0.1 } as const;
export const TAX_HAPPINESS = { low: 6, medium: 0, high: -14 } as const;
export const BUSINESS_SEED_CASH = 2_500;
export const BUSINESS_CASH_CAP = 6_000;
export const DEBT_LIMIT = 10_000;
export const DEBT_INTEREST = 0.01;
