import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { rememberDeparted } from './family.ts';
import { CAMPAIGN_MONTHS, GRUDGE_MAX, PLENO_TALK, TRASH } from './balance.ts';
import { directorOwns } from './director-core.ts';
import { BUILD_NAMES } from './commands.ts';
import { canFound, freeShopLot, saturated, taxLevels } from './economy.ts';
import { hash32 } from './hash.ts';
import { radiusOf } from './levels.ts';
import { isFemaleName } from './names.ts';
import { leaveTown } from './household.ts';
import { streetCandidates } from './streets.ts';
import { tendersForget } from './tenders.ts';
import { OUTSIDE, ownIncome, TREASURY, transfer } from './money.ts';
import { chance, pick } from './prng.ts';
import type { Building, Citizen, GameState } from './state.ts';
import type { Faction } from './politics-core.ts';
import { pushEvent } from './state.ts';
import type { Goal } from './social-core.ts';

/**
 * Vida social (v0.4): relaciones, memoria en 3 capas, director de historias,
 * plenos con promesas, objetivos e hitos. Todo son datos del motor: la IA
 * solo redacta; nunca escribe en la memoria ni crea relaciones.
 */

/* ---------------- tipos ---------------- */

export const RELATION_KINDS = ['amistad', 'rivalidad', 'pareja', 'rencor'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];
export interface Relation {
  id: number;
  kind: RelationKind;
  strength: number;
  since: number;
}

export const MEMORY_KINDS = [
  'llego',
  'compro_casa',
  'abrio_negocio',
  'perdio_trabajo',
  'se_fue_amigo',
  'promesa_cumplida',
  'promesa_rota',
  'peticion_rechazada',
  'hablo_con_alcalde',
  'subida_impuestos',
  'nueva_amistad',
  'nueva_pareja',
  'le_quitaron_el_local',
  'fundo_partido',
  'voto',
  'gano_elecciones',
  'perdio_elecciones',
  // v1.3: desenlaces de las historias.
  'salio_adelante',
  'paso_pagina',
  'se_reconcilio',
  'sigue_en_paro',
  // v1.5: ciclo vital y fiestas.
  'fue_a_las_fiestas',
  'nacio_hijo',
  'perdio_a',
  'heredo',
  // v1.7: tiempo, asociaciones y protestas.
  'inundacion',
  'asociacion',
  'se_manifesto',
  'logro_vecinal',
  // v1.8: delincuencia.
  'le_robaron',
  'detenido',
  // v1.9: economía de cada vecino.
  'desahuciado',
  'embargado',
  'robo_en_casa',
  'antecedentes',
  'en_paro',
  'deuda_perdonada',
  'cerro_negocio',
  // v1.9.1: el alcalde no contestó a su petición de aplazamiento.
  'sin_respuesta',
  // 2.0: sucesos del director del pueblo.
  'discusion',
  'agradecio',
  'rumor',
  'mitin',
  'le_ayudaron',
  'se_conocieron',
  // 2.1: emergencias.
  'incendio',
  'bomberos',
  'ayudo_incendio',
  'acogio',
  'le_acogieron',
  'voluntario',
  'ambulancia',
  'susto',
  // 2.1: basura.
  'ratas',
  'tiro_basura',
  'vio_tirar_basura',
  // 2.2: licitaciones y calles.
  'obra_de_fuera',
  'escandalo',
  'contrato_revisado',
  'homenaje',
  // 2.2: el campo.
  'temporada',
  'buena_cosecha',
  'granizo',
  // 2.3: grandes obras.
  'dono_obra',
  'obra_voluntario',
  // 2.4 (bloque D): plenos hablados y dilemas.
  'pleno_aplaudio',
  'pleno_protesto',
  'dilema_a_favor',
  'dilema_en_contra',
  // 2.4: cuidados y autobús.
  'deja_trabajo_crianza',
  'a_la_residencia',
  'cuida_padre',
  'excursion',
  // 2.5: correos.
  'carta',
  'volvio',
  // 2.5 (bloque F): vivienda protegida.
  'piso_protegido',
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
/** Recuerdo: plantilla del motor (nunca texto del LLM ni del jugador). */
export interface Memory {
  tick: number;
  kind: MemoryKind;
  /** Ids de otros vecinos implicados. */
  about: number[];
  importance: number;
  /** Efecto en la felicidad mientras dura (60 días). */
  valence: number;
  /** Nombres de pila de `about` cuando se creó (v1.3). */
  names?: string[];
}

// 2.3: en social-core.ts (sin dependencias) para crear vecinos desde createInitialState.
export { GOALS, goalFor, PROFESSIONS, type Goal } from './social-core.ts';

/** Oficios en masculino y femenino (v1.9.1: «Rosa, enfermero»). Se guarda una forma; se dice la que toca. */
const PROFESSION_FORMS: [string, string][] = [
  ['panadero', 'panadera'], ['maestro', 'maestra'], ['fontanero', 'fontanera'], ['enfermero', 'enfermera'],
  ['informático', 'informática'], ['camarero', 'camarera'], ['agricultor', 'agricultora'], ['jubilado', 'jubilada'],
  ['vecino', 'vecina'], ['administrativo', 'administrativa'], ['electricista', 'electricista'], ['estudiante', 'estudiante'],
];

/** El oficio de un vecino concordando con su nombre. */
export function professionOf(c: { name: string; profession: string }): string {
  const forms = PROFESSION_FORMS.find((f) => f.includes(c.profession));
  return forms ? forms[isFemaleName(c.name) ? 1 : 0] : c.profession;
}

/**
 * Une nombres con «y» sin repetir (v1.9.1: «Se lleva bien con Marcos y Marcos»):
 * si dos se llaman igual, se dice el nombre completo; si ni así, «dos Marcos».
 */
export function joinNames(first: string[], full: (string | undefined)[] = []): string {
  const out: string[] = [];
  const done = new Set<string>();
  for (const n of first) {
    const group = first.flatMap((x, j) => (x === n ? [j] : []));
    if (group.length < 2) {
      out.push(n);
      continue;
    }
    if (done.has(n)) continue;
    done.add(n);
    const fulls = group.map((j) => full[j]);
    const words = ['', '', 'dos', 'tres', 'cuatro', 'cinco'];
    if (fulls.every(Boolean) && new Set(fulls).size === fulls.length) out.push(...(fulls as string[]));
    else out.push(n.startsWith('alguien') ? `${words[group.length] ?? group.length} vecinos que ya no viven aquí` : `${words[group.length] ?? group.length} ${n}`);
  }
  return out.length > 1 ? `${out.slice(0, -1).join(', ')} y ${out.at(-1)}` : (out[0] ?? '');
}


export const HOOK_KINDS = ['mismo_local', 'despido_con_hipoteca', 'promesa_incumplida', 'amigo_se_va', 'rival_politico'] as const;
export type HookKind = (typeof HOOK_KINDS)[number];
export interface Hook {
  id: number;
  kind: HookKind;
  actors: number[];
  createdTick: number;
  expires: number;
}

export const NEEDS = ['parque', 'colegio', 'centro_salud', 'policia', 'empleo', 'agua_luz', 'bajar_tasas', 'bajar_ibi', 'recogida'] as const;
export type Need = (typeof NEEDS)[number];
export interface Petition {
  id: number;
  citizenId: number;
  need: Need;
  yes: number;
  no: number;
  /** Vecinos con nombre que votan a favor (para premiar o castigar). */
  supporters: number[];
  answer: null | 'promise' | 'reject';
  /** v1.3: pregunta del partido de la oposición (la hace su líder). */
  opposition?: boolean;
}
export interface Pleno {
  tick: number;
  petitions: Petition[];
  /** 2.2: «Dedicar una calle»: los candidatos del motor y si ya se dedicó en este pleno. */
  street?: { candidates: number[]; done: boolean };
  /** 2.4: quién habla en el pleno (el texto no entra en el estado: lo pide el cliente). */
  speakers?: PlenoSpeaker[];
}
export interface PromiseRecord {
  id: number;
  need: Need;
  madeTick: number;
  deadline: number;
  supporters: number[];
  /** Referencia para saber si se cumplió (p. ej. cuántos parques había). */
  baseline: number;
  status: 'pending' | 'kept' | 'broken';
  /** Promesas fiscales: desde cuándo se mantiene la bajada. */
  metSince?: number;
  /** v1.3: prometida a la oposición en el pleno; si se rompe, esa facción lo castiga. */
  oppositionFaction?: Faction;
}

export const MEMORY_MAX = 5;
const MEMORY_DAYS = 60;
const RELATIONS_MAX = 5;
export const PLENO_COST = 300;
const PLENO_COOLDOWN = TICKS_PER_MONTH;
const PROMISE_DAYS = 120;
/** Una bajada de impuestos prometida tiene que mantenerse este tiempo. */
const FISCAL_PROMISE_DAYS = 60;
/** El pleno se cierra solo pasadas 48 horas. */
const PLENO_OPEN_TICKS = TICKS_PER_DAY * 2;
const HOOKS_MAX = 3;

/* ---------------- memoria ---------------- */

export function addMemory(state: GameState, c: Citizen, kind: MemoryKind, importance: number, valence: number, about: number[] = []): void {
  // Se guarda el nombre de pila: si esa persona se va, el recuerdo no se queda sin nombre.
  const names = about.map((id) => state.citizens.find((x) => x.id === id)?.name.split(' ')[0] ?? '');
  c.memories.push({ tick: state.tick, kind, about, importance, valence, ...(about.length ? { names } : {}) });
  if (c.memories.length > MEMORY_MAX) {
    // Se olvida el menos importante, ponderado por antigüedad; nunca lo que acaba de vivir.
    const score = (m: Memory) => m.importance - (state.tick - m.tick) / (TICKS_PER_DAY * 60);
    let worst = 0;
    for (let i = 1; i < c.memories.length - 1; i++) if (score(c.memories[i]!) < score(c.memories[worst]!)) worst = i;
    c.memories.splice(worst, 1);
  }
}

/** Minúscula solo la primera letra: los nombres propios que vengan detrás se quedan como están. */
export const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

const nameOf = (state: GameState, id: number) => state.citizens.find((c) => c.id === id)?.name.split(' ')[0] ?? 'alguien que ya no vive aquí';

/** Nombres de un recuerdo: los actuales o, si ya no vive aquí, los que se guardaron. */
function memoryWho(state: GameState, m: Memory): string {
  const first = m.about.map((id, k) => (state.citizens.some((c) => c.id === id) ? nameOf(state, id) : m.names?.[k] || nameOf(state, id)));
  return joinNames(first, m.about.map((id) => state.citizens.find((c) => c.id === id)?.name));
}

/** Texto de un recuerdo con plantillas del motor. */
export function memoryText(state: GameState, m: Memory): string {
  const who = memoryWho(state, m);
  switch (m.kind) {
    case 'llego':
      return 'Llegó al pueblo';
    case 'compro_casa':
      return 'Compró su vivienda';
    case 'abrio_negocio':
      return 'Abrió su propio negocio';
    case 'perdio_trabajo':
      return 'Perdió el trabajo';
    case 'se_fue_amigo':
      return `Se fue su amistad: ${who}`;
    case 'promesa_cumplida':
      return 'El alcalde cumplió una promesa';
    case 'promesa_rota':
      return 'El alcalde no cumplió lo que prometió';
    case 'peticion_rechazada':
      return 'El pleno rechazó su petición';
    case 'hablo_con_alcalde':
      return 'Habló con el alcalde';
    case 'subida_impuestos':
      return 'Le subieron los impuestos';
    case 'nueva_amistad':
      return `Hizo amistad con ${who}`;
    case 'nueva_pareja':
      return `Empezó a salir con ${who}`;
    case 'le_quitaron_el_local':
      return `${who} se quedó el local que quería`;
    case 'fundo_partido':
      return 'Fundó un partido para presentarse a las elecciones';
    case 'voto':
      return 'Votó en las elecciones';
    case 'gano_elecciones':
      return 'Ganó las elecciones y llegó a la alcaldía';
    case 'perdio_elecciones':
      return 'Perdió las elecciones';
    case 'salio_adelante':
      return 'Salió adelante cuando peor lo tenía';
    case 'paso_pagina':
      return `Pasó página tras la marcha de ${who}`;
    case 'se_reconcilio':
      return `Hizo las paces con ${who}`;
    case 'sigue_en_paro':
      return 'Sigue sin trabajo y con la hipoteca encima';
    case 'fue_a_las_fiestas':
      return 'Disfrutó de las fiestas del pueblo';
    case 'nacio_hijo':
      return 'Tuvo un bebé';
    case 'perdio_a':
      return `Perdió a ${who}`;
    case 'heredo':
      return `Heredó de ${who}`;
    case 'inundacion':
      return 'El río le anegó la casa o el trabajo';
    case 'asociacion':
      return 'Se unió a una asociación de vecinos';
    case 'se_manifesto':
      return 'Salió a manifestarse ante el ayuntamiento';
    case 'logro_vecinal':
      return 'El barrio consiguió lo que pedía';
    case 'le_robaron':
      return 'Le robaron en su negocio';
    case 'detenido':
      return 'Le detuvieron en unos disturbios';
    case 'desahuciado':
      return 'Le echaron de casa por no pagar el alquiler';
    case 'embargado':
      return 'El banco se quedó su casa por la hipoteca';
    case 'robo_en_casa':
      return 'Le entraron a robar en casa';
    case 'antecedentes':
      return 'Le detuvieron por robar';
    case 'en_paro':
      return 'Se quedó sin trabajo';
    case 'deuda_perdonada':
      return 'El alcalde le perdonó lo que debía';
    case 'cerro_negocio':
      return 'Tuvo que cerrar su negocio';
    case 'sin_respuesta':
      return 'Pidió tiempo al alcalde y no le contestó';
    case 'discusion':
      return `Discutió con ${who}`;
    case 'agradecio':
      return 'Dio las gracias al alcalde en público';
    case 'rumor':
      return 'Oyó un rumor sobre el ayuntamiento';
    case 'mitin':
      return 'Fue a un mitin de la oposición';
    case 'le_ayudaron':
      return `Le echó una mano ${who}`;
    case 'se_conocieron':
      return `Conoció a ${who}`;
    case 'incendio':
      return 'Hubo fuego en su casa o en su trabajo';
    case 'bomberos':
      return 'Los bomberos apagaron a tiempo el fuego de su casa o su trabajo';
    case 'ayudo_incendio':
      return who ? `Ayudó a ${who} tras un incendio` : 'Ayudó a apagar un incendio';
    case 'acogio':
      return `Acogió en su casa a ${who} tras el incendio`;
    case 'le_acogieron':
      return `${who} le acogió en su casa tras el incendio`;
    case 'voluntario':
      return 'Se hizo voluntario de protección civil';
    case 'ambulancia':
      return 'La ambulancia le salvó la vida';
    case 'susto':
      return 'Se llevó un susto, pero la ambulancia llegó enseguida';
    case 'ratas':
      return 'Vio ratas en su calle por la basura sin recoger';
    case 'tiro_basura':
      return 'Tiró la basura al monte porque no pasa el camión';
    case 'vio_tirar_basura':
      return `Vio a ${who} tirar la basura al monte`;
    case 'obra_de_fuera':
      return 'Una obra del pueblo se la dieron a una empresa de fuera';
    case 'escandalo':
      return m.about.length ? `Se destapó el escándalo de la obra del primo de ${who}` : 'Se destapó el escándalo de una obra del ayuntamiento';
    case 'contrato_revisado':
      return 'El alcalde le revisó el contrato de una obra';
    case 'homenaje':
      return m.about.length ? `El pueblo dedicó una calle a ${who}` : 'El pueblo le dedicó una calle';
    case 'temporada':
      return 'Trabajó de temporero en la cosecha';
    case 'buena_cosecha':
      return 'Celebró una buena cosecha en el pueblo';
    case 'granizo':
      return 'El granizo arruinó parte de la cosecha';
    case 'dono_obra':
      return 'Donó dinero para una gran obra del pueblo';
    case 'obra_voluntario':
      return 'Echó una mano como voluntario en una gran obra';
    case 'pleno_aplaudio':
      return 'Aplaudió en el pleno lo que respondió el alcalde';
    case 'pleno_protesto':
      return 'Protestó en el pleno por lo que respondió el alcalde';
    case 'dilema_a_favor':
      return 'El alcalde decidió a su favor en un asunto difícil';
    case 'dilema_en_contra':
      return 'El alcalde decidió en su contra en un asunto difícil';
    case 'deja_trabajo_crianza':
      return 'Dejó su trabajo para cuidar del bebé (no había plaza en la guardería)';
    case 'a_la_residencia':
      return m.about.length ? `Llevó a ${who} a la residencia` : 'Entró en la residencia';
    case 'cuida_padre':
      return m.about.length ? `Cuida en casa a ${who}` : 'Su familia le cuida en casa';
    case 'excursion':
      return 'Fue de excursión en el autobús de los jubilados';
    case 'carta':
      return `Recibió carta de ${who}`;
    case 'volvio':
      return 'Volvió al pueblo';
    case 'piso_protegido':
      return 'Le tocó un piso de la vivienda protegida';
  }
}

/** Efecto en la felicidad de los recuerdos recientes. */
export function memoryMood(state: GameState, c: Citizen): number {
  const recent = c.memories.filter((m) => state.tick - m.tick < TICKS_PER_DAY * MEMORY_DAYS);
  return Math.max(-10, Math.min(10, recent.reduce((a, m) => a + m.valence, 0)));
}

/** Dónde trabaja, para una frase: el nombre de un negocio tal cual («el Bar de Lucía», no «bar de lucía»; v1.9.1). */
export function workplaceText(b: Pick<Building, 'kind' | 'name'>): string {
  if (b.name) return `${b.name.startsWith('Bar') ? 'el' : 'la'} ${b.name}`;
  return (BUILD_NAMES[b.kind] ?? '').toLowerCase();
}

/** Resumen narrativo (capa 3): plantilla del motor, máx. ~60 palabras. */
export function narrativeSummary(state: GameState, c: Citizen): string {
  const parts: string[] = [];
  const job = state.buildings.find((b) => b.id === c.jobId);
  parts.push(`${c.name.split(' ')[0]}, ${professionOf(c)}, ${c.age} años.`);
  parts.push(job ? `Trabaja en ${workplaceText(job)}.` : c.unemployedSince !== undefined ? 'Está en paro.' : 'Trabaja fuera del pueblo.');
  if (c.owns) parts.push(c.mortgage > 0 ? 'Paga la hipoteca de su casa.' : 'Su casa ya es suya.');
  const friends = c.relations.filter((r) => r.kind === 'amistad').slice(0, 2).map((r) => r.id);
  if (friends.length) parts.push(`Se lleva bien con ${joinNames(friends.map((id) => nameOf(state, id)), friends.map((id) => state.citizens.find((x) => x.id === id)?.name))}.`);
  const partner = c.relations.find((r) => r.kind === 'pareja');
  if (partner) parts.push(`Sale con ${nameOf(state, partner.id)}.`);
  const top = [...c.memories].sort((a, b) => b.importance - a.importance)[0];
  if (top) parts.push(`No olvida que ${lowerFirst(memoryText(state, top))}.`);
  parts.push(goalDone(state, c) ? 'Ha cumplido su meta.' : `Su meta: ${GOAL_TEXT[c.goal]}.`);
  return parts.join(' ');
}

/* ---------------- metas ---------------- */

export const GOAL_TEXT: Record<Goal, string> = {
  comprar_casa: 'comprar su casa',
  trabajo_en_el_pueblo: 'trabajar en el pueblo',
  parque_cerca: 'tener un parque cerca',
  tienda_cerca: 'tener una tienda cerca',
  ahorrar: 'ahorrar un buen colchón',
  vivir_tranquilo: 'vivir sin ruido',
};

export function goalDone(state: GameState, c: Citizen): boolean {
  const home = state.buildings.find((b) => b.id === c.homeId);
  const near = (kind: string, r: number) => !!home && state.buildings.some((b) => b.kind === kind && b.built && Math.abs(b.x - home.x) + Math.abs(b.y - home.y) <= r);
  switch (c.goal) {
    case 'comprar_casa':
      return c.owns;
    case 'trabajo_en_el_pueblo':
      return c.jobId !== null;
    case 'parque_cerca':
      return near('park', 5);
    case 'tienda_cerca':
      return near('shop', 6);
    case 'ahorrar':
      return c.money >= 5_000;
    case 'vivir_tranquilo':
      return !!home && (state.fields.noise[home.y * state.map.w + home.x] ?? 0) < 20;
  }
}

/* ---------------- relaciones ---------------- */

export function relation(c: Citizen, id: number): Relation | undefined {
  return c.relations.find((r) => r.id === id);
}

export function setRelation(state: GameState, a: Citizen, b: Citizen, kind: RelationKind, strength: number): void {
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    const r = relation(x, y.id);
    if (r) {
      r.kind = kind;
      r.strength = strength;
    } else {
      x.relations.push({ id: y.id, kind, strength, since: state.tick });
      if (x.relations.length > RELATIONS_MAX) {
        // Se suelta la más débil por los dos lados (las relaciones son simétricas).
        const weakest = x.relations.filter((r) => r.id !== y.id).sort((p, q) => p.strength - q.strength)[0]!;
        x.relations = x.relations.filter((r) => r !== weakest);
        const other = state.citizens.find((c) => c.id === weakest.id);
        if (other) other.relations = other.relations.filter((r) => r.id !== x.id);
      }
    }
  }
}

/** Efecto de las relaciones en la felicidad. */
export function relationMood(c: Citizen): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = [];
  const friends = c.relations.filter((r) => r.kind === 'amistad').length;
  if (friends) out.push({ label: 'Tiene amistades en el pueblo', value: Math.min(6, friends * 2) });
  if (c.relations.some((r) => r.kind === 'pareja')) out.push({ label: 'Tiene pareja', value: 5 });
  const bad = c.relations.filter((r) => r.kind === 'rivalidad' || r.kind === 'rencor').length;
  if (bad) out.push({ label: 'Tiene roces con vecinos', value: -Math.min(6, bad * 3) });
  return out;
}

/** Plaza, mercado o parque cuyo radio alcanza las casas de los dos (v1.3). */
export function meetingPlace(state: GameState, a: Citizen, b: Citizen): Building | undefined {
  const home = (c: Citizen) => state.buildings.find((x) => x.id === c.homeId);
  const ha = home(a);
  const hb = home(b);
  if (!ha || !hb || ha === hb) return undefined;
  // El primero que encaje por orden de preferencia (el bar antes que el parque).
  const places = state.buildings.filter((p) => p.built && MEETING_KINDS.includes(p.kind)).sort((x, y) => MEETING_KINDS.indexOf(x.kind) - MEETING_KINDS.indexOf(y.kind));
  return places.find((p) => {
    if (!p.built || !MEETING_KINDS.includes(p.kind)) return false;
    const r = radiusOf(p);
    return Math.abs(p.x - ha.x) + Math.abs(p.y - ha.y) <= r && Math.abs(p.x - hb.x) + Math.abs(p.y - hb.y) <= r;
  });
}
// v1.7: el bar va primero: es donde más amistades nacen.
const MEETING_KINDS: Building['kind'][] = ['bar', 'plaza', 'market', 'park', 'sports', 'library', 'chapel'];
const MEETING_TEXT: Partial<Record<Building['kind'], string>> = {
  bar: 'tomando algo en el bar',
  plaza: 'en la plaza',
  market: 'en el mercado',
  park: 'paseando por el parque',
  sports: 'en el polideportivo',
  library: 'en la biblioteca',
  chapel: 'en la ermita',
};

/**
 * Las relaciones nacen de compartir casa o trabajo y, más despacio, de
 * coincidir en la plaza, el mercado o el parque del barrio (con el PRNG de la partida).
 */
function updateRelations(state: GameState): void {
  const named = state.citizens.filter((c) => c.named);
  let barrioToday = false;
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const a = named[i]!;
      const b = named[j]!;
      const together = (a.homeId !== null && a.homeId === b.homeId) || (a.jobId !== null && a.jobId === b.jobId);
      const r = relation(a, b.id);
      const place = together || r ? undefined : meetingPlace(state, a, b);
      if (!together && !place) continue;
      // Una amistad nueva no expulsa a otra: con 5 relaciones ya no caben más
      // (antes se soltaba la más débil y se rehacía al día siguiente, en bucle).
      const room = a.relations.length < RELATIONS_MAX && b.relations.length < RELATIONS_MAX;
      if (!r && room) {
        // En fiestas, el doble de fácil (v1.5).
        const party = state.festival.until > state.tick ? 2 : 1;
        const p = ((place ? 0.015 : 0.04) + (a.traits.social + b.traits.social) / 4000) * party;
        if (chance(state.rng, p)) {
          setRelation(state, a, b, 'amistad', 30);
          addMemory(state, a, 'nueva_amistad', 2, 2, [b.id]);
          addMemory(state, b, 'nueva_amistad', 2, 2, [a.id]);
          // Como mucho un suceso de barrio al día; con el mismo nombre de pila, el nombre completo.
          if (place && !barrioToday) {
            barrioToday = true;
            const [na, nb] = [a, b].map((x) => x.name.split(' ')[0]!);
            pushEvent(state, 'info', `${na === nb ? `${a.name} y ${b.name}` : `${na} y ${nb}`} han hecho amistad ${MEETING_TEXT[place.kind]}`, { ref: a.id });
          }
        }
      } else if (r?.kind === 'amistad') {
        r.strength = Math.min(100, r.strength + 1);
        const back = relation(b, a.id);
        if (back) back.strength = r.strength;
        const partners = (x: Citizen) => x.relations.some((q) => q.kind === 'pareja');
        if (r.strength >= 70 && Math.abs(a.age - b.age) < 15 && !partners(a) && !partners(b) && chance(state.rng, 0.01)) {
          setRelation(state, a, b, 'pareja', 80);
          addMemory(state, a, 'nueva_pareja', 4, 4, [b.id]);
          addMemory(state, b, 'nueva_pareja', 4, 4, [a.id]);
          // Con el mismo nombre de pila, el nombre completo («Gonzalo y Gonzalo» no se entiende).
          const [na, nb] = [a, b].map((x) => x.name.split(' ')[0]!);
          pushEvent(state, 'info', na === nb ? `${a.name} y ${b.name} empiezan a salir` : `${na} y ${nb} empiezan a salir`, { ref: a.id });
        }
      }
    }
  }
}

/** Cuando un vecino se va, sus amistades lo recuerdan. */
export function onCitizenLeaves(state: GameState, leaving: Citizen): void {
  // v1.9: salda lo que pueda; lo que deba y no pague se da por perdido.
  leaveTown(state, leaving);
  rememberDeparted(state, leaving, 'se_fue');
  tendersForget(state, leaving.id);
  for (const c of state.citizens) {
    const r = relation(c, leaving.id);
    if (!r) continue;
    if (r.kind === 'amistad' || r.kind === 'pareja') {
      addMemory(state, c, 'se_fue_amigo', r.kind === 'pareja' ? 5 : 3, r.kind === 'pareja' ? -6 : -3, [leaving.id]);
      addHook(state, 'amigo_se_va', [c.id, leaving.id]);
    }
    c.relations = c.relations.filter((x) => x.id !== leaving.id);
  }
}

/* ---------------- director de historias ---------------- */

export function addHook(state: GameState, kind: HookKind, actors: number[]): boolean {
  if (state.hooks.length >= HOOKS_MAX) return false;
  if (state.hooks.some((h) => h.actors.some((a) => actors.includes(a)))) return false;
  state.hooks.push({ id: state.nextId++, kind, actors, createdTick: state.tick, expires: state.tick + TICKS_PER_DAY * 15 });
  // El director se ve también en Modo normal: el gancho sale en el diario.
  const lead = state.citizens.find((c) => c.id === actors[0]);
  if (lead) pushEvent(state, 'info', `${lead.name} ${HOOK_TEXT[kind]}`, { ref: lead.id });
  return true;
}

/**
 * Desenlaces (v1.3): un gancho no se apaga sin más. Si la situación se
 * resuelve, o al caducar, el diario cuenta cómo acabó y el vecino lo recuerda.
 */
function resolveHooks(state: GameState): void {
  const byId = (id: number) => state.citizens.find((c) => c.id === id);
  const first = (c: Citizen) => c.name.split(' ')[0];
  const keep: Hook[] = [];
  for (const h of state.hooks) {
    const lead = byId(h.actors[0]!);
    const other = h.actors[1] !== undefined ? byId(h.actors[1]) : undefined;
    const expired = h.expires <= state.tick;
    if (!lead) continue; // se fue del pueblo: su marcha ya deja recuerdo en los demás
    let done = false;
    switch (h.kind) {
      case 'despido_con_hipoteca':
        if (lead.jobId !== null || lead.mortgage === 0) {
          pushEvent(state, 'info', `${first(lead)} ha salido adelante: ${lead.jobId !== null ? 'ya tiene trabajo' : 'ha terminado de pagar la casa'}`, { ref: lead.id });
          addMemory(state, lead, 'salio_adelante', 4, 4);
          done = true;
        } else if (expired) {
          pushEvent(state, 'warning', `${first(lead)} sigue sin trabajo y con la hipoteca encima`, { ref: lead.id });
          addMemory(state, lead, 'sigue_en_paro', 3, -3);
          done = true;
        }
        break;
      case 'amigo_se_va':
        // Una amistad nueva ayuda a pasar página.
        if (lead.relations.some((r) => (r.kind === 'amistad' || r.kind === 'pareja') && r.since > h.createdTick) || expired) {
          pushEvent(state, 'info', `${first(lead)} ha pasado página tras la marcha de ${nameOf(state, h.actors[1]!)}`, { ref: lead.id });
          addMemory(state, lead, 'paso_pagina', 2, 2, h.actors.slice(1));
          done = true;
        }
        break;
      case 'mismo_local':
        if (expired) {
          // Nadie se quedó el local: con el tiempo, la rivalidad se apaga.
          if (other && relation(lead, other.id)?.kind === 'rivalidad') {
            setRelation(state, lead, other, 'amistad', 20);
            addMemory(state, lead, 'se_reconcilio', 2, 2, [other.id]);
            addMemory(state, other, 'se_reconcilio', 2, 2, [lead.id]);
            pushEvent(state, 'info', `${first(lead)} y ${first(other)} han hecho las paces: al final nadie se ha quedado el local`, { ref: lead.id });
          }
          done = true;
        }
        break;
      case 'promesa_incumplida':
        // Cumplirle otra promesa después le devuelve algo de confianza.
        if (lead.memories.some((m) => m.kind === 'promesa_cumplida' && m.tick > h.createdTick)) {
          pushEvent(state, 'info', `${first(lead)} vuelve a confiar en el ${state.politics.mayor === 'player' ? 'alcalde' : 'concejal'}`, { ref: lead.id });
          lead.grudge = Math.max(0, lead.grudge - 4);
          done = true;
        } else done = expired;
        break;
      default:
        done = expired;
    }
    // En «amigo_se_va» el segundo actor es quien se fue: es normal que no esté.
    if (!done && (h.kind !== 'mismo_local' || other)) keep.push(h);
  }
  state.hooks = keep;
}

/** Ganchos deterministas (varían con la semilla, no compensa recargar). */
function directStories(state: GameState): void {
  resolveHooks(state);
  const named = state.citizens.filter((c) => c.named);
  // Dos vecinos quieren el mismo (y único) local.
  const founders = named.filter((c) => canFound(state, c));
  // 2.0: en Modo IA con director, esta historia la abre el director.
  if (!directorOwns(state) && founders.length >= 2 && freeShopLot(state) !== null && chance(state.rng, 0.3)) {
    const a = pick(state.rng, founders);
    const b = pick(state.rng, founders.filter((x) => x !== a));
    // La rivalidad solo si la historia arranca, y nunca entre pareja ni tras hacer las paces.
    const kind = relation(a, b.id)?.kind;
    const reconciled = a.memories.some((m) => m.kind === 'se_reconcilio' && m.about.includes(b.id));
    if (kind !== 'pareja' && !reconciled && addHook(state, 'mismo_local', [a.id, b.id])) setRelation(state, a, b, 'rivalidad', 40);
  }
  // Se queda sin trabajo con hipoteca.
  for (const c of named) {
    // Si la historia ya acabó mal hace poco, no se vuelve a abrir al día siguiente.
    const recent = c.memories.some((m) => m.kind === 'sigue_en_paro' && state.tick - m.tick < TICKS_PER_DAY * MEMORY_DAYS);
    if (!recent && c.mortgage > 0 && c.jobId === null && c.money < 800) addHook(state, 'despido_con_hipoteca', [c.id]);
  }
}

export const HOOK_TEXT: Record<HookKind, string> = {
  mismo_local: 'se disputa con alguien del pueblo el único local comercial libre',
  despido_con_hipoteca: 'no tiene trabajo en el pueblo y le cuesta pagar la hipoteca',
  promesa_incumplida: 'el alcalde le prometió algo y no lo cumplió',
  amigo_se_va: 'una persona querida se ha ido del pueblo',
  rival_politico: 'acaba de fundar un partido para disputarle la alcaldía al alcalde',
};

export function hookFor(state: GameState, citizenId: number): Hook | undefined {
  return state.hooks.find((h) => h.actors.includes(citizenId));
}

/** Si dos querían el mismo local y uno lo consigue, el otro le guarda rencor. */
export function onBusinessFounded(state: GameState, founder: Citizen): void {
  const h = state.hooks.find((x) => x.kind === 'mismo_local' && x.actors.includes(founder.id));
  if (!h) return;
  const other = state.citizens.find((c) => h.actors.includes(c.id) && c.id !== founder.id);
  pushEvent(state, 'info', `${founder.name.split(' ')[0]} se queda el local${other ? `: ${other.name.split(' ')[0]} no se lo perdona` : ''}`, { ref: founder.id });
  if (other) {
    setRelation(state, other, founder, 'rencor', 60);
    addMemory(state, other, 'le_quitaron_el_local', 4, -4, [founder.id]);
  }
  state.hooks = state.hooks.filter((x) => x !== h);
}

/* ---------------- plenos y promesas ---------------- */

export const NEED_TEXT: Record<Need, string> = {
  parque: 'un parque',
  colegio: 'un colegio',
  centro_salud: 'un centro de salud',
  policia: 'una comisaría',
  empleo: 'más empleo en el pueblo',
  agua_luz: 'agua y luz para todas las casas',
  bajar_tasas: 'bajar las tasas',
  bajar_ibi: 'bajar el IBI',
  recogida: 'que pase el camión de la basura',
};

const NEED_KIND: Partial<Record<Need, string>> = { parque: 'park', colegio: 'school', centro_salud: 'clinic', policia: 'police', recogida: 'cleanpoint' };

/** 2.1: su calle está sucia (bolsas o ratas) y el camión no pasa. */
function dirtyHome(state: GameState, c: Citizen): boolean {
  const home = state.buildings.find((b) => b.id === c.homeId);
  return !!home && (state.fields.dirt?.[home.y * state.map.w + home.x] ?? 0) >= TRASH.dirtyField;
}
const LEVEL = { low: 0, medium: 1, high: 2 } as const;

function needBaseline(state: GameState, need: Need): number {
  const kind = NEED_KIND[need];
  // Cuentan también las obras en marcha: prometer lo que ya se está construyendo no vale.
  if (kind) return state.buildings.filter((b) => b.kind === kind).length;
  if (need === 'empleo') return state.citizens.filter((c) => c.jobId === null).length;
  if (need === 'bajar_tasas') return LEVEL[taxLevels(state).tasas];
  if (need === 'bajar_ibi') return LEVEL[taxLevels(state).ibi];
  return state.buildings.filter((b) => b.built && b.kind !== 'farm' && (!b.hasWater || !b.hasPower)).length;
}

function needMet(state: GameState, p: PromiseRecord): boolean {
  const now = needBaseline(state, p.need);
  if (NEED_KIND[p.need]) return now > p.baseline;
  if (p.need === 'agua_luz') return now === 0;
  return now < p.baseline;
}

const isFiscal = (n: Need) => n === 'bajar_tasas' || n === 'bajar_ibi';

/** No se pide bajar lo que ya está en bajo (sería imposible de cumplir). */
function canLower(state: GameState, n: Need): boolean {
  const lv = taxLevels(state);
  return n === 'bajar_tasas' ? lv.tasas !== 'low' : n === 'bajar_ibi' ? lv.ibi !== 'low' : true;
}

/** Necesidades de un vecino por orden (para que el pleno traiga peticiones distintas). */
export function needsOf(state: GameState, c: Citizen): Need[] {
  const first = needOf(state, c);
  // Un servicio saturado cuenta como carencia: piden otro.
  const lacks = (kind: string) => !state.buildings.some((b) => b.kind === kind) || saturated(state, kind as never);
  const rest = NEEDS.filter(
    (n) => n !== first && (n === 'recogida' ? dirtyHome(state, c) : NEED_KIND[n] ? lacks(NEED_KIND[n]!) : n === 'bajar_tasas' && canLower(state, n)),
  );
  return [first, ...rest.sort((a, b) => (hash32(c.id, a.length) % 7) - (hash32(c.id, b.length) % 7))];
}

/** Lo que pediría un vecino: su carencia más fuerte (datos del motor). */
export function needOf(state: GameState, c: Citizen): Need {
  const home = state.buildings.find((b) => b.id === c.homeId);
  const has = (k: string) => state.buildings.some((b) => b.kind === k && b.built);
  if (home && (!home.hasWater || !home.hasPower)) return 'agua_luz';
  if (c.jobId === null) return 'empleo';
  // 2.1: con ratas o bolsas en la puerta, lo primero es la basura.
  if (dirtyHome(state, c)) return 'recogida';
  const lv = taxLevels(state);
  if (lv.tasas === 'high') return 'bajar_tasas';
  if (c.owns && lv.ibi === 'high') return 'bajar_ibi';
  if (c.desire === 'parque' && !has('park')) return 'parque';
  if (home && (state.fields.crime[home.y * state.map.w + home.x] ?? 0) > 30 && !has('police')) return 'policia';
  const options: Need[] = ['parque', 'colegio', 'centro_salud', 'policia'];
  const missing = options.filter((n) => !has(NEED_KIND[n]!));
  if (missing.length) return missing[hash32(c.id, state.seed) % missing.length]!;
  return canLower(state, 'bajar_tasas') ? 'bajar_tasas' : 'empleo';
}

function wantsNeed(state: GameState, c: Citizen, need: Need): boolean {
  if (need === 'bajar_tasas') return true;
  if (need === 'bajar_ibi') return c.owns;
  if (need === 'empleo') return c.jobId === null || c.traits.social > 50;
  if (need === 'agua_luz') return true;
  if (need === 'recogida') return dirtyHome(state, c) || hash32(c.id, 9, state.tick) % 3 === 0;
  return needOf(state, c) === need || hash32(c.id, need.length, state.tick) % 3 !== 0;
}

export function canConvenePleno(state: GameState): { ok: boolean; error?: string } {
  if (state.pleno) return { ok: false, error: 'Ya hay un pleno abierto' };
  if (state.citizens.filter((c) => c.named).length < 2) return { ok: false, error: 'Hacen falta al menos 2 vecinos con nombre' };
  if (state.lastPlenoTick >= 0 && state.tick - state.lastPlenoTick < PLENO_COOLDOWN) return { ok: false, error: 'Solo un pleno al mes' };
  if (state.treasury < PLENO_COST) return { ok: false, error: `Convocar un pleno cuesta ${PLENO_COST} €` };
  return { ok: true };
}

/** Convoca un pleno: hasta 3 peticiones de vecinos con nombre, votadas por todos. */
export function convenePleno(state: GameState): void {
  transfer(state, TREASURY, OUTSIDE, PLENO_COST, 'plenos');
  state.lastPlenoTick = state.tick;
  const named = state.citizens.filter((c) => c.named).sort((a, b) => a.happiness - b.happiness);
  const petitions: Petition[] = [];
  // Lo que ya está prometido y pendiente no se vuelve a pedir: una obra no cumple dos promesas (ronda 09).
  const promised = (n: Need) => state.promises.some((p) => p.status === 'pending' && p.need === n);
  // Con un partido en la oposición, su líder también pregunta (v1.3, aplazado de la ronda 07).
  // Su pregunta se reserva antes: si no, los vecinos podían haber pedido ya todo lo suyo.
  const party = state.politics.party;
  const leader = party && state.politics.mayor === 'player' ? state.citizens.find((c) => c.id === party.leaderId) : undefined;
  const oppNeed = leader ? needsOf(state, leader).find((n) => !promised(n)) : undefined;
  for (const c of named) {
    if (petitions.length >= 3) break;
    const need = needsOf(state, c).find((n) => !petitions.some((p) => p.need === n) && !promised(n) && n !== oppNeed);
    if (!need) continue;
    let yes = 0;
    const supporters: number[] = [];
    for (const v of state.citizens) {
      if (wantsNeed(state, v, need)) {
        yes++;
        if (v.named) supporters.push(v.id);
      }
    }
    petitions.push({ id: state.nextId++, citizenId: c.id, need, yes, no: state.citizens.length - yes, supporters, answer: null });
  }
  if (leader) {
    const need = oppNeed;
    if (need) {
      let yes = 0;
      const supporters: number[] = [];
      for (const v of state.citizens) {
        if (wantsNeed(state, v, need)) {
          yes++;
          if (v.named) supporters.push(v.id);
        }
      }
      petitions.push({ id: state.nextId++, citizenId: leader.id, need, yes, no: state.citizens.length - yes, supporters, answer: null, opposition: true });
    }
  }
  // 2.2: una calle por pleno, entre los candidatos que propone el motor.
  const street = streetCandidates(state).map((c) => c.id);
  const speakers = plenoSpeakers(state, petitions);
  state.pleno = { tick: state.tick, petitions, ...(street.length ? { street: { candidates: street, done: false } } : {}), ...(speakers.length ? { speakers } : {}) };
  pushEvent(state, 'info', `Pleno municipal: ${petitions.length} peticiones${leader ? ', una de la oposición' : ' de los vecinos'}`);
}

export function answerPetition(state: GameState, petitionId: number, answer: 'promise' | 'reject'): boolean {
  const p = state.pleno?.petitions.find((x) => x.id === petitionId);
  if (!p || p.answer) return false;
  p.answer = answer;
  const asker = state.citizens.find((c) => c.id === p.citizenId);
  if (answer === 'promise') {
    state.promises.push({
      id: state.nextId++,
      need: p.need,
      madeTick: state.tick,
      deadline: state.tick + TICKS_PER_DAY * PROMISE_DAYS,
      supporters: p.supporters,
      baseline: needBaseline(state, p.need),
      status: 'pending',
    });
    for (const id of p.supporters) {
      const c = state.citizens.find((x) => x.id === id);
      if (c) c.happiness = Math.min(100, c.happiness + 3);
    }
    pushEvent(state, 'info', `El alcalde promete ${NEED_TEXT[p.need]} (lo pidió ${asker?.name ?? 'un vecino'})`);
    // Aceptar lo que pide la oposición le quita bandera: su facción se acerca un poco.
    // Cuenta como un acto de campaña: mismo tope (3) y solo en el último año (ronda 09).
    const party = state.politics.party;
    const pol = state.politics;
    if (p.opposition && party) {
      state.promises.at(-1)!.oppositionFaction = party.faction;
      if (pol.nextElection - state.tick <= CAMPAIGN_MONTHS * TICKS_PER_MONTH) pol.campaign[party.faction] = Math.max(pol.campaign[party.faction], Math.min(3, pol.campaign[party.faction] + 1));
    }
  } else {
    const party = state.politics.party;
    if (p.opposition && party) {
      state.politics.campaign[party.faction] = Math.max(0, state.politics.campaign[party.faction] - 1);
      pushEvent(state, 'politics', `«${party.name}» critica que rechaces su pregunta: ${NEED_TEXT[p.need]}`);
    }
    for (const id of p.supporters) {
      const c = state.citizens.find((x) => x.id === id);
      if (c) {
        addMemory(state, c, 'peticion_rechazada', 3, -2);
        c.grudge = Math.min(40, c.grudge + 2);
      }
    }
    pushEvent(state, 'info', `El pleno rechaza ${NEED_TEXT[p.need]}`);
  }
  plenoAnswered(state, p, answer);
  return true;
}

export function closePleno(state: GameState): void {
  if (!state.pleno) return;
  // 2.4: quien habló y aún no reaccionó (la IA no llegó a tiempo), reacciona por reglas.
  settlePlenoReactions(state);
  const answered = state.pleno.petitions.filter((p) => p.answer).length;
  for (const p of state.pleno.petitions) {
    if (p.answer) continue;
    // Sin respuesta: molesta un poco, menos que un rechazo.
    for (const id of p.supporters) {
      const c = state.citizens.find((x) => x.id === id);
      if (c) c.grudge = Math.min(40, c.grudge + 1);
    }
  }
  // Sentirse escuchado: los vecinos con nombre agradecen que se respondan las peticiones.
  if (answered > 0) for (const c of state.citizens) if (c.named) c.happiness = Math.min(100, c.happiness + answered);
  state.pleno = null;
}

function checkPromises(state: GameState): void {
  for (const p of state.promises) {
    if (p.status !== 'pending') continue;
    const supporters = state.citizens.filter((c) => p.supporters.includes(c.id));
    const met = needMet(state, p);
    if (isFiscal(p.need) && p.metSince !== undefined && !met) {
      // Bajó el impuesto y lo volvió a subir: promesa rota.
      p.metSince = undefined;
      p.deadline = state.tick;
    } else if (met && isFiscal(p.need) && p.metSince === undefined) {
      p.metSince = state.tick;
      continue;
    }
    if (met && (!isFiscal(p.need) || state.tick - p.metSince! >= TICKS_PER_DAY * FISCAL_PROMISE_DAYS)) {
      p.status = 'kept';
      for (const c of supporters) addMemory(state, c, 'promesa_cumplida', 4, 5);
      pushEvent(state, 'info', `Promesa cumplida: ${NEED_TEXT[p.need]}`);
    } else if (!met && state.tick >= p.deadline) {
      p.status = 'broken';
      // Castigo al grupo que la apoyó: rencor y memoria.
      for (const c of supporters) {
        addMemory(state, c, 'promesa_rota', 5, -6);
        c.grudge = Math.min(40, c.grudge + 8);
      }
      if (supporters[0]) addHook(state, 'promesa_incumplida', supporters.slice(0, 2).map((c) => c.id));
      // Incumplir lo prometido a la oposición le da munición (ronda 09).
      const f = p.oppositionFaction;
      if (f) state.politics.campaign[f] = Math.max(0, state.politics.campaign[f] - 2);
      pushEvent(state, 'warning', `Promesa incumplida: ${NEED_TEXT[p.need]}. Quien la apoyó no lo olvidará`);
    }
  }
  if (state.promises.length > 30) state.promises = state.promises.slice(-30);
}

/* ---------------- hablar con un vecino ---------------- */

export const QUESTIONS = ['como_estas', 'que_necesitas', 'me_votarias'] as const;
export type Question = (typeof QUESTIONS)[number];
export const QUESTION_TEXT: Record<Question, string> = {
  como_estas: '¿Cómo estás?',
  que_necesitas: '¿Qué necesitas?',
  me_votarias: '¿Me votarías?',
};

/** Respuesta por reglas (Modo normal y fallback de la IA). */
export function ruleAnswer(state: GameState, c: Citizen, q: Question, worst: string | undefined): string {
  const text = answerText(state, c, q, worst);
  // En la oposición el jugador ya no es el alcalde: es concejal.
  return state.politics.mayor === 'player' ? text : text.replace(/alcalde/g, 'concejal').replace('Lo está haciendo bien', 'Desde la oposición lo hace bien');
}

/** Frase sobre lo que ha vivido hace poco (v1.3). Plantillas del motor; nada del LLM ni del jugador. */
const MEMORY_LINE: Partial<Record<MemoryKind, (who: string) => string>> = {
  promesa_rota: () => 'Desde que no cumplió lo que prometió, ya no me fío igual.',
  promesa_cumplida: () => 'Cumplió lo que prometió, y eso se agradece.',
  perdio_trabajo: () => 'Desde que perdí el trabajo, no levanto cabeza.',
  salio_adelante: () => 'Lo pasé mal, pero he salido adelante.',
  se_fue_amigo: (who) => `Echo de menos a ${who}.`,
  paso_pagina: (who) => `Todavía me acuerdo de ${who}, pero hay que seguir.`,
  nueva_pareja: (who) => `Desde que salgo con ${who}, todo va mejor.`,
  nueva_amistad: (who) => `Ahora tengo amistad con ${who}, y se nota.`,
  se_reconcilio: (who) => `Al final hice las paces con ${who}.`,
  le_quitaron_el_local: (who) => `Todavía me escuece que ${who} se quedara el local.`,
  sigue_en_paro: () => 'Sigo sin trabajo y la hipoteca no perdona.',
  fue_a_las_fiestas: () => 'Las fiestas de este año fueron una maravilla.',
  nacio_hijo: () => 'Con el bebé en casa no paro, pero estoy feliz.',
  perdio_a: (who) => `No me hago a la idea de que ${who} ya no esté.`,
  heredo: (who) => `Lo que me dejó ${who} me ha ayudado mucho.`,
  compro_casa: () => 'Con la casa ya en mis manos, duermo con más calma.',
  abrio_negocio: () => 'Con mi negocio en marcha, ganas no me faltan.',
  subida_impuestos: () => 'Y la última subida de impuestos no ayuda.',
  // v1.9 (ronda 15).
  desahuciado: () => 'Desde que me echaron de casa, duermo donde puedo.',
  embargado: () => 'El banco se quedó mi casa; ahora pago alquiler en ella.',
  robo_en_casa: () => 'Me entraron a robar en casa; ya no estoy tranquilo.',
  en_paro: () => 'Sigo buscando trabajo.',
  deuda_perdonada: () => 'El alcalde me perdonó lo que debía. No lo olvido.',
  cerro_negocio: () => 'Tuve que cerrar mi negocio; las nóminas me comían.',
  sin_respuesta: () => 'Pedí tiempo al alcalde para pagar y ni me contestó.',
  // 2.1: emergencias.
  incendio: () => 'Todavía huelo a humo cuando me acuerdo del incendio.',
  bomberos: () => 'Menos mal que los bomberos llegaron a tiempo.',
  le_acogieron: (who) => `No olvidaré que ${who} me abrió su casa tras el fuego.`,
  voluntario: () => 'Desde que soy voluntario de protección civil me siento útil.',
  ambulancia: () => 'Si no llega a ser por la ambulancia, no lo cuento.',
  // 2.5: correos.
  carta: (who) => `Me ha escrito ${who}; me ha alegrado el día.`,
  volvio: () => 'Qué alegría haber vuelto al pueblo.',
};

/** Frase de un recuerdo; las pérdidas, distintas para la pareja y para una amistad (ronda 11). */
function lineFor(state: GameState, m: Memory): string {
  const who = memoryWho(state, m);
  if (m.kind === 'perdio_a') {
    const pareja = [`Sin ${who} la casa está muy callada.`, `Todavía pongo dos tazas por la mañana. Echo de menos a ${who}.`];
    const amistad = [`Echo de menos los cafés con ${who}.`, `Cada vez que paso por su calle me acuerdo de ${who}.`, `No me hago a la idea de que ${who} ya no esté.`];
    const list = m.importance >= 5 ? pareja : amistad;
    return list[hash32(m.tick, m.about[0] ?? 0) % list.length]!;
  }
  if (m.kind === 'nacio_hijo') return ['Con el bebé en casa no paro, pero estoy feliz.', 'El bebé ya duerme del tirón… casi.', 'Desde que llegó el bebé, la casa es otra.'][hash32(m.tick, 3) % 3]!;
  return MEMORY_LINE[m.kind]!(who);
}

function recentMemory(state: GameState, c: Citizen): Memory | undefined {
  return c.memories
    .filter((m) => state.tick - m.tick < TICKS_PER_DAY * MEMORY_DAYS && MEMORY_LINE[m.kind])
    .sort((a, b) => b.importance - a.importance || b.tick - a.tick)[0];
}

export function memoryLine(state: GameState, c: Citizen): string | null {
  const recent = recentMemory(state, c);
  return recent ? lineFor(state, recent) : null;
}

function answerText(state: GameState, c: Citizen, q: Question, worst: string | undefined): string {
  const base = baseAnswer(state, c, q, worst);
  if (q !== 'como_estas') return base;
  const m = recentMemory(state, c);
  if (!m) return base;
  const line = lineFor(state, m);
  // Si el recuerdo va en contra del ánimo, un enlace para que no suene incoherente.
  const lower = line.charAt(0).toLowerCase() + line.slice(1);
  if (c.happiness >= 70 && m.valence < 0) return `${base} Eso sí, ${lower}`;
  if (c.happiness < 45 && m.valence > 0) return `${base} Al menos, ${lower}`;
  return `${base} ${line}`;
}

function baseAnswer(state: GameState, c: Citizen, q: Question, worst: string | undefined): string {
  const first = c.name.split(' ')[0];
  const pending = state.promises.find((p) => p.status === 'pending' && p.supporters.includes(c.id));
  const broken = state.promises.find((p) => p.status === 'broken' && p.supporters.includes(c.id));
  const v = hash32(c.id, state.tick, q.length) % 3;
  switch (q) {
    case 'como_estas':
      if (c.happiness >= 70) return ['Muy bien, alcalde. Este pueblo me sienta de maravilla.', 'No me puedo quejar, de verdad.', 'Aquí estoy a gusto, de verdad.'][v]!;
      if (c.happiness >= 45) return worst ? `Tirando. Lo que más me pesa es esto: ${lowerFirst(worst)}.` : 'Tirando, como todos.';
      return worst ? `Mal, alcalde. ${worst}. Así no se puede.` : 'Mal. Estoy pensando en irme.';
    case 'que_necesitas':
      if (pending) return `Que cumpla lo que prometió: ${NEED_TEXT[pending.need]}.`;
      return `Lo que más falta aquí es ${NEED_TEXT[needOf(state, c)]}.`;
    case 'me_votarias': {
      const score = c.happiness - c.grudge + (broken ? -20 : 0) + (pending ? 5 : 0);
      if (broken) return `¿Después de prometer ${NEED_TEXT[broken.need]} y no cumplir? Lo dudo mucho.`;
      if (state.politics.mayor === c.id) return 'Ahora el alcalde soy yo. Ya veremos en las próximas elecciones.';
      if (state.politics.party?.leaderId === c.id) return `Yo me presento con «${state.politics.party.name}». Ya sabe la respuesta.`;
      if (c.vote) return 'El voto es secreto, alcalde. Ya lo tengo decidido.';
      if (score >= 65) return `Sí, ${first} le votaría. Lo está haciendo bien.`;
      if (score >= 45) return 'Depende de lo que haga estos meses.';
      return 'Hoy por hoy, no.';
    }
  }
}

export function canTalk(state: GameState, c: Citizen | undefined): boolean {
  return !!c && c.named;
}

/** Hablar deja recuerdo (una vez por semana suma algo de felicidad). */
export function talkTo(state: GameState, c: Citizen): void {
  const last = c.memories.find((m) => m.kind === 'hablo_con_alcalde');
  if (!last || state.tick - last.tick > TICKS_PER_DAY * 7) {
    c.memories = c.memories.filter((m) => m !== last);
    addMemory(state, c, 'hablo_con_alcalde', 1, 2);
  }
}

/* ---------------- objetivos e hitos ---------------- */

export interface ObjectiveDef {
  id: string;
  text: string;
  reward: number;
  /** Hito de fase: recompensa tangible (edificio desbloqueado). */
  unlock?: 'plaza' | 'market';
  done: (s: GameState) => boolean;
}

const has = (s: GameState, k: string) => s.buildings.some((b) => b.kind === k && b.built);

export const OBJECTIVES: ObjectiveDef[] = [
  { id: 'carretera', text: 'Alarga la calle del ayuntamiento', reward: 300, done: (s) => s.map.tiles.filter((t) => t === 1).length > 7 },
  { id: 'agua_luz', text: 'Pon agua y luz', reward: 500, done: (s) => has(s, 'water') && has(s, 'power') },
  { id: 'diez', text: 'Llega a 10 vecinos', reward: 1_000, done: (s) => s.citizens.length >= 10 },
  { id: 'zonas', text: 'Crea zonas R, C e I', reward: 1_000, done: (s) => [1, 2, 3].every((z) => s.map.zones.includes(z)) },
  { id: 'parque', text: 'Construye un parque', reward: 800, done: (s) => has(s, 'park') },
  { id: 'pleno', text: 'Celebra un pleno (Pueblo › Pleno municipal; llega con el ayuntamiento de nivel 2)', reward: 500, done: (s) => s.lastPlenoTick >= 0 },
  { id: 'empresa', text: 'Que un vecino abra su negocio', reward: 1_000, done: (s) => s.buildings.some((b) => b.owner > 0) },
  { id: 'propietarios', text: 'Ten 5 vecinos propietarios', reward: 1_500, done: (s) => s.citizens.filter((c) => c.owns).length >= 5 },
  { id: 'cincuenta', text: 'Llega a 50 vecinos', reward: 5_000, unlock: 'plaza', done: (s) => s.citizens.length >= 50 },
  { id: 'promesa', text: 'Cumple una promesa del pleno', reward: 1_500, done: (s) => s.promises.some((p) => p.status === 'kept') },
  { id: 'sin_deuda', text: 'Cierra 6 meses seguidos con superávit (con 30 vecinos o más)', reward: 2_000, done: (s) => s.citizens.length >= 30 && s.stats.length >= 6 && s.stats.slice(-6).every((m) => ownIncome(m) >= m.expenses) },
  { id: 'doscientos', text: 'Llega a 200 vecinos', reward: 10_000, unlock: 'market', done: (s) => s.citizens.length >= 200 },
  { id: 'elecciones', text: 'Gana unas elecciones con rival', reward: 3_000, done: (s) => s.politics.history.some((h) => h.winner === 'player' && !h.unopposed) },
];

/** Siempre hay de 1 a 3 objetivos visibles. */
export function activeObjectives(state: GameState): ObjectiveDef[] {
  return OBJECTIVES.filter((o) => !state.objectivesDone.includes(o.id)).slice(0, 3);
}

function completeObjective(state: GameState, id: string): void {
  const o = OBJECTIVES.find((x) => x.id === id);
  if (!o || state.objectivesDone.includes(id)) return;
  state.objectivesDone.push(id);
  transfer(state, OUTSIDE, TREASURY, o.reward, 'subvenciones');
  if (o.unlock) state.unlocked.push(o.unlock);
  const extra = o.unlock === 'plaza' ? ' Desbloqueas la Plaza Mayor.' : o.unlock === 'market' ? ' Desbloqueas el Mercado.' : '';
  pushEvent(state, 'milestone', `Objetivo cumplido: ${o.text}. La región te da ${o.reward} €.${extra}`);
}

function checkObjectives(state: GameState): void {
  for (const o of activeObjectives(state)) if (o.done(state)) completeObjective(state, o.id);
}

/* ---------------- ciclo diario ---------------- */

export function socialDay(state: GameState): void {
  if (state.pleno && state.tick - state.pleno.tick >= PLENO_OPEN_TICKS) {
    closePleno(state);
    pushEvent(state, 'info', 'El pleno se cerró solo: lo que no respondiste queda sin respuesta');
  }
  updateRelations(state);
  directStories(state);
  checkPromises(state);
  checkObjectives(state);
  if (state.tick % TICKS_PER_MONTH === 0) for (const c of state.citizens) if (c.named) c.summary = narrativeSummary(state, c);
}

/* ---------------- 2.4 (bloque D): plenos hablados ---------------- */

export const PLENO_ROLES = ['pide', 'oposicion', 'a_favor', 'en_contra'] as const;
export type PlenoRole = (typeof PLENO_ROLES)[number];
export const PLENO_STANCES = ['a_favor', 'en_contra', 'matiz'] as const;
export type PlenoStance = (typeof PLENO_STANCES)[number];
export const PLENO_REACTIONS = ['aplaude', 'murmura', 'abuchea', 'se_levanta'] as const;
export type PlenoReaction = (typeof PLENO_REACTIONS)[number];
export const PLENO_REACTION_TEXT: Record<PlenoReaction, string> = { aplaude: 'aplaude', murmura: 'murmura', abuchea: 'abuchea', se_levanta: 'se levanta y se va' };

/** Quien habla en el pleno (datos del motor). El texto de su intervención no entra en el estado. */
export interface PlenoSpeaker {
  id: number;
  role: PlenoRole;
  postura: PlenoStance;
  /** La petición de la que habla. */
  petitionId: number;
  /** Respuesta del alcalde a esa petición, esperando su reacción (Modo IA: en la reacción rápida). */
  waiting?: 'promise' | 'reject';
  reaction?: PlenoReaction;
}

/**
 * Hasta `PLENO_TALK.speakers` intervenciones: quien pide, la oposición si
 * pregunta, un vecino a favor (de los que apoyan) y uno en contra (de los que
 * no). Determinista: sin dados.
 */
export function plenoSpeakers(state: GameState, petitions: Petition[]): PlenoSpeaker[] {
  const out: PlenoSpeaker[] = [];
  const main = petitions.find((p) => !p.opposition) ?? petitions[0];
  if (!main) return out;
  const named = (id: number) => state.citizens.find((c) => c.id === id && c.named);
  const add = (id: number, role: PlenoRole, postura: PlenoStance, petitionId: number) => {
    if (out.length >= PLENO_TALK.speakers || out.some((s) => s.id === id) || !named(id)) return;
    out.push({ id, role, postura, petitionId });
  };
  add(main.citizenId, 'pide', 'a_favor', main.id);
  const opp = petitions.find((p) => p.opposition);
  if (opp) add(opp.citizenId, 'oposicion', 'matiz', opp.id);
  const taken = (c: Citizen) => out.some((s) => s.id === c.id);
  const fav = main.supporters
    .map((id) => named(id))
    .filter((c): c is Citizen => !!c && !taken(c))
    .sort((a, b) => b.traits.social - a.traits.social || a.id - b.id)[0];
  if (fav) add(fav.id, 'a_favor', 'a_favor', main.id);
  const against = state.citizens
    .filter((c) => c.named && !taken(c) && !main.supporters.includes(c.id) && !wantsNeed(state, c, main.need))
    .sort((a, b) => b.traits.terco - a.traits.terco || a.id - b.id)[0];
  if (against) add(against.id, 'en_contra', 'en_contra', main.id);
  return out;
}

/** ¿Este vecino reacciona con IA? (como `isAiCitizen` en turns.ts, sin importarlo: evita el ciclo). */
const thinksWithAi = (state: GameState, c: Citizen) => state.aiMode && c.named && !!state.ai && state.ai.share > 0;

/** Reacción por reglas: según su postura, su terquedad y lo que respondió el alcalde. */
export function plenoReactionRule(c: Citizen, s: PlenoSpeaker, answer: 'promise' | 'reject'): PlenoReaction {
  const stubborn = c.traits.terco >= 60;
  if (s.postura === 'en_contra') return answer === 'promise' ? (stubborn ? 'abuchea' : 'murmura') : 'aplaude';
  if (s.postura === 'matiz') return answer === 'promise' ? 'murmura' : 'abuchea';
  return answer === 'promise' ? 'aplaude' : stubborn ? 'se_levanta' : 'abuchea';
}

/** Efecto determinista de una reacción: ánimo (`PLENO_TALK.reaction`), recuerdo y aviso. */
export function applyPlenoReaction(state: GameState, c: Citizen, s: PlenoSpeaker, r: PlenoReaction): string {
  s.reaction = r;
  delete s.waiting;
  const delta = PLENO_TALK.reaction[r] ?? 0;
  c.happiness = Math.max(0, Math.min(100, c.happiness + delta));
  if (delta < 0) c.grudge = Math.min(GRUDGE_MAX, c.grudge + 1);
  addMemory(state, c, delta >= 0 ? 'pleno_aplaudio' : 'pleno_protesto', 2, Math.sign(delta));
  pushEvent(state, 'info', `${c.name.split(' ')[0]} ${PLENO_REACTION_TEXT[r]} en el pleno`, { ref: c.id });
  return `${PLENO_REACTION_TEXT[r]} en el pleno`;
}

/**
 * Al responder una petición: los que hablaron de ella reaccionan. En Modo IA,
 * los vecinos con IA esperan a la reacción rápida (`reaccion_pleno:<enum>`);
 * el resto, por reglas, al momento.
 */
function plenoAnswered(state: GameState, p: Petition, answer: 'promise' | 'reject'): void {
  for (const s of state.pleno?.speakers ?? []) {
    if (s.petitionId !== p.id || s.reaction) continue;
    const c = state.citizens.find((x) => x.id === s.id);
    if (!c) continue;
    if (thinksWithAi(state, c)) s.waiting = answer;
    else applyPlenoReaction(state, c, s, plenoReactionRule(c, s, answer));
  }
}

/** Los que aún esperan reaccionan por reglas (al cerrar el pleno o si la reacción rápida cae en reglas). */
export function settlePlenoReactions(state: GameState, ids?: number[]): void {
  for (const s of state.pleno?.speakers ?? []) {
    if (!s.waiting || s.reaction || (ids && !ids.includes(s.id))) continue;
    const c = state.citizens.find((x) => x.id === s.id);
    if (c) applyPlenoReaction(state, c, s, plenoReactionRule(c, s, s.waiting));
    else delete s.waiting;
  }
}

/** ¿Hay alguien con IA esperando a reaccionar a esta petición? (para pedir la reacción rápida). */
export function plenoAwaits(state: GameState, petitionId: number): boolean {
  return (state.pleno?.speakers ?? []).some((s) => s.petitionId === petitionId && !s.reaction && state.citizens.some((c) => c.id === s.id && thinksWithAi(state, c)));
}

/** Vecinos que la reacción rápida tiene que incluir: los que hablaron y esperan. */
export function plenoQuickIds(state: GameState): number[] {
  return (state.pleno?.speakers ?? []).filter((s) => s.waiting && !s.reaction).map((s) => s.id);
}

/** Menú de la reacción rápida para quien habló: las 4 reacciones, con lo que respondió el alcalde. */
export function plenoReactionMenu(state: GameState, c: Citizen): { accion: string; detalle: string }[] {
  const s = state.pleno?.speakers?.find((x) => x.id === c.id && x.waiting && !x.reaction);
  const p = s && state.pleno?.petitions.find((x) => x.id === s.petitionId);
  if (!s || !p) return [];
  const what = `${s.waiting === 'promise' ? 'el alcalde promete' : 'el alcalde rechaza'} ${NEED_TEXT[p.need]} (habló ${s.postura === 'a_favor' ? 'a favor' : s.postura === 'en_contra' ? 'en contra' : 'con matices'})`;
  return PLENO_REACTIONS.map((r) => ({ accion: `reaccion_pleno:${r}`, detalle: `en el pleno ${PLENO_REACTION_TEXT[r]}: ${what}` }));
}

/** La reacción que eligió la IA (validada: tiene que estar esperando y ser del enum). */
export function plenoReactFromTurn(state: GameState, c: Citizen, arg: string | undefined): string {
  const s = state.pleno?.speakers?.find((x) => x.id === c.id && x.waiting && !x.reaction);
  if (!s || !(PLENO_REACTIONS as readonly string[]).includes(arg ?? '')) return 'se queda callado en el pleno';
  return applyPlenoReaction(state, c, s, arg as PlenoReaction);
}

