import { type ScenarioId, TICKS_PER_MONTH } from '@bitopolis/shared';
import { addMoment } from './album.ts';
import { BUILD, BUSINESS_SEED_CASH, GRANT_PENALTY, SCENARIOS } from './balance.ts';
import { ownIncome, OUTSIDE, totalInternalMoney, TREASURY, transfer } from './money.ts';
import { nextInt } from './prng.ts';
import { type Building, type BuildingKind, type GameState, newBuilding, pushEvent, Tile, Zone } from './state.ts';
import { isWater } from './terrain.ts';
import { newResident } from './resident.ts';

/**
 * 2.3: escenarios al empezar (Libre, Pueblo en quiebra, El pueblo que se vacía,
 * Tras la riada). Números en `SCENARIOS` (balance.ts); estado en `state.scenario`.
 *
 * Un escenario parte de un pueblo pequeño ya hecho (ayuntamiento de nivel 2,
 * calle mayor, agua, luz, casas, tiendas y talleres) con su problema, y tiene
 * una meta con plazo. Cumplirla da una medalla (`escenario:<id>`) y una foto en
 * el álbum; si vence el plazo no se pierde: la partida sigue como Libre.
 * Todo es determinista (dados de `state.rng`) y no gasta IA.
 */

/** Nombre, meta y plazo en una línea (pantalla de inicio y ficha del escenario). */
export const SCENARIO_INFO: Record<ScenarioId, { name: string; story: string; goal: string }> = {
  libre: { name: 'Libre', story: 'Empiezas de cero con el ayuntamiento y una calle.', goal: 'Sin meta ni plazo: tú decides.' },
  quiebra: {
    name: 'Pueblo en quiebra',
    story: `La caja está en ${fmtEur(SCENARIOS.quiebra.treasury)} y ${SCENARIOS.quiebra.citizens} vecinos recuerdan las últimas subidas.`,
    goal: `Cuentas en positivo y ${SCENARIOS.quiebra.surplusMonths} meses seguidos de superávit antes de ${SCENARIOS.quiebra.deadlineMonths} meses.`,
  },
  vaciado: {
    name: 'El pueblo que se vacía',
    story: `${SCENARIOS.vaciado.citizens} vecinos, casi todos mayores, y ${SCENARIOS.vaciado.emptyHouses} casas vacías: el primer año nadie quiere venir.`,
    goal: `Llegar a ${SCENARIOS.vaciado.goalPop} vecinos en ${SCENARIOS.vaciado.deadlineMonths} meses.`,
  },
  riada: {
    name: 'Tras la riada',
    story: `El río se llevó medio pueblo: ${SCENARIOS.riada.damaged} edificios destrozados y ayuda de emergencia de ${fmtEur(SCENARIOS.riada.grant)}.`,
    goal: `Reparar todo y llegar a ${SCENARIOS.riada.goalPop} vecinos en ${SCENARIOS.riada.deadlineMonths} meses.`,
  },
};

function fmtEur(n: number): string {
  const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '−' : ''}${s} €`;
}

type Village = { house: number; res: number; shop: number; factory: number; park: number };

/** Casillas de la calle mayor y de las parcelas a sus lados (el centro siempre es llano). */
const HALF = 7;

/**
 * Pueblo de partida: calle mayor de 15 casillas y, a sus lados, agua y luz junto al
 * ayuntamiento, casas, tiendas y parque cerca del centro y los talleres al final.
 */
function buildVillage(state: GameState, v: Village): Building[] {
  const { w, tiles, zones, terrain } = state.map;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(state.map.h / 2);
  for (let x = cx - HALF; x <= cx + HALF; x++) tiles[cy * w + x] = Tile.Road;
  const lots: { x: number; y: number }[] = [];
  for (let x = cx - HALF; x <= cx + HALF; x++) {
    for (const y of [cy - 1, cy + 1]) {
      if (isWater(terrain?.[y * w + x]) || state.buildings.some((b) => b.x === x && b.y === y)) continue;
      lots.push({ x, y });
    }
  }
  // Del centro hacia fuera (a igual distancia, primero el lado izquierdo y la fila de arriba).
  lots.sort((a, b) => Math.abs(a.x - cx) - Math.abs(b.x - cx) || a.x - b.x || a.y - b.y);
  const out: Building[] = [];
  const place = (kind: BuildingKind, lot: { x: number; y: number } | undefined) => {
    if (!lot) return;
    lots.splice(lots.indexOf(lot), 1);
    const i = lot.y * w + lot.x;
    tiles[i] = Tile.Grass;
    const owner = kind === 'res' || kind === 'shop' || kind === 'factory' ? OUTSIDE : TREASURY;
    const b = newBuilding(state, kind, lot.x, lot.y, owner);
    b.built = true;
    b.hasWater = true;
    b.hasPower = true;
    if (kind === 'res') zones[i] = Zone.R;
    if (kind === 'shop') zones[i] = Zone.C;
    if (kind === 'factory') zones[i] = Zone.I;
    if (kind === 'shop' || kind === 'factory') b.cash = BUSINESS_SEED_CASH;
    out.push(b);
  };
  const at = (x: number, y: number) => lots.find((l) => l.x === cx + x && l.y === cy + y);
  place('water', at(0, 1));
  place('power', at(-1, -1));
  // Los talleres, al final de la calle (lejos de las casas).
  for (let k = 0; k < v.factory; k++) place('factory', lots[lots.length - 1]);
  for (let k = 0; k < v.house; k++) place('house', lots[0]);
  for (let k = 0; k < v.park; k++) place('park', lots[0]);
  for (let k = 0; k < v.shop; k++) place('shop', lots[0]);
  for (let k = 0; k < v.res; k++) place('res', lots[0]);
  return out;
}

/** Vecinos de partida (con casa), de `n` en adelante; la edad y los ahorros, con los dados del motor. */
function settle(state: GameState, n: number, age: readonly [number, number], money: readonly [number, number]): void {
  for (let k = 0; k < n; k++) {
    const c = newResident(state, { age: nextInt(state.rng, age[0], age[1]) });
    c.arrivedMonth = 0;
    c.money = nextInt(state.rng, money[0], money[1]);
    if (c.age >= 65 && c.named) c.profession = 'jubilado';
    state.citizens.push(c);
  }
  // Cada uno en una casa libre (por orden; las destrozadas no cuentan).
  const homes = state.buildings.filter((b) => (b.kind === 'house' || b.kind === 'res') && !b.damaged);
  const used = new Map<number, number>();
  for (const c of state.citizens) {
    const h = homes.find((b) => (used.get(b.id) ?? 0) < (b.kind === 'house' ? 3 : 4));
    if (!h) break;
    c.homeId = h.id;
    used.set(h.id, (used.get(h.id) ?? 0) + 1);
  }
}

/**
 * Prepara el escenario de `state.scenario.id` tras el terreno (determinista; Libre
 * no cambia nada). Al final, el dinero de partida se vuelve a contar para que el
 * dinero se conserve desde el tick 0.
 */
export function applyScenario(state: GameState): void {
  const id = state.scenario.id;
  if (id === 'libre') return;
  const S = SCENARIOS[id];
  const hall = state.buildings.find((b) => b.kind === 'townhall')!;
  state.townhallLevel = 2;
  state.events = [];
  const built = buildVillage(state, S.village);
  const lucia = state.citizens[0]!;
  const months = S.deadlineMonths;
  if (id === 'quiebra') {
    const q = SCENARIOS.quiebra;
    settle(state, q.citizens - 1, q.age, q.money);
    for (const c of state.citizens) c.grudge = q.grudge;
    state.treasury = q.treasury;
    state.debtMonths = q.debtMonths;
    state.rating = q.rating;
    state.scenario.goal = { kind: 'superavit', target: q.surplusMonths, progress: 0 };
    pushEvent(state, 'warning', `Pueblo en quiebra: la caja está en ${fmtEur(q.treasury)} y los vecinos no olvidan las subidas. ${SCENARIO_INFO.quiebra.goal}`, { notify: true });
  } else if (id === 'vaciado') {
    const v = SCENARIOS.vaciado;
    settle(state, v.citizens - 1, [v.ageMin, v.ageMax], v.money);
    state.treasury = v.treasury;
    state.scenario.goal = { kind: 'vecinos', target: v.goalPop, progress: state.citizens.length };
    pushEvent(state, 'warning', `El pueblo que se vacía: ${state.citizens.length} vecinos, casi todos mayores, y casas vacías. ${SCENARIO_INFO.vaciado.goal}`, { notify: true });
  } else {
    const r = SCENARIOS.riada;
    // Lo destrozado: dos bloques y una casa municipal, una tienda, un taller y el parque.
    const pickKind = (kind: BuildingKind, n: number) => built.filter((b) => b.kind === kind).slice(-n);
    const wrecked = [...pickKind('res', 2), ...pickKind('house', 1), ...pickKind('shop', 1), ...pickKind('factory', 1), ...pickKind('park', 1)].slice(0, r.damaged);
    for (const b of wrecked) {
      const materials = BUILD[b.kind as keyof typeof BUILD]?.materials ?? 0;
      b.damaged = { cost: Math.max(r.repairMin, Math.round(materials * r.repair)), repairUntil: -1, cause: 'riada' };
    }
    settle(state, r.citizens - 1, r.age, r.money);
    state.treasury = r.treasury;
    state.scenario.goal = { kind: 'reparar', target: r.goalPop, progress: wrecked.length };
  }
  state.scenario.deadline = months * TICKS_PER_MONTH;
  state.scenario.done = false;
  // Lucía sigue siendo la administrativa del ayuntamiento.
  lucia.jobId = hall.id;
  state.ledger.initialTotal = totalInternalMoney(state);
  if (id === 'riada') {
    // Ayuda de emergencia de la Diputación: el anticipo ahora; el resto, al terminar de reparar en plazo.
    const r = SCENARIOS.riada;
    const advance = Math.round(r.grant * r.grantAdvance);
    state.grants.push({
      id: state.nextId++,
      kind: 'townhall',
      share: 1,
      offeredTick: 0,
      deadline: r.grantMonths * TICKS_PER_MONTH,
      status: 'accepted',
      advance,
      minId: state.nextId,
      emergency: r.grant,
    });
    transfer(state, OUTSIDE, TREASURY, advance, 'subvenciones');
    pushEvent(
      state,
      'warning',
      `Tras la riada: ${r.damaged} edificios destrozados. La Diputación adelanta ${fmtEur(advance)} de una ayuda de ${fmtEur(r.grant)}: el resto llega si lo reparas todo en ${r.grantMonths} meses. ${SCENARIO_INFO.riada.goal}`,
      { notify: true },
    );
  }
}

/** ¿Sigue en marcha el escenario y aún dura su efecto de los primeros meses? */
function early(state: GameState, months: number): boolean {
  return !state.scenario.done && state.tick < months * TICKS_PER_MONTH;
}

/** Efectos del escenario en el motor (1 y 0 = nada): demanda R que se suma y factor de las riadas. */
export function scenarioFx(state: GameState): { demandR: number; flood: number } {
  const id = state.scenario?.id;
  if (id === 'vaciado' && early(state, SCENARIOS.vaciado.demandMonths)) return { demandR: SCENARIOS.vaciado.demandR, flood: 1 };
  if (id === 'riada' && early(state, SCENARIOS.riada.floodMonths)) return { demandR: 0, flood: SCENARIOS.riada.floodFx };
  return { demandR: 0, flood: 1 };
}

/** Edificios que siguen destrozados por la riada del escenario (también los que están en obras). */
export function floodWrecks(state: GameState): Building[] {
  return state.buildings.filter((b) => b.damaged?.cause === 'riada');
}

/** Lo que se debe al banco (préstamos vivos). */
function owed(state: GameState): number {
  return (state.loans ?? []).reduce((s, l) => s + l.left, 0);
}

/** ¿Se cumple hoy la meta? (y progreso para la interfaz). */
export function scenarioProgress(state: GameState): { met: boolean; text: string } {
  const sc = state.scenario;
  const pop = state.citizens.length;
  switch (sc.id) {
    case 'quiebra': {
      const months = sc.goal?.progress ?? 0;
      const net = state.treasury - owed(state);
      return { met: months >= SCENARIOS.quiebra.surplusMonths && net > 0, text: `${months} de ${SCENARIOS.quiebra.surplusMonths} meses de superávit; cuentas en ${fmtEur(net)}` };
    }
    case 'vaciado':
      return { met: pop >= SCENARIOS.vaciado.goalPop, text: `${pop} de ${SCENARIOS.vaciado.goalPop} vecinos` };
    case 'riada': {
      const left = floodWrecks(state).length;
      return { met: left === 0 && pop >= SCENARIOS.riada.goalPop, text: `${left ? `${left} por reparar` : 'todo reparado'}; ${pop} de ${SCENARIOS.riada.goalPop} vecinos` };
    }
    default:
      return { met: false, text: '' };
  }
}

/**
 * Resumen del escenario para la interfaz (y para la IA, si algún día lo necesita):
 * nombre, meta, progreso y meses que quedan. `null` en Libre o si ya terminó.
 */
export function scenarioStatus(state: GameState): { id: ScenarioId; name: string; goal: string; progress: string; monthsLeft: number } | null {
  const sc = state.scenario;
  if (!sc || sc.id === 'libre' || sc.done) return null;
  return {
    id: sc.id,
    name: SCENARIO_INFO[sc.id].name,
    goal: SCENARIO_INFO[sc.id].goal,
    progress: scenarioProgress(state).text,
    monthsLeft: Math.max(0, Math.ceil(((sc.deadline ?? 0) - state.tick) / TICKS_PER_MONTH)),
  };
}

/** La ayuda de emergencia de la riada: se cobra el resto al reparar todo en plazo; si vence, se devuelve el anticipo con recargo. */
function emergencyGrant(state: GameState): void {
  for (const g of state.grants) {
    if (!g.emergency || g.status !== 'accepted') continue;
    if (floodWrecks(state).length === 0 && state.tick <= g.deadline) {
      const rest = Math.max(0, g.emergency - g.advance);
      transfer(state, OUTSIDE, TREASURY, rest, 'subvenciones');
      g.status = 'paid';
      pushEvent(state, 'milestone', `Todo reparado a tiempo: la Diputación paga el resto de la ayuda de emergencia, ${fmtEur(rest)}`, { notify: true });
    } else if (state.tick >= g.deadline) {
      const back = Math.round(g.advance * (1 + GRANT_PENALTY));
      transfer(state, TREASURY, OUTSIDE, back, 'reintegro de subvención');
      g.status = 'expired';
      pushEvent(state, 'warning', `No se reparó todo a tiempo: hay que devolver ${fmtEur(back)} de la ayuda de emergencia`, { notify: true });
    }
  }
}

/** Fin de mes (tras guardar `stats`): ¿se cumplió la meta o venció el plazo? */
export function scenariosMonth(state: GameState): void {
  const sc = state.scenario;
  if (!sc || sc.id === 'libre') return;
  emergencyGrant(state);
  if (sc.done) return;
  if (sc.goal) {
    if (sc.goal.kind === 'superavit') sc.goal.progress = ownIncome(state.month) > state.month.expenses ? (sc.goal.progress ?? 0) + 1 : 0;
    else if (sc.goal.kind === 'vecinos') sc.goal.progress = state.citizens.length;
    else sc.goal.progress = floodWrecks(state).length;
  }
  const info = SCENARIO_INFO[sc.id];
  if (scenarioProgress(state).met) {
    sc.done = true;
    sc.won = true;
    const medal = `escenario:${sc.id}`;
    if (!state.medals.some((m) => m.id === medal)) state.medals.push({ id: medal, tick: state.tick });
    const hall = state.buildings.find((b) => b.kind === 'townhall') ?? { x: Math.floor(state.map.w / 2), y: Math.floor(state.map.h / 2) };
    addMoment(state, `escenario_${sc.id}`, `Meta cumplida: «${info.name}»`, hall);
    pushEvent(state, 'milestone', `¡Meta cumplida en «${info.name}»! Medalla nueva. El pueblo sigue, ya sin plazo`, { notify: true });
    return;
  }
  if (state.tick >= (sc.deadline ?? 0)) {
    sc.done = true;
    sc.won = false;
    pushEvent(state, 'warning', `Se acabó el plazo de «${info.name}» sin cumplir la meta. No pasa nada: el pueblo sigue como partida libre`, { notify: true });
  }
}
