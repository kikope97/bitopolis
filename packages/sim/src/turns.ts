import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { protestFor, type Association } from './associations.ts';
import { DEBT, FIRE, KIDS_MAX, LISTS, SEASONS, TOURISM, TURN } from './balance.ts';
import { canPresent, politicsPrune, presentCandidacy } from './politics.ts';
import { BUILD_NAMES, removeBuilding } from './commands.ts';
import { homeRobbery } from './crime.ts';
import { becomeVolunteer, canVolunteer, fireHelpTargets, helpAfterFire, homelessByFire, placeName, shelter } from './fire.ts';
import { canBuyHome, canFound, shopTypesFor } from './economy.ts';
import type { Brewing } from './director-core.ts';
import type { DirectorChoice } from './director.ts';
import { hash32 } from './hash.ts';
import { totalDebt } from './household.ts';
import { jobsOf } from './levels.ts';
import { addMemory, goalFor, NEED_TEXT, needOf, needsOf, plenoAwaits, plenoQuickIds, plenoReactFromTurn, plenoReactionMenu, PROFESSIONS, relation, setRelation } from './social.ts';
import { dilemmaMayorText, dilemmaQuickIds } from './dilemmas.ts';
import { transfer } from './money.ts';
import { canDump, dumpTrash } from './trash.ts';
import { canSignTemporero, HARVEST_NAME, signTemporero } from './farm.ts';
import { applyDonation, donorCandidates, LANDMARK_NAMES, landmarksInProgress } from './landmarks.ts';
import { complainCandidates, complainTourists, openRural, ruralCandidates, ruralDemand } from './tourism.ts';
import { bigFactory, hireCandidates } from './region.ts';
import { canJoinCommittee, joinCommittee, proposeProgram, seasonName } from './seasons.ts';
import { careAction, careMenu } from './care.ts';
import { searchJobOutside, transitMenu } from './transit.ts';
import { type Building, buildingAt, type Citizen, DESIRES, FEARS, type GameState, pushEvent, type Trigger } from './state.ts';

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
  turn: { n: number; opened: number; due: number; kind: 'semana' | 'rapida'; reason?: string; ids: number[]; monthly?: boolean } | null;
  /** 2.2: mes del último turno mensual (biografías y pies de foto). */
  lastMonthly?: number;
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
  /** 2.0 (director): el último turno lo dirigió la IA (si no, las reglas tiran dados de respaldo). */
  directed?: boolean;
  /** «Se está cociendo»: avisos previos del director. */
  brewing?: Brewing[];
  /** Última marcha por ultimátum (como mucho una a la semana). */
  lastUltimatum?: number;
  /** Presupuesto de drama del mes (sucesos malos y buenos). */
  drama?: { month: number; bad: number; good: number };
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
  /** Lo que apunta de esta semana (su memoria escrita). */
  recuerdo?: string;
  /** 2.1: su voto para el escudo, si hay votación abierta (ids del menú). */
  escudo?: { pieza: string; lema: string };
  /** 2.2: en el turno mensual, su biografía reescrita. */
  biografia?: string;
  /** 2.4: si encabeza la comisión de festejos, el programa (ids de `actos_posibles`). */
  programa?: string[];
}

export function emptyTownAi(share = TURN.defaultShare): TownAi {
  return { share, paceDays: TURN.days, turn: null, lastN: 0, next: TURN.days * TICKS_PER_DAY, mayor: [], quick: null, lastQuick: -1e9, log: [] };
}

/** ¿Este vecino piensa con IA? (Modo IA y vecino con nombre: el % decide quién lo tiene.) */
export function isAiCitizen(state: GameState, c: Citizen): boolean {
  // Con el % a 0, nadie piensa con IA: vuelven los detonantes y las reglas de siempre.
  return state.aiMode && c.named && !!state.ai && state.ai.share > 0;
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
  const cap = (b: Building) => (b.built && b.damaged?.cause !== 'fuego' ? (b.kind === 'house' ? 3 : b.kind === 'res' ? 4 : 0) : 0);
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

/** 2.3: la fábrica de la gran empresa, si contrata y este vecino está en paro. */
export function bigCompanyJob(state: GameState, c: Citizen): Building | undefined {
  return hireCandidates(state).citizenIds.includes(c.id) ? bigFactory(state) : undefined;
}

/** 2.3: ¿hizo esta acción hace poco? (donar o quejarse de los turistas, como mucho una vez en `TURN.repeatDays`). */
export function didLately(state: GameState, c: Citizen, verb: string): boolean {
  const since = state.tick - TURN.repeatDays * TICKS_PER_DAY;
  for (let i = state.decisionLog.length - 1; i >= 0; i--) {
    const d = state.decisionLog[i]!;
    if (d.tick < since) break;
    if (d.citizenId === c.id && d.action.split(':')[0] === verb) return true;
  }
  return false;
}

/** Acciones que el motor permite ahora a un vecino (lo que se manda a la IA y se valida al aplicar). */
export function turnMenu(state: GameState, c: Citizen): MenuItem[] {
  const out: MenuItem[] = [{ accion: 'seguir', detalle: 'seguir con su vida como hasta ahora' }];
  const pol = state.politics;
  // Ronda 18: quien gobierna no se pide nada a sí mismo, ni se manifiesta contra sí, ni se va (disolvería su gobierno).
  const governs = pol.mayor === c.id;
  // Elecciones a la vista: decide su voto (secreto).
  if (pol.party !== null && pol.nextElection - state.tick <= 10 * TICKS_PER_DAY && !c.vote) {
    out.push({ accion: 'votar_gobierno' }, { accion: 'votar_oposicion' }, { accion: 'abstenerse' });
  }
  // 2.4: quien habló en el pleno reacciona a la respuesta del alcalde.
  out.push(...plenoReactionMenu(state, c));
  const assoc = protestFor(state, c);
  if (assoc && !governs && c.protest !== assoc.id && c.protest !== -assoc.id) out.push({ accion: 'manifestarse', detalle: `la asociación «${assoc.name}» convoca una manifestación` }, { accion: 'no_ir' });
  // Trabajo.
  for (const b of vacantJobs(state, c)) out.push({ accion: `aceptar_trabajo:${b.id}`, detalle: `empleo en ${(b.name ?? BUILD_NAMES[b.kind] ?? b.kind).toString()}` });
  // 2.3: la gran empresa, si contrata y está en paro.
  const big = bigCompanyJob(state, c);
  if (big) out.push({ accion: `aceptar_trabajo:${big.id}`, detalle: `empleo en la fábrica de ${big.name ?? 'la gran empresa'} (la gran empresa contrata)` });
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
  if (!governs) {
    for (const n of needsOf(state, c).slice(0, 2)) out.push({ accion: `pedir:${n}`, detalle: `pedir al alcalde ${NEED_TEXT[n]}` });
    out.push({ accion: 'quejarse', detalle: 'quejarse al ayuntamiento' });
  }
  // 2.3: grandes obras y turismo. El motor fija la cantidad de la donación; quien gobierna no dona ni se queja.
  if (!governs && !didLately(state, c, 'donar_obra')) {
    for (const lm of landmarksInProgress(state).slice(0, 2)) {
      if (donorCandidates(state, lm.id).some((d) => d.citizenId === c.id)) out.push({ accion: `donar_obra:${lm.id}`, detalle: `donar una pequeña parte de sus ahorros para ${LANDMARK_NAMES[lm.kind].toLowerCase()} (va por la fase ${Math.min(lm.phase + 1, lm.phases)} de ${lm.phases})` });
    }
  }
  if (ruralDemand(state) && ruralCandidates(state).includes(c)) out.push({ accion: 'abrir_casa_rural', detalle: `convertir su casa en casa rural para los visitantes (la reforma cuesta ${TOURISM.rural.openCost} €)` });
  if (!governs && !didLately(state, c, 'quejarse_turistas') && complainCandidates(state).includes(c)) out.push({ accion: 'quejarse_turistas', detalle: 'quejarse de los turistas (ruido de las casas rurales o alquileres más caros)' });
  // 2.1: sin camión y con la basura en la puerta, puede tirarla al monte (contamina y está mal visto).
  if (canDump(state, c)) out.push({ accion: 'tirar_al_monte', detalle: 'tirar la basura al monte: no pasa el camión por su calle (contamina cerca y los vecinos lo verán mal)' });
  // Deudas.
  if (totalDebt(c) >= DEBT.noticeable) {
    out.push({ accion: 'apretarse', detalle: 'apretarse el cinturón para pagar lo que debe' });
    if (!governs && c.debt && c.debt.town >= DEBT.noticeable && !c.debt.plan) out.push({ accion: 'pedir_aplazamiento', detalle: 'pedir al alcalde que le aplace la deuda con el ayuntamiento' });
  }
  // Familia.
  const p = partnerOf(state, c);
  if (p && p.homeId === c.homeId && c.homeId !== null && Math.max(c.age, p.age) <= 45 && Math.min(c.age, p.age) >= 20 && (c.kids?.length ?? 0) < KIDS_MAX) {
    out.push({ accion: 'tener_hijo', detalle: `tener un hijo con ${p.name.split(' ')[0]}` });
  }
  // 2.1: emergencias. Ayudar tras un incendio, acoger a quien se ha quedado sin casa, protección civil.
  for (const b of fireHelpTargets(state)) {
    if (b.id === c.homeId) continue;
    // Ronda 17: ayuda quien tiene relación con los afectados, vive cerca o es sociable y tiene medios.
    const h = home(state, c);
    const near = h && Math.abs(h.x - b.x) + Math.abs(h.y - b.y) <= FIRE.helpRadius;
    const close = state.citizens.some((x) => (x.homeId === b.id || x.jobId === b.id) && c.relations.some((r) => r.id === x.id));
    if (!near && !close && !(c.traits.social >= 60 && c.money >= 300)) continue;
    out.push({ accion: `ayudar_incendio:${b.id}`, detalle: b.fire ? `ayudar a apagar el fuego en ${placeName(b)}` : `echar una mano a quien se ha quedado sin casa en ${placeName(b)}` });
  }
  if (c.homeId !== null && !homelessByFire(state).includes(c)) {
    const guests = homelessByFire(state).filter((x) => x !== c && c.relations.some((r) => r.id === x.id && (r.kind === 'amistad' || r.kind === 'pareja')));
    for (const g of guests.slice(0, 2)) out.push({ accion: `acoger:${g.id}`, detalle: `acoger en su casa a ${g.name.split(' ')[0]}, que se ha quedado sin ella por el fuego` });
  }
  // 2.2: en el mes de cosecha, quien está parado puede apuntarse de temporero.
  const harvest = canSignTemporero(state, c);
  if (harvest?.crop) out.push({ accion: 'temporero', detalle: `apuntarse de temporero para ${HARVEST_NAME[harvest.crop]} (está sin trabajo; un sueldo de temporada)` });
  if (canVolunteer(state, c)) out.push({ accion: 'hacerse_voluntario', detalle: 'apuntarse como voluntario de protección civil (está en paro)' });
  // 2.2: presentarse a las elecciones con su propia candidatura (si cumple los requisitos).
  if (canPresent(state, c).ok) out.push({ accion: 'presentarse', detalle: `presentarse a las elecciones con su propia candidatura (le cuesta ${LISTS.cost} €; su facción está descontenta)` });
  // Solo si está desesperado: robar en una casa del pueblo.
  if (desperate(c)) out.push({ accion: 'robar', detalle: 'robar en una casa del pueblo (está sin dinero, sin trabajo y endeudado)' });
  if (!governs) out.push({ accion: 'irse', detalle: 'irse del pueblo y vender lo que tenga' });
  out.push(...committeeMenu(state, c));
  // 2.4: cuidados de un padre o una madre mayor (plazas y cuota reales) y trabajo fuera en autobús.
  out.push(...careMenu(state, c));
  out.push(...transitMenu(state, c));
  return out;
}

/** 2.4: apuntarse a la comisión de festejos mientras se forma (al final del menú). */
function committeeMenu(state: GameState, c: Citizen): MenuItem[] {
  if (!canJoinCommittee(state, c)) return [];
  const f = state.seasons.current!;
  return [{ accion: 'apuntarse_comision', detalle: `apuntarse a la comisión de festejos de ${seasonName(state, f.season)} (${SEASONS.committee - f.committee.length === 1 ? 'queda 1 sitio' : `quedan ${SEASONS.committee - f.committee.length} sitios`}${f.committee.length === 0 ? '; el primero la encabeza y elige el programa' : ''})` }];
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
    case 'reaccion_pleno':
      return plenoReactFromTurn(state, c, arg);
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
    case 'ayudar_incendio': {
      const b = state.buildings.find((x) => x.id === Number(arg));
      return b ? helpAfterFire(state, c, b) : 'quiere ayudar, pero ya no hace falta';
    }
    case 'acoger':
      return shelter(state, c, state.citizens.find((x) => x.id === Number(arg)));
    case 'hacerse_voluntario':
      return becomeVolunteer(state, c);
    case 'temporero':
      return signTemporero(state, c);
    case 'presentarse':
      return presentCandidacy(state, c);
    case 'donar_obra': {
      const lm = landmarksInProgress(state).find((l) => l.id === Number(arg));
      const paid = lm ? applyDonation(state, c.id, lm.id) : 0;
      if (paid && c.named) addMemory(state, c, 'dono_obra', 3, 2);
      return paid && lm ? `dona ${paid} € para ${LANDMARK_NAMES[lm.kind].toLowerCase()}` : 'al final no dona para la obra';
    }
    case 'abrir_casa_rural':
      return openRural(state, c) ? 'abre una casa rural en su casa' : 'no llega a abrir la casa rural';
    case 'quejarse_turistas':
      return complainTourists(state, c) ? 'se queja de los turistas' : 'al final no se queja de los turistas';
    case 'tirar_al_monte':
      return canDump(state, c) ? dumpTrash(state, c) : 'al final no tira la basura al monte';
    case 'apuntarse_comision':
      return joinCommittee(state, c);
    case 'llevar_a_residencia':
    case 'cuidar_en_casa':
      return careAction(state, c, verb, arg);
    case 'buscar_trabajo_fuera':
      return searchJobOutside(state, c);
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
export function applyTownTurn(state: GameState, n: number, acts: TurnAct[], extra?: { focus?: string; chronicle?: string; director?: DirectorChoice }): void {
  const ai = state.ai!;
  const t = ai.turn!;
  const lines: TurnLog['lines'] = [];
  const done = new Set<number>();
  const helps = new Map<string, number>();
  for (const a of acts) {
    const c = state.citizens.find((x) => x.id === a.vecino);
    if (!c || done.has(c.id) || !t.ids.includes(c.id) || !isAiCitizen(state, c)) continue;
    done.add(c.id);
    const parts: string[] = [];
    // Acción principal: solo si está en el menú de ahora.
    const menu = turnMenu(state, c).map((m) => m.accion);
    let accion = menu.includes(a.accion) ? a.accion : 'seguir';
    // Ronda 17: como mucho unas pocas ayudas por incendio y turno.
    if (accion.startsWith('ayudar_incendio:')) {
      const n = (helps.get(accion) ?? 0) + 1;
      helps.set(accion, n);
      if (n > FIRE.maxHelpers) accion = 'seguir';
    }
    if (accion !== 'seguir') {
      const trigger: Trigger = accion.startsWith('votar') || accion === 'abstenerse' ? 'elecciones' : accion === 'manifestarse' || accion === 'no_ir' ? 'protesta' : 'opinion';
      parts.push(performActionFromTurn(state, c, trigger, accion, a.motivo));
    }
    // Sigue en el pueblo tras su acción (si se fue, no hay más).
    if (!state.citizens.includes(c)) {
      lines.push({ id: c.id, text: `${c.name} ${parts.join('; ')}`, motivo: a.motivo });
      continue;
    }
    // 2.4: el líder de la comisión de festejos propone el programa.
    const prog = proposeProgram(state, c, a.programa);
    if (prog) parts.push(prog);
    const g = applyGesture(state, c, state.citizens.find((x) => x.id === a.gesto?.con && gestureCandidates(state, c).includes(x)), a.gesto?.tipo ?? 'ninguno');
    if (g) parts.push(g);
    c.attitude = clamp(a.actitud ?? 0, -2, 2);
    const donde = (SPEND as readonly string[]).includes(a.gasto?.donde) ? (a.gasto.donde as SpendPref) : 'pueblo';
    const shop = state.buildings.find((b) => b.id === a.gasto?.tienda && b.kind === 'shop' && b.built);
    c.spending = { where: donde, shop: shop?.id, leisure: !!a.gasto?.ocio && donde !== 'ahorrar' };
    const tipo = (PLANS as readonly string[]).includes(a.plan?.tipo) ? (a.plan.tipo as PlanKind) : 'ninguno';
    const need = planAllowed(state, c, tipo, a.plan?.necesidad) ? (a.plan.necesidad as string) : null;
    if (tipo !== 'ninguno' && need && !c.plan) {
      c.plan = { kind: tipo, need, until: state.tick + clamp(a.plan.meses ?? 3, TURN.planMinMonths, 6) * TICKS_PER_MONTH, since: state.tick };
      parts.push(`avisa: ${planText(c.plan)}`);
    }
    c.thought = cleanText(a.pensamiento, 160) || c.thought;
    if (t.monthly) {
      const bio = cleanText(a.biografia, 300);
      if (bio.length >= 20) c.bio = { text: bio, tick: state.tick };
    }
    const note = cleanText(a.recuerdo, 160);
    if (note) c.notes = [...(c.notes ?? []), { tick: state.tick, text: note }].slice(-TURN.notes);
    if (parts.length) lines.push({ id: c.id, text: `${c.name} ${parts.join('; ')}`, motivo: cleanText(a.motivo, 160) });
  }
  // 2.0: el director (solo en los turnos semanales). Con él, este turno manda la IA;
  // sin él, las reglas vuelven a tirar los dados de robos, asociaciones e historias.
  if (t.kind === 'semana') {
    ai.directed = !!extra?.director;
    if (extra?.director) lines.unshift(...applyDirectorImpl(state, extra.director).map((l) => ({ ...l, text: `✦ ${l.text}` })));
  }
  closeTurn(state, 'ia', lines, extra);
  // Quien encabezaba una candidatura y se ha ido en este turno: la lista se retira ya (no al siguiente tick).
  politicsPrune(state);
}

/** El director vive en director.ts (que depende de este módulo): se engancha al cargar. */
let applyDirectorImpl: (state: GameState, choice: DirectorChoice) => TurnLog['lines'] = () => [];
export function setDirectorImpl(fn: typeof applyDirectorImpl): void {
  applyDirectorImpl = fn;
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
  if (source === 'ia') spreadAttitude(state);
  // Lo del alcalde ya se ha contado.
  ai.mayor = ai.mayor.filter((m) => m.tick > t.opened);
  if (t.kind === 'semana') ai.next = t.opened + ai.paceDays * TICKS_PER_DAY;
  ai.turn = null;
}

/**
 * Modo mixto (2.0): los vecinos que deciden por reglas copian, a medias, la
 * actitud de sus amistades con IA; si no tienen, la media de los vecinos con IA
 * de su barrio. Así lo que piensan los vecinos con IA llega a todo el pueblo.
 */
function spreadAttitude(state: GameState): void {
  const ais = state.citizens.filter((c) => isAiCitizen(state, c));
  if (!ais.length) return;
  const home = (c: Citizen) => state.buildings.find((b) => b.id === c.homeId);
  const zone = (c: Citizen) => {
    const b = home(c);
    return b ? `${Math.floor(b.x / TURN.barrioSize)}_${Math.floor(b.y / TURN.barrioSize)}` : 'fuera';
  };
  const byZone = new Map<string, number[]>();
  for (const c of ais) byZone.set(zone(c), [...(byZone.get(zone(c)) ?? []), c.attitude ?? 0]);
  const all = ais.map((c) => c.attitude ?? 0);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const c of state.citizens) {
    if (isAiCitizen(state, c)) continue;
    const friends = c.relations.map((r) => ais.find((x) => x.id === r.id && (r.kind === 'amistad' || r.kind === 'pareja'))).filter((x): x is Citizen => !!x);
    const src = friends.length ? friends.map((x) => x.attitude ?? 0) : (byZone.get(zone(c)) ?? all);
    c.attitude = clamp(Math.round(mean(src) * TURN.contagion), -1, 1) || undefined;
  }
}

/* ---------------- abrir, vencer y planes ---------------- */

/** Vecinos de un turno: todos los vecinos con IA (o, en una reacción rápida, los más afectados). */
function turnIds(state: GameState, kind: 'semana' | 'rapida'): number[] {
  const ai = state.citizens.filter((c) => isAiCitizen(state, c));
  if (kind === 'semana') return ai.slice(0, TURN.maxCitizens).map((c) => c.id);
  // Reacción rápida: los que peor lo llevan y los que más rencor guardan primero.
  // 2.4: antes, quien habló en el pleno y los afectados por un dilema que se acaba de decidir.
  const focus = new Set([...plenoQuickIds(state), ...dilemmaQuickIds(state)]);
  return [...ai]
    .sort((a, b) => Number(focus.has(b.id)) - Number(focus.has(a.id)) || b.grudge - a.grudge || a.happiness - b.happiness || a.id - b.id)
    .slice(0, TURN.quickCitizens)
    .map((c) => c.id);
}

/**
 * Cada hora: abre turno cuando toca (o una reacción rápida tras una medida gorda)
 * y, si vence sin respuesta de la IA, deciden las reglas.
 */
export function turnsTick(state: GameState, ruleFallback: (state: GameState, ids: number[]) => TurnLog['lines']): void {
  const ai = state.ai;
  if (!state.aiMode || !ai) return;
  const t = ai.turn;
  // Ronda 16: un turno abierto vence aunque el % de vecinos con IA haya bajado a 0.
  if (t) {
    if (state.tick >= t.due) {
      if (t.kind === 'semana') ai.directed = false;
      closeTurn(state, 'reglas', ruleFallback(state, t.ids));
    }
    return;
  }
  // Solo se abren turnos al empezar el día (estable para el cliente y el servidor).
  if (ai.share <= 0 || state.tick % TICKS_PER_DAY !== 0) return;
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
  // 2.2: el primer turno semanal de cada mes es «mensual»: biografías y pies de foto.
  const month = Math.floor(state.tick / TICKS_PER_MONTH);
  const monthly = kind === 'semana' && ai.lastMonthly !== month;
  if (monthly) ai.lastMonthly = month;
  ai.turn = { n: ai.lastN, opened: state.tick, due: state.tick + TURN.dueHours, kind, reason: kind === 'rapida' ? ai.quick ?? undefined : undefined, ids, ...(monthly ? { monthly: true } : {}) };
  if (kind === 'rapida') {
    ai.lastQuick = state.tick;
    ai.quick = null;
  }
}

/**
 * Ronda 16: un ultimátum solo vale si es justo y se puede cumplir: su necesidad
 * principal de verdad («empleo» solo en paro) y, para irse, que lo esté pasando mal.
 */
function planAllowed(state: GameState, c: Citizen, tipo: string, need: unknown): boolean {
  if (tipo === 'ninguno' || typeof need !== 'string' || need !== needOf(state, c)) return false;
  if (need === 'empleo' && c.jobId !== null) return false;
  if (tipo === 'irse_si_no' && c.happiness >= TURN.leaveBelow) return false;
  return true;
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
      pushEvent(state, 'info', `${c.name} respira: ya hay ${NEED_TEXT[p.need as keyof typeof NEED_TEXT] ?? p.need}`, { ref: c.id });
      continue;
    }
    if (p.kind !== 'irse_si_no' || !state.ai || state.tick - (state.ai.lastUltimatum ?? -1e9) >= 7 * TICKS_PER_DAY) addMemory(state, c, 'promesa_rota', 4, -4);
    if (p.kind === 'irse_si_no') {
      // Como mucho una marcha por ultimátum a la semana: a los demás les da una semana más.
      const ai = state.ai;
      if (ai && state.tick - (ai.lastUltimatum ?? -1e9) < 7 * TICKS_PER_DAY) {
        c.plan = { ...p, until: state.tick + 7 * TICKS_PER_DAY };
        continue;
      }
      if (ai) ai.lastUltimatum = state.tick;
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
      return cmd.zone === 'none' ? null : { text: `marca zona ${cmd.zone === 'R' ? 'residencial' : cmd.zone === 'C' ? 'comercial' : cmd.zone === 'A' ? 'agraria' : 'industrial'}`, big: false };
    case 'Demolish': {
      const b = buildingAt(state, Number(cmd.x), Number(cmd.y));
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
      return pet ? { text: `${cmd.answer === 'promise' ? 'promete' : 'rechaza'} en el pleno lo que pide ${cname(pet.citizenId)}`, big: cmd.answer === 'reject' || plenoAwaits(state, pet.id) } : null;
    }
    case 'ResolveDilemma': {
      const t = dilemmaMayorText(state, Number(cmd.id), String(cmd.option));
      return t ? { text: t, big: true } : null;
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
    case 'ApproveFestival':
      return { text: cmd.budget === 'todo' ? 'paga entero el programa de la comisión de festejos' : cmd.budget === 'poco' ? 'paga la mitad del programa de la comisión de festejos' : 'no pone dinero para las fiestas de la comisión', big: false };
    case 'ConvenePleno':
      return { text: 'convoca un pleno', big: false };
    case 'Campaign':
      return { text: `hace campaña con los ${cmd.faction}`, big: false };
    case 'TalkTo':
      return { text: `habla con ${cname(cmd.citizenId)}`, big: false };
    // 2.3 (ronda 19): las metas grandes también se cuentan a los vecinos.
    case 'StartLandmark':
      return { text: `empieza la obra de ${(LANDMARK_NAMES[cmd.kind as keyof typeof LANDMARK_NAMES] ?? String(cmd.kind)).toLowerCase()}`, big: true };
    case 'FundLandmarkPhase': {
      const lm = state.landmarks.find((l) => l.id === cmd.id);
      return lm ? { text: `paga la fase ${lm.phase + 1} de ${LANDMARK_NAMES[lm.kind].toLowerCase()}`, big: false } : null;
    }
    case 'PauseLandmark':
      return { text: 'para una gran obra', big: false };
    case 'AnswerBigCompany':
      return { text: cmd.accept ? 'acepta que venga la gran empresa' : 'dice que no a la gran empresa', big: true };
    case 'SetTouristTax':
      return { text: cmd.level === 0 ? 'quita la tasa turística' : `pone la tasa turística ${cmd.level === 2 ? 'alta' : 'baja'}`, big: Number(cmd.level) > 0 };
    case 'ProtectArea':
      return { text: 'protege el entorno del patrimonio (sin industria nueva)', big: true };
    case 'RequestLoan':
      return { text: 'pide un préstamo al banco', big: false };
    // 2.4: cuotas de la guardería y la residencia, y el billete del autobús (subirlos es una medida gorda).
    case 'SetCareFee': {
      const was = cmd.service === 'nursery' ? state.care.nurseryFee : state.care.residenceFee;
      const order = ['gratis', 'reducida', 'normal'];
      const what = cmd.service === 'nursery' ? 'la guardería' : 'la residencia';
      return { text: cmd.level === 'gratis' ? `hace gratis ${what}` : `pone la cuota ${cmd.level} en ${what}`, big: order.indexOf(String(cmd.level)) > order.indexOf(was) };
    }
    case 'SetBusFare':
      return { text: cmd.fare === 'gratis' ? 'hace gratis el autobús' : `pone el billete del autobús ${cmd.fare}`, big: cmd.fare === 'caro' };
  }
  return null;
}
