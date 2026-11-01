import type { MinWageLevel } from './balance.ts';
import type { TownAi } from './turns.ts';
import type { ErrandsState } from './errands.ts';
import type { PressState } from './press.ts';
import { type BigCompanyIncentive, type LandmarkKind, type ScenarioId, type TerrainShape, TICKS_PER_DAY, TICKS_PER_MONTH, type TaxLevel } from '@bitopolis/shared';
import { REGION } from './balance.ts';
import { emptyFields, type Fields } from './fields.ts';
import { chance, nextInt, type RngState, seedRng } from './prng.ts';
import type { Goal, Hook, Memory, Pleno, PromiseRecord, Relation } from './social.ts';
import { emptyPolitics, type Politics } from './politics-core.ts';
import { generateTerrain, isWater, Terrain } from './terrain.ts';
import { applyScenario } from './scenarios.ts';
import type { Weather } from './weather.ts';
import type { Association } from './associations.ts';
import type { Moment } from './album.ts';
import type { Departed } from './family.ts';
// Solo el tipo: importar crime.ts aquí crea un ciclo al cargar (crime → social → commands → state).
import type { Justice } from './crime.ts';
import { emptyRank, type TownRank } from './rank-core.ts';
import type { Tender } from './tenders.ts';
import type { StreetName } from './streets.ts';

/** Sube con cada cambio de forma del estado; ver migrations.ts. */
export const FORMAT_VERSION = 18;

export const MAP_W = 48;
export const MAP_H = 48;

/** Capa de suelo: índice por tile (y * w + x). */
export const Tile = { Grass: 0, Road: 1, Tree: 2 } as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

/** Capa de zonas (2.2: A = agraria, fincas). */
export const Zone = { None: 0, R: 1, C: 2, I: 3, A: 4 } as const;
export type Zone = (typeof Zone)[keyof typeof Zone];

export type BuildingKind =
  | 'townhall'
  | 'water'
  | 'power'
  | 'park'
  | 'school'
  | 'clinic'
  | 'police'
  | 'plaza'
  | 'market'
  /** v1.7: lugares de vida social. */
  | 'bar'
  | 'chapel'
  | 'cemetery'
  | 'library'
  | 'sports'
  | 'jail'
  /** 2.1: emergencias. */
  | 'firestation'
  | 'civilprotection'
  /** 2.1: punto limpio (recogida de basura). */
  | 'cleanpoint'
  /** 2.4: cuidados (guardería y residencia), autobús, depuradora y renovables. */
  | 'nursery'
  | 'residence'
  | 'busstation'
  | 'sewage'
  | 'solar'
  | 'wind'
  /** 2.5: vivienda protegida, cooperativa agraria y oficina de correos. */
  | 'vpo'
  | 'coop'
  | 'post'
  | 'house'
  /** Crecen solos sobre zonas. */
  | 'res'
  | 'shop'
  | 'factory'
  /** 2.2: finca (crece sola sobre zona agraria). */
  | 'farm'
  /** 2.3: grandes obras por fases (landmarks.ts; todas 2×2 salvo el puente). */
  | LandmarkKind
  /** 2.3: patrimonio (uno por partida; su forma sale del terreno, tourism.ts). */
  | 'heritage'
  /** 2.3: fábrica 2×2 de la gran empresa (region.ts). */
  | 'bigfactory';

export interface Building {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  /** Propietario: 0 = ayuntamiento, -1 = inversor de fuera, otro = vecino. */
  owner: number;
  /** Caja propia (empresas). Euros enteros ≥ 0. */
  cash: number;
  /** v1.9: ventas del mes en curso y cuentas del mes pasado (salud de las empresas). */
  sales?: number;
  books?: { sales: number; wages: number; taxes: number };
  /** Ronda 15: plantilla a la que se ha recortado (si pierde dinero). */
  staff?: number;
  /** false mientras es una obra. */
  built: boolean;
  /** Servicios recibidos por red (se recalculan cada día). */
  hasWater: boolean;
  hasPower: boolean;
  /** v1.8: días seguidos sin agua / sin luz (para el icono de problema duradero). */
  dryDays?: number;
  darkDays?: number;
  /** v1.8: dañado en unos disturbios (o, en la 2.1, por el fuego): no funciona hasta que se repara. */
  damaged?: { cost: number; repairUntil: number; cause?: 'fuego' | 'riada' };
  /** 2.1: en riesgo de incendio (desde cuándo y por qué) y ardiendo (hasta cuándo; con bomberos en su radio o no). */
  risk?: { since: number; why: string };
  fire?: { since: number; until: number; covered: boolean };
  /** v1.8: nivel del servicio (1–3; sin definir = 1) y fin de la obra de mejora. */
  level?: number;
  upgradeUntil?: number;
  /** Meses seguidos sin poder pagar nóminas (empresas). */
  unpaidMonths: number;
  /** Nombre propio (empresas fundadas por vecinos: «Panadería de Lucía»). */
  name?: string;
  /** Casa municipal a la venta (si no, en alquiler). */
  forSale?: boolean;
  /** Viviendas de una casa municipal que ya no son del ayuntamiento. */
  privateUnits?: number;
  /** 2.1: basura acumulada sin recoger (ver trash.ts). */
  trash?: number;
  /** 2.2: fincas: cultivo (sale del terreno, farm.ts) y factor de la cosecha del año (se acumula con el tiempo). */
  crop?: Crop;
  yieldFx?: number;
  /** 2.2: año (de juego) de la última cosecha vendida y última tormenta sobre la finca (tick). */
  harvested?: number;
  stormed?: number;
  /** 2.3: lado en casillas (sin definir = 1). Las grandes obras son 2×2: ver `occupies`. */
  size?: 2;
  /** 2.3: vivienda en propiedad convertida en casa rural (turismo, tourism.ts). */
  rural?: boolean;
  /** 2.4: vertido al río sin depurar (tick hasta el que dura, waterworks.ts). */
  spill?: number;
  /** Ronda 20: multada por verter (dilema): echa la mitad hasta este tick. */
  cleanUntil?: number;
}

/** 2.2: cultivos de las fincas (ver farm.ts). */
export type Crop = 'secano' | 'regadio' | 'olivar' | 'vinedo';

/** Obra en curso: necesita obreros × días. */
export interface Project {
  buildingId: number;
  /** Quién paga la mano de obra: 0 ayuntamiento, -1 inversor de fuera. */
  payer: number;
  workersNeeded: number;
  workerDaysNeeded: number;
  workerDaysDone: number;
  /** Ids de vecinos trabajando hoy en la obra. */
  crew: number[];
  /** Obreros de fuera contratados hoy. */
  outsideToday: number;
  notify: boolean;
  /** 2.2: oferta de la licitación (sin definir = local, la de siempre). */
  offer?: 'local' | 'fuera' | 'primo';
}

export interface Citizen {
  /** 2.4: mayor atendido en la residencia o cuidado en casa por un hijo (care.ts). */
  care?: 'residencia' | 'casa';
  /** Ronda 20: última vez que buscó trabajo fuera en autobús (una vez al mes). */
  busSearch?: number;
  id: number;
  name: string;
  age: number;
  /** Euros enteros; nunca negativo. */
  money: number;
  homeId: number | null;
  /** Edificio donde trabaja, o null. */
  jobId: number | null;
  /** 0–100, con inercia. */
  happiness: number;
  /** Mes en que llegó. */
  arrivedMonth: number;
  /** Vecino con nombre: decide con IA (Modo IA) o con reglas narrativas. */
  named: boolean;
  /** Rasgos fijos 0–100. `terco` es la terquedad o irracionalidad. */
  traits: Traits;
  desire: Desire;
  fear: Fear;
  /** Profesión (de una lista del motor). */
  profession: string;
  /** Meta personal (derivada de su deseo). */
  goal: Goal;
  /** Relaciones con nombre (amistad, rivalidad, pareja, rencor). */
  relations: Relation[];
  /** Recuerdos (capa 2): plantillas del motor, máx. 5, por importancia. */
  memories: Memory[];
  /** Resumen narrativo (capa 3), se reescribe cada mes. */
  summary: string;
  /** No se le vuelve a preguntar antes de este tick. */
  cooldownUntil: number;
  /** Es dueño de la vivienda en la que vive. */
  owns: boolean;
  /** Precio al que la compró (para la plusvalía). */
  boughtPrice: number;
  /** Lo que le queda por pagar de hipoteca. */
  mortgage: number;
  /** A quién se la paga: 0 = ayuntamiento (vivienda municipal), -1 = banco. */
  mortgageTo: number;
  /** Su vivienda fue municipal: la reventa tiene precio máximo. */
  subsidized: boolean;
  /** v1.5: hijos que viven en casa (tick de nacimiento); a los 18 se independizan. */
  kids?: number[];
  /** Tick en que compró (no se revende con ganancia antes de 90 días). */
  boughtTick: number;
  /** Memoria de las subidas de impuestos (0–40): resta felicidad y se olvida despacio. */
  grudge: number;
  /** Voto decidido antes de las elecciones (solo vecinos con nombre; se borra al votar). */
  vote?: 'gobierno' | 'oposicion' | 'abstencion';
  /** v1.7: padres (si nació en el pueblo), para el árbol genealógico. */
  parents?: number[];
  /** v1.7: decisión sobre la manifestación de la asociación `id`: `id` si va, `-id` si no. */
  protest?: number;
  /** v1.9: lo que debe (al ayuntamiento y al banco o casero). Ver household.ts. */
  debt?: CitizenDebt;
  /** v1.9: ingresos y gastos del mes en curso [entra, sale] (los anota transfer). */
  flow?: [number, number];
  /** v1.9: el mes pasado: lo que entró, salió y devolvió de deudas. */
  last?: { in: number; out: number; repaid: number; owed?: number; grew?: number };
  /** v1.9: antecedentes penales (ladrones del pueblo). */
  record?: number;
  /** v1.9: meses seguidos sin pagar todo el alquiler privado / la hipoteca. */
  rentArrears?: number;
  missedQuotas?: number;
  /** v1.9: en paro (sin trabajo ni en el pueblo ni fuera): desde qué tick, y meses de prestación que le quedan. */
  unemployedSince?: number;
  benefitLeft?: number;
  /** v1.9: última vez que decidió qué hacer con sus deudas (tick). */
  debtAsked?: number;
  /** v1.9: tras un desahucio, nadie le alquila hasta este tick; tras un embargo, no puede comprar hasta este tick. */
  evictedUntil?: number;
  seizedUntil?: number;
  /** v1.9 (ronda 15): tras cerrar su negocio, no abre otro hasta este tick. */
  closedUntil?: number;
  /** 2.0: lo que decide la IA en cada turno (actitud hacia el alcalde −2…2, dónde gasta, su plan y lo que piensa). */
  attitude?: number;
  spending?: { where: 'pueblo' | 'fuera' | 'ahorrar'; shop?: number; leisure: boolean };
  plan?: { kind: 'irse_si_no' | 'protestar_si_no' | 'votar_en_contra_si_no'; need: string; until: number; since: number };
  thought?: string;
  /** 2.0: lo que el propio vecino (la IA) apunta de cada semana; lo lee la semana siguiente. */
  notes?: { tick: number; text: string }[];
  /** 2.2: su biografía, que la IA reescribe una vez al mes (si no, `narrativeSummary`). */
  bio?: { text: string; tick: number };
  /** 2.1: voluntario de protección civil. */
  volunteer?: boolean;
  /** 2.2: se ha apuntado de temporero para la cosecha (tick en que se apuntó). */
  temporero?: number;
}

export interface CitizenDebt {
  /** Con el ayuntamiento (impuestos, tasas, alquiler municipal, multas, microcréditos). */
  town: number;
  /** Con el banco o el casero (de fuera). */
  bank: number;
  /** Desde cuándo debe (tick). */
  since: number;
  /** Deuda con el ayuntamiento nacida este mes y el anterior (para el recargo único). */
  fresh: number;
  aged: number;
  /** Aplazamiento concedido por el alcalde: cuota fija sin recargo hasta `until`. */
  plan?: { perMonth: number; until: number; kind?: 'aplazamiento' | 'microcredito' };
  /** v1.9.1: cuándo pidió al alcalde un aplazamiento (tick) que aún no tiene respuesta. */
  askedAt?: number;
}

export type TaxKey = 'ibi' | 'tasas' | 'plusvalia';

export interface Traits {
  terco: number;
  ahorro: number;
  social: number;
  ambicion: number;
}

export const DESIRES = ['trabajo_cerca', 'casa_propia', 'parque', 'tienda', 'tranquilidad', 'prosperar'] as const;
export type Desire = (typeof DESIRES)[number];
export const FEARS = ['paro', 'impuestos', 'soledad', 'ruido', 'deudas'] as const;
export type Fear = (typeof FEARS)[number];

/** Decisión pendiente de un vecino con nombre (detonante + acciones válidas). */
export interface Pending {
  citizenId: number;
  trigger: Trigger;
  actions: string[];
  createdTick: number;
  /** Si a este tick no ha llegado decisión (IA), decide la regla. */
  dueTick: number;
}

export type Trigger = 'llegada' | 'sin_trabajo' | 'infeliz' | 'subida_impuestos' | 'ahorros' | 'opinion' | 'comprar_casa' | 'emprender' | 'elecciones' | 'protesta' | 'deudas';

export interface DecisionLogEntry {
  tick: number;
  citizenId: number;
  trigger: Trigger;
  action: string;
  motivo: string;
  source: 'ai' | 'rule';
}

export type EventKind =
  | 'arrival'
  | 'departure'
  | 'built'
  | 'project'
  | 'bankrupt'
  | 'business'
  | 'tax'
  | 'decision'
  | 'milestone'
  | 'warning'
  | 'politics'
  | 'election'
  /** v1.7: manifestación ante el ayuntamiento (ref = id de la asociación). */
  | 'protest'
  /** v1.8: robos, detenciones y disturbios. */
  | 'crime'
  /** 2.1: riesgos, incendios y urgencias (ref = edificio, o vecino en las urgencias). */
  | 'fire'
  | 'info';

export interface GameEvent {
  tick: number;
  kind: EventKind;
  text: string;
  /** Edificio o vecino relacionado (para centrar la cámara). */
  ref?: number;
  /** El jugador pidió aviso. */
  notify?: boolean;
}

export interface MonthStat {
  month: number;
  population: number;
  treasury: number;
  happiness: number;
  income: number;
  expenses: number;
  /** Desglose del mes (por concepto). */
  breakdown: Record<string, number>;
  /** v1.9: impagos al ayuntamiento del mes, lo que le deben al cerrar, vecinos con deudas y en paro. */
  unpaid?: number;
  owed?: number;
  debtors?: number;
  jobless?: number;
  /** v1.9: salud de las empresas: margen medio, cuántas pierden dinero y sueldo medio en el pueblo. */
  margin?: number;
  losing?: number;
  wage?: number;
  businesses?: number;
  closures?: number;
  layoffs?: number;
}

export interface GameState {
  formatVersion: number;
  seed: number;
  rng: RngState;
  /** Horas de juego transcurridas. */
  tick: number;
  /** terrain (v1.7): 0 llano, 1 río, 2 mar, 3 colina (ver terrain.ts). */
  /** 2.5: `density` = densidad de cada casilla de zona R (0 baja, 1 media, 2 alta; density.ts). */
  map: { w: number; h: number; tiles: number[]; zones: number[]; terrain: number[]; density?: number[] };
  /** Caja del ayuntamiento. Negativa = deuda municipal. */
  treasury: number;
  taxLevel: TaxLevel;
  citizens: Citizen[];
  buildings: Building[];
  projects: Project[];
  nextId: number;
  /** Contabilidad para la invariante de conservación del dinero. */
  ledger: { initialTotal: number; externalIn: number; externalOut: number };
  /** Acumuladores del mes en curso (se vuelcan a stats). */
  month: {
    income: number;
    expenses: number;
    breakdown: Record<string, number>;
    /** v1.9: lo que los vecinos no han podido pagar al ayuntamiento este mes, y lo que se da por perdido. */
    unpaid?: number;
    writtenOff?: number;
    /** Ronda 15: empresas que cerraron y despidos de este mes. */
    closures?: number;
    layoffs?: number;
    /** Suma diaria de los tipos: el tipo efectivo del mes es la media. */
    rateSums: Record<TaxKey, number>;
    taxDays: number;
  };
  /** Demanda RCI de -100 a 100 (se recalcula cada día). */
  demand: { R: number; C: number; I: number };
  /** Meses seguidos con deuda por encima del límite. */
  debtMonths: number;
  bankrupt: boolean;
  events: GameEvent[];
  stats: MonthStat[];
  /** Modo IA: las decisiones de los vecinos con nombre pueden venir del LLM. */
  aiMode: boolean;
  /** Máximo de vecinos con nombre. */
  namedLimit: number;
  pending: Pending[];
  decisionLog: DecisionLogEntry[];
  /** Nivel de impuestos al cerrar el día anterior (detonante de subidas). */
  prevTaxLevel: TaxLevel;
  /** Tributos separados (activos desde 50 vecinos). */
  taxes: Record<TaxKey, TaxLevel>;
  taxesSplit: boolean;
  prevTaxes: Record<TaxKey, TaxLevel>;
  /** Externalidades por casilla. */
  fields: Fields;
  /** Director de historias: ganchos activos. */
  hooks: Hook[];
  pleno: Pleno | null;
  promises: PromiseRecord[];
  lastPlenoTick: number;
  objectivesDone: string[];
  /** Edificios desbloqueados por hitos (plaza, mercado). */
  unlocked: string[];
  /** Elecciones, facciones y oposición (v1.0). */
  politics: Politics;
  /** v1.5: presupuesto del año, fiestas del pueblo y subvenciones de la Diputación. */
  budget: Budget;
  festival: Festival;
  grants: Grant[];
  /** v1.7: tiempo de hoy y hasta cuándo dura. */
  weather: Weather;
  /** v1.7: asociaciones vecinales. */
  associations: Association[];
  /** v1.7: momentos del álbum y fichas de quien ya no está (árbol genealógico). */
  album: Moment[];
  departed: Departed[];
  /** v1.8: nivel del ayuntamiento (1–5): desbloquea edificios y partes del juego. */
  townhallLevel: number;
  /** 2.0: turnos del pueblo con IA (solo en Modo IA). */
  ai?: TownAi;
  /** 2.1: encargos del pueblo y El Eco de Bitópolis. */
  errands?: ErrandsState;
  press?: PressState;
  /** v1.9: sueldo mínimo obligatorio para las empresas del pueblo. */
  minWage: MinWageLevel;
  /** v1.9: contabilidad de la deuda de los vecinos (conservación: deuda viva = altas − pagos − incobrables − perdonadas). */
  debtLedger: { created: number; repaid: number; written: number; forgiven: number };
  /** v1.8: calabozos, cárcel y robos. */
  justice: Justice;
  /** Última despedida (como mucho una por semana). */
  lastDeathTick?: number;
  /** 2.1: basura. `start`: desde qué tick se acumula (−1: aún no); `graceUntil`: gracia de las partidas migradas; `warned`: último aviso de ratas. */
  trash?: { start: number; graceUntil?: number; warned?: number };
  /** 2.1: rango del pueblo (aldea → capital comarcal) y su escudo (rank.ts). */
  rank?: TownRank;
  /** 2.1: diques (índices de casilla) y contadores de emergencias. */
  dikes: number[];
  emergencies: Emergencies;
  /** 2.2: licitaciones de obras (las últimas; ver tenders.ts) y calles con nombre (streets.ts). */
  tenders?: Tender[];
  streetNames?: StreetName[];
  /** 2.2: préstamos municipales (loans.ts), nota de las cuentas y contabilidad (Σ left = lent − repaid). */
  loans: Loan[];
  rating: Rating;
  loanLedger: LoanLedger;
  /** 2.3: grandes obras, turismo, escenario, ciclo comarcal y gran empresa. */
  landmarks: Landmark[];
  tourism: Tourism;
  scenario: Scenario;
  region: Region;
  bigCompany: BigCompany | null;
  /** 2.3: historia por años, récords y medallas. */
  history: YearStat[];
  records: Records;
  medals: Medal[];
  /** 2.4: cuotas de la guardería y la residencia (care.ts). */
  care: CareState;
  /** 2.4: billete del autobús (transit.ts). */
  transit: TransitState;
  /** 2.4: dilemas abiertos y resueltos (dilemmas.ts). */
  dilemmas: Dilemma[];
  /** 2.4: fiestas de temporada (seasons.ts); las patronales siguen en `festival`. */
  seasons: SeasonsState;
  /** 2.5: cooperativa agraria (coop.ts). */
  coop: CoopState;
  /** 2.5: cartas de los que se fueron (post.ts). */
  letters: Letter[];
  /** 2.5: los pueblos vecinos de la comarca (comarca.ts). */
  comarca: ComarcaState;
  /** 2.3: lo que necesitan recordar los logros entre meses (achievements.ts); se crea al primer cierre de mes. */
  medalTrack?: MedalTrack;
}

/** 2.2: nota de las cuentas del ayuntamiento (A la mejor). */
export type Rating = 'A' | 'B' | 'C' | 'D';

/** 2.2: un préstamo vivo (los devueltos se quitan). Importes enteros. */
export interface Loan {
  id: number;
  /** Lo que se prestó (en los de tesorería, la suma de los huecos refinanciados). */
  principal: number;
  /** Lo que queda por devolver (sin intereses). */
  left: number;
  /** Cuota fija mensual (capital + intereses). */
  quota: number;
  /** Interés mensual. */
  rate: number;
  monthsLeft: number;
  kind: 'banco' | 'tesoreria';
  tick: number;
}

export interface LoanLedger {
  /** Capital prestado y devuelto desde el principio. */
  lent: number;
  repaid: number;
  /** Intereses y comisiones pagados. */
  interest: number;
  /** Ticks de los préstamos de tesorería de los últimos 12 meses (para la nota). */
  treasuryTicks: number[];
}

export interface Emergencies {
  /** Incendios, los que apagaron los bomberos a tiempo y urgencias que salvó la ambulancia. */
  fires: number;
  putOut: number;
  saved: number;
  /** Riadas que no llegaron a pasar por la protección civil o un dique. */
  floodsAvoided: number;
  /** 2.3: riadas (el río se desbordó o lo frenaron los diques) para los logros. */
  floods?: number;
  /** Último susto del director por vecino (para no repetirlo). */
  scares?: Record<number, number>;
}

export type BudgetPlan = 'austero' | 'equilibrado' | 'inversor';
export interface Budget {
  year: number;
  /** El plan en vigor (el aprobado o, si no, el prorrogado). */
  plan: BudgetPlan;
  /** open: enero, por aprobar; approved; prorrogado (rechazado o sin presentar). */
  status: 'open' | 'approved' | 'prorrogado';
  votesFor: number;
  votesAgainst: number;
}
export interface Festival {
  /** Nombre que le pusieron los vecinos (la primera vez). */
  name: string | null;
  /** Último año con fiestas. */
  year: number;
  size: 'none' | 'pequena' | 'grande' | 'popular';
  /** Mientras dure el buen recuerdo de las fiestas. */
  until: number;
}
export interface Grant {
  id: number;
  kind: BuildingKind;
  /** Parte del coste que paga la Diputación (0–1). */
  share: number;
  offeredTick: number;
  deadline: number;
  status: 'offered' | 'accepted' | 'paid' | 'expired' | 'declined';
  advance: number;
  /** Solo cuentan las obras empezadas después de aceptar (ids desde aquí). */
  minId: number;
  /** 2.3: cofinanciación de una gran obra (id del `Landmark`; se paga por fase). */
  landmark?: number;
  /** 2.3: fondos europeos (FEDER) en tiempo de crisis comarcal. */
  feder?: boolean;
  /** 2.3: ayuda de emergencia del escenario «Tras la riada» (total en €; la cobra y la reintegra scenarios.ts). */
  emergency?: number;
  /** 2.3: a qué va el FEDER: las fases de la estación (`kind: 'station'`) o las reparaciones. */
  federFor?: 'station' | 'repair';
}

/**
 * 2.3: gran obra por fases (landmarks.ts). Cada fase es un `Project` del
 * edificio `buildingId`; entre fases puede quedarse parada sin perder nada.
 */
export interface Landmark {
  id: number;
  kind: LandmarkKind;
  buildingId: number;
  /** Fases terminadas (0…phases); cada una ya da su parte del efecto. */
  phase: number;
  phases: number;
  /** Fin previsto de la fase en obra (tick), o −1 si no hay ninguna en marcha. */
  phaseUntil: number;
  /** Lo que lleva gastado el ayuntamiento (el mantenimiento es un % de esto). */
  spent: number;
  /** Subvención que la cofinancia (`Grant.landmark`). */
  grantId?: number;
  /** Parada por el alcalde entre fases. */
  paused?: boolean;
  /** Rebaja de la fase siguiente (voluntarios, 0–1). */
  discount?: number;
  /** 2.3 (director): fase en la que ya ayudaron los voluntarios y en la que ya hubo polémica (una vez por fase). */
  helped?: number;
  polemic?: number;
}

/** 2.3: turismo (tourism.ts). `tax` en € por noche; `protectedId`: patrimonio con entorno protegido. */
export interface Tourism {
  /** Visitantes del mes pasado y lo que dejaron (casas rurales y tasa). */
  visitors: number;
  lastIncome: number;
  tax: 0 | 1 | 2;
  protectedId?: number;
  /** De lo que dejaron: tasa (al ayuntamiento) y casas rurales (a sus dueños). */
  lastTax?: number;
  lastRural?: number;
  /** Media de visitantes del último año (media móvil): decide si abre otra casa rural. */
  avg?: number;
  /** IA (director): reportaje de la tele y turistas ruidosos, hasta este tick. */
  tvUntil?: number;
  noiseUntil?: number;
}

/** 2.3: escenario de la partida (scenarios.ts). Al cumplirse (o al vencer) queda `done` y sigue como Libre. */
export interface Scenario {
  id: ScenarioId;
  /** Meta medible: superávit (meses seguidos), vecinos o reparar lo destrozado (y llegar a `target` vecinos). */
  goal?: { kind: 'superavit' | 'vecinos' | 'reparar'; target: number; progress?: number };
  /** Tick límite para cumplirla. */
  deadline?: number;
  done: boolean;
  /** Se cumplió (si no, venció sin cumplirse). */
  won?: boolean;
}

/** 2.3: ciclo comarcal (region.ts): bonanza, normal o crisis hasta `until`; `warned`: ya se avisó del cambio. */
export interface Region {
  phase: 'normal' | 'bonanza' | 'crisis';
  until: number;
  warned: boolean;
  /** Fase que viene (se decide al avisar, 2 meses antes). */
  next?: 'normal' | 'bonanza' | 'crisis';
}

/** 2.3: la gran empresa (region.ts): primero una oferta; si se acepta, su fábrica 2×2. */
export interface BigCompany {
  /** Nombre generado por el motor («Conservas del Norte»). */
  name: string;
  status: 'oferta' | 'abierta' | 'rechazada' | 'ere' | 'se_va' | 'cerrada';
  offeredTick: number;
  /** Hasta cuándo vale la oferta (tick). */
  deadline: number;
  incentive?: BigCompanyIncentive;
  /** Fábrica (`bigfactory`) cuando ya está. */
  buildingId?: number;
  jobs: number;
  /** Aviso de ERE o deslocalización: pasa en este tick. */
  warnUntil?: number;
}

/** 2.3: mínimo, media y máximo de una serie a lo largo de un año. */
export interface MinAvgMax {
  min: number;
  avg: number;
  max: number;
}

/**
 * 2.3: resumen anual (sin tope, a diferencia de `stats`). Un elemento por año
 * con algún mes cerrado; el del año en curso se actualiza al cerrar cada mes.
 */
export interface YearStat {
  year: number;
  /** Meses que resume (12 en los años cerrados). */
  months: number;
  population: MinAvgMax;
  treasury: MinAvgMax;
  happiness: MinAvgMax;
  jobless: MinAvgMax;
  businesses: MinAvgMax;
  visitors: MinAvgMax;
}

export type RecordKey = 'population' | 'treasury' | 'happiness' | 'businesses' | 'visitors' | 'income';
/** 2.3: récords del pueblo (máximo y cuándo). */
export type Records = Partial<Record<RecordKey, { v: number; tick: number }>>;

/** 2.3: medalla conseguida (achievements.ts). */
export interface Medal {
  id: string;
  tick: number;
}

/** 2.3: memoria de los logros (achievements.ts): lo que no se puede leer del estado de un solo mes. */
export interface MedalTrack {
  /** Último aviso de récord (tick). */
  lastRecord?: number;
  /** Promesas cumplidas ya contadas (ids; `state.promises` solo guarda las 30 últimas). */
  kept?: number[];
  /** Presupuestos aprobados seguidos hasta `year`. */
  budget?: { year: number; streak: number };
  /** Crisis comarcal en curso (cierres de empresas durante ella) y crisis superadas sin cierres. */
  crisis?: { closures: number } | null;
  cleanCrises?: number;
  /** Grandes obras que se pararon alguna vez. */
  paused?: number[];
  /** Meses seguidos con el entorno protegido y sin turistificar. */
  protectedMonths?: number;
}

export interface NewGameOptions {
  seed: number;
  aiMode?: boolean;
  namedLimit?: number;
  /** 2.0: % de vecinos con IA (Modo IA). */
  aiShare?: number;
  /** 2.3: escenario (por defecto, Libre) y forma del terreno (por defecto, aleatorio: lo de siempre). */
  scenario?: ScenarioId;
  terrain?: TerrainShape;
}

export const INITIAL_SUBSIDY = 30_000;

export function createInitialState({ seed, aiMode = false, namedLimit = 20, aiShare = 50, scenario = 'libre', terrain: shape = 'aleatorio' }: NewGameOptions): GameState {
  const rng = seedRng(seed);
  const tiles = new Array<number>(MAP_W * MAP_H).fill(Tile.Grass);
  const zones = new Array<number>(MAP_W * MAP_H).fill(Zone.None);
  // v1.7: río, costa y colinas (el centro queda en llano). 2.3: con forma elegida; tras la riada, siempre con río.
  const terrain = generateTerrain(rng, MAP_W, MAP_H, shape, { river: scenario === 'riada' });
  const state: GameState = {
    formatVersion: FORMAT_VERSION,
    seed,
    rng,
    tick: 0,
    map: { w: MAP_W, h: MAP_H, tiles, zones, terrain },
    treasury: 0,
    taxLevel: 'medium',
    citizens: [],
    buildings: [],
    projects: [],
    nextId: 1,
    ledger: { initialTotal: 0, externalIn: 0, externalOut: 0 },
    month: { income: 0, expenses: 0, breakdown: {}, rateSums: { ibi: 0, tasas: 0, plusvalia: 0 }, taxDays: 0 },
    demand: { R: 50, C: 0, I: 10 },
    debtMonths: 0,
    bankrupt: false,
    events: [],
    stats: [],
    aiMode,
    namedLimit,
    pending: [],
    decisionLog: [],
    prevTaxLevel: 'medium',
    taxes: { ibi: 'medium', tasas: 'medium', plusvalia: 'medium' },
    taxesSplit: false,
    prevTaxes: { ibi: 'medium', tasas: 'medium', plusvalia: 'medium' },
    fields: emptyFields(MAP_W * MAP_H),
    hooks: [],
    pleno: null,
    promises: [],
    lastPlenoTick: -1,
    objectivesDone: [],
    unlocked: [],
    politics: emptyPolitics(),
    budget: { year: 1, plan: 'equilibrado', status: 'approved', votesFor: 0, votesAgainst: 0 },
    festival: { name: null, year: 0, size: 'none', until: 0 },
    grants: [],
    weather: { kind: 'sol', until: 2 * 24 },
    associations: [],
    album: [],
    departed: [],
    justice: { cells: [], jail: [], hot: [], robberies: 0, arrests: 0, fullWarned: -1 },
    townhallLevel: 1,
    // 2.0: turnos del pueblo con IA (en línea: turns.ts importa este módulo).
    ...(aiMode
      ? { ai: { share: Math.max(0, Math.min(100, Math.round(aiShare))), paceDays: 7, turn: null, lastN: 0, next: 7 * TICKS_PER_DAY, mayor: [], quick: null, lastQuick: -1e9, log: [] } }
      : {}),
    minWage: 'none',
    debtLedger: { created: 0, repaid: 0, written: 0, forgiven: 0 },
    // 2.1: encargos (el primero, a los 10 días) y periódico.
    errands: { list: [], recent: [], medals: 0, done: 0, failed: 0, nextOffer: 10 * TICKS_PER_DAY },
    press: { editions: [], last: 0 },
    dikes: [],
    emergencies: { fires: 0, putOut: 0, saved: 0, floodsAvoided: 0 },
    rank: emptyRank(seed, terrain),
    trash: { start: -1 },
    streetNames: [],
    loans: [],
    rating: 'B',
    loanLedger: { lent: 0, repaid: 0, interest: 0, treasuryTicks: [] },
    // 2.3: metas grandes (el escenario lo prepara `applyScenario` al final).
    landmarks: [],
    tourism: { visitors: 0, lastIncome: 0, tax: 0 },
    scenario: { id: scenario, done: scenario === 'libre' },
    region: { phase: 'normal', until: REGION.firstMonths * TICKS_PER_MONTH, warned: false },
    bigCompany: null,
    history: [],
    records: {},
    medals: [],
    care: { nurseryFee: 'normal', residenceFee: 'normal' },
    transit: { fare: 'normal' },
    dilemmas: [],
    seasons: { current: null, held: {} },
    coop: { members: [], presidentId: null },
    letters: [],
    comarca: { towns: [], offers: [], fair: null },
  };
  // Árboles dispersos (se talan gratis al construir encima).
  for (let i = 0; i < tiles.length; i++) {
    if (isWater(terrain[i])) continue;
    if (chance(rng, terrain[i] === Terrain.Hill ? 0.22 : 0.07)) tiles[i] = Tile.Tree;
  }
  const cx = Math.floor(MAP_W / 2);
  const cy = Math.floor(MAP_H / 2);
  // Calle inicial delante del ayuntamiento.
  for (let x = cx - 3; x <= cx + 3; x++) tiles[cy * MAP_W + x] = Tile.Road;
  const hall = newBuilding(state, 'townhall', cx, cy - 1, 0);
  hall.built = true;
  tiles[hall.y * MAP_W + hall.x] = Tile.Grass;
  // Despejar alrededor del centro para que el comienzo sea legible.
  for (let y = cy - 2; y <= cy + 2; y++) {
    for (let x = cx - 4; x <= cx + 4; x++) if (tiles[y * MAP_W + x] === Tile.Tree) tiles[y * MAP_W + x] = Tile.Grass;
  }
  const first: Citizen = {
    id: state.nextId++,
    name: 'Lucía',
    age: 34,
    money: 1_500,
    homeId: null,
    jobId: hall.id,
    happiness: 60,
    arrivedMonth: 0,
    named: true,
    traits: randomTraits(rng),
    desire: 'prosperar',
    fear: 'paro',
    cooldownUntil: 0,
    ...NO_PROPERTY,
    profession: 'administrativa',
    goal: 'ahorrar',
    relations: [],
    memories: [{ tick: 0, kind: 'llego', about: [], importance: 2, valence: 0 }],
    summary: '',
  };
  state.citizens.push(first);
  state.treasury = INITIAL_SUBSIDY;
  state.ledger.initialTotal = INITIAL_SUBSIDY + first.money;
  pushEvent(state, 'info', 'La región aporta una subvención inicial de 30.000 €');
  // 2.3: escenario (Libre no cambia nada).
  applyScenario(state);
  return state;
}

export function newBuilding(state: GameState, kind: BuildingKind, x: number, y: number, owner: number): Building {
  const b: Building = {
    id: state.nextId++,
    kind,
    x,
    y,
    owner,
    cash: 0,
    built: false,
    hasWater: false,
    hasPower: false,
    unpaidMonths: 0,
  };
  state.buildings.push(b);
  return b;
}

export function tileIndex(state: GameState, x: number, y: number): number {
  return y * state.map.w + x;
}

export function inBounds(state: GameState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.map.w && y < state.map.h;
}

/** 2.3: lado del edificio en casillas (1, o 2 en las grandes obras 2×2). */
export function sizeOf(b: { x: number; y: number; size?: number }): number {
  return b.size ?? 1;
}

/**
 * 2.3: ¿ocupa el edificio la casilla (x, y)? Un edificio 2×2 se ancla en su
 * casilla (x, y) y ocupa también las 3 de la derecha y de abajo. Es el único
 * sitio donde se decide: úsalo en vez de comparar `b.x === x && b.y === y`.
 */
export function occupies(b: { x: number; y: number; size?: number }, x: number, y: number): boolean {
  const n = b.size ?? 1;
  return x >= b.x && y >= b.y && x < b.x + n && y < b.y + n;
}

/** 2.3: casillas que ocupa un edificio (la del ancla primero). */
export function footprint(b: { x: number; y: number; size?: number }): [number, number][] {
  const n = b.size ?? 1;
  const out: [number, number][] = [];
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) out.push([b.x + dx, b.y + dy]);
  return out;
}

export function buildingAt(state: GameState, x: number, y: number): Building | undefined {
  return state.buildings.find((b) => occupies(b, x, y));
}

export function buildingById(state: GameState, id: number): Building | undefined {
  return state.buildings.find((b) => b.id === id);
}

export function pushEvent(
  state: GameState,
  kind: EventKind,
  text: string,
  extra: { ref?: number; notify?: boolean } = {},
): void {
  state.events.push({ tick: state.tick, kind, text, ...extra });
  if (state.events.length > 200) state.events.splice(0, state.events.length - 200);
}

export const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function hasAdjacentRoad(state: GameState, x: number, y: number): boolean {
  return DIRS.some(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    return inBounds(state, nx, ny) && state.map.tiles[tileIndex(state, nx, ny)] === Tile.Road;
  });
}

export function randomTraits(rng: RngState): Traits {
  return { terco: nextInt(rng, 0, 100), ahorro: nextInt(rng, 0, 100), social: nextInt(rng, 0, 100), ambicion: nextInt(rng, 0, 100) };
}

export const NO_PROPERTY = { owns: false, boughtPrice: 0, mortgage: 0, mortgageTo: -1, subsidized: false, boughtTick: 0, grudge: 0 } as const;

/** Terreno de una casilla (v1.7). */
export function terrainAt(state: GameState, x: number, y: number): number {
  return state.map.terrain?.[y * state.map.w + x] ?? 0;
}

/* ---------------- 2.4 «Vida» ---------------- */

export type FeeLevel = 'gratis' | 'reducida' | 'normal';
export interface CareState {
  nurseryFee: FeeLevel;
  residenceFee: FeeLevel;
  /** Ronda 20: plazas de más en la residencia (ampliada desde un dilema). */
  extraPlaces?: number;
}

export type BusFare = 'gratis' | 'normal' | 'caro';
export interface TransitState {
  fare: BusFare;
  /** Usuarios del autobús el mes pasado (para el billete y la ficha). */
  riders?: number;
}

export type DilemmaKind = 'ultima_plaza_residencia' | 'familia_con_deudas' | 'fabrica_vierte' | 'preso_arrepentido';
export interface Dilemma {
  id: number;
  kind: DilemmaKind;
  /** Cuándo se abrió y hasta cuándo se puede decidir (luego, «no decidir»). */
  tick: number;
  until: number;
  /** Vecinos y edificio implicados (datos reales del motor). */
  citizenIds: number[];
  buildingId?: number;
  /** Opciones que ofrece el motor (ids de `DILEMMA`); la IA nunca las escribe. */
  options: string[];
  /** La elegida (o 'no_decidir') cuando se cierra. */
  resolved?: string;
  /** Presentación del director (IA), validada; sin ella, la del motor. */
  intro?: string;
  /** Ronda 20: ya se avisó de que quedan 2 días. */
  reminded?: boolean;
  /** Cuándo se cerró (para la reacción rápida de los afectados). */
  closed?: number;
}

export type FestivalSeason = 'romeria' | 'sanjuan' | 'patronales' | 'navidad';
export type FestivalBudget = 'nada' | 'poco' | 'todo';
export interface SeasonFestival {
  season: FestivalSeason;
  year: number;
  /** comision: se prepara (un mes antes); aprobada; celebrada; cancelada. */
  status: 'comision' | 'aprobada' | 'celebrada' | 'cancelada';
  committee: number[];
  program: string[];
  budget: FestivalBudget | null;
  /** Bloque E: cuándo se abrió la comisión, hasta cuándo pueden apuntarse los vecinos con IA y el día de la fiesta (ticks). */
  opened?: number;
  joinUntil?: number;
  day?: number;
  /** Quién eligió el programa (la IA del líder o las reglas) y si ya se pidió el presupuesto. */
  programBy?: 'ia' | 'reglas';
  asked?: boolean;
  /** Al celebrarse: actos que se hicieron, ánimo y ruido, hasta cuándo se nota, y quién pagó. */
  held?: string[];
  mood?: number;
  noise?: number;
  until?: number;
  paid?: { town: number; collected: number };
  /** Sin respuesta del alcalde a tiempo. */
  silent?: boolean;
}
export interface SeasonsState {
  current: SeasonFestival | null;
  /** Último año en que se celebró cada fiesta. */
  held: Partial<Record<FestivalSeason, number>>;
}

/* ---------------- 2.5 «Comarca» ---------------- */

export interface CoopState {
  /** Socios (vecinos con finca). */
  members: number[];
  presidentId: number | null;
  /** Lo repartido el último año (para la ficha). */
  lastShare?: number;
}

export interface Letter {
  id: number;
  /** Quién escribe (ficha de `departed`) y a quién (vecino del pueblo). */
  from: number;
  to: number;
  tick: number;
  /** Plantilla del motor (el texto con IA queda en la caché del servidor). */
  template: string;
  read?: boolean;
}

export type NeighborSpecialty = 'campo' | 'industria' | 'turismo' | 'servicios';
export type NeighborPersonality = 'cooperador' | 'competidor' | 'populista' | 'prudente';
export interface NeighborTown {
  id: number;
  name: string;
  pop: number;
  happiness: number;
  treasury: number;
  specialty: NeighborSpecialty;
  mayor: { name: string; faction: string; personality: NeighborPersonality };
  /** −2 (mala) … 2 (muy buena). */
  relation: number;
  /** Última declaración (validada o por plantilla). */
  said?: string;
  /** Quién la escribió (la IA del alcalde o las plantillas) y cuándo. */
  saidBy?: 'ia' | 'reglas';
  saidTick?: number;
  /** Lo último que hizo el alcalde (acción del menú). */
  lastAct?: string;
  /** Bajada de impuestos en vigor hasta este tick (más atractivo). */
  taxCutUntil?: number;
  /** Veces que ha pedido a la Diputación desde el último reparto. */
  grantClaims?: number;
  /** Está río abajo (le llega el río del pueblo). */
  downstream?: boolean;
}
export type NeighborOfferKind = 'agua' | 'luz' | 'autobus' | 'cosecha';
export interface NeighborOffer {
  id: number;
  townId: number;
  kind: NeighborOfferKind;
  tick: number;
  until: number;
  resolved?: 'accepted' | 'rejected' | 'expired';
  /** Acuerdo aceptado: en vigor hasta este tick. */
  dealUntil?: number;
}
export interface ComarcaState {
  towns: NeighborTown[];
  offers: NeighborOffer[];
  /** Feria comarcal de este año (en qué pueblo, 0 = el nuestro). */
  fair: { year: number; host: number } | null;
  /** Modo IA: turno mensual de los alcaldes abierto (mes de juego y vencimiento). */
  turn?: { month: number; due: number };
  /** El pueblo de abajo ya se quejó del río (se avisa una vez hasta que mejora). */
  riverAngry?: boolean;
  /** Último ganador del premio de la feria (0 = el nuestro). */
  lastPrize?: { year: number; town: number };
}
