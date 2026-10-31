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
  school: { materials: 5_000, workers: 5, days: 4, unlockPop: 25 },
  clinic: { materials: 5_000, workers: 5, days: 4, unlockPop: 25 },
  police: { materials: 4_000, workers: 4, days: 3, unlockPop: 20 },
  /** Hitos: se desbloquean con objetivos (no por población). */
  plaza: { materials: 3_000, workers: 5, days: 3, unlockPop: 50 },
  market: { materials: 6_000, workers: 6, days: 4, unlockPop: 200 },
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
  police: 3,
  plaza: 0,
  market: 4,
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
  police: 350,
  plaza: 80,
  market: 250,
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
  police: { radius: 10, happiness: 3 },
  plaza: { radius: 6, happiness: 8 },
  market: { radius: 8, happiness: 6 },
};

/**
 * Vecinos que atiende cada servicio (v1.3, aplazado de la ronda 07). Con más
 * población el servicio se satura: su efecto baja en proporción y los vecinos
 * piden otro.
 */
export const SERVICE_CAPACITY: Partial<Record<BuildingKind, number>> = { school: 60, clinic: 80, police: 120 };

/** Edificios a los que llega cada planta por la red. */
// Ronda 06: con 30/40 los pueblos medianos acumulaban plantas (y sus sueldos) hasta quebrar.
export const PLANT_CAPACITY = { water: 45, power: 60 } as const;

export const PUBLIC_SALARY = 900;
/** Empleos de servicios (colegio, salud, parque). */
export const SERVICE_SALARY = 700;
export const PRIVATE_SALARY = 900;
/** Lo que gana al día quien trabaja fuera del pueblo. */
export const COMMUTER_DAILY = 22;
export const LIVING_COST = 450;
/** Parte del gasto que va a tiendas del pueblo si las hay. */
export const LOCAL_SPEND_SHARE = 0.45;
export const FACTORY_REVENUE_PER_WORKER = 1_250;
export const MUNICIPAL_RENT = 180;
export const PRIVATE_RENT = 280;
/** Base del impuesto sobre inmuebles privados (al mes). */
export const PROPERTY_BASE = 500;
// Ronda 07: con 40, a 8 años las cajas pasaban de 600.000 € con impuestos bajos.
export const PIE_PER_CITIZEN = 30;
/** Impuesto único: tipo sobre sueldos, ventas e inmuebles. */
export const TAX_RATE = { low: 0.04, medium: 0.07, high: 0.1 } as const;
export const TAX_HAPPINESS = { low: 6, medium: 0, high: -10 } as const;
export const BUSINESS_SEED_CASH = 3_500;
export const BUSINESS_CASH_CAP = 6_000;
export const DEBT_LIMIT = 6_000;

/* ---------------- elecciones (v1.0) ---------------- */
/** Elecciones cada 4 años de juego. */
export const ELECTION_MONTHS = 48;
/** Facciones y oposición desde 50 vecinos (ronda 06: a 200 casi nadie llegaba en 4 años). */
export const OPPOSITION_POP = 50;
/** Con la intención de voto por debajo, un vecino influyente funda un partido. */
export const OPPOSITION_APPROVAL = 90;
/** Avisos de popularidad: meses antes de las elecciones. */
export const POLL_WARN_MONTHS = [12, 6, 3, 1];
/** Abstención mínima (los indecisos se abstienen más). */
export const VOTE_ABSTENTION_BASE = 0.18;
/** Campaña: una al mes en los últimos 12 meses; cada una mueve el voto de la facción. */
export const CAMPAIGN_MONTHS = 12;
export const CAMPAIGN_EFFECT = 0.03;
/** En la oposición la campaña pesa el doble, y mociones rechazadas y promesas rotas suben hasta 6 (ronda 07). */
export const CAMPAIGN_EFFECT_OPP = 0.06;
export const CAMPAIGN_MAX = 6;
/** Gobernando, cada acto de campaña cuesta (como un pleno); en la oposición es gratis y vale todo el mandato. */
export const CAMPAIGN_COST = 300;
/** Las bajadas de impuestos se notan despacio (días); las subidas, al momento. */
export const TAX_RELIEF_DAYS = 90;
/** Plazo del rival para cumplir lo prometido si gana (meses tras las elecciones). */
export const RIVAL_PROMISE_MONTHS = 12;
/** Plazo para cumplir una moción aprobada (meses). */
export const MOTION_MONTHS = 6;
/** Apoyo extra al gobierno recién elegido (se apaga en 12 meses). */
export const HONEYMOON = 0.25;
/** Interés mensual de la deuda: 1 % hasta 5.000 € y 3 % por encima. */
export const DEBT_INTEREST = 0.01;
export const DEBT_INTEREST_HIGH = 0.03;
export const DEBT_INTEREST_STEP = 5_000;
/** Los intereses de un mes no superan esta parte de lo ingresado ese mes (ronda 07). */
export const DEBT_INTEREST_CAP = 0.25;

/* ---------------- v0.3: tributos y vivienda ---------------- */

/** Con esta población el impuesto único se separa en IBI, tasas y plusvalía. */
export const TAX_SPLIT_POP = 50;
/** IBI anual sobre el valor del inmueble (escala del juego). */
export const IBI_RATE = { low: 0.05, medium: 0.07, high: 0.1 } as const;
/** Tasa de basuras por hogar y mes, y de terrazas por comercio y mes. */
export const TASA_BASURAS = { low: 10, medium: 15, high: 24 } as const;
export const TASA_TERRAZAS = { low: 40, medium: 60, high: 95 } as const;
/** Plusvalía municipal sobre la ganancia de una compraventa. */
export const PLUSVALIA_RATE = { low: 0.1, medium: 0.2, high: 0.3 } as const;
/** Efecto en la felicidad por grupo afectado. */
export const TASAS_MOOD = { low: 3, medium: 0, high: -4 } as const;
export const IBI_MOOD_OWNER = { low: 4, medium: 0, high: -8 } as const;
export const IBI_MOOD_RENTER = { low: 1, medium: 0, high: -2 } as const;
export const PLUSVALIA_MOOD_OWNER = { low: 1, medium: 0, high: -3 } as const;
/** Memoria fiscal: lo que suma una subida (por grupo) y su olvido diario. */
export const GRUDGE_RAISE = { all: 6, ibi: 8, tasas: 5, plusvalia: 3 } as const;
export const GRUDGE_DECAY = 0.997;
export const GRUDGE_MAX = 40;

/** Valor base de una vivienda, local o nave (antes de barrio y demanda). */
export const PROPERTY_VALUE: Partial<Record<BuildingKind, number>> = { house: 7_000, res: 9_000, shop: 20_000, factory: 30_000 };
/** Entrada mínima para comprar (resto con hipoteca) y cuota mensual. */
export const DOWN_PAYMENT = 0.2;
export const MORTGAGE_MONTHS = 120;
/** Interés mensual sobre lo que queda de hipoteca (≈5 % anual). */
export const MORTGAGE_INTEREST = 0.004;
/** Vivienda municipal: precio máximo y coste de transacción para el comprador. */
export const MUNICIPAL_PRICE_CAP = 7_500;
export const TRANSACTION_COST = 0.04;
export const RESALE_LOCK_TICKS = 24 * 90;
/** Probabilidad mensual de que un inquilino estadístico que puede, compre. */
export const BUY_CHANCE = 0.08;

/** Empresas de vecinos: capital que pone el fundador (obra + caja inicial). */
export const FOUND_COST = 2_000;
export const FOUND_SEED = 2_500;
export const FOUND_MIN_MONEY = 3_000;
export const FOUND_CHANCE = 0.35;
export const SHOP_TYPES = ['panaderia', 'fruteria', 'bar', 'ropa', 'ferreteria', 'peluqueria'] as const;
export const SHOP_NAMES: Record<string, string> = {
  panaderia: 'Panadería',
  fruteria: 'Frutería',
  bar: 'Bar',
  ropa: 'Tienda de ropa',
  ferreteria: 'Ferretería',
  peluqueria: 'Peluquería',
};

/* ---------------- v1.5: ciclo vital, presupuesto, fiestas y subvenciones ---------------- */

/** Ciclo vital. Los ancianos pueden fallecer (probabilidad anual). */
export const DEATH_START_AGE = 70;
export const DEATH_RATE_PER_YEAR_OVER = 0.02;
export const DEATH_RATE_MAX = 0.45;
/** Parejas que viven juntas: probabilidad mensual de un bebé (si la persona más joven tiene 20–42). */
export const BIRTH_CHANCE_COUPLE = 0.03;
/** Vecinos sin nombre de 20–42 años: probabilidad mensual por persona. */
export const BIRTH_CHANCE_ADULT = 0.002;
export const KIDS_MAX = 3;
export const ADULT_AGE = 18;

/** Presupuesto anual: efecto de cada plan. */
export const BUDGET = {
  austero: { maintenance: 0.85, salaries: 0.9, materials: 1, services: 0.9 },
  equilibrado: { maintenance: 1, salaries: 1, materials: 1, services: 1 },
  inversor: { maintenance: 1.1, salaries: 1, materials: 0.85, services: 1 },
} as const;

/** Fiestas: coste, felicidad (puntos) y días que dura el buen recuerdo. */
export const FESTIVAL = {
  pequena: { cost: 1_500, mood: 4, days: 30, spend: 8 },
  grande: { cost: 5_000, mood: 8, days: 45, spend: 20 },
  popular: { cost: 0, mood: 2, days: 20, spend: 3 },
} as const;
export const FESTIVAL_MONTH = 8;

/** Subvenciones de la Diputación. */
export const GRANT_EVERY_DAYS = 180;
export const GRANT_OFFER_DAYS = 30;
export const GRANT_DEADLINE_DAYS = 180;
export const GRANT_ADVANCE = 0.3;
export const GRANT_PENALTY = 0.1;
