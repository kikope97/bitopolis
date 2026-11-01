import type { BuildKind, Command, LandmarkKind, TaxLevel } from '@bitopolis/shared';
import { CARE, DENSITY, JOBS, LANDMARKS, LOANS, MAINTENANCE, PLANT_CAPACITY, PUBLIC_SALARY, REGION, SERVICE, SERVICE_SALARY, TRANSIT, TRASH, WAGE_OUTSIDE } from './balance.ts';
import { bigFactorySpot } from './region.ts';
import { ownIncome, TREASURY } from './money.ts';
import { jobsOf, maintenanceOf } from './levels.ts';
import { LANDMARK_KINDS, landmarkReqs, phaseCost } from './landmarks.ts';
import { isWater, Terrain } from './terrain.ts';
import { averageIncome, canRequestLoan, loanCapacity, loanOffer } from './loans.ts';
import { canUpgradeTownhall, isUnlocked, nextLevel, townLevel, zonesUnlocked } from './townhall.ts';
import { densityAt } from './density.ts';
import { buildCost, validateCommand } from './commands.ts';
import { chance, type RngState, seedRng } from './prng.ts';
import { hash32 } from './hash.ts';
import { buildingAt, DIRS, footprint, type GameState, hasAdjacentRoad, terrainAt, Tile, tileIndex, Zone } from './state.ts';
import { freeHomes } from './tick.ts';
import { farmZoneUnlocked } from './farm.ts';
import { townShare } from './seasons.ts';
import { nearestRiverTile, riverCourse, riverExit, riverWorst } from './waterworks.ts';

/**
 * Perfiles de jugador automático para el CLI headless. Cada perfil tiene su
 * propio PRNG (no toca el de la partida) y decide una vez al día.
 */
export interface Profile {
  name: string;
  decide(state: GameState, rng: RngState): Command[];
}

interface PlannerOpts {
  tax: TaxLevel;
  /** Dinero que intenta no gastar. */
  reserve: number;
  /** Probabilidad de actuar cada día. */
  activity: number;
  services: BuildKind[];
  /** Construye casas municipales aunque haya zonas. */
  municipalHousing: boolean;
  /** Un servicio de cada tipo por cada N vecinos (por defecto, solo uno). */
  servicesPer?: number;
  /** 2.2: fincas que quiere tener (pinta zona agraria lejos del centro). */
  farms?: number;
  /**
   * 2.2: préstamos. `prudente`: uno cada vez, solo con nota A o B y una cuota que
   * no pase del 10 % de lo que ingresa, para lo importante (punto limpio, ayuntamiento).
   * `maximo`: pide todo lo que le dejen (para medir el equilibrio).
   */
  borrow?: 'prudente' | 'maximo';
  /**
   * 2.2: no construye ni pinta zona sobre las calles que tiene planificadas. Sin
   * esto, una tienda al final de la calle inicial cortaba la calle mayor y la red
   * de agua y luz no llegaba a la zona industrial (semillas 3 y 5: 35 vecinos).
   */
  keepRoads?: boolean;
  /** 2.3: construye el patrimonio en cuanto puede (con su reserva) y pone la tasa turística media (1 €/noche). */
  tourism?: boolean;
  /** 2.3: grandes obras: paga una fase si la caja pasa de la reserva más lo que cuesta (y acepta la cofinanciación). */
  landmarks?: boolean;
  /** 2.3: deja un polígono de zona I donde quepa la fábrica de la gran empresa (y le dice que sí). */
  bigCompany?: boolean;
  /**
   * 2.4: cuidados y autobús. Con el mes en positivo y superávit para pagarlo, la estación de autobuses
   * (si hay al menos `TRANSIT_RIDERS` vecinos que trabajan fuera), la guardería y la residencia (con
   * `CARE_ELDERS` mayores de 70); las cuotas, normales.
   */
  care?: boolean;
  /**
   * 2.5: densidad y VPO. Sube la densidad de la zona R donde ya hay bloques y el suelo vale (la más alta que
   * le deje el ayuntamiento) y, con el mes en positivo, levanta una vivienda protegida.
   */
  density?: boolean;
}

const TRANSIT_RIDERS = 20;
const CARE_ELDERS = 6;
const CARE_COUPLES = 3;

/**
 * 2.2: préstamo «con cabeza» para lo que falta: el hueco hasta `cost` (más un
 * colchón de 1.000 €), a 24 meses, si la nota es A o B, no hay otro préstamo
 * pedido y la cuota cabe en el 10 % de lo que ingresa al mes.
 */
function prudentLoan(state: GameState, cost: number): Command | null {
  if (state.rating !== 'A' && state.rating !== 'B') return null;
  if (state.loans.some((l) => l.kind === 'banco')) return null;
  const amount = Math.max(LOANS.min, Math.ceil((cost + 1_000 - state.treasury) / LOANS.step) * LOANS.step);
  if (amount > loanCapacity(state)) return null;
  const months = 24;
  if (loanOffer(state, amount, months).quota > averageIncome(state) * LOANS.load.A) return null;
  const cmd: Command = { type: 'RequestLoan', amount, months };
  return canRequestLoan(state, amount, months).ok ? cmd : null;
}

/** Casillas de las calles planificadas (2.2: no se construye ni se pinta zona encima, o la calle queda cortada). */
function plannedRoadTiles(state: GameState): Set<number> {
  const out = new Set<number>();
  for (const r of roadPlan(state)) {
    if (r.type !== 'BuildRoad') continue;
    for (let y = Math.min(r.y, r.y2); y <= Math.max(r.y, r.y2); y++) for (let x = Math.min(r.x, r.x2); x <= Math.max(r.x, r.x2); x++) out.add(tileIndex(state, x, y));
  }
  return out;
}

/** Solares libres junto a carretera, ordenados por distancia al centro. */
function freeSpots(state: GameState, keepRoads = false): { x: number; y: number; d: number }[] {
  const { w, h, tiles } = state.map;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const planned = keepRoads ? plannedRoadTiles(state) : new Set<number>();
  const out: { x: number; y: number; d: number }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[tileIndex(state, x, y)] === Tile.Road || buildingAt(state, x, y) || planned.has(tileIndex(state, x, y))) continue;
      if (!hasAdjacentRoad(state, x, y)) continue;
      out.push({ x, y, d: Math.abs(x - cx) + Math.abs(y - cy) });
    }
  }
  return out.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
}

/** Calles planificadas: una espina vertical y calles horizontales cada 3 filas. */
function roadPlan(state: GameState): Command[] {
  const cx = Math.floor(state.map.w / 2);
  const cy = Math.floor(state.map.h / 2);
  const plan: Command[] = [];
  for (let k = 1; k <= 4; k++) {
    for (const sign of [1, -1]) {
      const y = cy + sign * 3 * k;
      const spineFrom = cy + sign * 3 * (k - 1);
      plan.push({ type: 'BuildRoad', x: cx + 4, y: Math.min(spineFrom, y), x2: cx + 4, y2: Math.max(spineFrom, y) });
      plan.push({ type: 'BuildRoad', x: cx - 8, y, x2: cx + 12, y2: y });
    }
  }
  plan.unshift({ type: 'BuildRoad', x: cx - 8, y: cy, x2: cx + 12, y2: cy });
  return plan;
}

function nextRoad(state: GameState): Command | null {
  for (const cmd of roadPlan(state)) if (validateCommand(state, cmd).ok) return cmd;
  return null;
}

/** Calles conectadas a las que da un edificio. */
function roadNetworkOf(state: GameState, b: { x: number; y: number }): Set<number> {
  const { w, tiles } = state.map;
  const out = new Set<number>();
  const queue: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= state.map.h) return;
    const i = y * w + x;
    if (tiles[i] === Tile.Road && !out.has(i)) {
      out.add(i);
      queue.push(i);
    }
  };
  for (const [dx, dy] of DIRS) push(b.x + dx, b.y + dy);
  while (queue.length) {
    const i = queue.pop()!;
    for (const [dx, dy] of DIRS) push((i % w) + dx, Math.floor(i / w) + dy);
  }
  return out;
}

/** 2.4: lo que elige un jugador razonable en un dilema (por orden, la primera que pueda). */
const DILEMMA_PREFERENCE = ['ampliar', 'microcredito', 'mirar_otro_lado', 'que_cumpla', 'plaza_primero', 'perdonar', 'desahuciar', 'multar', 'pedir_indulto', 'vpo_sorteo'];

/** 2.5: una orden de densidad para un bloque que aún puede crecer (el de más suelo; sin dados). */
function densityPlan(state: GameState): Command | null {
  const level = DENSITY.townhall.reduce((best, need, k) => (townLevel(state) >= need ? k : best), 0);
  if (level === 0) return null;
  const w = state.map.w;
  const b = state.buildings
    .filter((x) => x.kind === 'res' && x.built && densityAt(state, x.x, x.y) < level && (state.fields.land[x.y * w + x.x] ?? 0) > DENSITY.minLand)
    .sort((a, c) => (state.fields.land[c.y * w + c.x] ?? 0) - (state.fields.land[a.y * w + a.x] ?? 0) || a.id - c.id)[0];
  return b ? { type: 'SetZoneDensity', x: b.x, y: b.y, w: 1, h: 1, level: level as 1 | 2 } : null;
}


/** 2.3: fases que quiere tener en caja para empezar una gran obra. */
const START_PHASES = 1;

/**
 * 2.3: lo que hace un jugador con las grandes obras: acepta la cofinanciación
 * y el FEDER, dice que sí a la gran empresa (con el IBI bonificado), paga la
 * fase siguiente si la caja pasa de la reserva más lo que cuesta (con los
 * sueldos de la obra) y, si no hay ninguna en marcha, ahorra para su obra preferida
 * (según la semilla) entre las que ya puede hacer y la empieza cerca del centro.
 */
function landmarkPlan(state: GameState, reserve: number, spots: { x: number; y: number }[], keepRoads = false): Command[] {
  const offer = state.grants.find((g) => g.status === 'offered' && (g.landmark !== undefined || g.feder));
  if (offer) return [{ type: 'AnswerGrant', grantId: offer.id, accept: true }];
  if (state.bigCompany?.status === 'oferta') {
    const yes: Command = { type: 'AnswerBigCompany', accept: true, incentive: 'ibi_bonificado' };
    return [validateCommand(state, yes).ok ? yes : { type: 'AnswerBigCompany', accept: false, incentive: 'ninguno' }];
  }
  const margin = (kind: LandmarkKind) => LANDMARKS.specs[kind].workers * LANDMARKS.specs[kind].days * WAGE_OUTSIDE;
  for (const lm of state.landmarks) {
    if (lm.phase >= lm.phases || lm.phaseUntil !== -1) continue;
    const cmd: Command = { type: 'FundLandmarkPhase', id: lm.id };
    if (state.treasury > reserve + phaseCost(state, lm) + margin(lm.kind) && validateCommand(state, cmd).ok) return [cmd];
  }
  if (state.landmarks.some((l) => l.phase < l.phases)) return [];
  const planned = keepRoads ? plannedRoadTiles(state) : new Set<number>();
  // Cada partida tiene su obra preferida (orden según la semilla): entre las que ya puede hacer, ahorra para la primera.
  const order = [...LANDMARK_KINDS].sort((a, b) => hash32(state.seed, LANDMARK_KINDS.indexOf(a)) - hash32(state.seed, LANDMARK_KINDS.indexOf(b)));
  for (const kind of order) {
    if (state.landmarks.some((l) => l.kind === kind)) continue;
    if (landmarkReqs(state, kind).some((r) => !r.ok && r.key !== 'cash')) continue;
    if (kind === 'bridge' && !riverSpots(state).length && !roadToRiver(state)) continue;
    // Empieza con lo de una fase (y sus sueldos) además de la reserva y paga las demás según entra (F3: esperando
    // a tener la obra entera en caja, el casual guardaba 50.000 € sin destino o la hacía de golpe en un mes).
    if (state.treasury <= reserve + (phaseCost(state, { kind }) + margin(kind)) * Math.min(START_PHASES, LANDMARKS.specs[kind].phases)) return [];
    if (kind === 'bridge' && !riverSpots(state).length) return [roadToRiver(state)!];
    const size = LANDMARKS.specs[kind].size;
    const tries: { x: number; y: number }[] =
      kind === 'bridge' ? riverSpots(state) : spots.flatMap((p) => [p, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y - 1 }, { x: p.x - 1, y: p.y - 1 }]);
    for (const t of tries) {
      if (size === 2 && footprint({ ...t, size: 2 }).some(([x, y]) => planned.has(tileIndex(state, x, y)))) continue;
      const cmd: Command = { type: 'StartLandmark', kind, x: t.x, y: t.y };
      if (validateCommand(state, cmd).ok) return [cmd];
    }
  }
  return [];
}

/** Calle recta más corta desde la red hasta la orilla (para poder hacer el puente de piedra). */
function roadToRiver(state: GameState): Command | null {
  let best: Command | null = null;
  let len = Infinity;
  for (let y = 0; y < state.map.h; y++) {
    for (let x = 0; x < state.map.w; x++) {
      if (terrainAt(state, x, y) !== Terrain.River) continue;
      for (const [dx, dy] of DIRS) {
        for (let k = 1; k <= 20 && k < len; k++) {
          const px = x + dx * k;
          const py = y + dy * k;
          if (px < 0 || py < 0 || px >= state.map.w || py >= state.map.h) break;
          if (state.map.tiles[tileIndex(state, px, py)] === Tile.Road) {
            if (k === 1) return null;
            const cmd: Command = { type: 'BuildRoad', x: x + dx, y: y + dy, x2: px - dx, y2: py - dy };
            if (validateCommand(state, cmd).ok) {
              best = cmd;
              len = k;
            }
            break;
          }
          if (buildingAt(state, px, py) || isWater(terrainAt(state, px, py))) break;
        }
      }
    }
  }
  return best;
}

/** Casillas de río junto a una carretera (para el puente de piedra). */
function riverSpots(state: GameState): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < state.map.h; y++) for (let x = 0; x < state.map.w; x++) if (terrainAt(state, x, y) === Terrain.River && hasAdjacentRoad(state, x, y)) out.push({ x, y });
  return out;
}

/** 2.3: un rectángulo de 3×2 casillas libres (sin calle, edificio, agua ni otra zona) que contenga uno de estos solares. */
function industrialBlock(state: GameState, from: { x: number; y: number }[], keepRoads = false): { x: number; y: number } | null {
  const planned = keepRoads ? plannedRoadTiles(state) : new Set<number>();
  const free = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= state.map.w || y >= state.map.h) return false;
    const i = tileIndex(state, x, y);
    const z = state.map.zones[i];
    return state.map.tiles[i] !== Tile.Road && !buildingAt(state, x, y) && !isWater(terrainAt(state, x, y)) && !planned.has(i) && (z === Zone.None || z === Zone.I);
  };
  for (const s of from) {
    for (let oy = s.y - 1; oy <= s.y; oy++) {
      for (let ox = s.x - 2; ox <= s.x; ox++) {
        let ok = true;
        for (let y = oy; y < oy + 2 && ok; y++) for (let x = ox; x < ox + 3 && ok; x++) ok = free(x, y);
        if (ok && validateCommand(state, { type: 'Zone', zone: 'I', x: ox, y: oy, w: 3, h: 2 }).ok) return { x: ox, y: oy };
      }
    }
  }
  return null;
}

/** 2.4: depuradora cuando el río baja sucio, en el sitio más aguas abajo (trata a todo lo de arriba). */
function sewagePlan(state: GameState, spots: { x: number; y: number }[], reserve: number): Command | null {
  if (state.buildings.some((b) => b.kind === 'sewage')) return null;
  if (riverWorst(state) <= 30 && riverExit(state) <= 20) return null;
  if (state.treasury < buildCost('sewage') + reserve) return null;
  const course = riverCourse(state);
  const down = (s: { x: number; y: number }) => course.section[nearestRiverTile(state, s.x, s.y, undefined, course)] ?? Infinity;
  const ok = spots.filter((s) => validateCommand(state, { type: 'Build', kind: 'sewage', x: s.x, y: s.y }).ok).sort((a, b) => down(a) - down(b));
  return ok[0] ? { type: 'Build', kind: 'sewage', x: ok[0].x, y: ok[0].y } : null;
}

function buildingKindOf(state: GameState, id: number): string | undefined {
  return state.buildings.find((b) => b.id === id)?.kind;
}

function planner(name: string, o: PlannerOpts): Profile {
  return {
    name,
    decide(state, rng) {
      const out: Command[] = [];
      // Un jugador razonable sube impuestos si el mes cierra en negativo y la caja baja.
      const lastMonth = state.stats.at(-1);
      const deficit = !!lastMonth && lastMonth.income < lastMonth.expenses && state.treasury < 10_000;
      const order: TaxLevel[] = ['low', 'medium', 'high'];
      const cur = order.indexOf(state.taxLevel);
      const pref = order.indexOf(o.tax);
      // Con déficit sube un nivel; con la caja sana (o por debajo de su preferencia) vuelve a su nivel.
      let target = cur;
      if (deficit) target = Math.min(2, Math.max(cur, pref) + 1);
      else if (state.treasury > 20_000 || cur < pref) target = pref;
      if (target !== cur) out.push({ type: 'SetTax', level: order[target]! });
      if (!chance(rng, o.activity)) return out;
      // 2.4: responde a la comisión de festejos: la mitad si la caja lo permite sin tocar su reserva.
      const fiesta = state.seasons?.current;
      if (fiesta?.status === 'comision' && fiesta.asked && state.treasury > townShare(fiesta.season, fiesta.program, 'poco') + o.reserve) {
        out.push({ type: 'ApproveFestival', season: fiesta.season, budget: 'poco' });
      }
      // 2.2: el perfil endeudado pide todo lo que le dejen, a 48 meses.
      if (o.borrow === 'maximo') {
        const cap = loanCapacity(state);
        if (cap >= LOANS.min && canRequestLoan(state, cap, 48).ok) out.push({ type: 'RequestLoan', amount: cap, months: 48 });
      }
      const pop = state.citizens.length;
      const has = (k: string) => state.buildings.some((b) => b.kind === k);
      const spots = freeSpots(state, o.keepRoads);
      const tryBuild = (kind: BuildKind): boolean => {
        if (state.treasury < buildCost(kind) + o.reserve) return false;
        for (const s of spots) {
          const cmd: Command = { type: 'Build', kind, x: s.x, y: s.y };
          if (validateCommand(state, cmd).ok) {
            out.push(cmd);
            return true;
          }
        }
        return false;
      };
      if (!has("water")) { tryBuild("water"); return out; }
      if (!has("power")) { tryBuild("power"); return out; }
      // 2.4: un jugador decide los dilemas (sin dados: la primera opción válida de su lista).
      const dilemma = state.dilemmas.find((d) => !d.resolved);
      if (dilemma) {
        const pick = DILEMMA_PREFERENCE.map((option): Command => ({ type: 'ResolveDilemma', id: dilemma.id, option })).find((c) => validateCommand(state, c).ok);
        if (pick) out.push(pick);
      }
      // Ampliar la red si algún edificio terminado se queda sin agua o luz.
      const built = state.buildings.filter((b) => b.built && b.kind !== 'water' && b.kind !== 'power' && b.kind !== 'farm');
      // No más plantas de las que el pueblo necesita (una nueva mal conectada no arregla nada).
      const enough = (k: 'water' | 'power') => state.buildings.filter((b) => b.kind === k).length >= Math.ceil(built.length / (PLANT_CAPACITY[k] * 0.75)) + 1;
      if (built.some((b) => !b.hasWater) && !enough('water') && !state.projects.some((p) => buildingKindOf(state, p.buildingId) === 'water')) {
        if (tryBuild('water')) return out;
      }
      if (built.some((b) => !b.hasPower) && !enough('power') && !state.projects.some((p) => buildingKindOf(state, p.buildingId) === 'power')) {
        if (tryBuild('power')) return out;
      }
      // 2.1: al avisar de la basura, un punto limpio; luego, otro junto a lo que se ensucia (uno por cada 40 vecinos como mucho).
      const first = (state.trash?.start ?? -1) >= 0 && !has('cleanpoint');
      const dirty = state.buildings.filter((b) => (b.trash ?? 0) >= TRASH.dirtyAt).sort((a, b) => (b.trash ?? 0) - (a.trash ?? 0) || a.id - b.id)[0];
      const points = state.buildings.filter((b) => b.kind === 'cleanpoint').length;
      const cpNear = first ? (dirty ?? state.buildings.filter((b) => b.kind === 'house' || b.kind === 'res').at(-1) ?? state.buildings.find((b) => b.kind === 'townhall')) : dirty && points < 1 + Math.floor(pop / 60) ? dirty : undefined;
      // 2.2: si el primero no llega, un préstamo con cabeza (al día siguiente se construye).
      if (first && cpNear && o.borrow === 'prudente' && state.treasury < buildCost('cleanpoint')) {
        const loan = prudentLoan(state, buildCost('cleanpoint'));
        if (loan) {
          out.push(loan);
          return out;
        }
      }
      if (cpNear && !state.projects.some((p) => buildingKindOf(state, p.buildingId) === 'cleanpoint') && state.treasury >= buildCost('cleanpoint') + (first ? 0 : o.reserve / 2)) {
        // En la misma red de calles que lo sucio (si no, el camión no llegaría).
        const net = roadNetworkOf(state, cpNear);
        const onNet = (s: { x: number; y: number }) => DIRS.some(([dx, dy]) => net.has((s.y + dy) * state.map.w + s.x + dx));
        const near = spots.filter(onNet).sort((a, b) => Math.abs(a.x - cpNear.x) + Math.abs(a.y - cpNear.y) - (Math.abs(b.x - cpNear.x) + Math.abs(b.y - cpNear.y)));
        const spot = near.find((s) => validateCommand(state, { type: 'Build', kind: 'cleanpoint', x: s.x, y: s.y }).ok);
        if (spot) {
          out.push({ type: 'Build', kind: 'cleanpoint', x: spot.x, y: spot.y });
          return out;
        }
      }
      // v1.8: repara lo que rompieron los disturbios (2.1: o el fuego) si la caja lo permite.
      const broken = state.buildings.find((b) => b.damaged && b.damaged.repairUntil < 0);
      if (broken && state.treasury > broken.damaged!.cost + o.reserve) {
        out.push({ type: 'RepairBuilding', buildingId: broken.id });
        return out;
      }
      // v1.8: amplía el ayuntamiento en cuanto puede pagarlo sin tocar su reserva.
      const up = nextLevel(state);
      // El nivel 2 (las zonas) es lo primero; los demás, solo con el mes en positivo y colchón.
      const prev = state.stats.at(-1);
      const prudent = up && (up.level === 2 ? state.treasury >= up.cost : state.treasury >= up.cost * 2 + o.reserve && (!prev || prev.income >= prev.expenses));
      if (up && prudent && canUpgradeTownhall(state).ok) {
        out.push({ type: 'UpgradeTownhall' });
        return out;
      }
      // 2.2: si ya tiene lo que cuesta y le falta el colchón, lo pide prestado (con cabeza).
      if (up && !prudent && o.borrow === 'prudente' && up.level > 2 && state.citizens.length >= up.pop && state.treasury >= up.cost && (!prev || prev.income >= prev.expenses)) {
        const loan = prudentLoan(state, up.cost * 2 + o.reserve - 1_000);
        if (loan) {
          out.push(loan);
          return out;
        }
      }
      // 2.3: el patrimonio (uno por partida) y la tasa turística media.
      if (o.tourism && has('heritage') && state.tourism.tax !== 1) out.push({ type: 'SetTouristTax', level: 1 });
      if (o.tourism && !has('heritage') && isUnlocked(state, 'heritage') && tryBuild('heritage')) return out;
      // 2.3: grandes obras (y la gran empresa, con el IBI bonificado).
      if (o.landmarks) {
        const lm = landmarkPlan(state, o.reserve, spots, o.keepRoads);
        if (lm.length) {
          out.push(...lm);
          return out;
        }
      }
      // 2.4: con el río sucio, una depuradora lo más abajo posible.
      const sewage = sewagePlan(state, spots, o.reserve);
      if (sewage) {
        out.push(sewage);
        return out;
      }
      const zonesOn = zonesUnlocked(state);
      // Un jugador razonable mira el parte: no añade servicios (y sus sueldos) con el mes en negativo.
      const last = state.stats.at(-1);
      // 2.3 (F3): y solo si el superávit del mes pasado paga lo que cuesta al mes (sueldos y mantenimiento). Sin
      // esto, el constructor gastaba la caja del primer mes en cinco servicios que el pueblo no podía pagar
      // («El pueblo que se vacía»: −50.000 € a los 3 años, −160.000 € a los 8, con los préstamos de tesorería).
      if (zonesOn && last && last.income >= last.expenses) {
        const count = (k: string) => state.buildings.filter((b) => b.kind === k).length;
        const wanted = o.servicesPer ? Math.ceil(pop / o.servicesPer) : 1;
        const monthly = (k: BuildKind) => (k === 'road' ? 0 : MAINTENANCE[k] + JOBS[k] * SERVICE_SALARY);
        // Lo que ya cuesta al mes lo que ha hecho desde el último parte (sueldos y mantenimiento que aún no salen en él).
        const now = state.buildings.reduce((a, b) => a + (b.owner === TREASURY ? maintenanceOf(b) + jobsOf(b) * (b.kind in SERVICE ? SERVICE_SALARY : PUBLIC_SALARY) : 0), 0);
        const before = -((last.breakdown['sueldos'] ?? 0) + (last.breakdown['mantenimiento'] ?? 0));
        const room = ownIncome(last) - last.expenses - Math.max(0, now - before);
        for (const kind of o.services) if (count(kind) < wanted && room >= monthly(kind) && tryBuild(kind)) return out;
      }
      // 2.4: estación de autobuses, guardería y residencia.
      if (o.care && zonesOn && last && last.income >= last.expenses) {
        const cost = (k: 'busstation' | 'nursery' | 'residence') => (MAINTENANCE[k] + JOBS[k] * PUBLIC_SALARY) * (k === 'busstation' ? 1 - TRANSIT.consortium : 1);
        const now = state.buildings.reduce((a, b) => a + (b.owner === TREASURY ? maintenanceOf(b) + jobsOf(b) * (b.kind in SERVICE ? SERVICE_SALARY : PUBLIC_SALARY) : 0), 0);
        const before = -((last.breakdown['sueldos'] ?? 0) + (last.breakdown['mantenimiento'] ?? 0));
        const room = ownIncome(last) - last.expenses - Math.max(0, now - before);
        const commuters = state.citizens.filter((c) => c.jobId === null && c.unemployedSince === undefined).length;
        const elders = state.citizens.filter((c) => c.age >= CARE.elderAge).length;
        // Parejas en edad de tener hijos que viven juntas (o niños pequeños ya).
        const couples = state.citizens.filter((c) => c.homeId !== null && c.age >= 20 && c.age <= 45 && c.relations.some((r) => r.kind === 'pareja' && r.id > c.id && state.citizens.find((x) => x.id === r.id)?.homeId === c.homeId)).length;
        const wants: ['busstation' | 'nursery' | 'residence', boolean][] = [
          ['busstation', commuters >= TRANSIT_RIDERS],
          ['nursery', couples >= CARE_COUPLES],
          ['residence', elders >= CARE_ELDERS],
        ];
        // Con holgura: que el superávit pague dos veces lo que cuesta al mes.
        for (const [kind, ok] of wants) if (ok && !has(kind) && isUnlocked(state, kind) && room >= 3 * cost(kind) && tryBuild(kind)) return out;
      }
      // 2.5: una vivienda protegida, con el mes en positivo y holgura para su mantenimiento.
      if (o.density && zonesOn && last && ownIncome(last) - last.expenses >= 3 * MAINTENANCE.vpo && !has('vpo') && isUnlocked(state, 'vpo') && tryBuild('vpo')) return out;
      // Vivienda municipal al principio (o siempre, según el perfil).
      if ((!zonesOn || o.municipalHousing) && freeHomes(state) + state.projects.filter((p) => p.payer === 0).length * 3 < 3 && state.demand.R > 0) {
        if (tryBuild('house')) return out;
      }
      if (zonesOn) {
        const zoned = (z: number) =>
          spots.filter((s) => state.map.zones[tileIndex(state, s.x, s.y)] === z).length;
        const unzoned = spots.filter((s) => state.map.zones[tileIndex(state, s.x, s.y)] === Zone.None);
        const want: [number, 'R' | 'C' | 'I', number][] = [
          [Zone.R, 'R', state.demand.R],
          [Zone.C, 'C', state.demand.C],
          [Zone.I, 'I', state.demand.I],
        ];
        const taken = new Set<string>();
        // 2.5: más densidad donde ya hay bloques y hay demanda.
        if (o.density && state.demand.R > DENSITY.minDemandR) {
          const d = densityPlan(state);
          if (d) out.push(d);
        }
        // 2.2: el campo, lejos del centro (de dos en dos, según crecen las fincas).
        if (o.farms && farmZoneUnlocked(state).ok) {
          const farms = state.buildings.filter((b) => b.kind === 'farm').length;
          if (farms + zoned(Zone.A) < o.farms && zoned(Zone.A) < 2) {
            for (const s of [...unzoned].reverse().slice(0, 2)) {
              taken.add(`${s.x},${s.y}`);
              out.push({ type: 'Zone', zone: 'A', x: s.x, y: s.y, w: 1, h: 1 });
            }
          }
        }
        // 2.3 (F3): cerca de los vecinos de la gran empresa, un polígono de 3×2 de zona I lejos del centro, donde
        // quepa su fábrica 2×2 (pintando casillas sueltas nunca había sitio y la oferta no llegaba).
        if (o.bigCompany && !state.bigCompany && pop >= REGION.bigCompany.pop - 10 && !bigFactorySpot(state)) {
          const block = industrialBlock(state, [...unzoned].reverse(), o.keepRoads);
          if (block) {
            for (let y = block.y; y < block.y + 2; y++) for (let x = block.x; x < block.x + 3; x++) taken.add(`${x},${y}`);
            out.push({ type: 'Zone', zone: 'I', x: block.x, y: block.y, w: 3, h: 2 });
          }
        }
        for (const [z, zone, demand] of want) {
          if (demand <= 15 || zoned(z) >= 3) continue;
          // La industria, lejos del centro.
          const list = (zone === 'I' ? [...unzoned].reverse() : unzoned).filter((s) => !taken.has(`${s.x},${s.y}`));
          for (const s of list.slice(0, 4)) {
            taken.add(`${s.x},${s.y}`);
            out.push({ type: 'Zone', zone, x: s.x, y: s.y, w: 1, h: 1 });
          }
        }
      }
      if (spots.length < 6 && state.treasury > o.reserve + 1_500) {
        const r = nextRoad(state);
        if (r) out.push(r);
      }
      return out;
    },
  };
}

export const PROFILES: Record<string, Profile> = {
  pasivo: { name: 'pasivo', decide: () => [] },
  casual: planner('casual', { tax: 'medium', reserve: 3_000, activity: 0.3, services: ['park'], municipalHousing: false, tourism: true, landmarks: true, bigCompany: true, care: true }),
  // 2.2: un jugador casual que además pinta zona agraria (para medir el campo).
  campo: planner('campo', { tax: 'medium', reserve: 3_000, activity: 0.3, services: ['park'], municipalHousing: false, farms: 8 }),
  ahorrador: planner('ahorrador', { tax: 'low', reserve: 4_000, activity: 0.5, services: ['park'], municipalHousing: false }),
  agresivo: planner('agresivo', { tax: 'high', reserve: 2_000, activity: 0.6, services: ['park'], municipalHousing: false }),
  derrochador: planner('derrochador', {
    tax: 'low',
    reserve: 0,
    activity: 1,
    services: ['park', 'school', 'clinic', 'police'],
    municipalHousing: true,
    servicesPer: 6,
  }),
  constructor: planner('constructor', {
    tax: 'medium',
    reserve: 0,
    activity: 1,
    // 2.1: el constructor también pone bomberos.
    services: ['park', 'school', 'clinic', 'police', 'firestation'],
    municipalHousing: true,
    borrow: 'prudente',
    keepRoads: true,
    tourism: true,
    landmarks: true,
    bigCompany: true,
    care: true,
    density: true,
  }),
  // 2.2: como el constructor, pero pidiendo prestado todo lo que le dejen (equilibrio de los préstamos).
  endeudado: planner('endeudado', {
    tax: 'medium',
    reserve: 0,
    activity: 1,
    services: ['park', 'school', 'clinic', 'police', 'firestation'],
    municipalHousing: true,
    borrow: 'maximo',
    keepRoads: true,
  }),
};

export function profileRng(seed: number): RngState {
  return seedRng(seed ^ 0x5eed1e55);
}

