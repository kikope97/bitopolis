import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { BUILD_NAMES } from './commands.ts';
import { canFound, freeShopLot, taxLevels } from './economy.ts';
import { hash32 } from './hash.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { chance, pick } from './prng.ts';
import type { Citizen, GameState } from './state.ts';
import { pushEvent } from './state.ts';

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
}

export const PROFESSIONS = [
  'panadera', 'maestro', 'fontanera', 'enfermero', 'informática', 'camarero', 'agricultora', 'electricista', 'estudiante', 'jubilado',
] as const;

export const GOALS = ['comprar_casa', 'trabajo_en_el_pueblo', 'parque_cerca', 'tienda_cerca', 'ahorrar', 'vivir_tranquilo'] as const;
export type Goal = (typeof GOALS)[number];

export const HOOK_KINDS = ['mismo_local', 'despido_con_hipoteca', 'promesa_incumplida', 'amigo_se_va'] as const;
export type HookKind = (typeof HOOK_KINDS)[number];
export interface Hook {
  id: number;
  kind: HookKind;
  actors: number[];
  createdTick: number;
  expires: number;
}

export const NEEDS = ['parque', 'colegio', 'centro_salud', 'policia', 'empleo', 'agua_luz', 'bajar_tasas', 'bajar_ibi'] as const;
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
}
export interface Pleno {
  tick: number;
  petitions: Petition[];
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
  c.memories.push({ tick: state.tick, kind, about, importance, valence });
  if (c.memories.length > MEMORY_MAX) {
    // Se olvida el menos importante, ponderado por antigüedad.
    const score = (m: Memory) => m.importance - (state.tick - m.tick) / (TICKS_PER_DAY * 60);
    let worst = 0;
    for (let i = 1; i < c.memories.length; i++) if (score(c.memories[i]!) < score(c.memories[worst]!)) worst = i;
    c.memories.splice(worst, 1);
  }
}

const nameOf = (state: GameState, id: number) => state.citizens.find((c) => c.id === id)?.name.split(' ')[0] ?? 'alguien que ya no vive aquí';

/** Texto de un recuerdo con plantillas del motor. */
export function memoryText(state: GameState, m: Memory): string {
  const who = m.about.map((id) => nameOf(state, id)).join(' y ');
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
  }
}

/** Efecto en la felicidad de los recuerdos recientes. */
export function memoryMood(state: GameState, c: Citizen): number {
  const recent = c.memories.filter((m) => state.tick - m.tick < TICKS_PER_DAY * MEMORY_DAYS);
  return Math.max(-10, Math.min(10, recent.reduce((a, m) => a + m.valence, 0)));
}

/** Resumen narrativo (capa 3): plantilla del motor, máx. ~60 palabras. */
export function narrativeSummary(state: GameState, c: Citizen): string {
  const parts: string[] = [];
  const job = state.buildings.find((b) => b.id === c.jobId);
  parts.push(`${c.name.split(' ')[0]}, ${c.profession}, ${c.age} años.`);
  parts.push(job ? `Trabaja en ${(job.name ?? BUILD_NAMES[job.kind] ?? '').toLowerCase()}.` : 'Trabaja fuera del pueblo.');
  if (c.owns) parts.push(c.mortgage > 0 ? 'Paga la hipoteca de su casa.' : 'Su casa ya es suya.');
  const friends = c.relations.filter((r) => r.kind === 'amistad').map((r) => nameOf(state, r.id));
  if (friends.length) parts.push(`Se lleva bien con ${friends.slice(0, 2).join(' y ')}.`);
  const partner = c.relations.find((r) => r.kind === 'pareja');
  if (partner) parts.push(`Sale con ${nameOf(state, partner.id)}.`);
  const top = [...c.memories].sort((a, b) => b.importance - a.importance)[0];
  if (top) parts.push(`No olvida que ${memoryText(state, top).toLowerCase()}.`);
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

export function goalFor(desire: string): Goal {
  return (
    ({ casa_propia: 'comprar_casa', trabajo_cerca: 'trabajo_en_el_pueblo', parque: 'parque_cerca', tienda: 'tienda_cerca', tranquilidad: 'vivir_tranquilo', prosperar: 'ahorrar' } as const)[
      desire as 'parque'
    ] ?? 'ahorrar'
  );
}

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

function relation(c: Citizen, id: number): Relation | undefined {
  return c.relations.find((r) => r.id === id);
}

function setRelation(state: GameState, a: Citizen, b: Citizen, kind: RelationKind, strength: number): void {
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

/** Las relaciones nacen de compartir casa o trabajo (con el PRNG de la partida). */
function updateRelations(state: GameState): void {
  const named = state.citizens.filter((c) => c.named);
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const a = named[i]!;
      const b = named[j]!;
      const together = (a.homeId !== null && a.homeId === b.homeId) || (a.jobId !== null && a.jobId === b.jobId);
      const r = relation(a, b.id);
      if (!together) continue;
      if (!r) {
        if (chance(state.rng, 0.04 + (a.traits.social + b.traits.social) / 4000)) {
          setRelation(state, a, b, 'amistad', 30);
          addMemory(state, a, 'nueva_amistad', 2, 2, [b.id]);
          addMemory(state, b, 'nueva_amistad', 2, 2, [a.id]);
        }
      } else if (r.kind === 'amistad') {
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

function addHook(state: GameState, kind: HookKind, actors: number[]): void {
  if (state.hooks.length >= HOOKS_MAX) return;
  if (state.hooks.some((h) => h.actors.some((a) => actors.includes(a)))) return;
  state.hooks.push({ id: state.nextId++, kind, actors, createdTick: state.tick, expires: state.tick + TICKS_PER_DAY * 15 });
  // El director se ve también en Modo normal: el gancho sale en el diario.
  const lead = state.citizens.find((c) => c.id === actors[0]);
  if (lead) pushEvent(state, 'info', `${lead.name} ${HOOK_TEXT[kind]}`, { ref: lead.id });
}

/** Ganchos deterministas (varían con la semilla, no compensa recargar). */
function directStories(state: GameState): void {
  state.hooks = state.hooks.filter((h) => h.expires > state.tick && h.actors.every((a) => state.citizens.some((c) => c.id === a)));
  const named = state.citizens.filter((c) => c.named);
  // Dos vecinos quieren el mismo (y único) local.
  const founders = named.filter((c) => canFound(state, c));
  if (founders.length >= 2 && freeShopLot(state) !== null && chance(state.rng, 0.3)) {
    const a = pick(state.rng, founders);
    const b = pick(state.rng, founders.filter((x) => x !== a));
    addHook(state, 'mismo_local', [a.id, b.id]);
    setRelation(state, a, b, 'rivalidad', 40);
  }
  // Se queda sin trabajo con hipoteca.
  for (const c of named) {
    if (c.mortgage > 0 && c.jobId === null && c.money < 800) addHook(state, 'despido_con_hipoteca', [c.id]);
  }
}

export const HOOK_TEXT: Record<HookKind, string> = {
  mismo_local: 'compite con otro vecino por el único local comercial libre',
  despido_con_hipoteca: 'no tiene trabajo en el pueblo y le cuesta pagar la hipoteca',
  promesa_incumplida: 'el alcalde le prometió algo y no lo cumplió',
  amigo_se_va: 'una persona querida se ha ido del pueblo',
};

export function hookFor(state: GameState, citizenId: number): Hook | undefined {
  return state.hooks.find((h) => h.actors.includes(citizenId));
}

/** Si dos querían el mismo local y uno lo consigue, el otro le guarda rencor. */
export function onBusinessFounded(state: GameState, founder: Citizen): void {
  const h = state.hooks.find((x) => x.kind === 'mismo_local' && x.actors.includes(founder.id));
  if (!h) return;
  const other = state.citizens.find((c) => h.actors.includes(c.id) && c.id !== founder.id);
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
};

const NEED_KIND: Partial<Record<Need, string>> = { parque: 'park', colegio: 'school', centro_salud: 'clinic', policia: 'police' };
const LEVEL = { low: 0, medium: 1, high: 2 } as const;

function needBaseline(state: GameState, need: Need): number {
  const kind = NEED_KIND[need];
  // Cuentan también las obras en marcha: prometer lo que ya se está construyendo no vale.
  if (kind) return state.buildings.filter((b) => b.kind === kind).length;
  if (need === 'empleo') return state.citizens.filter((c) => c.jobId === null).length;
  if (need === 'bajar_tasas') return LEVEL[taxLevels(state).tasas];
  if (need === 'bajar_ibi') return LEVEL[taxLevels(state).ibi];
  return state.buildings.filter((b) => b.built && (!b.hasWater || !b.hasPower)).length;
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
  const rest = NEEDS.filter((n) => n !== first && (NEED_KIND[n] ? !state.buildings.some((b) => b.kind === NEED_KIND[n]) : n === 'bajar_tasas' && canLower(state, n)));
  return [first, ...rest.sort((a, b) => (hash32(c.id, a.length) % 7) - (hash32(c.id, b.length) % 7))];
}

/** Lo que pediría un vecino: su carencia más fuerte (datos del motor). */
export function needOf(state: GameState, c: Citizen): Need {
  const home = state.buildings.find((b) => b.id === c.homeId);
  const has = (k: string) => state.buildings.some((b) => b.kind === k && b.built);
  if (home && (!home.hasWater || !home.hasPower)) return 'agua_luz';
  if (c.jobId === null) return 'empleo';
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
  for (const c of named) {
    if (petitions.length >= 3) break;
    const need = needsOf(state, c).find((n) => !petitions.some((p) => p.need === n));
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
  state.pleno = { tick: state.tick, petitions };
  pushEvent(state, 'info', `Pleno municipal: ${petitions.length} peticiones de los vecinos`);
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
  } else {
    for (const id of p.supporters) {
      const c = state.citizens.find((x) => x.id === id);
      if (c) {
        addMemory(state, c, 'peticion_rechazada', 3, -2);
        c.grudge = Math.min(40, c.grudge + 2);
      }
    }
    pushEvent(state, 'info', `El pleno rechaza ${NEED_TEXT[p.need]}`);
  }
  return true;
}

export function closePleno(state: GameState): void {
  if (!state.pleno) return;
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
  const first = c.name.split(' ')[0];
  const pending = state.promises.find((p) => p.status === 'pending' && p.supporters.includes(c.id));
  const broken = state.promises.find((p) => p.status === 'broken' && p.supporters.includes(c.id));
  const v = hash32(c.id, state.tick, q.length) % 3;
  switch (q) {
    case 'como_estas':
      if (c.happiness >= 70) return ['Muy bien, alcalde. Este pueblo me sienta de maravilla.', 'No me puedo quejar, de verdad.', 'Contento. Aquí estoy a gusto.'][v]!;
      if (c.happiness >= 45) return worst ? `Tirando. Lo que más me pesa es esto: ${worst.toLowerCase()}.` : 'Tirando, como todos.';
      return worst ? `Mal, alcalde. ${worst}. Así no se puede.` : 'Mal. Me estoy pensando irme.';
    case 'que_necesitas':
      if (pending) return `Que cumpla lo que prometió: ${NEED_TEXT[pending.need]}.`;
      return `Lo que más falta aquí es ${NEED_TEXT[needOf(state, c)]}.`;
    case 'me_votarias': {
      const score = c.happiness - c.grudge + (broken ? -20 : 0) + (pending ? 5 : 0);
      if (broken) return `¿Después de prometer ${NEED_TEXT[broken.need]} y no cumplir? Lo dudo mucho.`;
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
  { id: 'pleno', text: 'Celebra un pleno (menú ☰ › Pleno municipal)', reward: 500, done: (s) => s.lastPlenoTick >= 0 },
  { id: 'empresa', text: 'Que un vecino abra su negocio', reward: 1_000, done: (s) => s.buildings.some((b) => b.owner > 0) },
  { id: 'propietarios', text: 'Ten 5 vecinos propietarios', reward: 1_500, done: (s) => s.citizens.filter((c) => c.owns).length >= 5 },
  { id: 'cincuenta', text: 'Llega a 50 vecinos', reward: 5_000, unlock: 'plaza', done: (s) => s.citizens.length >= 50 },
  { id: 'promesa', text: 'Cumple una promesa del pleno', reward: 1_500, done: (s) => s.promises.some((p) => p.status === 'kept') },
  { id: 'sin_deuda', text: 'Cierra 6 meses seguidos con superávit (con 30 vecinos o más)', reward: 2_000, done: (s) => s.citizens.length >= 30 && s.stats.length >= 6 && s.stats.slice(-6).every((m) => m.income >= m.expenses) },
  { id: 'doscientos', text: 'Llega a 200 vecinos', reward: 10_000, unlock: 'market', done: (s) => s.citizens.length >= 200 },
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

