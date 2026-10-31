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
  // v1.7: vida social.
  bar: { materials: 1_800, workers: 3, days: 2, unlockPop: 15 },
  chapel: { materials: 2_800, workers: 4, days: 3, unlockPop: 20 },
  cemetery: { materials: 2_200, workers: 3, days: 3, unlockPop: 20 },
  library: { materials: 4_500, workers: 4, days: 4, unlockPop: 35 },
  sports: { materials: 5_500, workers: 5, days: 4, unlockPop: 35 },
  // v1.8: la cárcel (los vecinos no la quieren cerca).
  jail: { materials: 9_000, workers: 6, days: 5, unlockPop: 60 },
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
  bar: 1,
  chapel: 0,
  cemetery: 0,
  library: 2,
  sports: 2,
  jail: 1, // ronda 14: con 4 empleos costaba ~4.100 €/mes sin beneficio medible
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
  bar: 40,
  chapel: 200,
  cemetery: 150,
  library: 300,
  sports: 350,
  jail: 500,
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
  // v1.7: el bar alegra el barrio (y hace ruido); la ermita, la biblioteca y el polideportivo, más lejos.
  bar: { radius: 5, happiness: 5 },
  chapel: { radius: 8, happiness: 3 },
  library: { radius: 8, happiness: 3 },
  sports: { radius: 8, happiness: 4 },
};

/** v1.7: efectos propios de los lugares de vida social. */
export const SOCIAL_PLACES = {
  /** Con ermita, las fiestas alegran más. */
  chapelFestivalMood: 3,
  /** Felicidad extra de la biblioteca para quien quiere prosperar. */
  libraryProsper: 3,
  /** El polideportivo cerca reduce el riesgo de fallecer de los mayores (fracción). */
  sportsHealth: 0.3,
  /** Con cementerio, el duelo pesa menos (valencia del recuerdo «perdió a»). */
  cemeteryGrief: 0.5,
  /** Sin cementerio, quien ha perdido a alguien en el último año lo nota. */
  noCemeteryMood: 4,
} as const;

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
/** v1.9 (economía de cada vecino): 22 → 25; con 22, trabajar fuera y vivir de alquiler era perder dinero cada mes. */
export const COMMUTER_DAILY = 25;
/** Gasto de vida total de referencia (básico + ocio). */
export const LIVING_COST = 450;
/** v1.9: gasto básico obligatorio (comida, ropa, transporte). */
export const LIVING_BASIC = 300;
/** v1.9: ocio, solo si después de pagarlo todo le queda un colchón. */
export const LIVING_EXTRA = 150;
export const LIVING_CUSHION = 300;
/** Parte del gasto que va a tiendas del pueblo si las hay. */
export const LOCAL_SPEND_SHARE = 0.6;
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
/** Los niños crecen deprisa (tiempo de juego comprimido): se independizan a los 6 años de partida. */
export const KID_YEARS = 6;

/** Presupuesto anual: efecto de cada plan. */
export const BUDGET = {
  // Ronda 11: el austero ganaba siempre (+49 % de caja) y el inversor hundía al derrochador.
  austero: { maintenance: 0.92, salaries: 0.95, materials: 1, services: 0.8 },
  equilibrado: { maintenance: 1, salaries: 1, materials: 1, services: 1 },
  inversor: { maintenance: 1.05, salaries: 1, materials: 0.85, services: 1 },
} as const;

/** Fiestas: coste, felicidad (puntos) y días que dura el buen recuerdo. */
export const FESTIVAL = {
  pequena: { cost: 1_500, mood: 4, days: 30, spend: 8 },
  // Ronda 11: las grandes no compensaban nunca (3,3 veces el coste por el doble de ánimo).
  grande: { cost: 3_000, mood: 8, days: 60, spend: 40 },
  popular: { cost: 0, mood: 2, days: 20, spend: 3 },
} as const;
export const FESTIVAL_MONTH = 8;

/** Subvenciones de la Diputación. */
export const GRANT_EVERY_DAYS = 180;
export const GRANT_OFFER_DAYS = 30;
export const GRANT_DEADLINE_DAYS = 180;
export const GRANT_ADVANCE = 0.3;
export const GRANT_PENALTY = 0.1;

/**
 * v1.7: geografía. En el río solo caben puentes (más caros); en la colina se
 * construye pagando más materiales; el suelo junto al agua y en alto vale más;
 * una bomba junto al río da agua a más edificios.
 */
export const TERRAIN = {
  bridgePerTile: 600,
  hillFactor: 1.5,
  riverPumpBonus: 1.25,
  waterfrontLand: 12,
  hillLand: 8,
} as const;

/** v1.7: tiempo. Multiplicadores del día y costes. */
export const WEATHER = {
  /** Días del principio sin nieve, calor ni tormentas (el tutorial empieza en enero). */
  graceDays: 30,
  /** Con nieve, las obras avanzan a la mitad. */
  snowBuild: 0.5,
  /** Con nieve, la central da luz a menos edificios (calefacción). */
  snowPower: 0.85,
  /** Quitanieves: euros por casilla de carretera y día de nieve. */
  snowPerRoad: 1.5,
  /** Con calor, la bomba da agua a menos edificios. */
  heatWater: 0.9,
  /** Felicidad que resta el calor sin un parque o plaza cerca. */
  heatMood: 3,
  /** Probabilidad de que una tormenta anegue cada edificio de la orilla del río. */
  floodChance: 0.12,
  /** Reparación de un edificio anegado (fracción de sus materiales). */
  floodRepair: 0.15,
} as const;

/** v1.7: asociaciones vecinales y protestas. */
export const ASSOCIATIONS = {
  /** Población mínima para que los vecinos se organicen. */
  minPop: 20,
  /** Vecinos con nombre que comparten la queja para fundar una. */
  minMembers: 4,
  /** Si quedan menos socios con la queja, la dan por resuelta. */
  dissolveBelow: 2,
  /** Meses sin respuesta hasta que convocan una manifestación. */
  patienceMonths: 2,
  /** Días de aviso de la manifestación (para que cada socio decida). */
  protestNoticeDays: 3,
  /** Meses que se da el alcalde al prometer en una reunión. */
  promiseMonths: 3,
  /** Como mucho, asociaciones a la vez. */
  max: 3,
  /** Socios que deciden si van a cada manifestación (el líder y los primeros). */
  deciders: 6,
  /** v1.8: cada manifestación sin solución es mayor que la anterior (+50 % de gente). */
  growth: 0.2, // ronda 14: con 0,5 la marcha llegaba a 4 veces la población
  /** Tras estas manifestaciones sin respuesta, puede haber disturbios. */
  riotAfter: 4,
  /** Probabilidad de disturbios (a la mitad si la policía puede detener a los alborotadores). */
  riotChance: 0.5,
  /** Reparación de una tienda dañada (euros, la paga el ayuntamiento) y días que tarda. */
  repairCost: 1_500,
  repairDays: 2,
} as const;

/**
 * Campos del mapa (ronda 13: estaban escritos en fields.ts). Con 0,985 la
 * contaminación se acumulaba hasta el tope (×67 la emisión) y no bajaba
 * nunca: protestas perpetuas y pueblos estancados.
 */
export const FIELDS = {
  pollutionDecay: 0.85,
} as const;

/** v1.8: delincuencia, calabozos y cárcel. */
export const CRIME = {
  /** Población mínima para que haya robos. */
  minPop: 15,
  /** Probabilidad diaria de robo en una tienda por cada 50 puntos de delincuencia por encima del umbral. */
  robBase: 0.006,
  robThreshold: 10,
  /** Lo que se llevan como mucho de la caja de la tienda. */
  robLoss: 400,
  /** Un robo sin resolver sube la inseguridad alrededor durante estos días. */
  hotDays: 30,
  hotCrime: 15,
  /** Calabozos por comisaría. */
  cellsPerStation: 2, // ronda 14: con 4 casi nunca se llenaban y la cárcel no servía
  /** Días en el calabozo hasta el traslado (con cárcel) o cumpliendo (sin cárcel). */
  transferDays: 2,
  cellDays: 60,
  /** Plazas y días de condena en la cárcel. */
  jailCapacity: 30,
  jailDays: 60,
  /** A los vecinos no les gusta la cárcel cerca. */
  jailNuisanceRadius: 4,
  jailNuisanceMood: 3,
  /** Multa por cada día detenido (calabozo o cárcel), para el ayuntamiento. Petición del creador. */
  finePerDay: 10,
  /** Días de calabozo de un vecino detenido en unos disturbios (no pasa a la cárcel). */
  riotDays: 10,
  /** v1.9: robos en casas (por casa y día, como en las tiendas) y lo que se llevan como mucho. */
  homeRobBase: 0.0015,
  homeLoss: 400,
  /** v1.9: ladrones del pueblo: deuda mínima, probabilidad diaria base y antecedentes con los que se van. */
  localDebt: 300,
  localBase: 0.003,
  recordLeave: 3,
  /** v1.9: delincuencia de más por cada vecino endeudado en una casa. */
  debtCrime: 4,
} as const;

/**
 * v1.8 (petición del creador): los servicios suben de nivel (1–3). Cada subida
 * cuesta más, pide nivel de ayuntamiento, vecinos y que el servicio ya se use
 * (que haga falta), y tarda unos días de obra (el servicio sigue abierto).
 */
export const SERVICE_LEVELS = {
  maxLevel: 3,
  /** Capacidad (vecinos atendidos, edificios con agua/luz, plazas de cárcel, calabozos) por nivel. */
  capacity: [1, 1.6, 2.3],
  /** Casillas de radio de más por cada nivel por encima del 1. */
  radiusPlus: 2,
  /** Felicidad de más por nivel (en su radio). */
  happinessPlus: 1,
  /** Empleos de más por nivel (solo donde trabajan 2 o más). */
  jobsPlus: 1,
  maintenance: [1, 1.6, 2.4],
  /** Coste de subir AL nivel i: × materiales del edificio. */
  cost: [0, 0, 2, 4.5],
  days: [0, 0, 4, 7],
  /** Nivel de ayuntamiento y vecinos que pide subir al nivel i. */
  townhall: [0, 0, 3, 4],
  pop: [0, 0, 40, 100],
  /** Uso mínimo (respecto a lo que atiende ahora) para que tenga sentido ampliarlo. */
  usage: 0.75,
  /** En parques, biblioteca y polideportivo: vecinos que viven en su radio, por nivel. */
  residents: [0, 0, 20, 50],
} as const;

/**
 * v1.9 (petición del creador): cada vecino tiene su balance y puede endeudarse.
 * La deuda no es dinero: es lo que debe. Se apunta lo que no puede pagar y se
 * devuelve poco a poco. Ver docs/propuestas/v1.9-economia-personal.md.
 */
export const DEBT = {
  /** Recargo único del ayuntamiento si no se paga al mes siguiente (como el recargo de apremio). */
  townSurcharge: 0.1,
  /** Interés mensual de lo que se debe al banco o al casero. */
  bankInterest: 0.01,
  /** Lo que se devuelve al mes como mucho: el 30 % de lo que ingresó (mínimo 50 €). */
  repayShare: 0.3,
  repayMin: 50,
  /** Meses de alquiler privado impagado hasta el desahucio. */
  evictMonths: 4,
  /** Meses sin que nadie le alquile tras un desahucio (si no tiene dinero, se acaba yendo). */
  evictedMonths: 6,
  /** Cuotas de hipoteca impagadas hasta que el banco ejecuta y vende la vivienda. */
  foreclosureMonths: 3,
  /** Deuda a partir de la que «debe dinero» se nota y salta la decisión (vecinos con nombre). */
  noticeable: 300,
  /** Irse con deudas: deuda mayor que estos meses de ingresos y 0 €; probabilidad diaria. */
  leaveMonths: 3,
  leaveChance: 0.05,
  /** Felicidad: −(base + deuda/por), como mucho −max. */
  moodBase: 3,
  moodPer: 300,
  moodMax: 10,
  /** «Llega justo»: menos de esto sin deuda. */
  tightBelow: 300,
  tightMood: 2,
  /** Aplazamiento que concede el alcalde: meses de cuota fija, sin recargo. */
  planMonths: 12,
  /** v1.9.1: días que espera respuesta quien pide un aplazamiento; sin ella, se lo guarda (rencor). */
  answerDays: 30,
  unansweredGrudge: 5,
  unansweredMood: -3,
} as const;

/** v1.9 (petición del creador): sueldo mínimo que el ayuntamiento obliga a pagar a las empresas del pueblo. */
export type MinWageLevel = 'none' | 'low' | 'medium' | 'high';
// Ronda 15: el alto, 1.250 → 1.150 (con 1.250 las fábricas pagaban lo que ingresaban y cerraba un 15–20 % de empresas al año).
export const MIN_WAGE: Record<MinWageLevel, number> = { none: 900, low: 1_000, medium: 1_100, high: 1_150 };
export const MIN_WAGE_STEP: Record<MinWageLevel, number> = { none: 0, low: 1, medium: 2, high: 3 };
export const MIN_WAGE_FX = {
  /** Felicidad de quien trabaja en una empresa del pueblo, por escalón. */
  workerMood: 1,
  /** Felicidad de quien tiene una empresa con empleados, por escalón (negativo). */
  ownerMood: 2,
  /** Rencor fiscal del empresario al subirlo, por escalón. */
  ownerGrudge: 8,
  /** Demanda comercial que se pierde por escalón (las empresas suben precios). */
  demandC: 5,
  /** Ganas de emprender que se pierden por escalón (margen menor). */
  foundPenalty: 0.2,
} as const;

/** v1.9: paro real. Quien no trabaja en el pueblo puede trabajar fuera… o no encontrar nada. */
export const JOBS_OUTSIDE = {
  /** Probabilidad mensual de perder el trabajo de fuera. */
  loseChance: 0.03,
  /** Probabilidad mensual de encontrar trabajo fuera estando en paro. */
  findChance: 0.3,
  /** Prestación por desempleo (la paga el Estado), al mes, durante unos meses. */
  benefit: 350,
  benefitMonths: 6,
  /** Felicidad de estar en paro. */
  mood: 6,
} as const;

/** v1.9: microcrédito municipal (petición del creador: «no dejes nada para más adelante»). */
export const MICROCREDIT = {
  amount: 1_500,
  months: 12,
  /** Ayuntamiento de nivel mínimo para ofrecerlos. */
  townhallLevel: 2,
} as const;

/**
 * 2.0 (petición del creador): turnos del pueblo con IA. Ver turns.ts y
 * docs/propuestas/v2.0-superia.md.
 */
export const TURN = {
  /** % de vecinos con IA por defecto. */
  defaultShare: 50,
  /** Días de juego entre turnos a x1 (el cliente lo alarga a x3/x10). */
  days: 7,
  /** Horas de juego que espera un turno a la IA antes de que decidan las reglas. */
  dueHours: 12,
  /** Vecinos con IA como mucho en un turno semanal y en una reacción rápida. */
  maxCitizens: 150,
  quickCitizens: 12,
  /** Vecinos con nombre como mucho (rendimiento: relaciones entre todos los pares). */
  maxNamed: 150,
  /** Lo que se guarda: acciones del alcalde, turnos y líneas por turno. */
  mayorLog: 20,
  logTurns: 12,
  logLines: 40,
  /** Cuánto mueve la actitud hacia el alcalde la intención de voto (por punto, de −2 a +2). */
  attitudeVote: 0.05,
  /** Ronda 16: ultimátums con plazo mínimo y, para irse, solo si su felicidad está por debajo de esto. */
  planMinMonths: 3,
  leaveBelow: 55,
  /** Notas de su semana que guarda cada vecino con IA. */
  notes: 4,
  /** Modo mixto: los vecinos por reglas copian esta parte de la actitud de sus amigos con IA (o de su barrio). */
  contagion: 0.6,
  /** Lado (en casillas) de cada barrio para el contagio. */
  barrioSize: 12,
} as const;

/** 2.0: el director del pueblo (sucesos que elige la IA entre los que propone el motor). */
export const DIRECTOR = {
  /** Delincuencia mínima en la calle para que un robo sea candidato. */
  robCrime: 25,
  /** Sucesos como mucho por turno, y buenos como mucho por turno. */
  maxEvents: 3,
  maxGood: 2,
  /** Sucesos malos según el descontento (100 − felicidad): desde 35, uno por turno; desde 55, dos. */
  badFrom: 35,
  twoBadFrom: 55,
  /** Sucesos malos como mucho al mes (ronda 16: cupo gradual, de 0 con descontento 30 a 4 con 70). */
  maxBadPerMonth: 4,
  badFromDiscontent: 30,
  badFullDiscontent: 70,
  /** Lo que justifican los datos (delincuencia alta sin policía, asociación ignorada) pasa aunque el pueblo esté contento: uno al mes. */
  owedCrime: 40,
  /** Con el pueblo contento (felicidad ≥ esta), al menos un suceso bueno por cada dos malos. */
  fairHappiness: 60,
  /** Avisos («Se está cociendo») a la vez, y turnos que dura un aviso. */
  maxBrewing: 5,
  brewingTurns: 4,
  /** Ronda 16: los avisos duran días de juego (no turnos: igual a cualquier velocidad). */
  brewingDays: 28,
  /** Una tienda o casa robada no vuelve al menú en estos días. */
  robbedCooldownDays: 30,
  /** Candidatos de cada tipo en el menú. */
  perKind: 2,
  /** Lo que da un vecino a un amigo en apuros (€, como mucho). */
  helpAmount: 120,
  /** Vecinos a los que llega un rumor. */
  rumorReach: 6,
} as const;

/**
 * 2.1: rangos del pueblo (de aldea a capital comarcal). Solo título y aspecto
 * (cartel, escudo, tejados): no desbloquean nada (eso sigue en townhall.ts).
 * Se sube al tener a la vez los vecinos y el nivel de ayuntamiento; no se baja.
 */
export const RANKS = [
  { id: 'aldea', name: 'Aldea', pop: 0, townhall: 1 },
  { id: 'lugar', name: 'Lugar', pop: 12, townhall: 2 },
  { id: 'villa', name: 'Villa', pop: 40, townhall: 3 },
  { id: 'ciudad', name: 'Ciudad', pop: 100, townhall: 4 },
  { id: 'capital', name: 'Capital comarcal', pop: 200, townhall: 5 },
] as const;

export const RANK = {
  /** Modo IA: días que dura la votación del escudo y el lema (luego deciden las reglas). */
  voteDays: 10,
  /** Piezas y lemas que entran en cada votación. */
  pieceChoices: 3,
  mottoChoices: 3,
} as const;
