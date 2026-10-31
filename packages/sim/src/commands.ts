import { canMeetAssociation, meetAssociation } from './associations.ts';
import { BUILD_LEVEL, canUpgradeTownhall, plenoUnlocked, townLevel, upgradeTownhall, zonesUnlocked } from './townhall.ts';
import { answerGrant, canAnswerGrant, canHoldFestival, canProposeBudget, holdFestival, materialsCost, proposeBudget } from './civic.ts';
import { Command, TICKS_PER_DAY, tickToDate, type BuildKind, type ZoneKind } from '@bitopolis/shared';
import { ASSOCIATIONS, BUILD, DEBT_LIMIT, TERRAIN, WAGE_OUTSIDE, ZONE_COST_PER_TILE } from './balance.ts';
import { isWater, Terrain } from './terrain.ts';
import { applyDecision, canApplyDecision } from './decisions.ts';
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
  clinic: 'Centro de salud',
  police: 'Comisaría',
  plaza: 'Plaza Mayor',
  market: 'Mercado',
  res: 'Viviendas',
  shop: 'Tienda',
  factory: 'Taller',
};

const ZONE_VALUE: Record<ZoneKind, number> = { none: Zone.None, R: Zone.R, C: Zone.C, I: Zone.I };

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
    ([tx, ty]) => state.map.tiles[tileIndex(state, tx, ty)] !== Tile.Road && !buildingAt(state, tx, ty),
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
      if (state.map.tiles[i] === Tile.Road || buildingAt(state, x, y) || isWater(state.map.terrain?.[i]) || state.map.zones[i] === value) skipped++;
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

/** En la oposición el jugador solo puede hablar con los vecinos (y la IA decidir). */
const OPPOSITION_ALLOWED = new Set(['TalkTo', 'NotifyProject', 'CitizenAct', 'Campaign', 'Motion']);

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
      const t = state.map.tiles[tileIndex(state, cmd.x, cmd.y)];
      const ter = terrainAt(state, cmd.x, cmd.y);
      if (isWater(ter)) return { ok: false, error: ter === Terrain.Sea ? 'Ahí está el mar' : 'Ahí pasa el río: solo se puede cruzar con un puente (Carretera)' };
      if (t === Tile.Road || buildingAt(state, cmd.x, cmd.y)) return { ok: false, error: 'Ese sitio está ocupado' };
      if (!hasAdjacentRoad(state, cmd.x, cmd.y)) return { ok: false, error: 'Necesita una carretera al lado' };
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
      if (!inBounds(state, cmd.x, cmd.y) || !inBounds(state, cmd.x + cmd.w - 1, cmd.y + cmd.h - 1)) {
        return { ok: false, error: 'Fuera del mapa' };
      }
      // Pintar zonas es la salida de una crisis: se permite con deuda hasta el límite.
      if (cmd.zone !== 'none' && state.treasury - zoneChanges(state, cmd).changed * ZONE_COST_PER_TILE < -DEBT_LIMIT) return { ok: false, error: 'No hay dinero suficiente' };
      return { ok: true };
    }
    case 'Demolish': {
      if (!inBounds(state, cmd.x, cmd.y)) return { ok: false, error: 'Fuera del mapa' };
      const b = buildingAt(state, cmd.x, cmd.y);
      if (b?.kind === 'townhall') return { ok: false, error: 'El ayuntamiento no se derriba' };
      const t = state.map.tiles[tileIndex(state, cmd.x, cmd.y)];
      if (!b && t !== Tile.Road) return { ok: false, error: 'No hay nada que derribar' };
      return { ok: true };
    }
    case 'NotifyProject':
      return state.projects.some((p) => p.buildingId === cmd.buildingId) ? { ok: true } : { ok: false, error: 'No hay obra' };
    case 'CitizenAct':
      return canApplyDecision(state, cmd.citizenId, cmd.action) ? { ok: true } : { ok: false, error: 'Decisión ya no válida' };
    case 'MeetAssociation':
      return canMeetAssociation(state, cmd.associationId);
    case 'RepairBuilding': {
      const b = buildingById(state, cmd.buildingId);
      if (!b?.damaged) return { ok: false, error: 'Ese edificio no necesita reparación' };
      if (b.damaged.repairUntil >= 0) return { ok: false, error: 'Ya se está reparando' };
      if (state.treasury < b.damaged.cost) return { ok: false, error: 'No hay dinero suficiente' };
      return { ok: true };
    }
    case 'UpgradeTownhall':
      return canUpgradeTownhall(state);
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
  switch (cmd.type) {
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
      transfer(state, TREASURY, OUTSIDE, materialsCost(state, cmd.kind, cmd.x, cmd.y), 'obras');
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
          if (isWater(state.map.terrain?.[i])) continue;
          if (state.map.zones[i] === value) continue;
          state.map.zones[i] = value;
          changed++;
        }
      }
      if (value !== Zone.None) transfer(state, TREASURY, OUTSIDE, changed * ZONE_COST_PER_TILE, 'obras');
      break;
    }
    case 'Demolish': {
      const b = buildingAt(state, cmd.x, cmd.y);
      if (b) removeBuilding(state, b.id);
      else state.map.tiles[tileIndex(state, cmd.x, cmd.y)] = Tile.Grass;
      break;
    }
    case 'MeetAssociation':
      meetAssociation(state, cmd.associationId);
      break;
    case 'UpgradeTownhall':
      upgradeTownhall(state);
      break;
    case 'RepairBuilding': {
      // v1.8: el ayuntamiento paga la reparación de lo que rompieron los disturbios.
      const b = buildingById(state, cmd.buildingId)!;
      transfer(state, TREASURY, OUTSIDE, b.damaged!.cost, 'reparaciones (disturbios)');
      b.damaged!.repairUntil = state.tick + ASSOCIATIONS.repairDays * TICKS_PER_DAY;
      pushEvent(state, 'info', `Empieza la reparación de ${b.name ?? BUILD_NAMES[b.kind]?.toLowerCase()}: abrirá en ${ASSOCIATIONS.repairDays} días`, { ref: b.id });
      break;
    }
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
  }
  return { ok: true };
}
