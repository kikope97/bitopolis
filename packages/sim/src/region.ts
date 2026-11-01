import { type BigCompanyIncentive, TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { MIN_WAGE, REGION } from './balance.ts';
import { offerFeder } from './civic.ts';
import type { CommandResult } from './commands.ts';
import { directorOwns } from './director-core.ts';
import { hash32 } from './hash.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { factionOf, politicsActive } from './politics.ts';
import { chance, nextFloat, nextInt } from './prng.ts';
import { addMemory } from './social.ts';
import {
  type Building,
  buildingAt,
  buildingById,
  type Citizen,
  footprint,
  type GameState,
  hasAdjacentRoad,
  inBounds,
  newBuilding,
  pushEvent,
  type Region,
  terrainAt,
  Tile,
  tileIndex,
  Zone,
} from './state.ts';
import { isWater } from './terrain.ts';

/**
 * 2.3: ciclo comarcal (bonanza, normal, crisis), FEDER y la gran empresa.
 * Números en `REGION` (balance.ts); estado en `state.region` y `state.bigCompany`.
 *
 * - Cada fase dura 18–36 meses; al acabar, la siguiente sale de una cadena de
 *   Markov con `state.rng` y se anuncia 2 meses antes (aviso y El Eco).
 * - En crisis llega una oferta del FEDER (civic.ts) y la gran empresa avisa de
 *   un ERE o de que se va (3 meses antes).
 * - La gran empresa: con 80 vecinos, 6 casillas de zona I y luz, una oferta;
 *   si se acepta, su fábrica 2×2 con 40 empleos (contamina el doble).
 */

export type Phase = Region['phase'];

export const PHASE_NAME: Record<Phase, string> = { bonanza: 'bonanza', normal: 'normal', crisis: 'crisis' };

/** Efectos de la fase en curso (`REGION.fx`). */
export function regionFx(state: GameState): (typeof REGION.fx)[Phase] {
  return REGION.fx[state.region?.phase ?? 'normal'];
}

/** Siguiente fase (cadena de Markov). */
function nextPhase(state: GameState, from: Phase): Phase {
  const r = nextFloat(state.rng);
  const t = REGION.next[from] as Partial<Record<Phase, number>>;
  let acc = 0;
  for (const p of ['bonanza', 'crisis', 'normal'] as const) {
    acc += t[p] ?? 0;
    if (r < acc) return p;
  }
  return from === 'normal' ? 'normal' : from === 'bonanza' ? 'normal' : 'crisis';
}

const PHASE_NEWS: Record<Phase, { warn: string; start: string }> = {
  bonanza: {
    warn: 'En la comarca se habla de buenos tiempos: en un par de meses llega la bonanza (más trabajo fuera y las fábricas venden más)',
    start: 'Empieza la bonanza en la comarca: las fábricas venden más, hay más trabajo fuera y las casas valen más',
  },
  normal: {
    warn: 'La comarca se va calmando: en un par de meses, vuelta a lo normal',
    start: 'La comarca vuelve a lo normal',
  },
  crisis: {
    warn: 'Se está cociendo una crisis en la comarca: en un par de meses, menos trabajo fuera y las fábricas venderán menos',
    start: 'Crisis en la comarca: las fábricas venden menos, hay menos trabajo fuera y las casas valen menos',
  },
};

/** Principio del fin de mes (antes de las nóminas): cambio de fase, avisos, FEDER y la gran empresa. */
export function regionMonth(state: GameState): void {
  const r = state.region;
  if (r) {
    if (!r.warned && state.tick >= r.until - REGION.warnMonths * TICKS_PER_MONTH) {
      r.next = nextPhase(state, r.phase);
      r.warned = true;
      if (r.next !== r.phase) pushEvent(state, r.next === 'crisis' ? 'warning' : 'business', PHASE_NEWS[r.next].warn);
    }
    if (state.tick >= r.until) {
      const prev = r.phase;
      r.phase = r.next ?? 'normal';
      delete r.next;
      r.warned = false;
      r.until = state.tick + nextInt(state.rng, REGION.minMonths, REGION.maxMonths) * TICKS_PER_MONTH;
      if (r.phase !== prev) {
        pushEvent(state, r.phase === 'crisis' ? 'warning' : 'business', PHASE_NEWS[r.phase].start);
        if (r.phase === 'crisis') offerFeder(state);
        else if (prev === 'crisis') crisisEnds(state);
      }
    }
    // 2.3: en crisis, la gran empresa avisa de un ERE o de que se va. Con el director (Modo IA),
    // lo elige él (`ere_gran_empresa`); sin él, las reglas, al empezar la crisis o al mes siguiente.
    if (r.phase === 'crisis' && !directorOwns(state)) crisisHitsBigCompany(state);
  }
  bigCompanyMonth(state);
}

/* ---------------- la gran empresa ---------------- */

const COMPANY_A = ['Conservas', 'Aceites', 'Cerámicas', 'Muebles', 'Embutidos', 'Textiles', 'Piensos', 'Envases'];
const COMPANY_B = ['del Norte', 'del Valle', 'Ibéricas', 'La Comarca', 'del Sur', 'Hermanos Gil', 'La Vega', 'Montesol'];

export function companyName(seed: number): string {
  return `${COMPANY_A[hash32(seed, 41) % COMPANY_A.length]} ${COMPANY_B[hash32(seed, 43) % COMPANY_B.length]}`;
}

/** Casillas de zona industrial libres. */
export function industrialTiles(state: GameState): number {
  let n = 0;
  const { w, zones, tiles } = state.map;
  for (let i = 0; i < zones.length; i++) if (zones[i] === Zone.I && tiles[i] !== Tile.Road && !buildingAt(state, i % w, Math.floor(i / w))) n++;
  return n;
}

/** Primer sitio 2×2 de zona I libre junto a una carretera (null si no hay). */
export function bigFactorySpot(state: GameState): { x: number; y: number } | null {
  const { w, h } = state.map;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const cells = footprint({ x, y, size: 2 });
      const ok = cells.every(([cx, cy]) => {
        const i = tileIndex(state, cx, cy);
        return inBounds(state, cx, cy) && state.map.zones[i] === Zone.I && state.map.tiles[i] !== Tile.Road && !buildingAt(state, cx, cy) && !isWater(terrainAt(state, cx, cy));
      });
      if (ok && cells.some(([cx, cy]) => hasAdjacentRoad(state, cx, cy))) return { x, y };
    }
  }
  return null;
}

/** ¿Se dan las condiciones para que llegue la oferta? (vecinos, zona I con sitio para 2×2 y luz). */
export function bigCompanyReady(state: GameState): boolean {
  const c = REGION.bigCompany;
  // Y que quepa la fábrica: 2×2 de zona I libre junto a una carretera (si no, la oferta llegaría para decir que no).
  return state.citizens.length >= c.pop && industrialTiles(state) >= c.industrialTiles && state.buildings.some((b) => b.kind === 'power' && b.built && !b.damaged) && bigFactorySpot(state) !== null;
}

export function bigFactory(state: GameState): Building | undefined {
  const id = state.bigCompany?.buildingId;
  return id !== undefined ? buildingById(state, id) : undefined;
}

/** Empleos que trae según el incentivo: sin ninguno viene con menos plantilla. */
export function bigCompanyJobs(incentive: BigCompanyIncentive): number {
  return incentive === 'ninguno' ? REGION.bigCompany.jobsNoIncentive : REGION.bigCompany.jobs;
}

/** IBI que paga al mes (bonificado los primeros años si se le ofreció). */
export function bigCompanyIbi(state: GameState): number {
  const bc = state.bigCompany;
  if (!bc || !bigFactory(state)) return 0;
  const c = REGION.bigCompany;
  const bonus = bc.incentive === 'ibi_bonificado' && state.tick - bc.offeredTick < c.ibiYears * 12 * TICKS_PER_MONTH;
  return Math.round(c.ibi * (bonus ? 1 - c.ibiDiscount : 1));
}

export function canAnswerBigCompany(state: GameState, accept: boolean, incentive: BigCompanyIncentive): CommandResult {
  const bc = state.bigCompany;
  if (!bc || bc.status !== 'oferta') return { ok: false, error: 'No hay ninguna oferta de la gran empresa' };
  if (!accept) return { ok: true };
  if (!bigFactorySpot(state)) return { ok: false, error: 'No hay sitio: hacen falta 2×2 casillas libres de zona I junto a una carretera' };
  if (incentive === 'suelo_gratis' && state.treasury < REGION.bigCompany.landCost) return { ok: false, error: `Para regalar el suelo hacen falta ${REGION.bigCompany.landCost.toLocaleString('es-ES')} € en caja` };
  return { ok: true };
}

export function answerBigCompany(state: GameState, accept: boolean, incentive: BigCompanyIncentive): void {
  const bc = state.bigCompany!;
  if (!accept) {
    bc.status = 'rechazada';
    pushEvent(state, 'business', `El ayuntamiento dice que no a ${bc.name}: se irán a otro pueblo`);
    return;
  }
  const spot = bigFactorySpot(state)!;
  const c = REGION.bigCompany;
  if (incentive === 'suelo_gratis') transfer(state, TREASURY, OUTSIDE, c.landCost, 'obras');
  const b = newBuilding(state, 'bigfactory', spot.x, spot.y, OUTSIDE);
  b.size = 2;
  b.name = bc.name;
  for (const [cx, cy] of footprint(b)) state.map.tiles[tileIndex(state, cx, cy)] = Tile.Grass;
  bc.status = 'abierta';
  bc.incentive = incentive;
  bc.buildingId = b.id;
  bc.jobs = bigCompanyJobs(incentive);
  bc.offeredTick = state.tick;
  b.staff = bc.jobs;
  // La obra la paga la empresa (inversor de fuera).
  state.projects.push({ buildingId: b.id, payer: OUTSIDE, workersNeeded: c.workers, workerDaysNeeded: c.workers * c.days, workerDaysDone: 0, crew: [], outsideToday: 0, notify: true });
  const why = incentive === 'ibi_bonificado' ? ' con el IBI a mitad durante 5 años' : incentive === 'suelo_gratis' ? ' con el suelo pagado por el ayuntamiento' : ' sin incentivos (trae menos plantilla)';
  pushEvent(state, 'business', `${bc.name} se instala en el pueblo${why}: ${bc.jobs} empleos cuando abra la fábrica`, { ref: b.id });
  // Los ecologistas protestan (y quien vive cerca lo nota en la felicidad: `regionMood`).
  if (politicsActive(state)) {
    for (const x of state.citizens) if (x.named && factionOf(state, x) === 'ecologistas') addMemory(state, x, 'rumor', 3, -3);
  }
}

/** Fin de mes de la gran empresa: oferta, caducidad, nóminas, IBI y el aviso de ERE o cierre. */
function bigCompanyMonth(state: GameState): void {
  const c = REGION.bigCompany;
  if (!state.bigCompany) {
    if (!bigCompanyReady(state)) return;
    state.bigCompany = { name: companyName(state.seed), status: 'oferta', offeredTick: state.tick, deadline: state.tick + c.offerDays * TICKS_PER_DAY, jobs: c.jobs };
    pushEvent(state, 'business', `${state.bigCompany.name} quiere montar una fábrica grande en la zona industrial: ${c.jobs} empleos. Responde antes de ${c.offerDays} días (Pueblo › Gran empresa)`);
    return;
  }
  const bc = state.bigCompany;
  if (bc.status === 'oferta' && state.tick > bc.deadline) {
    bc.status = 'rechazada';
    pushEvent(state, 'business', `${bc.name} no recibe respuesta y se va a otro pueblo`);
    return;
  }
  const b = bigFactory(state);
  if (!b) {
    if (bc.status === 'abierta' || bc.status === 'ere' || bc.status === 'se_va') bc.status = 'cerrada';
    return;
  }
  // Aviso cumplido: ERE (se queda la mitad) o se va.
  if (bc.warnUntil !== undefined && state.tick >= bc.warnUntil) {
    delete bc.warnUntil;
    if (bc.status === 'se_va') {
      closeBigFactory(state, b);
      return;
    }
    if (bc.status === 'ere') applyEre(state, b);
  }
  if (!b.built || b.damaged) return;
  // Nóminas (las paga la empresa, de fuera) e IBI al ayuntamiento.
  const wage = Math.round(MIN_WAGE[state.minWage ?? 'none'] * c.wageFx);
  for (const x of state.citizens) if (x.jobId === b.id) transfer(state, OUTSIDE, x.id, wage, 'sueldos');
  transfer(state, OUTSIDE, TREASURY, bigCompanyIbi(state), 'IBI');
  // 2.3: sin director (Modo normal o IA caída), contrata cada mes a unos pocos vecinos en paro; con él, `contrata_vecinos`.
  if (!directorOwns(state)) hireBatch(state, REGION.bigCompany.hirePerMonth);
}

/** Contrata de golpe hasta `n` vecinos en paro (un solo aviso). Devuelve cuántos entraron. */
export function hireBatch(state: GameState, n: number): number {
  const { citizenIds, free } = hireCandidates(state);
  let hired = 0;
  for (const id of citizenIds.slice(0, Math.min(free, n))) if (hireForBigCompany(state, id, true)) hired++;
  if (hired) pushEvent(state, 'business', `${state.bigCompany!.name} contrata a ${hired === 1 ? 'un vecino en paro' : `${hired} vecinos en paro`}`, { ref: state.bigCompany!.buildingId });
  return hired;
}

function applyEre(state: GameState, b: Building): void {
  const bc = state.bigCompany!;
  const keep = Math.round(bc.jobs * REGION.bigCompany.ereKeep);
  b.staff = keep;
  const workers = state.citizens.filter((x) => x.jobId === b.id);
  for (const x of workers.slice(keep)) fire(state, x);
  pushEvent(state, 'warning', `ERE en ${bc.name}: se queda con ${keep} empleos${workers.length > keep ? ` y despide a ${workers.length - keep} vecinos` : ''}`, { ref: b.id });
}

function closeBigFactory(state: GameState, b: Building): void {
  const bc = state.bigCompany!;
  for (const x of state.citizens) if (x.jobId === b.id) fire(state, x);
  state.buildings = state.buildings.filter((x) => x.id !== b.id);
  state.projects = state.projects.filter((p) => p.buildingId !== b.id);
  bc.status = 'cerrada';
  delete bc.buildingId;
  pushEvent(state, 'warning', `${bc.name} cierra la fábrica y se va de la comarca`);
}

function fire(state: GameState, x: Citizen): void {
  x.jobId = null;
  addMemory(state, x, 'perdio_trabajo', 4, -4);
  state.month.layoffs = (state.month.layoffs ?? 0) + 1;
}

/** Al empezar una crisis: la gran empresa avisa (3 meses antes) de un ERE o de que se va. */
function crisisHitsBigCompany(state: GameState): void {
  const bc = state.bigCompany;
  if (!bc || bc.status !== 'abierta' || !bigFactory(state)) return;
  const c = REGION.bigCompany;
  bc.status = chance(state.rng, c.leaveChance) ? 'se_va' : 'ere';
  bc.warnUntil = state.tick + c.warnMonths * TICKS_PER_MONTH;
  pushEvent(
    state,
    'warning',
    bc.status === 'se_va' ? `${bc.name} avisa: por la crisis, en ${c.warnMonths} meses cierra la fábrica y se va` : `${bc.name} avisa: por la crisis, en ${c.warnMonths} meses hará un ERE (la mitad de la plantilla)`,
    { ref: bc.buildingId },
  );
}

/** Al acabar la crisis, la gran empresa que hizo un ERE vuelve a contratar. */
function crisisEnds(state: GameState): void {
  const bc = state.bigCompany;
  const b = bigFactory(state);
  if (!bc || !b || bc.status !== 'ere' || bc.warnUntil !== undefined) return;
  bc.status = 'abierta';
  b.staff = bc.jobs;
  pushEvent(state, 'business', `${bc.name} vuelve a contratar: ha pasado la crisis`, { ref: b.id });
}

/** Felicidad por la gran empresa: a quien vive cerca le molesta la fábrica (y a los ecologistas, que esté). */
export function regionMood(state: GameState, c: Citizen, home: { x: number; y: number } | undefined): { label: string; value: number }[] {
  const b = bigFactory(state);
  if (!b || !b.built || b.damaged) return [];
  const near = home && Math.abs(home.x - b.x - 0.5) + Math.abs(home.y - b.y - 0.5) <= REGION.bigCompany.nearRadius;
  if (near) return [{ label: 'Fábrica grande cerca', value: REGION.bigCompany.protestMood }];
  if (c.named && politicsActive(state) && factionOf(state, c) === 'ecologistas') return [{ label: 'La fábrica grande contamina', value: Math.round(REGION.bigCompany.protestMood / 2) }];
  return [];
}

/* ---------------- para la IA (F2) ---------------- */

/** ¿Puede el director proponer `ere_gran_empresa`? (abierta, sin aviso en marcha; lo malo, avisado antes). */
export function ereCandidate(state: GameState): { company: string; jobs: number } | null {
  const bc = state.bigCompany;
  const b = bigFactory(state);
  if (!bc || !b || !b.built || bc.status !== 'abierta' || bc.warnUntil !== undefined) return null;
  return { company: bc.name, jobs: bc.jobs };
}

/** Aplica el aviso de ERE del director (como el de la crisis: pasa en 3 meses). */
export function announceEre(state: GameState): boolean {
  const bc = state.bigCompany;
  if (!ereCandidate(state) || !bc) return false;
  bc.status = 'ere';
  bc.warnUntil = state.tick + REGION.bigCompany.warnMonths * TICKS_PER_MONTH;
  pushEvent(state, 'warning', `${bc.name} avisa: en ${REGION.bigCompany.warnMonths} meses hará un ERE (la mitad de la plantilla)`, { ref: bc.buildingId });
  return true;
}

/** Vecinos en paro que la gran empresa podría contratar ahora (`contrata_vecinos`): ids y plazas libres. */
export function hireCandidates(state: GameState): { citizenIds: number[]; free: number } {
  const b = bigFactory(state);
  if (!b || !b.built || b.damaged) return { citizenIds: [], free: 0 };
  const used = state.citizens.filter((x) => x.jobId === b.id).length;
  const free = Math.max(0, (b.staff ?? state.bigCompany!.jobs) - used);
  const ids = state.citizens.filter((x) => x.jobId === null && x.age >= 18 && x.age < 67).map((x) => x.id);
  return { citizenIds: free ? ids : [], free };
}

/** Contrata a un vecino en la gran empresa (`contrata_vecinos`). Devuelve si pudo. */
export function hireForBigCompany(state: GameState, citizenId: number, quiet = false): boolean {
  const b = bigFactory(state);
  const x = state.citizens.find((c) => c.id === citizenId);
  const { citizenIds, free } = hireCandidates(state);
  if (!b || !x || !free || !citizenIds.includes(citizenId)) return false;
  x.jobId = b.id;
  delete x.unemployedSince;
  delete x.benefitLeft;
  if (!quiet) pushEvent(state, 'business', `${x.name} entra a trabajar en ${state.bigCompany!.name}`, { ref: x.id });
  return true;
}
