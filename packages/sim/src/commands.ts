import { canFundLandmarkPhase, canPauseLandmark, canStartLandmark, fundLandmarkPhase, pauseLandmark, startLandmark } from './landmarks.ts';
import { canBuildHeritage, canProtectArea, canSetTouristTax, canZoneProtected, protectArea, setTouristTax } from './tourism.ts';
import { answerBigCompany, canAnswerBigCompany } from './region.ts';
import { canRepayLoan, canRequestLoan, repayLoan, requestLoan } from './loans.ts';
import { answerErrand, canAnswerErrand } from './errands.ts';
import { farmZoneUnlocked } from './farm.ts';
import { answerPress, canAnswerPress } from './press.ts';
import { canMeetAssociation, meetAssociation } from './associations.ts';
import { canUpgradeBuilding, startUpgrade } from './levels.ts';
import { buildDike, canBuildDike, hasDike } from './fire.ts';
import { applyCrestVote, validBallot } from './rank.ts';
import { canOffer, canReviewContract, offerOutlay, reviewContract, signTender } from './tenders.ts';
import { canDedicateStreet, dedicateStreet, forgetStreet } from './streets.ts';
import { applyTownTurn, canApplyTurn, mayorText, noteMayor, setAiShare } from './turns.ts';
import { canMicrocredit, canSettleDebt, grantMicrocredit, settleDebt } from './household.ts';
import { serviceCounts } from './economy.ts';
import { BUILD_LEVEL, canUpgradeTownhall, plenoUnlocked, townLevel, upgradeTownhall, zonesUnlocked } from './townhall.ts';
import { answerGrant, canAnswerGrant, canHoldFestival, canProposeBudget, federRepair, holdFestival, materialsCost, proposeBudget } from './civic.ts';
import { Command, TICKS_PER_DAY, tickToDate, type BuildKind, type ZoneKind } from '@bitopolis/shared';
import { ASSOCIATIONS, BUILD, CIVIL, STREETS, DEBT_LIMIT, FIRE, MICROCREDIT, MIN_WAGE, MIN_WAGE_FX, MIN_WAGE_STEP, TERRAIN, WAGE_OUTSIDE, ZONE_COST_PER_TILE } from './balance.ts';
import { isWater, Terrain } from './terrain.ts';
import { applyDecision, canApplyDecision } from './decisions.ts';
import { canSetCareFee, setCareFee } from './care.ts';
import { answerNeighbor, applyNeighborTurn, canAnswerNeighbor, canApplyNeighborTurn } from './comarca.ts';
import { canSetZoneDensity, setZoneDensity } from './density.ts';
import { canResolveDilemma, resolveDilemma } from './dilemmas.ts';
import { approveFestival, canApproveFestival } from './seasons.ts';
import { canBuildWaterworks } from './waterworks.ts';
import { canBuildBusStation, canSetBusFare, setBusFare } from './transit.ts';
import { campaign, canCampaign, canMotion, motion } from './politics.ts';
import { addMemory, answerPetition, canConvenePleno, closePleno, convenePleno, talkTo } from './social.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import {
  buildingAt,
  buildingById,
  type GameState,
  hasAdjacentRoad,
  inBounds,
  newBuilding,
  pushEvent,
  terrainAt,
  Tile,
  tileIndex,
  Zone,
} from './state.ts';

export type CommandResult = { ok: true } | { ok: false; error: string };

export const BUILD_NAMES: Record<string, string> = {
  townhall: 'Ayuntamiento',
  road: 'Carretera',
  house: 'Casa municipal',
  water: 'Bomba de agua',
  power: 'Central eléctrica',
  park: 'Parque',
  school: 'Colegio',
  bar: 'Bar',
  chapel: 'Ermita',
  cemetery: 'Cementerio',
  library: 'Biblioteca',
  sports: 'Polideportivo',
  jail: 'Cárcel',
  firestation: 'Parque de bomberos',
  civilprotection: 'Protección civil',
  cleanpoint: 'Punto limpio',
  heritage: 'Patrimonio',
  clinic: 'Centro de salud',
  police: 'Comisaría',
  plaza: 'Plaza Mayor',
  market: 'Mercado',
  res: 'Viviendas',
  shop: 'Tienda',
  factory: 'Taller',
  farm: 'Finca',
  // 2.3: grandes obras y la gran empresa.
  bridge: 'Puente de piedra',
  station: 'Estación de tren',
  fair: 'Feria regional',
  stadium: 'Estadio',
  cathedral: 'Catedral',
  bigfactory: 'Fábrica',
  // 2.4: cuidados, transporte (bloques A y B), agua y energía (bloque C).
  nursery: 'Guardería',
  residence: 'Residencia de mayores',
  busstation: 'Estación de autobuses',
  sewage: 'Depuradora',
  solar: 'Placas solares',
  wind: 'Molino de viento',
  vpo: 'Vivienda protegida',
  coop: 'Cooperativa agraria',
  post: 'Correos',
};

const ZONE_VALUE: Record<ZoneKind, number> = { none: Zone.None, R: Zone.R, C: Zone.C, I: Zone.I, A: Zone.A };

/** Coste total previsto (materiales + mano de obra al precio de fuera). */
export function buildCost(kind: BuildKind): number {
  const s = BUILD[kind];
  return s.materials + s.workers * s.days * WAGE_OUTSIDE;
}

function roadTiles(x: number, y: number, x2: number, y2: number): [number, number][] {
  const out: [number, number][] = [];
  if (x !== x2 && y !== y2) return out;
  const dx = Math.sign(x2 - x);
  const dy = Math.sign(y2 - y);
  let cx = x;
  let cy = y;
  for (;;) {
    out.push([cx, cy]);
    if (cx === x2 && cy === y2) break;
    cx += dx;
    cy += dy;
  }
  return out;
}

function roadNewTiles(state: GameState, x: number, y: number, x2: number, y2: number) {
  return roadTiles(x, y, x2, y2).filter(
    ([tx, ty]) => state.map.tiles[tileIndex(state, tx, ty)] !== Tile.Road && !buildingAt(state, tx, ty) && !hasDike(state, tx, ty),
  );
}

/** Lo que cuesta un tramo de carretera: sobre el río, puente (v1.7). */
export function roadCost(state: GameState, x: number, y: number, x2: number, y2: number): number {
  return roadNewTiles(state, x, y, x2, y2).reduce(
    (sum, [tx, ty]) => sum + (terrainAt(state, tx, ty) === Terrain.River ? TERRAIN.bridgePerTile : BUILD.road.materials),
    0,
  );
}

/**
 * Casillas que de verdad cambian al pintar una zona (v1.7.0): no cuentan las
 * carreteras, los edificios, el agua ni lo que ya tenía esa zona. Los árboles
 * sí: se talan cuando los vecinos construyen. El jugador paga solo estas.
 */
export function zoneChanges(state: GameState, cmd: { x: number; y: number; w: number; h: number; zone: ZoneKind }): { changed: number; skipped: number } {
  const value = ZONE_VALUE[cmd.zone];
  let changed = 0;
  let skipped = 0;
  for (let y = cmd.y; y < cmd.y + cmd.h; y++) {
    for (let x = cmd.x; x < cmd.x + cmd.w; x++) {
      if (!inBounds(state, x, y)) continue;
      const i = tileIndex(state, x, y);
      if (state.map.tiles[i] === Tile.Road || buildingAt(state, x, y) || isWater(state.map.terrain?.[i]) || hasDike(state, x, y) || state.map.zones[i] === value) skipped++;
      else changed++;
    }
  }
  return { changed, skipped };
}

/** Coste total previsto en un sitio concreto (en la colina, más materiales). */
export function buildCostAt(state: GameState, kind: BuildKind, x: number, y: number): number {
  const extra = terrainAt(state, x, y) === Terrain.Hill ? Math.round(BUILD[kind].materials * (TERRAIN.hillFactor - 1)) : 0;
  return buildCost(kind) + extra;
}

/**
 * Lo que falta por pagar, como mucho, de las obras del ayuntamiento en marcha
 * (v1.9.1): los días que quedan con toda la cuadrilla al precio de fuera.
 * Con obreros del pueblo sale más barato; con nieve, algo más caro.
 */
export function pendingWorksCost(state: GameState): number {
  let sum = 0;
  for (const p of state.projects) {
    if (p.payer !== TREASURY || p.workersNeeded <= 0) continue;
    const days = Math.max(0, Math.ceil((p.workerDaysNeeded - p.workerDaysDone) / p.workersNeeded - 1e-9));
    sum += days * p.workersNeeded * WAGE_OUTSIDE;
  }
  return sum;
}

/** Lo que costará al ayuntamiento, como mucho, una obra nueva (edificio, carretera o zona). */
export function commandOutlay(state: GameState, cmd: Command): number {
  if (cmd.type === 'Build') {
    if (cmd.kind === 'road') return roadCost(state, cmd.x, cmd.y, cmd.x, cmd.y);
    if (cmd.offer && cmd.offer !== 'local') return offerOutlay(state, cmd.kind, cmd.x, cmd.y, cmd.offer);
    const s = BUILD[cmd.kind];
    return materialsCost(state, cmd.kind, cmd.x, cmd.y) + s.workers * s.days * WAGE_OUTSIDE;
  }
  if (cmd.type === 'DedicateStreet') return STREETS.plaque;
  if (cmd.type === 'BuildRoad') return roadCost(state, cmd.x, cmd.y, cmd.x2, cmd.y2);
  if (cmd.type === 'Zone') return cmd.zone === 'none' ? 0 : zoneChanges(state, cmd).changed * ZONE_COST_PER_TILE;
  if (cmd.type === 'BuildDike') return CIVIL.dikeCost;
  return 0;
}

/** Valida sin aplicar. El motor es quien decide si un comando es legal. */
/** Mientras gobierna el alcalde rival, sus órdenes pasan por aquí (no las del jugador). */
let governing = false;

/** Orden del gobierno rival (v1.0): misma validación, sin el bloqueo de la oposición. */
export function governmentCommand(state: GameState, cmd: Command): boolean {
  governing = true;
  try {
    return applyCommand(state, cmd).ok;
  } finally {
    governing = false;
  }
}

/** 2.2: valida una orden como la validaría el gobierno rival (sin aplicarla). Para `rivalMenu`. */
export function validateAsGovernment(state: GameState, cmd: unknown): CommandResult {
  governing = true;
  try {
    return validateCommand(state, cmd);
  } finally {
    governing = false;
  }
}

/** En la oposición el jugador solo puede hablar con los vecinos (y la IA decidir). */
// Ronda 17: el turno del pueblo (IA) y los votos no son órdenes del alcalde: valen también en la oposición.
const OPPOSITION_ALLOWED = new Set(['TalkTo', 'NotifyProject', 'CitizenAct', 'Campaign', 'Motion', 'TownTurn', 'ChooseCrest', 'NeighborTurn']);

export function validateCommand(state: GameState, raw: unknown): CommandResult {
  const parsed = Command.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'comando mal formado' };
  const cmd = parsed.data;
  const pol = state.politics;
  if (pol && pol.mayor !== 'player' && !governing && !OPPOSITION_ALLOWED.has(cmd.type)) {
    const year = tickToDate(pol.nextElection).year;
    return { ok: false, error: `Estás en la oposición: gobierna ${pol.party?.leaderName ?? 'otro alcalde'} hasta las elecciones del año ${year}` };
  }
  switch (cmd.type) {
    case 'SetTax':
      return { ok: true };
    case 'SetTaxes':
      return state.taxesSplit ? { ok: true } : { ok: false, error: 'Los tributos se separan con 50 vecinos' };
    case 'SetHousingMode': {
      const b = buildingById(state, cmd.buildingId);
      return b?.kind === 'house' ? { ok: true } : { ok: false, error: 'Solo las casas municipales se venden o alquilan' };
    }
    case 'Build': {
      if (cmd.kind === 'road') return validateCommand(state, { type: 'BuildRoad', x: cmd.x, y: cmd.y, x2: cmd.x, y2: cmd.y });
      if (!inBounds(state, cmd.x, cmd.y)) return { ok: false, error: 'Fuera del mapa' };
      // v1.8: lo desbloquea el nivel del ayuntamiento (la Plaza y el Mercado, además, su hito).
      if (townLevel(state) < BUILD_LEVEL[cmd.kind]) return { ok: false, error: `Se desbloquea con el ayuntamiento de nivel ${BUILD_LEVEL[cmd.kind]}` };
      if ((cmd.kind === 'plaza' || cmd.kind === 'market') && !state.unlocked.includes(cmd.kind)) {
        return { ok: false, error: cmd.kind === 'plaza' ? 'La Plaza Mayor se desbloquea con el hito de 50 vecinos' : 'El Mercado se desbloquea con el hito de 200 vecinos' };
      }
      if (state.citizens.length < BUILD[cmd.kind].unlockPop && cmd.kind !== 'plaza' && cmd.kind !== 'market') return { ok: false, error: `Se desbloquea con ${BUILD[cmd.kind].unlockPop} vecinos` };
      const t = state.map.tiles[tileIndex(state, cmd.x, cmd.y)];
      const ter = terrainAt(state, cmd.x, cmd.y);
      if (isWater(ter)) return { ok: false, error: ter === Terrain.Sea ? 'Ahí está el mar' : 'Ahí pasa el río: solo se puede cruzar con un puente (Carretera)' };
      if (t === Tile.Road || buildingAt(state, cmd.x, cmd.y)) return { ok: false, error: 'Ese sitio está ocupado' };
      if (hasDike(state, cmd.x, cmd.y)) return { ok: false, error: 'Ahí hay un dique' };
      if (!hasAdjacentRoad(state, cmd.x, cmd.y)) return { ok: false, error: 'Necesita una carretera al lado' };
      // 2.3: el patrimonio, uno por partida.
      if (cmd.kind === 'heritage') {
        const h = canBuildHeritage(state);
        if (!h.ok) return h;
      }
      // 2.4: la depuradora, junto al río; el molino, en la colina.
      const ww = canBuildWaterworks(state, cmd.kind, cmd.x, cmd.y);
      if (!ww.ok) return ww;
      // 2.4: una sola estación de autobuses (llega a todo el pueblo).
      if (cmd.kind === 'busstation') {
        const h = canBuildBusStation(state);
        if (!h.ok) return h;
      }
      // 2.5: una cooperativa y una oficina de correos por pueblo.
      if ((cmd.kind === 'coop' || cmd.kind === 'post') && state.buildings.some((b) => b.kind === cmd.kind)) {
        return { ok: false, error: cmd.kind === 'coop' ? 'Ya hay una cooperativa en el pueblo' : 'Ya hay una oficina de correos en el pueblo' };
      }
      // 2.2: licitación (la local es la de siempre: mismo coste y misma validación).
      if (cmd.offer && cmd.offer !== 'local') {
        const o = canOffer(state, cmd.kind, cmd.x, cmd.y, cmd.offer);
        if (!o.ok) return o;
        if (state.treasury < offerOutlay(state, cmd.kind, cmd.x, cmd.y, cmd.offer)) return { ok: false, error: 'No hay dinero suficiente' };
        return { ok: true };
      }
      if (state.treasury < buildCostAt(state, cmd.kind, cmd.x, cmd.y)) return { ok: false, error: 'No hay dinero suficiente' };
      return { ok: true };
    }
    case 'BuildRoad': {
      if (!inBounds(state, cmd.x, cmd.y) || !inBounds(state, cmd.x2, cmd.y2)) return { ok: false, error: 'Fuera del mapa' };
      if (cmd.x !== cmd.x2 && cmd.y !== cmd.y2) return { ok: false, error: 'La carretera debe ser recta' };
      const tiles = roadNewTiles(state, cmd.x, cmd.y, cmd.x2, cmd.y2);
      if (tiles.length === 0) return { ok: false, error: 'Ya hay carretera' };
      if (tiles.some(([tx, ty]) => terrainAt(state, tx, ty) === Terrain.Sea)) return { ok: false, error: 'No se puede hacer carretera en el mar' };
      if (state.treasury < roadCost(state, cmd.x, cmd.y, cmd.x2, cmd.y2)) return { ok: false, error: 'No hay dinero suficiente' };
      return { ok: true };
    }
    case 'Zone': {
      if (cmd.zone !== 'none' && !zonesUnlocked(state)) return { ok: false, error: 'Las zonas se desbloquean con el ayuntamiento de nivel 2' };
      // 2.2: la zona agraria pide, además, sus vecinos.
      if (cmd.zone === 'A') {
        const farm = farmZoneUnlocked(state);
        if (!farm.ok) return farm;
      }
      if (!inBounds(state, cmd.x, cmd.y) || !inBounds(state, cmd.x + cmd.w - 1, cmd.y + cmd.h - 1)) {
        return { ok: false, error: 'Fuera del mapa' };
      }
      // 2.3: sin industria en el entorno protegido del patrimonio.
      const prot = canZoneProtected(state, cmd.zone, cmd.x, cmd.y, cmd.w, cmd.h);
      if (!prot.ok) return prot;
      // Pintar zonas es la salida de una crisis: se permite con deuda hasta el límite.
      if (cmd.zone !== 'none' && state.treasury - zoneChanges(state, cmd).changed * ZONE_COST_PER_TILE < -DEBT_LIMIT) return { ok: false, error: 'No hay dinero suficiente' };
      return { ok: true };
    }
    case 'Demolish': {
      if (!inBounds(state, cmd.x, cmd.y)) return { ok: false, error: 'Fuera del mapa' };
      const b = buildingAt(state, cmd.x, cmd.y);
      if (b?.kind === 'townhall') return { ok: false, error: 'El ayuntamiento no se derriba' };
      const t = state.map.tiles[tileIndex(state, cmd.x, cmd.y)];
      if (b?.fire) return { ok: false, error: 'Está ardiendo: espera a que se apague' };
      if (!b && t !== Tile.Road && !hasDike(state, cmd.x, cmd.y)) return { ok: false, error: 'No hay nada que derribar' };
      return { ok: true };
    }
    case 'NotifyProject':
      return state.projects.some((p) => p.buildingId === cmd.buildingId) ? { ok: true } : { ok: false, error: 'No hay obra' };
    case 'ReviewContract':
      return canReviewContract(state, cmd.buildingId);
    case 'DedicateStreet':
      return canDedicateStreet(state, cmd.citizenId, cmd.x, cmd.y);
    case 'CitizenAct':
      return canApplyDecision(state, cmd.citizenId, cmd.action) ? { ok: true } : { ok: false, error: 'Decisión ya no válida' };
    case 'MeetAssociation':
      return canMeetAssociation(state, cmd.associationId);
    case 'AnswerErrand':
      return canAnswerErrand(state, cmd.errandId, cmd.answer);
    case 'AnswerPress':
      return canAnswerPress(state, cmd.edition, cmd.answer);
    case 'RepairBuilding': {
      const b = buildingById(state, cmd.buildingId);
      if (!b?.damaged) return { ok: false, error: 'Ese edificio no necesita reparación' };
      if (b.damaged.repairUntil >= 0) return { ok: false, error: 'Ya se está reparando' };
      if (state.treasury < b.damaged.cost) return { ok: false, error: 'No hay dinero suficiente' };
      return { ok: true };
    }
    case 'UpgradeTownhall':
      return canUpgradeTownhall(state);
    case 'BuildDike':
      return canBuildDike(state, cmd.x, cmd.y);
    case 'TownTurn':
      return canApplyTurn(state, cmd.n);
    case 'ChooseCrest':
      if (!state.rank?.vote) return { ok: false, error: 'No hay votación del escudo abierta' };
      return cmd.votes.some((b) => validBallot(state, b)) ? { ok: true } : { ok: false, error: 'Ningún voto vale (vecino sin IA o fuera del menú)' };
    case 'SetAiShare':
      if (!state.aiMode || !state.ai) return { ok: false, error: 'Solo en Modo IA' };
      return cmd.share === state.ai.share ? { ok: false, error: 'Ya está en ese %' } : { ok: true };
    case 'SetTurnPace':
      if (!state.aiMode || !state.ai) return { ok: false, error: 'Solo en Modo IA' };
      return cmd.days === state.ai.paceDays ? { ok: false, error: 'Ya está a ese ritmo' } : { ok: true };
    case 'UpgradeBuilding': {
      const b = state.buildings.find((x) => x.id === cmd.buildingId);
      return canUpgradeBuilding(state, b, b ? serviceCounts(state).get(b.id) : undefined);
    }
    case 'SetMinimumWage':
      return (state.minWage ?? 'none') === cmd.level ? { ok: false, error: 'Ya está en ese nivel' } : { ok: true };
    case 'SettleDebt':
      return canSettleDebt(state, state.citizens.find((c) => c.id === cmd.citizenId), cmd.mode);
    case 'RequestLoan':
      return canRequestLoan(state, cmd.amount, cmd.months);
    case 'RepayLoan':
      return canRepayLoan(state, cmd.loanId, cmd.amount);
    case 'GrantMicrocredit':
      return canMicrocredit(state, state.citizens.find((c) => c.id === cmd.citizenId));
    case 'ConvenePleno': {
      if (!plenoUnlocked(state)) return { ok: false, error: 'Los plenos llegan con el ayuntamiento de nivel 2' };
      const r = canConvenePleno(state);
      return r.ok ? { ok: true } : { ok: false, error: r.error! };
    }
    case 'ProposeBudget': {
      const r = canProposeBudget(state);
      return r.ok ? { ok: true } : { ok: false, error: r.error! };
    }
    case 'HoldFestival': {
      const r = canHoldFestival(state, cmd.size);
      return r.ok ? { ok: true } : { ok: false, error: r.error! };
    }
    case 'AnswerGrant': {
      const r = canAnswerGrant(state, cmd.grantId);
      return r.ok ? { ok: true } : { ok: false, error: r.error! };
    }
    case 'AnswerPetition':
      return state.pleno?.petitions.some((p) => p.id === cmd.petitionId && !p.answer) ? { ok: true } : { ok: false, error: 'Esa petición ya está respondida' };
    case 'Campaign': {
      const r = canCampaign(state);
      return r.ok ? { ok: true } : { ok: false, error: r.error! };
    }
    case 'Motion': {
      const r = canMotion(state, cmd.faction);
      return r.ok ? { ok: true } : { ok: false, error: r.error! };
    }
    case 'ClosePleno':
      return state.pleno ? { ok: true } : { ok: false, error: 'No hay pleno abierto' };
    case 'TalkTo':
      return state.citizens.some((c) => c.id === cmd.citizenId && c.named) ? { ok: true } : { ok: false, error: 'Ese vecino no está' };
    // 2.3: metas grandes (cada bloque valida en su archivo).
    case 'StartLandmark':
      return canStartLandmark(state, cmd.kind, cmd.x, cmd.y);
    case 'FundLandmarkPhase':
      return canFundLandmarkPhase(state, cmd.id);
    case 'PauseLandmark':
      return canPauseLandmark(state, cmd.id);
    case 'SetTouristTax':
      return canSetTouristTax(state, cmd.level);
    case 'ProtectArea':
      return canProtectArea(state, cmd.heritageId);
    case 'AnswerBigCompany':
      return canAnswerBigCompany(state, cmd.accept, cmd.incentive);
    // 2.4: vida (cada bloque valida en su archivo).
    case 'SetBusFare':
      return canSetBusFare(state, cmd.fare);
    case 'SetCareFee':
      return canSetCareFee(state, cmd.service, cmd.level);
    case 'ResolveDilemma':
      return canResolveDilemma(state, cmd.id, cmd.option);
    case 'ApproveFestival':
      return canApproveFestival(state, cmd.season, cmd.budget);
    // 2.5: comarca (cada bloque valida en su archivo).
    case 'SetZoneDensity':
      return canSetZoneDensity(state, cmd.x, cmd.y, cmd.w, cmd.h, cmd.level);
    case 'AnswerNeighbor':
      return canAnswerNeighbor(state, cmd.id, cmd.accept);
    case 'NeighborTurn':
      return canApplyNeighborTurn(state, cmd.month);
  }
}

/** Quita un edificio cuidando que su dinero y sus vecinos queden en orden. */
export function removeBuilding(state: GameState, id: number): void {
  const b = buildingById(state, id);
  if (!b) return;
  if (b.cash > 0) transfer(state, b.id, b.owner === TREASURY ? TREASURY : OUTSIDE, b.cash, 'cierres');
  state.buildings = state.buildings.filter((x) => x.id !== id);
  state.projects = state.projects.filter((p) => p.buildingId !== id);
  for (const c of state.citizens) {
    if (c.homeId === id) c.homeId = null;
    if (c.jobId === id) {
      c.jobId = null;
      if (c.named) addMemory(state, c, 'perdio_trabajo', 4, -4);
    }
  }
}

export function applyCommand(state: GameState, raw: unknown): CommandResult {
  const v = validateCommand(state, raw);
  if (!v.ok) return v;
  const cmd = Command.parse(raw);
  // 2.0: lo que hace el alcalde se cuenta a la IA del pueblo (texto del motor).
  const mayor = mayorText(state, cmd);
  switch (cmd.type) {
    case 'TownTurn':
      applyTownTurn(state, cmd.n, cmd.acts, { focus: cmd.focus, chronicle: cmd.chronicle, director: cmd.director });
      // 2.1: si hay votación del escudo, los vecinos con IA votan en su turno (el resto, por reglas).
      if (state.rank?.vote && state.ai?.log.at(-1)?.kind === 'semana') {
        const ballots = cmd.acts.filter((a) => a.escudo?.pieza && a.escudo.lema).map((a) => ({ vecino: a.vecino, pieza: a.escudo!.pieza, lema: a.escudo!.lema }));
        if (ballots.some((b) => validBallot(state, b))) applyCrestVote(state, ballots);
      }
      break;
    case 'ChooseCrest':
      applyCrestVote(state, cmd.votes);
      break;
    case 'SetAiShare':
      setAiShare(state, cmd.share);
      break;
    case 'SetTurnPace':
      state.ai!.paceDays = cmd.days;
      break;
    case 'SetTax':
      if (state.taxLevel !== cmd.level) {
        state.taxLevel = cmd.level;
        const name = { low: 'bajos', medium: 'medios', high: 'altos' }[cmd.level];
        pushEvent(state, 'tax', `El alcalde pone los impuestos ${name}`);
      }
      if (state.taxesSplit) state.taxes = { ibi: cmd.level, tasas: cmd.level, plusvalia: cmd.level };
      break;
    case 'SetTaxes': {
      const names = { ibi: 'el IBI', tasas: 'las tasas', plusvalia: 'la plusvalía' } as const;
      const lv = { low: 'bajo', medium: 'medio', high: 'alto' } as const;
      for (const k of ['ibi', 'tasas', 'plusvalia'] as const) {
        const v = cmd[k];
        if (v && state.taxes[k] !== v) {
          state.taxes[k] = v;
          pushEvent(state, 'tax', `El alcalde pone ${names[k]} en nivel ${lv[v]}`);
        }
      }
      break;
    }
    case 'SetHousingMode': {
      const b = buildingById(state, cmd.buildingId)!;
      b.forSale = cmd.mode === 'sale';
      pushEvent(state, 'info', b.forSale ? 'Casa municipal puesta a la venta' : 'Casa municipal en alquiler', { ref: b.id });
      break;
    }
    case 'Build': {
      if (cmd.kind === 'road') return applyCommand(state, { type: 'BuildRoad', x: cmd.x, y: cmd.y, x2: cmd.x, y2: cmd.y });
      const spec = BUILD[cmd.kind];
      const mat = materialsCost(state, cmd.kind, cmd.x, cmd.y);
      const offer = cmd.offer ?? 'local';
      // 2.2: con otra oferta, los materiales los paga la licitación (signTender).
      if (offer === 'local') transfer(state, TREASURY, OUTSIDE, mat, 'obras');
      const idx = tileIndex(state, cmd.x, cmd.y);
      state.map.tiles[idx] = Tile.Grass;
      state.map.zones[idx] = Zone.None;
      const b = newBuilding(state, cmd.kind, cmd.x, cmd.y, TREASURY);
      state.projects.push({
        buildingId: b.id,
        payer: TREASURY,
        workersNeeded: spec.workers,
        workerDaysNeeded: spec.workers * spec.days,
        workerDaysDone: 0,
        crew: [],
        outsideToday: 0,
        notify: false,
      });
      if (offer !== 'local') signTender(state, b, state.projects.at(-1)!, offer, mat);
      pushEvent(state, 'project', `Empieza la obra: ${BUILD_NAMES[cmd.kind]}`, { ref: b.id });
      break;
    }
    case 'BuildRoad': {
      const tiles = roadNewTiles(state, cmd.x, cmd.y, cmd.x2, cmd.y2);
      transfer(state, TREASURY, OUTSIDE, roadCost(state, cmd.x, cmd.y, cmd.x2, cmd.y2), 'obras');
      if (tiles.some(([tx, ty]) => terrainAt(state, tx, ty) === Terrain.River)) pushEvent(state, 'info', 'Se construye un puente sobre el río');
      for (const [tx, ty] of tiles) {
        const i = tileIndex(state, tx, ty);
        state.map.tiles[i] = Tile.Road;
        state.map.zones[i] = Zone.None;
      }
      break;
    }
    case 'Zone': {
      const value = ZONE_VALUE[cmd.zone];
      let changed = 0;
      for (let y = cmd.y; y < cmd.y + cmd.h; y++) {
        for (let x = cmd.x; x < cmd.x + cmd.w; x++) {
          const i = tileIndex(state, x, y);
          if (state.map.tiles[i] === Tile.Road || buildingAt(state, x, y)) continue;
          if (isWater(state.map.terrain?.[i]) || hasDike(state, x, y)) continue;
          if (state.map.zones[i] === value) continue;
          state.map.zones[i] = value;
          // Ronda 21: al cambiar de zona se olvida la densidad pedida.
          if (state.map.density) state.map.density[i] = 0;
          changed++;
        }
      }
      if (value !== Zone.None) transfer(state, TREASURY, OUTSIDE, changed * ZONE_COST_PER_TILE, 'obras');
      break;
    }
    case 'Demolish': {
      const b = buildingAt(state, cmd.x, cmd.y);
      const i = tileIndex(state, cmd.x, cmd.y);
      // 2.2: la calle (o la plaza) que pasaba por aquí pierde su nombre.
      forgetStreet(state, cmd.x, cmd.y);
      if (b) removeBuilding(state, b.id);
      else if (state.map.tiles[i] === Tile.Road) state.map.tiles[i] = Tile.Grass;
      else state.dikes = (state.dikes ?? []).filter((d) => d !== i);
      break;
    }
    case 'MeetAssociation':
      meetAssociation(state, cmd.associationId);
      break;
    case 'AnswerErrand':
      answerErrand(state, cmd.errandId, cmd.answer);
      break;
    case 'AnswerPress':
      answerPress(state, cmd.edition, cmd.answer);
      break;
    case 'UpgradeTownhall':
      upgradeTownhall(state);
      break;
    case 'BuildDike':
      buildDike(state, cmd.x, cmd.y);
      break;
    case 'SetMinimumWage': {
      const before = MIN_WAGE_STEP[state.minWage ?? 'none'];
      const after = MIN_WAGE_STEP[cmd.level];
      state.minWage = cmd.level;
      // Quien tiene empleados lo nota en la caja y se acuerda (como con los impuestos).
      if (after > before) {
        for (const c of state.citizens) {
          if (state.buildings.some((b) => b.owner === c.id && (b.kind === 'shop' || b.kind === 'factory'))) c.grudge = Math.min(40, c.grudge + MIN_WAGE_FX.ownerGrudge * (after - before));
        }
      }
      pushEvent(state, 'info', cmd.level === 'none' ? 'Sin sueldo mínimo municipal: las empresas pagan lo de siempre' : `Nuevo sueldo mínimo: ${MIN_WAGE[cmd.level]} € al mes en las empresas del pueblo`);
      break;
    }
    case 'SettleDebt': {
      const c = state.citizens.find((x) => x.id === cmd.citizenId)!;
      const amount = c.debt?.town ?? 0;
      settleDebt(state, c, cmd.mode);
      if (cmd.mode === 'perdonar') addMemory(state, c, 'deuda_perdonada', 4, 5);
      pushEvent(state, 'info', cmd.mode === 'aplazar' ? `Aplazas la deuda de ${c.name}: pagará ${c.debt?.plan?.perMonth ?? 0} € al mes durante un año, sin recargo` : `Perdonas a ${c.name} los ${amount} € que debía al ayuntamiento`, { ref: c.id });
      break;
    }
    case 'RequestLoan':
      requestLoan(state, cmd.amount, cmd.months);
      break;
    case 'RepayLoan':
      repayLoan(state, cmd.loanId, cmd.amount);
      break;
    case 'GrantMicrocredit': {
      const c = state.citizens.find((x) => x.id === cmd.citizenId)!;
      grantMicrocredit(state, c);
      pushEvent(state, 'info', `Microcrédito municipal a ${c.name}: ${MICROCREDIT.amount} € que devolverá en ${MICROCREDIT.months} meses, sin intereses`, { ref: c.id });
      break;
    }
    case 'UpgradeBuilding': {
      const b = state.buildings.find((x) => x.id === cmd.buildingId)!;
      startUpgrade(state, b);
      pushEvent(state, 'info', `Empieza la mejora de ${b.name ?? BUILD_NAMES[b.kind] ?? b.kind} al nivel ${(b.level ?? 1) + 1}: sigue abierto mientras dura la obra`, { ref: b.id });
      break;
    }
    case 'RepairBuilding': {
      // v1.8: el ayuntamiento paga la reparación de lo que rompieron los disturbios (2.1: o el fuego).
      const b = buildingById(state, cmd.buildingId)!;
      const fire = b.damaged!.cause === 'fuego';
      const days = fire ? FIRE.repairDays : ASSOCIATIONS.repairDays;
      // 2.3: lo que destrozó la riada del escenario.
      const why = fire ? 'reparaciones (incendio)' : b.damaged!.cause === 'riada' ? 'reparaciones (riada)' : 'reparaciones (disturbios)';
      transfer(state, TREASURY, OUTSIDE, b.damaged!.cost, why);
      // 2.3: en crisis, el FEDER puede pagar parte.
      federRepair(state, b.damaged!.cost);
      b.damaged!.repairUntil = state.tick + days * TICKS_PER_DAY;
      pushEvent(state, 'info', `Empieza la reparación de ${b.name ?? BUILD_NAMES[b.kind]?.toLowerCase()}: abrirá en ${days} días`, { ref: b.id });
      break;
    }
    case 'ReviewContract':
      reviewContract(state, cmd.buildingId);
      break;
    case 'DedicateStreet':
      dedicateStreet(state, cmd.citizenId, cmd.x, cmd.y);
      break;
    case 'NotifyProject': {
      const p = state.projects.find((x) => x.buildingId === cmd.buildingId);
      if (p) p.notify = cmd.on;
      break;
    }
    case 'CitizenAct':
      applyDecision(state, cmd.citizenId, cmd.action, cmd.motivo, cmd.source);
      break;
    case 'ConvenePleno':
      convenePleno(state);
      break;
    case 'ProposeBudget':
      proposeBudget(state, cmd.plan);
      break;
    case 'HoldFestival':
      holdFestival(state, cmd.size);
      break;
    case 'AnswerGrant':
      answerGrant(state, cmd.grantId, cmd.accept);
      break;
    case 'AnswerPetition':
      answerPetition(state, cmd.petitionId, cmd.answer);
      break;
    case 'Motion':
      motion(state, cmd.faction);
      break;
    case 'Campaign':
      campaign(state, cmd.faction);
      break;
    case 'ClosePleno':
      closePleno(state);
      break;
    case 'TalkTo':
      talkTo(state, state.citizens.find((c) => c.id === cmd.citizenId)!);
      break;
    case 'StartLandmark':
      startLandmark(state, cmd.kind, cmd.x, cmd.y);
      break;
    case 'FundLandmarkPhase':
      fundLandmarkPhase(state, cmd.id);
      break;
    case 'PauseLandmark':
      pauseLandmark(state, cmd.id);
      break;
    case 'SetTouristTax':
      setTouristTax(state, cmd.level);
      break;
    case 'ProtectArea':
      protectArea(state, cmd.heritageId);
      break;
    case 'AnswerBigCompany':
      answerBigCompany(state, cmd.accept, cmd.incentive);
      break;
    case 'SetBusFare':
      setBusFare(state, cmd.fare);
      break;
    case 'SetCareFee':
      setCareFee(state, cmd.service, cmd.level);
      break;
    case 'ResolveDilemma':
      resolveDilemma(state, cmd.id, cmd.option);
      break;
    case 'ApproveFestival':
      approveFestival(state, cmd.season, cmd.budget);
      break;
    case 'SetZoneDensity':
      setZoneDensity(state, cmd.x, cmd.y, cmd.w, cmd.h, cmd.level);
      break;
    case 'AnswerNeighbor':
      answerNeighbor(state, cmd.id, cmd.accept);
      break;
    case 'NeighborTurn':
      applyNeighborTurn(state, cmd.month, cmd.picks);
      break;
  }
  if (mayor) noteMayor(state, mayor.text, mayor.big);
  return { ok: true };
}
