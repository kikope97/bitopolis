/**
 * 2.5 (bloques I y J): los pueblos vecinos (`state.comarca`), simulados como
 * resumen una vez al mes (O(1), sin mapa); competencia por vecinos, bolsa de
 * subvenciones de la Diputación, compra de excedentes con acuerdos, río sucio
 * que enfada al pueblo de abajo, alcaldes (IA en Modo IA, reglas por
 * personalidad si no) y feria comarcal. Números en `COMARCA` (balance.ts).
 *
 * - Los pueblos se crean al primer cierre de mes, deterministas con la semilla.
 * - La fase de la comarca (region.ts) mueve su felicidad según su especialidad.
 * - Todo el dinero del juego entra o sale con `transfer` contra `OUTSIDE`; la
 *   caja de los vecinos es solo un resumen (no es dinero del juego).
 * - Modo IA: al cerrar el mes se abre `comarca.turn`; el servidor pregunta a la
 *   IA (neighbor-prompt.ts) y el resultado entra con el comando `NeighborTurn`.
 *   Si vence sin respuesta (`COMARCA.turnDays`), deciden las reglas.
 */
import { TICKS_PER_DAY, TICKS_PER_MONTH, tickToDate } from '@bitopolis/shared';
import { COMARCA } from './balance.ts';
import type { CommandResult } from './commands.ts';
import { harvestMonthOf, isFarm } from './farm.ts';
import { hash32 } from './hash.ts';
import { plantCapacityOf } from './levels.ts';
import { fmt } from './loans.ts';
import { OUTSIDE, TREASURY, transfer } from './money.ts';
import { FIRST_NAMES, SURNAMES } from './names.ts';
import { FACTIONS } from './politics-core.ts';
import {
  type Building,
  type Citizen,
  type GameState,
  type NeighborOffer,
  type NeighborOfferKind,
  type NeighborPersonality,
  type NeighborSpecialty,
  type NeighborTown,
  pushEvent,
} from './state.ts';
import { hasRiver, isPowerPlant, isRenewable, renewableFx, riverExit } from './waterworks.ts';

/** Pueblos inventados de la comarca (se eligen con la semilla). */
export const NEIGHBOR_TOWN_NAMES = [
  'Villaverde del Cerro',
  'Fuenteclara',
  'Navalrío',
  'Peñalba de Arriba',
  'Robledo Viejo',
  'Castilnuevo',
  'Valdeolmos del Llano',
  'San Bartolo de la Vega',
  'Torrecilla del Monte',
  'Hontanar',
  'Las Majadas',
  'Aldeaseca',
] as const;

export const SPECIALTIES: readonly NeighborSpecialty[] = ['campo', 'industria', 'turismo', 'servicios'];
export const PERSONALITIES: readonly NeighborPersonality[] = ['cooperador', 'competidor', 'populista', 'prudente'];
export const OFFER_KINDS: readonly NeighborOfferKind[] = ['agua', 'luz', 'autobus', 'cosecha'];

export const SPECIALTY_TEXT: Record<NeighborSpecialty, string> = { campo: 'el campo', industria: 'la industria', turismo: 'el turismo', servicios: 'los servicios' };
export const PERSONALITY_TEXT: Record<NeighborPersonality, string> = { cooperador: 'dialogante', competidor: 'competitivo', populista: 'populista', prudente: 'prudente' };
export const OFFER_TEXT: Record<NeighborOfferKind, string> = { agua: 'agua', luz: 'luz', autobus: 'autobús', cosecha: 'cosecha' };
/** Qué significa cada acuerdo para el pueblo (la ficha lo enseña antes de aceptar). */
export function offerEffect(kind: NeighborOfferKind): string {
  const d = COMARCA.deals;
  switch (kind) {
    case 'luz':
      return `Os compra la luz que sobre de las placas y molinos: ${d.luz.perBuilding} € al mes por cada edificio que podríais alumbrar de más (${d.months} meses)`;
    case 'agua':
      return `Os compra el agua que sobre: ${d.agua.perBuilding} € al mes por cada edificio que podríais abastecer de más (${d.months} meses)`;
    case 'autobus':
      return `Línea de autobús compartida: ${d.autobus.fee} € al mes y +${d.autobus.happiness} de felicidad para todo el pueblo (${d.months} meses)`;
    case 'cosecha':
      return `Os compra la cosecha: las fincas cobran un ${Math.round(d.cosecha.bonus * 100)} % más al vender (${d.months} meses)`;
  }
}
export const RELATION_TEXT = ['mala', 'tensa', 'normal', 'buena', 'muy buena'] as const;
export const relationText = (r: number): string => RELATION_TEXT[Math.max(-2, Math.min(2, Math.round(r))) + 2]!;

/** Acciones que puede elegir un alcalde (la IA, de su menú). */
export const NEIGHBOR_ACTS = ['bajar_impuestos', 'pedir_subvencion', 'ofrecer_acuerdo', 'criticar', 'felicitar', 'invitar_feria', 'nada'] as const;

const clampRel = (r: number) => Math.max(-2, Math.min(2, Math.round(r)));
const monthIndex = (state: GameState) => Math.floor(state.tick / TICKS_PER_MONTH);
const ourName = 'Bitópolis';

/* ---------------- creación ---------------- */

/** Crea los pueblos vecinos (deterministas con la semilla; sin tocar `state.rng`). */
export function createNeighbors(state: GameState): NeighborTown[] {
  const used = new Set<number>();
  const towns: NeighborTown[] = [];
  for (let i = 0; i < COMARCA.towns; i++) {
    let k = hash32(state.seed, 501, i) % NEIGHBOR_TOWN_NAMES.length;
    while (used.has(k)) k = (k + 1) % NEIGHBOR_TOWN_NAMES.length;
    used.add(k);
    const { min, max } = COMARCA.startPop;
    const first = FIRST_NAMES[hash32(state.seed, 503, i) % FIRST_NAMES.length]!;
    const last = SURNAMES[hash32(state.seed, 505, i) % SURNAMES.length]!;
    towns.push({
      id: i + 1,
      name: NEIGHBOR_TOWN_NAMES[k]!,
      pop: min + (hash32(state.seed, 507, i) % (max - min + 1)),
      happiness: COMARCA.baseHappiness - 5 + (hash32(state.seed, 509, i) % 11),
      treasury: 5_000 + (hash32(state.seed, 511, i) % 10_000),
      // Especialidades y personalidades distintas entre ellos (rotadas desde la semilla).
      specialty: SPECIALTIES[(hash32(state.seed, 513) + i) % SPECIALTIES.length]!,
      mayor: { name: `${first} ${last}`, faction: FACTIONS[hash32(state.seed, 515, i) % FACTIONS.length]!, personality: PERSONALITIES[(hash32(state.seed, 517) + i) % PERSONALITIES.length]! },
      relation: 0,
      // El primero queda río abajo (si hay río).
      ...(i === 0 && hasRiver(state) ? { downstream: true } : {}),
    });
  }
  return towns;
}

/* ---------------- excedentes (ganchos para waterworks.ts y coop.ts) ---------------- */

const consumers = (state: GameState, kind: 'water' | 'power') =>
  state.buildings.filter((b) => b.built && b.kind !== 'farm' && (kind === 'water' ? b.kind !== 'water' : !isPowerPlant(b.kind))).length;

/** Edificios de más que podrían alumbrar las placas y molinos (lo que sobra después de dar luz al pueblo). */
export function powerSurplus(state: GameState): number {
  let total = 0;
  let renewable = 0;
  for (const b of state.buildings) {
    if (!b.built || b.damaged || !isPowerPlant(b.kind)) continue;
    const cap = Math.round(plantCapacityOf(b) * (isRenewable(b.kind) ? renewableFx(state, b.kind) : 1));
    total += cap;
    if (isRenewable(b.kind)) renewable += cap;
  }
  return Math.max(0, Math.min(renewable, total - consumers(state, 'power')));
}

/** Edificios de más que podrían abastecer las bombas. */
export function waterSurplus(state: GameState): number {
  let total = 0;
  for (const b of state.buildings) if (b.built && !b.damaged && b.kind === 'water') total += plantCapacityOf(b);
  return Math.max(0, total - consumers(state, 'water'));
}

/** Acuerdo en vigor de ese tipo (el de cualquier pueblo). */
export function activeDeal(state: GameState, kind: NeighborOfferKind): NeighborOffer | undefined {
  return state.comarca?.offers.find((o) => o.kind === kind && o.resolved === 'accepted' && o.dealUntil !== undefined && o.dealUntil > state.tick);
}

/** Gancho de la cosecha: % extra que paga un vecino por la cosecha (0 sin acuerdo). coop.ts puede sumarlo a su precio. */
export function harvestDealFx(state: GameState): number {
  return activeDeal(state, 'cosecha') ? COMARCA.deals.cosecha.bonus : 0;
}

/** Gancho de la luz: € al mes que pagaría el vecino por la luz sobrante (0 sin acuerdo). */
export function powerDealIncome(state: GameState): number {
  return activeDeal(state, 'luz') ? powerSurplus(state) * COMARCA.deals.luz.perBuilding : 0;
}

/* ---------------- atractivo y competencia ---------------- */

function avgHappiness(state: GameState): number {
  return state.citizens.length ? state.citizens.reduce((a, c) => a + c.happiness, 0) / state.citizens.length : 0;
}

/** Atractivo del pueblo para quien busca dónde vivir: felicidad media e impuestos. */
export function ourAttract(state: GameState): number {
  return Math.round(avgHappiness(state) + COMARCA.taxAttract[state.taxLevel as keyof typeof COMARCA.taxAttract]);
}

export function townAttract(state: GameState, t: NeighborTown): number {
  return Math.round(t.happiness + ((t.taxCutUntil ?? -1) > state.tick ? COMARCA.taxCut.attract : 0));
}

/** El vecino que más tira de los nuestros, si supera el atractivo en más de `pullGap`. */
export function strongestPull(state: GameState): NeighborTown | null {
  const ours = ourAttract(state);
  let best: NeighborTown | null = null;
  for (const t of state.comarca.towns) if (townAttract(state, t) - ours > COMARCA.pullGap && (!best || townAttract(state, t) > townAttract(state, best))) best = t;
  return best;
}

/** Cuántos se irían este mes al pueblo que más atrae (0 si no hay diferencia). */
export function pullLeavers(state: GameState): number {
  if (!strongestPull(state) || state.citizens.length < COMARCA.pullMinPop) return 0;
  return Math.max(1, Math.round(state.citizens.length * COMARCA.pullShare));
}

function competition(state: GameState, leave: (c: Citizen) => void): void {
  const t = strongestPull(state);
  const n = pullLeavers(state);
  if (!t || n <= 0) return;
  // Se van los menos contentos sin nombre (los vecinos con nombre deciden ellos mismos).
  const who = state.citizens.filter((c) => !c.named).sort((a, b) => a.happiness - b.happiness || a.id - b.id).slice(0, n);
  let gone = 0;
  for (const c of who) {
    const before = state.citizens.length;
    leave(c);
    if (state.citizens.length < before) gone++;
  }
  if (!gone) return;
  t.pop = Math.min(COMARCA.popLimits.max, t.pop + gone);
  const why = (t.taxCutUntil ?? -1) > state.tick ? 'ha bajado los impuestos' : 'allí se vive más a gusto';
  pushEvent(state, 'departure', `${gone === 1 ? 'Un vecino se va' : `${gone} vecinos se van`} a ${t.name}: ${why}`);
}

/* ---------------- simulación mensual de los vecinos ---------------- */

function simulateTown(state: GameState, t: NeighborTown): void {
  const phase = state.region?.phase ?? 'normal';
  const taxCut = (t.taxCutUntil ?? -1) > state.tick;
  const target = COMARCA.baseHappiness + COMARCA.phaseHappiness[t.specialty][phase] + (taxCut ? COMARCA.taxCut.happiness : 0) + t.relation;
  t.happiness = Math.round(t.happiness + (target - t.happiness) * COMARCA.happinessPull);
  // Crece o mengua con la felicidad (al menos un vecino al mes si se nota).
  const d = t.pop * (t.happiness - 50) * COMARCA.growth;
  const delta = Math.abs(t.happiness - 50) < 3 ? 0 : d > 0 ? Math.max(1, Math.round(d)) : Math.min(-1, Math.round(d));
  t.pop = Math.max(COMARCA.popLimits.min, Math.min(COMARCA.popLimits.max, t.pop + delta));
  const income = t.pop * COMARCA.incomePerPop * (phase === 'crisis' ? 0.7 : phase === 'bonanza' ? 1.2 : 1);
  t.treasury = Math.round(t.treasury + income - (taxCut ? t.pop * COMARCA.taxCut.costPerPop : 0));
}

/** Río a la salida: el pueblo de abajo se enfada (y se le pasa cuando mejora). */
function riverMonth(state: GameState): void {
  const down = state.comarca.towns.find((t) => t.downstream);
  if (!down) return;
  const exit = riverExit(state);
  if (exit > COMARCA.riverAngry) {
    if (!state.comarca.riverAngry) {
      state.comarca.riverAngry = true;
      down.relation = clampRel(down.relation - 1);
      pushEvent(state, 'warning', `${down.name}, río abajo, protesta: el río les llega sucio desde ${ourName} (${exit}). Una depuradora lo arreglaría`, { notify: true });
    } else if (monthIndex(state) % 3 === 0) down.relation = clampRel(down.relation - 1);
  } else if (state.comarca.riverAngry && exit <= COMARCA.riverAngry - 10) {
    state.comarca.riverAngry = false;
    pushEvent(state, 'info', `${down.name} agradece que el río ya baje más limpio`);
  }
}

/** Acuerdos en vigor: luz, agua y autobús cada mes (la cosecha, al vender: `comarcaHarvest`). */
function dealsMonth(state: GameState): void {
  const d = COMARCA.deals;
  const luz = activeDeal(state, 'luz');
  if (luz) transfer(state, OUTSIDE, TREASURY, powerSurplus(state) * d.luz.perBuilding, 'comarca');
  const agua = activeDeal(state, 'agua');
  if (agua) transfer(state, OUTSIDE, TREASURY, waterSurplus(state) * d.agua.perBuilding, 'comarca');
  const bus = activeDeal(state, 'autobus');
  if (bus) transfer(state, TREASURY, OUTSIDE, d.autobus.fee, 'comarca');
}

/** Bolsa semestral de la Diputación, repartida por puntuación (vecinos, felicidad y lo que pidió cada alcalde). */
export function grantScores(state: GameState): { ours: number; towns: Map<number, number> } {
  const relation = state.comarca.towns.reduce((a, t) => a + t.relation, 0);
  const ours = Math.max(1, state.citizens.length / 10 + avgHappiness(state) / 10 + relation);
  const towns = new Map<number, number>();
  for (const t of state.comarca.towns) towns.set(t.id, Math.max(1, t.pop / 10 + t.happiness / 10 + (t.grantClaims ?? 0) * COMARCA.grantClaimScore));
  return { ours, towns };
}

function grantsMonth(state: GameState): void {
  const closing = tickToDate(state.tick - 1).month;
  if (closing % COMARCA.grantMonths !== 0) return;
  const { ours, towns } = grantScores(state);
  const total = ours + [...towns.values()].reduce((a, b) => a + b, 0);
  const mine = Math.round((COMARCA.grantPool * ours) / total);
  const got = transfer(state, OUTSIDE, TREASURY, mine, 'subvencion');
  let best: NeighborTown | null = null;
  for (const t of state.comarca.towns) {
    t.treasury += Math.round((COMARCA.grantPool * towns.get(t.id)!) / total);
    if (!best || towns.get(t.id)! > towns.get(best.id)!) best = t;
    t.grantClaims = 0;
  }
  pushEvent(state, 'info', `La Diputación reparte la bolsa comarcal: ${fmt(got)} € para ${ourName}${best ? `; lo que más, para ${best.name}` : ''}`);
}

/* ---------------- feria comarcal ---------------- */

/** Anfitrión de la feria de un año (0 = el nuestro): rota y nunca repite dos años seguidos. */
export function fairHost(state: GameState, year: number): number {
  const ids = [0, ...state.comarca.towns.map((t) => t.id)];
  return ids[(year + (hash32(state.seed, 521) % ids.length)) % ids.length]!;
}

const hostName = (state: GameState, id: number) => (id === 0 ? ourName : (state.comarca.towns.find((t) => t.id === id)?.name ?? 'la comarca'));

function ensureFair(state: GameState): void {
  const year = tickToDate(state.tick).year;
  if (!state.comarca.fair || state.comarca.fair.year !== year) state.comarca.fair = { year, host: fairHost(state, year) };
}

/**
 * Al cerrar septiembre: la feria comarcal. Si es en el pueblo, los forasteros
 * gastan en las tiendas; si no, el anfitrión se lleva el gasto. El premio lo da
 * el motor (felicidad, tiendas y fincas; un poco de suerte con la semilla).
 */
export function comarcaFair(state: GameState, shops: Building[]): void {
  const d = tickToDate(state.tick - 1);
  const f = state.comarca?.fair;
  if (d.month !== COMARCA.fairMonth || !f || f.year !== d.year || !state.comarca.towns.length) return;
  const towns = state.comarca.towns;
  const spend = COMARCA.fair.spendPerTown * towns.length;
  if (f.host === 0) {
    let total = 0;
    const each = shops.length ? Math.floor(spend / shops.length) : 0;
    for (const b of shops) {
      const got = transfer(state, OUTSIDE, b.id, each);
      b.sales = (b.sales ?? 0) + got;
      total += got;
    }
    pushEvent(state, 'business', total > 0 ? `Feria comarcal en ${ourName}: los forasteros de la comarca gastan ${fmt(total)} € en las tiendas` : `Feria comarcal en ${ourName}: viene la comarca, pero no hay tiendas donde gastar`);
  } else {
    const host = towns.find((t) => t.id === f.host);
    if (host) host.treasury += spend;
    pushEvent(state, 'info', `Feria comarcal en ${hostName(state, f.host)}: allí se quedan las ventas de este año`);
  }
  // Premio del motor.
  const farms = state.buildings.filter((b) => isFarm(b) && b.built).length;
  const oursScore = avgHappiness(state) + 2 * Math.min(10, shops.length + farms) + (hash32(state.seed, d.year, 0) % 10);
  let winner = 0;
  let best = oursScore;
  for (const t of towns) {
    const s = t.happiness + (t.specialty === 'campo' || t.specialty === 'turismo' ? 6 : 0) + (hash32(state.seed, d.year, t.id) % 10);
    if (s > best) {
      best = s;
      winner = t.id;
    }
  }
  state.comarca.lastPrize = { year: d.year, town: winner };
  if (winner === 0) {
    const got = transfer(state, OUTSIDE, TREASURY, COMARCA.fair.prize, 'premios');
    for (const c of state.citizens) c.happiness = Math.min(100, c.happiness + COMARCA.fair.prizeHappiness);
    pushEvent(state, 'business', `¡${ourName} gana el premio de la feria comarcal! ${fmt(got)} € y el pueblo, orgulloso`);
  } else {
    const t = towns.find((x) => x.id === winner)!;
    t.treasury += COMARCA.fair.prize;
    pushEvent(state, 'info', `${t.name} gana el premio de la feria comarcal`);
  }
}

/* ---------------- alcaldes: menú, reglas y aplicación ---------------- */

/** Acciones válidas de un alcalde ahora (la IA elige de aquí). */
export function neighborMenu(state: GameState, t: NeighborTown): string[] {
  const menu: string[] = [];
  if ((t.taxCutUntil ?? -1) <= state.tick && t.treasury >= COMARCA.taxCut.minTreasury) menu.push('bajar_impuestos');
  if ((t.grantClaims ?? 0) < 2) menu.push('pedir_subvencion');
  const offers = state.comarca.offers;
  const openFromTown = offers.some((o) => o.townId === t.id && !o.resolved);
  if (!openFromTown && t.relation >= -1) {
    for (const k of OFFER_KINDS) {
      if (offers.some((o) => o.kind === k && !o.resolved) || activeDeal(state, k)) continue;
      if (!offerUseful(state, k)) continue;
      menu.push(`ofrecer_acuerdo:${k}`);
    }
  }
  if (t.relation > -2) menu.push('criticar');
  if (t.relation < 2) menu.push('felicitar');
  const f = state.comarca.fair;
  const m = tickToDate(state.tick).month;
  if (f && f.host === t.id && f.year === tickToDate(state.tick).year && m >= COMARCA.fairMonth - 2 && m <= COMARCA.fairMonth) menu.push('invitar_feria');
  menu.push('nada');
  return menu;
}

/** ¿Tiene sentido ese acuerdo con lo que hay en el pueblo? */
export function offerUseful(state: GameState, k: NeighborOfferKind): boolean {
  switch (k) {
    case 'luz':
      return powerSurplus(state) > 0;
    case 'agua':
      return waterSurplus(state) > 0;
    case 'autobus':
      return state.buildings.some((b) => b.kind === 'busstation' && b.built);
    case 'cosecha':
      return state.buildings.some((b) => isFarm(b) && b.built);
  }
}

/** Reglas por personalidad (Modo normal, sin respuesta de la IA, o en ahorro). Deterministas. */
export function ruleNeighborPick(state: GameState, t: NeighborTown, menu = neighborMenu(state, t)): string {
  const has = (a: string) => menu.includes(a);
  const deal = menu.find((a) => a.startsWith('ofrecer_acuerdo:'));
  const m = monthIndex(state);
  const ours = ourAttract(state);
  const angry = !!t.downstream && !!state.comarca.riverAngry;
  if (has('invitar_feria') && t.mayor.personality !== 'competidor') return 'invitar_feria';
  switch (t.mayor.personality) {
    case 'cooperador':
      if (angry && has('criticar') && m % 2 === 0) return 'criticar';
      if (deal) return deal;
      if (has('felicitar') && m % 2 === 0) return 'felicitar';
      return 'nada';
    case 'competidor':
      if (has('bajar_impuestos') && townAttract(state, t) <= ours + COMARCA.pullGap) return 'bajar_impuestos';
      if (has('criticar') && (angry || ours > t.happiness)) return 'criticar';
      if (deal && m % 4 === 0) return deal;
      return 'nada';
    case 'populista':
      if (has('criticar') && (angry || t.relation < 0)) return 'criticar';
      if (has('pedir_subvencion')) return 'pedir_subvencion';
      if (deal && m % 3 === 0) return deal;
      return has('felicitar') && m % 2 === 1 ? 'felicitar' : 'nada';
    case 'prudente':
      if (angry && has('criticar') && m % 3 === 0) return 'criticar';
      if (has('pedir_subvencion') && m % 2 === 0) return 'pedir_subvencion';
      if (deal && m % 3 === 0) return deal;
      return 'nada';
  }
}

/** Plantilla de la declaración (respaldo de la IA). Sin cifras. */
export function neighborTemplate(state: GameState, t: NeighborTown, accion: string): string {
  const [act, arg] = accion.split(':') as [string, NeighborOfferKind | undefined];
  const angry = t.downstream && state.comarca.riverAngry;
  const p = t.mayor.personality;
  switch (act) {
    case 'bajar_impuestos':
      return p === 'competidor' ? `En ${t.name} bajamos los impuestos: quien quiera vivir bien, ya sabe dónde.` : `Bajamos los impuestos en ${t.name}: los vecinos lo agradecerán.`;
    case 'pedir_subvencion':
      return `He ido a la Diputación a pedir lo que le toca a ${t.name}.`;
    case 'ofrecer_acuerdo':
      return arg === 'luz'
        ? `A ${ourName} le sobra luz y a nosotros nos falta: hablemos.`
        : arg === 'agua'
          ? `Proponemos a ${ourName} compartir el agua que le sobre.`
          : arg === 'autobus'
            ? `Una línea de autobús entre ${t.name} y ${ourName} nos vendría bien a todos.`
            : `Queremos comprar la cosecha de ${ourName}: buen producto, buen precio.`;
    case 'criticar':
      return angry ? `El río nos llega sucio desde ${ourName}. Así no se trata a los vecinos.` : p === 'populista' ? `En ${ourName} mucho prometer y poco hacer.` : `No compartimos cómo se hacen las cosas en ${ourName}.`;
    case 'felicitar':
      return `Enhorabuena a ${ourName}: así da gusto tener vecinos.`;
    case 'invitar_feria':
      return `Os esperamos en la feria comarcal de ${t.name}, que este año es nuestra.`;
    default:
      return p === 'prudente' ? `En ${t.name}, trabajo y prudencia: sin ruido.` : `Mes tranquilo en ${t.name}.`;
  }
}

/** Limpia una declaración (el servidor ya la validó con `parseText`): sin marcas, ≤ `COMARCA.maxSaid`. */
export function cleanSaid(text: string): string | null {
  // eslint-disable-next-line no-control-regex
  const t = text.replace(/[\u0000-\u001f<>`*_#]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length >= 4 && t.length <= COMARCA.maxSaid ? t : null;
}

function nextOfferId(state: GameState): number {
  return state.comarca.offers.reduce((a, o) => Math.max(a, o.id), 0) + 1;
}

/** Aplica lo que hace un alcalde (ya validado contra su menú). */
export function applyNeighborAct(state: GameState, t: NeighborTown, accion: string, said: string, by: 'ia' | 'reglas'): void {
  const [act, arg] = accion.split(':') as [string, NeighborOfferKind | undefined];
  t.lastAct = accion;
  t.said = said;
  t.saidBy = by;
  t.saidTick = state.tick;
  const who = `${t.mayor.name}, alcalde de ${t.name}`;
  switch (act) {
    case 'bajar_impuestos':
      t.taxCutUntil = state.tick + COMARCA.taxCut.months * TICKS_PER_MONTH;
      pushEvent(state, 'politics', `${t.name} baja los impuestos: atraerá vecinos. «${said}»`);
      break;
    case 'pedir_subvencion':
      t.grantClaims = (t.grantClaims ?? 0) + 1;
      break;
    case 'ofrecer_acuerdo': {
      if (!arg) break;
      const until = state.tick + COMARCA.offerDays * TICKS_PER_DAY;
      const o: NeighborOffer = { id: nextOfferId(state), townId: t.id, kind: arg, tick: state.tick, until };
      state.comarca.offers.push(o);
      if (state.comarca.offers.length > 30) state.comarca.offers.splice(0, state.comarca.offers.length - 30);
      const d = tickToDate(until);
      pushEvent(state, 'info', `${who}, ofrece un acuerdo de ${OFFER_TEXT[arg]}. Responde antes del ${d.day}/${d.month} en Pueblo › Comarca. «${said}»`, { notify: true });
      break;
    }
    case 'criticar':
      t.relation = clampRel(t.relation - 1);
      pushEvent(state, 'politics', `${who}, critica al ayuntamiento: «${said}»`);
      break;
    case 'felicitar':
      t.relation = clampRel(t.relation + 1);
      pushEvent(state, 'politics', `${who}, felicita al pueblo: «${said}»`);
      break;
    case 'invitar_feria':
      t.relation = clampRel(t.relation + 1);
      pushEvent(state, 'info', `${who}, invita al pueblo a la feria comarcal: «${said}»`);
      break;
  }
}

/** Decide por reglas los alcaldes que falten (o todos). */
function ruleAll(state: GameState, skip: Set<number> = new Set()): void {
  for (const t of state.comarca.towns) {
    if (skip.has(t.id)) continue;
    const a = ruleNeighborPick(state, t);
    applyNeighborAct(state, t, a, neighborTemplate(state, t, a), 'reglas');
  }
}

export interface NeighborPick {
  pueblo: number;
  accion: string;
  declaracion: string;
}

export function canApplyNeighborTurn(state: GameState, month: number): CommandResult {
  const t = state.comarca?.turn;
  if (!state.aiMode || !t) return { ok: false, error: 'No hay turno de los alcaldes abierto' };
  if (t.month !== month) return { ok: false, error: 'Ese turno de los alcaldes ya no está abierto' };
  return { ok: true };
}

/** Aplica el turno de los alcaldes: cada uno, si su acción sigue en el menú; si no, reglas. */
export function applyNeighborTurn(state: GameState, month: number, picks: NeighborPick[]): void {
  if (!canApplyNeighborTurn(state, month).ok) return;
  delete state.comarca.turn;
  for (const t of state.comarca.towns) {
    const p = picks.find((x) => x.pueblo === t.id);
    const menu = neighborMenu(state, t);
    if (p && menu.includes(p.accion)) {
      const said = cleanSaid(p.declaracion);
      applyNeighborAct(state, t, p.accion, said ?? neighborTemplate(state, t, p.accion), said ? 'ia' : 'reglas');
    } else {
      const a = ruleNeighborPick(state, t, menu);
      applyNeighborAct(state, t, a, neighborTemplate(state, t, a), 'reglas');
    }
  }
}

/* ---------------- ofertas: responder y caducar ---------------- */

export function canAnswerNeighbor(state: GameState, id: number, accept: boolean): CommandResult {
  const o = state.comarca.offers.find((x) => x.id === id);
  if (!o || o.resolved) return { ok: false, error: 'Esa oferta ya no está' };
  if (o.until <= state.tick) return { ok: false, error: 'Esa oferta ya caducó' };
  if (!state.comarca.towns.some((t) => t.id === o.townId)) return { ok: false, error: 'Ese pueblo no está en la comarca' };
  if (accept && activeDeal(state, o.kind)) return { ok: false, error: `Ya hay un acuerdo de ${OFFER_TEXT[o.kind]} en vigor` };
  return { ok: true };
}

export function answerNeighbor(state: GameState, id: number, accept: boolean): void {
  const o = state.comarca.offers.find((x) => x.id === id);
  if (!o || o.resolved) return;
  const t = state.comarca.towns.find((x) => x.id === o.townId);
  o.resolved = accept ? 'accepted' : 'rejected';
  if (!t) return;
  if (accept) {
    o.dealUntil = state.tick + COMARCA.deals.months * TICKS_PER_MONTH;
    t.relation = clampRel(t.relation + COMARCA.acceptRelation);
    pushEvent(state, 'business', `Acuerdo de ${OFFER_TEXT[o.kind]} con ${t.name} durante ${COMARCA.deals.months} meses`);
  } else {
    t.relation = clampRel(t.relation + COMARCA.rejectRelation);
    pushEvent(state, 'info', `El pueblo dice que no al acuerdo de ${OFFER_TEXT[o.kind]} con ${t.name}`);
  }
}

/** Ofertas y acuerdos que vencen; turno de los alcaldes sin respuesta (deciden las reglas). Cada día. */
export function comarcaDay(state: GameState): void {
  const cm = state.comarca;
  if (!cm || !cm.towns.length) return;
  for (const o of cm.offers) {
    const t = cm.towns.find((x) => x.id === o.townId);
    if (!o.resolved && o.until <= state.tick) {
      o.resolved = 'expired';
      if (t) t.relation = clampRel(t.relation + COMARCA.expireRelation);
      pushEvent(state, 'info', `Caduca sin respuesta la oferta de ${OFFER_TEXT[o.kind]} de ${t?.name ?? 'un pueblo vecino'}`);
    } else if (o.resolved === 'accepted' && o.dealUntil !== undefined && o.dealUntil <= state.tick) {
      delete o.dealUntil;
      pushEvent(state, 'info', `Termina el acuerdo de ${OFFER_TEXT[o.kind]} con ${t?.name ?? 'un pueblo vecino'}`);
    }
  }
  if (cm.turn && state.tick >= cm.turn.due) {
    delete cm.turn;
    ruleAll(state);
  }
}

/** Tras la venta de la cosecha (después de `farmMonth`): con acuerdo, el vecino paga un extra a cada finca que vendió. */
export function comarcaHarvest(state: GameState): void {
  const fx = harvestDealFx(state);
  if (fx <= 0) return;
  const d = tickToDate(state.tick - 1);
  let total = 0;
  for (const b of state.buildings) {
    if (!isFarm(b) || !b.built || !b.crop || b.harvested !== d.year || harvestMonthOf(b.crop) !== d.month) continue;
    const extra = transfer(state, OUTSIDE, b.id, Math.round((b.sales ?? 0) * fx));
    b.sales = (b.sales ?? 0) + extra;
    total += extra;
  }
  const t = state.comarca.towns.find((x) => x.id === activeDeal(state, 'cosecha')?.townId);
  if (total > 0) pushEvent(state, 'business', `${t?.name ?? 'Un pueblo vecino'} compra la cosecha: ${fmt(total)} € más para las fincas`);
}

/**
 * Principio del fin de mes (tras `regionMonth`): crea la comarca la primera
 * vez, simula los vecinos, competencia por vecinos, río, acuerdos, bolsa de la
 * Diputación y los alcaldes (Modo IA: abre el turno; si no, reglas).
 */
export function comarcaMonth(state: GameState, leave: (c: Citizen) => void): void {
  const cm = state.comarca;
  if (!cm) return;
  if (!cm.towns.length) {
    cm.towns = createNeighbors(state);
    pushEvent(state, 'info', `La comarca: ${cm.towns.map((t) => t.name).join(', ')}. Sus alcaldes también miran lo que haces (Pueblo › Comarca)`);
  }
  ensureFair(state);
  for (const t of cm.towns) simulateTown(state, t);
  competition(state, leave);
  riverMonth(state);
  dealsMonth(state);
  grantsMonth(state);
  // Alcaldes: un turno pendiente que no llegó se decide ya por reglas.
  if (cm.turn) {
    delete cm.turn;
    ruleAll(state);
  }
  if (state.aiMode) cm.turn = { month: monthIndex(state), due: state.tick + COMARCA.turnDays * TICKS_PER_DAY };
  else ruleAll(state);
}

/** Felicidad: la línea de autobús compartida con un vecino. */
export function comarcaMood(state: GameState): { label: string; value: number }[] {
  const bus = activeDeal(state, 'autobus');
  if (!bus) return [];
  const t = state.comarca.towns.find((x) => x.id === bus.townId);
  return [{ label: `Autobús a ${t?.name ?? 'la comarca'}`, value: COMARCA.deals.autobus.happiness }];
}
