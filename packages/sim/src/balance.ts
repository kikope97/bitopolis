import type { BuildKind, LandmarkKind, ScenarioId } from '@bitopolis/shared';
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
  // 2.1: emergencias.
  firestation: { materials: 4_500, workers: 4, days: 3, unlockPop: 20 },
  civilprotection: { materials: 2_500, workers: 3, days: 2, unlockPop: 30 },
  // 2.1: punto limpio con camión de la basura.
  cleanpoint: { materials: 2_500, workers: 3, days: 3, unlockPop: 30 }, // ronda 17: con 20 frenaba el crecimiento
  // 2.3: patrimonio (uno por partida, nivel 3; su forma sale del terreno). Atractivo en TOURISM.heritage.
  heritage: { materials: 9_000, workers: 5, days: 5, unlockPop: 40 },
  // 2.4 (provisional; los afina cada bloque): cuidados, autobús, depuradora y renovables.
  nursery: { materials: 3_500, workers: 3, days: 3, unlockPop: 30 },
  residence: { materials: 7_000, workers: 5, days: 4, unlockPop: 45 },
  busstation: { materials: 6_000, workers: 4, days: 4, unlockPop: 35 },
  sewage: { materials: 8_000, workers: 4, days: 5, unlockPop: 40 },
  solar: { materials: 2_500, workers: 2, days: 2, unlockPop: 25 },
  wind: { materials: 3_500, workers: 3, days: 3, unlockPop: 25 },
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
  // 2.1: el camión es una contrata (va en el mantenimiento): sin plantilla municipal.
  cleanpoint: 0,
  jail: 1, // ronda 14: con 4 empleos costaba ~4.100 €/mes sin beneficio medible
  firestation: 3,
  civilprotection: 1,
  house: 0,
  res: 0,
  shop: 3,
  factory: 5,
  // 2.2: un empleo fijo (los temporeros van aparte, en el mes de cosecha).
  farm: 1,
  // 2.3: las grandes obras y el patrimonio no tienen plantilla; la gran empresa, sus empleos (REGION.bigCompany).
  bridge: 0,
  station: 0,
  fair: 0,
  stadium: 0,
  cathedral: 0,
  heritage: 0,
  bigfactory: 0,
  // 2.4 (bloque A/B): con 2/4/2 empleos, un pueblo de 70 vecinos gastaba la mitad de lo que ingresaba en ellos.
  nursery: 1,
  residence: 2,
  busstation: 1,
  sewage: 1,
  solar: 0,
  wind: 0,
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
  firestation: 350,
  civilprotection: 120,
  // 2.1: incluye la contrata del camión de la basura.
  cleanpoint: 200,
  house: 20,
  res: 0,
  shop: 0,
  factory: 0,
  farm: 0,
  // 2.3: las grandes obras pagan un % de lo gastado (LANDMARKS.upkeep, landmarks.ts); el patrimonio, aquí.
  bridge: 0,
  station: 0,
  fair: 0,
  stadium: 0,
  cathedral: 0,
  heritage: 60,
  bigfactory: 0,
  // 2.4: medido con pnpm sim (casual y constructor, 21 semillas, 4 años): con 250/400/300 la caja del casual caía un 25 %.
  nursery: 100,
  residence: 250,
  busstation: 150,
  sewage: 350,
  solar: 40,
  wind: 80,
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
  // 2.1: los bomberos y la protección civil dan tranquilidad (poca) en su radio.
  firestation: { radius: 9, happiness: 2 },
  civilprotection: { radius: 10, happiness: 1 },
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
/**
 * 2.2 (rival político y vecinos que se presentan): candidaturas, promesas
 * medibles y el gobierno rival con IA. El reparto del voto es sin azar.
 */
export const LISTS = {
  /** Como mucho, candidaturas en la oposición a la vez (cada una de una facción). */
  max: 3,
  /** Lo que paga de su bolsillo un vecino para presentarse. */
  cost: 200,
  minAge: 25,
  minAmbition: 60,
  /** Solo si su facción está descontenta (satisfacción por debajo). Ronda 18: 40 no llegaba nunca. */
  maxSatisfaction: 60,
  /** Solo en los meses anteriores a las elecciones. */
  months: 12,
  /** Por reglas: probabilidad (por hash, sin dados) de que un vecino que puede se presente ese mes (%). */
  ruleChance: 40,
  /** Afinidad con cada lista del voto contra el gobierno: la de su facción pesa más. */
  affinitySame: 3,
  affinityOther: 1,
  /** El jugador en la oposición frente a otras listas (y lo que suma cada punto de campaña). */
  affinityPlayer: 1.5,
  affinityCampaign: 0.25,
  /** Tirón de la facción de una candidatura hacia ella (a la intención de voto). */
  factionPull: 0.12,
} as const;

/** Promesas del rival (2.2): menú cerrado con comprobación medible. */
export const RIVAL_PROMISES = {
  /** Como mucho, promesas propias por candidatura (las mociones aprobadas van aparte). */
  max: 3,
  /** «Crear empleo»: vecinos con trabajo de más sobre los que había al llegar al gobierno. */
  jobs: 5,
  /** «Sanear la deuda»: caja mínima con superávit el mes pasado. */
  cleanTreasury: 5_000,
} as const;

/** Gobierno rival con IA (2.2, `rival-ai.ts`). */
export const RIVAL_AI = {
  /** Opciones del menú como mucho, y de cada tipo. */
  menuMax: 12,
  works: 4,
  taxes: 3,
  /** Lo que elige la IA como mucho cada mes. */
  picks: 2,
  /** Discurso del alcalde rival (caracteres). */
  speechMax: 140,
  /** Recortes solo con la caja por debajo. */
  cutBelow: 0,
  /** Las obras dejan al menos esto en caja. */
  reserve: 3_000,
} as const;

/** Plazo para cumplir una moción aprobada (meses). */
export const MOTION_MONTHS = 6;
/** Apoyo extra al gobierno recién elegido (se apaga en 12 meses). */
export const HONEYMOON = 0.25;
/**
 * 2.2: préstamos municipales con calificación A–D (loans.ts). Sustituyen a los
 * intereses del descubierto: lo que pide el alcalde se devuelve en cuota fija y,
 * si a fin de mes la caja sigue en negativo, el hueco pasa solo a un préstamo de
 * tesorería a 12 meses con recargo (y la nota baja). Carga = cuotas del mes ÷
 * ingresos medios de 12 meses (sin contar lo prestado).
 */
export const LOANS = {
  /** Interés mensual según la nota (A ≈ 4,9 % TAE … D ≈ 26,8 % TAE). */
  rate: { A: 0.004, B: 0.007, C: 0.012, D: 0.02 },
  /** Lo que se puede deber en total, en veces los ingresos anuales (con D no se presta). */
  maxRatio: { A: 2, B: 1.2, C: 0.6, D: 0 },
  /** Plazos en meses. */
  terms: [12, 24, 48],
  /** Importe: múltiplos de 1.000 € entre min y max. */
  step: 1_000,
  min: 1_000,
  max: 200_000,
  /** Comisión por amortizar antes de tiempo (sobre lo amortizado). */
  earlyFee: 0.01,
  /** Préstamo de tesorería: plazo y recargo sobre el tipo de la nota. */
  treasuryMonths: 12,
  treasuryPenalty: 1.5,
  /** Préstamos pedidos a la vez como mucho (más uno de tesorería). */
  maxLoans: 4,
  /** Umbrales de la carga para cada nota y meses de superávit para la A. */
  load: { A: 0.1, B: 0.2, C: 0.35 },
  surplusMonths: 6,
  /** Con la carga por encima, el 💰 de la barra se pone en ámbar. */
  warnLoad: 0.25,
} as const;

/* ---------------- v0.3: tributos y vivienda ---------------- */

/** Con esta población el impuesto único se separa en IBI, tasas y plusvalía. */
export const TAX_SPLIT_POP = 50;
/** IBI anual sobre el valor del inmueble (escala del juego). */
export const IBI_RATE = { low: 0.05, medium: 0.07, high: 0.1 } as const;
/**
 * Tasa de basuras por vecino y mes, y de terrazas por comercio y mes.
 * 2.1: la de basuras solo la paga quien tiene recogida (trash.ts); como ya paga
 * un servicio de verdad (camión y punto limpio), sube un 20 % (10/15/24 → 12/18/28).
 */
export const TASA_BASURAS = { low: 12, medium: 18, high: 28 } as const;
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
export const PROPERTY_VALUE: Partial<Record<BuildingKind, number>> = { house: 7_000, res: 9_000, shop: 20_000, factory: 30_000, farm: 12_000 };
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
  /** 2.3: donar a una gran obra o quejarse de los turistas, como mucho una vez en estos días por vecino. */
  repeatDays: 30,
  /** 2.3: por reglas (la IA no respondió), probabilidad de quejarse de los turistas en un turno. */
  ruleComplainChance: 0.15,
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
  /** 2.3: vecinos en paro que contrata de golpe la gran empresa (`contrata_vecinos`). */
  hireBatch: 5,
  /** 2.3: por debajo de esta caja (o con algún impuesto alto) puede haber polémica por lo que cuesta una gran obra. */
  tightTreasury: 5_000,
} as const;

/** 2.1: encargos del pueblo (retos semanales que salen del estado real). */
export const ERRANDS = {
  /** Vecinos mínimos para que haya encargos. */
  minPop: 8,
  /** A la vez como mucho, cada cuánto se ofrecen y cuándo el primero. */
  max: 3,
  offerEveryDays: 7,
  firstOfferDays: 10,
  /** Días para responder a uno ofrecido, para cumplirlo y de aplazamiento (una vez). */
  answerDays: 14,
  days: 30,
  postponeDays: 7,
  /** No se repite el mismo encargo en estos días. */
  repeatDays: 60,
  /** Recompensa (€, la paga la Diputación) por tipo. */
  reward: { servicio: 900, paro: 700, delincuencia: 700, felicidad: 600, deudas: 600 },
  minJobless: 3,
  jobsWanted: 2,
  crimeFrom: 35,
  crimeTo: 25,
  happyBelow: 62,
  happyGain: 5,
  minDebtors: 4,
  debtsWanted: 2,
} as const;

/** 2.1: El Eco de Bitópolis (periódico semanal). */
export const PRESS = {
  everyDays: 7,
  /** Ediciones que se guardan. */
  keep: 6,
  /** Vecinos a los que llega la respuesta del alcalde. */
  reach: 6,
} as const;

/**
 * 2.1 (hoja de ruta, petición del creador): incendios y bomberos. Cada día,
 * cada edificio puede entrar en riesgo (más las fábricas, con calor y con las
 * estufas del invierno); al día siguiente el riesgo puede acabar en fuego. Con
 * un parque de bomberos en su radio se apaga en pocas horas; sin él, el
 * edificio queda destrozado (se repara, nunca se pierde). Ver fire.ts.
 */
export const FIRE = {
  /** Ronda 17: ayudan tras un incendio quienes viven a esta distancia (o tienen relación o medios), como mucho tantos por turno. */
  helpRadius: 6,
  maxHelpers: 4,
  /** Población mínima para que haya incendios. */
  minPop: 20,
  /** Probabilidad diaria de que un edificio entre en riesgo. */
  riskBase: 0.0003,
  /** Multiplicadores: fábricas, ola de calor y estufas en invierno (viviendas, bar y tiendas). */
  factory: 4,
  heat: 2.5,
  stoves: 2,
  /** Horas de aviso antes de que el riesgo pueda acabar en fuego (Modo normal) y probabilidad de que prenda. */
  riskHours: 72, // ronda 17: con 24 (2 s a x10) no daba tiempo a reaccionar
  ignite: 0.5,
  /** Con director (Modo IA), días que dura un riesgo esperando a que el director lo elija. */
  riskDaysAi: 42,
  /** Horas que arde: con bomberos en su radio, y sin ellos. */
  coveredHours: [2, 4],
  uncoveredHours: [8, 14],
  /** Probabilidad por hora de saltar a cada edificio vecino (también en diagonal). */
  spreadCovered: 0.003,
  spreadUncovered: 0.008,
  /** Como mucho, edificios ardiendo a la vez. */
  maxBurning: 5,
  /** Reparación tras el fuego: fracción de los materiales (mínimo) y días de obra. */
  repair: 0.35,
  repairMin: 800,
  repairDays: 3,
  /** El nivel 2 (cisterna) llega a las colinas; el 3 ayuda en las riadas (reparaciones a la mitad en su radio). */
  hillLevel: 2,
  floodLevel: 3,
  floodRepairCut: 0.5,
  /** Felicidad: casa destrozada por el fuego; y horas que ahorra cada vecino que ayuda a apagarlo. */
  burntHomeMood: 10,
  helpHours: 1,
  /** Lo que da (como mucho) un vecino a quien se ha quedado sin casa por el fuego. */
  helpAmount: 100,
} as const;

/** 2.1: protección civil (caseta de voluntarios) y diques. */
export const CIVIL = {
  /** En el radio de una caseta, la probabilidad de riada baja un 60 % y el quitanieves cuesta la mitad. */
  floodCut: 0.6,
  snowCut: 0.5,
  /** Dique en una casilla de la orilla: lo que cuesta y a cuántas casillas protege (también en diagonal). */
  dikeCost: 900,
  dikeReach: 1,
  /** Voluntarios por caseta (parados que se apuntan), felicidad que les da y probabilidad mensual (Modo normal). */
  volunteersPer: 6,
  volunteerMood: 3,
  volunteerChance: 0.25,
} as const;

/** 2.1: la ambulancia (nivel 2 del centro de salud) llega a las urgencias de los mayores. */
export const AMBULANCE = {
  /** Nivel del centro de salud que la tiene y alcance (× su radio). */
  level: 2,
  reach: 1.5,
  /** Probabilidad de llegar a tiempo (con nieve, × snow). */
  save: 0.6,
  snow: 0.5,
  /** Mayores en el menú del director para un susto que acaba bien. */
  scareAge: 75,
} as const;

/**
 * 2.1: rangos del pueblo (de aldea a capital comarcal). Solo título y aspecto
 * (cartel, escudo, tejados): no desbloquean nada (eso sigue en townhall.ts).
 * Se sube al tener a la vez los vecinos y el nivel de ayuntamiento; no se baja.
 */
export const RANKS = [
  { id: 'aldea', name: 'Aldea', pop: 0, townhall: 1 },
  { id: 'lugar', name: 'Lugar', pop: 12, townhall: 2 },
  { id: 'villa', name: 'Villa', pop: 40, townhall: 2 },
  { id: 'ciudad', name: 'Ciudad', pop: 100, townhall: 3 },
  { id: 'capital', name: 'Capital comarcal', pop: 200, townhall: 4 },
] as const;

export const RANK = {
  /** Modo IA: días que dura la votación del escudo y el lema (luego deciden las reglas). */
  voteDays: 10,
  /** Piezas y lemas que entran en cada votación. */
  pieceChoices: 3,
  mottoChoices: 3,
} as const;

/**
 * 2.1: basura y punto limpio. Cada edificio con gente acumula basura al día; el
 * camión del punto limpio recorre cada día unas casillas de carretera (por la
 * red, desde el punto limpio) y vacía los edificios que dan a ellas. Sin
 * recogida, la basura se amontona: bolsas, suciedad en la calle y, más arriba,
 * ratas. La tasa de basuras solo se cobra a quien tiene recogida. Ver trash.ts.
 */
export const TRASH = {
  /** Basura al día por vecino que vive en el edificio y por persona que trabaja en él. */
  perResident: 2,
  perWorker: 1,
  /** De más al día por la actividad (tiendas, bar, mercado y talleres). */
  activity: { shop: 3, market: 4, bar: 2, factory: 3 } as Partial<Record<BuildingKind, number>>,
  /** Bolsas en la calle a partir de aquí; ratas, más arriba; tope. */
  dirtyAt: 40,
  ratsAt: 120,
  max: 150,
  /** Campo de suciedad (0–100): radio alrededor de cada edificio sucio. */
  dirtRadius: 2,
  /** Felicidad que resta la suciedad en la calle (campo ≥ dirtyField) y las ratas (campo ≥ ratsField). */
  dirtyField: 25,
  ratsField: 70,
  dirtyMood: 2,
  ratsMood: 5,
  /** Delincuencia de más donde la calle está sucia (fracción, a pleno con ratas). */
  crimeBoost: 0.1,
  /** Casillas de carretera que recorre el camión al día en el nivel 1 (× capacidad del nivel). */
  route: 60,
  /** Con nieve, el camión no llega a las calles nevadas: recorre esta parte. */
  snowRoute: 0.5,
  /** Días de aviso desde que se puede construir el punto limpio hasta que la basura empieza a acumularse. */
  warnDays: 45, // ronda 17: con 20 llegaba justo cuando se ahorra para el ayuntamiento 3
  /** Partidas de antes (migradas): días de gracia antes de que se ensucien. */
  graceDays: 60,
  /** Nivel 2 (reciclaje): tasa más barata y facción ecologista más contenta. */
  recyclingDiscount: 0.2,
  recyclingFaction: 6,
  /** Nivel 3 (compostaje): el abono se vende fuera, por vecino atendido y mes. */
  compostPerResident: 3,
  /** «Tirar al monte»: contaminación cerca de casa (puntos y radio). */
  dumpPollution: 30,
  dumpRadius: 2,
  /** Por reglas: un vecino terco con ratas en casa la tira al monte uno de cada tantos días. */
  dumpTerco: 70,
  dumpEvery: 7,
  /** Director: la plaga de ratas se extiende a los edificios cercanos. */
  plagueRadius: 3,
  /** Días entre avisos de ratas. */
  warnEveryDays: 7,
} as const;

/**
 * 2.2: licitaciones de obras (tenders.ts). Las obras con materiales desde
 * `minCost` eligen oferta: local (la de siempre), barata de fuera o la del
 * primo del concejal. `mat` multiplica los materiales y `days` el plazo.
 */
export const TENDER = {
  minCost: 2_500,
  /** Llegan con el ayuntamiento de este nivel (las primeras obras, las del tutorial, van sin licitación). */
  fromLevel: 2,
  /** Barata de fuera: su cuadrilla cobra `wage` al día (no los parados del pueblo); con p, sobrecoste al terminar. */
  cheap: { mat: 0.8, days: 1.3, wage: 60, overrun: 0.25, p: 0.4 },
  // Ronda 18: antes (0,15 y 0,25) la de fuera salía siempre a cuenta.
  /** La del primo: `kick` de los materiales va a la caja de su negocio; con p, escándalo. */
  crony: { mat: 0.9, days: 0.9, kick: 0.1, p: 0.35 },
  /** Rumor en el bar y estallido (días desde la firma). */
  warnDays: 14,
  revealDays: 28,
  /** Con director (Modo IA): si no lo hace estallar en estos días tras `revealDays`, se olvida. */
  forgetDays: 28,
  /** «Revisar el contrato» durante el rumor: cuesta esta parte de los materiales. */
  cancelFee: 0.2,
  // Ronda 18: con el 10 % revisar costaba lo que ahorraba el primo (salía gratis).
  /** Recuerdo del escándalo en los vecinos con nombre (felicidad) y bajada de campaña en cada facción. */
  scandalMood: -8,
  scandalCampaign: 3,
  /** El concejal al que se le revisa el contrato: rencor. */
  offendedGrudge: 4,
  /** Licitaciones guardadas (las 10 últimas; las vivas no se borran). */
  keep: 10,
} as const;

/** 2.2: calles y plazas con nombre de vecinos (streets.ts). */
export const STREETS = {
  /** La placa. */
  plaque: 150,
  /** Amigos y familia del homenajeado: felicidad; quien se llevaba mal: rencor. */
  friendHappiness: 4,
  rivalGrudge: 2,
  /** Candidatos: mayores desde esta edad y «muy queridos» con tantas amistades. */
  oldAge: 70,
  lovedFriends: 3,
  candidates: 3,
} as const;

/**
 * 2.2: el campo (zona A, fincas). Cosecha = base anual × factor del año; el
 * factor empieza en `start` tras cada cosecha y se acumula cada día con el
 * tiempo (lluvia suma, calor resta; el regadío lo nota poco). En el mes de
 * cosecha, cada tormenta quita un 15 %; una riada, un 60 % al regadío.
 * Ronda de la 2.2: la base del plan (2.400–4.200 €/año) no pagaba ni el
 * sueldo del empleo fijo (900 €/mes); se sube para que la finca viva de lo suyo.
 */
export const FARM = {
  /** Vecinos y nivel del ayuntamiento para pintar zona A. */
  unlockPop: 20,
  level: 2,
  jobs: 1,
  /** Temporeros en el mes de cosecha y lo que cobra cada uno por la temporada. */
  seasonal: 3,
  seasonalWage: 450,
  /** Venta anual con un año normal (factor 1), por cultivo. */
  base: { secano: 12_500, regadio: 17_500, olivar: 15_000, vinedo: 16_000 },
  /** Mes de la cosecha (1–12): secano julio, huerta agosto, vendimia septiembre, aceituna noviembre. */
  harvestMonth: { secano: 7, regadio: 8, vinedo: 9, olivar: 11 },
  /** Factor del año: de dónde parte y lo que suma cada día de lluvia o resta cada día de calor. */
  start: 1,
  /** Lo que se seca la tierra cada día (compensa la lluvia media del año). */
  dry: -0.0012,
  rain: 0.02,
  heat: -0.015,
  /** El regadío nota el tiempo a esta parte. */
  irrigated: 0.3,
  /** Tormenta en el mes de cosecha y riada (regadío), multiplicativos. */
  storm: -0.15,
  flood: -0.6,
  /** Granizo (suceso del director, solo tras una tormenta reciente sobre la finca). */
  hail: -0.3,
  hailDays: 21,
  /** Fiesta de la cosecha (suceso bueno del director): un poco más de venta y alegría. */
  feast: 0.05,
  feastReach: 8,
  min: 0.4,
  max: 1.3,
  /** El factor se acumula sin recortar (hasta este tope); al vender, se recorta a min–max. */
  cap: 2,
  /** IBI rústico: el de una finca es esta parte del normal. */
  ibiRustic: 0.3,
  /** Regadío a esta distancia del río (casillas, también en diagonal). */
  riverReach: 2,
  /** Cosecha prevista: buena desde aquí, mala por debajo de `badBelow`. */
  goodFrom: 1.05,
  badBelow: 0.8,
  /** Crecimiento: probabilidad diaria con solar libre, y una finca por cada tantos vecinos (más una). */
  growChance: 0.25,
  popPerFarm: 20,
  /** Y no más de tantas por taller (más una): el campo no pasa a la industria. */
  perFactory: 3,
  growth: { workers: 2, days: 2 },
  /** Caja inicial: sueldos hasta la primera cosecha y un colchón. */
  seedExtra: 1_000,
  /** Caja que guarda (el resto, dividendos): un año de sueldos. */
  cashCap: 12_000,
  /** No cierra por un mes malo: solo tras tantos meses seguidos sin pagar el sueldo. */
  closeAfter: 6,
} as const;

/* ---------- 2.3: metas grandes (ver docs/propuestas/v2.3-metas-grandes.md) ---------- */

export interface LandmarkSpec {
  /** Requisitos que se miran en el momento de pagar cada fase (no solo al empezar). */
  pop: number;
  happiness: number;
  townhall: number;
  /** Otro edificio que tiene que existir (la catedral pide ermita). */
  needs?: BuildingKind;
  /** Solo sobre el río (el puente de piedra). */
  onRiver?: boolean;
  /** Lado en casillas: 2 (2×2) salvo el puente. */
  size: 1 | 2;
  phases: number;
  /** Lo que paga el ayuntamiento al empezar cada fase (materiales). */
  phaseCost: number;
  /** Obra de cada fase (un `Project`, cuenta en `serviceSaturation`). */
  workers: number;
  days: number;
}

/**
 * 2.3: grandes obras por fases. Los números buscan la primera gran obra entre
 * los meses 30–42 de una partida casual. Cada fase terminada da su parte del
 * efecto (fases hechas ÷ fases); nunca se empieza una fase con descubierto.
 */
export const LANDMARKS = {
  specs: {
    // Medido con `pnpm sim` (casual a 4 años): con 30 vecinos, 50 de felicidad y 3 × 6.000 € salía en el mes 5. F3 (2.3): con
    // el perfil pagando fase a fase, la primera obra se termina hacia el mes 33 (19–43) y la caja queda en ~35.000 €.
    bridge: { pop: 60, happiness: 55, townhall: 3, onRiver: true, size: 1, phases: 3, phaseCost: 28_000, workers: 4, days: 5 },
    station: { pop: 70, happiness: 55, townhall: 3, size: 2, phases: 3, phaseCost: 30_000, workers: 6, days: 6 },
    fair: { pop: 80, happiness: 55, townhall: 3, size: 2, phases: 2, phaseCost: 40_000, workers: 6, days: 6 },
    stadium: { pop: 120, happiness: 60, townhall: 4, size: 2, phases: 3, phaseCost: 40_000, workers: 8, days: 8 },
    cathedral: { pop: 150, happiness: 60, townhall: 4, needs: 'chapel', size: 2, phases: 4, phaseCost: 45_000, workers: 8, days: 10 },
  } satisfies Record<LandmarkKind, LandmarkSpec>,
  /** Efectos con todas las fases hechas. */
  effects: {
    /** Puente de piedra: riadas −50 % en la orilla, suelo +10 a 6 casillas, atractivo +2. */
    bridge: { floodCut: 0.5, land: 10, landRadius: 6, attract: 2 },
    /** Estación: demanda R +15, plazas de trabajo fuera +25 %, coste de ir a trabajar fuera −30 %. */
    station: { demandR: 15, jobsOutside: 1.25, commuter: 0.7, trip: 10 },
    /** Feria regional: en septiembre, ventas +15 % y visitantes ×2. */
    fair: { month: 9, sales: 0.15, visitors: 2 },
    /** Estadio: +4 de felicidad a 12 casillas, cuenta como polideportivo, ruido en el partido del mes (ese día). */
    stadium: { happiness: 4, radius: 12, countsAs: 'sports' as BuildingKind, noise: 30, noiseRadius: 4, matchDay: 7 },
    /** Catedral: +3 de felicidad en todo el pueblo, atractivo +5. */
    cathedral: { happiness: 3, attract: 5 },
  },
  /** Mantenimiento mensual: esta parte de lo gastado. */
  upkeep: 0.01,
  /** Cofinanciación de la Diputación (`Grant.landmark`): parte de cada fase; con el ayuntamiento 5, `shareTop`. */
  grant: { shareMin: 0.25, shareMax: 0.4, shareTop: 0.5, offerDays: 30 },
  /** IA: voluntarios (la fase sale más barata), polémica (actitud −1 en la facción que paga) y donaciones. */
  volunteersCut: 0.1,
  controversyAttitude: -1,
  /** Donación de un vecino: esta parte de sus ahorros (solo `traits.ahorro` bajo y actitud ≥ 1). */
  donateShare: 0.02,
  donateMaxSaving: 40,
  donateMinAttitude: 1,
  /** Donaciones de menos de esto no se hacen. */
  donateMin: 20,
  /** Sin IA: probabilidad mensual de una donación por obra en marcha. */
  donateChance: 0.1,
} as const;

/**
 * 2.3: turismo y patrimonio. Atractivo = patrimonio + obras + fiestas activas
 * + árboles − contaminación media; visitantes/mes = atractivo × `perAttract`
 * × el factor de la comarca (`REGION.fx[fase].visitors`).
 */
export const TOURISM = {
  /**
   * Patrimonio (uno por partida; su forma sale del terreno: mar o río a
   * `nearWater` casillas, colina o llano). La obra, en BUILD.heritage; el
   * mantenimiento, en MAINTENANCE.heritage; el nivel, en BUILD_LEVEL.
   */
  heritage: { attract: 10, nearWater: 2 },
  festivalAttract: 5,
  /** Atractivo por cada árbol del mapa y por parque, con tope entre los dos. */
  perTree: 0.02,
  perPark: 1,
  treesMax: 6,
  /** Por debajo de este atractivo no viene nadie. */
  minAttract: 8,
  /** Lo que resta la contaminación media (0–100) en las casillas con edificio. Con 0,3, un pueblo con talleres no tenía turistas. */
  pollution: 0.1,
  perAttract: 8,
  /** Casas rurales (vivienda en propiedad con `rural`): plazas, lo que gana el dueño por visitante y tope al mes. */
  rural: { beds: 3, perVisitor: 40, maxMonth: 600, openCost: 1_500, minVisitors: 20 },
  /** Noches por visitante; la tasa (€/noche por nivel) quita esta parte de visitantes por nivel. */
  nights: 3,
  taxDrop: 0.2,
  /** Entorno protegido: radio sin zona I ni fábricas, atractivo ×1,3 y −8 de felicidad a los empresarios. */
  protect: { radius: 6, attract: 1.3, ownerMood: -8 },
  /** Turistificación: con casas rurales por encima de esta parte de las viviendas, alquiler +20 % e inquilinos −4. */
  touristified: { share: 0.15, rent: 0.2, renterMood: -4 },
  /** IA: reportaje de la tele (×1,5 un mes). Sin IA: ambición alta + casa propia → casa rural con esta probabilidad mensual. */
  tvReport: 1.5,
  ruralChance: 0.05,
  ruralAmbition: 60,
  /** IA (`turistas_ruido`): un mes de mal humor a esta distancia de las casas rurales. */
  noise: { mood: -3, radius: 4, minVisitors: 60 },
} as const;

/**
 * 2.3: ciclo comarcal (cadena de Markov sobre `state.rng`): cada fase dura
 * entre `minMonths` y `maxMonths`; se avisa `warnMonths` antes (brewing y El Eco).
 */
export const REGION = {
  /** La primera fase normal dura esto (también en las partidas migradas). */
  firstMonths: 18,
  minMonths: 15,
  maxMonths: 30,
  warnMonths: 2,
  /** Probabilidad de pasar a otra fase al acabar la actual (si no, normal). */
  next: {
    normal: { bonanza: 0.3, crisis: 0.4 },
    bonanza: { crisis: 0.4 },
    crisis: { normal: 0.7 },
  },
  /** Efectos por fase: ventas de los talleres, plazas de trabajo fuera, demanda I, valor de la vivienda y visitantes. */
  fx: {
    bonanza: { factoryRevenue: 1.2, jobsOutside: 1.3, demandI: 20, propertyValue: 1.1, visitors: 1.2 },
    normal: { factoryRevenue: 1, jobsOutside: 1, demandI: 0, propertyValue: 1, visitors: 1 },
    crisis: { factoryRevenue: 0.75, jobsOutside: 0.6, demandI: -25, propertyValue: 0.9, visitors: 0.8 },
  },
  /** FEDER: en crisis, subvención para estación, polígono o reparación. */
  feder: { shareMin: 0.6, shareMax: 0.7, months: 12 },
  /** Gran empresa: requisitos, fábrica 2×2, empleos, contaminación, ERE y deslocalización. */
  bigCompany: {
    pop: 80,
    industrialTiles: 6,
    offerDays: 60,
    materials: 0,
    jobs: 40,
    pollution: 2,
    /** En crisis: ERE (se queda esta parte de la plantilla) o se va; aviso con estos meses. */
    ereKeep: 0.5,
    warnMonths: 3,
    leaveChance: 0.3,
    /** Incentivos: IBI bonificado (parte que no paga, durante unos años) o suelo gratis (lo pone el ayuntamiento). */
    ibiDiscount: 0.5,
    ibiYears: 2,
    landCost: 8_000,
    /** Felicidad de los vecinos de alrededor (a `nearRadius` casillas) mientras está abierta; los ecologistas, la mitad. */
    protestMood: -3,
    nearRadius: 4,
    /** Sin incentivo viene con menos plantilla. */
    jobsNoIncentive: 30,
    /** IBI al mes (de fuera), sueldo respecto al mínimo y obra de la fábrica (la paga la empresa). */
    ibi: 700,
    wageFx: 1.1,
    workers: 8,
    days: 10,
    /** 2.3: sin director (Modo normal o IA caída), vecinos en paro que contrata cada mes por reglas. */
    hirePerMonth: 4,
  },
} as const;

/** 2.3: escenarios al empezar (scenarios.ts). Cumplir = medalla y momento del álbum; no cumplir pasa a Libre. */
export const SCENARIOS = {
  libre: {},
  /**
   * Pueblo en quiebra: caja −8.000, 25 vecinos resentidos. Meta: cuentas en positivo
   * (caja menos lo que se debe al banco) y 13 meses seguidos de superávit antes de 24 (F3: con −8.000 y 6 meses, el casual ganaba al 6.º mes).
   */
  quiebra: {
    treasury: -18_000,
    citizens: 25,
    grudge: 15,
    debtMonths: 2,
    rating: 'C',
    surplusMonths: 13,
    deadlineMonths: 24,
    /** Pueblo de partida (además del ayuntamiento, de nivel 2): casas municipales, bloques, tiendas, talleres y parque. */
    village: { house: 2, res: 6, shop: 2, factory: 1, park: 1 },
    money: [300, 1_500],
    age: [22, 70],
  },
  /** El pueblo que se vacía: 30 vecinos de 60–80 años, 8 casas vacías, demanda R baja año y medio. Meta: 58 vecinos en 36 meses (F3: con 50 y un año, se ganaba al 13.º mes). */
  vaciado: {
    citizens: 30,
    ageMin: 60,
    ageMax: 80,
    emptyHouses: 8,
    /** Plan: −30; con −30 los empleos de los talleres traían gente igual y la meta caía al 4.º mes. */
    demandR: -60,
    demandMonths: 18,
    goalPop: 58,
    deadlineMonths: 36,
    treasury: 30_000,
    village: { house: 2, res: 8, shop: 1, factory: 1, park: 1 },
    money: [2_000, 6_000],
  },
  /** Tras la riada: río obligatorio, 6 edificios dañados, 20.000 € de emergencia a 24 meses, riadas ×1,5 el primer año. Meta: reparar todo y 62 vecinos (F3: con reparaciones de 4.000 € y 40 vecinos se ganaba al 5.º mes). */
  riada: {
    damaged: 6,
    grant: 20_000,
    grantMonths: 24,
    /** Anticipo de la subvención al empezar (el resto, al terminar de reparar en plazo; si no, se devuelve con recargo). */
    grantAdvance: 0.3,
    floodFx: 1.5,
    floodMonths: 12,
    goalPop: 62,
    deadlineMonths: 36,
    citizens: 22,
    treasury: 12_000,
    /** Reparar lo de la riada: parte de los materiales del edificio (mínimo `repairMin`). */
    repair: 2,
    repairMin: 22_000,
    village: { house: 2, res: 7, shop: 2, factory: 2, park: 1 },
    money: [400, 2_000],
    age: [20, 72],
  },
} as const satisfies Record<ScenarioId, object>;

/** 2.3: umbrales de los logros y medallas (achievements.ts). No dan dinero. */
export const ACHIEVEMENTS = {
  /** Crecimiento. */
  population: [25, 100, 250, 500],
  /** Dinero: años sin préstamos ni descubierto, caja y nota. */
  noDebtYears: 2,
  treasury: 100_000,
  /** Gente: generaciones nacidas en el pueblo, parejas, propietarios. */
  generations: 3,
  couples: 6,
  owners: 20,
  /** Política: reelecciones, promesas cumplidas, presupuestos aprobados seguidos. */
  reelected: 3,
  promises: 10,
  budgetYears: 5,
  /** Desgracias: riadas superadas. */
  floods: 3,
  /** Turismo: visitantes en un mes. */
  visitors: 250,
  /** Récord nuevo: como mucho un aviso al mes. */
  recordEveryMonths: 1,
  /** Récords: no se avisan el primer año (todo es récord) ni si no mejoran al menos esta parte (o 1). */
  recordAfterMonths: 12,
  recordMargin: 0.1,
  /** «Nadie con deudas» solo cuenta desde estos vecinos. */
  noDebtorsPop: 50,
  /** Entorno protegido sin turistificar durante estos meses seguidos. */
  protectedMonths: 12,
  /** Crisis superada sin cierres: con al menos estas empresas al acabar. */
  crisisMinBusinesses: 15,
  /** Encargos cumplidos (los cuenta `errands.medals`, 2.1): bronce, plata y oro. */
  errands: [1, 5, 15],
} as const;

/* ---------------- 2.4 «Vida» (cada bloque afina sus números) ---------------- */

/** Bloque A: guardería y residencia (care.ts). Cuotas en €/mes por nivel gratis/reducida/normal. */
export const CARE = {
  nursery: { places: 20, radius: 8, maxAgeYears: 3, fee: { gratis: 0, reducida: 30, normal: 60 } },
  /**
   * Los mayores que viven solos y sin hijos en el pueblo entran solos si hay plaza: desde 75 años o, desde
   * 70, si están tristes (felicidad < unhappyEnter). Con una cuota mayor que la pensión, solo con ahorros
   * para `savingsMonths` meses. En la residencia, de lo básico solo gastan `livingShare` (la comida va incluida).
   */
  residence: { places: 12, fee: { gratis: 0, reducida: 200, normal: 400 }, unhappyEnter: 45, savingsMonths: 12, livingShare: 0.3 },
  /** Pareja con plaza de guardería: natalidad ×1,5. Sin plaza, prob. al mes de que deje el trabajo de fuera. */
  birthWithPlace: 1.5,
  quitWithoutPlace: 0.15,
  /** Pensión mínima desde los 67 años (de fuera). */
  pension: 650,
  pensionAge: 67,
  /** Mayores atendidos (≥ 70): no se van, residencia ×0,8 de riesgo de morir, ánimo. */
  elderAge: 70,
  residenceDeathFx: 0.8,
  caredMood: 4,
  aloneMood: -5,
  /** «Cuidar en casa»: el hijo pierde parte del sueldo y algo de ánimo; mejora la relación. */
  homeCare: { wageCut: 0.2, mood: -3, relation: 2, parentAge: 75 },
};

/** Bloque B: estación de autobuses (transit.ts). */
export const TRANSIT = {
  /** El Consorcio paga esta parte del mantenimiento (de fuera). */
  consortium: 0.5,
  findChance: 0.45,
  loseChance: 0.02,
  mood: 2,
  demandR: 8,
  /** € por viaje × días de trabajo al mes, por usuario; caro resta ánimo. */
  fare: { gratis: 0, normal: 1, caro: 2 },
  workDays: 20,
  dearMood: -2,
  /** Con turismo, visitantes ×1,25; sin él, gasto de forasteros en las tiendas (€/día por cada 10 vecinos). */
  visitorsFx: 1.25,
  daytripPer10: 4,
  /** Por reglas, el parado con ambición desde este nivel busca trabajo fuera en autobús. */
  searchAmbition: 50,
  /** Excursión de jubilados (director, `excursion`): mínimo y máximo de jubilados, cada cuántos días, ánimo, lo que paga cada uno y, sin director, probabilidad al mes. */
  excursion: { min: 3, max: 8, everyDays: 90, mood: 3, cost: 15, ruleChance: 0.2 },
};

/** Bloque C: el río, la depuradora y las renovables (waterworks.ts). */
export const WATERWORKS = {
  /** Lo que echa cada edificio a ≤ `reach` casillas del río (res/shop/factory), y lo que baja por casilla. */
  reach: 6,
  dump: { res: 1, shop: 2, factory: 6 } as Record<string, number>,
  decayPerTile: 0.04,
  sewage: { buildings: 60, clean: 0.85 },
  /** Río > dirtyPump: la bomba pierde su +25 %; la orilla, −3. Al salir > fineAt: multa trimestral. */
  dirtyPump: 40,
  shoreMood: -3,
  fineAt: 60,
  fine: 1_500,
  solar: { buildings: 15, winter: 0.6, snow: 0.4 },
  wind: { buildings: 30, storm: 1.2, noise: 30, noiseRadius: 3, complainRadius: 3 },
};

/** Bloque D: plenos hablados (texto fuera del estado) y sus reacciones. */
export const PLENO_TALK = {
  speakers: 4,
  maxLine: 140,
  reaction: { aplaude: 2, murmura: -1, abuchea: -2, se_levanta: -2 } as Record<string, number>,
};

/** Bloque D: dilemas (dilemmas.ts). Uno al mes como mucho, 7 días para decidir. */
export const DILEMMA = {
  perMonth: 1,
  days: 7,
  noDecideGrudge: 3,
  expandCost: 3_000,
};

/** Bloque E: fiestas de temporada (seasons.ts). Mes de cada una (1–12). */
export const SEASONS = {
  month: { romeria: 5, sanjuan: 6, patronales: 8, navidad: 12 } as Record<string, number>,
  committee: 3,
  collectPerNamed: 10,
  budgetShare: { nada: 0, poco: 0.5, todo: 1 } as Record<string, number>,
  nadaGrudge: 1,
};
