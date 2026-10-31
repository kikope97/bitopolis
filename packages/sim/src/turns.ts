import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { protestFor, type Association } from './associations.ts';
import { DEBT, KIDS_MAX, TURN } from './balance.ts';
import { BUILD_NAMES, removeBuilding } from './commands.ts';
import { homeRobbery } from './crime.ts';
import { canBuyHome, canFound, shopTypesFor } from './economy.ts';
import { hash32 } from './hash.ts';
import { totalDebt } from './household.ts';
import { jobsOf } from './levels.ts';
import { addMemory, goalFor, NEED_TEXT, needsOf, PROFESSIONS, relation, setRelation } from './social.ts';
import { transfer } from './money.ts';
import { type Building, type Citizen, DESIRES, FEARS, type GameState, pushEvent, type Trigger } from './state.ts';

/**
 * 2.0 (petición del creador): «la superIA del pueblo». En Modo IA, los vecinos
 * con IA no esperan a un detonante: cada turno (una semana de juego, más a x3 y
 * x10) la IA decide de golpe, por lotes, qué hace cada uno (acción, gesto con
 * otro vecino, actitud hacia el alcalde, plan, dónde gasta y lo que piensa).
 *
 * La IA decide quién, qué y cuándo; el motor decide cuánto y si sale bien: el
 * menú de acciones lo calcula el motor con datos reales y cada parte se valida
 * al aplicarla. Lo que llega de la IA entra como un comando `TownTurn` en el lote
 * del día (el servidor lo reproduce y el hash cuadra). Si la IA no llega a
 * tiempo, deciden las reglas de siempre («por costumbre»).
 */

export const GESTURES = ['ninguno', 'acercarse', 'enfadarse', 'hacer_las_paces', 'pedir_salir', 'romper'] as const;
export type Gesture = (typeof GESTURES)[number];
export const PLANS = ['ninguno', 'irse_si_no', 'protestar_si_no', 'votar_en_contra_si_no'] as const;
export type PlanKind = (typeof PLANS)[number];
export const SPEND = ['pueblo', 'fuera', 'ahorrar'] as const;
export type SpendPref = (typeof SPEND)[number];

/** Estado de la IA del pueblo (en `state.ai`). */
export interface TownAi {
  /** % de vecinos que piensan con IA (los demás, por reglas). */
  share: number;
  /** Días de juego entre turnos (7 a x1; el cliente lo alarga a x3/x10 con `SetTurnPace`). */
  paceDays: number;
  /** Turno abierto esperando a la IA, o null. */
  turn: { n: number; opened: number; due: number; kind: 'semana' | 'rapida'; reason?: string; ids: number[] } | null;
  /** Último número de turno y cuándo toca el siguiente. */
  lastN: number;
  next: number;
  /** Lo que ha hecho el alcalde desde el último turno (para que la IA reaccione). */
  mayor: { tick: number; text: string; big: boolean }[];
  /** Reacción rápida pendiente a una medida gorda. */
  quick: string | null;
  lastQuick: number;
  /** «Qué está pasando»: lo que se decidió en cada turno (los últimos). */
  log: TurnLog[];
}

export interface TurnLog {
  n: number;
  tick: number;
  source: 'ia' | 'reglas';
  kind: 'semana' | 'rapida';
  /** Una línea por vecino con algo que contar (acción, gesto o plan). */
  lines: { id: number; text: string; motivo?: string }[];
  /** Foco y crónica del director (fase 2). */
  focus?: string;
  chronicle?: string;
}

/** Lo que la IA decide para un vecino en un turno (validado por zod y por el motor). */
export interface TurnAct {
  vecino: number;
  accion: string;
  gesto: { con: number; tipo: string };
  actitud: number;
  gasto: { donde: string; tienda: number; ocio: boolean };
  plan: { tipo: string; necesidad: string; meses: number };
  pensamiento: string;
  motivo: string;
}

export function emptyTownAi(share = TURN.defaultShare): TownAi {
  return { share, paceDays: TURN.days, turn: null, lastN: 0, next: TURN.days * TICKS_PER_DAY, mayor: [], quick: null, lastQuick: -1e9, log: [] };
}

/** ¿Este vecino piensa con IA? (Modo IA y vecino con nombre: el % decide quién lo tiene.) */
export function isAiCitizen(state: GameState, c: Citizen): boolean {
  return state.aiMode && c.named && !!state.ai;
}

/** En Modo IA, ¿le toca IA a este vecino nuevo? Fijo por su id: al subir el %, solo se añaden. */
export function aiByShare(state: GameState, id: number): boolean {
  const share = state.ai?.share ?? 0;
  return hash32(state.seed, id, 77) % 100 < share;
}

/* ---------------- lo que hace el alcalde ---------------- */

/** El motor apunta lo que hace el alcalde (texto del motor, nunca del jugador). Las medidas gordas piden reacción rápida. */
export function noteMayor(state: GameState, text: string, big = false): void {
  const ai = state.ai;
  if (!ai || !state.aiMode) return;
  ai.mayor.push({ tick: state.tick, text, big });
  if (ai.mayor.length > TURN.mayorLog) ai.mayor.splice(0, ai.mayor.length - TURN.mayorLog);
  if (big && state.tick - ai.lastQuick >= TICKS_PER_DAY) ai.quick = text;
}

/* ---------------- menú de acciones de cada vecino ---------------- */

export interface MenuItem {
  accion: string;
  detalle?: string;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function home(state: GameState, c: Citizen): Building | undefined {
  return state.buildings.find((b) => b.id === c.homeId);
}

function vacantJobs(state: GameState, c: Citizen): Building[] {
  const used = new Map<number, number>();
  for (const x of state.citizens) if (x.jobId !== null) used.set(x.jobId, (used.get(x.jobId) ?? 0) + 1);
  const h = home(state, c);
  return state.buildings
    .filter((b) => b.built && !b.damaged && Math.min(jobsOf(b), b.staff ?? Infinity) > (used.get(b.id) ?? 0) && b.id !== c.jobId)
    .sort((a, b) => (h ? dist(a, h) - dist(b, h) : a.id - b.id) || a.id - b.id)
    .slice(0, 3);
}

function freeHomesFor(state: GameState, c: Citizen): Building[] {
  const use = new Map<number, number>();
  for (const x of state.citizens) if (x.homeId !== null) use.set(x.homeId, (use.get(x.homeId) ?? 0) + 1);
  const cap = (b: Building) => (b.built ? (b.kind === 'house' ? 3 : b.kind === 'res' ? 4 : 0) : 0);
  return state.buildings
    .filter((b) => b.id !== c.homeId && cap(b) > (use.get(b.id) ?? 0))
    .sort((a, b) => (state.fields.land[b.y * state.map.w + b.x] ?? 0) - (state.fields.land[a.y * state.map.w + a.x] ?? 0) || a.id - b.id)
    .slice(0, 2);
}

function ownBusiness(state: GameState, c: Citizen): Building | undefined {
  return state.buildings.find((b) => b.owner === c.id && (b.kind === 'shop' || b.kind === 'factory') && b.built);
}

function associationFor(state: GameState, c: Citizen): Association | undefined {
  return state.associations?.find((a) => a.members.includes(c.id));
}

function partnerOf(state: GameState, c: Citizen): Citizen | undefined {
  const r = c.relations.find((x) => x.kind === 'pareja');
  return r ? state.citizens.find((x) => x.id === r.id) : undefined;
}

/** ¿Está desesperado? (solo así puede robar). */
function desperate(c: Citizen): boolean {
  return totalDebt(c) >= DEBT.noticeable && c.money === 0 && c.jobId === null;
}

/** Acciones que el motor permite ahora a un vecino (lo que se manda a la IA y se valida al aplicar). */
export function turnMenu(state: GameState, c: Citizen): MenuItem[] {
  const out: MenuItem[] = [{ accion: 'seguir', detalle: 'seguir con su vida como hasta ahora' }];
  const pol = state.politics;
  // Elecciones a la vista: decide su voto (secreto).
  if (pol.party !== null && pol.nextElection - state.tick <= 10 * TICKS_PER_DAY && !c.vote) {
    out.push({ accion: 'votar_gobierno' }, { accion: 'votar_oposicion' }, { accion: 'abstenerse' });
  }
  const assoc = protestFor(state, c);
  if (assoc && c.protest !== assoc.id && c.protest !== -assoc.id) out.push({ accion: 'manifestarse', detalle: `la asociación «${assoc.name}» convoca una manifestación` }, { accion: 'no_ir' });
  // Trabajo.
  for (const b of vacantJobs(state, c)) out.push({ accion: `aceptar_trabajo:${b.id}`, detalle: `empleo en ${(b.name ?? BUILD_NAMES[b.kind] ?? b.kind).toString()}` });
  if (c.jobId !== null) out.push({ accion: 'dimitir', detalle: 'dejar su trabajo en el pueblo' });
  // Vivienda.
  for (const b of freeHomesFor(state, c)) out.push({ accion: `mudarse:${b.id}`, detalle: `mudarse a ${b.kind === 'house' ? 'una casa' : 'un piso'} libre` });
  if (canBuyHome(state, c)) out.push({ accion: 'comprar_casa', detalle: 'comprar la vivienda en la que vive (con hipoteca)' });
  // Negocio.
  if (canFound(state, c)) for (const t of shopTypesFor(state, c)) out.push({ accion: `fundar:${t}`, detalle: `abrir un negocio (${t})` });
  const biz = ownBusiness(state, c);
  if (biz) {
    const workers = state.citizens.filter((x) => x.jobId === biz.id).length;
    const k = biz.books;
    const result = k ? `el mes pasado vendió ${k.sales} €, pagó ${k.wages} € en sueldos` : 'aún sin cuentas';
    if ((biz.staff ?? Infinity) < jobsOf(biz)) out.push({ accion: 'contratar', detalle: `contratar a alguien más en ${biz.name ?? 'su negocio'} (${result})` });
    if (workers > 1) out.push({ accion: 'despedir', detalle: `despedir a alguien de ${biz.name ?? 'su negocio'} (${result})` });
    out.push({ accion: 'cerrar_negocio', detalle: `cerrar ${biz.name ?? 'su negocio'} (${result})` });
  }
  // Asociaciones.
  const mine = associationFor(state, c);
  if (mine) out.push({ accion: 'dejar_asociacion', detalle: `dejar «${mine.name}»` });
  else for (const a of (state.associations ?? []).slice(0, 2)) out.push({ accion: `unirse_asociacion:${a.id}`, detalle: `unirse a «${a.name}»` });
  // Pedir y quejarse.
  for (const n of needsOf(state, c).slice(0, 2)) out.push({ accion: `pedir:${n}`, detalle: `pedir al alcalde ${NEED_TEXT[n]}` });
  out.push({ accion: 'quejarse', detalle: 'quejarse al ayuntamiento' });
  // Deudas.
  if (totalDebt(c) >= DEBT.noticeable) {
    out.push({ accion: 'apretarse', detalle: 'apretarse el cinturón para pagar lo que debe' });
    if (c.debt && c.debt.town >= DEBT.noticeable && !c.debt.plan) out.push({ accion: 'pedir_aplazamiento', detalle: 'pedir al alcalde que le aplace la deuda con el ayuntamiento' });
  }
  // Familia.
  const p = partnerOf(state, c);
  if (p && p.homeId === c.homeId && c.homeId !== null && Math.max(c.age, p.age) <= 45 && Math.min(c.age, p.age) >= 20 && (c.kids?.length ?? 0) < KIDS_MAX) {
    out.push({ accion: 'tener_hijo', detalle: `tener un hijo con ${p.name.split(' ')[0]}` });
  }
  // Solo si está desesperado: robar en una casa del pueblo.
  if (desperate(c)) out.push({ accion: 'robar', detalle: 'robar en una casa del pueblo (está sin dinero, sin trabajo y endeudado)' });
  out.push({ accion: 'irse', detalle: 'irse del pueblo y vender lo que tenga' });
  return out;
}

/** Con quién puede tener un gesto: sus relaciones, compañeros de casa o trabajo y algún vecino cercano. */
export function gestureCandidates(state: GameState, c: Citizen): Citizen[] {
  const ids = new Set<number>(c.relations.map((r) => r.id));
  for (const x of state.citizens) {
    if (x === c || !x.named) continue;
    if ((x.homeId !== null && x.homeId === c.homeId) || (x.jobId !== null && x.jobId === c.jobId)) ids.add(x.id);
  }
  const h = home(state, c);
  if (h) {
    const near = state.citizens
      .filter((x) => x !== c && x.named && !ids.has(x.id))
      .map((x) => ({ x, d: (() => { const hx = home(state, x); return hx ? dist(hx, h) : 99; })() }))
      .sort((a, b) => a.d - b.d || a.x.id - b.x.id)
      .slice(0, 2);
    for (const n of near) ids.add(n.x.id);
  }
  return [...ids].map((id) => state.citizens.find((x) => x.id === id)).filter((x): x is Citizen => !!x).slice(0, 6);
}

/* ---------------- acciones nuevas (también para las reglas) ---------------- */

/** Acciones de la 2.0 que no existían como decisión. Devuelve el efecto o null si no es suya. */
export function extraAction(state: GameState, c: Citizen, verb: string, arg: string | undefined): string | null {
  switch (verb) {
    case 'seguir':
      return 'sigue con su vida';
    case 'dimitir': {
      const job = state.buildings.find((b) => b.id === c.jobId);
      c.jobId = null;
      return `deja su trabajo${job ? ` en ${(job.name ?? BUILD_NAMES[job.kind] ?? '').toString()}` : ''}`;
    }
    case 'mudarse': {
      const b = state.buildings.find((x) => x.id === Number(arg));
      if (!b || c.owns) return 'no consigue mudarse';
      c.homeId = b.id;
      c.rentArrears = 0;
      return `se muda a ${b.kind === 'house' ? 'otra casa' : 'otro piso'} del pueblo`;
    }
    case 'contratar': {
      const biz = ownBusiness(state, c);
      if (!biz) return 'no tiene negocio';
      biz.staff = Math.min(jobsOf(biz), (biz.staff ?? jobsOf(biz)) + 1);
      return `busca a alguien más para ${biz.name ?? 'su negocio'}`;
    }
    case 'despedir': {
      const biz = ownBusiness(state, c);
      if (!biz) return 'no tiene negocio';
      const ws = state.citizens.filter((x) => x.jobId === biz.id);
      const out = ws.at(-1);
      if (!out || ws.length <= 1) return 'no tiene a quién despedir';
      out.jobId = null;
      addMemory(state, out, 'perdio_trabajo', 4, -4, [c.id]);
      biz.staff = ws.length - 1;
      return `despide a ${out.name} de ${biz.name ?? 'su negocio'}`;
    }
    case 'cerrar_negocio': {
      const biz = ownBusiness(state, c);
      if (!biz) return 'no tiene negocio';
      const name = biz.name ?? 'su negocio';
      // La caja del negocio vuelve a su dueño; los empleados, al paro.
      for (const w of state.citizens.filter((x) => x.jobId === biz.id)) w.jobId = null;
      if (biz.cash > 0) transfer(state, biz.id, c.id, biz.cash);
      removeBuilding(state, biz.id);
      addMemory(state, c, 'cerro_negocio', 4, -3);
      c.closedUntil = state.tick + 6 * TICKS_PER_MONTH;
      return `cierra ${name}`;
    }
    case 'unirse_asociacion': {
      const a = state.associations?.find((x) => x.id === Number(arg));
      if (!a || a.members.includes(c.id)) return 'no se une';
      a.members.push(c.id);
      addMemory(state, c, 'asociacion', 3, 1);
      return `se une a «${a.name}»`;
    }
    case 'dejar_asociacion': {
      const a = associationFor(state, c);
      if (!a) return 'no estaba en ninguna asociación';
      a.members = a.members.filter((id) => id !== c.id);
      if (a.leaderId === c.id && a.members.length) a.leaderId = a.members[0]!;
      return `deja «${a.name}»`;
    }
    case 'tener_hijo': {
      const p = partnerOf(state, c);
      if (!p || (c.kids?.length ?? 0) >= KIDS_MAX) return 'no llega a tener el hijo';
      c.kids = [...(c.kids ?? []), state.tick];
      p.kids = [...(p.kids ?? []), state.tick];
      addMemory(state, c, 'nacio_hijo', 5, 6, [p.id]);
      addMemory(state, p, 'nacio_hijo', 5, 6, [c.id]);
      pushEvent(state, 'milestone', `${c.name.split(' ')[0]} y ${p.name.split(' ')[0]} tienen un bebé`, { ref: c.id });
      return 'tiene un bebé';
    }
    case 'robar': {
      if (!desperate(c)) return 'se lo piensa mejor y no roba';
      const targets = state.buildings.filter((b) => (b.kind === 'house' || b.kind === 'res') && b.built && b.id !== c.homeId);
      if (!targets.length) return 'no encuentra dónde robar';
      // El sitio lo elige el motor (determinista); que robe lo decidió la IA.
      const t = targets[hash32(state.seed, c.id, state.tick) % targets.length]!;
      homeRobbery(state, t, c);
      return 'intenta robar en una casa del pueblo';
    }
  }
  return null;
}

/* ---------------- aplicar un turno ---------------- */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

function applyGesture(state: GameState, c: Citizen, other: Citizen | undefined, tipo: string): string | null {
  if (!other || other === c || tipo === 'ninguno' || !(GESTURES as readonly string[]).includes(tipo)) return null;
  const r = relation(c, other.id);
  const first = other.name.split(' ')[0];
  switch (tipo as Gesture) {
    case 'acercarse':
      if (!r) {
        if (c.relations.length >= 5 || other.relations.length >= 5) return null;
        setRelation(state, c, other, 'amistad', 20);
      } else if (r.kind === 'amistad' || r.kind === 'pareja') setRelation(state, c, other, r.kind, Math.min(100, r.strength + 10));
      else return null;
      return `se acerca a ${first}`;
    case 'enfadarse':
      if (r?.kind === 'pareja') return null;
      setRelation(state, c, other, r?.kind === 'rivalidad' ? 'rencor' : 'rivalidad', Math.min(100, (r?.strength ?? 20) + 15));
      return `se enfada con ${first}`;
    case 'hacer_las_paces':
      if (!r || (r.kind !== 'rivalidad' && r.kind !== 'rencor')) return null;
      setRelation(state, c, other, 'amistad', 15);
      addMemory(state, c, 'se_reconcilio', 3, 3, [other.id]);
      addMemory(state, other, 'se_reconcilio', 3, 3, [c.id]);
      return `hace las paces con ${first}`;
    case 'pedir_salir': {
      // Sale bien si ya hay amistad fuerte y los dos están libres (el motor decide si sale bien).
      const free = (x: Citizen) => !x.relations.some((y) => y.kind === 'pareja');
      if (r?.kind === 'amistad' && r.strength >= 50 && free(c) && free(other) && Math.abs(c.age - other.age) <= 15) {
        setRelation(state, c, other, 'pareja', 60);
        addMemory(state, c, 'nueva_pareja', 5, 6, [other.id]);
        addMemory(state, other, 'nueva_pareja', 5, 6, [c.id]);
        pushEvent(state, 'info', `${c.name.split(' ')[0]} y ${first} empiezan a salir`, { ref: c.id });
        return `empieza a salir con ${first}`;
      }
      if (r) r.strength = Math.max(0, r.strength - 10);
      return `le pide salir a ${first}, pero no sale bien`;
    }
    case 'romper':
      if (r?.kind !== 'pareja') return null;
      setRelation(state, c, other, 'rencor', 30);
      addMemory(state, c, 'paso_pagina', 4, -4, [other.id]);
      addMemory(state, other, 'paso_pagina', 4, -5, [c.id]);
      pushEvent(state, 'info', `${c.name.split(' ')[0]} y ${first} lo dejan`, { ref: c.id });
      return `lo deja con ${first}`;
  }
  return null;
}

/** ¿Se puede aplicar ahora el turno `n`? */
export function canApplyTurn(state: GameState, n: number): { ok: true } | { ok: false; error: string } {
  const t = state.ai?.turn;
  if (!state.aiMode || !t) return { ok: false, error: 'No hay ningún turno abierto' };
  if (t.n !== n) return { ok: false, error: `El turno ${n} ya no está abierto` };
  return { ok: true };
}

/**
 * Aplica lo que decidió la IA en un turno. Cada vecino se valida por separado:
 * lo que ya no vale se descarta (y ese vecino sigue igual).
 */
export function applyTownTurn(state: GameState, n: number, acts: TurnAct[], extra?: { focus?: string; chronicle?: string }): void {
  const ai = state.ai!;
  const t = ai.turn!;
  const lines: TurnLog['lines'] = [];
  const done = new Set<number>();
  for (const a of acts) {
    const c = state.citizens.find((x) => x.id === a.vecino);
    if (!c || done.has(c.id) || !t.ids.includes(c.id) || !isAiCitizen(state, c)) continue;
    done.add(c.id);
    const parts: string[] = [];
    // Acción principal: solo si está en el menú de ahora.
    const menu = turnMenu(state, c).map((m) => m.accion);
    const accion = menu.includes(a.accion) ? a.accion : 'seguir';
    if (accion !== 'seguir') {
      const trigger: Trigger = accion.startsWith('votar') || accion === 'abstenerse' ? 'elecciones' : accion === 'manifestarse' || accion === 'no_ir' ? 'protesta' : 'opinion';
      parts.push(performActionFromTurn(state, c, trigger, accion, a.motivo));
    }
    // Sigue en el pueblo tras su acción (si se fue, no hay más).
    if (!state.citizens.includes(c)) {
      lines.push({ id: c.id, text: `${c.name} ${parts.join('; ')}`, motivo: a.motivo });
      continue;
    }
    const g = applyGesture(state, c, state.citizens.find((x) => x.id === a.gesto?.con && gestureCandidates(state, c).includes(x)), a.gesto?.tipo ?? 'ninguno');
    if (g) parts.push(g);
    c.attitude = clamp(a.actitud ?? 0, -2, 2);
    const donde = (SPEND as readonly string[]).includes(a.gasto?.donde) ? (a.gasto.donde as SpendPref) : 'pueblo';
    const shop = state.buildings.find((b) => b.id === a.gasto?.tienda && b.kind === 'shop' && b.built);
    c.spending = { where: donde, shop: shop?.id, leisure: !!a.gasto?.ocio && donde !== 'ahorrar' };
    const tipo = (PLANS as readonly string[]).includes(a.plan?.tipo) ? (a.plan.tipo as PlanKind) : 'ninguno';
    const need = needsOf(state, c).includes(a.plan?.necesidad as never) ? (a.plan.necesidad as string) : null;
    if (tipo !== 'ninguno' && need && !c.plan) {
      c.plan = { kind: tipo, need, until: state.tick + clamp(a.plan.meses ?? 3, 1, 6) * TICKS_PER_MONTH, since: state.tick };
      parts.push(`avisa: ${planText(c.plan)}`);
    }
    c.thought = cleanText(a.pensamiento, 160) || c.thought;
    if (parts.length) lines.push({ id: c.id, text: `${c.name} ${parts.join('; ')}`, motivo: cleanText(a.motivo, 160) });
  }
  closeTurn(state, 'ia', lines, extra);
}

/** Texto de un plan o ultimátum para la ficha y el diario. */
export function planText(p: NonNullable<Citizen['plan']>): string {
  const what = NEED_TEXT[p.need as keyof typeof NEED_TEXT] ?? p.need;
  if (p.kind === 'irse_si_no') return `se irá del pueblo si no hay ${what}`;
  if (p.kind === 'protestar_si_no') return `saldrá a protestar si no hay ${what}`;
  return `votará en contra si no hay ${what}`;
}

function cleanText(s: unknown, max: number): string {
  return typeof s === 'string'
    ? s
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f<>`*_#]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : '';
}

// Se resuelve en tiempo de ejecución (evita el ciclo decisions ↔ turns al cargar).
let performImpl: ((state: GameState, c: Citizen, trigger: Trigger, action: string, motivo: string, source: 'ai' | 'rule') => string) | null = null;
export function setPerformImpl(f: typeof performImpl): void {
  performImpl = f;
}
function performActionFromTurn(state: GameState, c: Citizen, trigger: Trigger, action: string, motivo: string): string {
  return performImpl ? performImpl(state, c, trigger, action, motivo, 'ai') : '';
}

function closeTurn(state: GameState, source: 'ia' | 'reglas', lines: TurnLog['lines'], extra?: { focus?: string; chronicle?: string }): void {
  const ai = state.ai!;
  const t = ai.turn!;
  ai.log.push({ n: t.n, tick: state.tick, source, kind: t.kind, lines: lines.slice(0, TURN.logLines), focus: cleanText(extra?.focus, 140) || undefined, chronicle: cleanText(extra?.chronicle, 600) || undefined });
  if (ai.log.length > TURN.logTurns) ai.log.splice(0, ai.log.length - TURN.logTurns);
  // Lo del alcalde ya se ha contado.
  ai.mayor = ai.mayor.filter((m) => m.tick > t.opened);
  if (t.kind === 'semana') ai.next = t.opened + ai.paceDays * TICKS_PER_DAY;
  ai.turn = null;
}

/* ---------------- abrir, vencer y planes ---------------- */

/** Vecinos de un turno: todos los vecinos con IA (o, en una reacción rápida, los más afectados). */
function turnIds(state: GameState, kind: 'semana' | 'rapida'): number[] {
  const ai = state.citizens.filter((c) => isAiCitizen(state, c));
  if (kind === 'semana') return ai.slice(0, TURN.maxCitizens).map((c) => c.id);
  // Reacción rápida: los que peor lo llevan y los que más rencor guardan primero.
  return [...ai]
    .sort((a, b) => b.grudge - a.grudge || a.happiness - b.happiness || a.id - b.id)
    .slice(0, TURN.quickCitizens)
    .map((c) => c.id);
}

/**
 * Cada hora: abre turno cuando toca (o una reacción rápida tras una medida gorda)
 * y, si vence sin respuesta de la IA, deciden las reglas.
 */
export function turnsTick(state: GameState, ruleFallback: (state: GameState, ids: number[]) => TurnLog['lines']): void {
  const ai = state.ai;
  if (!state.aiMode || !ai || ai.share <= 0) return;
  const t = ai.turn;
  if (t) {
    if (state.tick >= t.due) closeTurn(state, 'reglas', ruleFallback(state, t.ids));
    return;
  }
  // Solo se abren turnos al empezar el día (estable para el cliente y el servidor).
  if (state.tick % TICKS_PER_DAY !== 0) return;
  let kind: 'semana' | 'rapida' | null = null;
  if (state.tick >= ai.next) kind = 'semana';
  else if (ai.quick) kind = 'rapida';
  if (!kind) return;
  const ids = turnIds(state, kind);
  if (!ids.length) {
    if (kind === 'semana') ai.next = state.tick + ai.paceDays * TICKS_PER_DAY;
    ai.quick = null;
    return;
  }
  ai.lastN++;
  ai.turn = { n: ai.lastN, opened: state.tick, due: state.tick + TURN.dueHours, kind, reason: kind === 'rapida' ? ai.quick ?? undefined : undefined, ids };
  if (kind === 'rapida') {
    ai.lastQuick = state.tick;
    ai.quick = null;
  }
}

/** Una vez al día: planes y ultimátums que vencen (el motor comprueba si se cumplió lo que pedían). */
export function plansDay(state: GameState, leave: (c: Citizen) => void): void {
  for (const c of [...state.citizens]) {
    const p = c.plan;
    if (!p || p.until > state.tick) continue;
    delete c.plan;
    const met = !needsOf(state, c).slice(0, 3).includes(p.need as never);
    if (met) {
      addMemory(state, c, 'promesa_cumplida', 3, 3);
      pushEvent(state, 'info', `${c.name} está más tranquilo: ya hay ${NEED_TEXT[p.need as keyof typeof NEED_TEXT] ?? p.need}`, { ref: c.id });
      continue;
    }
    addMemory(state, c, 'promesa_rota', 4, -4);
    if (p.kind === 'irse_si_no') {
      pushEvent(state, 'departure', `${c.name} cumple su palabra y se va del pueblo: no hubo ${NEED_TEXT[p.need as keyof typeof NEED_TEXT] ?? p.need}`, { ref: c.id });
      leave(c);
    } else {
      c.grudge = Math.min(40, c.grudge + 10);
      if (p.kind === 'votar_en_contra_si_no') c.attitude = -2;
      pushEvent(state, 'info', `${c.name} se siente engañado: no hubo ${NEED_TEXT[p.need as keyof typeof NEED_TEXT] ?? p.need}`, { ref: c.id });
    }
  }
}

/** Cuántas horas faltan para que venza el turno abierto (para el cliente). */
export function turnDueIn(state: GameState): number | null {
  const t = state.ai?.turn;
  return t ? t.due - state.tick : null;
}

/* ---------------- % de vecinos con IA ---------------- */

/**
 * Cambia el % de vecinos con IA. Al subirlo, los vecinos sin nombre a los que
 * ahora les toca (fijo por su id) pasan a tener nombre, rasgos y voz propia; al
 * bajarlo, solo cambia para los que lleguen (nadie pierde lo que ya es).
 */
export function setAiShare(state: GameState, share: number): void {
  const ai = state.ai!;
  ai.share = Math.max(0, Math.min(100, Math.round(share)));
  let named = state.citizens.filter((c) => c.named).length;
  for (const c of state.citizens) {
    if (c.named || named >= TURN.maxNamed || !aiByShare(state, c.id)) continue;
    named++;
    const h = (k: number) => hash32(state.seed, c.id, k);
    c.named = true;
    c.traits = { terco: h(1) % 101, ahorro: h(2) % 101, social: h(3) % 101, ambicion: h(4) % 101 };
    c.desire = DESIRES[h(5) % DESIRES.length]!;
    c.fear = FEARS[h(6) % FEARS.length]!;
    c.profession = PROFESSIONS[h(7) % PROFESSIONS.length]!;
    c.goal = goalFor(c.desire);
  }
}

/* ---------------- lo que hace el alcalde, en palabras ---------------- */

const LEVEL: Record<string, string> = { low: 'bajos', medium: 'medios', high: 'altos', none: 'sin mínimo' };

/** Texto (del motor) de lo que acaba de hacer el alcalde; `big` si merece reacción rápida del pueblo. */
export function mayorText(state: GameState, cmd: { type: string } & Record<string, unknown>): { text: string; big: boolean } | null {
  if (!state.aiMode) return null;
  const bname = (id: unknown) => {
    const b = state.buildings.find((x) => x.id === id);
    return b ? (b.name ?? BUILD_NAMES[b.kind] ?? b.kind) : 'un edificio';
  };
  const cname = (id: unknown) => state.citizens.find((x) => x.id === id)?.name ?? 'un vecino';
  switch (cmd.type) {
    case 'Build':
      return cmd.kind === 'road' ? null : { text: `manda construir ${(BUILD_NAMES[cmd.kind as string] ?? String(cmd.kind)).toLowerCase()}`, big: false };
    case 'Zone':
      return cmd.zone === 'none' ? null : { text: `marca zona ${cmd.zone === 'R' ? 'residencial' : cmd.zone === 'C' ? 'comercial' : 'industrial'}`, big: false };
    case 'Demolish': {
      const b = state.buildings.find((x) => x.x === cmd.x && x.y === cmd.y);
      return b ? { text: `derriba ${(b.name ?? BUILD_NAMES[b.kind] ?? b.kind).toLowerCase()}`, big: b.kind === 'house' || b.kind === 'res' || b.kind === 'shop' } : null;
    }
    case 'SetTax': {
      const up = (cmd.level === 'high' && state.taxLevel !== 'high') || (cmd.level === 'medium' && state.taxLevel === 'low');
      return { text: `pone los impuestos ${LEVEL[cmd.level as string]}`, big: up };
    }
    case 'SetTaxes': {
      const parts = (['ibi', 'tasas', 'plusvalia'] as const).filter((k) => cmd[k] && cmd[k] !== state.taxes[k]).map((k) => `${k === 'ibi' ? 'el IBI' : k === 'tasas' ? 'las tasas' : 'la plusvalía'} ${LEVEL[cmd[k] as string]}`);
      if (!parts.length) return null;
      const up = (['ibi', 'tasas', 'plusvalia'] as const).some((k) => cmd[k] && (cmd[k] === 'high' || (cmd[k] === 'medium' && state.taxes[k] === 'low')) && cmd[k] !== state.taxes[k]);
      return { text: `pone ${parts.join(', ')}`, big: up };
    }
    case 'SetMinimumWage':
      return { text: cmd.level === 'none' ? 'quita el sueldo mínimo' : `fija un sueldo mínimo ${LEVEL[cmd.level as string]}`, big: true };
    case 'AnswerPetition': {
      const pet = state.pleno?.petitions.find((p) => p.id === cmd.petitionId);
      return pet ? { text: `${cmd.answer === 'promise' ? 'promete' : 'rechaza'} en el pleno lo que pide ${cname(pet.citizenId)}`, big: cmd.answer === 'reject' } : null;
    }
    case 'MeetAssociation':
      return { text: 'se reúne con una asociación de vecinos', big: false };
    case 'SettleDebt':
      return { text: `${cmd.mode === 'perdonar' ? 'perdona' : 'aplaza'} la deuda de ${cname(cmd.citizenId)}`, big: false };
    case 'GrantMicrocredit':
      return { text: `da un microcrédito a ${cname(cmd.citizenId)}`, big: false };
    case 'UpgradeTownhall':
      return { text: 'amplía el ayuntamiento', big: false };
    case 'UpgradeBuilding':
      return { text: `mejora ${bname(cmd.buildingId)}`, big: false };
    case 'RepairBuilding':
      return { text: `paga la reparación de ${bname(cmd.buildingId)}`, big: false };
    case 'ProposeBudget':
      return { text: `presenta un presupuesto ${cmd.plan}`, big: false };
    case 'HoldFestival':
      return { text: `organiza unas fiestas ${cmd.size === 'grande' ? 'grandes' : 'pequeñas'}`, big: false };
    case 'ConvenePleno':
      return { text: 'convoca un pleno', big: false };
    case 'Campaign':
      return { text: `hace campaña con los ${cmd.faction}`, big: false };
    case 'TalkTo':
      return { text: `habla con ${cname(cmd.citizenId)}`, big: false };
  }
  return null;
}
